// @vitest-environment jsdom
/**
 * Regression coverage for the document-status badge keys used in
 * DocumentsView.tsx's `userDocStatusBadge()` helper (portal namespace:
 * `documents.status.*`).
 *
 * Why this test matters: These keys are rendered in the visible status badge
 * on every UserDocumentCard in DocumentsView. They are called WITHOUT an
 * explicit `defaultValue` fallback in the source, which means a key rename or
 * removal would silently show the raw i18n key string to every user — with no
 * console error or fallback indicator. This test locks the exact translated
 * value per locale so any future rename or removal is caught immediately.
 *
 * The approach mirrors documentsRefreshError.test.ts: pass an English
 * `defaultValue` in each `i18n.t()` call so that the "not the English
 * fallback" assertion correctly catches the case where i18next has fallen back
 * to the default (meaning the key is missing or mis-spelled in the locale
 * resource). Then assert the returned string equals the locked translated
 * value for every supported locale.
 *
 * Covered keys (all used in `userDocStatusBadge()` in DocumentsView.tsx):
 *   - documents.status.approved
 *   - documents.status.rejected
 *   - documents.status.underReview
 *   - documents.status.submitted
 *   - documents.status.actionRequired
 *
 * Coverage guard: the "documents.status key coverage" describe block below
 * reads the English portal.json at test-time and asserts that the set of keys
 * in `documents.status` exactly matches the set of keys covered by the
 * locked-value tests above. If a new status key is added to the English locale
 * file without adding a corresponding locked-value test, that describe block
 * will fail with a clear message listing the uncovered key(s).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../index";
import portalDe from "../locales/de/portal.json";
import portalEn from "../locales/en/portal.json";
import portalEs from "../locales/es/portal.json";
import portalFr from "../locales/fr/portal.json";
import portalPt from "../locales/pt/portal.json";
import portalZh from "../locales/zh/portal.json";

const ENGLISH_APPROVED = "Approved";
const ENGLISH_REJECTED = "Resubmission Required";
const ENGLISH_UNDER_REVIEW = "Under Review";
const ENGLISH_SUBMITTED = "Submitted \u2014 Pending Review";
const ENGLISH_ACTION_REQUIRED = "Action Required";

interface StatusCopy {
  approved: string;
  rejected: string;
  underReview: string;
  submitted: string;
  actionRequired: string;
}

const EXPECTED: Record<string, StatusCopy> = {
  en: {
    approved: ENGLISH_APPROVED,
    rejected: ENGLISH_REJECTED,
    underReview: ENGLISH_UNDER_REVIEW,
    submitted: ENGLISH_SUBMITTED,
    actionRequired: ENGLISH_ACTION_REQUIRED,
  },
  es: {
    approved: "Aprobado",
    rejected: "Reenv\u00edo Requerido",
    underReview: "En Revisi\u00f3n",
    submitted: "Enviado \u2014 Pendiente de Revisi\u00f3n",
    actionRequired: "Acci\u00f3n Requerida",
  },
  fr: {
    approved: "Approuv\u00e9",
    rejected: "Nouvelle Soumission Requise",
    underReview: "En Cours d'Examen",
    submitted: "Soumis \u2014 En Attente d'Examen",
    actionRequired: "Action Requise",
  },
  de: {
    approved: "Genehmigt",
    rejected: "Erneute Einreichung Erforderlich",
    underReview: "Wird \u00fcberpr\u00fcft",
    submitted: "Eingereicht \u2013 Wartet auf \u00dcberpr\u00fcfung",
    actionRequired: "Handlung Erforderlich",
  },
  pt: {
    approved: "Aprovado",
    rejected: "Reenvio Necess\u00e1rio",
    underReview: "Em Revis\u00e3o",
    submitted: "Submetido \u2014 Aguardando Revis\u00e3o",
    actionRequired: "A\u00e7\u00e3o Necess\u00e1ria",
  },
  zh: {
    approved: "\u5df2\u6279\u51c6",
    rejected: "\u9700\u8981\u91cd\u65b0\u63d0\u4ea4",
    underReview: "\u5ba1\u6838\u4e2d",
    submitted: "\u5df2\u63d0\u4ea4 \u2014 \u5f85\u5ba1\u6838",
    actionRequired: "\u9700\u8981\u884c\u52a8",
  },
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("DocumentsView — userDocStatusBadge keys across all six portal locales", () => {
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(locale);
      });

      it('renders the correct "documents.status.approved"', () => {
        const result = i18n.t("documents.status.approved", {
          ns: "portal",
          defaultValue: ENGLISH_APPROVED,
        });

        expect(result).toBe(expected.approved);
      });

      it('renders the correct "documents.status.rejected"', () => {
        const result = i18n.t("documents.status.rejected", {
          ns: "portal",
          defaultValue: ENGLISH_REJECTED,
        });

        expect(result).toBe(expected.rejected);
      });

      it('renders the correct "documents.status.underReview"', () => {
        const result = i18n.t("documents.status.underReview", {
          ns: "portal",
          defaultValue: ENGLISH_UNDER_REVIEW,
        });

        expect(result).toBe(expected.underReview);
      });

      it('renders the correct "documents.status.submitted"', () => {
        const result = i18n.t("documents.status.submitted", {
          ns: "portal",
          defaultValue: ENGLISH_SUBMITTED,
        });

        expect(result).toBe(expected.submitted);
      });

      it('renders the correct "documents.status.actionRequired"', () => {
        const result = i18n.t("documents.status.actionRequired", {
          ns: "portal",
          defaultValue: ENGLISH_ACTION_REQUIRED,
        });

        expect(result).toBe(expected.actionRequired);
      });

      if (locale !== "en") {
        it('"documents.status.approved" is not the English fallback', () => {
          const result = i18n.t("documents.status.approved", {
            ns: "portal",
            defaultValue: ENGLISH_APPROVED,
          });

          expect(result).not.toBe(ENGLISH_APPROVED);
        });

        it('"documents.status.rejected" is not the English fallback', () => {
          const result = i18n.t("documents.status.rejected", {
            ns: "portal",
            defaultValue: ENGLISH_REJECTED,
          });

          expect(result).not.toBe(ENGLISH_REJECTED);
        });

        it('"documents.status.underReview" is not the English fallback', () => {
          const result = i18n.t("documents.status.underReview", {
            ns: "portal",
            defaultValue: ENGLISH_UNDER_REVIEW,
          });

          expect(result).not.toBe(ENGLISH_UNDER_REVIEW);
        });

        it('"documents.status.submitted" is not the English fallback', () => {
          const result = i18n.t("documents.status.submitted", {
            ns: "portal",
            defaultValue: ENGLISH_SUBMITTED,
          });

          expect(result).not.toBe(ENGLISH_SUBMITTED);
        });

        it('"documents.status.actionRequired" is not the English fallback', () => {
          const result = i18n.t("documents.status.actionRequired", {
            ns: "portal",
            defaultValue: ENGLISH_ACTION_REQUIRED,
          });

          expect(result).not.toBe(ENGLISH_ACTION_REQUIRED);
        });
      }
    });
  }
});

/**
 * Structural presence guard: reads all six locale portal.json files at
 * test-time and asserts that each one contains a `documents` object with a
 * `status` sub-object that has exactly the same keys as the English reference.
 *
 * This catches locale-file regressions at a higher level than the locked-value
 * tests: a missing namespace file, a missing `documents` group, a missing
 * `status` sub-object, or an individually missing status key will all fail here
 * with a clear per-locale diagnostic message — even before i18next has a chance
 * to silently fall back to the English value.
 *
 * HOW TO FIX A FAILURE:
 * The failing locale's portal.json is missing the `documents.status` group or
 * one of its keys. Add the missing translation(s) to that file and re-run the
 * test.
 */
