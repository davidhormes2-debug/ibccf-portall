// @vitest-environment jsdom
//
// Task #93 — Regression guard for the portal signing screen.
// Task #87 already proves the three server NDA routes ignore a non-
// English `?locale=` / `{locale}` override while the runtime flag is
// ON. This test pins the *client* half of the contract: the signing
// view must hide (disable) the per-document language picker and
// collapse the preview to English the moment `GET /api/cases/:id/nda`
// reports `signingLocales: ['en']`. A regression that ignored the
// flag client-side would let a user pick e.g. French in the picker,
// POST it to /sign — the server would still seal in English thanks to
// Task #87, but the user would have seen a French preview right
// before sealing. This test would catch that mismatch.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// ---- Mocks (must precede the SealedView import) ---------------------------

// Replace the Radix-based Select with a plain native <select> so the
// test can read its disabled state and trigger a value change without
// fighting JSDOM's missing pointer-capture APIs. The contract we care
// about (value, disabled, onValueChange, list of <option>s) is
// preserved verbatim.
vi.mock("@/components/ui/select", () => {
  const SelectCtx = React.createContext<{
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
  } | null>(null);

  const collectItems = (children: React.ReactNode): React.ReactElement[] => {
    const out: React.ReactElement[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const c = child as React.ReactElement<any>;
      if ((c.type as any)?.displayName === "SelectItem") {
        out.push(c);
      } else if (c.props && (c.props as any).children) {
        out.push(...collectItems((c.props as any).children));
      }
    });
    return out;
  };

  const Select = ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => {
    const items = collectItems(children);
    return (
      <SelectCtx.Provider value={{ value, onValueChange, disabled }}>
        <select
          data-testid="nda-doc-locale-select"
          aria-label="Document language"
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
        >
          {items.map((it) => (
            <option key={(it.props as any).value} value={(it.props as any).value}>
              {(it.props as any).children}
            </option>
          ))}
        </select>
        {children}
      </SelectCtx.Provider>
    );
  };
  const SelectTrigger = ({ children }: { children?: React.ReactNode }) => (
    <div data-mock-select-trigger>{children}</div>
  );
  const SelectValue = () => null;
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <div data-mock-select-content style={{ display: "none" }}>
      {children}
    </div>
  );
  const SelectItem: React.FC<{ value: string; children?: React.ReactNode }> = ({
    children,
  }) => <>{children}</>;
  (SelectItem as any).displayName = "SelectItem";
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

