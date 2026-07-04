// @vitest-environment jsdom
//
// Regression guard for the account-locked toast deduplication guard in
// PortalContext.tsx.
//
// PortalContext uses `lockoutToastFiredRef` (a React ref, initialised false)
// to prevent duplicate toasts when two concurrent poll responses both detect
// `isDisabled: true`.  The guard pattern at both fire-sites is:
//
//   if (!lockoutToastFiredRef.current) {
//     lockoutToastFiredRef.current = true;
//     toast({ …, description: t("context.toast.accountLockedDescAdminDisabled") … });
//   }
//
// Because JavaScript is single-threaded, two async poll callbacks that resolve
// simultaneously are serialised as microtasks.  The first sets the ref to
// true; the second sees it and skips.  These tests verify that the production
// `loadAllData()` function (exposed via context at `PortalContextValue.loadAllData`)
// fires exactly once when two rapid concurrent invocations both receive
// `{ isDisabled: true }` from the server.
//
// fires exactly once — sentinel string for CI guard.
//
// Relevant source: client/src/pages/portal/PortalContext.tsx
//   lockoutToastFiredRef declaration  : line 472
//   guard (isDisabled path)           : lines 716–723
//   guard (403 reactivation_required) : lines 796–803
//   guard reset in logout()           : line 525

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must precede any import of PortalContext
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/portal", vi.fn()],
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  clearPortalToken: vi.fn(),
  getPortalToken: () => null,
  setPortalToken: vi.fn(),
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

vi.mock("../usePortalAutoLogout", () => ({
  usePortalAutoLogout: () => undefined,
}));

vi.mock("@/hooks/useNotificationSound", () => ({
  playNotificationSound: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fetch mock — returns isDisabled: true for case access endpoint
// ---------------------------------------------------------------------------

const CASE_ID = "case-lockout-toast-test";
const ACCESS_CODE = "LOCKOUT123";

function makeIsDisabledFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    // The case access endpoint — returns isDisabled: true.
    if (url.includes(`/api/cases/access/${ACCESS_CODE}`)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: CASE_ID,
          accessCode: ACCESS_CODE,
          isDisabled: true,
          status: "active" as const,
        }),
      } as Response;
    }

    // All secondary case-data endpoints — return empty/not-found so state
    // setters do not throw.
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response;
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Import PortalProvider and usePortal after all mocks are registered
// ---------------------------------------------------------------------------
import { PortalProvider, usePortal } from "../PortalContext";

// ---------------------------------------------------------------------------
// Wrapper — wraps the hook with both QueryClientProvider and PortalProvider
// ---------------------------------------------------------------------------

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(PortalProvider, null, children),
    );
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockToast.mockClear();
  global.fetch = makeIsDisabledFetch();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lockoutToastFiredRef guard — production PortalContext.loadAllData", () => {
  it("(a) fires the account-locked toast exactly once when two concurrent loadAllData() calls both receive isDisabled: true", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => usePortal(), {
      wrapper: makeWrapper(queryClient),
    });

    // Prime the context with a live case so loadAllData has a caseId and
    // caseAccessCode to work with (guard at loadAllData line 618: `if (!caseId) return`).
    await act(async () => {
      result.current.setCurrentCase({
        id: CASE_ID,
        accessCode: ACCESS_CODE,
        status: "active",
      });
    });

    // Call loadAllData twice concurrently — simulating two rapid poll callbacks
    // that both resolve with isDisabled: true before either continuation has run.
    // In JavaScript's single-threaded async model, both continuations are queued
    // as microtasks and execute serially: the first sets lockoutToastFiredRef.current
    // = true, the second reads it and skips the toast.
    await act(async () => {
      const p1 = result.current.loadAllData();
      const p2 = result.current.loadAllData();
      await Promise.all([p1, p2]);
    });

    // The guard must have suppressed the second toast call.
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("(b) the single toast call carries the expected destructive lockout payload (title + description + variant)", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => usePortal(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      result.current.setCurrentCase({
        id: CASE_ID,
        accessCode: ACCESS_CODE,
        status: "active",
      });
    });

    await act(async () => {
      await Promise.all([
        result.current.loadAllData(),
        result.current.loadAllData(),
      ]);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "context.toast.accountLockedTitle",
        description: "context.toast.accountLockedDescAdminDisabled",
        variant: "destructive",
      }),
    );
    // Confirm only one call — guard fired exactly once.
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});
