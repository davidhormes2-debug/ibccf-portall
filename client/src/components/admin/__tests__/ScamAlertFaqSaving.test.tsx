// @vitest-environment jsdom
//
// Regression guard for the scam-alert and FAQ inline editors in
// ContentManagement.tsx.  Covers the deferred-mutation / isPending guard
// pattern: the Save button must be disabled for the duration of an in-flight
// PUT/POST and the network layer must receive exactly one request even if the
// user tries to click Save a second time.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

import { ContentManagement } from "../ContentManagement";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function renderWithQc() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  // Pre-populate every content endpoint so all tabs render without fetching.
  for (const key of [
    "/api/admin/content/public-complaints",
    "/api/admin/content/scam-alerts",
    "/api/admin/content/testimonials",
    "/api/admin/content/faq",
    "/api/admin/content/statistics",
    "/api/admin/content/newsletter",
    "/api/admin/content/contact-submissions",
  ]) {
    qc.setQueryData([key], []);
  }

  // Stub fetch for any background/invalidation requests.
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
    jsonOk([]),
  );

  const result = render(
    <QueryClientProvider client={qc}>
      <ContentManagement />
    </QueryClientProvider>,
  );

  return { ...result, qc };
}

// ---------------------------------------------------------------------------
// Environment stubs required by Radix UI components.
//
// Dialog uses pointer-capture APIs that jsdom does not provide.
// ScrollArea (used in several tabs) calls `new ResizeObserver` on mount.
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Radix UI Dialog stubs.
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

async function openAlertsTab() {
  const user = userEvent.setup();
  const tab = await screen.findByTestId("content-tab-alerts");
  await user.click(tab);
}

async function openFaqTab() {
  const user = userEvent.setup();
  const tab = await screen.findByTestId("content-tab-faq");
  await user.click(tab);
}

// ===========================================================================
// Scam Alerts editor
// ===========================================================================

