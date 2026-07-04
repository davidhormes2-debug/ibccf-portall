// @vitest-environment jsdom
/**
 * Task #259 — Component-level regression coverage for the financial-signatory
 * template download card in DocumentsView.
 *
 * WHY: The four translation keys (documents.card.templateTitle / templateBody /
 * templateDownload / templateDownloading) are rendered with English
 * `defaultValue` fallbacks, so a silent missing-key or namespace-wiring bug
 * would display English text to non-English users without any visible error.
 *
 * HOW: We render <DocumentsView> with a mocked PortalContext that supplies a
 * financial-signatory document request (documentType="source_of_funds",
 * status="pending"). Before each locale iteration we call
 * `i18n.changeLanguage(locale)` so that react-i18next picks up the real
 * locale resources — we deliberately do NOT mock react-i18next so the actual
 * translation pipeline is exercised. We then assert the rendered DOM contains
 * the expected translated title, body hint, and download-button label for
 * every one of the six supported locales.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

import i18n from "@/i18n";

// ── Mocks (before component import so vi.mock hoisting works) ──────────────

// framer-motion — passthrough so motion.div/div render as plain elements.
vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: React.ComponentPropsWithoutRef<typeof tag>) =>
      React.createElement(tag as string, rest as any, children);
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => passthrough(prop as keyof React.JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => null,
}));

vi.mock("@/components/DocumentPreview", () => ({
  DocumentPreview: () => null,
}));

// useFormat — stable stub so locale switches don't trip Intl in jsdom.
vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDate: (d: unknown) => String(d),
    formatDateTime: (d: unknown) => String(d),
    formatTime: (d: unknown) => String(d),
    formatNumber: (n: unknown) => String(n),
    formatCurrency: (n: unknown) => String(n),
    formatRelative: (d: unknown) => String(d),
  }),
}));

// PortalContext — supply a controlled financial-signatory document request.
// The document must have status="pending" so `canUpload` is true and the
// template download card renders; documentType="source_of_funds" is one of
// the FINANCIAL_SIGNATORY_TEMPLATES so `templateCategory` is non-null.
const FINANCIAL_SIGNATORY_DOC = {
  id: 1,
  caseId: "case-test",
  documentType: "source_of_funds",
  status: "pending",
  createdAt: new Date().toISOString(),
  uploadsEnabled: true,
};

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    documentRequests: [FINANCIAL_SIGNATORY_DOC],
    refreshDocumentRequests: vi.fn(async () => {}),
    submitDocument: vi.fn(async () => {}),
    pendingDocumentCount: 1,
    currentCase: { id: "case-test", accessCode: "WXYZ-0000" },
    userDocuments: [],
    uploadUserDocument: vi.fn(async () => {}),
    refreshUserDocuments: vi.fn(async () => {}),
  }),
}));

// ── Component under test ───────────────────────────────────────────────────

import { DocumentsView } from "../DocumentsView";

// ── Expected translated values per locale ──────────────────────────────────

const ENGLISH_TITLE = "Download pre-filled template";
const ENGLISH_BODY =
  "A pre-filled PDF template is available for this document. Download, sign offline, and upload the signed copy below.";
const ENGLISH_DOWNLOAD = "Download template";

interface LocaleExpectation {
  templateTitle: string;
  templateBody: string;
  templateDownload: string;
}

const EXPECTED: Record<string, LocaleExpectation> = {
  en: {
    templateTitle: ENGLISH_TITLE,
    templateBody: ENGLISH_BODY,
    templateDownload: ENGLISH_DOWNLOAD,
  },
  es: {
    templateTitle: "Descargar plantilla precargada",
    templateBody:
      "Hay una plantilla PDF precargada disponible para este documento. Desc\u00e1rguela, f\u00edrmela fuera de l\u00ednea y suba la copia firmada a continuaci\u00f3n.",
    templateDownload: "Descargar plantilla",
  },
  fr: {
    templateTitle: "T\u00e9l\u00e9charger le mod\u00e8le pr\u00e9rempli",
    templateBody:
      "Un mod\u00e8le PDF pr\u00e9rempli est disponible pour ce document. T\u00e9l\u00e9chargez-le, signez-le hors ligne et t\u00e9l\u00e9versez la copie sign\u00e9e ci-dessous.",
    templateDownload: "T\u00e9l\u00e9charger le mod\u00e8le",
  },
  de: {
    templateTitle: "Vorausgef\u00fcllte Vorlage herunterladen",
    templateBody:
      "F\u00fcr dieses Dokument steht eine vorausgef\u00fcllte PDF-Vorlage zur Verf\u00fcgung. Herunterladen, offline unterschreiben und die unterschriebene Kopie unten hochladen.",
    templateDownload: "Vorlage herunterladen",
  },
  pt: {
    templateTitle: "Baixar modelo pr\u00e9-preenchido",
    templateBody:
      "Um modelo PDF pr\u00e9-preenchido est\u00e1 dispon\u00edvel para este documento. Baixe, assine offline e envie a c\u00f3pia assinada abaixo.",
    templateDownload: "Baixar modelo",
  },
  zh: {
    templateTitle: "\u4e0b\u8f7d\u9884\u586b\u6a21\u677f",
    templateBody:
      "\u6b64\u6587\u4ef6\u6709\u53ef\u7528\u7684\u9884\u586b PDF \u6a21\u677f\u3002\u8bf7\u4e0b\u8f7d\u3001\u79bb\u7ebf\u7b7e\u7f72\u5e76\u5728\u4e0b\u65b9\u4e0a\u4f20\u5df2\u7b7e\u7f72\u7684\u526f\u672c\u3002",
    templateDownload: "\u4e0b\u8f7d\u6a21\u677f",
  },
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DocumentsView — financial-signatory template card renders translated strings", () => {
  for (const [locale, expected] of Object.entries(EXPECTED)) {
    describe(`locale: ${locale}`, () => {
      beforeEach(async () => {
        await act(async () => {
          await i18n.changeLanguage(locale);
        });
      });

      it("renders the template card for the financial-signatory document", () => {
        render(<DocumentsView />);
        expect(
          screen.getByTestId("document-template-1"),
        ).toBeTruthy();
      });

      it("shows the correct translated template title", () => {
        render(<DocumentsView />);
        expect(screen.getByText(expected.templateTitle)).toBeTruthy();
      });

      it("shows the correct translated body hint", () => {
        render(<DocumentsView />);
        expect(screen.getByText(expected.templateBody)).toBeTruthy();
      });

      it("shows the correct translated download button label", () => {
        render(<DocumentsView />);
        const btn = screen.getByTestId("button-download-template-1");
        expect(btn.textContent).toContain(expected.templateDownload);
      });

      if (locale !== "en") {
        it("does not fall back to English for the template title", () => {
          render(<DocumentsView />);
          expect(screen.queryByText(ENGLISH_TITLE)).toBeNull();
        });

        it("does not fall back to English for the body hint", () => {
          render(<DocumentsView />);
          expect(screen.queryByText(ENGLISH_BODY)).toBeNull();
        });

        it("does not fall back to English for the download button label", () => {
          render(<DocumentsView />);
          const btn = screen.getByTestId("button-download-template-1");
          expect(btn.textContent).not.toContain(ENGLISH_DOWNLOAD);
        });
      }
    });
  }
});