describe("documents.status structural presence across all locale files", () => {
  const ALL_LOCALE_FILES: Record<string, Record<string, unknown>> = {
    en: portalEn as Record<string, unknown>,
    es: portalEs as Record<string, unknown>,
    fr: portalFr as Record<string, unknown>,
    de: portalDe as Record<string, unknown>,
    pt: portalPt as Record<string, unknown>,
    zh: portalZh as Record<string, unknown>,
  };

  const referenceStatusKeys = Object.keys(
    (portalEn.documents as Record<string, unknown>).status as Record<
      string,
      string
    >,
  );

  for (const [locale, portalJson] of Object.entries(ALL_LOCALE_FILES)) {
    describe(`locale: ${locale}`, () => {
      it('portal.json contains a "documents" object', () => {
        expect(
          portalJson,
          `${locale}/portal.json is missing the top-level "documents" key`,
        ).toHaveProperty("documents");

        expect(
          typeof portalJson.documents,
          `${locale}/portal.json "documents" must be an object, got ${typeof portalJson.documents}`,
        ).toBe("object");
      });

      it('"documents" contains a "status" sub-object', () => {
        const documents = portalJson.documents as Record<string, unknown>;

        expect(
          documents,
          `${locale}/portal.json is missing "documents.status"`,
        ).toHaveProperty("status");

        expect(
          typeof documents.status,
          `${locale}/portal.json "documents.status" must be an object, got ${typeof documents.status}`,
        ).toBe("object");
      });

      it('"documents.status" contains every key present in the English reference', () => {
        const documents = portalJson.documents as Record<string, unknown>;
        const statusObj = (documents.status ?? {}) as Record<string, unknown>;
        const missingKeys = referenceStatusKeys.filter(
          (k) => !(k in statusObj),
        );

        expect(
          missingKeys,
          `${locale}/portal.json documents.status is missing the following key(s) ` +
            `that exist in the English reference: [${missingKeys.join(", ")}]. ` +
            `Add the missing translation(s) to client/src/i18n/locales/${locale}/portal.json.`,
        ).toHaveLength(0);
      });

      it('"documents.status" values are all non-empty strings', () => {
        const documents = portalJson.documents as Record<string, unknown>;
        const statusObj = (documents.status ?? {}) as Record<string, unknown>;
        const emptyOrNonStringKeys = referenceStatusKeys.filter(
          (k) => typeof statusObj[k] !== "string" || statusObj[k] === "",
        );

        expect(
          emptyOrNonStringKeys,
          `${locale}/portal.json documents.status has empty or non-string value(s) for: ` +
            `[${emptyOrNonStringKeys.join(", ")}]`,
        ).toHaveLength(0);
      });
    });
  }
});

