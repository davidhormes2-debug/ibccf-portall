#!/usr/bin/env tsx
/**
 * check-i18n.ts
 *
 * Guards against missing or extra translation keys across locales.
 *
 * English (`en`) is the reference locale.  For each namespace listed in
 * NAMESPACES the script collects every dot-notation key path from the `en`
 * file, then compares it against the same file in every other locale
 * directory.  It exits non-zero if any mismatch is found so CI catches
 * regressions before they ship as silent `defaultValue` fallbacks.
 *
 * Usage:
 *   npm run check:i18n
 *   tsx scripts/check-i18n.ts
 *
 *   npm run i18n:fix                (auto-scaffold missing namespace files AND patch
 *   tsx scripts/check-i18n.ts --fix  missing individual keys in existing files, then check)
 *
 *   npm run i18n:status             (show untranslated stub counts, always exits 0)
 *   tsx scripts/check-i18n.ts --status
 *
 *   npm run check:untranslated-strict   (hard-gate: exits 1 when any [UNTRANSLATED] stubs exist)
 *   tsx scripts/check-i18n.ts --strict
 *
 * Exit codes:
 *   0 — all locale key sets match the English reference
 *       (in --fix mode: also 0 when stubs were scaffolded for missing files)
 *       (in --status mode: always 0 — informational only)
 *       (in --strict mode: only 0 when there are also 0 untranslated stubs)
 *   1 — one or more mismatches found (a full diff is printed to stderr)
 *       (in --strict mode: also 1 when untranslated stubs are present)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../client/src/i18n/locales");

const REFERENCE_LOCALE = "en";
const UNTRANSLATED_PREFIX = "[UNTRANSLATED] ";

const FIX_MODE = process.argv.includes("--fix");
const STRICT_MODE = process.argv.includes("--strict");
const STATUS_MODE = process.argv.includes("--status");

/**
 * --namespace <ns1,ns2,...>
 *
 * When provided, skip Phases 1-3 (namespace file parity, key-level diffing,
 * and seo.json structural guard) and run ONLY Phase 4 (untranslated stub
 * check) scoped to the listed namespace file names (e.g. "emails.json").
 *
 * Combine with --strict to make the check fail when any stubs are present.
 * This is the basis for the emails-untranslated-guard CI job.
 */
const NAMESPACE_FLAG_IDX = process.argv.findIndex((a) => a === "--namespace");
const NAMESPACE_FILTER: Set<string> | null =
  NAMESPACE_FLAG_IDX !== -1 && process.argv[NAMESPACE_FLAG_IDX + 1]
    ? new Set(
        process.argv[NAMESPACE_FLAG_IDX + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => (s.endsWith(".json") ? s : `${s}.json`))
      )
    : null;

/**
 * Auto-discover every namespace (JSON file) present in the English reference
 * locale directory, excluding internal meta files.  Any file added to `en/`
 * is automatically checked — no manual list maintenance required.
 */
const NAMESPACES = fs
  .readdirSync(path.join(LOCALES_DIR, REFERENCE_LOCALE))
  .filter((f) => f.endsWith(".json") && f !== "_meta.json")
  .sort();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Recursively collect every leaf key path in dot-notation.
 * Arrays are treated as leaves (their items are not descended into) because
 * i18n arrays are opaque translation values, not key containers.
 */
function flatKeys(obj: JsonObject, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return flatKeys(v as JsonObject, full);
    }
    return [full];
  });
}

/**
 * Count the number of leaf string values that still carry the untranslated
 * stub prefix introduced by scaffold-namespace.ts.
 */
function countUntranslated(obj: JsonObject): number {
  let count = 0;
  for (const v of Object.values(obj)) {
    if (typeof v === "string") {
      if (v.startsWith(UNTRANSLATED_PREFIX)) count++;
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      count += countUntranslated(v as JsonObject);
    }
  }
  return count;
}

function readJson(filePath: string): JsonObject | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}

