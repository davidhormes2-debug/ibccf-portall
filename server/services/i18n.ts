// Server-side i18n: a deliberately tiny translator that mirrors the
// client locale set under `client/src/i18n/locales/`. We re-use the
// SAME JSON files the browser ships with so a string only needs to be
// translated in one place.
//
// Used primarily by `EmailService` to render transactional emails in
// the recipient's preferred language. Two locale sources feed into
// `sendLocalizedCaseEmail`, in priority order:
//
//   1. `cases.preferred_locale` — written by the portal on sign-in and
//      on every locale switch (see `client/src/i18n/useLocale.ts` and
//      `GET /api/cases/access/:code`). This is what admin-triggered
//      emails (declaration assigned/approved/rejected, document
//      requested/reviewed, payout-wallet set, letter reissued, etc.)
//      read so they render in the recipient's language even though the
//      request that triggered them came from an admin.
//   2. `req.userLocale` — taken from the `X-User-Locale` request header
//      (see `client/src/lib/queryClient.ts`) and surfaced through the
//      middleware in `server/index.ts`. Used as a fallback for cases
//      that haven't been touched by the i18n-aware portal yet (legacy
//      rows whose `preferred_locale` is still NULL).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUPPORTED_SERVER_LOCALES = ["en", "es", "fr", "de", "pt", "zh"] as const;
export type ServerLocale = (typeof SUPPORTED_SERVER_LOCALES)[number];
export const DEFAULT_SERVER_LOCALE: ServerLocale = "en";

// Resolve this module's directory in a way that works in BOTH ESM (tsx dev,
// vitest) and CJS (esbuild production bundle as `dist/index.cjs`).
//
// In the CJS bundle `import.meta.url` is `undefined`, which previously crashed
// production startup with `ERR_INVALID_ARG_TYPE` from `fileURLToPath(undefined)`
// and caused the Replit Autoscale health check to fail. Guard the call so the
// module loads cleanly in both formats; the `LOCALE_CANDIDATES` list below
// already includes `process.cwd()`-based fallbacks for the prod bundle.
const __moduleUrl: string | undefined =
  typeof import.meta !== "undefined" ? (import.meta as { url?: string }).url : undefined;
const __dirname = __moduleUrl
  ? path.dirname(fileURLToPath(__moduleUrl))
  : path.join(process.cwd(), "server", "services");

// Locale JSON sits inside the client tree so translators only edit one
// place. We try several candidate roots so the path works in tsx (dev,
// running from `server/services/i18n.ts`), esbuild prod (running from
// `dist/index.cjs` inside the project), tests, and any future split
// where locales might be copied next to the server bundle.
const LOCALE_CANDIDATES = [
  path.resolve(__dirname, "..", "..", "client", "src", "i18n", "locales"),
  path.resolve(process.cwd(), "client", "src", "i18n", "locales"),
  path.resolve(process.cwd(), "dist", "locales"),
  path.resolve(__dirname, "..", "locales"),
  path.resolve(__dirname, "locales"),
];
const LOCALE_ROOT =
  LOCALE_CANDIDATES.find((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }) ?? LOCALE_CANDIDATES[0];

type Bundle = Record<string, unknown>;
const cache = new Map<ServerLocale, Bundle>();

function loadBundle(locale: ServerLocale): Bundle {
  const cached = cache.get(locale);
  if (cached) return cached;

  const dir = path.join(LOCALE_ROOT, locale);
  const bundle: Bundle = {};
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const ns = file.replace(/\.json$/, "");
      try {
        const raw = fs.readFileSync(path.join(dir, file), "utf8");
        bundle[ns] = JSON.parse(raw);
      } catch {
        // Skip malformed locale files — never crash the server over
        // a translation issue.
      }
    }
  }
  cache.set(locale, bundle);
  return bundle;
}

export function normalizeLocale(input: string | null | undefined): ServerLocale {
  if (!input) return DEFAULT_SERVER_LOCALE;
  const base = input.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_SERVER_LOCALES as readonly string[]).includes(base)
    ? (base as ServerLocale)
    : DEFAULT_SERVER_LOCALE;
}

function lookup(bundle: Bundle, ns: string, key: string): string | undefined {
  const root = bundle[ns];
  if (!root || typeof root !== "object") return undefined;
  let cur: unknown = root;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Translate `<namespace>:<key>` for the given locale, with English
 * fallback. Supports `{{var}}` interpolation. Examples:
 *
 *   t("en", "emails", "letter.subject", { case: "ABC123" })
 *   t("es", "common", "actions.save")
 */
export function t(
  locale: string | null | undefined,
  namespace: string,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const loc = normalizeLocale(locale);
  const primary = lookup(loadBundle(loc), namespace, key);
  if (primary !== undefined) return interpolate(primary, vars);
  // English fallback so untranslated strings never render blank.
  const fallback = lookup(loadBundle(DEFAULT_SERVER_LOCALE), namespace, key);
  return interpolate(fallback ?? key, vars);
}

/** Convenience: bind locale once, return a translator. */
export function tFor(locale: string | null | undefined) {
  const loc = normalizeLocale(locale);
  return (namespace: string, key: string, vars: Record<string, string | number> = {}) =>
    t(loc, namespace, key, vars);
}