/**
 * Coverage guard: reads the English portal.json at test-time and asserts that
 * every key present in `documents.status` is covered by the locked-value tests
 * above.
 *
 * HOW TO FIX A FAILURE:
 * If this test fails it means a key was added to (or removed from)
 * `documents.status` in `client/src/i18n/locales/en/portal.json` without
 * updating this test file. To fix:
 *   1. Add the new key to the `EXPECTED` map above (one entry per locale).
 *   2. Add a locked-value `it(...)` block for the new key inside the per-locale
 *      `describe` loop, mirroring the pattern used for the existing five keys.
 *   3. Add the new key to the `COVERED_KEYS` set below so this guard passes.
 */
describe("documents.status key coverage guard", () => {
  const COVERED_KEYS = new Set([
    "approved",
    "rejected",
    "underReview",
    "submitted",
    "actionRequired",
  ]);

  it("every key in en/portal.json documents.status has a locked-value test", () => {
    const statusObj = portalEn.documents.status as Record<string, string>;
    const definedKeys = Object.keys(statusObj);

    const uncoveredKeys = definedKeys.filter((k) => !COVERED_KEYS.has(k));

    expect(
      uncoveredKeys,
      `The following key(s) exist in documents.status in en/portal.json but are ` +
        `NOT covered by a locked-value test in documentsStatusKeys.test.ts: ` +
        `[${uncoveredKeys.join(", ")}]. ` +
        `Add locked-value test entries for each key and then add the key to ` +
        `COVERED_KEYS in this guard.`,
    ).toHaveLength(0);
  });

  it("every key in COVERED_KEYS still exists in en/portal.json documents.status", () => {
    const statusObj = portalEn.documents.status as Record<string, string>;
    const definedKeys = new Set(Object.keys(statusObj));

    const removedKeys = [...COVERED_KEYS].filter((k) => !definedKeys.has(k));

    expect(
      removedKeys,
      `The following key(s) are listed in COVERED_KEYS in documentsStatusKeys.test.ts ` +
        `but no longer exist in documents.status in en/portal.json: ` +
        `[${removedKeys.join(", ")}]. ` +
        `Remove the stale entries from COVERED_KEYS and from the EXPECTED map and ` +
        `the locked-value test blocks.`,
    ).toHaveLength(0);
  });
});
