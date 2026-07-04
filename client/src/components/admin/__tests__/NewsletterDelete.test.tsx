// @vitest-environment jsdom
//
// Task #456 / #463 — Tests for the newsletter subscriber delete action.
//
// Three layers of coverage:
//
//   1. Static source assertions — verify that ContentManagement.tsx contains
//      the correct data-testids for the trash button, inline confirm prompt,
//      "Yes" / "No" confirm buttons, and the disabled-while-pending guard,
//      plus the new bulk-delete UI elements.
//
//   2. Functional harness tests — a slim self-contained React component that
//      replicates the delete → inline-confirm → Yes/No lifecycle so we can
//      verify the interaction contract without rendering the full 1k-line
//      ContentManagement tree.
//
//   3. Bulk-delete static assertions — verify that the new bulk-select and
//      confirmation-dialog source elements are present in the source.

import React, { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Static source analysis helpers
// ---------------------------------------------------------------------------

const CONTENT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../ContentManagement.tsx"),
  "utf8",
);

/**
 * Extracts a function/mutation body from its declaration string to the next
 * `\n  const ` declaration.  Returns `""` when the declaration is absent.
 */
function extractFnBody(fnDecl: string): string {
  const start = CONTENT_SRC.indexOf(fnDecl);
  if (start === -1) return "";
  const end = CONTENT_SRC.indexOf("\n  const ", start + 1);
  return end === -1 ? CONTENT_SRC.slice(start) : CONTENT_SRC.slice(start, end);
}

/**
 * Extracts a source block starting at the given sentinel comment (e.g.
 * `"// NEWSLETTER_SELECT_ALL_CHECKBOX_START"`).  Bounds the slice to the next
 * top-level `\n  const ` declaration so the window grows automatically when
 * the block grows.  Returns `""` when the sentinel is not found.
 */
function extractBlock(sentinel: string): string {
  const start = CONTENT_SRC.indexOf(sentinel);
  if (start === -1) return "";
  const end = CONTENT_SRC.indexOf("\n  const ", start + 1);
  return CONTENT_SRC.slice(start, end === -1 ? CONTENT_SRC.length : end);
}

/**
 * Extracts the source from the opening `openTag` that precedes `marker` up
 * to (but not including) `marker`.  Falls back to the nearest `\n  const `
 * boundary.  Returns `""` when the marker is absent.
 */
function extractElemContextBefore(marker: string, openTag: string): string {
  const idx = CONTENT_SRC.indexOf(marker);
  if (idx === -1) return "";
  const elemStart = CONTENT_SRC.lastIndexOf(openTag, idx);
  const declStart = CONTENT_SRC.lastIndexOf("\n  const ", idx);
  return CONTENT_SRC.slice(
    elemStart !== -1 ? elemStart : declStart !== -1 ? declStart : 0,
    idx,
  );
}

// ---------------------------------------------------------------------------
// Slim functional harness
// ---------------------------------------------------------------------------
//
// Replicates the per-row inline-confirm delete UI from ContentManagement.tsx.
// State mirrors: confirmDeleteId, isPending, subscribers list.

interface Subscriber {
  id: number;
  email: string;
}

interface HarnessProps {
  initialSubscribers: Subscriber[];
  onFetch?: (url: string, opts: RequestInit) => Promise<Response>;
}

