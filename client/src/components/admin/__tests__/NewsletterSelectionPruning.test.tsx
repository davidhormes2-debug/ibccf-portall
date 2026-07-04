// @vitest-environment jsdom
//
// Task #533 — Confirm stale selections are cleared when the subscriber list
// refreshes.
//
// Task #478 added a useEffect in ContentManagement.tsx (~lines 135-142) that
// prunes ghost IDs from `selectedNewsletterIds` whenever the `subscribers`
// query result changes. This file pins that behaviour so a future refactor
// cannot silently break it.
//
// Three layers of coverage:
//
//   1. Static source assertions — verify that the useEffect exists in
//      ContentManagement.tsx and contains the pruning logic.
//
//   2. Functional harness — a slim self-contained React component that
//      replicates the state + useEffect so we can drive the lifecycle
//      deterministically without relying on TanStack Query internals.
//
//   3. Full component test — renders the real <ContentManagement> with a
//      controlled QueryClient.  After selecting two rows, we call
//      `setQueryData` to remove one subscriber and assert that the
//      "Delete selected" button count drops from 2 to 1.

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

import { ContentManagement } from "../ContentManagement";

// ---------------------------------------------------------------------------
// Static source
// ---------------------------------------------------------------------------

const CONTENT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../ContentManagement.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Source-extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the body of a useEffect block that begins at the given sentinel
 * comment (e.g. `"// NEWSLETTER_PRUNING_EFFECT_START"`).
 * Bounds the slice to the next top-level `\n  const ` declaration so the
 * window grows automatically when the effect body grows, rather than using a
 * fixed width.  Returns `""` when the sentinel is not found so `.toContain()`
 * assertions produce a clear failure message.
 */
function extractEffectBlock(sentinel: string): string {
  const start = CONTENT_SRC.indexOf(sentinel);
  if (start === -1) return "";
  const end = CONTENT_SRC.indexOf("\n  const ", start + 1);
  return CONTENT_SRC.slice(start, end === -1 ? CONTENT_SRC.length : end);
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

interface NewsletterSubscriber {
  id: number;
  email: string;
  isActive: boolean;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

const SUB_1: NewsletterSubscriber = {
  id: 1,
  email: "alice@example.com",
  isActive: true,
  subscribedAt: "2026-01-01T00:00:00.000Z",
  unsubscribedAt: null,
};

const SUB_2: NewsletterSubscriber = {
  id: 2,
  email: "bob@example.com",
  isActive: true,
  subscribedAt: "2026-02-01T00:00:00.000Z",
  unsubscribedAt: null,
};

/**
 * Render <ContentManagement> inside a controlled QueryClient and return both
 * the render result and the QueryClient so tests can call setQueryData.
 */
function renderWithQc(initialSubscribers: NewsletterSubscriber[]) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });

  // Pre-populate the cache so the component never needs to fetch.
  qc.setQueryData(["/api/admin/content/newsletter"], initialSubscribers);
  // Silence other content endpoints.
  for (const key of [
    "/api/admin/content/scam-alerts",
    "/api/admin/content/testimonials",
    "/api/admin/content/faq",
    "/api/admin/content/statistics",
    "/api/admin/content/contact-submissions",
    "/api/admin/content/public-complaints",
  ]) {
    qc.setQueryData([key], []);
  }

  // Stub fetch so any background requests return empty arrays.
  (globalThis as any).fetch = vi.fn(async () => jsonOk([]));

  const result = render(
    <QueryClientProvider client={qc}>
      <ContentManagement />
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
// 1. Static source assertions
// ---------------------------------------------------------------------------

describe("ContentManagement.tsx — stale-selection pruning useEffect (static)", () => {
  it("contains the pruning useEffect sentinel comment", () => {
    expect(CONTENT_SRC).toContain("NEWSLETTER_PRUNING_EFFECT_START");
  });

  it("the useEffect guards against an empty selection set before pruning", () => {
    const context = extractEffectBlock("NEWSLETTER_PRUNING_EFFECT_START");
    expect(context).toContain("selectedNewsletterIds.size === 0");
  });

  it("the useEffect builds a set of live IDs from the current subscribers", () => {
    const context = extractEffectBlock("NEWSLETTER_PRUNING_EFFECT_START");
    expect(context).toContain("liveIds");
    expect(context).toContain("subscribers.map");
  });

  it("the useEffect calls setSelectedNewsletterIds with the pruned set", () => {
    const context = extractEffectBlock("NEWSLETTER_PRUNING_EFFECT_START");
    expect(context).toContain("setSelectedNewsletterIds(pruned)");
  });

  it("the pruning filters out IDs not present in liveIds", () => {
    const context = extractEffectBlock("NEWSLETTER_PRUNING_EFFECT_START");
    expect(context).toContain("liveIds.has(id)");
  });

  it("the useEffect only calls setState when the size actually changed", () => {
    const context = extractEffectBlock("NEWSLETTER_PRUNING_EFFECT_START");
    expect(context).toContain("pruned.size !== selectedNewsletterIds.size");
  });
});

// ---------------------------------------------------------------------------
// 2. Functional harness — replicates state + useEffect
// ---------------------------------------------------------------------------

interface HarnessProps {
  initialSubscribers: NewsletterSubscriber[];
}

/**
 * Slim harness that mirrors the selectedNewsletterIds state and pruning
 * useEffect from ContentManagement without requiring the full component tree.
 */
function SelectionPruningHarness({ initialSubscribers }: HarnessProps) {
  const [subscribers, setSubscribers] =
    useState<NewsletterSubscriber[]>(initialSubscribers);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Mirror of the useEffect in ContentManagement.tsx (~lines 135-142).
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const liveIds = new Set(subscribers.map((s) => s.id));
    const pruned = new Set([...selectedIds].filter((id) => liveIds.has(id)));
    if (pruned.size !== selectedIds.size) {
      setSelectedIds(pruned);
    }
  }, [subscribers]);

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      {subscribers.map((sub) => (
        <div key={sub.id} data-testid={`row-${sub.id}`}>
          <input
            type="checkbox"
            data-testid={`checkbox-${sub.id}`}
            checked={selectedIds.has(sub.id)}
            onChange={() => toggle(sub.id)}
          />
          <span>{sub.email}</span>
        </div>
      ))}
      <button
        data-testid="remove-sub-2"
        onClick={() =>
          setSubscribers((prev) => prev.filter((s) => s.id !== 2))
        }
      >
        Remove sub 2
      </button>
      <span data-testid="selected-count">{selectedIds.size}</span>
      {selectedIds.size > 0 && (
        <button data-testid="bulk-delete-btn">
          Delete selected ({selectedIds.size})
        </button>
      )}
    </div>
  );
}

