// @vitest-environment jsdom
//
// Task #2356 — Show which specific cases failed after a bulk access-code send.
//
// Covers the contract in CasesTab.bulkSendAccessCodes:
//   1. After a bulk send with partial failures, the per-case failure names +
//      reasons from POST /api/cases/bulk/send-access-code's `results` array
//      are rendered (via the shared ExpandableFailureList), not just the
//      aggregate "N succeeded, N failed" toast.
//   2. A "Retarget … for retry" action re-selects exactly the failed case
//      ids into the table selection (targetMode="selected"), so the admin
//      can immediately resend to just that subset.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: () => null,
}));

const CASE_OK = {
  id: "case-ok",
  accessCode: "OKAY0001",
  status: "active" as const,
  userEmail: "ok@example.com",
  userName: "Case OK",
};

const CASE_FAIL = {
  id: "case-fail",
  accessCode: "FAIL0001",
  status: "active" as const,
  userEmail: "fail@example.com",
  userName: "Case Fail",
};

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_OK, CASE_FAIL] as unknown as Case[],
    filteredCases: [CASE_OK, CASE_FAIL] as unknown as Case[],
  });
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

beforeEach(() => {
  // CasesTab persists which sidebar function panel is open to localStorage
  // and toggleFunction closes an already-active panel — without clearing
  // this between tests, a panel left open by a prior test flips the next
  // test's toggle click closed instead of open (order-dependent flake).
  localStorage.clear();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ep = Element.prototype as unknown as Record<string, unknown>;
  if (!ep.hasPointerCapture) ep.hasPointerCapture = () => false;
  if (!ep.setPointerCapture) ep.setPointerCapture = () => {};
  if (!ep.releasePointerCapture) ep.releasePointerCapture = () => {};
  if (!ep.scrollIntoView) ep.scrollIntoView = () => {};

  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this as { _: Map<string, string> })._.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this as { _: Map<string, string> })._.set(k, String(v));
    },
    removeItem(k: string) {
      (this as { _: Map<string, string> })._.delete(k);
    },
    clear() {
      (this as { _: Map<string, string> })._.clear();
    },
  };
  (
    globalThis as unknown as {
      sessionStorage: { setItem: (k: string, v: string) => void };
    }
  ).sessionStorage.setItem("adminToken", "test-token");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

