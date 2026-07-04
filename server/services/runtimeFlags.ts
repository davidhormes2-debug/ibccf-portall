// Runtime-tunable flags backed by the `app_settings` table. Lets
// legal/ops flip platform-wide controls (e.g. which locales are
// approved for signing the Sealed Settlement & NDA) without a code
// redeploy. Values are cached for a short window so hot paths (every
// NDA preview / sign request) don't hammer Postgres on every call, but
// the cache is invalidated on write so an admin change takes effect
// immediately for the writer and within `CACHE_TTL_MS` for other
// instances.

import { storage } from "../storage";
import {
  NDA_DEFAULT_LOCALE,
  NDA_SIGNING_LOCALES_DEFAULT,
  NDA_SUPPORTED_LOCALES,
  type NdaLocale,
} from "../../shared/ndaTemplate";

// Per-language signing allowlist (Task #88). JSON array of NdaLocale
// codes. English is permanently included by the resolver even if the
// stored row omits it, so a typo can never lock signing out entirely.
// The legacy boolean `english_only_signing` row from Task #61 has been
// retired (Task #95) — migration `0008_backfill_nda_signing_locales`
// writes this row on upgrade so the legacy fallback is no longer
// needed.
export const NDA_SIGNING_LOCALES_KEY = "nda_signing_locales";

const CACHE_TTL_MS = 10_000;

interface CachedFlag<T> {
  value: T;
  fetchedAt: number;
}

let signingLocalesCache: CachedFlag<NdaLocale[]> | null = null;

function isNdaLocale(x: unknown): x is NdaLocale {
  return (
    typeof x === "string" &&
    (NDA_SUPPORTED_LOCALES as readonly string[]).includes(x)
  );
}

// Normalize an arbitrary list of codes into a stable, deduped allowlist
// that always contains English (defence-in-depth: the admin UI keeps
// English permanently checked, and the resolver also asserts it, but
// keeping the stored row honest avoids surprises during admin audits).
function sanitizeLocales(raw: unknown): NdaLocale[] {
  const arr = Array.isArray(raw) ? raw : [];
  const filtered = arr.filter(isNdaLocale);
  const set = new Set<NdaLocale>(filtered);
  set.add(NDA_DEFAULT_LOCALE);
  // Preserve the canonical order from NDA_SUPPORTED_LOCALES.
  return NDA_SUPPORTED_LOCALES.filter((c) => set.has(c));
}

function envFallback(): NdaLocale[] {
  // Env var honours a comma-separated list of locale codes for ops
  // scripts that need to seed the allowlist without an admin save.
  const csv = process.env.NDA_SIGNING_LOCALES;
  if (csv && csv.trim()) {
    return sanitizeLocales(csv.split(",").map((s) => s.trim()));
  }
  return [...NDA_SIGNING_LOCALES_DEFAULT];
}

/**
 * Live signing-locale allowlist. Reads `app_settings.nda_signing_locales`,
 * falls back to the `NDA_SIGNING_LOCALES` env var, then to the
 * compile-time default. Cached for 10s; on read failure we serve the
 * cached value (or env fallback) rather than throwing so the signing
 * flow never blocks on the settings lookup.
 */
export async function getNdaSigningLocales(): Promise<NdaLocale[]> {
  const now = Date.now();
  if (signingLocalesCache && now - signingLocalesCache.fetchedAt < CACHE_TTL_MS) {
    return signingLocalesCache.value;
  }
  try {
    const row = await storage.getAppSetting(NDA_SIGNING_LOCALES_KEY);
    if (row?.value) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        parsed = null;
      }
      const value = sanitizeLocales(parsed);
      signingLocalesCache = { value, fetchedAt: now };
      return value;
    }
    const value = envFallback();
    signingLocalesCache = { value, fetchedAt: now };
    return value;
  } catch (err) {
    console.error("[runtimeFlags] getNdaSigningLocales failed:", err);
    if (signingLocalesCache) return signingLocalesCache.value;
    return envFallback();
  }
}

/**
 * Persist the signing-locale allowlist and invalidate the in-process
 * cache. English is always re-added before saving so a future read can
 * never see an English-less allowlist on disk. Returns the freshly-
 * normalized value so callers can echo it back.
 */
export async function setNdaSigningLocales(
  locales: readonly string[],
  updatedBy: string | null,
  executor?: import("../db").DbExecutor,
): Promise<NdaLocale[]> {
  const value = sanitizeLocales(locales);
  await storage.setAppSetting(
    NDA_SIGNING_LOCALES_KEY,
    JSON.stringify(value),
    updatedBy,
    executor,
  );
  // When called inside a transaction the cache is primed by the route
  // handler after the commit succeeds — priming here would record a
  // value that might still get rolled back.
  if (!executor) {
    signingLocalesCache = { value, fetchedAt: Date.now() };
  }
  return value;
}

/** Test/route helper: prime the cache after a transactional save commits. */
export function primeNdaSigningLocalesCache(value: NdaLocale[]): void {
  signingLocalesCache = { value: sanitizeLocales(value), fetchedAt: Date.now() };
}

/** Test-only: drop the in-process cache. */
export function __resetRuntimeFlagCacheForTests(): void {
  signingLocalesCache = null;
}
