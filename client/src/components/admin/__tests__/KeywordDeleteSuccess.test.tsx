// @vitest-environment jsdom
//
// Regression guard: keyword delete happy path — success case.
//
// Contract under test (deleteKeywordMutation in CommunityManagement.tsx):
//   When DELETE /api/admin/community/keywords/:id returns 200, the mutation's
//   onSuccess handler must:
//     1. Call queryClient.invalidateQueries for the keywords list so the
//        cache is refreshed and the deleted keyword disappears.
//     2. Show a non-destructive success toast ("Keyword removed").
//
// After invalidation the query is refetched; we seed the refetch response
// with the keyword removed so we can confirm it disappears from the
// rendered list, proving the invalidation + refetch cycle is wired
// correctly.

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
  id: 22,
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

  qc.setQueryData(["/api/admin/community/keywords"], [KEYWORD]);
  qc.setQueryData(["/api/admin/community/flagged"], { posts: [], threads: [] });
  qc.setQueryData(["/api/admin/community/stats"], {
    threads: "0",
    posts: "0",
    members: 0,
    activeBots: "0",
    totalViews: 0,
  });
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

describe("CommunityManagement — keyword delete on success (200)", () => {
  it("invalidates the keywords query, shows a success toast, and removes the keyword from the list", async () => {
    let deleteDone = false;

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        // DELETE — return success.
        if (
          urlStr.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
          opts?.method === "DELETE"
        ) {
          deleteDone = true;
          return jsonResp({ success: true });
        }

        // GET keywords list — before the delete resolves, return the
        // keyword; after the delete succeeds (triggering invalidation),
        // return an empty list since the keyword was removed.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp(deleteDone ? [] : [KEYWORD]);
        }

        return jsonResp([]);
      },
    );

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { qc } = renderWithQc();
    await navigateToKeywordsTab();

    const row = await screen.findByTestId(`keyword-row-${KEYWORD.id}`);
    expect(row).toBeTruthy();

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const deleteButton = await screen.findByTestId(
      `button-delete-keyword-${KEYWORD.id}`,
    );

    const user = userEvent.setup();
    await user.click(deleteButton);

    // invalidateQueries must be called with the keywords query key.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["/api/admin/community/keywords"],
        }),
      ),
    );

    // A non-destructive success toast must be shown.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Keyword removed",
        }),
      ),
    );
    const destructiveCalls = toastMock.mock.calls.filter(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>).variant === "destructive",
    );
    expect(destructiveCalls).toHaveLength(0);

    // After the invalidation refetch resolves, the keyword row must be gone.
    await waitFor(() =>
      expect(
        screen.queryByTestId(`keyword-row-${KEYWORD.id}`),
      ).toBeNull(),
    );
  });
});
