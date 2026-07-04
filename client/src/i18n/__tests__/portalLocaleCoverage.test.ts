// @vitest-environment jsdom
/**
 * Regression coverage for translated strings in additional portal views
 * beyond the Documents view (Task #307, follow-up to documentsLocale.test.ts).
 *
 * Why this test matters: All of the keys covered here are consumed by React
 * code that passes English `defaultValue` (or relies on i18next's English
 * fallback) — so a silent missing-key / typo / namespace-mis-registration
 * regression would render the English string for non-English users without
 * any visible error. Locking the exact translated values per locale catches
 * those regressions immediately.
 *
 * Coverage groups:
 *   1. Dashboard stage CTA card     — `portal` → `stageCta.<n>.label/headline`
 *                                     + `dashboard.stageCta.*` interpolated
 *                                     copy + `stageBlocker.*` badges.
 *                                     Backed by `shared/stageInstructions.ts`
 *                                     stage metadata consumed in
 *                                     `client/src/pages/portal/DashboardView.tsx`.
 *   2. Account History view         — `portal` → `accountHistory.*` rendered
 *                                     by `client/src/components/portal/
 *                                     AccountHistoryCard.tsx`.
 *   3. Declaration section labels   — `declaration` → `sections.*.title`
 *                                     rendered by
 *                                     `client/src/pages/portal/DeclarationView.tsx`.
 *
 * Approach mirrors documentsLocale.test.ts: initialise the shared i18n
 * instance, switch locale, call i18n.t() in the right namespace, and assert
 * the returned string equals the locked translated value rather than the
 * English fallback.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../index";
import enPortal from "../locales/en/portal.json";
import esPortal from "../locales/es/portal.json";
import frPortal from "../locales/fr/portal.json";
import dePortal from "../locales/de/portal.json";
import ptPortal from "../locales/pt/portal.json";
import zhPortal from "../locales/zh/portal.json";

type Locale = "en" | "es" | "fr" | "de" | "pt" | "zh";

const LOCALES: Locale[] = ["en", "es", "fr", "de", "pt", "zh"];

// ---------------------------------------------------------------------------
// Group 1 — Dashboard stage CTA card
// ---------------------------------------------------------------------------
// Lock representative stages from the 1–14 set (early, mid, late, final) so
// the test stays focused while still covering the full key shape used by
// DashboardView. Headlines for stages 7 and 10 are templated copy in the
// `dashboard.stageCta` subtree.
// ---------------------------------------------------------------------------

interface StageCtaCopy {
  stage1Label: string;
  stage1Headline: string;
  stage7Label: string;
  stage7Headline: string;
  stage11Label: string;
  stage11Headline: string;
  stage14Label: string;
  stage14Headline: string;
}

const STAGE_CTA: Record<Locale, StageCtaCopy> = {
  en: {
    stage1Label: "View Compliance Updates",
    stage1Headline: "Deposit confirmed — case is now active",
    stage7Label: "Pay Merge Deposit",
    stage7Headline: "Phrase Key Merge Deposit required to continue",
    stage11Label: "Sign Declaration",
    stage11Headline: "Sign the Declaration of Compliance to advance",
    stage14Label: "Open Withdrawal Activation",
    stage14Headline: "Complete Withdrawal Activation to release funds",
  },
  es: {
    stage1Label: "Ver actualizaciones de cumplimiento",
    stage1Headline: "Dep\u00f3sito confirmado \u2014 su caso est\u00e1 activo",
    stage7Label: "Pagar dep\u00f3sito de fusi\u00f3n",
    stage7Headline: "Se requiere el dep\u00f3sito de fusi\u00f3n de la clave de frase para continuar",
    stage11Label: "Firmar declaraci\u00f3n",
    stage11Headline: "Firme la Declaraci\u00f3n de Cumplimiento para avanzar",
    stage14Label: "Abrir activaci\u00f3n de retiro",
    stage14Headline: "Complete la activaci\u00f3n de retiro para liberar los fondos",
  },
  fr: {
    stage1Label: "Voir les mises \u00e0 jour de conformit\u00e9",
    stage1Headline: "D\u00e9p\u00f4t confirm\u00e9 \u2014 votre dossier est actif",
    stage7Label: "Payer le d\u00e9p\u00f4t de fusion",
    stage7Headline: "D\u00e9p\u00f4t de fusion de la cl\u00e9 de phrase requis pour continuer",
    stage11Label: "Signer la d\u00e9claration",
    stage11Headline: "Signez la D\u00e9claration de Conformit\u00e9 pour avancer",
    stage14Label: "Ouvrir l'activation du retrait",
    stage14Headline: "Compl\u00e9tez l'activation du retrait pour d\u00e9bloquer les fonds",
  },
  de: {
    stage1Label: "Compliance-Updates anzeigen",
    stage1Headline: "Einzahlung best\u00e4tigt \u2014 Fall ist jetzt aktiv",
    stage7Label: "Merge-Einzahlung leisten",
    stage7Headline: "Phrase-Key-Merge-Einzahlung erforderlich, um fortzufahren",
    stage11Label: "Erkl\u00e4rung unterzeichnen",
    stage11Headline: "Erkl\u00e4rung zur Einhaltung unterzeichnen, um fortzufahren",
    stage14Label: "Auszahlungs-Aktivierung \u00f6ffnen",
    stage14Headline: "Auszahlungs-Aktivierung abschlie\u00dfen, um Mittel freizugeben",
  },
  pt: {
    stage1Label: "Ver atualiza\u00e7\u00f5es de conformidade",
    stage1Headline: "Dep\u00f3sito confirmado \u2014 caso est\u00e1 ativo",
    stage7Label: "Pagar dep\u00f3sito de fus\u00e3o",
    stage7Headline: "Dep\u00f3sito de fus\u00e3o da chave-frase \u00e9 necess\u00e1rio para continuar",
    stage11Label: "Assinar declara\u00e7\u00e3o",
    stage11Headline: "Assine a Declara\u00e7\u00e3o de Conformidade para avan\u00e7ar",
    stage14Label: "Abrir ativa\u00e7\u00e3o de saque",
    stage14Headline: "Conclua a ativa\u00e7\u00e3o de saque para liberar os fundos",
  },
  zh: {
    stage1Label: "\u67e5\u770b\u5408\u89c4\u66f4\u65b0",
    stage1Headline: "\u5b58\u6b3e\u5df2\u786e\u8ba4 \u2014 \u6848\u4ef6\u73b0\u5df2\u6fc0\u6d3b",
    stage7Label: "\u652f\u4ed8\u5408\u5e76\u5b58\u6b3e",
    stage7Headline: "\u7ee7\u7eed\u64cd\u4f5c\u9700\u652f\u4ed8\u77ed\u8bed\u5bc6\u94a5\u5408\u5e76\u5b58\u6b3e",
    stage11Label: "\u7b7e\u7f72\u58f0\u660e",
    stage11Headline: "\u7b7e\u7f72\u5408\u89c4\u58f0\u660e\u4ee5\u7ee7\u7eed",
    stage14Label: "\u6253\u5f00\u63d0\u6b3e\u6fc0\u6d3b",
    stage14Headline: "\u5b8c\u6210\u63d0\u6b3e\u6fc0\u6d3b\u4ee5\u91ca\u653e\u8d44\u91d1",
  },
};

interface StageBlockerCopy {
  userAction: string;
  adminAction: string;
  systemProcessing: string;
}

const STAGE_BLOCKER: Record<Locale, StageBlockerCopy> = {
  en: {
    userAction: "Action needed from you",
    adminAction: "Waiting on compliance team",
    systemProcessing: "System processing",
  },
  es: {
    userAction: "Acci\u00f3n requerida por usted",
    adminAction: "Esperando al equipo de cumplimiento",
    systemProcessing: "Procesamiento del sistema",
  },
  fr: {
    userAction: "Action requise de votre part",
    adminAction: "En attente de l'\u00e9quipe de conformit\u00e9",
    systemProcessing: "Traitement par le syst\u00e8me",
  },
  de: {
    userAction: "Aktion von Ihnen erforderlich",
    adminAction: "Warten auf Compliance-Team",
    systemProcessing: "Systemverarbeitung",
  },
  pt: {
    userAction: "A\u00e7\u00e3o necess\u00e1ria da sua parte",
    adminAction: "Aguardando equipe de conformidade",
    systemProcessing: "Processamento do sistema",
  },
  zh: {
    userAction: "\u9700\u8981\u60a8\u91c7\u53d6\u884c\u52a8",
    adminAction: "\u7b49\u5f85\u5408\u89c4\u56e2\u961f",
    systemProcessing: "\u7cfb\u7edf\u5904\u7406\u4e2d",
  },
};

interface DashboardStageCtaCopy {
  stage7AmountLabel: string;
  whatYouCanDo: string;
  stageOf: string; // already interpolated with stage=4
  advanced: string; // already interpolated with from=3 to=4
}

const DASHBOARD_STAGE_CTA: Record<Locale, DashboardStageCtaCopy> = {
  en: {
    stage7AmountLabel: "Phrase Key Merge Deposit",
    whatYouCanDo: "What you can do now",
    stageOf: "Stage 4 of 14",
    advanced: "Stage advanced \u00b7 3 \u2192 4",
  },
  es: {
    stage7AmountLabel: "Dep\u00f3sito de Fusi\u00f3n de Clave Frase",
    whatYouCanDo: "Lo que puede hacer ahora",
    stageOf: "Etapa 4 de 14",
    advanced: "Etapa avanzada \u00b7 3 \u2192 4",
  },
  fr: {
    stage7AmountLabel: "D\u00e9p\u00f4t de Fusion de Cl\u00e9 de Phrase",
    whatYouCanDo: "Ce que vous pouvez faire maintenant",
    stageOf: "\u00c9tape 4 sur 14",
    advanced: "\u00c9tape avanc\u00e9e \u00b7 3 \u2192 4",
  },
  de: {
    stage7AmountLabel: "Schl\u00fcsselphrase Zusammenf\u00fchrungs-Einzahlung",
    whatYouCanDo: "Was Sie jetzt tun k\u00f6nnen",
    stageOf: "Phase 4 von 14",
    advanced: "Phase fortgeschritten \u00b7 3 \u2192 4",
  },
  pt: {
    stage7AmountLabel: "Dep\u00f3sito de Fus\u00e3o de Chave de Frase",
    whatYouCanDo: "O que voc\u00ea pode fazer agora",
    stageOf: "Etapa 4 de 14",
    advanced: "Etapa avan\u00e7ada \u00b7 3 \u2192 4",
  },
  zh: {
    stage7AmountLabel: "\u77ed\u8bed\u5bc6\u94a5\u5408\u5e76\u5b58\u6b3e",
    whatYouCanDo: "\u60a8\u73b0\u5728\u53ef\u4ee5\u505a\u4ec0\u4e48",
    stageOf: "\u7b2c 4 \u9636\u6bb5\uff0c\u5171 14 \u9636\u6bb5",
    advanced: "\u9636\u6bb5\u5df2\u63a8\u8fdb \u00b7 3 \u2192 4",
  },
};

// ---------------------------------------------------------------------------
// Group 2 — Account History view (`portal` namespace, `accountHistory.*`)
// ---------------------------------------------------------------------------

interface AccountHistoryCopy {
  title: string;
  subtitle: string;
  recordsTitle: string;
  displayOnly: string;
  loading: string;
  loadError: string;
  empty: string;
  credit: string;
  debit: string;
  disclaimer: string;
}

const ACCOUNT_HISTORY: Record<Locale, AccountHistoryCopy> = {
  en: {
    title: "Account History",
    subtitle: "Credits and debits recorded against your case",
    recordsTitle: "Ledger Entries",
    displayOnly: "Display only",
    loading: "Loading your account history\u2026",
    loadError:
      "We couldn't load your account history. Please try again later.",
    empty: "No ledger entries have been recorded on your case yet.",
    credit: "Credit",
    debit: "Debit",
    disclaimer:
      "IBCCF is display-only. These entries reflect your case officer's accounting record and do not move funds.",
  },
  es: {
    title: "Historial de cuenta",
    subtitle: "Cr\u00e9ditos y d\u00e9bitos registrados en su caso",
    recordsTitle: "Asientos contables",
    displayOnly: "Solo visualizaci\u00f3n",
    loading: "Cargando su historial de cuenta\u2026",
    loadError:
      "No pudimos cargar su historial de cuenta. Int\u00e9ntelo de nuevo m\u00e1s tarde.",
    empty: "A\u00fan no se han registrado asientos en su caso.",
    credit: "Cr\u00e9dito",
    debit: "D\u00e9bito",
    disclaimer:
      "IBCCF es solo de visualizaci\u00f3n. Estos asientos reflejan el registro contable de su oficial de caso y no mueven fondos.",
  },
  fr: {
    title: "Historique du compte",
    subtitle: "Cr\u00e9dits et d\u00e9bits enregistr\u00e9s sur votre dossier",
    recordsTitle: "\u00c9critures du registre",
    displayOnly: "Affichage uniquement",
    loading: "Chargement de votre historique de compte\u2026",
    loadError:
      "Impossible de charger votre historique de compte. Veuillez r\u00e9essayer plus tard.",
    empty:
      "Aucune \u00e9criture n'a encore \u00e9t\u00e9 enregistr\u00e9e sur votre dossier.",
    credit: "Cr\u00e9dit",
    debit: "D\u00e9bit",
    disclaimer:
      "IBCCF est uniquement \u00e0 but d'affichage. Ces \u00e9critures refl\u00e8tent le registre comptable de votre charg\u00e9 de dossier et ne d\u00e9placent pas de fonds.",
  },
  de: {
    title: "Kontohistorie",
    subtitle: "Auf Ihrem Fall verbuchte Gutschriften und Belastungen",
    recordsTitle: "Hauptbucheintr\u00e4ge",
    displayOnly: "Nur Anzeige",
    loading: "Kontohistorie wird geladen\u2026",
    loadError:
      "Kontohistorie konnte nicht geladen werden. Bitte sp\u00e4ter erneut versuchen.",
    empty: "Auf Ihrem Fall wurden noch keine Eintr\u00e4ge verbucht.",
    credit: "Gutschrift",
    debit: "Belastung",
    disclaimer:
      "IBCCF dient nur der Anzeige. Diese Eintr\u00e4ge spiegeln den Buchungsstand Ihres Fallbearbeiters wider und bewegen keine Mittel.",
  },
  pt: {
    title: "Hist\u00f3rico da conta",
    subtitle: "Cr\u00e9ditos e d\u00e9bitos registados no seu caso",
    recordsTitle: "Lan\u00e7amentos cont\u00e1beis",
    displayOnly: "Apenas visualiza\u00e7\u00e3o",
    loading: "A carregar o hist\u00f3rico da sua conta\u2026",
    loadError:
      "N\u00e3o foi poss\u00edvel carregar o hist\u00f3rico da sua conta. Tente novamente mais tarde.",
    empty: "Ainda n\u00e3o foram registados lan\u00e7amentos no seu caso.",
    credit: "Cr\u00e9dito",
    debit: "D\u00e9bito",
    disclaimer:
      "O IBCCF \u00e9 apenas para visualiza\u00e7\u00e3o. Estes lan\u00e7amentos refletem o registo contabil\u00edstico do seu oficial respons\u00e1vel e n\u00e3o movimentam fundos.",
  },
  zh: {
    title: "\u8d26\u6237\u5386\u53f2",
    subtitle: "\u8bb0\u5165\u60a8\u6848\u4ef6\u7684\u8d37\u8bb0\u548c\u501f\u8bb0",
    recordsTitle: "\u5206\u7c7b\u8d26\u6761\u76ee",
    displayOnly: "\u4ec5\u4f9b\u663e\u793a",
    loading: "\u6b63\u5728\u52a0\u8f7d\u60a8\u7684\u8d26\u6237\u5386\u53f2\u2026",
    loadError:
      "\u65e0\u6cd5\u52a0\u8f7d\u60a8\u7684\u8d26\u6237\u5386\u53f2\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
    empty:
      "\u60a8\u7684\u6848\u4ef6\u4e2d\u5c1a\u672a\u8bb0\u5f55\u4efb\u4f55\u6761\u76ee\u3002",
    credit: "\u8d37\u8bb0",
    debit: "\u501f\u8bb0",
    disclaimer:
      "IBCCF \u4ec5\u4f9b\u663e\u793a\u3002\u8fd9\u4e9b\u6761\u76ee\u53cd\u6620\u60a8\u6848\u4ef6\u5b98\u5458\u7684\u4f1a\u8ba1\u8bb0\u5f55\uff0c\u4e0d\u4f1a\u8f6c\u79fb\u4efb\u4f55\u8d44\u91d1\u3002",
  },
};

// ---------------------------------------------------------------------------
// Group 3 — Declaration section labels (`declaration` namespace,
// `sections.<sectionKey>.title`).
// ---------------------------------------------------------------------------

interface DeclarationSectionCopy {
  personal: string;
  sanctions: string;
  asset: string;
  income: string;
  regulatory: string;
  terms: string;
  signature: string;
}

const DECLARATION_SECTIONS: Record<Locale, DeclarationSectionCopy> = {
  en: {
    personal: "Personal Identification",
    sanctions: "Sanctions Compliance Declaration",
    asset: "Approved Asset Confirmation",
    income: "Source of Income",
    regulatory: "Regulatory Acknowledgment",
    terms: "Regulatory Terms & Access Code Authenticator",
    signature: "Signature & Authorization",
  },
  es: {
    personal: "Identificaci\u00f3n Personal",
    sanctions: "Declaraci\u00f3n de Cumplimiento de Sanciones",
    asset: "Confirmaci\u00f3n de Activo Aprobado",
    income: "Fuente de Ingresos",
    regulatory: "Reconocimiento Regulatorio",
    terms:
      "T\u00e9rminos Regulatorios y Autenticador de C\u00f3digo de Acceso",
    signature: "Firma y Autorizaci\u00f3n",
  },
  fr: {
    personal: "Identification Personnelle",
    sanctions: "D\u00e9claration de Conformit\u00e9 aux Sanctions",
    asset: "Confirmation d'Actif Approuv\u00e9",
    income: "Source de Revenus",
    regulatory: "Reconnaissance R\u00e9glementaire",
    terms:
      "Termes R\u00e9glementaires & Authentificateur de Code d'Acc\u00e8s",
    signature: "Signature & Autorisation",
  },
  de: {
    personal: "Pers\u00f6nliche Identifikation",
    sanctions: "Erkl\u00e4rung zur Einhaltung von Sanktionen",
    asset: "Best\u00e4tigung genehmigter Verm\u00f6genswerte",
    income: "Einkommensquelle",
    regulatory: "Regulatorische Anerkennung",
    terms: "Regulatorische Bedingungen & Zugangscode-Authentifizierer",
    signature: "Unterschrift & Autorisierung",
  },
  pt: {
    personal: "Identifica\u00e7\u00e3o Pessoal",
    sanctions: "Declara\u00e7\u00e3o de Conformidade com San\u00e7\u00f5es",
    asset: "Confirma\u00e7\u00e3o de Ativo Aprovado",
    income: "Fonte de Renda",
    regulatory: "Reconhecimento Regulat\u00f3rio",
    terms: "Termos Regulat\u00f3rios & Autenticador de C\u00f3digo de Acesso",
    signature: "Assinatura & Autoriza\u00e7\u00e3o",
  },
  zh: {
    personal: "\u4e2a\u4eba\u8eab\u4efd\u8bc6\u522b",
    sanctions: "\u5236\u88c1\u5408\u89c4\u58f0\u660e",
    asset: "\u6279\u51c6\u8d44\u4ea7\u786e\u8ba4",
    income: "\u6536\u5165\u6765\u6e90",
    regulatory: "\u76d1\u7ba1\u786e\u8ba4",
    terms: "\u76d1\u7ba1\u6761\u6b3e\u4e0e\u8bbf\u95ee\u4ee3\u7801\u8ba4\u8bc1",
    signature: "\u7b7e\u540d\u4e0e\u6388\u6743",
  },
};

// ---------------------------------------------------------------------------
// Group 4 — Dashboard Withdrawal Guide (`portal` namespace,
// `dashboard.withdrawalGuide.*`). Driven directly off the JSON files so any
// added key in `en/portal.json` is automatically required in every other
// locale and a regression that leaves a value identical to the English source
// is caught immediately.
// ---------------------------------------------------------------------------

const PORTAL_JSON: Record<Locale, Record<string, unknown>> = {
  en: enPortal as Record<string, unknown>,
  es: esPortal as Record<string, unknown>,
  fr: frPortal as Record<string, unknown>,
  de: dePortal as Record<string, unknown>,
  pt: ptPortal as Record<string, unknown>,
  zh: zhPortal as Record<string, unknown>,
};

function getWithdrawalGuide(
  bundle: Record<string, unknown>,
): Record<string, string> | undefined {
  const dashboard = bundle.dashboard as
    | Record<string, unknown>
    | undefined;
  const guide = dashboard?.withdrawalGuide as
    | Record<string, string>
    | undefined;
  return guide;
}

const WITHDRAWAL_GUIDE_KEYS = Object.keys(
  getWithdrawalGuide(PORTAL_JSON.en) ?? {},
);

// ---------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Portal locale coverage — additional translated views", () => {
  for (const locale of LOCALES) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await i18n.changeLanguage(locale);
      });

      // ---------------- Dashboard stage CTA card ----------------
      describe("Dashboard stage CTA card (portal: stageCta.* / stageBlocker.* / dashboard.stageCta.*)", () => {
        const stageCases: Array<{
          stage: 1 | 7 | 11 | 14;
          labelField: keyof StageCtaCopy;
          headlineField: keyof StageCtaCopy;
        }> = [
          { stage: 1, labelField: "stage1Label", headlineField: "stage1Headline" },
          { stage: 7, labelField: "stage7Label", headlineField: "stage7Headline" },
          { stage: 11, labelField: "stage11Label", headlineField: "stage11Headline" },
          { stage: 14, labelField: "stage14Label", headlineField: "stage14Headline" },
        ];

        for (const { stage, labelField, headlineField } of stageCases) {
          it(`stage ${stage} label and headline match`, () => {
            const expected = STAGE_CTA[locale];
            const english = STAGE_CTA.en;

            const label = i18n.t(`stageCta.${stage}.label`, {
              ns: "portal",
              defaultValue: english[labelField],
            });
            const headline = i18n.t(`stageCta.${stage}.headline`, {
              ns: "portal",
              defaultValue: english[headlineField],
            });

            expect(label).toBe(expected[labelField]);
            expect(headline).toBe(expected[headlineField]);

            if (locale !== "en") {
              expect(label).not.toBe(english[labelField]);
              expect(headline).not.toBe(english[headlineField]);
            }
          });
        }

        it("stageBlocker badges are translated", () => {
          const expected = STAGE_BLOCKER[locale];
          const english = STAGE_BLOCKER.en;

          const user = i18n.t("stageBlocker.userAction", {
            ns: "portal",
            defaultValue: english.userAction,
          });
          const admin = i18n.t("stageBlocker.adminAction", {
            ns: "portal",
            defaultValue: english.adminAction,
          });
          const system = i18n.t("stageBlocker.systemProcessing", {
            ns: "portal",
            defaultValue: english.systemProcessing,
          });

          expect(user).toBe(expected.userAction);
          expect(admin).toBe(expected.adminAction);
          expect(system).toBe(expected.systemProcessing);

          if (locale !== "en") {
            expect(user).not.toBe(english.userAction);
            expect(admin).not.toBe(english.adminAction);
            expect(system).not.toBe(english.systemProcessing);
          }
        });

        it("dashboard.stageCta.* copy (amount label, whatYouCanDo, stageOf, advanced) is translated", () => {
          const expected = DASHBOARD_STAGE_CTA[locale];
          const english = DASHBOARD_STAGE_CTA.en;

          const amountLabel = i18n.t("dashboard.stageCta.stage7AmountLabel", {
            ns: "portal",
            defaultValue: english.stage7AmountLabel,
          });
          const whatYouCanDo = i18n.t("dashboard.stageCta.whatYouCanDo", {
            ns: "portal",
            defaultValue: english.whatYouCanDo,
          });
          const stageOf = i18n.t("dashboard.stageCta.stageOf", {
            ns: "portal",
            stage: 4,
            defaultValue: english.stageOf,
          });
          const advanced = i18n.t("dashboard.stageCta.advanced", {
            ns: "portal",
            from: 3,
            to: 4,
            defaultValue: english.advanced,
          });

          expect(amountLabel).toBe(expected.stage7AmountLabel);
          expect(whatYouCanDo).toBe(expected.whatYouCanDo);
          expect(stageOf).toBe(expected.stageOf);
          expect(advanced).toBe(expected.advanced);

          if (locale !== "en") {
            expect(amountLabel).not.toBe(english.stage7AmountLabel);
            expect(whatYouCanDo).not.toBe(english.whatYouCanDo);
            expect(stageOf).not.toBe(english.stageOf);
            expect(advanced).not.toBe(english.advanced);
          }
        });
      });

      // ---------------- Account History view --------------------
      describe("Account History view (portal: accountHistory.*)", () => {
        const fields: Array<keyof AccountHistoryCopy> = [
          "title",
          "subtitle",
          "recordsTitle",
          "displayOnly",
          "loading",
          "loadError",
          "empty",
          "credit",
          "debit",
          "disclaimer",
        ];

        for (const field of fields) {
          it(`renders the correct "${field}" string`, () => {
            const english = ACCOUNT_HISTORY.en[field];
            const expected = ACCOUNT_HISTORY[locale][field];

            const result = i18n.t(`accountHistory.${field}`, {
              ns: "portal",
              defaultValue: english,
            });

            expect(result).toBe(expected);

            if (locale !== "en") {
              expect(result).not.toBe(english);
            }
          });
        }
      });

      // ---------------- Dashboard Withdrawal Guide --------------
      describe("Dashboard Withdrawal Guide (portal: dashboard.withdrawalGuide.*)", () => {
        const englishGuide = getWithdrawalGuide(PORTAL_JSON.en);
        const localeGuide = getWithdrawalGuide(PORTAL_JSON[locale]);

        it("locale bundle contains every withdrawalGuide key from English", () => {
          expect(englishGuide).toBeDefined();
          expect(localeGuide).toBeDefined();
          expect(WITHDRAWAL_GUIDE_KEYS.length).toBeGreaterThan(0);

          const missing = WITHDRAWAL_GUIDE_KEYS.filter(
            (key) =>
              typeof localeGuide?.[key] !== "string" ||
              (localeGuide?.[key] ?? "").trim().length === 0,
          );
          expect(missing).toEqual([]);
        });

        for (const key of WITHDRAWAL_GUIDE_KEYS) {
          it(`"${key}" is translated and not falling back to English`, () => {
            const english = englishGuide?.[key] ?? "";
            const expected = localeGuide?.[key] ?? "";

            const result = i18n.t(`dashboard.withdrawalGuide.${key}`, {
              ns: "portal",
              defaultValue: english,
            });

            expect(result).toBe(expected);

            if (locale !== "en") {
              expect(result).not.toBe(english);
            }
          });
        }
      });

      // ---------------- Declaration section labels --------------
      describe("Declaration sections (declaration: sections.*.title)", () => {
        const fields: Array<keyof DeclarationSectionCopy> = [
          "personal",
          "sanctions",
          "asset",
          "income",
          "regulatory",
          "terms",
          "signature",
        ];

        for (const field of fields) {
          it(`section "${field}" title is translated`, () => {
            const english = DECLARATION_SECTIONS.en[field];
            const expected = DECLARATION_SECTIONS[locale][field];

            const result = i18n.t(`sections.${field}.title`, {
              ns: "declaration",
              defaultValue: english,
            });

            expect(result).toBe(expected);

            if (locale !== "en") {
              expect(result).not.toBe(english);
            }
          });
        }
      });
    });
  }
});
