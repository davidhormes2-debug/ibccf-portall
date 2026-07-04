// @vitest-environment jsdom
//
// Unit tests for ReactivationDepositView — reactivationPageMessage rendering.
//
// Contracted behaviours:
//   (a) When reactivationPageMessage is set and portalWarningMessage is also
//       set, the reactivationPageMessage is shown (takes priority).
//   (b) When reactivationPageMessage is null but portalWarningMessage is set,
//       the portalWarningMessage is shown as the fallback.
//   (c) When both are null, the default i18n message is rendered.
//   (d) When reactivationPageMessage is set and portalWarningMessage is null,
//       the reactivationPageMessage is shown.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// ── framer-motion stub ──────────────────────────────────────────────────────
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...r }: any) => <div {...r}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// ── PremiumBackground stub ──────────────────────────────────────────────────
vi.mock("@/components/PremiumBackground", () => ({
  PremiumBackground: () => null,
}));

// ── lucide-react stub ───────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Copy: () => null,
  Check: () => null,
  Upload: () => null,
  Loader2: () => null,
  CheckCircle2: () => null,
  Shield: () => null,
}));

// ── shadcn/ui stubs ─────────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

// ── Toast stub ──────────────────────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── i18n stub ───────────────────────────────────────────────────────────────
// Return a simple key-echo so we can distinguish translated placeholders
// from custom admin-set messages.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => `[${key}]`,
    i18n: { language: "en" },
  }),
}));

// ── PortalContext stub ──────────────────────────────────────────────────────
const mockSetViewState = vi.fn();
let mockAccessCode = "TEST-CODE-001";
let mockLockoutReason: string | null = null;

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    accessCode: mockAccessCode,
    setViewState: mockSetViewState,
    lockoutReason: mockLockoutReason,
  }),
}));

// ── fetch mock ──────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function makeReactivationInfo(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "case-1",
    depositAddress: "TXtest12345",
    depositAsset: "USDT",
    depositNetwork: "TRC20",
    reactivationAmount: "500",
    portalWarningMessage: null,
    reactivationPageMessage: null,
    ...overrides,
  };
}

function okFetch(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

import { ReactivationDepositView } from "../ReactivationDepositView";

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.mockReset();
  mockSetViewState.mockReset();
  mockAccessCode = "TEST-CODE-001";
  mockLockoutReason = null;
  // Silence sessionStorage.getItem calls
  vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ReactivationDepositView — reactivationPageMessage rendering", () => {
  it(
    "(a) shows reactivationPageMessage over portalWarningMessage when both are set",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: "Custom reactivation notice",
            portalWarningMessage: "General portal warning",
          }),
        ),
      );

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      expect(body.textContent).toBe("Custom reactivation notice");
    },
  );

  it(
    "(b) falls back to portalWarningMessage when reactivationPageMessage is null",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: null,
            portalWarningMessage: "General portal warning",
          }),
        ),
      );

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      expect(body.textContent).toBe("General portal warning");
    },
  );

  it(
    "(c) shows the default i18n message when both reactivationPageMessage and portalWarningMessage are null",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: null,
            portalWarningMessage: null,
          }),
        ),
      );
      mockLockoutReason = null;

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      // The component falls through to the default i18n key when neither
      // custom message is set. The stub returns "[key]" format.
      expect(body.textContent).toContain("[reactivationDeposit.notice.body]");
    },
  );

  it(
    "(d) shows reactivationPageMessage when set and portalWarningMessage is null",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: "Compliance hold — submit deposit to restore access.",
            portalWarningMessage: null,
          }),
        ),
      );

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      expect(body.textContent).toBe(
        "Compliance hold — submit deposit to restore access.",
      );
    },
  );

  it(
    "(e) shows the warning_expired i18n key when lockoutReason is warning_expired and both messages are null",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: null,
            portalWarningMessage: null,
          }),
        ),
      );
      mockLockoutReason = "warning_expired";

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      expect(body.textContent).toContain(
        "[reactivationDeposit.notice.bodyWarningExpired]",
      );
    },
  );

  it(
    "(f) reactivationPageMessage overrides the warning_expired i18n key when set",
    async () => {
      fetchMock.mockReturnValueOnce(
        okFetch(
          makeReactivationInfo({
            reactivationPageMessage: "Admin override message",
            portalWarningMessage: null,
          }),
        ),
      );
      mockLockoutReason = "warning_expired";

      render(<ReactivationDepositView />);

      await waitFor(() =>
        expect(screen.getByTestId("reactivation-notice-body")).toBeTruthy(),
      );

      const body = screen.getByTestId("reactivation-notice-body");
      expect(body.textContent).toBe("Admin override message");
    },
  );
});

// ── Task #2319: enabled account never sees the load-error panel ────────────
//
// The server returns 410 from GET /api/cases/access/:code/reactivation-info
// when the case is NOT disabled (i.e. a working account). Reaching this view
// for such an account is a client-side routing bug, not a genuine load
// failure — the component must never render the generic error panel in that
// case. Instead it should redirect the user away (to login) so a valid
// session on a working account is never stranded on an error screen.
describe("ReactivationDepositView — enabled account (410) never shows the load-error panel", () => {
  it("redirects to login instead of rendering the load-error panel when the server returns 410", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ error: "not disabled" }), {
          status: 410,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(<ReactivationDepositView />);

    await waitFor(() => expect(mockSetViewState).toHaveBeenCalledWith("login"));

    // The generic load-error panel must never appear for an enabled account.
    expect(screen.queryByText("[reactivationDeposit.loadError.title]")).toBeNull();
    expect(screen.queryByTestId("reactivation-deposit-address")).toBeNull();
  });

  it("still shows the load-error panel for genuine failures (e.g. 500 / network error)", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(<ReactivationDepositView />);

    await waitFor(() =>
      expect(
        screen.getByText("[reactivationDeposit.loadError.title]"),
      ).toBeTruthy(),
    );
    expect(mockSetViewState).not.toHaveBeenCalledWith("login");
  });
});