describe("CasesTab – bulk access-code send failure list (Task #2356)", () => {
  it("shows which specific case failed (name + reason) and lets the admin retarget it", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/send-access-code")) {
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 2,
              successCount: 1,
              failureCount: 1,
              results: [
                { id: CASE_OK.id, success: true, sentTo: CASE_OK.userEmail },
                { id: CASE_FAIL.id, success: false, error: "SMTP connection refused" },
              ],
            }),
          );
        }
        return Promise.resolve(jsonOk({}, 404));
      });

    render(<CasesTab />);

    // Select both cases via the table checkboxes (default targetMode is "selected").
    const checkboxOk = await screen.findByTestId(`checkbox-select-${CASE_OK.id}`);
    const checkboxFail = await screen.findByTestId(`checkbox-select-${CASE_FAIL.id}`);
    fireEvent.click(checkboxOk);
    fireEvent.click(checkboxFail);

    // Open the "Access code" bulk-function panel and trigger the send.
    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const sendBtn = await screen.findByTestId("panel-access-code-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    // The failing case's name/access code and its specific reason must be visible.
    await waitFor(() => {
      const list = screen.getByTestId("access-code-failure-list");
      expect(list.textContent).toContain("Case Fail");
      expect(list.textContent).toContain("FAIL0001");
      expect(list.textContent).toContain("SMTP connection refused");
    });

    // The successful case must NOT appear in the failure list.
    const failureList = screen.getByTestId("access-code-failure-list");
    expect(failureList.textContent).not.toContain("Case OK");

    // Retargeting selects only the failed case for a follow-up retry.
    const retryBtn = screen.getByTestId("access-code-retry-failed");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect((checkboxFail as HTMLInputElement).checked).toBe(true);
      expect((checkboxOk as HTMLInputElement).checked).toBe(false);
    });
  });

  it("shows every case when the whole batch fails", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/send-access-code")) {
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 2,
              successCount: 0,
              failureCount: 2,
              results: [
                { id: CASE_OK.id, success: false, error: "SMTP connection refused" },
                { id: CASE_FAIL.id, success: false, error: "SMTP connection refused" },
              ],
            }),
          );
        }
        return Promise.resolve(jsonOk({}, 404));
      });

    render(<CasesTab />);

    const checkboxOk = await screen.findByTestId(`checkbox-select-${CASE_OK.id}`);
    const checkboxFail = await screen.findByTestId(`checkbox-select-${CASE_FAIL.id}`);
    fireEvent.click(checkboxOk);
    fireEvent.click(checkboxFail);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const sendBtn = await screen.findByTestId("panel-access-code-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-failure-list");
      expect(list.textContent).toContain("Case OK");
      expect(list.textContent).toContain("Case Fail");
    });
  });

  it("shows the server's missing-email reason for a case lacking a registered email", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/send-access-code")) {
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 2,
              successCount: 1,
              failureCount: 1,
              results: [
                { id: CASE_OK.id, success: true, sentTo: CASE_OK.userEmail },
                {
                  id: CASE_FAIL.id,
                  success: false,
                  error: "This case has no registered email on file.",
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonOk({}, 404));
      });

    render(<CasesTab />);

    const checkboxOk = await screen.findByTestId(`checkbox-select-${CASE_OK.id}`);
    const checkboxFail = await screen.findByTestId(`checkbox-select-${CASE_FAIL.id}`);
    fireEvent.click(checkboxOk);
    fireEvent.click(checkboxFail);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const sendBtn = await screen.findByTestId("panel-access-code-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-failure-list");
      expect(list.textContent).toContain("Case Fail");
      expect(list.textContent).toContain("This case has no registered email on file.");
    });
  });

  it("replaces (not appends to) the previous failure list on a second bulk send", async () => {
    let bulkSendCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: unknown, opts?: { method?: string }) => {
      const u = String(url);
      if (opts?.method === "POST" && u.includes("/api/cases/bulk/send-access-code")) {
        bulkSendCallCount += 1;
        if (bulkSendCallCount === 1) {
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 2,
              successCount: 1,
              failureCount: 1,
              results: [
                { id: CASE_OK.id, success: true, sentTo: CASE_OK.userEmail },
                { id: CASE_FAIL.id, success: false, error: "SMTP connection refused" },
              ],
            }),
          );
        }
        return Promise.resolve(
          jsonOk({
            success: true,
            total: 1,
            successCount: 1,
            failureCount: 0,
            results: [{ id: CASE_FAIL.id, success: true, sentTo: CASE_FAIL.userEmail }],
          }),
        );
      }
      return Promise.resolve(jsonOk({}, 404));
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<CasesTab />);

    const checkboxOk = await screen.findByTestId(`checkbox-select-${CASE_OK.id}`);
    const checkboxFail = await screen.findByTestId(`checkbox-select-${CASE_FAIL.id}`);
    fireEvent.click(checkboxOk);
    fireEvent.click(checkboxFail);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const sendBtn = await screen.findByTestId("panel-access-code-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-failure-list");
      expect(list.textContent).toContain("Case Fail");
    });

    // Retarget onto just the previously-failed case, then resend — this time
    // it succeeds, so the failure list must clear rather than retain the
    // stale entry from the first send.
    const retryBtn = screen.getByTestId("access-code-retry-failed");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect((checkboxFail as HTMLInputElement).checked).toBe(true);
    });

    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("access-code-failure-list")).toBeNull();
    });
  });
});