describe("SelectionPruningHarness — pruning useEffect behaviour", () => {
  it("starts with zero selected", () => {
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("selecting two rows shows count 2", async () => {
    const user = userEvent.setup();
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);

    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));

    expect(screen.getByTestId("selected-count").textContent).toBe("2");
  });

  it("removing a selected subscriber drops the count from 2 to 1", async () => {
    const user = userEvent.setup();
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);

    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    // Remove subscriber 2 — triggers the pruning useEffect.
    await user.click(screen.getByTestId("remove-sub-2"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("the pruned selection contains only the surviving subscriber's ID", async () => {
    const user = userEvent.setup();
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);

    await user.click(screen.getByTestId("checkbox-1"));
    await user.click(screen.getByTestId("checkbox-2"));

    await user.click(screen.getByTestId("remove-sub-2"));

    // After pruning, checkbox-1 must still be checked and count must be 1.
    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
    expect(
      (screen.getByTestId("checkbox-1") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("removing all selected subscribers drops the count to 0 and hides the delete button", async () => {
    const user = userEvent.setup();
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);

    await user.click(screen.getByTestId("checkbox-2"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");

    // Remove the only selected subscriber.
    await user.click(screen.getByTestId("remove-sub-2"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("0"),
    );
    expect(screen.queryByTestId("bulk-delete-btn")).toBeNull();
  });

  it("removing an unselected subscriber does not change the selection count", async () => {
    const user = userEvent.setup();
    render(<SelectionPruningHarness initialSubscribers={[SUB_1, SUB_2]} />);

    // Only select subscriber 1; subscriber 2 is unselected.
    await user.click(screen.getByTestId("checkbox-1"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");

    // Remove the unselected subscriber.
    await user.click(screen.getByTestId("remove-sub-2"));

    // Count should remain 1 — subscriber 1 is still selected and still live.
    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Full component test — real <ContentManagement> with setQueryData
// ---------------------------------------------------------------------------

describe("ContentManagement — stale selections cleared on query refetch", () => {
  it("bulk-delete count drops from 2 to 1 when setQueryData removes a selected subscriber", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([SUB_1, SUB_2]);

    // Navigate to the newsletter tab.
    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select both subscriber rows.
    const cb1 = await screen.findByTestId("checkbox-newsletter-1");
    const cb2 = await screen.findByTestId("checkbox-newsletter-2");
    await user.click(cb1);
    await user.click(cb2);

    // Both are selected — the bulk-delete button shows "Delete selected (2)".
    const bulkBtn = await screen.findByTestId("button-bulk-delete-newsletter");
    expect(bulkBtn.textContent).toContain("2");

    // Simulate a query refetch that removes subscriber 2 (e.g. deleted elsewhere).
    await act(async () => {
      qc.setQueryData(["/api/admin/content/newsletter"], [SUB_1]);
    });

    // The pruning useEffect should fire and reduce the count to 1.
    await waitFor(() => {
      const btn = screen.getByTestId("button-bulk-delete-newsletter");
      expect(btn.textContent).toContain("1");
    });
  });

  it("bulk-delete button disappears when the only selected subscriber is removed via setQueryData", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([SUB_1, SUB_2]);

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select only subscriber 2.
    const cb2 = await screen.findByTestId("checkbox-newsletter-2");
    await user.click(cb2);

    await screen.findByTestId("button-bulk-delete-newsletter");

    // Remove subscriber 2 from the query result.
    await act(async () => {
      qc.setQueryData(["/api/admin/content/newsletter"], [SUB_1]);
    });

    // Selection set becomes empty — bulk-delete button should disappear.
    await waitFor(() =>
      expect(
        screen.queryByTestId("button-bulk-delete-newsletter"),
      ).toBeNull(),
    );
  });

  it("selection of surviving subscriber is preserved after the other is removed", async () => {
    const user = userEvent.setup();
    const { qc } = renderWithQc([SUB_1, SUB_2]);

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select both.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    await user.click(await screen.findByTestId("checkbox-newsletter-2"));

    await waitFor(() =>
      expect(
        screen.getByTestId("button-bulk-delete-newsletter").textContent,
      ).toContain("2"),
    );

    // Drop subscriber 2 from the list.
    await act(async () => {
      qc.setQueryData(["/api/admin/content/newsletter"], [SUB_1]);
    });

    // Subscriber 1's selection is preserved — count stays at 1.
    await waitFor(() =>
      expect(
        screen.getByTestId("button-bulk-delete-newsletter").textContent,
      ).toContain("1"),
    );

    // Subscriber 1's checkbox row is still rendered and checked.
    const cb1 = screen.getByTestId("checkbox-newsletter-1") as HTMLInputElement;
    expect(cb1.checked).toBe(true);
  });
});
