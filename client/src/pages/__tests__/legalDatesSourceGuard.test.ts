// @vitest-environment node
//
// Guard against re-introducing hardcoded ISO date literals in the legal pages.
//
// The last-updated dates on PrivacyPolicyPage and TermsOfUsePage are driven by
// the LEGAL_LAST_UPDATED constant in `client/src/lib/legalDates.ts`. A future
// editor might accidentally inline the date string directly (e.g. as
// `new Date("2026-06-01")` or a bare `"2026-06-01"` literal passed to
// formatDate, or embedded as visible JSX text like `<p>June 1, 2026</p>`).
// This test catches that regression by asserting:
//
//   1. Both files import from `@/lib/legalDates` or `../lib/legalDates`.
//   2. Neither file passes an ISO-8601 date literal directly to a `formatDate`
//      call (the pattern that previously hardcoded the date on-screen).
//   3. Neither file contains a bare ISO-8601 date string (YYYY-MM-DD) in JSX
//      body text (i.e. outside import statements and variable declarations).
//   4. Neither file contains an English month-name date (e.g. "June 1, 2026")
//      in JSX body text (i.e. outside import statements and variable
//      declarations).
//
// A companion describe block ("i18n locale files") runs the same ISO-8601 and
// month-name checks against every supported locale's translation files for
// every namespace discovered in the English reference directory (all .json
// files in en/, excluding _meta.json).  This means a hardcoded date in any
// namespace — not just the original five (portal, landing, privacy, terms,
// legal) — causes a loud failure directing the editor to update
// LEGAL_LAST_UPDATED in legalDates.ts and let the React page interpolate the
// formatted date at render time.
//
// If this test fails, update the legal page to use LEGAL_LAST_UPDATED from
// `client/src/lib/legalDates.ts` instead of an inline date string.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const PAGES_DIR = path.resolve(__dirname, "..");

const LEGAL_PAGES: { label: string; file: string }[] = [
  { label: "PrivacyPolicyPage.tsx", file: path.join(PAGES_DIR, "PrivacyPolicyPage.tsx") },
  { label: "TermsOfUsePage.tsx", file: path.join(PAGES_DIR, "TermsOfUsePage.tsx") },
];

// Matches a string literal containing an ISO-8601 date passed directly as an
// argument, e.g. formatDate("2026-06-01") or new Date("2026-01-15").
// We want to ensure the constant is used instead.
const HARDCODED_DATE_IN_CALL = /(?:formatDate|formatDateTime|new Date)\(\s*["'`]\d{4}-\d{2}-\d{2}["'`]/;

// The import must reference legalDates (alias or relative path).
const LEGAL_DATES_IMPORT = /from\s+["'](?:@\/lib\/legalDates|.*legalDates)["']/;

// Matches a bare ISO-8601 date string in JSX body text, e.g. >2026-06-01< or
// a text node containing "2026-06-01".
const BARE_ISO_DATE_IN_JSX = /\d{4}-\d{2}-\d{2}/;

// Matches an English month-name date pattern in JSX body text,
// e.g. "June 1, 2026" or "January 15, 2026".
const MONTH_NAME_DATE_IN_JSX =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;

/**
 * Remove lines that are import statements or top-level variable/constant
 * declarations so that the date-pattern checks only fire on JSX body text.
 * This avoids false positives from e.g. `const LEGAL_LAST_UPDATED = "2026-06-01"`
 * in legalDates.ts or re-exported constants imported here.
 */
function stripDeclarationLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith("import ") &&
        !trimmed.startsWith("const ") &&
        !trimmed.startsWith("let ") &&
        !trimmed.startsWith("var ") &&
        !trimmed.startsWith("export const ") &&
        !trimmed.startsWith("export let ") &&
        !trimmed.startsWith("export var ")
      );
    })
    .join("\n");
}

