// @vitest-environment jsdom
//
// Regression guard: keyword delete failure path.
//
// Contract under test (deleteKeywordMutation in CommunityManagement.tsx):
//   When DELETE /api/admin/community/keywords/:id returns a non-2xx
//   response, the mutation's onError handler must:
//     1. Show a destructive toast ("Failed to delete keyword").
//     2. NOT call queryClient.invalidateQueries for the keywords query key.
//   The keyword row must remain visible in the rendered list since it was
//   never removed from the server.

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

describe("CommunityManagement — keyword delete on failure (non-2xx)", () => {
  it("shows a destructive toast, does not invalidate the keywords query, and keeps the keyword in the list", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        // DELETE — simulate a server-side failure.
        if (
          urlStr.includes(`/api/admin/community/keywords/${KEYWORD.id}`) &&
          opts?.method === "DELETE"
        ) {
          return jsonResp({ error: "Internal Server Error" }, 500);
        }

        // GET keywords list — the keyword is never removed server-side.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp([KEYWORD]);
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

    // A destructive error toast must be shown.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error",
          description: "Failed to delete keyword",
          variant: "destructive",
        }),
      ),
    );

    // invalidateQueries must NOT be called for the keywords query key.
    const invalidatedKeywordsKey = invalidateSpy.mock.calls.some(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        Array.isArray((args[0] as { queryKey?: unknown[] }).queryKey) &&
        (args[0] as { queryKey: unknown[] }).queryKey[0] ===
          "/api/admin/community/keywords",
    );
    expect(invalidatedKeywordsKey).toBe(false);

    // The keyword row must still be present after the failed request.
    expect(
      screen.getByTestId(`keyword-row-${KEYWORD.id}`),
    ).toBeTruthy();
  });
});