vi.mock("framer-motion", () => {
  const passthrough = (Tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: any) =>
      React.createElement(Tag, rest, children);
    C.displayName = `motion.${String(Tag)}`;
    return C;
  };
  return {
    motion: new Proxy(
      {},
      {
        get: (_t, prop: string) => passthrough(prop as any),
      },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

const currentCase = { id: "case-eos-1", accessCode: "EOSE-9999" };
vi.mock("../PortalContext", () => ({
  usePortal: () => ({ currentCase }),
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: { code: "en", label: "English", nativeLabel: "English", bcp47: "en" },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// SUPPORTED_LOCALES is imported by SealedView at module init for the
// picker labels. Stub a minimal six-locale list so the component
// renders without booting the full i18next pipeline.
vi.mock("@/i18n", () => ({
  SUPPORTED_LOCALES: [
    { code: "en", label: "English", nativeLabel: "English", bcp47: "en" },
    { code: "es", label: "Spanish", nativeLabel: "Español", bcp47: "es" },
    { code: "fr", label: "French", nativeLabel: "Français", bcp47: "fr" },
    { code: "de", label: "German", nativeLabel: "Deutsch", bcp47: "de" },
    { code: "pt", label: "Portuguese", nativeLabel: "Português", bcp47: "pt" },
    { code: "zh", label: "Chinese", nativeLabel: "中文", bcp47: "zh" },
  ],
  DEFAULT_LOCALE: "en",
  STORAGE_KEY: "ibccf.locale",
}));

// ---- Fixture builders ------------------------------------------------------

import {
  NDA_SUPPORTED_LOCALES,
  type NdaLocale,
  type NdaRendered,
} from "@shared/ndaTemplate";

const TITLES: Record<NdaLocale, string> = {
  en: "Sealed Settlement & Non-Disclosure Acknowledgement",
  es: "Acuerdo de Liquidación Sellada y Confidencialidad",
  fr: "Accord de Règlement Scellé et de Confidentialité",
  de: "Versiegelte Vergleichs- und Vertraulichkeitserklärung",
  pt: "Acordo de Liquidação Selada e Confidencialidade",
  zh: "封存和解与保密承诺书",
};

function rendered(locale: NdaLocale): NdaRendered {
  return {
    templateVersion: "v1.2026.06",
    locale,
    title: TITLES[locale],
    subtitle: "Test subtitle",
    effectiveDateLabel: "Effective date: 2026-05-18",
    partyBlock: [{ label: "Case reference", value: "EOSE-9999" }],
    recitals: ["WHEREAS test"],
    sections: [{ heading: "1. Test", paragraphs: ["Body."] }],
    acknowledgement: "I acknowledge.",
    signatureBlockLabels: {
      signed: "Signed",
      typedName: "Typed name",
      date: "Date",
      ip: "IP",
      integrityHash: "Hash",
      note: "Note",
      ibccfParty: "IBCCF",
      recipientParty: "Recipient",
    },
  };
}

function ndaResponse(
  locale: NdaLocale,
  signingLocales: NdaLocale[],
): Record<string, unknown> {
  return {
    eligible: true,
    signed: false,
    sealed: false,
    templateVersion: "v1.2026.06",
    signingLocales,
    contentHash: "abc",
    rendered: rendered(locale),
  };
}

function installFetch(signingLocales: NdaLocale[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const m = url.match(/[?&]locale=([a-z]+)/);
    const requested = (m?.[1] as NdaLocale | undefined) ?? "en";
    // Mirror the server: if signingLocales is English-only, every
    // render — regardless of the request — comes back as English.
    const effective: NdaLocale =
      signingLocales.length === 1 && signingLocales[0] === "en"
        ? "en"
        : signingLocales.includes(requested)
          ? requested
          : "en";
    return {
      ok: true,
      status: 200,
      json: async () => ndaResponse(effective, signingLocales),
    } as unknown as Response;
  });
  global.fetch = fetchMock;
  return fetchMock;
}

// ---- Tests -----------------------------------------------------------------

let SealedView: typeof import("../SealedView").SealedView;

beforeEach(async () => {
  // Re-import per test so module-level state (none today, but cheap
  // insurance) does not leak between cases.
  vi.resetModules();
  ({ SealedView } = await import("../SealedView"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SealedView — English-only signing runtime flag", () => {
  it("disables the document-language picker and shows the English preview when signingLocales=['en']", async () => {
    const fetchMock = installFetch(["en"]);

    render(<SealedView />);

    // Preview body resolves once /nda has responded.
    await screen.findByText(TITLES.en);

    const select = await screen.findByTestId<HTMLSelectElement>(
      "nda-doc-locale-select",
    );
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("en");

    // Only English is selectable — every other NDA-supported locale
    // must be filtered out of the option list.
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["en"]);
    for (const code of NDA_SUPPORTED_LOCALES) {
      if (code === "en") continue;
      expect(optionValues).not.toContain(code);
    }

    // The picker stays mounted (disabled, not removed) so the layout
    // doesn't shift, but the non-English titles must NOT be on screen.
    expect(screen.queryByText(TITLES.fr)).toBeNull();
    expect(screen.queryByText(TITLES.de)).toBeNull();

    // First fetch must have been issued at locale=en (the default
    // allowlist seed) — never any other locale, even though the user's
    // portal locale stub above is also 'en'.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    for (const u of urls) {
      const m = u.match(/[?&]locale=([a-z]+)/);
      if (m) expect(m[1]).toBe("en");
    }
  });

  it("renders an enabled picker and refetches the preview when the user switches locale (signingLocales=full set)", async () => {
    const fetchMock = installFetch([...NDA_SUPPORTED_LOCALES]);

    render(<SealedView />);

    await screen.findByText(TITLES.en);

    const select = await screen.findByTestId<HTMLSelectElement>(
      "nda-doc-locale-select",
    );
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("en");

    // All six locales must be selectable when the allowlist is open.
    const optionValues = Array.from(select.options).map((o) => o.value);
    for (const code of NDA_SUPPORTED_LOCALES) {
      expect(optionValues).toContain(code);
    }

    // Flip the picker to French — the preview should refetch with
    // ?locale=fr and the French title should replace the English one.
    fireEvent.change(select, { target: { value: "fr" } });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes("locale=fr"),
        ),
      ).toBe(true);
    });

    await screen.findByText(TITLES.fr);
    expect(screen.queryByText(TITLES.en)).toBeNull();
  });
});