function NewsletterDeleteHarness({ initialSubscribers, onFetch }: HarnessProps) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>(initialSubscribers);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleDelete = async (id: number) => {
    setIsPending(true);
    const url = `/api/admin/content/newsletter/${id}`;
    const opts: RequestInit = { method: "DELETE" };

    try {
      const res = onFetch ? await onFetch(url, opts) : await fetch(url, opts);
      if (res.ok) {
        setSubscribers((prev) => prev.filter((s) => s.id !== id));
        setConfirmDeleteId(null);
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      {subscribers.map((sub) => (
        <div
          key={sub.id}
          data-testid={`row-newsletter-subscriber-${sub.id}`}
        >
          <span>{sub.email}</span>
          {confirmDeleteId === sub.id ? (
            <div data-testid={`confirm-delete-newsletter-${sub.id}`}>
              <span>Delete?</span>
              <button
                disabled={isPending}
                onClick={() => handleDelete(sub.id)}
                data-testid={`button-confirm-delete-newsletter-${sub.id}`}
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                data-testid={`button-cancel-delete-newsletter-${sub.id}`}
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteId(sub.id)}
              data-testid={`button-delete-newsletter-${sub.id}`}
              aria-label={`Delete ${sub.email}`}
            >
              🗑
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static source assertions
// ---------------------------------------------------------------------------

describe("ContentManagement.tsx — newsletter delete static assertions", () => {
  it("renders the Trash2 button with the correct data-testid pattern", () => {
    expect(CONTENT_SRC).toContain('data-testid={`button-delete-newsletter-${sub.id}`}');
  });

  it("trash button sets confirmDeleteId to the subscriber id on click", () => {
    // Slice from the opening <Button tag to the testid attr — the onClick prop
    // (with setConfirmDeleteId) appears before data-testid in the source.
    const context = extractElemContextBefore(
      'data-testid={`button-delete-newsletter-${sub.id}`}',
      "<Button",
    );
    expect(context).toContain("setConfirmDeleteId(sub.id)");
  });

  it("renders the inline confirm container with the correct data-testid pattern", () => {
    expect(CONTENT_SRC).toContain('data-testid={`confirm-delete-newsletter-${sub.id}`}');
  });

  it("renders the 'Yes' confirm button with the correct data-testid pattern", () => {
    expect(CONTENT_SRC).toContain('data-testid={`button-confirm-delete-newsletter-${sub.id}`}');
  });

  it("'Yes' button calls deleteNewsletterMutation.mutate with the subscriber id", () => {
    // Slice from the opening <Button tag to the testid attr — the onClick prop
    // (with deleteNewsletterMutation.mutate) appears before data-testid.
    const context = extractElemContextBefore(
      'data-testid={`button-confirm-delete-newsletter-${sub.id}`}',
      "<Button",
    );
    expect(context).toContain("deleteNewsletterMutation.mutate(sub.id)");
  });

  it("'Yes' button is disabled while the delete mutation is in flight", () => {
    // Slice from the opening <Button tag to the testid attr — the disabled prop
    // (with deleteNewsletterMutation.isPending) appears before data-testid.
    const context = extractElemContextBefore(
      'data-testid={`button-confirm-delete-newsletter-${sub.id}`}',
      "<Button",
    );
    expect(context).toContain("deleteNewsletterMutation.isPending");
  });

  it("renders the 'No' cancel button with the correct data-testid pattern", () => {
    expect(CONTENT_SRC).toContain('data-testid={`button-cancel-delete-newsletter-${sub.id}`}');
  });

  it("'No' button sets confirmDeleteId to null on click", () => {
    // Slice from the opening <Button tag to the testid attr — the onClick prop
    // (with setConfirmDeleteId(null)) appears before data-testid in the source.
    const context = extractElemContextBefore(
      'data-testid={`button-cancel-delete-newsletter-${sub.id}`}',
      "<Button",
    );
    expect(context).toContain("setConfirmDeleteId(null)");
  });

  it("deleteNewsletterMutation calls DELETE on /api/admin/content/newsletter/:id", () => {
    const fnBody = extractFnBody("deleteNewsletterMutation");
    expect(fnBody).toContain("/api/admin/content/newsletter/");
    expect(fnBody).toContain('"DELETE"');
  });

  it("deleteNewsletterMutation invalidates the newsletter query on success", () => {
    const fnBody = extractFnBody("deleteNewsletterMutation");
    expect(fnBody).toContain("/api/admin/content/newsletter");
    expect(fnBody).toContain("invalidateQueries");
  });
});

// ---------------------------------------------------------------------------
// Functional harness tests
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const SUBSCRIBERS: Subscriber[] = [
  { id: 1, email: "alice@example.com" },
  { id: 2, email: "bob@example.com" },
];

describe("NewsletterDelete harness — Trash2 button and inline confirm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a delete button for each subscriber row", () => {
    render(<NewsletterDeleteHarness initialSubscribers={SUBSCRIBERS} />);
    expect(screen.getByTestId("button-delete-newsletter-1")).toBeTruthy();
    expect(screen.getByTestId("button-delete-newsletter-2")).toBeTruthy();
  });

  it("clicking the Trash2 button shows the inline confirm prompt", async () => {
    const user = userEvent.setup();
    render(<NewsletterDeleteHarness initialSubscribers={SUBSCRIBERS} />);

    expect(screen.queryByTestId("confirm-delete-newsletter-1")).toBeNull();

    await user.click(screen.getByTestId("button-delete-newsletter-1"));

    expect(screen.getByTestId("confirm-delete-newsletter-1")).toBeTruthy();
    expect(screen.getByTestId("button-confirm-delete-newsletter-1")).toBeTruthy();
    expect(screen.getByTestId("button-cancel-delete-newsletter-1")).toBeTruthy();
  });

  it("clicking 'No' dismisses the confirm without making a network call", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn();
    render(
      <NewsletterDeleteHarness
        initialSubscribers={SUBSCRIBERS}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-delete-newsletter-1"));
    expect(screen.getByTestId("confirm-delete-newsletter-1")).toBeTruthy();

    await user.click(screen.getByTestId("button-cancel-delete-newsletter-1"));

    expect(screen.queryByTestId("confirm-delete-newsletter-1")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    expect(screen.getByTestId("button-delete-newsletter-1")).toBeTruthy();
  });

  it("clicking 'Yes' calls DELETE /api/admin/content/newsletter/:id", async () => {
    const user = userEvent.setup();
    const capturedCalls: Array<{ url: string; method: string }> = [];

    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      capturedCalls.push({ url, method: opts.method ?? "GET" });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(
      <NewsletterDeleteHarness
        initialSubscribers={SUBSCRIBERS}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-delete-newsletter-1"));
    await user.click(screen.getByTestId("button-confirm-delete-newsletter-1"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(capturedCalls[0].url).toBe("/api/admin/content/newsletter/1");
    expect(capturedCalls[0].method).toBe("DELETE");
  });

  it("successful deletion removes the subscriber row and hides the confirm", async () => {
    const user = userEvent.setup();

    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <NewsletterDeleteHarness
        initialSubscribers={SUBSCRIBERS}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-delete-newsletter-1"));
    await user.click(screen.getByTestId("button-confirm-delete-newsletter-1"));

    await waitFor(() =>
      expect(screen.queryByTestId("row-newsletter-subscriber-1")).toBeNull(),
    );

    expect(screen.queryByTestId("confirm-delete-newsletter-1")).toBeNull();
    expect(screen.getByTestId("row-newsletter-subscriber-2")).toBeTruthy();
  });

  it("confirm button is disabled while the DELETE request is in flight", async () => {
    const user = userEvent.setup();

    let resolveRequest!: (r: Response) => void;
    const pendingRequest = new Promise<Response>((res) => {
      resolveRequest = res;
    });

    const mockFetch = vi.fn(() => pendingRequest);

    render(
      <NewsletterDeleteHarness
        initialSubscribers={SUBSCRIBERS}
        onFetch={mockFetch}
      />,
    );

    await user.click(screen.getByTestId("button-delete-newsletter-1"));

    const confirmBtn = screen.getByTestId(
      "button-confirm-delete-newsletter-1",
    ) as HTMLButtonElement;

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(confirmBtn.disabled).toBe(true);
    });

    resolveRequest(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("row-newsletter-subscriber-1")).toBeNull(),
    );
  });

  it("only one row shows the confirm at a time — clicking a different row replaces the prompt", async () => {
    const user = userEvent.setup();
    render(<NewsletterDeleteHarness initialSubscribers={SUBSCRIBERS} />);

    await user.click(screen.getByTestId("button-delete-newsletter-1"));
    expect(screen.getByTestId("confirm-delete-newsletter-1")).toBeTruthy();

    await user.click(screen.getByTestId("button-delete-newsletter-2"));
    expect(screen.queryByTestId("confirm-delete-newsletter-1")).toBeNull();
    expect(screen.getByTestId("confirm-delete-newsletter-2")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Bulk-delete static source assertions (Task #463)
// ---------------------------------------------------------------------------

describe("ContentManagement.tsx — newsletter bulk-delete static assertions", () => {
  it("renders a select-all checkbox in the table header with the correct data-testid", () => {
    expect(CONTENT_SRC).toContain('data-testid="checkbox-select-all-newsletter"');
  });

  it("renders a per-row checkbox with the correct data-testid pattern", () => {
    expect(CONTENT_SRC).toContain('data-testid={`checkbox-newsletter-${sub.id}`}');
  });

  it("renders the bulk-delete action button with the correct data-testid", () => {
    expect(CONTENT_SRC).toContain('data-testid="button-bulk-delete-newsletter"');
  });

  it("bulk-delete button only appears when selectedNewsletterIds.size > 0", () => {
    const context = extractElemContextBefore(
      'data-testid="button-bulk-delete-newsletter"',
      "{selectedNewsletterIds.size",
    );
    expect(context).not.toBe("");
    expect(context).toContain("selectedNewsletterIds.size > 0");
  });

  it("renders the bulk-delete confirmation dialog cancel button with the correct data-testid", () => {
    expect(CONTENT_SRC).toContain('data-testid="button-bulk-delete-cancel"');
  });

  it("renders the bulk-delete confirmation dialog confirm button with the correct data-testid", () => {
    expect(CONTENT_SRC).toContain('data-testid="button-bulk-delete-confirm"');
  });

  it("confirmation dialog lists selected emails in the bulk-delete-email-list element", () => {
    expect(CONTENT_SRC).toContain('data-testid="bulk-delete-email-list"');
    expect(CONTENT_SRC).toContain('data-testid={`bulk-delete-email-${s.id}`}');
  });

  it("bulkDeleteNewsletterMutation iterates over selected ids and calls DELETE for each", () => {
    const body = extractFnBody("bulkDeleteNewsletterMutation");
    expect(body).toContain("/api/admin/content/newsletter/");
    expect(body).toContain('"DELETE"');
    expect(body).toContain("Promise.allSettled");
  });

  it("bulkDeleteNewsletterMutation invalidates the newsletter query on success", () => {
    const body = extractFnBody("bulkDeleteNewsletterMutation");
    expect(body).toContain("invalidateQueries");
    expect(body).toContain("/api/admin/content/newsletter");
  });

  it("select-all checkbox checks all rows when checked", () => {
    const context = extractBlock("NEWSLETTER_SELECT_ALL_CHECKBOX_START");
    expect(context).not.toBe("");
    expect(context).toContain("setSelectedNewsletterIds");
  });

  it("per-row checkbox toggles that individual row's selection", () => {
    const context = extractBlock("NEWSLETTER_ROW_CHECKBOX_START");
    expect(context).not.toBe("");
    expect(context).toContain("setSelectedNewsletterIds");
  });

  it("export CSV button carries disabled={bulkDeleteNewsletterMutation.isPending}", () => {
    const context = extractBlock("NEWSLETTER_EXPORT_CSV_BTN_START");
    expect(context).not.toBe("");
    expect(context).toContain("bulkDeleteNewsletterMutation.isPending");
  });

  it("'Delete selected' button carries disabled={bulkDeleteNewsletterMutation.isPending}", () => {
    const context = extractElemContextBefore(
      'data-testid="button-bulk-delete-newsletter"',
      "<Button",
    );
    expect(context).not.toBe("");
    expect(context).toContain("bulkDeleteNewsletterMutation.isPending");
  });
});