/**
 * Recursively walk `value` and prefix every string leaf with
 * UNTRANSLATED_PREFIX.  Non-string primitives and arrays are copied as-is.
 * Mirrors the stubify() logic in scaffold-namespace.ts.
 */
function stubify(value: JsonValue): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return `${UNTRANSLATED_PREFIX}${value}`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value;
  const result: JsonObject = {};
  for (const [k, v] of Object.entries(value as JsonObject)) {
    result[k] = stubify(v);
  }
  return result;
}

/**
 * Scaffold a stub translation file for `namespace` in `locale` using the
 * English reference as a template.  Returns true if the file was created,
 * false if it already existed (idempotent).
 */
function scaffoldFile(namespace: string, locale: string, refJson: JsonObject): boolean {
  const destPath = path.join(LOCALES_DIR, locale, namespace);
  if (fs.existsSync(destPath)) {
    return false;
  }
  const stub = stubify(refJson) as JsonObject;
  fs.writeFileSync(destPath, JSON.stringify(stub, null, 2) + "\n", "utf8");
  return true;
}

/**
 * Traverse a nested JsonObject following a dot-notation path and return the
 * leaf value, or undefined if any segment is missing or non-traversable.
 */
function deepGet(obj: JsonObject, dotPath: string): JsonValue | undefined {
  const parts = dotPath.split(".");
  let cur: JsonValue = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as JsonObject)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * Deep-set a value in a nested JsonObject following a dot-notation path.
 * Intermediate objects are created as needed.
 */
function deepSet(obj: JsonObject, dotPath: string, value: JsonValue): void {
  const parts = dotPath.split(".");
  let cur: JsonObject = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      cur[part] === undefined ||
      cur[part] === null ||
      typeof cur[part] !== "object" ||
      Array.isArray(cur[part])
    ) {
      cur[part] = {};
    }
    cur = cur[part] as JsonObject;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Deep-delete a leaf key from a nested JsonObject following a dot-notation
 * path.  Does nothing if the path does not exist.
 */
function deepDelete(obj: JsonObject, dotPath: string): void {
  const parts = dotPath.split(".");
  let cur: JsonObject = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      !cur[part] ||
      typeof cur[part] !== "object" ||
      Array.isArray(cur[part])
    )
      return;
    cur = cur[part] as JsonObject;
  }
  delete cur[parts[parts.length - 1]];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const nonReferenceLocales = locales.filter((l) => l !== REFERENCE_LOCALE);

