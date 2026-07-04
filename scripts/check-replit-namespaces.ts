#!/usr/bin/env tsx
/**
 * check-replit-namespaces.ts
 *
 * Guards against the namespace list in `replit.md` drifting from the actual
 * JSON files under `client/src/i18n/locales/en/`.
 *
 * The i18n architecture bullet in replit.md contains a clause like:
 *   "currently `access`, `common`, ..., plus internal `admin`"
 *
 * This script:
 *   1. Reads every *.json file in the `en/` locale directory (excluding
 *      `_meta.json`) to build the ground-truth namespace list.
 *   2. Parses the documented namespace names from the same clause in
 *      replit.md.
 *   3. Exits non-zero if the two sets differ.
 *
 * Usage:
 *   npm run check:replit-namespaces
 *   tsx scripts/check-replit-namespaces.ts
 *
 * Exit codes:
 *   0 — documented namespace list matches the files on disk
 *   1 — mismatch detected (full diff printed to stderr)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../client/src/i18n/locales");
const REPLIT_MD = path.resolve(__dirname, "../replit.md");
const EN_DIR = path.join(LOCALES_DIR, "en");

// ---------------------------------------------------------------------------
// 1. Ground truth: files on disk
// ---------------------------------------------------------------------------

const actualNamespaces = fs
  .readdirSync(EN_DIR)
  .filter((f) => f.endsWith(".json") && f !== "_meta.json")
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

// ---------------------------------------------------------------------------
// 2. Documented list: parse from replit.md
// ---------------------------------------------------------------------------

const replitMd = fs.readFileSync(REPLIT_MD, "utf8");

/**
 * Find the line that anchors the i18n namespace list.
 * We look for the characteristic phrase that introduces the "currently" clause.
 */
const ANCHOR_RE = /namespaces auto-discovered from `en\/`/;
const anchorLine = replitMd
  .split("\n")
  .find((l) => ANCHOR_RE.test(l));

if (!anchorLine) {
  process.stderr.write(
    "check-replit-namespaces: ERROR — could not find the anchor phrase\n" +
      '  "namespaces auto-discovered from `en/`" in replit.md.\n' +
      "  The namespace list check cannot run without it.\n"
  );
  process.exit(1);
}

/**
 * Extract everything from "currently" to the end of the clause (up to the
 * next sentence that starts with a capital letter or end of string), then
 * collect all backtick-quoted names.
 */
const currentlyIdx = anchorLine.indexOf("currently ");
if (currentlyIdx === -1) {
  process.stderr.write(
    'check-replit-namespaces: ERROR — anchor line found but it lacks the "currently" keyword.\n' +
      "  Please keep the documented namespace list in the format:\n" +
      '  "currently `ns1`, `ns2`, ..., plus internal `nsN`"\n'
  );
  process.exit(1);
}

// The namespace list is terminated by the first `)` that closes the
// parenthetical clause, e.g.: "currently `a`, `b`, plus internal `c`)".
// Only extract backtick-quoted names up to that closing parenthesis.
const clauseRaw = anchorLine.slice(currentlyIdx);
const closeParenIdx = clauseRaw.indexOf(")");
const clauseText =
  closeParenIdx === -1 ? clauseRaw : clauseRaw.slice(0, closeParenIdx);

const backtickRE = /`([^`]+)`/g;
const documentedNamespaces: string[] = [];
let m: RegExpExecArray | null;
while ((m = backtickRE.exec(clauseText)) !== null) {
  documentedNamespaces.push(m[1]);
}
documentedNamespaces.sort();

// ---------------------------------------------------------------------------
// 3. Compare
// ---------------------------------------------------------------------------

const actualSet = new Set(actualNamespaces);
const documentedSet = new Set(documentedNamespaces);

const undocumented = actualNamespaces.filter((n) => !documentedSet.has(n));
const obsolete = documentedNamespaces.filter((n) => !actualSet.has(n));

if (undocumented.length === 0 && obsolete.length === 0) {
  process.stdout.write(
    `check-replit-namespaces: namespace list in replit.md matches ${actualNamespaces.length} file(s) on disk. OK.\n`
  );
  process.exit(0);
}

process.stderr.write("\n");
process.stderr.write(
  "ERROR: the namespace list in replit.md is out of sync with\n"
);
process.stderr.write(`       ${EN_DIR}\n`);
process.stderr.write("\n");

if (undocumented.length > 0) {
  process.stderr.write(
    `  UNDOCUMENTED — present on disk but missing from replit.md (${undocumented.length}):\n`
  );
  for (const n of undocumented) {
    process.stderr.write(`    + ${n}\n`);
  }
}

if (obsolete.length > 0) {
  process.stderr.write(
    `  OBSOLETE — listed in replit.md but no matching file on disk (${obsolete.length}):\n`
  );
  for (const n of obsolete) {
    process.stderr.write(`    - ${n}\n`);
  }
}

process.stderr.write("\n");
process.stderr.write(
  "To fix: update the 'currently ...' clause in the i18n architecture\n"
);
process.stderr.write(
  "bullet of replit.md so it lists every namespace name (without the\n"
);
process.stderr.write(
  ".json extension) that exists under client/src/i18n/locales/en/,\n"
);
process.stderr.write("excluding _meta.json.\n");
process.stderr.write("\n");
process.stderr.write(
  `Expected list (sorted): ${actualNamespaces.map((n) => `\`${n}\``).join(", ")}\n`
);
process.stderr.write("\n");
process.exit(1);
