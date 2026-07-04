// @vitest-environment jsdom
//
// Verifies that selected post/thread IDs are pruned when filters change in
// the flagged-content tab of CommunityManagement.
//
// Three layers:
//   1. Static source assertions — sentinel comments + pruning logic exist.
//   2. Functional harness — slim self-contained component drives lifecycle.
//   3. Full component test — real <CommunityManagement> with QueryClient.

import React, { useEffect, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must appear before component imports.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

import { CommunityManagement } from "../CommunityManagement";

// ---------------------------------------------------------------------------
// Static source
// ---------------------------------------------------------------------------

const COMMUNITY_SRC = fs.readFileSync(
  path.resolve(__dirname, "../CommunityManagement.tsx"),
  "utf8",
);

function extractBlock(sentinel: string): string {
  const start = COMMUNITY_SRC.indexOf(sentinel);
  if (start === -1) return "";
  const end = COMMUNITY_SRC.indexOf("\n  const ", start + 1);
  return COMMUNITY_SRC.slice(start, end === -1 ? COMMUNITY_SRC.length : end);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

interface FlaggedPost {
  id: number;
  threadId: number;
  content: string;
  authorHandle: string;
  authorType: string;
  flagReason: string | null;
  createdAt: string;
}

interface FlaggedThread {
  id: number;
  title: string;
  content: string;
  authorHandle: string;
  authorType: string;
  flagReason: string | null;
  createdAt: string;
}

const POST_1: FlaggedPost = {
  id: 1,
  threadId: 10,
  content: "spam content alpha",
  authorHandle: "alice",
  authorType: "user",
  flagReason: "keyword match",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const POST_2: FlaggedPost = {
  id: 2,
  threadId: 10,
  content: "spam content beta",
  authorHandle: "bob",
  authorType: "user",
  flagReason: "keyword match",
  createdAt: "2026-02-01T00:00:00.000Z",
};

const THREAD_1: FlaggedThread = {
  id: 1,
  title: "bad thread alpha",
  content: "problematic text",
  authorHandle: "alice",
  authorType: "user",
  flagReason: "keyword match",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const THREAD_2: FlaggedThread = {
  id: 2,
  title: "bad thread beta",
  content: "other bad text",
  authorHandle: "bob",
  authorType: "user",
  flagReason: "keyword match",
  createdAt: "2026-02-01T00:00:00.000Z",
};

function renderWithQc(
  posts: FlaggedPost[],
  threads: FlaggedThread[],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  qc.setQueryData(["/api/admin/community/flagged"], { posts, threads });
  qc.setQueryData(["/api/community/stats"], {
    threads: "0",
    posts: "0",
    members: 0,
    activeBots: "0",
    totalViews: 0,
  });
  qc.setQueryData(["/api/departments"], []);
  qc.setQueryData(
    ["/api/community/threads", "all", "", "recent"],
    [],
  );
  qc.setQueryData(["/api/community/threads/top-views"], []);
  qc.setQueryData(["/api/admin/community/keywords"], []);

  (globalThis as any).fetch = vi.fn(async () => jsonOk([]));

  const result = render(
    <QueryClientProvider client={qc}>
      <CommunityManagement />
    </QueryClientProvider>,
  );

  return { ...result, qc };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Static source assertions — post pruning effect
// ---------------------------------------------------------------------------

describe("CommunityManagement.tsx — flagged post selection pruning (static)", () => {
  it("contains the post pruning effect sentinel comment", () => {
    expect(COMMUNITY_SRC).toContain("FLAGGED_POST_SELECTION_PRUNING_EFFECT_START");
  });

  it("the post pruning effect guards against empty selection", () => {
    const block = extractBlock("FLAGGED_POST_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("selectedPostIds.size === 0");
  });

  it("the post pruning effect builds liveIds from flaggedPosts", () => {
    const block = extractBlock("FLAGGED_POST_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("liveIds");
    expect(block).toContain("flaggedPosts.map");
  });

  it("the post pruning effect calls setSelectedPostIds with pruned set", () => {
    const block = extractBlock("FLAGGED_POST_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("setSelectedPostIds(pruned)");
  });

  it("the post pruning effect only updates when size changed", () => {
    const block = extractBlock("FLAGGED_POST_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("pruned.size !== selectedPostIds.size");
  });
});

// ---------------------------------------------------------------------------
// 1b. Static source assertions — thread pruning effect
// ---------------------------------------------------------------------------

describe("CommunityManagement.tsx — flagged thread selection pruning (static)", () => {
  it("contains the thread pruning effect sentinel comment", () => {
    expect(COMMUNITY_SRC).toContain("FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START");
  });

  it("the thread pruning effect guards against empty selection", () => {
    const block = extractBlock("FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("selectedThreadIds.size === 0");
  });

  it("the thread pruning effect builds liveIds from flaggedThreads", () => {
    const block = extractBlock("FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("liveIds");
    expect(block).toContain("flaggedThreads.map");
  });

  it("the thread pruning effect calls setSelectedThreadIds with pruned set", () => {
    const block = extractBlock("FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("setSelectedThreadIds(pruned)");
  });

  it("the thread pruning effect only updates when size changed", () => {
    const block = extractBlock("FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START");
    expect(block).toContain("pruned.size !== selectedThreadIds.size");
  });
});

// ---------------------------------------------------------------------------
// 2. Functional harness — post selection pruning
// ---------------------------------------------------------------------------

interface PostHarnessProps {
  initialPosts: FlaggedPost[];
}

function PostSelectionHarness({ initialPosts }: PostHarnessProps) {
  const [allPosts, setAllPosts] = useState<FlaggedPost[]>(initialPosts);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const visiblePosts = search.trim()
    ? allPosts.filter((p) =>
        p.content.toLowerCase().includes(search.toLowerCase()),
      )
    : allPosts;

  // Mirror of the pruning useEffect in CommunityManagement.tsx
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const liveIds = new Set(visiblePosts.map((p) => p.id));
    const pruned = new Set([...selectedIds].filter((id) => liveIds.has(id)));
    if (pruned.size !== selectedIds.size) {
      setSelectedIds(pruned);
    }
  }, [visiblePosts]);

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <input
        data-testid="search-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="search"
      />
      {allPosts.map((p) => (
        <div key={p.id} data-testid={`row-${p.id}`}>
          <input
            type="checkbox"
            data-testid={`checkbox-${p.id}`}
            checked={selectedIds.has(p.id)}
            onChange={() => toggle(p.id)}
          />
          <span>{p.content}</span>
        </div>
      ))}
      <button
        data-testid="remove-post-2"
        onClick={() => setAllPosts((prev) => prev.filter((p) => p.id !== 2))}
      >
        Remove post 2
      </button>
      <span data-testid="selected-count">{selectedIds.size}</span>
      {selectedIds.size > 0 && (
        <button data-testid="bulk-btn">Approve {selectedIds.size}</button>
      )}
    </div>
  );
}

describe("PostSelectionHarness — pruning when visible set changes", () => {
  it("starts with zero selected", () => {
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("selecting two posts shows count 2", async () => {
    const user = userEvent.setup();
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");
  });

  it("typing a filter that hides post 2 drops the count to 1", async () => {
    const user = userEvent.setup();
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    // "alpha" matches only POST_1, so POST_2 drops from the visible set
    await user.type(screen.getByTestId("search-input"), "alpha");

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("removing a selected post from the list drops count from 2 to 1", async () => {
    const user = userEvent.setup();
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));

    await user.click(screen.getByTestId("remove-post-2"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("removing an unselected post does not change the count", async () => {
    const user = userEvent.setup();
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    await user.click(screen.getByTestId("checkbox-1"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");

    await user.click(screen.getByTestId("remove-post-2"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("filter that hides the only selected post clears selection and hides bulk button", async () => {
    const user = userEvent.setup();
    render(<PostSelectionHarness initialPosts={[POST_1, POST_2]} />);
    await user.click(screen.getByTestId("checkbox-2"));
    await screen.findByTestId("bulk-btn");

    // Type a filter that keeps only POST_1, hiding POST_2
    await user.type(screen.getByTestId("search-input"), "alpha");

    await waitFor(() => expect(screen.queryByTestId("bulk-btn")).toBeNull());
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// 3. Full component test — real <CommunityManagement> with setQueryData
// ---------------------------------------------------------------------------

// ScrollArea (used inside CommunityManagement) calls new ResizeObserver on
// mount.  jsdom does not ship it, so we stub the minimum surface.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("CommunityManagement — flagged content filter prunes selection", () => {
  it("approve-threads button count drops when setQueryData narrows the flagged thread list", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([POST_1, POST_2], [THREAD_1, THREAD_2]);

    // Navigate to the flagged tab.
    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    // Select both flagged threads.
    const selectAllThreads = await screen.findByTestId(
      "checkbox-select-all-threads",
    );
    await user.click(selectAllThreads);

    const approveBtn = await screen.findByTestId("button-bulk-approve-threads");
    expect(approveBtn.textContent).toContain("2");

    // Simulate a refetch that returns only THREAD_1 (e.g. THREAD_2 was deleted elsewhere).
    await act(async () => {
      qc.setQueryData(["/api/admin/community/flagged"], {
        posts: [POST_1, POST_2],
        threads: [THREAD_1],
      });
    });

    // The pruning effect fires — count drops to 1.
    await waitFor(() => {
      const btn = screen.getByTestId("button-bulk-approve-threads");
      expect(btn.textContent).toContain("1");
    });
  });

  it("approve-threads button disappears when the only selected thread is removed via setQueryData", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([POST_1], [THREAD_1, THREAD_2]);

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    // Select only THREAD_2 using its individual checkbox.
    const cb2 = await screen.findByTestId("checkbox-thread-2");
    await user.click(cb2);

    await screen.findByTestId("button-bulk-approve-threads");

    await act(async () => {
      qc.setQueryData(["/api/admin/community/flagged"], {
        posts: [POST_1],
        threads: [THREAD_1],
      });
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("button-bulk-approve-threads"),
      ).toBeNull(),
    );
  });

  it("approve-posts button count drops when setQueryData narrows the flagged posts list", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([POST_1, POST_2], [THREAD_1]);

    // Navigate to the flagged tab.
    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    // Select both flagged posts (replies).
    const selectAllPosts = await screen.findByTestId(
      "checkbox-select-all-posts",
    );
    await user.click(selectAllPosts);

    const approveBtn = await screen.findByTestId("button-bulk-approve-posts");
    expect(approveBtn.textContent).toContain("2");

    // Simulate a refetch that returns only POST_1 (e.g. POST_2 was actioned elsewhere).
    await act(async () => {
      qc.setQueryData(["/api/admin/community/flagged"], {
        posts: [POST_1],
        threads: [THREAD_1],
      });
    });

    // The pruning effect fires — count drops to 1.
    await waitFor(() => {
      const btn = screen.getByTestId("button-bulk-approve-posts");
      expect(btn.textContent).toContain("1");
    });
  });

  it("approve-posts button disappears when the only selected post is removed via setQueryData", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([POST_1, POST_2], [THREAD_1]);

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    // Select only POST_2 using its individual checkbox.
    const cb2 = await screen.findByTestId("checkbox-post-2");
    await user.click(cb2);

    await screen.findByTestId("button-bulk-approve-posts");

    // Simulate a refetch that removes POST_2.
    await act(async () => {
      qc.setQueryData(["/api/admin/community/flagged"], {
        posts: [POST_1],
        threads: [THREAD_1],
      });
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("button-bulk-approve-posts"),
      ).toBeNull(),
    );
  });
});