describe("Legal pages source guard — no hardcoded date literals", () => {
  for (const { label, file } of LEGAL_PAGES) {
    describe(label, () => {
      let source: string;

      it("the source file exists and is readable", () => {
        expect(() => {
          source = fs.readFileSync(file, "utf8");
        }).not.toThrow();
        expect(source.length).toBeGreaterThan(0);
      });

      it("imports LEGAL_LAST_UPDATED from legalDates.ts", () => {
        source = fs.readFileSync(file, "utf8");
        expect(
          LEGAL_DATES_IMPORT.test(source),
          `${label} must import from legalDates.ts (e.g. \`import { LEGAL_LAST_UPDATED } from "@/lib/legalDates"\`). ` +
            `Do not inline the date string — change it in legalDates.ts instead.`,
        ).toBe(true);
      });

      it("does not pass a hardcoded ISO date literal to formatDate / new Date", () => {
        source = fs.readFileSync(file, "utf8");
        expect(
          HARDCODED_DATE_IN_CALL.test(source),
          `${label} contains a hardcoded ISO date literal passed directly to formatDate(), ` +
            `formatDateTime(), or new Date(). Use the LEGAL_LAST_UPDATED constant from ` +
            `"@/lib/legalDates" instead so the date is maintained in a single place.`,
        ).toBe(false);
      });

      it("does not embed a bare ISO-8601 date string in JSX body text", () => {
        source = fs.readFileSync(file, "utf8");
        const jsxBody = stripDeclarationLines(source);
        expect(
          BARE_ISO_DATE_IN_JSX.test(jsxBody),
          `${label} contains a bare ISO-8601 date string (YYYY-MM-DD) in JSX body text. ` +
            `Do not hardcode the date inline — use the LEGAL_LAST_UPDATED constant from ` +
            `"@/lib/legalDates" and pass it through formatDate() instead.`,
        ).toBe(false);
      });

      it("does not embed an English month-name date in JSX body text", () => {
        source = fs.readFileSync(file, "utf8");
        const jsxBody = stripDeclarationLines(source);
        expect(
          MONTH_NAME_DATE_IN_JSX.test(jsxBody),
          `${label} contains an English month-name date (e.g. "June 1, 2026") in JSX body text. ` +
            `Do not hardcode the date inline — use the LEGAL_LAST_UPDATED constant from ` +
            `"@/lib/legalDates" and pass it through formatDate() instead.`,
        ).toBe(false);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// i18n locale files — no hardcoded date literals in translated legal copy
// ---------------------------------------------------------------------------
//
// Translated strings live in JSON files under client/src/i18n/locales/<code>/.
// A future translator could embed the last-updated date directly in a string
// value (e.g. "Last updated: June 1, 2026") which would then be rendered to
// users in their language, silently bypassing the JSX-level guard above.
//
// This describe block scans every supported locale's legal-related namespaces
// (portal.json, landing.json, privacy.json, terms.json, legal.json) for:
//   • ISO-8601 date strings  (YYYY-MM-DD)
//   • English month-name date strings  (e.g. "June 1, 2026")
// in any JSON string *value* (keys are ignored).
//
// If this test fails:
//   1. Remove the hardcoded date from the translation string.
//   2. Instead, pass a translation key that the React component fills in at
//      render time using the LEGAL_LAST_UPDATED constant from legalDates.ts
//      (e.g. `t("lastUpdated") + " " + formatDate(LEGAL_LAST_UPDATED)`).

const LOCALES_DIR = path.resolve(__dirname, "../../i18n/locales");

// Auto-discover every namespace from the English reference directory,
// mirroring the approach used by `check:i18n`.  This ensures a future
// translator cannot embed a hardcoded date in any namespace — not just the
// original hard-coded five (portal, landing, privacy, terms, legal).
const EN_DIR = path.join(LOCALES_DIR, "en");
const ALL_NAMESPACES: string[] = fs
  .readdirSync(EN_DIR)
  .filter((f) => f.endsWith(".json") && f !== "_meta.json")
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const SUPPORTED_LOCALES = ["de", "en", "es", "fr", "pt", "zh"];

/**
 * Recursively collect every string value from a parsed JSON object.
 * Keys are intentionally ignored — only string leaf values are returned.
 */
function collectStringValues(obj: unknown, acc: string[] = []): string[] {
  if (typeof obj === "string") {
    acc.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectStringValues(item, acc);
  } else if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      collectStringValues(val, acc);
    }
  }
  return acc;
}

describe("i18n locale files — no hardcoded date literals in any namespace", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const ns of ALL_NAMESPACES) {
      const filePath = path.join(LOCALES_DIR, locale, `${ns}.json`);
      const label = `${locale}/${ns}.json`;

      // Skip locale+namespace combos that don't exist yet.
      if (!fs.existsSync(filePath)) continue;

      describe(label, () => {
        let values: string[];

        it("parses without error", () => {
          const raw = fs.readFileSync(filePath, "utf8");
          expect(() => {
            values = collectStringValues(JSON.parse(raw));
          }).not.toThrow();
        });

        it("contains no ISO-8601 date string (YYYY-MM-DD) in any string value", () => {
          const raw = fs.readFileSync(filePath, "utf8");
          values = collectStringValues(JSON.parse(raw));
          const offenders = values.filter((v) => BARE_ISO_DATE_IN_JSX.test(v));
          expect(
            offenders,
            `${label} contains hardcoded ISO-8601 date string(s) in translation values:\n` +
              offenders.map((v) => `  "${v}"`).join("\n") +
              `\n\nDo not hardcode the date in a locale file. Instead, keep the translation ` +
              `string date-free and let the React component interpolate the formatted date ` +
              `at render time using the LEGAL_LAST_UPDATED constant from "@/lib/legalDates".`,
          ).toHaveLength(0);
        });

        it("contains no English month-name date in any string value", () => {
          const raw = fs.readFileSync(filePath, "utf8");
          values = collectStringValues(JSON.parse(raw));
          const offenders = values.filter((v) => MONTH_NAME_DATE_IN_JSX.test(v));
          expect(
            offenders,
            `${label} contains hardcoded English month-name date(s) in translation values:\n` +
              offenders.map((v) => `  "${v}"`).join("\n") +
              `\n\nDo not hardcode the date in a locale file. Instead, keep the translation ` +
              `string date-free and let the React component interpolate the formatted date ` +
              `at render time using the LEGAL_LAST_UPDATED constant from "@/lib/legalDates".`,
          ).toHaveLength(0);
        });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Regression: previously-unscanned namespaces are now covered
// ---------------------------------------------------------------------------
//
// Before the auto-discovery change, only five namespaces (portal, landing,
// privacy, terms, legal) were scanned.  Any other namespace — e.g. common,
// access, stages — was silently ignored.  These tests assert that:
//   1. The auto-discovered namespace list includes namespaces beyond the
//      original hard-coded five.
//   2. The detection logic (collectStringValues + regexes) would correctly
//      surface a hardcoded date injected into one of those namespaces.

describe("i18n date guard — regression: previously-unscanned namespaces are now covered", () => {
  const ORIGINAL_NAMESPACES = new Set(["portal", "landing", "privacy", "terms", "legal"]);

  it("discovers namespaces beyond the original five", () => {
    const extra = ALL_NAMESPACES.filter((ns) => !ORIGINAL_NAMESPACES.has(ns));
    expect(
      extra.length,
      `Expected at least one namespace beyond the original five (portal, landing, privacy, ` +
        `terms, legal) to be discovered in en/, but found none. ` +
        `Check that the en/ directory contains additional .json files.`,
    ).toBeGreaterThan(0);
  });

  it("detects an ISO-8601 date injected into a previously-unscanned namespace value", () => {
    const syntheticNamespace = {
      title: "Welcome",
      notice: "This content was last reviewed on 2026-06-01.",
    };
    const values = collectStringValues(syntheticNamespace);
    const offenders = values.filter((v) => BARE_ISO_DATE_IN_JSX.test(v));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("2026-06-01");
  });

  it("detects an English month-name date injected into a previously-unscanned namespace value", () => {
    const syntheticNamespace = {
      footer: "Updated June 1, 2026.",
      cta: "Learn more",
    };
    const values = collectStringValues(syntheticNamespace);
    const offenders = values.filter((v) => MONTH_NAME_DATE_IN_JSX.test(v));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain("June 1, 2026");
  });

  it("detects hardcoded dates nested inside objects in a previously-unscanned namespace", () => {
    const syntheticNamespace = {
      section: {
        header: "FAQ",
        meta: { lastUpdated: "2025-12-31" },
      },
    };
    const values = collectStringValues(syntheticNamespace);
    const offenders = values.filter((v) => BARE_ISO_DATE_IN_JSX.test(v));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toBe("2025-12-31");
  });
});
