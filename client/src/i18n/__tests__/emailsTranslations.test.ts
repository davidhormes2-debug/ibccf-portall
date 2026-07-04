/**
 * Emails namespace stub guard.
 *
 * Why this test exists:
 *   `npm run check:untranslated-emails` catches [UNTRANSLATED] stubs at the
 *   script level, but it only runs at push time. This Vitest test runs in
 *   `npm test` so developers see per-key failures immediately in the dev loop,
 *   before they even push. Every leaf value in every non-English emails.json
 *   is asserted to not contain the "[UNTRANSLATED]" sentinel — meaning a real
 *   translation must have been supplied before the key can ship.
 *
 * Locales covered: de, es, fr, pt, zh (English is the source; it never
 * contains stubs).
 */

import { describe, expect, it } from "vitest";

const STUB_MARKER = "[UNTRANSLATED]";

const emailsFiles = import.meta.glob<Record<string, unknown>>(
  "../locales/*/emails.json",
  { eager: true, import: "default" },
);

type LocaleMap = Record<string, Record<string, unknown>>;
const localeEmails: LocaleMap = {};

for (const [path, mod] of Object.entries(emailsFiles)) {
  const match = path.match(/\.\.\/locales\/([^/]+)\/emails\.json$/);
  if (!match) continue;
  const [, code] = match;
  localeEmails[code] = mod as Record<string, unknown>;
}

const NON_ENGLISH_LOCALES = Object.keys(localeEmails)
  .filter((code) => code !== "en")
  .sort();

interface LeafEntry {
  keyPath: string;
  value: string;
}

function flattenLeaves(
  value: unknown,
  keyPath: string,
  out: LeafEntry[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      flattenLeaves(item, `${keyPath}[${idx}]`, out);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = keyPath ? `${keyPath}.${k}` : k;
      flattenLeaves(v, next, out);
    }
    return;
  }
  if (typeof value === "string") {
    out.push({ keyPath, value });
  }
}

describe("emails namespace — no [UNTRANSLATED] stubs in any locale", () => {
  it("all expected non-English locales have an emails.json bundle", () => {
    const expected = ["de", "es", "fr", "pt", "zh"];
    const missing = expected.filter((code) => !localeEmails[code]);
    expect(
      missing,
      `Expected emails.json for every shipped locale. Missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  for (const locale of NON_ENGLISH_LOCALES) {
    it(`locale "${locale}" — every key resolves to a real translation (no stub marker)`, () => {
      const bundle = localeEmails[locale];
      const leaves: LeafEntry[] = [];
      flattenLeaves(bundle, "", leaves);

      const stubbed = leaves
        .filter(({ value }) => value.includes(STUB_MARKER))
        .map(({ keyPath }) => keyPath);

      expect(
        stubbed,
        `Locale "${locale}" still has [UNTRANSLATED] stubs in emails.json.\n` +
          `Stub keys (${stubbed.length}):\n  - ${stubbed.join("\n  - ")}\n\n` +
          `Run \`npm run i18n:fix\` to scaffold stubs, then provide real translations.`,
      ).toEqual([]);
    });
  }
});