if (!locales.includes(REFERENCE_LOCALE)) {
  process.stderr.write(
    `check-i18n: reference locale "${REFERENCE_LOCALE}" not found in ${LOCALES_DIR}\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --status mode: scan untranslated stubs only; always exits 0
// ---------------------------------------------------------------------------

if (STATUS_MODE) {
  type UntranslatedRow = { locale: string; ns: string; count: number };
  const rows: UntranslatedRow[] = [];
  let total = 0;

  for (const ns of NAMESPACES) {
    for (const locale of nonReferenceLocales) {
      const localePath = path.join(LOCALES_DIR, locale, ns);
      const localeJson = readJson(localePath);
      if (!localeJson) continue;
      const count = countUntranslated(localeJson);
      if (count > 0) {
        rows.push({ locale, ns, count });
        total += count;
      }
    }
  }

  if (rows.length === 0) {
    process.stdout.write(
      "i18n:status: no untranslated stubs found across all locales.\n"
    );
    process.exit(0);
  }

  rows.sort((a, b) => a.locale.localeCompare(b.locale) || a.ns.localeCompare(b.ns));

  const colLocale = Math.max("Locale".length, ...rows.map((r) => r.locale.length));
  const colNs = Math.max("Namespace".length, ...rows.map((r) => r.ns.length));
  const colCount = Math.max(
    "Untranslated".length,
    ...rows.map((r) => String(r.count).length)
  );

  const sep = `${"─".repeat(colLocale + 2)}┼${"─".repeat(colNs + 2)}┼${"─".repeat(colCount + 2)}`;
  const header =
    ` ${"Locale".padEnd(colLocale)} │ ${"Namespace".padEnd(colNs)} │ ${"Untranslated".padStart(colCount)} `;

  process.stdout.write("\n");
  process.stdout.write("i18n:status — untranslated stub summary\n");
  process.stdout.write(
    `  Scanned ${nonReferenceLocales.length} locale(s) × ${NAMESPACES.length} namespace(s)\n`
  );
  process.stdout.write("\n");
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${sep}\n`);

  let lastLocale = "";
  for (const { locale, ns, count } of rows) {
    if (locale !== lastLocale && lastLocale !== "") {
      process.stdout.write(`${sep}\n`);
    }
    lastLocale = locale;
    process.stdout.write(
      ` ${locale.padEnd(colLocale)} │ ${ns.padEnd(colNs)} │ ${String(count).padStart(colCount)} \n`
    );
  }

  process.stdout.write(`${sep}\n`);
  process.stdout.write(
    ` ${"TOTAL".padEnd(colLocale)} │ ${" ".repeat(colNs)} │ ${String(total).padStart(colCount)} \n`
  );
  process.stdout.write("\n");
  process.stdout.write(
    "  Replace each \"[UNTRANSLATED] <en value>\" with the translated string,\n"
  );
  process.stdout.write(
    "  then re-run npm run check:i18n to verify key-set parity.\n"
  );
  process.stdout.write("\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --namespace mode: focused untranslated-stub check for specific namespaces
//
// Skips Phases 1-3 (key-set parity, seo structural guard) entirely and runs
// ONLY the Phase-4 stub scan scoped to the listed namespace(s).  Designed for
// high-churn namespaces (emails, portal, …) that must never ship [UNTRANSLATED]
// stubs even while the general translation backlog is still being cleared.
//
// Exit codes mirror --strict:
//   0 — no stubs found in the listed namespace(s)
//   1 — one or more stubs found  (requires --strict, otherwise warns + exits 0)
// ---------------------------------------------------------------------------

if (NAMESPACE_FILTER !== null) {
  // Validate that every requested namespace actually exists in en/
  const unknownNs = [...NAMESPACE_FILTER].filter((ns) => !NAMESPACES.includes(ns));
  if (unknownNs.length > 0) {
    process.stderr.write(
      `check-i18n --namespace: unknown namespace(s) — not found in en/:\n`
    );
    for (const ns of unknownNs) {
      process.stderr.write(`  ${ns}\n`);
    }
    process.stderr.write(
      `\nAvailable namespaces: ${NAMESPACES.join(", ")}\n`
    );
    process.exit(1);
  }

  const filteredNs = NAMESPACES.filter((ns) => NAMESPACE_FILTER.has(ns));
  const label = filteredNs.map((ns) => ns.replace(/\.json$/, "")).join(", ");

  process.stdout.write(
    `check-i18n --namespace: scanning namespace(s) [${label}] for [UNTRANSLATED] stubs\n`
  );
  process.stdout.write(
    `  Locales: ${nonReferenceLocales.join(", ")}\n\n`
  );

  type StubHit = { locale: string; ns: string; key: string };

  /**
   * Recursively collect every leaf key that still carries the [UNTRANSLATED]
   * prefix, returning them as dot-notation paths.
   */
  function collectStubKeys(obj: JsonObject, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([k, v]) => {
      const full = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") {
        return v.startsWith(UNTRANSLATED_PREFIX) ? [full] : [];
      }
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        return collectStubKeys(v as JsonObject, full);
      }
      return [];
    });
  }

  const hits: StubHit[] = [];

  for (const ns of filteredNs) {
    for (const locale of nonReferenceLocales) {
      const localePath = path.join(LOCALES_DIR, locale, ns);
      const localeJson = readJson(localePath);
      if (!localeJson) {
        process.stderr.write(
          `check-i18n --namespace: WARNING — ${locale}/${ns} is missing; run npm run i18n:fix to scaffold it.\n`
        );
        continue;
      }
      const stubKeys = collectStubKeys(localeJson);
      for (const key of stubKeys) {
        hits.push({ locale, ns, key });
      }
    }
  }

  if (hits.length === 0) {
    process.stdout.write(
      `check-i18n --namespace: [${label}] — no [UNTRANSLATED] stubs found. OK.\n`
    );
    process.exit(0);
  }

  // Group hits by locale → namespace for readable output
  const grouped = new Map<string, Map<string, string[]>>();
  for (const { locale, ns, key } of hits) {
    if (!grouped.has(locale)) grouped.set(locale, new Map());
    const nsMap = grouped.get(locale)!;
    if (!nsMap.has(ns)) nsMap.set(ns, []);
    nsMap.get(ns)!.push(key);
  }

  process.stderr.write("\n");
  process.stderr.write(
    `⚠  [UNTRANSLATED] STUBS DETECTED in namespace(s): ${label}\n`
  );
  process.stderr.write(
    "   These keys must be translated before they reach users.\n\n"
  );
  for (const [locale, nsMap] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const [ns, keys] of [...nsMap].sort((a, b) => a[0].localeCompare(b[0]))) {
      process.stderr.write(
        `  ${locale}/${ns} — ${keys.length} untranslated key(s):\n`
      );
      for (const key of keys) {
        process.stderr.write(`      ${key}\n`);
      }
    }
  }
  process.stderr.write("\n");
  process.stderr.write(
    `   To fix: open client/src/i18n/locales/<locale>/${filteredNs[0]} (and others listed above)\n`
  );
  process.stderr.write(
    `   and replace each "[UNTRANSLATED] <en value>" with the correct translation.\n`
  );
  process.stderr.write(`   Then re-run: npm run check:untranslated-emails\n`);
  process.stderr.write("\n");

  // Write GitHub Actions step summary when available
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    const mdLines: string[] = [];
    mdLines.push(`## ⚠ Untranslated Stubs in \`${label}\` namespace(s)`);
    mdLines.push("");
    mdLines.push(
      `${hits.length} stub value(s) in the \`${label}\` namespace(s) still carry the \`[UNTRANSLATED]\` prefix and **must be translated before merging**.`
    );
    mdLines.push("");
    for (const [locale, nsMap] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const [ns, keys] of [...nsMap].sort((a, b) => a[0].localeCompare(b[0]))) {
        mdLines.push(`### \`${locale}/${ns}\` — ${keys.length} key(s)`);
        mdLines.push("");
        for (const key of keys) {
          mdLines.push(`- \`${key}\``);
        }
        mdLines.push("");
      }
    }
    mdLines.push(
      `> **Fix:** replace each \`[UNTRANSLATED] <en value>\` with the correct translation, then re-run \`npm run check:untranslated-emails\`.`
    );
    mdLines.push("");
    fs.appendFileSync(stepSummaryPath, mdLines.join("\n") + "\n", "utf8");
  }

  if (STRICT_MODE) {
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Phase 1: Namespace-file set parity check
// Verify every non-English locale has *exactly* the same set of namespace
// files as `en/` (no missing, no extra) before descending into key-level
// diffing.  Catching a missing file here produces one focused error rather
// than a flood of per-key "MISSING" lines.
//
// In --fix mode, missing files are auto-scaffolded instead of reported as
// errors so the developer can get back to a green state in one step.
// ---------------------------------------------------------------------------

const refNamespaceSet = new Set(NAMESPACES);

const nsSetErrors: string[] = [];
const scaffolded: string[] = [];

for (const locale of nonReferenceLocales) {
  const localeFiles = fs
    .readdirSync(path.join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith(".json") && f !== "_meta.json")
    .sort();
  const localeNamespaceSet = new Set(localeFiles);

  const missing = NAMESPACES.filter((ns) => !localeNamespaceSet.has(ns));
  const extra = localeFiles.filter((f) => !refNamespaceSet.has(f));

  for (const ns of missing) {
    if (FIX_MODE) {
      const refPath = path.join(LOCALES_DIR, REFERENCE_LOCALE, ns);
      const refJson = readJson(refPath);
      if (refJson) {
        scaffoldFile(ns, locale, refJson);
        scaffolded.push(`  ${locale}/${ns} — created with ${UNTRANSLATED_PREFIX.trim()} stubs`);
        process.stdout.write(
          `check-i18n --fix: scaffolded ${locale}/${ns}\n`
        );
      } else {
        nsSetErrors.push(`  ${locale}/ is missing namespace file: ${ns} (and en reference is unreadable)`);
      }
    } else {
      nsSetErrors.push(`  ${locale}/ is missing namespace file: ${ns}`);
    }
  }
  for (const ns of extra) {
    nsSetErrors.push(`  ${locale}/ has extra namespace file not in en/: ${ns}`);
  }
}

if (nsSetErrors.length > 0) {
  process.stderr.write("\n");
  process.stderr.write(
    "ERROR: one or more locale directories do not match the en/ namespace file set.\n"
  );
  process.stderr.write(
    "       Every non-English locale must contain exactly the same .json files as en/.\n"
  );
  process.stderr.write("\n");
  process.stderr.write("Namespace file mismatches:\n");
  for (const line of nsSetErrors) {
    process.stderr.write(`${line}\n`);
  }
  process.stderr.write("\n");
  process.stderr.write(
    "To fix missing files automatically, run: npm run i18n:fix\n"
  );
  process.stderr.write(
    "To fix manually: add missing files (and translate their keys) or remove extra files.\n"
  );
  process.stderr.write("\n");
  process.exit(1);
}

if (scaffolded.length > 0) {
  process.stdout.write(
    `\ncheck-i18n --fix: scaffolded ${scaffolded.length} missing file(s):\n`
  );
  for (const line of scaffolded) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    "\n  String values are prefixed with \"" +
      UNTRANSLATED_PREFIX.trim() +
      "\" to mark them as pending translation.\n"
  );
  process.stdout.write(
    "  Commit the new files and replace stub strings with real translations.\n\n"
  );
}

