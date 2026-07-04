// @vitest-environment jsdom
//
// Task #2355 — bulk "Send access code" must gate large batches behind a
// confirmation dialog before firing the request. Access codes are live
// login credentials, so a misclick with a broad filter/select-all must not
// silently email hundreds of users. Below the threshold the send still
// fires immediately (unchanged Task #2335 behavior).
//
// Contracts verified:
//   1. Selecting a small batch (<= threshold) and clicking "Send access
//      code…" fires the request immediately — no confirmation dialog.
//   2. Selecting a large batch (> threshold) shows a confirmation dialog
//      instead of firing the request, and the dialog surfaces the same
//      "N of M have email on file" eligibility indicator.
//   3. Confirming the dialog fires the request; canceling does not.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function buildCases(count: number): Case[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `case-${i}`,
    accessCode: `ACC${String(i).padStart(4, "0")}`,
    status: "active" as const,
    userEmail: `user${i}@example.com`,
    userName: `User ${i}`,
  })) as unknown as Case[];
}

let mockCases: Case[] = [];

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () =>
      buildMockAdminDashboardContext({
        cases: mockCases,
        filteredCases: mockCases,
      }) as AdminDashboardContextValue,
  };
});

vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: () => null,
}));

function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  if (
    !(Element.prototype as unknown as { hasPointerCapture?: unknown })
      .hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }
  if (
    !(Element.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView
  ) {
    (
      Element.prototype as unknown as { scrollIntoView: () => void }
    ).scrollIntoView = () => {};
  }

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

  // CasesTab persists the sidebar's activeFunction to localStorage so it
  // survives reload. Clear it between tests — otherwise a prior test
  // leaving the "access-code" panel open makes the next test's click on
  // sidebar-fn-access-code toggle it CLOSED instead of opening it.
  localStorage.clear();

  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/cases/bulk/send-access-code")) {
      return Promise.resolve(
        new Response(JSON.stringify({ successCount: 1, failureCount: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      );
    }
    return notFoundResponse();
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

async function selectAllAndOpenAccessCodePanel() {
  render(<CasesTab />);

  const selectAll = await screen.findByTestId("checkbox-select-all");
  fireEvent.click(selectAll);

  const accessCodeFn = await screen.findByTestId("sidebar-fn-access-code");
  fireEvent.click(accessCodeFn);

  return screen.findByTestId("panel-access-code-send");
}

describe("CasesTab – bulk access-code send confirmation gate", () => {
  it("fires immediately for a small batch (<= threshold), no confirmation dialog", async () => {
    mockCases = buildCases(5);
    const sendButton = await selectAllAndOpenAccessCodePanel();

    fireEvent.click(sendButton);

    expect(screen.queryByTestId("dialog-confirm-access-code-send")).toBeNull();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/cases/bulk/send-access-code",
        expect.anything(),
      ),
    );
  });

  it("shows a confirmation dialog for a large batch (> threshold) instead of firing immediately", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenAccessCodePanel();

    fireEvent.click(sendButton);

    const dialog = await screen.findByTestId("dialog-confirm-access-code-send");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("25");
    expect(dialog.textContent).toMatch(/25.*of.*25.*have email on file/s);

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/cases/bulk/send-access-code",
      expect.anything(),
    );
  }, 30000);

  it("cancels without firing the request", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenAccessCodePanel();
    fireEvent.click(sendButton);

    const cancelButton = await screen.findByTestId("button-confirm-access-code-cancel");
    fireEvent.click(cancelButton);

    await waitFor(() =>
      expect(screen.queryByTestId("dialog-confirm-access-code-send")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/cases/bulk/send-access-code",
      expect.anything(),
    );
  }, 30000);

  it("fires the request after confirming", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenAccessCodePanel();
    fireEvent.click(sendButton);

    const confirmButton = await screen.findByTestId("button-confirm-access-code-send");
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/cases/bulk/send-access-code",
        expect.anything(),
      ),
    );
  }, 30000);
});
