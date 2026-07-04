/**
 * Structural coverage for every translation key across every shipped locale.
 *
 * Why this test exists (Task #373):
 *   The earlier locale tests (`documentsLocale.test.ts`,
 *   `portalLocaleCoverage.test.ts`) lock translations for a hand-picked set
 *   of keys per view. They catch regressions on the keys they cover, but a
 *   brand-new key added to `en/<ns>.json` with no corresponding entry in
 *   the other locales will still ship — users would silently see the
 *   English fallback. This test walks every leaf key in the English JSON
 *   for each shipped namespace and asserts the same key exists with a
 *   non-empty string value in every other locale, catching the entire
 *   "I forgot to translate this" class of regression in one shot.
 *
 * High-visibility namespaces (`portal`, `declaration`) get an additional
 * check: the translated value must differ from the English source so a
 * literal copy-paste doesn't silently slip through. A small allow-list of
 * brand / proper-noun tokens (IBCCF, USDT, USDC, TRC20, Tron, Polygon)
 * plus a few legitimately-identical strings (e.g. French "Date",
 * "Signature") is exempted from the differ check — see
 * `isAllowedIdentical` below.
 *
 * The `admin` namespace is intentionally excluded: per `replit.md`,
 * "Admin surfaces remain English by design".
 */

import { describe, expect, it } from "vitest";

// Eager-glob every locale namespace JSON so adding a new locale/namespace
// folder is auto-discovered without touching this file. Mirrors the
// resource registration in `client/src/i18n/index.ts`.
const localeFiles = import.meta.glob<Record<string, unknown>>(
  "../locales/*/*.json",
  { eager: true, import: "default" },
);

type Bundles = Record<string, Record<string, Record<string, unknown>>>;
const bundles: Bundles = {};
for (const [path, mod] of Object.entries(localeFiles)) {
  const match = path.match(/\.\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, code, ns] = match;
  if (ns.startsWith("_")) continue; // `_meta.json` is locale metadata, not a namespace
  bundles[code] ??= {};
  bundles[code][ns] = mod as Record<string, unknown>;
}

const ENGLISH = "en";
// The six shipped locales (per replit.md "Multi-language UI (i18n)"). The
// test asserts every one of these is present so CI fails if a locale
// folder is accidentally dropped from the build.
const EXPECTED_LOCALES = ["en", "es", "fr", "de", "pt", "zh"] as const;
// Admin surfaces remain English by design (see replit.md), so the admin
// namespace is intentionally excluded from coverage.
const EXCLUDED_NAMESPACES = new Set(["admin"]);
// Stricter check: translated value must differ from English source.
const HIGH_VISIBILITY_NAMESPACES = new Set(["portal", "declaration"]);

const NAMESPACES = Array.from(
  new Set(Object.values(bundles).flatMap((nsMap) => Object.keys(nsMap))),
)
  .filter((ns) => !EXCLUDED_NAMESPACES.has(ns))
  .sort();

// Iterate over the expected locales (minus English) rather than whatever
// `bundles` happens to contain — that way the per-locale describe blocks
// still run (and fail loudly) if a locale folder is deleted or renamed.
const OTHER_LOCALES = EXPECTED_LOCALES.filter((code) => code !== ENGLISH);

interface LeafEntry {
  keyPath: string;
  value: string;
}

