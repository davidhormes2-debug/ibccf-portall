// @vitest-environment jsdom
/**
 * Regression coverage for the key-request status badge keys used in the
 * access-key request UI (portal namespace: `keyRequest.status.*`).
 *
 * Why this test matters: These keys are rendered in the visible status badge
 * on the KeyRequestView page. They are called WITHOUT an explicit
 * `defaultValue` fallback in the source, which means a key rename or removal
 * would silently show the raw i18n key string to every user — with no console
 * error or fallback indicator. This test locks the exact translated value per
 * locale so any future rename or removal is caught immediately.
 *
 * The approach mirrors documentsStatusKeys.test.ts: pass an English
 * `defaultValue` in each `i18n.t()` call so that the "not the English
 * fallback" assertion correctly catches the case where i18next has fallen back
 * to the default (meaning the key is missing or mis-spelled in the locale
 * resource). Then assert the returned string equals the locked translated
 * value for every supported locale.
 *
 * Covered keys (all used in the access-key request status badge):
 *   - keyRequest.status.underReview
 *   - keyRequest.status.approved
 *   - keyRequest.status.rejected
 *   - keyRequest.status.expired
 *
 * Coverage guard: the "keyRequest.status key coverage" describe block below
 * reads the English portal.json at test-time and asserts that the set of keys
 * in `keyRequest.status` exactly matches the set of keys covered by the
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

const ENGLISH_UNDER_REVIEW = "Under Review";
const ENGLISH_APPROVED = "Approved";
const ENGLISH_REJECTED = "Rejected";
const ENGLISH_EXPIRED = "Expired";

interface StatusCopy {
  underReview: string;
  approved: string;
  rejected: string;
  expired: string;
}

const EXPECTED: Record<string, StatusCopy> = {
  en: {
    underReview: ENGLISH_UNDER_REVIEW,
    approved: ENGLISH_APPROVED,
    rejected: ENGLISH_REJECTED,
    expired: ENGLISH_EXPIRED,
  },
  es: {
    underReview: "En Revisi\u00f3n",
    approved: "Aprobado",
    rejected: "Rechazado",
    expired: "Caducado",
  },
  fr: {
    underReview: "En Cours d'Examen",
    approved: "Approuv\u00e9",
    rejected: "Rejet\u00e9",
    expired: "Expir\u00e9",
  },
  de: {
    underReview: "Wird \u00fcberpr\u00fcft",
    approved: "Genehmigt",
    rejected: "Abgelehnt",
    expired: "Abgelaufen",
  },
  pt: {
    underReview: "Em Revis\u00e3o",
    approved: "Aprovado",
    rejected: "Rejeitado",
    expired: "Expirado",
  },
  zh: {
    underReview: "\u5ba1\u6838\u4e2d",
    approved: "\u5df2\u6279\u51c6",
    rejected: "\u5df2\u62d2\u7edd",
    expired: "\u5df2\u8fc7\u671f",
  },
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("KeyRequestView — keyRequest.status keys across all six portal locales", () => {
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(locale);
      });

      it('renders the correct "keyRequest.status.underReview"', () => {
        const result = i18n.t("keyRequest.status.underReview", {
          ns: "portal",
          defaultValue: ENGLISH_UNDER_REVIEW,
        });

        expect(result).toBe(expected.underReview);
      });

      it('renders the correct "keyRequest.status.approved"', () => {
        const result = i18n.t("keyRequest.status.approved", {
          ns: "portal",
          defaultValue: ENGLISH_APPROVED,
        });

        expect(result).toBe(expected.approved);
      });

      it('renders the correct "keyRequest.status.rejected"', () => {
        const result = i18n.t("keyRequest.status.rejected", {
          ns: "portal",
          defaultValue: ENGLISH_REJECTED,
        });

        expect(result).toBe(expected.rejected);
      });

      it('renders the correct "keyRequest.status.expired"', () => {
        const result = i18n.t("keyRequest.status.expired", {
          ns: "portal",
          defaultValue: ENGLISH_EXPIRED,
        });

        expect(result).toBe(expected.expired);
      });

      if (locale !== "en") {
        it('"keyRequest.status.underReview" is not the English fallback', () => {
          const result = i18n.t("keyRequest.status.underReview", {
            ns: "portal",
            defaultValue: ENGLISH_UNDER_REVIEW,
          });

          expect(result).not.toBe(ENGLISH_UNDER_REVIEW);
        });

        it('"keyRequest.status.approved" is not the English fallback', () => {
          const result = i18n.t("keyRequest.status.approved", {
            ns: "portal",
            defaultValue: ENGLISH_APPROVED,
          });

          expect(result).not.toBe(ENGLISH_APPROVED);
        });

        it('"keyRequest.status.rejected" is not the English fallback', () => {
          const result = i18n.t("keyRequest.status.rejected", {
            ns: "portal",
            defaultValue: ENGLISH_REJECTED,
          });

          expect(result).not.toBe(ENGLISH_REJECTED);
        });

        it('"keyRequest.status.expired" is not the English fallback', () => {
          const result = i18n.t("keyRequest.status.expired", {
            ns: "portal",
            defaultValue: ENGLISH_EXPIRED,
          });

          expect(result).not.toBe(ENGLISH_EXPIRED);
        });
      }
    });
  }
});

/**
 * Structural presence guard: reads all six locale portal.json files at
 * test-time and asserts that each one contains a `keyRequest` object with a
 * `status` sub-object that has exactly the same keys as the English reference.
 *
 * This catches locale-file regressions at a higher level than the locked-value
 * tests: a missing namespace file, a missing `keyRequest` group, a missing
 * `status` sub-object, or an individually missing status key will all fail here
 * with a clear per-locale diagnostic message — even before i18next has a chance
 * to silently fall back to the English value.
 *
 * HOW TO FIX A FAILURE:
 * The failing locale's portal.json is missing the `keyRequest.status` group or
 * one of its keys. Add the missing translation(s) to that file and re-run the
 * test.
 */
