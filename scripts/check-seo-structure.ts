#!/usr/bin/env tsx
/**
 * check-seo-structure.ts
 *
 * Guards against extra route or division keys in non-English seo.json files.
 *
 * The generic key-level diff in check-i18n.ts would surface these as multiple
 * extra leaf keys; this script reports them at the route/division name level so
 * the failure reason is immediately visible in CI — matching the Vitest guard in
 * server/__tests__/sitemap.test.ts.
 *
 * Usage:
 *   npm run check:seo-structure
 *   tsx scripts/check-seo-structure.ts
 *
 * Exit codes:
 *   0 — no extra route/division keys in any non-English seo.json
 *   1 — one or more extra structural keys found (details printed to stderr)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../client/src/i18n/locales");
const REFERENCE_LOCALE = "en";
const SEO_NS = "seo.json";

interface SeoBundle {
  routes?: Record<string, unknown>;
  divisions?: Record<string, unknown>;
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (!locales.includes(REFERENCE_LOCALE)) {
  process.stderr.write(
    `check-seo-structure: reference locale "${REFERENCE_LOCALE}" not found in ${LOCALES_DIR}\n`
  );
  process.exit(1);
}

const nonReferenceLocales = locales.filter((l) => l !== REFERENCE_LOCALE);

const enSeoRaw = readJson(path.join(LOCALES_DIR, REFERENCE_LOCALE, SEO_NS));

if (!enSeoRaw) {
  process.stderr.write(
    `check-seo-structure: cannot read en/${SEO_NS} — nothing to check.\n`
  );
  process.exit(1);
}

const enSeo = enSeoRaw as unknown as SeoBundle;
const enRouteKeys = new Set(Object.keys(enSeo.routes ?? {}));
const enDivisionKeys = new Set(Object.keys(enSeo.divisions ?? {}));

const errors: string[] = [];

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
    errors.push(`  [seo.json] ${locale} — extra structural keys:`);
    if (extraRoutes.length > 0) {
      errors.push(
        `    EXTRA ROUTE key(s) in ${locale} absent from en/seo.json routes:`
      );
      for (const k of extraRoutes) {
        errors.push(`      + routes.${k}`);
      }
    }
    if (extraDivisions.length > 0) {
      errors.push(
        `    EXTRA DIVISION key(s) in ${locale} absent from en/seo.json divisions:`
      );
      for (const k of extraDivisions) {
        errors.push(`      + divisions.${k}`);
      }
    }
  }
}

if (errors.length === 0) {
  process.stdout.write(
    `check-seo-structure: all ${nonReferenceLocales.length} locale(s) have no extra route/division keys in ${SEO_NS}. OK.\n`
  );
  process.exit(0);
}

process.stderr.write("\n");
process.stderr.write(
  "ERROR: seo.json structural mismatch — non-English locale(s) contain route or\n"
);
process.stderr.write(
  "       division keys that are absent from the English reference (en/seo.json).\n"
);
process.stderr.write(
  "       These extra keys indicate a locale file was edited to add route or\n"
);
process.stderr.write(
  "       division entries that do not exist in English, which breaks sitemap\n"
);
process.stderr.write("       generation and SEO metadata lookup.\n");
process.stderr.write("\n");
process.stderr.write("Extra structural keys found:\n");
for (const line of errors) {
  process.stderr.write(`${line}\n`);
}
process.stderr.write("\n");
process.stderr.write(
  "To fix: remove the extra route/division key(s) from the locale file.\n"
);
process.stderr.write(
  "        New routes/divisions must be added to en/seo.json first.\n"
);
process.stderr.write("\n");
process.exit(1);
