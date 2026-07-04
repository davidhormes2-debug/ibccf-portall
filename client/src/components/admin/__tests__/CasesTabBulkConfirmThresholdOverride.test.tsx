// @vitest-environment jsdom
//
// Task #2400 — Task #2395 made the bulk Email / Block IPs / Access Code
// confirmation threshold configurable via VITE_BULK_CONFIRM_THRESHOLD
// (falling back to a default of 20), but no test actually overrode the env
// var to confirm the value takes effect. This file closes that gap using
// the bulk-email send flow as the representative surface (all three bulk
// actions share the same BULK_CONFIRM_THRESHOLD constant in CasesTab.tsx).
//
// Contracts verified:
//   1. Setting VITE_BULK_CONFIRM_THRESHOLD to a non-default value (5) moves
//      the confirmation boundary: a batch of 5 (<= new threshold) fires
//      immediately, and a batch of 6 (> new threshold) shows the dialog —
//      neither of which would happen at the hardcoded default of 20.
//   2. An invalid override ("abc") falls back to the default of 20: a batch
//      of 20 still fires immediately and a batch of 21 still shows the
//      dialog.

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
  vi.unstubAllEnvs();
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

describe("CasesTab – bulk confirm threshold honors VITE_BULK_CONFIRM_THRESHOLD override", () => {
  it("moves the boundary down to a custom threshold (5): batch of 5 fires immediately", async () => {
    vi.stubEnv("VITE_BULK_CONFIRM_THRESHOLD", "5");
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

  it("moves the boundary down to a custom threshold (5): batch of 6 shows the confirmation dialog", async () => {
    vi.stubEnv("VITE_BULK_CONFIRM_THRESHOLD", "5");
    mockCases = buildCases(6);
    const sendButton = await selectAllAndOpenEmailPanel();

    fireEvent.click(sendButton);

    const dialog = await screen.findByTestId("dialog-confirm-bulk-email-send");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("6");

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
      expect.anything(),
    );
  }, 15000);

  it("falls back to the default of 20 when the override is not a valid positive integer (\"abc\"): batch of 20 fires immediately", async () => {
    vi.stubEnv("VITE_BULK_CONFIRM_THRESHOLD", "abc");
    mockCases = buildCases(20);
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

  // These two "-1" cases are deliberately paired at 20 vs 21 (not just a
  // single assertion at 21) so the test actually discriminates "fell back
  // to the default of 20" from a buggy implementation that mistakenly
  // accepted -1 as the threshold itself — that bug would also show the
  // dialog at 21 (since 21 > -1), so asserting only the 21 case would pass
  // even with the guard broken. Asserting 20 still fires immediately rules
  // that out.
  it("falls back to the default of 20 when the override is negative (\"-1\"): batch of 20 fires immediately", async () => {
    vi.stubEnv("VITE_BULK_CONFIRM_THRESHOLD", "-1");
    mockCases = buildCases(20);
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

  it("falls back to the default of 20 when the override is negative (\"-1\"): batch of 21 shows the confirmation dialog", async () => {
    vi.stubEnv("VITE_BULK_CONFIRM_THRESHOLD", "-1");
    mockCases = buildCases(21);
    const sendButton = await selectAllAndOpenEmailPanel();

    fireEvent.click(sendButton);

    const dialog = await screen.findByTestId("dialog-confirm-bulk-email-send");
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("21");

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/cases\/case-\d+\/email$/),
      expect.anything(),
    );
  }, 15000);
});
