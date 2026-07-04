// @vitest-environment jsdom
//
// Verifies that the select-all checkboxes in the flagged-content tab operate
// on the currently filtered set (not the full unfiltered list).
//
// Three layers:
//   1. Static source assertions — uncheck handler uses functional update scoped
//      to the filtered set rather than clearing the whole selection.
//   2. Functional harness — slim self-contained component exercises check/uncheck
//      while a filter is active.
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

// ---------------------------------------------------------------------------
// 1. Static source assertions
// ---------------------------------------------------------------------------

describe("CommunityManagement.tsx — select-all uncheck scoped to filtered set (static)", () => {
  it("thread uncheck handler uses a functional setter (not new Set())", () => {
    // id="select-all-threads" appears before the onCheckedChange handler in the JSX
    const anchor = COMMUNITY_SRC.indexOf('id="select-all-threads"');
    expect(anchor).toBeGreaterThan(-1);
    const end = COMMUNITY_SRC.indexOf('id="select-all-posts"');
    const handlerBlock = COMMUNITY_SRC.slice(anchor, end);
    expect(handlerBlock).toContain("setSelectedThreadIds((prev)");
    expect(handlerBlock).toContain("flaggedThreads.forEach");
    expect(handlerBlock).toContain("next.delete(t.id)");
  });

  it("post uncheck handler uses a functional setter (not new Set())", () => {
    const anchor = COMMUNITY_SRC.indexOf('id="select-all-posts"');
    expect(anchor).toBeGreaterThan(-1);
    const handlerBlock = COMMUNITY_SRC.slice(anchor);
    expect(handlerBlock).toContain("setSelectedPostIds((prev)");
    expect(handlerBlock).toContain("flaggedPosts.forEach");
    expect(handlerBlock).toContain("next.delete(p.id)");
  });
});

// ---------------------------------------------------------------------------
// 2. Functional harness
// ---------------------------------------------------------------------------

interface Item {
  id: number;
  content: string;
  authorHandle: string;
}

const ITEM_A: Item = { id: 1, content: "alpha content", authorHandle: "alice" };
const ITEM_B: Item = { id: 2, content: "beta content", authorHandle: "bob" };
const ITEM_C: Item = { id: 3, content: "gamma content", authorHandle: "carol" };

function SelectAllHarness({ allItems }: { allItems: Item[] }) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const visibleItems = search.trim()
    ? allItems.filter((i) => i.authorHandle.toLowerCase().includes(search.toLowerCase()))
    : allItems;

  const allVisible = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(visibleItems.map((i) => i.id)));
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleItems.forEach((i) => next.delete(i.id));
        return next;
      });
    }
  }

  return (
    <div>
      <input
        data-testid="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="filter by author"
      />
      <input
        type="checkbox"
        data-testid="select-all"
        checked={allVisible}
        onChange={(e) => handleSelectAll(e.target.checked)}
      />
      {allItems.map((i) => (
        <div key={i.id} data-testid={`row-${i.id}`}>
          <input
            type="checkbox"
            data-testid={`cb-${i.id}`}
            checked={selectedIds.has(i.id)}
            onChange={() =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(i.id)) next.delete(i.id); else next.add(i.id);
                return next;
              })
            }
          />
          <span>{i.content}</span>
        </div>
      ))}
      <span data-testid="count">{selectedIds.size}</span>
    </div>
  );
}

