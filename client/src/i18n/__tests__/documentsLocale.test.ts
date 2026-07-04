// @vitest-environment jsdom
/**
 * Regression coverage for the financial-signatory template download strings
 * introduced in Task #221 (documents.card.templateTitle / templateBody /
 * templateDownload / templateDownloading in the `portal` namespace).
 *
 * Why this test matters: The four keys are used in DocumentsView.tsx with
 * English `defaultValue` fallbacks, so a silent missing-key or typo regression
 * would still render something — the wrong (English) text — for users in all
 * five non-English locales. This test locks in the exact translated value for
 * every locale so any future key removal or namespace mis-registration is
 * caught immediately.
 *
 * Approach: initialise the shared i18n instance, switch locale, call i18n.t()
 * in the portal namespace, and assert the returned string matches the expected
 * translated text rather than the English fallback.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../index";

const ENGLISH = {
  templateTitle: "Download pre-filled template",
  templateBody:
    "A pre-filled PDF template is available for this document. Download, sign offline, and upload the signed copy below.",
  templateDownload: "Download template",
  templateDownloading: "Preparing\u2026",
};

const EXPECTED: Record<
  string,
  {
    templateTitle: string;
    templateBody: string;
    templateDownload: string;
    templateDownloading: string;
  }
> = {
  en: ENGLISH,
  es: {
    templateTitle: "Descargar plantilla precargada",
    templateBody:
      "Hay una plantilla PDF precargada disponible para este documento. Desc\u00e1rguela, f\u00edrmela fuera de l\u00ednea y suba la copia firmada a continuaci\u00f3n.",
    templateDownload: "Descargar plantilla",
    templateDownloading: "Preparando\u2026",
  },
  fr: {
    templateTitle: "T\u00e9l\u00e9charger le mod\u00e8le pr\u00e9rempli",
    templateBody:
      "Un mod\u00e8le PDF pr\u00e9rempli est disponible pour ce document. T\u00e9l\u00e9chargez-le, signez-le hors ligne et t\u00e9l\u00e9versez la copie sign\u00e9e ci-dessous.",
    templateDownload: "T\u00e9l\u00e9charger le mod\u00e8le",
    templateDownloading: "Pr\u00e9paration\u2026",
  },
  de: {
    templateTitle: "Vorausgef\u00fcllte Vorlage herunterladen",
    templateBody:
      "F\u00fcr dieses Dokument steht eine vorausgef\u00fcllte PDF-Vorlage zur Verf\u00fcgung. Herunterladen, offline unterschreiben und die unterschriebene Kopie unten hochladen.",
    templateDownload: "Vorlage herunterladen",
    templateDownloading: "Wird vorbereitet\u2026",
  },
  pt: {
    templateTitle: "Baixar modelo pr\u00e9-preenchido",
    templateBody:
      "Um modelo PDF pr\u00e9-preenchido est\u00e1 dispon\u00edvel para este documento. Baixe, assine offline e envie a c\u00f3pia assinada abaixo.",
    templateDownload: "Baixar modelo",
    templateDownloading: "Preparando\u2026",
  },
  zh: {
    templateTitle: "\u4e0b\u8f7d\u9884\u586b\u6a21\u677f",
    templateBody:
      "\u6b64\u6587\u4ef6\u6709\u53ef\u7528\u7684\u9884\u586b PDF \u6a21\u677f\u3002\u8bf7\u4e0b\u8f7d\u3001\u79bb\u7ebf\u7b7e\u7f72\u5e76\u5728\u4e0b\u65b9\u4e0a\u4f20\u5df2\u7b7e\u7f72\u7684\u526f\u672c\u3002",
    templateDownload: "\u4e0b\u8f7d\u6a21\u677f",
    templateDownloading: "\u51c6\u5907\u4e2d\u2026",
  },
};

const TEMPLATE_KEYS = [
  "documents.card.templateTitle",
  "documents.card.templateBody",
  "documents.card.templateDownload",
  "documents.card.templateDownloading",
] as const;

type TemplateKey = (typeof TEMPLATE_KEYS)[number];

function leafKey(dotKey: TemplateKey): keyof (typeof EXPECTED)[string] {
  return dotKey.replace("documents.card.", "") as keyof (typeof EXPECTED)[string];
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Documents view — financial-signatory template strings across all six portal locales", () => {
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(locale);
      });

      for (const dotKey of TEMPLATE_KEYS) {
        const shortKey = leafKey(dotKey);

        it(`renders the correct "${shortKey}" string`, () => {
          const result = i18n.t(dotKey, {
            ns: "portal",
            defaultValue: ENGLISH[shortKey],
          });

          expect(result).toBe(expected[shortKey]);
        });

        if (locale !== "en") {
          it(`"${shortKey}" is not the English fallback`, () => {
            const result = i18n.t(dotKey, {
              ns: "portal",
              defaultValue: ENGLISH[shortKey],
            });

            expect(result).not.toBe(ENGLISH[shortKey]);
          });
        }
      }
    });
  }
});
