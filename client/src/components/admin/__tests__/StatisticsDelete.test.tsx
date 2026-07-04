// @vitest-environment jsdom
//
// Behavioral and source-assertion tests for the statistics delete button
// in ContentManagement.tsx.
//
// Three layers of coverage:
//
//   1. Source assertions — verify that ContentManagement.tsx retains the
//      correct data-testid, confirm() gate, DELETE method, endpoint, and
//      invalidateQueries wiring without rendering the component.
//
//   2. Behavioral component tests — render <ContentManagement> with a
//      mocked fetch, navigate to the statistics tab, click the delete button
//      (with window.confirm stubbed to return true), and assert:
//        a) DELETE /api/admin/content/statistics/:id is called
//        b) the statistics list is re-fetched (GET called again after delete)
//
//   3. Confirm-gate test — verify that clicking the delete button WITHOUT
//      confirming does NOT fire the DELETE request.

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentManagement } from "../ContentManagement";

// ---------------------------------------------------------------------------
// Source text
// ---------------------------------------------------------------------------

const CONTENT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../ContentManagement.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

const STAT = {
  id: 7,
  key: "total_cases",
  label: "Total Cases",
  value: "1,234",
  displayOrder: 1,
};

/**
 * Build a fetch mock that:
 *  - Returns empty arrays for the non-statistics GET endpoints.
 *  - Returns `stats` for GET /api/admin/content/statistics.
 *  - Delegates DELETE calls to `deleteHandler`.
 *  - Records every call in `calls`.
 */
function buildFetchMock(
  stats: object[],
  deleteHandler: () => Response,
  calls: Array<{ method: string; url: string }>,
) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? "GET";
    calls.push({ method, url: url as string });

    if (method === "GET") {
      if ((url as string).includes("/statistics")) return jsonOk(stats);
      return jsonOk([]);
    }

    if (method === "DELETE") {
      return deleteHandler();
    }

    return jsonOk({});
  });
}

function renderContentManagement() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ContentManagement />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Module mock
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Source assertions
// ---------------------------------------------------------------------------

describe("ContentManagement.tsx — statistics delete-button source assertions", () => {
  it("each statistics row has a delete button with data-testid encoding the stat id", () => {
    expect(CONTENT_SRC).toContain("button-delete-stat-${stat.id}");
  });

  it("the delete handler calls confirm() before mutating", () => {
    // Find the delete button's onClick handler in source and check confirm() is called.
    const idx = CONTENT_SRC.indexOf("button-delete-stat-${stat.id}");
    expect(idx).toBeGreaterThan(-1);
    // Grab context around the testid — onClick is nearby.
    const context = CONTENT_SRC.slice(
      Math.max(0, idx - 400),
      idx + 200,
    );
    expect(context).toMatch(/confirm\s*\(/);
  });

  it("deleteStatMutation uses the DELETE HTTP method", () => {
    const mutStart = CONTENT_SRC.indexOf("deleteStatMutation");
    expect(mutStart).toBeGreaterThan(-1);
    const mutSlice = CONTENT_SRC.slice(mutStart, mutStart + 500);
    expect(mutSlice).toMatch(/method:\s*["']DELETE["']/);
  });

  it("deleteStatMutation targets /api/admin/content/statistics/:id", () => {
    const mutStart = CONTENT_SRC.indexOf("deleteStatMutation");
    const mutSlice = CONTENT_SRC.slice(mutStart, mutStart + 500);
    expect(mutSlice).toContain("/api/admin/content/statistics/");
  });

  it("deleteStatMutation.onSuccess invalidates the statistics query key", () => {
    const mutStart = CONTENT_SRC.indexOf("deleteStatMutation");
    const mutSlice = CONTENT_SRC.slice(mutStart, mutStart + 600);
    expect(mutSlice).toContain("invalidateQueries");
    expect(mutSlice).toContain("/api/admin/content/statistics");
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioral component tests
// ---------------------------------------------------------------------------

describe("ContentManagement — statistics delete button behavioral tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("delete button appears for each statistics row", async () => {
    const user = userEvent.setup();
    const calls: Array<{ method: string; url: string }> = [];
    (globalThis as any).fetch = buildFetchMock(
      [STAT],
      () => jsonOk({ success: true }),
      calls,
    );

    renderContentManagement();

    const statisticsTab = await screen.findByTestId("content-tab-statistics");
    await user.click(statisticsTab);

    const deleteBtn = await screen.findByTestId("button-delete-stat-7");
    expect(deleteBtn).toBeTruthy();
  });

  it("clicking delete with confirm=true fires DELETE /api/admin/content/statistics/:id", async () => {
    const user = userEvent.setup();
    const calls: Array<{ method: string; url: string }> = [];
    (globalThis as any).fetch = buildFetchMock(
      [STAT],
      () => jsonOk({ success: true }),
      calls,
    );

    // Stub window.confirm to return true (user accepts).
    vi.stubGlobal("confirm", vi.fn(() => true));

    renderContentManagement();

    const statisticsTab = await screen.findByTestId("content-tab-statistics");
    await user.click(statisticsTab);

    const deleteBtn = await screen.findByTestId("button-delete-stat-7");
    await user.click(deleteBtn);

    await waitFor(() => {
      const deleteCall = calls.find(
        (c) =>
          c.method === "DELETE" &&
          c.url === "/api/admin/content/statistics/7",
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it("after successful delete the statistics list is re-fetched", async () => {
    const user = userEvent.setup();
    const calls: Array<{ method: string; url: string }> = [];
    (globalThis as any).fetch = buildFetchMock(
      [STAT],
      () => jsonOk({ success: true }),
      calls,
    );

    vi.stubGlobal("confirm", vi.fn(() => true));

    renderContentManagement();

    const statisticsTab = await screen.findByTestId("content-tab-statistics");
    await user.click(statisticsTab);

    // Count how many GET /statistics calls happened before the delete.
    const getsBefore = calls.filter(
      (c) => c.method === "GET" && c.url.includes("/statistics"),
    ).length;

    const deleteBtn = await screen.findByTestId("button-delete-stat-7");
    await user.click(deleteBtn);

    // After mutation success, React Query invalidates the query and re-fetches.
    await waitFor(() => {
      const getsAfter = calls.filter(
        (c) => c.method === "GET" && c.url.includes("/statistics"),
      ).length;
      expect(getsAfter).toBeGreaterThan(getsBefore);
    });
  });

  it("clicking delete with confirm=false does NOT fire any DELETE request", async () => {
    const user = userEvent.setup();
    const calls: Array<{ method: string; url: string }> = [];
    (globalThis as any).fetch = buildFetchMock(
      [STAT],
      () => jsonOk({ success: true }),
      calls,
    );

    // Stub window.confirm to return false (user cancels).
    vi.stubGlobal("confirm", vi.fn(() => false));

    renderContentManagement();

    const statisticsTab = await screen.findByTestId("content-tab-statistics");
    await user.click(statisticsTab);

    const deleteBtn = await screen.findByTestId("button-delete-stat-7");
    await user.click(deleteBtn);

    // Give any async effects time to settle.
    await new Promise((r) => setTimeout(r, 100));

    const deleteCalls = calls.filter((c) => c.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });
});
