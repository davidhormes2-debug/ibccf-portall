// @vitest-environment jsdom
//
// Task #2381 — Confirm the "Legacy" access-code badge (added in Task #2346)
// doesn't leak into or break the CSV export / bulk access-code send paths
// when a mix of legacy (lettered) and modern (digits-only) access codes is
// present.
//
// Covers the contract:
//   1. `bulkExportSelected`'s CSV output contains the raw `accessCode` value
//      for both a legacy and a modern case — never the badge's "Legacy"
//      label or its title text.
//   2. The bulk access-code send flow (`CasesTabBulkAccessCodeFailures`'s
//      surface) still reports the failed case's raw `accessCode`, not badge
//      markup, in the failure list — regardless of whether that case's code
//      is legacy-format.
//   3. The badge itself still renders for the legacy case alongside these
//      flows, proving the two features coexist without interfering.

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

const CASE_LEGACY = {
  id: "case-legacy",
  accessCode: "ABC123DEF456",
  status: "active" as const,
  userEmail: "legacy@example.com",
  userName: "Legacy Case",
};

const CASE_MODERN = {
  id: "case-modern",
  accessCode: "123456789012",
  status: "active" as const,
  userEmail: "modern@example.com",
  userName: "Modern Case",
};

function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_LEGACY, CASE_MODERN] as unknown as Case[],
    filteredCases: [CASE_LEGACY, CASE_MODERN] as unknown as Case[],
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

  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
      "blob:mock";
  }

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(jsonOk({}, 404)));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

describe("CasesTab – legacy access-code badge does not interfere with export/bulk flows (Task #2381)", () => {
  it("still renders the legacy badge for the lettered case", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`badge-legacy-access-code-${CASE_LEGACY.id}`),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByTestId(`badge-legacy-access-code-${CASE_MODERN.id}`),
    ).toBeNull();
  });

  it("exports the raw accessCode (not the badge label) for both legacy and modern cases via bulkExportSelected", async () => {
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-url");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<CasesTab />);

    const checkboxLegacy = await screen.findByTestId(
      `checkbox-select-${CASE_LEGACY.id}`,
    );
    const checkboxModern = await screen.findByTestId(
      `checkbox-select-${CASE_MODERN.id}`,
    );
    fireEvent.click(checkboxLegacy);
    fireEvent.click(checkboxModern);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-export");
    fireEvent.click(openPanelBtn);

    let capturedBlob: Blob | undefined;
    createObjectURLSpy.mockImplementation((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob;
      return "blob:mock-url";
    });

    const exportBtn = await screen.findByTestId("panel-export-apply");
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });

    expect(capturedBlob).toBeInstanceOf(Blob);
    const text = await capturedBlob!.text();

    // Raw access codes must be present verbatim.
    expect(text).toContain(CASE_LEGACY.accessCode);
    expect(text).toContain(CASE_MODERN.accessCode);

    // The badge's label/title must never leak into the exported payload.
    expect(text).not.toContain("Legacy-format access code");
    expect(text.split("\n")[0]).not.toContain("Legacy");
  });

  it("reports the raw accessCode (not badge markup) in the bulk access-code failure list for a legacy-coded case", async () => {
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
                { id: CASE_MODERN.id, success: true, sentTo: CASE_MODERN.userEmail },
                { id: CASE_LEGACY.id, success: false, error: "SMTP connection refused" },
              ],
            }),
          );
        }
        return Promise.resolve(jsonOk({}, 404));
      });

    render(<CasesTab />);

    const checkboxLegacy = await screen.findByTestId(
      `checkbox-select-${CASE_LEGACY.id}`,
    );
    const checkboxModern = await screen.findByTestId(
      `checkbox-select-${CASE_MODERN.id}`,
    );
    fireEvent.click(checkboxLegacy);
    fireEvent.click(checkboxModern);

    const openPanelBtn = await screen.findByTestId("sidebar-fn-access-code");
    fireEvent.click(openPanelBtn);

    const sendBtn = await screen.findByTestId("panel-access-code-send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    await waitFor(() => {
      const list = screen.getByTestId("access-code-failure-list");
      expect(list.textContent).toContain(CASE_LEGACY.accessCode);
      expect(list.textContent).toContain("Legacy Case");
      expect(list.textContent).toContain("SMTP connection refused");
      // Must not accidentally duplicate/inject the badge's own copy.
      expect(list.textContent).not.toContain("Legacy-format access code");
    });

    // The legacy badge is unaffected by the panel being open / send firing.
    expect(
      screen.getByTestId(`badge-legacy-access-code-${CASE_LEGACY.id}`),
    ).toBeTruthy();

    const retryBtn = screen.getByTestId("access-code-retry-failed");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect((checkboxLegacy as HTMLInputElement).checked).toBe(true);
      expect((checkboxModern as HTMLInputElement).checked).toBe(false);
    });
  });
});