describe("ContentManagement – scam alert dialog Save button", () => {
  it("disables the Save button while the POST is in-flight and fires exactly one POST", async () => {
    // Arrange: hold the POST open so the mutation stays in isPending state.
    let resolvePost!: (value: Response) => void;
    const postInflight = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    let postCallCount = 0;

    renderWithQc();

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (
          url.includes("/scam-alerts") &&
          (opts?.method === "POST" || opts?.method === "PUT")
        ) {
          postCallCount += 1;
          return postInflight;
        }
        return jsonOk([]);
      });

    await openAlertsTab();

    const user = userEvent.setup();

    // Open the Add Alert dialog.
    await user.click(screen.getByTestId("button-add-alert"));

    // Wait for the dialog title to appear.
    await waitFor(
      () => screen.getByText("Add Scam Alert"),
      { timeout: 3000 },
    );

    // Fill in the title field so the save is meaningful.
    const titleInput = screen.getByTestId("input-alert-title");
    await user.clear(titleInput);
    await user.type(titleInput, "Fake exchange scam");

    // Save must be enabled before clicking.
    const saveBtn = screen.getByTestId(
      "button-save-alert",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    // First click — fires POST and leaves the mutation in isPending.
    await user.click(saveBtn);

    // While the POST is still open the Save button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          "button-save-alert",
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // A second click while in-flight must be a no-op (button is disabled).
    await user.click(screen.getByTestId("button-save-alert"));

    // Resolve the held POST so TanStack Query can clean up.
    resolvePost(
      new Response(
        JSON.stringify({ id: 1, title: "Fake exchange scam", description: "", severity: "medium", platformName: "", isActive: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );

    // Confirm exactly one POST reached the network layer.
    expect(postCallCount).toBe(1);
  });

  it("fires PUT (not POST) when editing an existing alert and disables Save while in-flight", async () => {
    const ALERT = {
      id: 42,
      title: "Old alert title",
      description: "Watch out",
      severity: "high",
      platformName: "BadExchange",
      isActive: true,
    };

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    for (const key of [
      "/api/admin/content/public-complaints",
      "/api/admin/content/testimonials",
      "/api/admin/content/faq",
      "/api/admin/content/statistics",
      "/api/admin/content/newsletter",
      "/api/admin/content/contact-submissions",
    ]) {
      qc.setQueryData([key], []);
    }
    qc.setQueryData(["/api/admin/content/scam-alerts"], [ALERT]);

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonOk([]),
    );

    render(
      <QueryClientProvider client={qc}>
        <ContentManagement />
      </QueryClientProvider>,
    );

    let resolveput!: (value: Response) => void;
    const putInflight = new Promise<Response>((resolve) => {
      resolveput = resolve;
    });
    let putCallCount = 0;

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (url.includes(`/scam-alerts/${ALERT.id}`) && opts?.method === "PUT") {
          putCallCount += 1;
          return putInflight;
        }
        return jsonOk([ALERT]);
      });

    await openAlertsTab();

    const user = userEvent.setup();

    // Click the edit button for the existing alert row.
    await waitFor(
      () => screen.getByTestId(`button-edit-alert-${ALERT.id}`),
      { timeout: 3000 },
    );
    await user.click(screen.getByTestId(`button-edit-alert-${ALERT.id}`));

    // Wait for the dialog to open.
    await waitFor(
      () => screen.getByText("Edit Scam Alert"),
      { timeout: 3000 },
    );

    // The Save button must be enabled before the mutation starts.
    const saveBtn = screen.getByTestId(
      "button-save-alert",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    // Click Save — fires PUT and leaves the mutation in isPending.
    await user.click(saveBtn);

    // While the PUT is still open the Save button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          "button-save-alert",
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // A second click while in-flight must be a no-op (button is disabled).
    await user.click(screen.getByTestId("button-save-alert"));

    // Resolve the held PUT.
    resolveput(
      new Response(
        JSON.stringify({ ...ALERT, title: "Old alert title" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );

    // Exactly one PUT must have reached the network.
    expect(putCallCount).toBe(1);
  });
});

// ===========================================================================
// FAQ editor
// ===========================================================================

describe("ContentManagement – FAQ dialog Save button", () => {
  it("disables the Save button while the POST is in-flight and fires exactly one POST", async () => {
    // Arrange: hold the POST open so the mutation stays in isPending state.
    let resolvePost!: (value: Response) => void;
    const postInflight = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    let postCallCount = 0;

    renderWithQc();

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (
          url.includes("/faq") &&
          (opts?.method === "POST" || opts?.method === "PUT")
        ) {
          postCallCount += 1;
          return postInflight;
        }
        return jsonOk([]);
      });

    await openFaqTab();

    const user = userEvent.setup();

    // Open the Add FAQ dialog.
    await user.click(screen.getByTestId("button-add-faq"));

    // Wait for the dialog's question input to appear (proves the dialog is open,
    // not just the tab button which also says "Add FAQ").
    await waitFor(
      () => screen.getByTestId("input-faq-question"),
      { timeout: 3000 },
    );

    // Fill in the question field so the save is meaningful.
    const questionInput = screen.getByTestId("input-faq-question");
    await user.clear(questionInput);
    await user.type(questionInput, "How do I file a complaint?");

    // Save must be enabled before clicking.
    const saveBtn = screen.getByTestId(
      "button-save-faq",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    // First click — fires POST and leaves the mutation in isPending.
    await user.click(saveBtn);

    // While the POST is still open the Save button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          "button-save-faq",
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // A second click while in-flight must be a no-op (button is disabled).
    await user.click(screen.getByTestId("button-save-faq"));

    // Resolve the held POST so TanStack Query can clean up.
    resolvePost(
      new Response(
        JSON.stringify({ id: 10, question: "How do I file a complaint?", answer: "", displayOrder: 1, isActive: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );

    // Confirm exactly one POST reached the network layer.
    expect(postCallCount).toBe(1);
  });

  it("fires PUT (not POST) when editing an existing FAQ and disables Save while in-flight", async () => {
    const FAQ = {
      id: 7,
      question: "What is IBCCF?",
      answer: "International Blockchain Complaints Forum.",
      displayOrder: 1,
      isActive: true,
    };

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    for (const key of [
      "/api/admin/content/public-complaints",
      "/api/admin/content/scam-alerts",
      "/api/admin/content/testimonials",
      "/api/admin/content/statistics",
      "/api/admin/content/newsletter",
      "/api/admin/content/contact-submissions",
    ]) {
      qc.setQueryData([key], []);
    }
    qc.setQueryData(["/api/admin/content/faq"], [FAQ]);

    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () =>
      jsonOk([]),
    );

    render(
      <QueryClientProvider client={qc}>
        <ContentManagement />
      </QueryClientProvider>,
    );

    let resolvePut!: (value: Response) => void;
    const putInflight = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    let putCallCount = 0;

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (url.includes(`/faq/${FAQ.id}`) && opts?.method === "PUT") {
          putCallCount += 1;
          return putInflight;
        }
        return jsonOk([FAQ]);
      });

    await openFaqTab();

    const user = userEvent.setup();

    // Click the edit button for the existing FAQ row.
    await waitFor(
      () => screen.getByTestId(`button-edit-faq-${FAQ.id}`),
      { timeout: 3000 },
    );
    await user.click(screen.getByTestId(`button-edit-faq-${FAQ.id}`));

    // Wait for the dialog to open.
    await waitFor(
      () => screen.getByText("Edit FAQ"),
      { timeout: 3000 },
    );

    // The Save button must be enabled before the mutation starts.
    const saveBtn = screen.getByTestId(
      "button-save-faq",
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    // Click Save — fires PUT and leaves the mutation in isPending.
    await user.click(saveBtn);

    // While the PUT is still open the Save button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          "button-save-faq",
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // A second click while in-flight must be a no-op (button is disabled).
    await user.click(screen.getByTestId("button-save-faq"));

    // Resolve the held PUT.
    resolvePut(
      new Response(
        JSON.stringify({ ...FAQ }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );

    // Exactly one PUT must have reached the network.
    expect(putCallCount).toBe(1);
  });
});