process.stdout.write(
  `check-i18n: all ${nonReferenceLocales.length} locale(s) have the same namespace files as en/. OK.\n`
);

// ---------------------------------------------------------------------------
// Phase 2: Key-level diffing (and key-level patching in --fix mode)
// ---------------------------------------------------------------------------

let totalMismatches = 0;
const report: string[] = [];
// Tracks per-file patch summaries emitted in --fix mode.
const patchedFiles: string[] = [];

for (const ns of NAMESPACES) {
  const refPath = path.join(LOCALES_DIR, REFERENCE_LOCALE, ns);
  const refJson = readJson(refPath);

  if (!refJson) {
    report.push(
      `  [${ns}] ERROR: cannot read reference file at ${refPath}`
    );
    totalMismatches++;
    continue;
  }

  const refKeys = new Set(flatKeys(refJson));

  let nsHasMismatch = false;

  for (const locale of nonReferenceLocales) {
    const localePath = path.join(LOCALES_DIR, locale, ns);
    const localeJson = readJson(localePath);

    if (!localeJson) {
      report.push(`  [${ns}] ${locale}: MISSING FILE — ${localePath}`);
      totalMismatches++;
      nsHasMismatch = true;
      continue;
    }

    const localeKeys = new Set(flatKeys(localeJson));

    const missing = [...refKeys].filter((k) => !localeKeys.has(k));
    const extra = [...localeKeys].filter((k) => !refKeys.has(k));

    if (missing.length === 0 && extra.length === 0) {
      continue;
    }

    if (FIX_MODE) {
      // ── Prune extra keys FIRST to eliminate any path collisions ──────────
      // e.g. locale has `a: "text"` while en has `a: { b: "value" }`.
      // Deleting the extra leaf `a` before deepSet avoids clobbering the
      // existing translation with an intermediate empty object.
      for (const k of extra) {
        deepDelete(localeJson, k);
      }

      // ── Inject missing keys as [UNTRANSLATED] stubs ──────────────────────
      // Only adds leaves that are absent; every other key is untouched.
      for (const k of missing) {
        const refVal = deepGet(refJson, k);
        if (refVal !== undefined) {
          deepSet(localeJson, k, stubify(refVal));
        }
      }

      fs.writeFileSync(localePath, JSON.stringify(localeJson, null, 2) + "\n", "utf8");

      const parts: string[] = [];
      if (missing.length > 0)
        parts.push(`+${missing.length} key(s) added`);
      if (extra.length > 0)
        parts.push(`-${extra.length} key(s) pruned`);
      process.stdout.write(
        `check-i18n --fix: patched ${locale}/${ns} — ${parts.join(", ")}\n`
      );
      patchedFiles.push(`  ${locale}/${ns} — ${parts.join(", ")}`);

      // ── Re-validate: re-read the written file and confirm no diff remains ─
      const reread = readJson(localePath);
      if (reread) {
        const rereadKeys = new Set(flatKeys(reread));
        const stillMissing = [...refKeys].filter((k) => !rereadKeys.has(k));
        const stillExtra = [...rereadKeys].filter((k) => !refKeys.has(k));
        if (stillMissing.length > 0 || stillExtra.length > 0) {
          nsHasMismatch = true;
          totalMismatches++;
          report.push(`  [${ns}] ${locale} (post-fix validation failed):`);
          if (stillMissing.length > 0) {
            report.push(
              `    STILL MISSING ${stillMissing.length} key(s) after --fix:`
            );
            for (const k of stillMissing) report.push(`      - ${k}`);
          }
          if (stillExtra.length > 0) {
            report.push(
              `    STILL EXTRA ${stillExtra.length} key(s) after --fix:`
            );
            for (const k of stillExtra) report.push(`      + ${k}`);
          }
        }
      }

      continue;
    }

    nsHasMismatch = true;
    totalMismatches++;

    report.push(`  [${ns}] ${locale}:`);
    if (missing.length > 0) {
      report.push(
        `    MISSING ${missing.length} key(s) (present in en, absent in ${locale}):`
      );
      for (const k of missing) {
        report.push(`      - ${k}`);
      }
    }
    if (extra.length > 0) {
      report.push(
        `    EXTRA ${extra.length} key(s) (absent in en, present in ${locale}):`
      );
      for (const k of extra) {
        report.push(`      + ${k}`);
      }
    }
  }

  if (!FIX_MODE && !nsHasMismatch) {
    process.stdout.write(
      `check-i18n: [${ns}] all ${nonReferenceLocales.length} locale(s) match en. OK.\n`
    );
  }
  if (FIX_MODE && !nsHasMismatch) {
    process.stdout.write(
      `check-i18n: [${ns}] all ${nonReferenceLocales.length} locale(s) match en. OK.\n`
    );
  }
}

