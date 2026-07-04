// @vitest-environment jsdom
//
// Regression guard for the inline admin notes editor on complaint cards
// (introduced in Task #607). Covers:
//   1. "Add notes" opens the inline editor (textarea appears).
//   2. Typing a note and clicking Save fires PUT
//      /api/admin/content/public-complaints/:id with { adminNotes } and the
//      saved note is subsequently displayed on the card.
//   3. Opening the editor and clicking Cancel hides the textarea without
//      persisting anything.

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
// Fixtures
// ---------------------------------------------------------------------------

const COMPLAINT = {
  id: 1,
  name: "Alice Example",
  email: "alice@example.com",
  subject: "Fraud report",
  description: "I lost funds on FakeExchange.",
  platform: "FakeExchange",
  incidentDate: "2026-05-01",
  amountLost: "500 USDT",
  status: "new",
  adminNotes: null,
  createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
};

const COMPLAINT_WITH_NOTES = {
  ...COMPLAINT,
  adminNotes: "Escalated to compliance team.",
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

/**
 * Renders <ContentManagement> inside a QueryClient whose cache is pre-seeded
 * so no real fetch calls are needed for the initial render.  Returns the
 * QueryClient so individual tests can call `setQueryData` to simulate server
 * responses after mutations.
 */
function renderWithQc(complaintsData: unknown[] = [COMPLAINT]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  // Pre-populate every content endpoint so all tabs render without fetching.
  qc.setQueryData(["/api/admin/content/public-complaints"], complaintsData);
  for (const key of [
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
// Environment stubs required by Radix UI components used in this tab.
//
// ScrollArea (used in the Complaints tab list) calls `new ResizeObserver`
// on mount. jsdom does not ship ResizeObserver, so we stub the minimum
// surface. Without this the test throws "ResizeObserver is not defined".
// ---------------------------------------------------------------------------

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Shared navigation helper
// ---------------------------------------------------------------------------

/**
 * Navigates to the Complaints tab and waits for the first complaint card to
 * appear in the DOM.  Uses `userEvent` so Radix UI Tabs receives the full
 * pointer-event sequence it expects.
 */
async function openComplaintsTab() {
  const user = userEvent.setup();
  const tab = await screen.findByTestId("content-tab-complaints");
  await user.click(tab);
  await waitFor(
    () => screen.getByTestId(`complaint-row-${COMPLAINT.id}`),
    { timeout: 3000 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContentManagement – complaint admin notes editor", () => {
  it("shows 'Add notes' button and opens the inline editor on click", async () => {
    renderWithQc();

    await openComplaintsTab();

    // No existing notes → "Add notes" button should be visible.
    const addBtn = screen.getByTestId(`button-add-notes-${COMPLAINT.id}`);
    expect(addBtn).toBeTruthy();

    // Open the editor.
    const user = userEvent.setup();
    await user.click(addBtn);

    // The notes editor and its Save / Cancel buttons should now be present.
    expect(screen.getByTestId(`notes-editor-${COMPLAINT.id}`)).toBeTruthy();
    expect(screen.getByTestId(`button-save-notes-${COMPLAINT.id}`)).toBeTruthy();
    expect(screen.getByTestId(`button-cancel-notes-${COMPLAINT.id}`)).toBeTruthy();

    // The "Add notes" button should be hidden while editing.
    expect(screen.queryByTestId(`button-add-notes-${COMPLAINT.id}`)).toBeNull();
  });

  it("fires PUT with adminNotes and shows the saved note after a successful save", async () => {
    const savedNote = "Escalated to compliance team.";
    const updatedComplaint = { ...COMPLAINT, adminNotes: savedNote };
    let putFired = false;

    const { qc: _qc } = renderWithQc();

    // Override fetch for the mutation + the invalidation-triggered refetch.
    //
    //   PUT  /api/admin/content/public-complaints/:id
    //        → returns the updated complaint (mutation success path).
    //   GET  /api/admin/content/public-complaints
    //        → returns [updatedComplaint] once the PUT has been sent, so the
    //          invalidation-triggered refetch delivers the new data to the
    //          component and `notes-display-1` appears.
    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (url.includes("/public-complaints") && opts?.method === "PUT") {
          putFired = true;
          return jsonOk(updatedComplaint);
        }
        if (url.includes("/public-complaints")) {
          // Serve the updated list after the PUT fires so that the
          // invalidation-triggered refetch populates the component with the
          // saved note.
          return jsonOk(putFired ? [updatedComplaint] : [COMPLAINT]);
        }
        return jsonOk([]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the editor.
    await user.click(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`));

    // Type into the textarea.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea");
    expect(textarea).toBeTruthy();
    await user.clear(textarea!);
    await user.type(textarea!, savedNote);

    // Click Save.
    await user.click(screen.getByTestId(`button-save-notes-${COMPLAINT.id}`));

    // The PUT must have been called.
    await waitFor(() => expect(putFired).toBe(true), { timeout: 3000 });

    // Verify the PUT body contained the right adminNotes value.
    const fetchMock = (
      globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }
    ).fetch;
    const putCall = (fetchMock.mock.calls as any[][]).find(
      ([u, o]) =>
        typeof u === "string" &&
        u.includes("/public-complaints") &&
        (o as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body as string);
    expect(body.adminNotes).toBe(savedNote);

    // After the query cache is updated, the saved note should appear.
    await waitFor(
      () => {
        const display = screen.getByTestId(`notes-display-${COMPLAINT.id}`);
        expect(display.textContent).toBe(savedNote);
      },
      { timeout: 3000 },
    );
  });

  it("shows the clear button when adminNotes is non-empty", async () => {
    renderWithQc([COMPLAINT_WITH_NOTES]);

    await openComplaintsTab();

    // The note display and clear button must be visible.
    const display = screen.getByTestId(`notes-display-${COMPLAINT.id}`);
    expect(display.textContent).toBe(COMPLAINT_WITH_NOTES.adminNotes);

    const clearBtn = screen.getByTestId(`button-clear-notes-${COMPLAINT.id}`);
    expect(clearBtn).toBeTruthy();

    // "Add notes" button must NOT appear while a note exists.
    expect(screen.queryByTestId(`button-add-notes-${COMPLAINT.id}`)).toBeNull();
  });

  it("clicking clear fires PUT with adminNotes:'' and restores the 'Add notes' button", async () => {
    const clearedComplaint = { ...COMPLAINT_WITH_NOTES, adminNotes: null };
    let putFired = false;
    let putBody: unknown = null;

    renderWithQc([COMPLAINT_WITH_NOTES]);

    const expectedPutUrl = `/api/admin/content/public-complaints/${COMPLAINT.id}`;

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (url.includes(`/public-complaints/${COMPLAINT.id}`) && opts?.method === "PUT") {
          putFired = true;
          putBody = JSON.parse(opts.body as string);
          return jsonOk(clearedComplaint);
        }
        if (url.includes("/public-complaints")) {
          return jsonOk(putFired ? [clearedComplaint] : [COMPLAINT_WITH_NOTES]);
        }
        return jsonOk([]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // Click the clear button.
    await user.click(screen.getByTestId(`button-clear-notes-${COMPLAINT.id}`));

    // The PUT must have fired to the exact endpoint (including the complaint id).
    await waitFor(() => expect(putFired).toBe(true), { timeout: 3000 });

    const fetchMock = (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    const putCall = (fetchMock.mock.calls as any[][]).find(
      ([u, o]) =>
        typeof u === "string" &&
        u.includes(`/public-complaints/${COMPLAINT.id}`) &&
        (o as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    expect(putCall![0]).toContain(expectedPutUrl);

    // The body must carry adminNotes: "".
    expect((putBody as { adminNotes: string }).adminNotes).toBe("");

    // After the invalidation-triggered refetch the note display is gone
    // and the "Add notes" button should reappear.
    await waitFor(
      () => {
        expect(screen.queryByTestId(`notes-display-${COMPLAINT.id}`)).toBeNull();
        expect(
          screen.getByTestId(`button-add-notes-${COMPLAINT.id}`),
        ).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it("pre-fills the textarea with the existing note when Edit is clicked", async () => {
    renderWithQc([COMPLAINT_WITH_NOTES]);

    await openComplaintsTab();

    // The existing note display should be visible.
    const display = screen.getByTestId(`notes-display-${COMPLAINT.id}`);
    expect(display.textContent).toBe(COMPLAINT_WITH_NOTES.adminNotes);

    // Click the pencil / edit button.
    const user = userEvent.setup();
    await user.click(screen.getByTestId(`button-edit-notes-${COMPLAINT.id}`));

    // The editor should now be open.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    expect(editor).toBeTruthy();

    // The textarea must already contain the existing note text (pre-filled).
    const textarea = editor.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect(textarea!.value).toBe(COMPLAINT_WITH_NOTES.adminNotes);

    // Save / Cancel buttons must be visible.
    expect(screen.getByTestId(`button-save-notes-${COMPLAINT.id}`)).toBeTruthy();
    expect(screen.getByTestId(`button-cancel-notes-${COMPLAINT.id}`)).toBeTruthy();

    // The display div should be gone while editing.
    expect(screen.queryByTestId(`notes-display-${COMPLAINT.id}`)).toBeNull();
  });

  it("fires PUT with the edited text and updates the display after editing an existing note", async () => {
    const updatedNote = "Updated compliance review note.";
    const updatedComplaint = { ...COMPLAINT_WITH_NOTES, adminNotes: updatedNote };
    let putFired = false;

    renderWithQc([COMPLAINT_WITH_NOTES]);

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (url.includes(`/public-complaints/${COMPLAINT.id}`) && opts?.method === "PUT") {
          putFired = true;
          return jsonOk(updatedComplaint);
        }
        if (url.includes("/public-complaints")) {
          return jsonOk(putFired ? [updatedComplaint] : [COMPLAINT_WITH_NOTES]);
        }
        return jsonOk([]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the editor via the pencil button.
    await user.click(screen.getByTestId(`button-edit-notes-${COMPLAINT.id}`));

    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea");
    expect(textarea).toBeTruthy();

    // Verify pre-fill, then overwrite with the new text.
    expect(textarea!.value).toBe(COMPLAINT_WITH_NOTES.adminNotes);
    await user.clear(textarea!);
    await user.type(textarea!, updatedNote);

    // Click Save.
    await user.click(screen.getByTestId(`button-save-notes-${COMPLAINT.id}`));

    // The PUT must have fired.
    await waitFor(() => expect(putFired).toBe(true), { timeout: 3000 });

    // Verify the PUT body carried the updated text, not the original.
    const fetchMock = (
      globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }
    ).fetch;
    const putCall = (fetchMock.mock.calls as any[][]).find(
      ([u, o]) =>
        typeof u === "string" &&
        u.includes(`/public-complaints/${COMPLAINT.id}`) &&
        (o as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body as string);
    expect(body.adminNotes).toBe(updatedNote);

    // After the invalidation-triggered refetch the updated note should appear.
    await waitFor(
      () => {
        const display = screen.getByTestId(`notes-display-${COMPLAINT.id}`);
        expect(display.textContent).toBe(updatedNote);
      },
      { timeout: 3000 },
    );
  });

  it("disables the Save button when the textarea is empty or whitespace-only", async () => {
    renderWithQc();

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the editor — textarea starts empty.
    await user.click(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`));

    const saveBtn = screen.getByTestId(`button-save-notes-${COMPLAINT.id}`);

    // Save must be disabled when the editor is blank.
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Type whitespace only — still disabled.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea")!;
    await user.type(textarea, "   ");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Type a real character — now enabled.
    await user.type(textarea, "x");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    // Clear back to whitespace — disabled again.
    await user.clear(textarea);
    await user.type(textarea, "  ");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the clear button while a save is in-flight", async () => {
    // Arrange: hold the PUT open so the mutation stays in isPending state.
    let resolvePut!: (value: Response) => void;
    const putInflight = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });

    renderWithQc([COMPLAINT_WITH_NOTES]);

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (
          url.includes(`/public-complaints/${COMPLAINT.id}`) &&
          opts?.method === "PUT"
        ) {
          return putInflight;
        }
        return jsonOk([COMPLAINT_WITH_NOTES]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // The clear button must be enabled before any save is in-flight.
    const clearBtn = screen.getByTestId(
      `button-clear-notes-${COMPLAINT.id}`,
    ) as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);

    // Click clear — this fires PUT and leaves the mutation in isPending.
    await user.click(clearBtn);

    // While the PUT is still open the button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          `button-clear-notes-${COMPLAINT.id}`,
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // Resolve the held PUT so TanStack Query can clean up, preventing the
    // "Can't perform a React state update on an unmounted component" warning.
    resolvePut(
      new Response(
        JSON.stringify({ ...COMPLAINT_WITH_NOTES, adminNotes: "" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );
  });

  it("disables the Cancel button while a save is in-flight", async () => {
    // Arrange: hold the PUT open so the mutation stays in isPending state.
    let resolvePut!: (value: Response) => void;
    const putInflight = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });

    renderWithQc();

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (
          url.includes(`/public-complaints/${COMPLAINT.id}`) &&
          opts?.method === "PUT"
        ) {
          return putInflight;
        }
        return jsonOk([COMPLAINT]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the inline editor.
    await user.click(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`));

    // Type a non-empty note so the Save button becomes enabled.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea")!;
    await user.type(textarea, "Saving note");

    // The Cancel button must be enabled before the save starts.
    const cancelBtn = screen.getByTestId(
      `button-cancel-notes-${COMPLAINT.id}`,
    ) as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(false);

    // Click Save — fires PUT and leaves the mutation in isPending.
    await user.click(screen.getByTestId(`button-save-notes-${COMPLAINT.id}`));

    // While the PUT is still open the Cancel button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          `button-cancel-notes-${COMPLAINT.id}`,
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // Resolve the held PUT so TanStack Query can clean up, preventing the
    // "Can't perform a React state update on an unmounted component" warning.
    resolvePut(
      new Response(
        JSON.stringify({ ...COMPLAINT, adminNotes: "Saving note" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );
  });

  it("disables the Save button while a save is in-flight and fires only one PUT", async () => {
    // Arrange: hold the PUT open so the mutation stays in isPending state.
    let resolvePut!: (value: Response) => void;
    const putInflight = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    let putCallCount = 0;

    renderWithQc();

    (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi
      .fn()
      .mockImplementation(async (url: string, opts?: RequestInit) => {
        if (
          url.includes(`/public-complaints/${COMPLAINT.id}`) &&
          opts?.method === "PUT"
        ) {
          putCallCount += 1;
          return putInflight;
        }
        return jsonOk([COMPLAINT]);
      });

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the inline editor.
    await user.click(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`));

    // Type a non-empty note so the Save button is enabled.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea")!;
    await user.type(textarea, "Double-click guard note");

    // Save must be enabled before clicking.
    const saveBtn = screen.getByTestId(
      `button-save-notes-${COMPLAINT.id}`,
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    // First click — fires PUT and leaves the mutation in isPending.
    await user.click(saveBtn);

    // While the PUT is still open the Save button must be disabled.
    await waitFor(
      () => {
        const btn = screen.getByTestId(
          `button-save-notes-${COMPLAINT.id}`,
        ) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
      },
      { timeout: 3000 },
    );

    // Second click while the first PUT is still in-flight — must be a no-op
    // because the button is now disabled.
    const btnAfterFirstClick = screen.getByTestId(
      `button-save-notes-${COMPLAINT.id}`,
    ) as HTMLButtonElement;
    await user.click(btnAfterFirstClick);

    // Resolve the held PUT — only one PUT should have been fired despite the
    // two click attempts.
    const savedNote = "Double-click guard note";
    resolvePut(
      new Response(
        JSON.stringify({ ...COMPLAINT, adminNotes: savedNote }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as unknown as Response,
    );

    // Wait for the mutation to settle, then assert exactly one PUT was sent.
    await waitFor(() => expect(putCallCount).toBe(1), { timeout: 3000 });
  });

  it("closes the editor without saving when Cancel is clicked", async () => {
    renderWithQc();

    await openComplaintsTab();

    const user = userEvent.setup();

    // Open the editor.
    await user.click(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`));
    expect(screen.getByTestId(`notes-editor-${COMPLAINT.id}`)).toBeTruthy();

    // Type something that should be discarded.
    const editor = screen.getByTestId(`notes-editor-${COMPLAINT.id}`);
    const textarea = editor.querySelector("textarea");
    await user.type(textarea!, "Draft text to discard");

    // Click Cancel.
    await user.click(screen.getByTestId(`button-cancel-notes-${COMPLAINT.id}`));

    // Editor must be gone and "Add notes" must be back.
    expect(screen.queryByTestId(`notes-editor-${COMPLAINT.id}`)).toBeNull();
    expect(screen.getByTestId(`button-add-notes-${COMPLAINT.id}`)).toBeTruthy();

    // No PUT should have been fired.
    const fetchMock = (
      globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }
    ).fetch;
    const putCalls = ((fetchMock.mock?.calls ?? []) as any[][]).filter(
      ([u, o]) =>
        typeof u === "string" &&
        u.includes("/public-complaints") &&
        (o as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls).toHaveLength(0);
  });
});