function flattenLeavesAny(value: unknown, keyPath: string, out: LeafEntry[]) {
  if (Array.isArray(value)) {
    // Walk array elements as indexed leaf paths (e.g.
    // `walletConnect.genericSteps[0]`) so missing/short translations of
    // array-valued copy (wallet import steps, etc.) are caught too.
    value.forEach((item, idx) => {
      flattenLeavesAny(item, `${keyPath}[${idx}]`, out);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = keyPath ? `${keyPath}.${k}` : k;
      flattenLeavesAny(v, next, out);
    }
    return;
  }
  if (typeof value === "string") {
    out.push({ keyPath, value });
  }
  // Non-string scalar leaves (numbers, booleans) are not used as
  // translation values in this project, so they are skipped.
}

function flattenLeaves(obj: Record<string, unknown>): LeafEntry[] {
  const out: LeafEntry[] = [];
  flattenLeavesAny(obj, "", out);
  return out;
}

function getByPath(
  obj: Record<string, unknown> | undefined,
  keyPath: string,
): unknown {
  if (!obj) return undefined;
  // Tokenise into object keys and `[idx]` array indices, e.g.
  // `walletConnect.wallets.trust.importSteps[2]` →
  // ["walletConnect","wallets","trust","importSteps", 2].
  const tokens: Array<string | number> = [];
  for (const segment of keyPath.split(".")) {
    const match = segment.match(/^([^\[]+)((?:\[\d+\])*)$/);
    if (!match) return undefined;
    if (match[1]) tokens.push(match[1]);
    for (const idx of match[2].matchAll(/\[(\d+)\]/g)) {
      tokens.push(Number(idx[1]));
    }
  }
  let cur: unknown = obj;
  for (const tok of tokens) {
    if (typeof tok === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[tok];
    } else {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[tok];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Allow-list for identical-to-English translations.
// ---------------------------------------------------------------------------
// Brand / asset / network tokens that legitimately render identically in
// every locale (per task spec). Kept intentionally small.
const BRAND_TOKENS = new Set([
  "IBCCF",
  "USDT",
  "USDC",
  "TRC20",
  "Tron",
  "Polygon",
]);

// Whole-string allow-list for sample values, product names, and other
// fixed strings that legitimately render identically in every locale.
const BRAND_STRINGS = new Set<string>([
  "N/A",
  "SMS",
  "IBCCF PORTAL",
  "IBCCF Support",
  "Live · USDT",
  "International Blockchain Community Compliance Forum",
  "your@email.com",
  "name@example.com",
  "Option {{letter}}",
  "Section {{number}}",
  "App Store",
  "Google Play",
  "1,000 USDT",
]);

// Per-locale allow-list for whole translated strings that are correct
// identical-to-English translations: genuine cognates, internationally-used
// loanwords, or finance/UI terms that are conventionally kept in English in
// that locale. This is intentionally grouped by locale (not by key path) so
// it is easy to audit what each language legitimately borrows from English.
//
// Rule: only add a value here when it is the *correct native rendering* for
// that locale — i.e. a fluent speaker would actually write that word.  Do
// NOT use this to silence a lazy placeholder that should get a real
// translation.
const LOCALE_COGNATES: Readonly<Record<string, ReadonlySet<string>>> = {
  // French — these words are spelled identically in French and English.
  fr: new Set([
    "Communication",   // navGroups.communication — French cognate
    "Documents",       // navItems.documents — French cognate
    "Messages",        // navItems.messages — French cognate
    "Mobile",          // settings.profile.mobile — téléphone mobile
    "URGENT",          // shell.urgent — uppercase form identical in French
    "Standard",        // dashboard.header.standard — French cognate
    "Urgent",          // dashboard.messages.urgent — French cognate
    "Excellent",       // dashboard.feedback.ratings.5 — French cognate
    "Notifications",   // notificationBell.title — French cognate
    "Type",            // withdrawalRequest.fields.type — French cognate
    "Date",            // declaration sections.signature.date / missing.signatureDate — French cognate
    "Signature",       // declaration missing.signature — French cognate
    "Notes",           // refundClaim.entryNotesLabel — French cognate (same spelling)
  ]),
  // German — internationally-used English loanwords common in German finance
  // and technology contexts.
  de: new Set([
    "Dashboard",             // navItems.dashboard — anglicism in common use
    "Name",                  // keyRequest labels / dashboard.profile.name — identical in German
    "(optional)",            // keyRequest.form.optional — used unchanged in German UI
    "Standard",              // dashboard.header.standard — identical loanword
    "Feedback",              // dashboard.cards.feedback — anglicism in common use
    "Status",                // dashboard.letter.status / letter.success.statusLabel
    "Asset",                 // payoutWallet.asset / withdrawalRequest.fields.asset / withdrawalActivation.step1.asset
    "Asset (optional)",      // withdrawalRequest.fields.walletAssetOptional
    "Memo / Tag (optional)", // withdrawalActivation.step1.memo
  ]),
  // Spanish — these words share Latin roots with English and are spelled the
  // same in modern Spanish.
  es: new Set([
    "Error",   // toast error titles — identical Spanish cognate
    "General", // documents.supporting.category.general — identical Spanish cognate
    "No",      // declaration.no — identical Spanish cognate
  ]),
  // Portuguese — anglicisms widely used in Brazilian and European Portuguese.
  pt: new Set([
    "Feedback", // dashboard.cards.feedback — anglicism in common use
    "Status",   // dashboard.letter.status / letter.success.statusLabel
  ]),
};

/**
 * Returns true if a value is allowed to remain identical to the English
 * source — i.e. it should NOT trigger a "differs from English" failure.
 *
 * Heuristics, in order:
 *   1. String has no Unicode letters (pure punctuation/digits/symbols,
 *      e.g. "—", "N/A", "••••••", "+1 (555) 000-0000").
 *   2. Whole-string BRAND_STRINGS allow-list (product/sample/app-store names).
 *   3. After stripping `{{placeholder}}` references and non-letter chars,
 *      every remaining token is in the BRAND_TOKENS allow-list (e.g.
 *      "USDC (Polygon)", "TRC20 (Tron)", "Live · USDT").
 *   4. The translated string is in LOCALE_COGNATES[locale] — a per-locale
 *      value-level allow-list for cognates and loanwords that legitimately
 *      render identically to English in that language. Because this is
 *      value-scoped rather than key-scoped it is intentionally broad: only
 *      add a value when it is context-agnostically correct for a native
 *      speaker of that locale (e.g. German "Dashboard", French "Type").
 */
function isAllowedIdentical(
  english: string,
  locale: string,
): boolean {
  // 1) No letters at all → punctuation/numbers/symbols only.
  if (!/\p{L}/u.test(english)) return true;

  // 2) Whole-string brand / sample / product-name allow-list.
  if (BRAND_STRINGS.has(english)) return true;

  // 3) After stripping `{{placeholder}}` references, either no letters
  //    remain (so the visible content is just punctuation around
  //    placeholders), or every remaining letter/digit token is a known
  //    brand token (e.g. "USDC (Polygon)", "TRC20 (Tron)").
  const withoutPlaceholders = english.replace(/\{\{[^}]+\}\}/g, " ");
  const letterTokens = withoutPlaceholders.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (letterTokens.length === 0) return true;
  if (letterTokens.every((token) => BRAND_TOKENS.has(token))) return true;

  // 4) Per-locale value-level cognate / loanword allow-list.
  //    LOCALE_COGNATES allows a translated *value* across all keys that use it
  //    in that locale. Only add values whose identical rendering is
  //    linguistically correct for a native speaker — not to silence
  //    untranslated stubs.
  if (LOCALE_COGNATES[locale]?.has(english)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Translation coverage — every English key exists in every locale", () => {
  it("ships every expected locale (en, es, fr, de, pt, zh)", () => {
    const missing = EXPECTED_LOCALES.filter((code) => !bundles[code]);
    expect(
      missing,
      `Expected all six shipped locales to be present. Missing: ${missing.join(
        ", ",
      )}`,
    ).toEqual([]);
  });

  it("namespaces are discovered (excluding admin)", () => {
    expect(NAMESPACES.length).toBeGreaterThan(0);
    expect(NAMESPACES).not.toContain("admin");
  });

  for (const namespace of NAMESPACES) {
    describe(`namespace: ${namespace}`, () => {
      const englishBundle = bundles[ENGLISH]?.[namespace];

      it("English source bundle is present", () => {
        expect(englishBundle).toBeDefined();
      });

      if (!englishBundle) return;

      const englishLeaves = flattenLeaves(englishBundle);
      const enforceDiffers = HIGH_VISIBILITY_NAMESPACES.has(namespace);

      for (const locale of OTHER_LOCALES) {
        describe(`locale: ${locale}`, () => {
          const otherBundle = bundles[locale]?.[namespace];

          it("locale bundle is present", () => {
            expect(otherBundle).toBeDefined();
          });

          if (!otherBundle) return;

          it("every English leaf key has a non-empty string translation", () => {
            const problems: string[] = [];
            for (const { keyPath } of englishLeaves) {
              const value = getByPath(otherBundle, keyPath);
              if (value === undefined) {
                problems.push(`missing key: ${keyPath}`);
              } else if (typeof value !== "string") {
                problems.push(
                  `non-string value at ${keyPath} (got ${typeof value})`,
                );
              } else if (value.trim() === "") {
                problems.push(`empty string at ${keyPath}`);
              }
            }
            expect(
              problems,
              `Locale "${locale}" is missing translations in namespace "${namespace}":\n  - ${problems.join(
                "\n  - ",
              )}`,
            ).toEqual([]);
          });

          if (enforceDiffers) {
            it("translated values differ from English (except brand tokens / cognates)", () => {
              const problems: string[] = [];
              for (const { keyPath, value: english } of englishLeaves) {
                const translated = getByPath(otherBundle, keyPath);
                if (typeof translated !== "string") continue; // covered by previous test
                if (translated !== english) continue;
                if (isAllowedIdentical(english, locale)) {
                  continue;
                }
                problems.push(`${keyPath} = ${JSON.stringify(english)}`);
              }
              expect(
                problems,
                `Locale "${locale}" has untranslated (English-identical) values in high-visibility namespace "${namespace}":\n  - ${problems.join(
                  "\n  - ",
                )}\n\nIf a value legitimately renders identically (proper noun / brand / loanword), extend BRAND_TOKENS, BRAND_STRINGS, or LOCALE_COGNATES[locale] in this test.`,
              ).toEqual([]);
            });
          }
        });
      }
    });
  }
});
