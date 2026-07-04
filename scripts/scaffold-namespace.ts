#!/usr/bin/env tsx
/**
 * scaffold-namespace.ts
 *
 * Creates stub translation files for every non-English locale when a new
 * namespace JSON is added to `en/`.  String leaf values are prefixed with
 * "[UNTRANSLATED] " so translators can see at a glance what still needs work.
 * Non-string leaves (numbers, booleans, null, arrays) are copied verbatim.
 *
 * Usage:
 *   npm run i18n:scaffold -- <namespace>
 *   tsx scripts/scaffold-namespace.ts <namespace>
 *
 * Examples:
 *   npm run i18n:scaffold -- payments
 *   npm run i18n:scaffold -- payments.json   (extension is optional)
 *
 * The script is idempotent: if a locale file already exists it is skipped
 * (not overwritten) so existing translations are never clobbered.
 *
 * Exit codes:
 *   0 — scaffolding complete (or all files already existed)
 *   1 — argument error or unable to read the English reference file
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../client/src/i18n/locales");
const REFERENCE_LOCALE = "en";
const UNTRANSLATED_PREFIX = "[UNTRANSLATED] ";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk the English reference object and prefix every string leaf
 * with UNTRANSLATED_PREFIX.  Non-string primitives and arrays are copied as-is.
 */
function stubify(value: JsonValue): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return `${UNTRANSLATED_PREFIX}${value}`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value; // arrays are opaque i18n leaves
  // Plain object — recurse
  const result: JsonObject = {};
  for (const [k, v] of Object.entries(value as JsonObject)) {
    result[k] = stubify(v);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const [, , rawArg] = process.argv;

if (!rawArg) {
  process.stderr.write(
    "Usage: npm run i18n:scaffold -- <namespace>\n" +
      "Example: npm run i18n:scaffold -- payments\n"
  );
  process.exit(1);
}

// Allow caller to pass with or without the .json extension
const namespace = rawArg.endsWith(".json") ? rawArg : `${rawArg}.json`;

// Guard against path traversal: the namespace must be a plain filename with
// no directory separators or traversal sequences.  path.basename() would
// silently strip a leading path, so we check explicitly.
if (
  namespace.includes("/") ||
  namespace.includes("\\") ||
  namespace.includes("..")
) {
  process.stderr.write(
    `scaffold-namespace: invalid namespace name "${namespace}" — must be a plain filename with no path separators.\n`
  );
  process.exit(1);
}

if (namespace === "_meta.json") {
  process.stderr.write(
    "scaffold-namespace: _meta.json is an internal file and cannot be scaffolded.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read reference
// ---------------------------------------------------------------------------

const refPath = path.join(LOCALES_DIR, REFERENCE_LOCALE, namespace);

if (!fs.existsSync(refPath)) {
  process.stderr.write(
    `scaffold-namespace: English reference file not found: ${refPath}\n` +
      `  Create en/${namespace} first, then run this script.\n`
  );
  process.exit(1);
}

let refJson: JsonObject;
try {
  refJson = JSON.parse(fs.readFileSync(refPath, "utf8")) as JsonObject;
} catch (err) {
  process.stderr.write(
    `scaffold-namespace: failed to parse ${refPath}: ${(err as Error).message}\n`
  );
  process.exit(1);
}

const stub = stubify(refJson) as JsonObject;
const stubText = JSON.stringify(stub, null, 2) + "\n";

// ---------------------------------------------------------------------------
// Discover non-English locales
// ---------------------------------------------------------------------------

const allLocales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const targetLocales = allLocales.filter((l) => l !== REFERENCE_LOCALE);

if (targetLocales.length === 0) {
  process.stdout.write(
    "scaffold-namespace: no non-English locale directories found — nothing to do.\n"
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write stubs
// ---------------------------------------------------------------------------

let created = 0;
let skipped = 0;

for (const locale of targetLocales) {
  const destPath = path.join(LOCALES_DIR, locale, namespace);

  if (fs.existsSync(destPath)) {
    process.stdout.write(
      `scaffold-namespace: [${locale}] ${namespace} already exists — skipped.\n`
    );
    skipped++;
    continue;
  }

  fs.writeFileSync(destPath, stubText, "utf8");
  process.stdout.write(
    `scaffold-namespace: [${locale}] ${namespace} created with ${UNTRANSLATED_PREFIX.trim()} stubs.\n`
  );
  created++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(
  `\nscaffold-namespace: done — ${created} file(s) created, ${skipped} skipped.\n`
);
if (created > 0) {
  process.stdout.write(
    `  String values are prefixed with "${UNTRANSLATED_PREFIX.trim()}" to mark them as pending translation.\n` +
      `  Run \`npm run check:i18n\` to verify all locales are in sync.\n`
  );
}
