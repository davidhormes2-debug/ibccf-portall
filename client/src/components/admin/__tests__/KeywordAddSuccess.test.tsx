// @vitest-environment jsdom
//
// Regression guard: keyword add happy path — success case.
//
// Contract under test (addKeywordMutation in CommunityManagement.tsx):
//   When POST /api/admin/community/keywords returns 200 with the newly
//   created keyword, the mutation's onSuccess handler must:
//     1. Call queryClient.invalidateQueries for the keywords list so the
//        cache is refreshed and the new keyword appears.
//     2. NOT fire a destructive toast — success is silent (a positive toast
//        is expected instead).
//
// After invalidation the query is refetched; we seed the refetch response
// with the original keyword plus the newly-added one and confirm it renders,
// proving the invalidation + refetch cycle is wired correctly.

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

const KEYWORD_EXISTING = {
  id: 11,
  pattern: "fraud",
  isWildcard: false,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  createdBy: "admin",
};

const KEYWORD_NEW = {
  id: 42,
  pattern: "scam*money",
  isWildcard: true,
  isActive: true,
  createdAt: new Date("2026-07-02T00:00:00Z").toISOString(),
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

  qc.setQueryData(["/api/admin/community/keywords"], [KEYWORD_EXISTING]);
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

describe("CommunityManagement — keyword add on success (200)", () => {
  it("invalidates the keywords query and shows the new keyword after a successful POST", async () => {
    let posted = false;

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        // POST — create the new keyword.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          opts?.method === "POST"
        ) {
          posted = true;
          return jsonResp(KEYWORD_NEW);
        }

        // GET keywords list — the query is cache-seeded with an Infinity
        // staleTime, so the only GET fired is the one triggered by
        // invalidateQueries() after the POST succeeds.
        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp(
            posted ? [KEYWORD_EXISTING, KEYWORD_NEW] : [KEYWORD_EXISTING],
          );
        }

        return jsonResp([]);
      },
    );

    const { qc } = renderWithQc();
    await navigateToKeywordsTab();

    const input = await screen.findByTestId("input-new-keyword");
    expect(screen.queryByTestId(`keyword-row-${KEYWORD_NEW.id}`)).toBeNull();

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const user = userEvent.setup();
    await user.type(input, KEYWORD_NEW.pattern);
    await user.click(screen.getByTestId("button-add-keyword"));

    // invalidateQueries must be called with the keywords query key.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["/api/admin/community/keywords"],
        }),
      ),
    );

    // After invalidation + refetch resolves, the new keyword should render.
    await waitFor(() =>
      expect(
        screen.queryByTestId(`keyword-row-${KEYWORD_NEW.id}`),
      ).not.toBeNull(),
    );
  });

  it("does not show a destructive toast when the POST returns 200", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        if (
          urlStr.includes("/api/admin/community/keywords") &&
          opts?.method === "POST"
        ) {
          return jsonResp(KEYWORD_NEW);
        }

        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp([KEYWORD_EXISTING]);
        }

        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    const input = await screen.findByTestId("input-new-keyword");

    const user = userEvent.setup();
    await user.type(input, KEYWORD_NEW.pattern);
    await user.click(screen.getByTestId("button-add-keyword"));

    // Wait long enough for any async handlers to settle.
    await new Promise((r) => setTimeout(r, 100));

    const destructiveCalls = toastMock.mock.calls.filter(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>).variant === "destructive",
    );
    expect(destructiveCalls).toHaveLength(0);

    // A positive confirmation toast should have fired instead.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Keyword added" }),
    );
  });

  it("clears the input field after the keyword is successfully added", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async (url: unknown, opts?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        if (
          urlStr.includes("/api/admin/community/keywords") &&
          opts?.method === "POST"
        ) {
          return jsonResp(KEYWORD_NEW);
        }

        if (
          urlStr.includes("/api/admin/community/keywords") &&
          (!opts?.method || opts.method === "GET")
        ) {
          return jsonResp([KEYWORD_EXISTING, KEYWORD_NEW]);
        }

        return jsonResp([]);
      },
    );

    renderWithQc();
    await navigateToKeywordsTab();

    const input = (await screen.findByTestId(
      "input-new-keyword",
    )) as HTMLInputElement;

    const user = userEvent.setup();
    await user.type(input, KEYWORD_NEW.pattern);
    expect(input.value).toBe(KEYWORD_NEW.pattern);

    await user.click(screen.getByTestId("button-add-keyword"));

    await waitFor(() => expect(input.value).toBe(""));
  });
});
