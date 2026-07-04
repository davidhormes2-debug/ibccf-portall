// @vitest-environment jsdom
//
// Verifies that the account-locked toast picks the right message for each
// lock reason in PortalContext.tsx.
//
// picks the right message for each lock reason — sentinel string for CI guard.
//
// There are two possible toast descriptions:
//   context.toast.accountLockedDescWarningExpired  — warning period expired
//   context.toast.accountLockedDescAdminDisabled   — locked by compliance officer
//
// The choice is made at two code sites inside loadAllData():
//   1. freshCase.isDisabled path (lines ~740–758): compares Date.now() against
//      the portalWarningAt + portalWarningMinutes expiry to pick a reason.
//   2. 403 / reactivation_required path (lines ~821–842): same logic but reads
//      from lastKnownWarningRef (synced from currentCase via a useEffect).
//
// Relevant source: client/src/pages/portal/PortalContext.tsx

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

vi.mock("../pages/portal/usePortalAutoLogout", () => ({
  usePortalAutoLogout: () => undefined,
}));

vi.mock("@/hooks/useNotificationSound", () => ({
  playNotificationSound: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fetch-mock factories
// ---------------------------------------------------------------------------

const CASE_ID = "case-lock-reason-test";
const ACCESS_CODE = "LOCKREASON1";

function stubFetch(
  casePayload: object | null,
  caseStatus = 200,
  caseOk = true,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes(`/api/cases/access/${ACCESS_CODE}`)) {
      return {
        ok: caseOk,
        status: caseStatus,
        json: async () => casePayload ?? {},
      } as Response;
    }

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
import { PortalProvider, usePortal } from "../pages/portal/PortalContext";

// ---------------------------------------------------------------------------
// Wrapper
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
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: prime the context with a live case and call loadAllData()
// ---------------------------------------------------------------------------

async function runLockout(
  casePayload: object | null,
  caseStatus = 200,
  caseOk = true,
) {
  global.fetch = stubFetch(casePayload, caseStatus, caseOk);

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
    await result.current.loadAllData();
  });

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("account-locked toast — picks the right message for each lock reason", () => {
  it("isDisabled=true with an expired portalWarning → uses accountLockedDescWarningExpired", async () => {
    // Warning was set 2 hours ago for 60 minutes, so it expired 1 hour ago.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await runLockout({
      id: CASE_ID,
      accessCode: ACCESS_CODE,
      isDisabled: true,
      status: "active",
      portalWarningAt: twoHoursAgo,
      portalWarningMinutes: 60,
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "context.toast.accountLockedDescWarningExpired",
        variant: "destructive",
      }),
    );
  });

  it("isDisabled=true with no warning fields → uses accountLockedDescAdminDisabled", async () => {
    await runLockout({
      id: CASE_ID,
      accessCode: ACCESS_CODE,
      isDisabled: true,
      status: "active",
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "context.toast.accountLockedDescAdminDisabled",
        variant: "destructive",
      }),
    );
  });

  it("403 with reason=reactivation_required (no prior warning) → uses accountLockedDescAdminDisabled", async () => {
    await runLockout(
      { reason: "reactivation_required" },
      403,
      false,
    );

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "context.toast.accountLockedDescAdminDisabled",
        variant: "destructive",
      }),
    );
  });

  it("403 after a prior successful poll that set expired warning fields → uses accountLockedDescWarningExpired", async () => {
    // Warning was set 2 hours ago for 60 minutes — already expired.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // First fetch returns a healthy (non-disabled) case with warning fields so
    // that loadAllData() updates currentCase and the useEffect syncs
    // lastKnownWarningRef.  The second fetch returns a 403 so the 403 path
    // reads from the now-populated ref and chooses warning_expired.
    let callCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/api/cases/access/${ACCESS_CODE}`)) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: CASE_ID,
              accessCode: ACCESS_CODE,
              status: "active",
              portalWarningAt: twoHoursAgo,
              portalWarningMinutes: 60,
            }),
          } as Response;
        }
        // Second call → 403 with reactivation_required
        return {
          ok: false,
          status: 403,
          json: async () => ({ reason: "reactivation_required" }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => usePortal(), {
      wrapper: makeWrapper(queryClient),
    });

    // Prime the context so loadAllData knows which access code to fetch.
    await act(async () => {
      result.current.setCurrentCase({
        id: CASE_ID,
        accessCode: ACCESS_CODE,
        status: "active",
      });
    });

    // First loadAllData: succeeds → currentCase updated with warning fields →
    // useEffect fires and syncs lastKnownWarningRef.
    await act(async () => {
      await result.current.loadAllData();
    });

    // Second loadAllData: 403 → reads the now-populated lastKnownWarningRef →
    // derives warning_expired and fires the correct toast.
    await act(async () => {
      await result.current.loadAllData();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "context.toast.accountLockedDescWarningExpired",
        variant: "destructive",
      }),
    );
  });

  it("403 after a prior successful poll that set a NOT-YET-expired warning → uses accountLockedDescAdminDisabled", async () => {
    // Warning was set 10 minutes ago for 60 minutes — still 50 minutes
    // remaining, i.e. not expired.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // First fetch returns a healthy (non-disabled) case with warning fields so
    // that loadAllData() updates currentCase and the useEffect syncs
    // lastKnownWarningRef. The second fetch returns a 403 so the 403 path
    // reads from the now-populated ref and, since the warning has not yet
    // expired, must resolve to admin_disabled (not warning_expired).
    let callCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(`/api/cases/access/${ACCESS_CODE}`)) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: CASE_ID,
              accessCode: ACCESS_CODE,
              status: "active",
              portalWarningAt: tenMinutesAgo,
              portalWarningMinutes: 60,
            }),
          } as Response;
        }
        // Second call → 403 with reactivation_required
        return {
          ok: false,
          status: 403,
          json: async () => ({ reason: "reactivation_required" }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => usePortal(), {
      wrapper: makeWrapper(queryClient),
    });

    // Prime the context so loadAllData knows which access code to fetch.
    await act(async () => {
      result.current.setCurrentCase({
        id: CASE_ID,
        accessCode: ACCESS_CODE,
        status: "active",
      });
    });

    // First loadAllData: succeeds → currentCase updated with warning fields →
    // useEffect fires and syncs lastKnownWarningRef.
    await act(async () => {
      await result.current.loadAllData();
    });

    // Second loadAllData: 403 → reads the now-populated lastKnownWarningRef →
    // warning has not expired yet, so this must derive admin_disabled and
    // fire the correct toast.
    await act(async () => {
      await result.current.loadAllData();
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "context.toast.accountLockedDescAdminDisabled",
        variant: "destructive",
      }),
    );
  });
});
