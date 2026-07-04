// @vitest-environment jsdom
//
// Regression guard: keyword toggle happy path — success case.
//
// Contract under test (toggleKeywordMutation in CommunityManagement.tsx):
//   When PATCH /api/admin/community/keywords/:id returns 200 with the updated
//   keyword, the mutation's onSuccess handler must:
//     1. Call queryClient.invalidateQueries for the keywords list so the cache
//        is refreshed and the switch reflects the server's new state.
//     2. NOT fire a destructive toast — success is silent.
//
// After invalidation the query is refetched; we seed the refetch response with
// the toggled keyword (isActive: false) and confirm the switch flips to
// unchecked, proving the invalidation + refetch cycle is wired correctly.

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

const KEYWORD_ACTIVE = {
  id: 11,
  pattern: "fraud",
  isWildcard: false,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  createdBy: "admin",
};

const KEYWORD_INACTIVE = { ...KEYWORD_ACTIVE, isActive: false };

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

  qc.setQueryData(["/api/admin/community/keywords"], [KEYWORD_ACTIVE]);
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

describe("CommunityManagement — keyword toggle on success (200)", () => {
  it("invalidates the keywords query and reflects the new state after a successful PATCH", async () => {
    // Track whether the keywords list was re-fetched after invalidation.
    let refetchCount = 0;

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        // PATCH — return the updated (now inactive) keyword.
        if (
          urlStr.includes(`/api/admin/community/keywords/${KEYWORD_ACTIVE.id}`) &&
          opts?.method === "PATCH"
        ) {
          return jsonResp(KEYWORD_INACTIVE);
        }

        // GET keywords list — first call returns the active keyword; subsequent
        // calls (triggered by invalidation) return the inactive keyword so the
        // switch can flip to unchecked.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          refetchCount += 1;
          if (refetchCount === 1) {
            return jsonResp([KEYWORD_ACTIVE]);
          }
          return jsonResp([KEYWORD_INACTIVE]);
        }

        return jsonResp([]);
      },
    );

    const { qc } = renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(
      `switch-keyword-active-${KEYWORD_ACTIVE.id}`,
    );

    // Switch starts checked (keyword is active).
    expect(switchEl.getAttribute("data-state")).toBe("checked");

    // Spy on invalidateQueries to confirm the onSuccess handler calls it.
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const user = userEvent.setup();
    await user.click(switchEl);

    // invalidateQueries must be called with the keywords query key.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["/api/admin/community/keywords"],
        }),
      ),
    );
  });

  it("does not show a destructive toast when the PATCH returns 200", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        if (
          urlStr.includes(`/api/admin/community/keywords/${KEYWORD_ACTIVE.id}`) &&
          opts?.method === "PATCH"
        ) {
          return jsonResp(KEYWORD_INACTIVE);
        }

        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(
      `switch-keyword-active-${KEYWORD_ACTIVE.id}`,
    );

    const user = userEvent.setup();
    await user.click(switchEl);

    // Wait long enough for any async handlers to settle.
    await new Promise((r) => setTimeout(r, 100));

    // No destructive toast should have been fired on success.
    const destructiveCalls = toastMock.mock.calls.filter(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>).variant === "destructive",
    );
    expect(destructiveCalls).toHaveLength(0);
  });

  it("switch reflects new unchecked state after invalidation refetch resolves", async () => {
    let patchDone = false;

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        if (
          urlStr.includes(`/api/admin/community/keywords/${KEYWORD_ACTIVE.id}`) &&
          opts?.method === "PATCH"
        ) {
          patchDone = true;
          return jsonResp(KEYWORD_INACTIVE);
        }

        // After the PATCH succeeds, re-fetches return the inactive keyword.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp(patchDone ? [KEYWORD_INACTIVE] : [KEYWORD_ACTIVE]);
        }

        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    const switchEl = await screen.findByTestId(
      `switch-keyword-active-${KEYWORD_ACTIVE.id}`,
    );
    expect(switchEl.getAttribute("data-state")).toBe("checked");

    const user = userEvent.setup();
    await user.click(switchEl);

    // After the successful toggle + invalidation + refetch, the switch must
    // flip to unchecked because the cache now holds isActive: false.
    await waitFor(() =>
      expect(
        screen
          .getByTestId(`switch-keyword-active-${KEYWORD_ACTIVE.id}`)
          .getAttribute("data-state"),
      ).toBe("unchecked"),
    );
  });
});
