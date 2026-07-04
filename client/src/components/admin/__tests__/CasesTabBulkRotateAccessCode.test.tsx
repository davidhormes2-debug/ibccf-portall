// @vitest-environment jsdom
//
// Task #2440 — Let admins bulk-rotate every legacy access code in one action.
//
// Covers the contract in CasesTab.bulkRotateAccessCodes:
//   1. From the "Access code" bulk-function panel, selecting cases and
//      clicking "Rotate access code for N" hits
//      POST /api/cases/bulk/rotate-access-code with the target ids.
//   2. Per-case failures (hard rotation failure OR rotation succeeded but
//      notification failed) are rendered via the shared ExpandableFailureList,
//      distinct from the existing send-access-code failure list.
//   3. A "Retarget … for retry" action re-selects exactly the failed case
//      ids into the table selection.
//   4. Failures can be exported as CSV via a dedicated button.

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

let largeCaseSet: Case[] = [];
let useLargeCaseSet = false;

function buildMockContext(): AdminDashboardContextValue {
  if (useLargeCaseSet) {
    return buildMockAdminDashboardContext({
      cases: largeCaseSet,
      filteredCases: largeCaseSet,
    });
  }
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

describe("CasesTab – bulk access-code rotation (Task #2440)", () => {
  it("rotates selected cases and shows a failure list distinct from the send-access-code list", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string; body?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/rotate-access-code")) {
          expect(JSON.parse(String(opts.body)).ids.sort()).toEqual(
            [CASE_OK.id, CASE_FAIL.id].sort(),
          );
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 2,
              successCount: 1,
              failureCount: 1,
              results: [
                { id: CASE_OK.id, success: true, newAccessCode: "NEWCODE1", notified: true },
                { id: CASE_FAIL.id, success: false, error: "Failed to generate a unique access code" },
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

    const rotateBtn = await screen.findByTestId("panel-access-code-rotate");
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-rotate-failure-list");
      expect(list.textContent).toContain("Case Fail");
      expect(list.textContent).toContain("Failed to generate a unique access code");
    });

    // The successful case must NOT appear in the rotate failure list, and
    // the (unrelated) send-access-code failure list must not render at all.
    const rotateFailureList = screen.getByTestId("access-code-rotate-failure-list");
    expect(rotateFailureList.textContent).not.toContain("Case OK");
    expect(screen.queryByTestId("access-code-failure-list")).toBeNull();

    const retryBtn = screen.getByTestId("access-code-rotate-retry-failed");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect((checkboxFail as HTMLInputElement).checked).toBe(true);
      expect((checkboxOk as HTMLInputElement).checked).toBe(false);
    });

    expect(screen.getByTestId("access-code-rotate-export-failures")).toBeInTheDocument();
  });

  it("treats a rotation that succeeds but fails to notify as a failure needing retry", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/rotate-access-code")) {
          return Promise.resolve(
            jsonOk({
              success: true,
              total: 1,
              successCount: 1,
              failureCount: 0,
              results: [
                {
                  id: CASE_FAIL.id,
                  success: true,
                  newAccessCode: "NEWCODE9",
                  notified: false,
                  notifyError: "SMTP down",
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonOk({}, 404));
      });

    render(<CasesTab />);

    const checkboxFail = await screen.findByTestId(`checkbox-select-${CASE_FAIL.id}`);
    fireEvent.click(checkboxFail);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const rotateBtn = await screen.findByTestId("panel-access-code-rotate");
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-rotate-failure-list");
      expect(list.textContent).toContain("Case Fail");
      expect(list.textContent).toContain("SMTP down");
    });
  });

  it("replaces (not appends to) the previous rotate-failure list on a second rotation", async () => {
    let callCount = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        const u = String(url);
        if (opts?.method === "POST" && u.includes("/api/cases/bulk/rotate-access-code")) {
          callCount += 1;
          if (callCount === 1) {
            return Promise.resolve(
              jsonOk({
                success: true,
                total: 2,
                successCount: 1,
                failureCount: 1,
                results: [
                  { id: CASE_OK.id, success: true, newAccessCode: "NEWCODE1", notified: true },
                  { id: CASE_FAIL.id, success: false, error: "Failed to generate a unique access code" },
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
              results: [
                { id: CASE_FAIL.id, success: true, newAccessCode: "NEWCODE2", notified: true },
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

    const rotateBtn = await screen.findByTestId("panel-access-code-rotate");
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("access-code-rotate-failure-list").textContent).toContain("Case Fail");
    });

    const retryBtn = screen.getByTestId("access-code-rotate-retry-failed");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect((checkboxFail as HTMLInputElement).checked).toBe(true);
    });

    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("access-code-rotate-failure-list")).toBeNull();
    });
  });

  it("shows the confirm dialog for a batch above the threshold instead of rotating immediately", async () => {
    largeCaseSet = Array.from({ length: 25 }, (_, i) => ({
      id: `case-${i}`,
      accessCode: `CODE${i}`,
      status: "active" as const,
      userEmail: `user${i}@example.com`,
      userName: `User ${i}`,
    })) as unknown as Case[];
    useLargeCaseSet = true;

    const fetchMock = vi.fn().mockImplementation((url: unknown, opts?: { method?: string }) => {
      const u = String(url);
      if (opts?.method === "POST" && u.includes("/api/cases/bulk/rotate-access-code")) {
        return Promise.resolve(
          jsonOk({ success: true, total: 25, successCount: 25, failureCount: 0, results: [] }),
        );
      }
      return Promise.resolve(jsonOk({}, 404));
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<CasesTab />);

    const selectAll = await screen.findByTestId("checkbox-select-all");
    fireEvent.click(selectAll);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const rotateBtn = await screen.findByTestId("panel-access-code-rotate");
    fireEvent.click(rotateBtn);

    const dialog = await screen.findByTestId(
      "dialog-confirm-access-code-rotate",
      {},
      { timeout: 10000 },
    );
    expect(dialog).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/cases/bulk/rotate-access-code"),
      expect.anything(),
    );

    const confirmBtn = await screen.findByTestId(
      "button-confirm-access-code-rotate",
      {},
      { timeout: 10000 },
    );
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/cases/bulk/rotate-access-code",
          expect.objectContaining({ method: "POST" }),
        );
      },
      { timeout: 10000 },
    );
  }, 15000);
});