describe("keyRequest.status structural presence across all locale files", () => {
  const ALL_LOCALE_FILES: Record<string, Record<string, unknown>> = {
    en: portalEn as Record<string, unknown>,
    es: portalEs as Record<string, unknown>,
    fr: portalFr as Record<string, unknown>,
    de: portalDe as Record<string, unknown>,
    pt: portalPt as Record<string, unknown>,
    zh: portalZh as Record<string, unknown>,
  };

  const referenceStatusKeys = Object.keys(
    (portalEn.keyRequest as Record<string, unknown>).status as Record<
      string,
      string
    >,
  );

  for (const [locale, portalJson] of Object.entries(ALL_LOCALE_FILES)) {
    describe(`locale: ${locale}`, () => {
      it('portal.json contains a "keyRequest" object', () => {
        expect(
          portalJson,
          `${locale}/portal.json is missing the top-level "keyRequest" key`,
        ).toHaveProperty("keyRequest");

        expect(
          typeof portalJson.keyRequest,
          `${locale}/portal.json "keyRequest" must be an object, got ${typeof portalJson.keyRequest}`,
        ).toBe("object");
      });

      it('"keyRequest" contains a "status" sub-object', () => {
        const keyRequest = portalJson.keyRequest as Record<string, unknown>;

        expect(
          keyRequest,
          `${locale}/portal.json is missing "keyRequest.status"`,
        ).toHaveProperty("status");

        expect(
          typeof keyRequest.status,
          `${locale}/portal.json "keyRequest.status" must be an object, got ${typeof keyRequest.status}`,
        ).toBe("object");
      });

      it('"keyRequest.status" contains every key present in the English reference', () => {
        const keyRequest = portalJson.keyRequest as Record<string, unknown>;
        const statusObj = (keyRequest.status ?? {}) as Record<string, unknown>;
        const missingKeys = referenceStatusKeys.filter(
          (k) => !(k in statusObj),
        );

        expect(
          missingKeys,
          `${locale}/portal.json keyRequest.status is missing the following key(s) ` +
            `that exist in the English reference: [${missingKeys.join(", ")}]. ` +
            `Add the missing translation(s) to client/src/i18n/locales/${locale}/portal.json.`,
        ).toHaveLength(0);
      });

      it('"keyRequest.status" values are all non-empty strings', () => {
        const keyRequest = portalJson.keyRequest as Record<string, unknown>;
        const statusObj = (keyRequest.status ?? {}) as Record<string, unknown>;
        const emptyOrNonStringKeys = referenceStatusKeys.filter(
          (k) => typeof statusObj[k] !== "string" || statusObj[k] === "",
        );

        expect(
          emptyOrNonStringKeys,
          `${locale}/portal.json keyRequest.status has empty or non-string value(s) for: ` +
            `[${emptyOrNonStringKeys.join(", ")}]`,
        ).toHaveLength(0);
      });
    });
  }
});

/**
 * Coverage guard: reads the English portal.json at test-time and asserts that
 * every key present in `keyRequest.status` is covered by the locked-value
 * tests above.
 *
 * HOW TO FIX A FAILURE:
 * If this test fails it means a key was added to (or removed from)
 * `keyRequest.status` in `client/src/i18n/locales/en/portal.json` without
 * updating this test file. To fix:
 *   1. Add the new key to the `EXPECTED` map above (one entry per locale).
 *   2. Add a locked-value `it(...)` block for the new key inside the per-locale
 *      `describe` loop, mirroring the pattern used for the existing four keys.
 *   3. Add the new key to the `COVERED_KEYS` set below so this guard passes.
 */
describe("keyRequest.status key coverage guard", () => {
  const COVERED_KEYS = new Set([
    "underReview",
    "approved",
    "rejected",
    "expired",
  ]);

  it("every key in en/portal.json keyRequest.status has a locked-value test", () => {
    const statusObj = (portalEn.keyRequest as Record<string, unknown>)
      .status as Record<string, string>;
    const definedKeys = Object.keys(statusObj);

    const uncoveredKeys = definedKeys.filter((k) => !COVERED_KEYS.has(k));

    expect(
      uncoveredKeys,
      `The following key(s) exist in keyRequest.status in en/portal.json but are ` +
        `NOT covered by a locked-value test in keyRequestStatusKeys.test.ts: ` +
        `[${uncoveredKeys.join(", ")}]. ` +
        `Add locked-value test entries for each key and then add the key to ` +
        `COVERED_KEYS in this guard.`,
    ).toHaveLength(0);
  });

  it("every key in COVERED_KEYS still exists in en/portal.json keyRequest.status", () => {
    const statusObj = (portalEn.keyRequest as Record<string, unknown>)
      .status as Record<string, string>;
    const definedKeys = new Set(Object.keys(statusObj));

    const removedKeys = [...COVERED_KEYS].filter((k) => !definedKeys.has(k));

    expect(
      removedKeys,
      `The following key(s) are listed in COVERED_KEYS in keyRequestStatusKeys.test.ts ` +
        `but no longer exist in keyRequest.status in en/portal.json: ` +
        `[${removedKeys.join(", ")}]. ` +
        `Remove the stale entries from COVERED_KEYS and from the EXPECTED map and ` +
        `the locked-value test blocks.`,
    ).toHaveLength(0);
  });
});