if (FIX_MODE && patchedFiles.length > 0) {
  process.stdout.write(
    `\ncheck-i18n --fix: patched ${patchedFiles.length} file(s) with individual key changes:\n`
  );
  for (const line of patchedFiles) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    "\n  Missing keys were added with \"" +
      UNTRANSLATED_PREFIX.trim() +
      "\" stubs; extra keys were removed.\n"
  );
  process.stdout.write(
    "  Commit the patched files and replace stub strings with real translations.\n\n"
  );
}

// ---------------------------------------------------------------------------
// Phase 3: seo.json structural guard
// Verify that no non-English seo.json introduces route or division keys that
// are absent from the English reference.  The generic flatKeys() diff above
// would surface these as multiple extra leaf keys; this phase reports them at
// the route/division name level so the message mirrors the Vitest guard in
// server/__tests__/sitemap.test.ts.
// ---------------------------------------------------------------------------

const SEO_NS = "seo.json";

interface SeoBundle {
  routes?: Record<string, unknown>;
  divisions?: Record<string, unknown>;
}

const enSeoRaw = readJson(path.join(LOCALES_DIR, REFERENCE_LOCALE, SEO_NS));

if (enSeoRaw) {
  const enSeo = enSeoRaw as unknown as SeoBundle;
  const enRouteKeys = new Set(Object.keys(enSeo.routes ?? {}));
  const enDivisionKeys = new Set(Object.keys(enSeo.divisions ?? {}));

  for (const locale of nonReferenceLocales) {
    const localeSeoRaw = readJson(path.join(LOCALES_DIR, locale, SEO_NS));
    if (!localeSeoRaw) {
      continue;
    }
    const localeSeo = localeSeoRaw as unknown as SeoBundle;

    const extraRoutes = Object.keys(localeSeo.routes ?? {}).filter(
      (k) => !enRouteKeys.has(k)
    );
    const extraDivisions = Object.keys(localeSeo.divisions ?? {}).filter(
      (k) => !enDivisionKeys.has(k)
    );

    if (extraRoutes.length > 0 || extraDivisions.length > 0) {
      totalMismatches++;
      report.push(`  [${SEO_NS}] ${locale} — extra structural keys:`);
      if (extraRoutes.length > 0) {
        report.push(
          `    EXTRA ROUTE key(s) in ${locale} absent from en/seo.json routes:`
        );
        for (const k of extraRoutes) {
          report.push(`      + routes.${k}`);
        }
      }
      if (extraDivisions.length > 0) {
        report.push(
          `    EXTRA DIVISION key(s) in ${locale} absent from en/seo.json divisions:`
        );
        for (const k of extraDivisions) {
          report.push(`      + divisions.${k}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 4: Untranslated stub check
// Count leaf string values that still carry the "[UNTRANSLATED] " prefix
// introduced by scaffold-namespace.ts.
//
// Default (no flag): informational only — prints the backlog table but exits 0
// so translators can see the count without blocking CI.
//
// --strict mode: exits 1 when any stubs remain, turning this into a hard gate
// suitable for use as a required branch-protection check once the translation
// backlog has been cleared.
// ---------------------------------------------------------------------------

type UntranslatedRow = { locale: string; ns: string; count: number };
const untranslatedRows: UntranslatedRow[] = [];
let totalUntranslated = 0;

for (const ns of NAMESPACES) {
  for (const locale of nonReferenceLocales) {
    const localePath = path.join(LOCALES_DIR, locale, ns);
    const localeJson = readJson(localePath);
    if (!localeJson) continue;
    const count = countUntranslated(localeJson);
    if (count > 0) {
      untranslatedRows.push({ locale, ns, count });
      totalUntranslated += count;
    }
  }
}

if (untranslatedRows.length > 0) {
  const colLocale = Math.max(
    "Locale".length,
    ...untranslatedRows.map((r) => r.locale.length)
  );
  const colNs = Math.max(
    "Namespace".length,
    ...untranslatedRows.map((r) => r.ns.length)
  );
  const colCount = Math.max(
    "Untranslated".length,
    ...untranslatedRows.map((r) => String(r.count).length)
  );

  const sep = `${"─".repeat(colLocale + 2)}┼${"─".repeat(colNs + 2)}┼${"─".repeat(colCount + 2)}`;
  const header =
    ` ${"Locale".padEnd(colLocale)} │ ${"Namespace".padEnd(colNs)} │ ${"Untranslated".padStart(colCount)} `;

  process.stdout.write("\n");
  process.stdout.write(
    "⚠  UNTRANSLATED STUBS DETECTED — values prefixed with \"[UNTRANSLATED] \"\n"
  );
  process.stdout.write(
    "   These keys have been scaffolded but not yet translated.\n"
  );
  process.stdout.write("\n");
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${sep}\n`);
  for (const { locale, ns, count } of untranslatedRows) {
    process.stdout.write(
      ` ${locale.padEnd(colLocale)} │ ${ns.padEnd(colNs)} │ ${String(count).padStart(colCount)} \n`
    );
  }
  process.stdout.write(`${sep}\n`);
  process.stdout.write(
    ` ${"TOTAL".padEnd(colLocale)} │ ${" ".repeat(colNs)} │ ${String(totalUntranslated).padStart(colCount)} \n`
  );
  process.stdout.write("\n");
  process.stdout.write(
    "   To resolve: replace each \"[UNTRANSLATED] <en value>\" with the\n"
  );
  process.stdout.write(
    "   translated string for that locale, then re-run check:i18n.\n"
  );
  process.stdout.write("\n");

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    const mdLines: string[] = [];
    mdLines.push("## ⚠ Untranslated Stubs Backlog");
    mdLines.push("");
    mdLines.push(
      `${totalUntranslated} stub value(s) across ${untranslatedRows.length} locale/namespace combination(s) still carry the \`[UNTRANSLATED]\` prefix.`
    );
    mdLines.push("");
    mdLines.push("| Locale | Namespace | Untranslated |");
    mdLines.push("|--------|-----------|-------------:|");
    for (const { locale, ns, count } of untranslatedRows) {
      mdLines.push(`| \`${locale}\` | \`${ns}\` | ${count} |`);
    }
    mdLines.push(`| **TOTAL** | | **${totalUntranslated}** |`);
    mdLines.push("");
    mdLines.push(
      "> Replace each `[UNTRANSLATED] <en value>` with the translated string for that locale, then re-run `check:i18n`."
    );
    mdLines.push("");
    fs.appendFileSync(stepSummaryPath, mdLines.join("\n") + "\n", "utf8");
  }

  if (STRICT_MODE) {
    process.stderr.write(
      "ERROR (--strict): untranslated stubs are present. All stubs must be\n"
    );
    process.stderr.write(
      "       replaced with real translations before this check can pass.\n"
    );
    process.stderr.write("\n");
    process.exit(1);
  }
} else {
  process.stdout.write(
    "check-i18n: no untranslated stubs found across all locales. OK.\n"
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (totalMismatches === 0) {
  if (scaffolded.length > 0 && patchedFiles.length > 0) {
    process.stdout.write(
      "check-i18n: namespace files scaffolded, individual keys patched, and all locale key sets match the English reference. OK.\n"
    );
  } else if (scaffolded.length > 0) {
    process.stdout.write(
      "check-i18n: stubs scaffolded and all locale key sets match the English reference. OK.\n"
    );
  } else if (patchedFiles.length > 0) {
    process.stdout.write(
      "check-i18n: individual keys patched and all locale key sets match the English reference. OK.\n"
    );
  } else {
    process.stdout.write(
      "check-i18n: all locale key sets match the English reference. OK.\n"
    );
  }
  process.exit(0);
}

process.stderr.write("\n");
process.stderr.write(
  "ERROR: i18n key mismatches detected. All locale JSON files must have\n"
);
process.stderr.write(
  "       exactly the same key set as the English (en) reference.\n"
);
process.stderr.write("\n");
process.stderr.write("Mismatches:\n");
for (const line of report) {
  process.stderr.write(`${line}\n`);
}
process.stderr.write("\n");
process.stderr.write(
  "To fix automatically, run: npm run i18n:fix\n"
);
process.stderr.write(
  "To fix manually: add the missing keys to the locale file (translate the value)\n"
);
process.stderr.write(
  "                 or remove the extra keys if they are no longer used in en.\n"
);
process.stderr.write("\n");
process.exit(1);
