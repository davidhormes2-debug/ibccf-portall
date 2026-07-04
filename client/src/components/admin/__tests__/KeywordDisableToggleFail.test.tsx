// @vitest-environment jsdom
//
// Regression guard: keyword disable toggle fails silently after a network error.
//
// Contract under test (toggleKeywordMutation in CommunityManagement.tsx):
//   When PATCH /api/admin/community/keywords/:id returns a 500 error, the
//   mutation's onError handler must:
//     1. Show a destructive toast so the admin knows the action failed.
//     2. Leave the switch in its original checked state — the query cache is
//        never mutated on error (no optimistic update to roll back), so the
//        switch, which is purely driven by `kw.isActive` from the cache, must
//        remain checked.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must appear before component imports.
// ---------------------------------------------------------------------------

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

import { CommunityManagement } from "../CommunityManagement";

// ---------------------------------------------------------------------------
// Environment stubs required by Radix UI components used inside
// CommunityManagement (ScrollArea, Switch, Dialog, Tabs, etc.)
// ---------------------------------------------------------------------------

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
}
if (!window.HTMLElement.prototype.setPointerCapture) {
  window.HTMLElement.prototype.setPointerCapture = () => {};
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = () => {};
}
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KEYWORD = {
  id: 7,
  pattern: "scam",
  isWildcard: false,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  createdBy: "admin",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function renderWithQc() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  // Pre-seed every query used by CommunityManagement so no network calls are
  // needed for the initial render.
  qc.setQueryData(["/api/admin/community/keywords"], [KEYWORD]);
  qc.setQueryData(["/api/admin/community/flagged"], { posts: [], threads: [] });
  qc.setQueryData(["/api/community/stats"], {
    threads: "0",
    posts: "0",
    members: 0,
    activeBots: "0",
    totalViews: 0,
  });
  qc.setQueryData(["/api/departments"], []);
  qc.setQueryData(["/api/community/threads", "all", "", "recent"], []);
  qc.setQueryData(["/api/community/threads/top-views"], []);

  const result = render(
    <QueryClientProvider client={qc}>
      <CommunityManagement />
    </QueryClientProvider>,
  );

  return { ...result, qc };
}

// ---------------------------------------------------------------------------
// Navigation helper — mirrors the approach in CommunityFlaggedSelectionPruning
// ---------------------------------------------------------------------------

async function navigateToKeywordsTab() {
  const user = userEvent.setup();
  const kwTab = await screen.findByRole("tab", { name: /keyword blocklist/i });
  await user.click(kwTab);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  toastMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CommunityManagement — keyword toggle on network error", () => {
  it("shows a destructive toast when the PATCH returns 500", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
          opts?.method === "PATCH"
        ) {
          return jsonResp({ error: "Internal Server Error" }, 500);
        }
        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    // The keyword row should now be visible.
    const switchEl = await screen.findByTestId(`switch-keyword-active-${KEYWORD.id}`);

    // Confirm the switch starts in the checked (active) state.
    expect(switchEl.getAttribute("data-state")).toBe("checked");

    // Click the switch — triggers the PATCH which returns 500.
    const user = userEvent.setup();
    await user.click(switchEl);

    // The mutation's onError handler must fire a destructive toast.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      ),
    );
  });

  it("switch is disabled while the PATCH is in flight (isPending guard)", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (
        typeof url === "string" &&
        url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
        opts?.method === "PATCH"
      ) {
        return patchPromise;
      }
      if (typeof url === "string" && url.includes("/api/admin/community/keywords")) {
        return jsonResp([KEYWORD]);
      }
      return jsonResp([]);
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(`switch-keyword-active-${KEYWORD.id}`);
    expect((switchEl as HTMLButtonElement).disabled).toBe(false);

    const user = userEvent.setup();
    await user.click(switchEl);

    await waitFor(() =>
      expect((switchEl as HTMLButtonElement).disabled).toBe(true),
    );

    const patchCallsAfterFirst = fetchMock.mock.calls.filter(
      ([url, opts]: [unknown, RequestInit | undefined]) =>
        typeof url === "string" &&
        url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
        opts?.method === "PATCH",
    ).length;

    await user.click(switchEl);

    const patchCallsAfterSecond = fetchMock.mock.calls.filter(
      ([url, opts]: [unknown, RequestInit | undefined]) =>
        typeof url === "string" &&
        url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
        opts?.method === "PATCH",
    ).length;

    expect(patchCallsAfterSecond).toBe(patchCallsAfterFirst);
    expect(toastMock).not.toHaveBeenCalled();

    resolvePatch(jsonResp({ id: KEYWORD.id, isActive: false }));

    await waitFor(() =>
      expect((switchEl as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("delete button is disabled while the toggle PATCH is in flight", async () => {
    let resolvePatch!: (r: Response) => void;
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (
        typeof url === "string" &&
        url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
        opts?.method === "PATCH"
      ) {
        return patchPromise;
      }
      if (typeof url === "string" && url.includes("/api/admin/community/keywords")) {
        return jsonResp([KEYWORD]);
      }
      return jsonResp([]);
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(`switch-keyword-active-${KEYWORD.id}`);
    const deleteButton = await screen.findByTestId(`button-delete-keyword-${KEYWORD.id}`);
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);

    const user = userEvent.setup();
    await user.click(switchEl);

    await waitFor(() =>
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true),
    );

    resolvePatch(jsonResp({ id: KEYWORD.id, isActive: false }));

    await waitFor(() =>
      expect((deleteButton as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("delete button is disabled while its own DELETE mutation is in flight", async () => {
    let resolveDelete!: (r: Response) => void;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async (url: unknown, opts?: RequestInit) => {
      if (
        typeof url === "string" &&
        url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
        opts?.method === "DELETE"
      ) {
        return deletePromise;
      }
      if (typeof url === "string" && url.includes("/api/admin/community/keywords")) {
        return jsonResp([KEYWORD]);
      }
      return jsonResp([]);
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    renderWithQc();
    await navigateToKeywordsTab();

    const deleteButton = await screen.findByTestId(`button-delete-keyword-${KEYWORD.id}`);
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);

    const user = userEvent.setup();
    await user.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalled();

    await waitFor(() =>
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true),
    );

    resolveDelete(jsonResp({ success: true }));

    await waitFor(() =>
      expect((deleteButton as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("switch stays checked after a 500 error (no optimistic update to roll back)", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
          opts?.method === "PATCH"
        ) {
          return jsonResp({ error: "Internal Server Error" }, 500);
        }
        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(`switch-keyword-active-${KEYWORD.id}`);
    expect(switchEl.getAttribute("data-state")).toBe("checked");

    // Trigger the failing toggle.
    const user = userEvent.setup();
    await user.click(switchEl);

    // Wait for the error toast to confirm the mutation completed.
    await waitFor(() => expect(toastMock).toHaveBeenCalled());

    // The switch must remain in its original checked state because the query
    // cache was never changed (toggleKeywordMutation has no onMutate optimistic
    // update, so there is nothing to roll back and the cache-driven checked prop
    // is still true).
    expect(
      screen.getByTestId(`switch-keyword-active-${KEYWORD.id}`).getAttribute("data-state"),
    ).toBe("checked");
  });
});
