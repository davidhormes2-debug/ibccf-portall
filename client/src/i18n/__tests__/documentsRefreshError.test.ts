// @vitest-environment jsdom
/**
 * Regression coverage for the document-refresh error toast keys used in
 * DocumentsView.handleRefresh (portal namespace:
 * `documents.refreshError.title` and `documents.refreshError.description`).
 *
 * Why this test matters: Both keys are consumed with English `defaultValue`
 * fallbacks, so a silent missing-key or rename regression would render the
 * English string for all non-English users with no visible error. This test
 * locks the exact translated value per locale so any future key removal or
 * typo is caught immediately.
 *
 * Approach mirrors documentsLocale.test.ts: initialise the shared i18n
 * instance, switch locale, call i18n.t() in the portal namespace, and assert
 * the returned string equals the locked translated value rather than the
 * English defaultValue fallback.
 *
 * For regression coverage of the `documents.status.*` keys used in
 * DocumentsView's userDocStatusBadge (keys without an explicit `defaultValue`
 * in source but equally at risk of silent English fallback on rename), see the
 * companion file: documentsStatusKeys.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../index";

const ENGLISH_TITLE = "Refresh failed";
const ENGLISH_DESCRIPTION =
  "Could not reload your documents. Please try again.";

interface RefreshErrorCopy {
  title: string;
  description: string;
}

const EXPECTED: Record<string, RefreshErrorCopy> = {
  en: {
    title: ENGLISH_TITLE,
    description: ENGLISH_DESCRIPTION,
  },
  es: {
    title: "Error al actualizar",
    description:
      "No se pudieron recargar sus documentos. Por favor, int\u00e9ntelo de nuevo.",
  },
  fr: {
    title: "\u00c9chec de l'actualisation",
    description:
      "Impossible de recharger vos documents. Veuillez r\u00e9essayer.",
  },
  de: {
    title: "Aktualisierung fehlgeschlagen",
    description:
      "Ihre Dokumente konnten nicht neu geladen werden. Bitte versuchen Sie es erneut.",
  },
  pt: {
    title: "Falha ao atualizar",
    description:
      "N\u00e3o foi poss\u00edvel recarregar seus documentos. Por favor, tente novamente.",
  },
  zh: {
    title: "\u5237\u65b0\u5931\u8d25",
    description:
      "\u65e0\u6cd5\u91cd\u65b0\u52a0\u8f7d\u60a8\u7684\u6587\u6863\u3002\u8bf7\u91cd\u8bd5\u3002",
  },
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("DocumentsView — refresh error toast keys across all six portal locales", () => {
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(locale);
      });

      it('renders the correct "documents.refreshError.title"', () => {
        const result = i18n.t("documents.refreshError.title", {
          ns: "portal",
          defaultValue: ENGLISH_TITLE,
        });

        expect(result).toBe(expected.title);
      });

      it('renders the correct "documents.refreshError.description"', () => {
        const result = i18n.t("documents.refreshError.description", {
          ns: "portal",
          defaultValue: ENGLISH_DESCRIPTION,
        });

        expect(result).toBe(expected.description);
      });

      if (locale !== "en") {
        it('"documents.refreshError.title" is not the English fallback', () => {
          const result = i18n.t("documents.refreshError.title", {
            ns: "portal",
            defaultValue: ENGLISH_TITLE,
          });

          expect(result).not.toBe(ENGLISH_TITLE);
        });

        it('"documents.refreshError.description" is not the English fallback', () => {
          const result = i18n.t("documents.refreshError.description", {
            ns: "portal",
            defaultValue: ENGLISH_DESCRIPTION,
          });

          expect(result).not.toBe(ENGLISH_DESCRIPTION);
        });
      }
    });
  }
});
