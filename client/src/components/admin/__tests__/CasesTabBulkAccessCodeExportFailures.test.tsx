// @vitest-environment jsdom
//
// Task #2359 — Let admins export the list of cases that failed a bulk
// access-code send.
//
// Covers the contract:
//   1. After a bulk send with partial failures, an "Export … as CSV" action
//      is available alongside the inline failure list.
//   2. Clicking it builds a CSV (name, access code, email, error reason) for
//      exactly the failed cases and triggers a client-side download, reusing
//      the same CSV-building pattern as bulkExportSelected.

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

  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
      "blob:mock";
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

describe("CasesTab – export bulk access-code failures as CSV (Task #2359)", () => {
  it("builds a CSV of name/access code/email/error for the failed cases and triggers a download", async () => {
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

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

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

    const exportBtn = await screen.findByTestId("access-code-export-failures");

    let capturedBlob: Blob | undefined;
    createObjectURLSpy.mockImplementation((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob;
      return "blob:mock-url";
    });

    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    expect(capturedBlob).toBeInstanceOf(Blob);
    const text = await capturedBlob!.text();
    expect(text).toContain("Name");
    expect(text).toContain("Access Code");
    expect(text).toContain("Email");
    expect(text).toContain("Error Reason");
    expect(text).toContain("FAIL0001");
    expect(text).toContain("fail@example.com");
    expect(text).toContain("SMTP connection refused");
    expect(text).not.toContain("OKAY0001");
    expect(text).not.toContain("ok@example.com");
  });
});
