// @vitest-environment jsdom
//
// Unit tests for ContactAdminPage redirect behaviour.
//
// Contracted behaviours:
//   (a) When no access code exists in sessionStorage, the page redirects
//       to /dashboard (i.e. calls navigate with "/dashboard").
//   (b) When the API returns an active warning, status transitions to "active"
//       and the page renders the support content (does NOT redirect).
//   (c) When the API returns a case with an expired/absent warning, the page
//       redirects to /dashboard.
//   (d) When the API returns a non-ok response, the page redirects to /dashboard.
//   (e) When a portal session token is available, it is sent as
//       x-portal-session-token so PIN-protected cases are accessible during
//       an active countdown.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// ── framer-motion stub ────────────────────────────────────────────────────
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...r }: any) => <div {...r}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// ── lucide-react icons ─────────────────────────────────────────────────────
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  MessageCircle: () => null,
  Loader2: () => null,
}));

// ── shadcn/ui button ──────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

// ── PremiumBackground stub ─────────────────────────────────────────────────
vi.mock("@/components/PremiumBackground", () => ({
  PremiumBackground: () => null,
}));

// ── tawkto — not configured by default ───────────────────────────────────
vi.mock("@/lib/tawkto", () => ({
  isTawktoConfigured: () => false,
  showTawkto: vi.fn(),
  hideTawkto: vi.fn(),
}));

// ── portalSession ─────────────────────────────────────────────────────────
const mockGetPortalToken = vi.fn<[], string>();
vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => mockGetPortalToken(),
}));

// ── wouter navigate capture ────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/contact-admin", mockNavigate],
}));

// ── fetch mock ────────────────────────────────────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function okResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function errResponse(status = 404) {
  return Promise.resolve(new Response("{}", { status }));
}

import ContactAdminPage from "../ContactAdminPage";

beforeEach(() => {
  mockNavigate.mockReset();
  fetchMock.mockReset();
  mockGetPortalToken.mockReturnValue("");
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ContactAdminPage — routing behaviour", () => {
  it("(a) redirects to /dashboard when no access code is in sessionStorage", async () => {
    render(<ContactAdminPage />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(b) shows support content when the API returns an active warning", async () => {
    sessionStorage.setItem("caseAccessCode", "TEST-CODE-123");
    const warningAt = new Date(Date.now() - 60_000).toISOString();
    fetchMock.mockReturnValueOnce(
      okResponse({
        portalWarningAt: warningAt,
        portalWarningMinutes: 10,
        portalWarningMessage: "Your portal is about to close.",
      }),
    );

    render(<ContactAdminPage />);

    await waitFor(() =>
      expect(screen.getByTestId("button-back-to-portal")).toBeTruthy(),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith("/dashboard");
  });

  it("(c) redirects to /dashboard when the API returns an expired warning", async () => {
    sessionStorage.setItem("caseAccessCode", "TEST-CODE-456");
    const expiredAt = new Date(Date.now() - 20 * 60_000).toISOString();
    fetchMock.mockReturnValueOnce(
      okResponse({
        portalWarningAt: expiredAt,
        portalWarningMinutes: 5,
        portalWarningMessage: "Some old message",
      }),
    );

    render(<ContactAdminPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/dashboard"));
  });

  it("(d) redirects to /dashboard when the API returns a non-ok response", async () => {
    sessionStorage.setItem("caseAccessCode", "BAD-CODE");
    fetchMock.mockReturnValueOnce(errResponse(403));

    render(<ContactAdminPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/dashboard"));
  });

  it("(e) sends x-portal-session-token when a portal token is available (PIN-protected cases)", async () => {
    sessionStorage.setItem("caseAccessCode", "PIN-CASE-CODE");
    mockGetPortalToken.mockReturnValue("test-portal-session-token-abc");

    const warningAt = new Date(Date.now() - 30_000).toISOString();
    fetchMock.mockReturnValueOnce(
      okResponse({
        portalWarningAt: warningAt,
        portalWarningMinutes: 10,
        portalWarningMessage: "Access countdown active.",
      }),
    );

    render(<ContactAdminPage />);

    await waitFor(() =>
      expect(screen.getByTestId("button-back-to-portal")).toBeTruthy(),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, initArg] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = (initArg?.headers ?? {}) as Record<string, string>;
    expect(headers["x-portal-session-token"]).toBe("test-portal-session-token-abc");
  });
});
