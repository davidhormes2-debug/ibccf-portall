// @vitest-environment jsdom
//
// Community moderation column regression guard.
//
// A missing `is_flagged`/`flag_reason` column on the live DB (present in
// shared/schema.ts but not applied to the database) previously caused the
// admin community tab to crash silently once thread/post rows started
// carrying those moderation fields. There was no test that mounted the real
// <CommunityManagement> component with rows that actually include
// `isFlagged`/`flagReason` on BOTH the main threads list and the flagged
// tab, so a future moderation-column addition could regress the same way
// without any coverage catching it.
//
// This test renders the full component with thread/post rows (main list +
// flagged list) carrying `isFlagged`/`flagReason`, and asserts it renders
// without throwing and shows the expected content.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

import { CommunityManagement } from "../CommunityManagement";

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

interface ThreadRow {
  id: number;
  departmentId: number;
  title: string;
  content: string;
  authorType: string;
  authorHandle: string;
  isPinned: boolean;
  isLocked: boolean;
  isFlagged: boolean;
  flagReason: string | null;
  viewCount: string;
  replyCount: string;
  lastActivityAt: string;
  createdAt: string;
}

interface PostRow {
  id: number;
  threadId: number;
  content: string;
  authorHandle: string;
  authorType: string;
  isFlagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

const THREAD_WITH_MODERATION_FIELDS: ThreadRow = {
  id: 1,
  departmentId: 1,
  title: "Flagged thread appears in the main list",
  content: "This thread carries is_flagged/flag_reason columns",
  authorType: "user",
  authorHandle: "alice",
  isPinned: false,
  isLocked: false,
  isFlagged: true,
  flagReason: "keyword_match: scam",
  viewCount: "12",
  replyCount: "3",
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const FLAGGED_POST_ROW: PostRow = {
  id: 9,
  threadId: 1,
  content: "A reply that got flagged",
  authorHandle: "bob",
  authorType: "user",
  isFlagged: true,
  flagReason: "keyword_match: scam",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const FLAGGED_THREAD_ROW = {
  id: 1,
  title: THREAD_WITH_MODERATION_FIELDS.title,
  content: THREAD_WITH_MODERATION_FIELDS.content,
  authorHandle: "alice",
  authorType: "user",
  isFlagged: true,
  flagReason: "keyword_match: scam",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderWithQc() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(
    ["/api/community/threads", "all", "", "recent"],
    [THREAD_WITH_MODERATION_FIELDS],
  );
  qc.setQueryData(["/api/community/threads/top-views"], [THREAD_WITH_MODERATION_FIELDS]);
  qc.setQueryData(["/api/community/stats"], {
    threads: "1", posts: "1", members: 1, activeBots: "1", totalViews: 12,
  });
  qc.setQueryData(["/api/departments"], [
    { id: 1, key: "general", name: "General", description: "", icon: "MessageSquare", color: "#888", displayOrder: "1", isActive: true },
  ]);
  qc.setQueryData(["/api/admin/community/keywords"], []);
  qc.setQueryData(["/api/admin/community/flagged"], {
    posts: [FLAGGED_POST_ROW],
    threads: [FLAGGED_THREAD_ROW],
  });
  (globalThis as any).fetch = vi.fn(async () => jsonOk([]));
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <CommunityManagement />
      </QueryClientProvider>,
    ),
    qc,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommunityManagement — renders with is_flagged/flag_reason present on rows", () => {
  it("renders the Threads tab without throwing when thread rows carry isFlagged/flagReason", async () => {
    expect(() => renderWithQc()).not.toThrow();

    const row = await screen.findByTestId(
      `admin-thread-row-${THREAD_WITH_MODERATION_FIELDS.id}`,
    );
    expect(row).toBeTruthy();
    expect(row.textContent).toContain(THREAD_WITH_MODERATION_FIELDS.title);
  });

  it("renders the Flagged Content tab without throwing when post/thread rows carry isFlagged/flagReason", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderWithQc();

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    await waitFor(() => {
      expect(screen.getAllByText(FLAGGED_THREAD_ROW.title).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/matched: scam/i).length).toBeGreaterThan(0);
  });
});
