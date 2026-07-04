// @vitest-environment jsdom
//
// Task #2448 — Warn admins before bulk-rotating codes for cases with active
// portal sessions. The bulk rotate confirm dialog (shown for batches above
// the confirm threshold) must surface how many of the targeted cases
// currently have an active portal session, since rotation force-drops every
// one of them via deleteSessionsByCaseId on the server. Purely a visibility
// improvement — the underlying rotation/session-drop behavior is unchanged.
//
// Contracts verified:
//   1. Opening the confirm dialog for a large batch triggers a per-case
//      GET /api/cases/:id/active-session check and renders the resulting
//      "N of M currently logged into the portal" warning once resolved.
//   2. A batch with zero active sessions renders a "0 of N" reassuring
//      (non-alarming) variant of the same line.
//   3. If the underlying fetch calls reject, checkHasActiveSession() itself
//      fails open (resolves hasActiveSession: false) rather than
//      propagating the error, so the dialog still renders a usable count
//      and never blocks the admin from confirming the rotation.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
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

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function notFoundResponse() {
  return Promise.resolve(jsonOk({}, 404));
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

async function selectAllAndOpenRotatePanel() {
  render(<CasesTab />);

  const selectAll = await screen.findByTestId("checkbox-select-all");
  fireEvent.click(selectAll);

  const accessCodeFn = await screen.findByTestId("sidebar-fn-access-code");
  fireEvent.click(accessCodeFn);

  return screen.findByTestId("panel-access-code-rotate");
}

describe("CasesTab – bulk rotate active-session warning (Task #2448)", () => {
  it("shows how many targeted cases have an active portal session", async () => {
    mockCases = buildCases(25);
    const activeIds = new Set(["case-0", "case-3", "case-7"]);
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      const match = u.match(/\/api\/cases\/([^/]+)\/active-session/);
      if (match) {
        const id = match[1];
        return Promise.resolve(
          jsonOk({
            hasActiveSession: activeIds.has(id),
            expiresAt: null,
            lastActivityAt: activeIds.has(id) ? new Date().toISOString() : null,
          }),
        );
      }
      return notFoundResponse();
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const rotateBtn = await selectAllAndOpenRotatePanel();
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    const dialog = await screen.findByTestId("dialog-confirm-access-code-rotate");
    expect(dialog).toBeTruthy();

    await waitFor(() => {
      const warning = screen.getByTestId("bulk-rotate-active-session-warning");
      expect(warning.textContent).toMatch(/3.*of.*25.*currently logged into the portal/s);
    });
  }, 15000);

  it("shows a reassuring 0-of-N variant when no targeted case has an active session", async () => {
    mockCases = buildCases(25);
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/active-session")) {
        return Promise.resolve(
          jsonOk({ hasActiveSession: false, expiresAt: null, lastActivityAt: null }),
        );
      }
      return notFoundResponse();
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const rotateBtn = await selectAllAndOpenRotatePanel();
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await screen.findByTestId("dialog-confirm-access-code-rotate");

    await waitFor(() => {
      const warning = screen.getByTestId("bulk-rotate-active-session-warning");
      expect(warning.textContent).toMatch(/0.*of.*25.*currently logged into the portal/s);
    });
  }, 15000);

  it("fails open with a usable count if the underlying active-session fetches error out", async () => {
    mockCases = buildCases(25);
    const fetchMock = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/active-session")) {
        return Promise.reject(new Error("network error"));
      }
      return notFoundResponse();
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    const rotateBtn = await selectAllAndOpenRotatePanel();
    await act(async () => {
      fireEvent.click(rotateBtn);
    });

    await screen.findByTestId("dialog-confirm-access-code-rotate");

    // checkHasActiveSession swallows its own fetch errors and resolves with
    // hasActiveSession: false, so the dialog still renders a usable count
    // (0) instead of getting stuck on "Checking…" or blocking the confirm
    // action.
    await waitFor(() => {
      const warning = screen.getByTestId("bulk-rotate-active-session-warning");
      expect(warning.textContent).toMatch(/of.*25/s);
    });

    const confirmBtn = await screen.findByTestId("button-confirm-access-code-rotate");
    expect(confirmBtn).not.toBeDisabled();
  }, 15000);
});
