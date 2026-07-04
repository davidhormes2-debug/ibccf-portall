// @vitest-environment jsdom
//
// Regression tests: SealedView must render portal-skeleton-list items while
// its NDA data fetch is pending, and no skeleton once the data arrives.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// ── Shared mocks ─────────────────────────────────────────────────────────────

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
      { get: (_t, prop: string) => passthrough(prop as any) },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      (opts && typeof opts === "object" && "defaultValue" in opts
        ? opts.defaultValue
        : key) as string,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  Trans: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: { id: "case-1", accessCode: "ABCD-1234" },
    loadAllData: vi.fn(async () => {}),
  }),
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({ locale: { code: "en" } }),
}));

vi.mock("@/i18n", () => ({
  SUPPORTED_LOCALES: [
    { code: "en", label: "English", nativeLabel: "English" },
    { code: "es", label: "Spanish", nativeLabel: "Español" },
  ],
}));

vi.mock("@shared/ndaTemplate", () => ({
  NDA_DEFAULT_LOCALE: "en",
  NDA_SIGNING_LOCALES_DEFAULT: ["en"],
  NDA_SUPPORTED_LOCALES: ["en", "es", "fr", "de", "pt", "zh"],
  NDA_TRANSLATIONS_REVIEWED: false,
  effectiveSigningLocale: (locale: string) => locale,
  isSigningLocaleAllowed: (locale: string, allowed: string[]) =>
    allowed.includes(locale),
  normalizeNdaLocale: (code: string) => (code === "en" ? "en" : "en"),
}));

vi.mock("../StampDutyView", () => ({
  StampDutyView: () => <div data-testid="stamp-duty-view-stub" />,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let SealedView: typeof import("../SealedView").SealedView;

async function loadComponent() {
  vi.resetModules();
  ({ SealedView } = await import("../SealedView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Loading skeleton ──────────────────────────────────────────────────────────

describe("SealedView — loading skeleton", () => {
  it("renders portal-skeleton-list items while the NDA fetch is pending", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<SealedView />);

    const skeletons = screen.getAllByTestId("portal-skeleton-list");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the role=status loading wrapper while fetching", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    await loadComponent();
    render(<SealedView />);

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute("aria-label")).toBe("Loading");
  });

  it("removes the skeleton after the fetch resolves", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        eligible: false,
        signed: false,
        sealed: false,
      }),
    }));

    await loadComponent();
    render(<SealedView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });

  it("does not render the skeleton when loading is false", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        eligible: false,
        signed: false,
        sealed: false,
      }),
    }));

    await loadComponent();
    render(<SealedView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });
});
