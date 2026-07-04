// @vitest-environment jsdom
//
// Task #2362 — bulk "Email" must gate large batches behind a confirmation
// dialog before firing the request, mirroring the Task #2355 access-code
// confirmation gate. A misclick with a broad filter/select-all must not
// silently email hundreds of users. Below the threshold the send still
// fires immediately (unchanged prior behavior).
//
// Contracts verified:
//   1. Selecting a small batch (<= threshold) and clicking "Send to N"
//      fires the request immediately — no confirmation dialog.
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
  // leaving the "email" panel open makes the next test's click on
  // sidebar-fn-email toggle it CLOSED instead of opening it.
  localStorage.clear();

  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && /\/api\/cases\/case-\d+\/email$/.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
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

async function selectAllAndOpenEmailPanel() {
  render(<CasesTab />);

  const selectAll = await screen.findByTestId("checkbox-select-all");
  fireEvent.click(selectAll);

  const emailFn = await screen.findByTestId("sidebar-fn-email");
  fireEvent.click(emailFn);

  const subjectInput = await screen.findByTestId("panel-email-subject");
  fireEvent.change(subjectInput, { target: { value: "Important update" } });

  return screen.findByTestId("panel-email-send");
}

describe("CasesTab – bulk email send confirmation gate", () => {
  it("fires immediately for a small batch (<= threshold), no confirmation dialog", async () => {
    mockCases = buildCases(5);
    const sendButton = await selectAllAndOpenEmailPanel();

    fireEvent.click(sendButton);

    expect(screen.queryByTestId("dialog-confirm-bulk-email-send")).toBeNull();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
        expect.anything(),
      ),
    );
  }, 15000);

  it("shows a confirmation dialog for a large batch (> threshold) instead of firing immediately", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenEmailPanel();

    fireEvent.click(sendButton);

    const dialog = await screen.findByTestId("dialog-confirm-bulk-email-send");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("25");
    expect(dialog.textContent).toMatch(/25.*of.*25.*have email on file/s);

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
      expect.anything(),
    );
  }, 15000);

  it("cancels without firing the request", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenEmailPanel();
    fireEvent.click(sendButton);

    const cancelButton = await screen.findByTestId("button-confirm-bulk-email-cancel");
    fireEvent.click(cancelButton);

    await waitFor(() =>
      expect(screen.queryByTestId("dialog-confirm-bulk-email-send")).toBeNull(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
      expect.anything(),
    );
  }, 15000);

  it("fires the request after confirming", async () => {
    mockCases = buildCases(25);
    const sendButton = await selectAllAndOpenEmailPanel();
    fireEvent.click(sendButton);

    const confirmButton = await screen.findByTestId("button-confirm-bulk-email-send");
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
        expect.anything(),
      ),
    );
  }, 15000);
});