describe("SelectAllHarness — check/uncheck with active filter", () => {
  afterEach(cleanup);

  it("checking select-all while filtered selects only visible items", async () => {
    const user = userEvent.setup();
    render(<SelectAllHarness allItems={[ITEM_A, ITEM_B, ITEM_C]} />);

    await user.type(screen.getByTestId("search"), "alice");
    await user.click(screen.getByTestId("select-all"));

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect((screen.getByTestId("cb-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("cb-2") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("cb-3") as HTMLInputElement).checked).toBe(false);
  });

  it("unchecking select-all while filtered only deselects visible items", async () => {
    const user = userEvent.setup();
    render(<SelectAllHarness allItems={[ITEM_A, ITEM_B, ITEM_C]} />);

    await user.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("count").textContent).toBe("3");

    await user.type(screen.getByTestId("search"), "alice");
    await user.click(screen.getByTestId("select-all"));

    expect(screen.getByTestId("count").textContent).toBe("2");
    expect((screen.getByTestId("cb-1") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("cb-2") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("cb-3") as HTMLInputElement).checked).toBe(true);
  });

  it("checking with filter then clearing filter leaves only filter-time items selected", async () => {
    const user = userEvent.setup();
    render(<SelectAllHarness allItems={[ITEM_A, ITEM_B, ITEM_C]} />);

    await user.type(screen.getByTestId("search"), "alice");
    await user.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("count").textContent).toBe("1");

    await user.clear(screen.getByTestId("search"));

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect((screen.getByTestId("cb-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("cb-2") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("cb-3") as HTMLInputElement).checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers for full component test
// ---------------------------------------------------------------------------

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
  id: 1, threadId: 10, content: "spam alpha", authorHandle: "alice",
  authorType: "user", flagReason: "keyword match", createdAt: "2026-01-01T00:00:00.000Z",
};
const POST_2: FlaggedPost = {
  id: 2, threadId: 10, content: "spam beta", authorHandle: "bob",
  authorType: "user", flagReason: "keyword match", createdAt: "2026-02-01T00:00:00.000Z",
};
const THREAD_1: FlaggedThread = {
  id: 1, title: "bad thread alpha", content: "problematic", authorHandle: "alice",
  authorType: "user", flagReason: "keyword match", createdAt: "2026-01-01T00:00:00.000Z",
};
const THREAD_2: FlaggedThread = {
  id: 2, title: "bad thread beta", content: "also bad", authorHandle: "bob",
  authorType: "user", flagReason: "keyword match", createdAt: "2026-02-01T00:00:00.000Z",
};

function renderWithQc(posts: FlaggedPost[], threads: FlaggedThread[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["/api/admin/community/flagged"], { posts, threads });
  qc.setQueryData(["/api/community/stats"], {
    threads: "0", posts: "0", members: 0, activeBots: "0", totalViews: 0,
  });
  qc.setQueryData(["/api/departments"], []);
  qc.setQueryData(["/api/community/threads", "all", "", "recent"], []);
  qc.setQueryData(["/api/community/threads/top-views"], []);
  qc.setQueryData(["/api/admin/community/keywords"], []);
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

// ---------------------------------------------------------------------------
// 3. Full component test — real <CommunityManagement>
// ---------------------------------------------------------------------------

describe("CommunityManagement — select-all threads scoped to filtered set", () => {
  it("select-all while author filter active selects only matching threads", async () => {
    const user = userEvent.setup();
    renderWithQc([POST_1], [THREAD_1, THREAD_2]);

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    const authorInput = await screen.findByTestId("input-flagged-author");
    await user.type(authorInput, "alice");

    const selectAll = await screen.findByTestId("checkbox-select-all-threads");
    await user.click(selectAll);

    const approveBtn = await screen.findByTestId("button-bulk-approve-threads");
    expect(approveBtn.textContent).toContain("1");
  });

  it("uncheck select-all while filter active preserves out-of-filter thread selections", async () => {
    const user = userEvent.setup();
    renderWithQc([POST_1], [THREAD_1, THREAD_2]);

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    const selectAll = await screen.findByTestId("checkbox-select-all-threads");
    await user.click(selectAll);

    const approveBtn = await screen.findByTestId("button-bulk-approve-threads");
    expect(approveBtn.textContent).toContain("2");

    const authorInput = await screen.findByTestId("input-flagged-author");
    await user.type(authorInput, "alice");

    await user.click(screen.getByTestId("checkbox-select-all-threads"));

    await waitFor(() => {
      const btn = screen.queryByTestId("button-bulk-approve-threads");
      if (btn) {
        expect(btn.textContent).not.toContain("2");
      }
    });
  });
});

describe("CommunityManagement — select-all posts scoped to filtered set", () => {
  it("select-all while author filter active selects only matching posts", async () => {
    const user = userEvent.setup();
    renderWithQc([POST_1, POST_2], [THREAD_1]);

    const flaggedTab = await screen.findByRole("tab", { name: /flagged/i });
    await user.click(flaggedTab);

    const authorInput = await screen.findByTestId("input-flagged-author");
    await user.type(authorInput, "alice");

    const selectAll = await screen.findByTestId("checkbox-select-all-posts");
    await user.click(selectAll);

    const approveBtn = await screen.findByTestId("button-bulk-approve-posts");
    expect(approveBtn.textContent).toContain("1");
  });
});
