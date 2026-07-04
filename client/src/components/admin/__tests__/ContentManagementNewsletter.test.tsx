// @vitest-environment jsdom
//
// Task #422 — Cover the newsletter edit/toggle flow added in Task #405.
//
// Three layers of coverage:
//
//   1. Unit tests for the real ApiRequestError class and apiRequest helper,
//      now exported from client/src/lib/adminApiRequest.ts. Tests import the
//      actual implementation rather than a copy.
//
//   2. Real component test: render <ContentManagement> with a QueryClientProvider
//      and a mocked fetch.  Flip the active Switch on a subscriber row and
//      assert the outgoing PUT body contains isActive paired with the correct
//      unsubscribedAt value (null when re-activating, ISO string when
//      deactivating).
//
//   3. Real component test: mock the PUT to return 409; open the edit dialog,
//      change the email, click Save, and confirm that the inline error region
//      (data-testid="alert-newsletter-edit-error") appears and the dialog
//      remains open (not just a toast).

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks — must appear before component imports.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// ---------------------------------------------------------------------------
// Real implementation imports (tested against the actual code).
// ---------------------------------------------------------------------------

import { ApiRequestError, apiRequest } from "@/lib/adminApiRequest";
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

function jsonStatus(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

/** Wrap ContentManagement in a fresh QueryClient for each test. */
function renderContentManagement() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        // Never retry in tests — fail fast.
        retry: false,
        // Don't stale-while-revalidate; use what fetch returns.
        staleTime: Infinity,
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ContentManagement />
    </QueryClientProvider>,
  );
}

/**
 * Build a fetch mock that:
 *  - Returns empty arrays for the five non-newsletter content endpoints.
 *  - Returns `subscribers` for GET /api/admin/content/newsletter.
 *  - Delegates PUT calls to `putHandler`.
 */
function buildFetchMock(
  subscribers: object[],
  putHandler: (url: string, body: object) => Response,
) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? "GET";

    if (method === "GET") {
      if ((url as string).includes("/newsletter")) return jsonOk(subscribers);
      return jsonOk([]);
    }

    if (method === "PUT") {
      const body = JSON.parse((opts!.body as string) ?? "{}");
      return putHandler(url as string, body);
    }

    return jsonOk({});
  });
}

const SUBSCRIBER = {
  id: 1,
  email: "alice@example.com",
  isActive: true,
  subscribedAt: "2026-01-01T00:00:00.000Z",
  unsubscribedAt: null,
};

const SUBSCRIBER_INACTIVE = {
  ...SUBSCRIBER,
  isActive: false,
  unsubscribedAt: "2026-04-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Unit tests — real ApiRequestError
// ---------------------------------------------------------------------------

describe("ApiRequestError (real implementation) — exposes status and payload", () => {
  it("is an instance of Error", () => {
    const err = new ApiRequestError(409, "Email already subscribed", {
      error: "Email already subscribed",
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("stores status as a number property", () => {
    const err = new ApiRequestError(409, "conflict", null);
    expect(err.status).toBe(409);
  });

  it("stores the message via err.message", () => {
    const err = new ApiRequestError(409, "Email already subscribed", null);
    expect(err.message).toBe("Email already subscribed");
  });

  it("stores the full server payload", () => {
    const pl = { error: "Email already subscribed", field: "email" };
    const err = new ApiRequestError(409, "msg", pl);
    expect(err.payload).toBe(pl);
  });

  it("payload can be null", () => {
    expect(new ApiRequestError(500, "oops", null).payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Unit tests — real apiRequest
// ---------------------------------------------------------------------------

describe("apiRequest (real implementation) — throws ApiRequestError for non-2xx", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("resolves with parsed JSON for a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ id: 1, email: "a@b.com" })),
    );
    const result = await apiRequest("/api/admin/content/newsletter/1", {
      method: "PUT",
      body: "{}",
    });
    expect(result).toEqual({ id: 1, email: "a@b.com" });
  });

  it("throws ApiRequestError with status=409 for a 409 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonStatus(409, { error: "Email already subscribed" }),
      ),
    );
    await expect(
      apiRequest("/api/admin/content/newsletter/1", { method: "PUT" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Email already subscribed",
    });
  });

  it("surfaces the server JSON error string as err.message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonStatus(422, { error: "Custom server message" })),
    );
    let caught: unknown;
    try {
      await apiRequest("/api/admin/content/newsletter/1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).message).toBe("Custom server message");
  });

  it("falls back to 'Request failed (NNN)' when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Internal Server Error", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );
    let caught: unknown;
    try {
      await apiRequest("/api/admin/content/newsletter/1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).status).toBe(500);
    expect((caught as ApiRequestError).message).toBe("Request failed (500)");
  });

  it("attaches the full parsed JSON object as err.payload", async () => {
    const serverPayload = { error: "Conflict", field: "email" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonStatus(409, serverPayload)),
    );
    let caught: unknown;
    try {
      await apiRequest("/api/admin/content/newsletter/1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).payload).toEqual(serverPayload);
  });
});

// ---------------------------------------------------------------------------
// 3. Real component test — row-level active Switch sends isActive + unsubscribedAt
// ---------------------------------------------------------------------------

describe("ContentManagement — newsletter row Switch sends isActive paired with unsubscribedAt", () => {
  it("deactivating an active subscriber: sends isActive=false and a non-null ISO unsubscribedAt", async () => {
    const user = userEvent.setup();
    const capturedPuts: Array<{ url: string; body: object }> = [];

    const fetchMock = buildFetchMock([SUBSCRIBER], (url, body) => {
      capturedPuts.push({ url, body });
      return jsonOk({ ...SUBSCRIBER, isActive: false });
    });
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    // Navigate to the newsletter tab.
    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Wait for the subscriber row to appear.
    const switchEl = await screen.findByTestId("switch-newsletter-active-1");
    expect(switchEl).toBeTruthy();

    // The Radix Switch renders as a <button role="switch"> with aria-checked.
    expect(switchEl.getAttribute("aria-checked")).toBe("true");

    // Click the switch to deactivate.
    await user.click(switchEl);

    // Verify a PUT was fired with the correct body.
    await waitFor(() => expect(capturedPuts).toHaveLength(1));

    const { url, body } = capturedPuts[0];
    expect(url).toBe("/api/admin/content/newsletter/1");
    expect((body as any).isActive).toBe(false);
    // unsubscribedAt must be a non-null parseable ISO string.
    expect(typeof (body as any).unsubscribedAt).toBe("string");
    expect(new Date((body as any).unsubscribedAt).getTime()).toBeGreaterThan(0);
  });

  it("re-activating an inactive subscriber: sends isActive=true and unsubscribedAt=null", async () => {
    const user = userEvent.setup();
    const capturedPuts: Array<{ url: string; body: object }> = [];

    const fetchMock = buildFetchMock([SUBSCRIBER_INACTIVE], (url, body) => {
      capturedPuts.push({ url, body });
      return jsonOk({ ...SUBSCRIBER_INACTIVE, isActive: true, unsubscribedAt: null });
    });
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const switchEl = await screen.findByTestId("switch-newsletter-active-1");
    expect(switchEl.getAttribute("aria-checked")).toBe("false");

    await user.click(switchEl);

    await waitFor(() => expect(capturedPuts).toHaveLength(1));

    const { body } = capturedPuts[0];
    expect((body as any).isActive).toBe(true);
    expect((body as any).unsubscribedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Real component test — Export CSV button
// ---------------------------------------------------------------------------

describe("ContentManagement — Export CSV button", () => {
  let capturedBlob: Blob | null = null;
  let mockAnchorClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capturedBlob = null;
    mockAnchorClick = vi.fn();

    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "a") {
          const el = origCreateElement("a");
          el.click = mockAnchorClick as unknown as () => void;
          return el;
        }
        return origCreateElement(tag, options);
      },
    );
  });

  it("button is visible when subscribers exist", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    expect(btn).toBeTruthy();
  });

  it("button is absent when subscriber list is empty", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Wait for the tab content to load (empty state message appears).
    await screen.findByText("No subscribers yet");

    expect(
      screen.queryByTestId("button-export-newsletter-csv"),
    ).toBeNull();
  });

  it("CSV has the correct header row", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    expect(lines[0]).toBe('"Email","Subscribed Date","Status"');
  });

  it("CSV row contains the subscriber email", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    expect(lines[1]).toContain('"alice@example.com"');
  });

  it("CSV row contains the subscribed date formatted as YYYY-MM-DD", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    // subscribedAt "2026-01-01T00:00:00.000Z" → "2026-01-01"
    expect(lines[1]).toContain('"2026-01-01"');
  });

  it("active subscriber shows 'Active' in Status column", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    expect(lines[1]).toContain('"Active"');
  });

  it("inactive subscriber shows 'Unsubscribed' in Status column", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER_INACTIVE], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    expect(lines[1]).toContain('"Unsubscribed"');
  });

  it("each cell value is double-quote escaped", async () => {
    const user = userEvent.setup();
    const subscriberWithQuote = {
      ...SUBSCRIBER,
      email: 'tricky"quote@example.com',
    };
    (globalThis as any).fetch = buildFetchMock([subscriberWithQuote], () =>
      jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    // The quote inside the email should be doubled: "" per CSV spec.
    expect(text).toContain('"tricky""quote@example.com"');
  });

  it("multiple subscribers produce one data row each", async () => {
    const user = userEvent.setup();
    const secondSubscriber = {
      id: 2,
      email: "bob@example.com",
      isActive: false,
      subscribedAt: "2026-03-15T10:00:00.000Z",
      unsubscribedAt: "2026-04-01T00:00:00.000Z",
    };
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, secondSubscriber],
      () => jsonOk({}),
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedBlob!.text();
    const lines = text.split("\r\n");
    // Header + 2 data rows = 3 lines.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"alice@example.com"');
    expect(lines[2]).toContain('"bob@example.com"');
    expect(lines[2]).toContain('"2026-03-15"');
    expect(lines[2]).toContain('"Unsubscribed"');
  });
});

// ---------------------------------------------------------------------------
// 5. Real component test — Export CSV button — selection-aware behaviour
// ---------------------------------------------------------------------------

describe("ContentManagement — Export CSV button selection-aware behaviour", () => {
  let capturedDownload: { blob: Blob; filename: string } | null = null;
  let mockAnchorClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capturedDownload = null;
    mockAnchorClick = vi.fn();

    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      return "blob:mock-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tag: string, options?: ElementCreationOptions) => {
        if (tag === "a") {
          const el = origCreateElement("a") as HTMLAnchorElement;
          Object.defineProperty(el, "download", {
            set(value: string) {
              (el as any)._download = value;
            },
            get() {
              return (el as any)._download ?? "";
            },
          });
          el.click = mockAnchorClick.mockImplementation(() => {
            capturedDownload = {
              blob: (URL.createObjectURL as any).mock.calls.at(-1)?.[0] as Blob,
              filename: el.download,
            };
          }) as unknown as () => void;
          return el;
        }
        return origCreateElement(tag, options);
      },
    );
  });

  const SECOND_SUBSCRIBER = {
    id: 2,
    email: "bob@example.com",
    isActive: false,
    subscribedAt: "2026-03-15T10:00:00.000Z",
    unsubscribedAt: "2026-04-01T00:00:00.000Z",
  };

  it("with nothing selected the button label is 'Export CSV'", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    expect(btn.textContent).toContain("Export CSV");
  });

  it("with nothing selected the exported filename is newsletter-subscribers-<date>.csv", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    expect(capturedDownload!.filename).toMatch(
      /^newsletter-subscribers-\d{4}-\d{2}-\d{2}\.csv$/
    );
    expect(capturedDownload!.filename).not.toContain("selected");
  });

  it("with nothing selected all rows are exported", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, SECOND_SUBSCRIBER],
      () => jsonOk({})
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedDownload!.blob.text();
    const lines = text.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"alice@example.com"');
    expect(lines[2]).toContain('"bob@example.com"');
  });

  it("after selecting one row the button label shows 'Export selected (1)'", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, SECOND_SUBSCRIBER],
      () => jsonOk({})
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    expect(btn.textContent).toContain("Export selected (1)");
  });

  it("with one row selected only that row appears in the CSV", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, SECOND_SUBSCRIBER],
      () => jsonOk({})
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedDownload!.blob.text();
    const lines = text.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"alice@example.com"');
    expect(text).not.toContain("bob@example.com");
  });

  it("with one row selected the filename contains 'selected'", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, SECOND_SUBSCRIBER],
      () => jsonOk({})
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    expect(capturedDownload!.filename).toMatch(
      /^newsletter-subscribers-selected-\d{4}-\d{2}-\d{2}\.csv$/
    );
  });

  it("selecting all rows via the header checkbox exports every row", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock(
      [SUBSCRIBER, SECOND_SUBSCRIBER],
      () => jsonOk({})
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const selectAll = await screen.findByTestId(
      "checkbox-select-all-newsletter"
    );
    await user.click(selectAll);

    const btn = await screen.findByTestId("button-export-newsletter-csv");
    await user.click(btn);

    await waitFor(() => expect(mockAnchorClick).toHaveBeenCalled());

    const text = await capturedDownload!.blob.text();
    const lines = text.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"alice@example.com"');
    expect(lines[2]).toContain('"bob@example.com"');
  });
});

// ---------------------------------------------------------------------------
// 6. Real component test — 409 PUT → inline error, dialog stays open
// ---------------------------------------------------------------------------

describe("ContentManagement — newsletter edit dialog shows inline error on 409", () => {
  it("displays alert-newsletter-edit-error with the server message instead of closing on 409", async () => {
    const user = userEvent.setup();

    const fetchMock = buildFetchMock([SUBSCRIBER], (_url, _body) =>
      jsonStatus(409, { error: "Email already subscribed" }),
    );
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    // Navigate to newsletter tab and open the edit dialog.
    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const editBtn = await screen.findByTestId("button-edit-newsletter-1");
    await user.click(editBtn);

    // The dialog should now be open.
    const dialog = await screen.findByTestId("dialog-edit-newsletter");
    expect(dialog).toBeTruthy();

    // Change the email so the patch is non-empty.
    const emailInput = screen.getByTestId("input-newsletter-email");
    await user.clear(emailInput);
    await user.type(emailInput, "duplicate@example.com");

    // Save — triggers the PUT that returns 409.
    const saveBtn = screen.getByTestId("button-newsletter-save");
    await user.click(saveBtn);

    // The inline error should appear.
    const alertEl = await screen.findByTestId("alert-newsletter-edit-error");
    expect(alertEl).toBeTruthy();
    expect(alertEl.textContent).toContain("Email already subscribed");
  });

  it("inline error has role='alert' for screen readers", async () => {
    const user = userEvent.setup();

    const fetchMock = buildFetchMock([SUBSCRIBER], () =>
      jsonStatus(409, { error: "Email already subscribed" }),
    );
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const editBtn = await screen.findByTestId("button-edit-newsletter-1");
    await user.click(editBtn);

    const emailInput = await screen.findByTestId("input-newsletter-email");
    await user.clear(emailInput);
    await user.type(emailInput, "dup@example.com");
    await user.click(screen.getByTestId("button-newsletter-save"));

    const alertEl = await screen.findByTestId("alert-newsletter-edit-error");
    expect(alertEl.getAttribute("role")).toBe("alert");
  });

  it("dialog stays open after 409 so admin can correct the email", async () => {
    const user = userEvent.setup();

    const fetchMock = buildFetchMock([SUBSCRIBER], () =>
      jsonStatus(409, { error: "Email already subscribed" }),
    );
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const editBtn = await screen.findByTestId("button-edit-newsletter-1");
    await user.click(editBtn);

    const emailInput = await screen.findByTestId("input-newsletter-email");
    await user.clear(emailInput);
    await user.type(emailInput, "dup@example.com");
    await user.click(screen.getByTestId("button-newsletter-save"));

    await screen.findByTestId("alert-newsletter-edit-error");

    // Dialog must still be mounted.
    expect(screen.queryByTestId("dialog-edit-newsletter")).toBeTruthy();
  });

  it("dialog closes and no inline error appears when PUT returns 200", async () => {
    const user = userEvent.setup();

    const fetchMock = buildFetchMock(
      [SUBSCRIBER],
      () => jsonOk({ ...SUBSCRIBER, email: "new@example.com" }),
    );
    (globalThis as any).fetch = fetchMock;

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const editBtn = await screen.findByTestId("button-edit-newsletter-1");
    await user.click(editBtn);

    await screen.findByTestId("dialog-edit-newsletter");

    const emailInput = screen.getByTestId("input-newsletter-email");
    await user.clear(emailInput);
    await user.type(emailInput, "new@example.com");
    await user.click(screen.getByTestId("button-newsletter-save"));

    // Dialog should close on success — the testid disappears.
    await waitFor(() =>
      expect(screen.queryByTestId("dialog-edit-newsletter")).toBeNull(),
    );
    expect(screen.queryByTestId("alert-newsletter-edit-error")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Real component test — bulk-delete flow
// ---------------------------------------------------------------------------

/**
 * Build a fetch mock that handles GET, PUT, and DELETE:
 *  - GET /newsletter returns `getSubscribers()` (called each time so the
 *    refetch after deletion can return an updated list).
 *  - GET for every other endpoint returns [].
 *  - PUT delegates to `putHandler`.
 *  - DELETE delegates to `deleteHandler`.
 */
function buildFullFetchMock(
  getSubscribers: () => object[],
  putHandler: (url: string, body: object) => Response = () => jsonOk({}),
  deleteHandler: (url: string) => Response | Promise<Response> = () => jsonOk({}),
) {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = opts?.method?.toUpperCase() ?? "GET";

    if (method === "GET") {
      if ((url as string).includes("/newsletter")) return jsonOk(getSubscribers());
      return jsonOk([]);
    }

    if (method === "PUT") {
      const body = JSON.parse((opts!.body as string) ?? "{}");
      return putHandler(url as string, body);
    }

    if (method === "DELETE") {
      return deleteHandler(url as string);
    }

    return jsonOk({});
  });
}

const SUBSCRIBER_2 = {
  id: 2,
  email: "bob@example.com",
  isActive: true,
  subscribedAt: "2026-02-01T00:00:00.000Z",
  unsubscribedAt: null,
};

describe("ContentManagement — newsletter bulk-delete flow", () => {
  it("'Delete selected' button appears with the correct count after selecting a row", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFullFetchMock(() => [SUBSCRIBER]);

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the row checkbox for subscriber 1.
    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    // The "Delete selected" button should appear with count = 1.
    const deleteBtn = await screen.findByTestId("button-bulk-delete-newsletter");
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.textContent).toContain("1");
  });

  it("'Delete selected' count reflects all selected rows when multiple are checked", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFullFetchMock(() => [SUBSCRIBER, SUBSCRIBER_2]);

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    await user.click(await screen.findByTestId("checkbox-newsletter-2"));

    const deleteBtn = screen.getByTestId("button-bulk-delete-newsletter");
    expect(deleteBtn.textContent).toContain("2");
  });

  it("clicking 'Delete selected' opens the confirmation dialog", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFullFetchMock(() => [SUBSCRIBER]);

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));

    // The confirmation dialog lists the selected subscriber's email.
    const emailListItem = await screen.findByTestId("bulk-delete-email-1");
    expect(emailListItem.textContent).toContain("alice@example.com");
  });

  it("clicking Confirm fires a DELETE request for each selected subscriber id", async () => {
    const user = userEvent.setup();
    const deletedUrls: string[] = [];

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER, SUBSCRIBER_2],
      () => jsonOk({}),
      (url) => {
        deletedUrls.push(url);
        return jsonOk({});
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select both rows.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    await user.click(await screen.findByTestId("checkbox-newsletter-2"));

    // Open the dialog and confirm.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // Both DELETE requests must be fired with the correct URLs.
    await waitFor(() => expect(deletedUrls).toHaveLength(2));
    expect(deletedUrls).toContain("/api/admin/content/newsletter/1");
    expect(deletedUrls).toContain("/api/admin/content/newsletter/2");
  });

  it("rows are removed from the list after successful deletion", async () => {
    const user = userEvent.setup();
    let deleted = false;

    // After deletion, the GET refetch should return an empty list.
    (globalThis as any).fetch = buildFullFetchMock(
      () => (deleted ? [] : [SUBSCRIBER]),
      () => jsonOk({}),
      (url) => {
        if (url.includes("/newsletter/1")) deleted = true;
        return jsonOk({});
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Verify the row is present initially.
    expect(await screen.findByTestId("row-newsletter-subscriber-1")).toBeTruthy();

    // Select, open dialog, confirm deletion.
    await user.click(screen.getByTestId("checkbox-newsletter-1"));
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // After the refetch the row should no longer be in the DOM.
    await waitFor(() =>
      expect(screen.queryByTestId("row-newsletter-subscriber-1")).toBeNull(),
    );
  });

  it("Cancel button closes the dialog without firing any DELETE request", async () => {
    const user = userEvent.setup();
    const deletedUrls: string[] = [];

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      (url) => {
        deletedUrls.push(url);
        return jsonOk({});
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));

    // Dialog is open; cancel it.
    await user.click(await screen.findByTestId("button-bulk-delete-cancel"));

    // No DELETE should have been sent.
    expect(deletedUrls).toHaveLength(0);

    // Dialog should be gone.
    await waitFor(() =>
      expect(screen.queryByTestId("button-bulk-delete-confirm")).toBeNull(),
    );
  });

  it("'Delete selected' re-enables after a bulk-delete request fails with a 500", async () => {
    const user = userEvent.setup();

    // Use a controllable promise so we can observe the disabled state while
    // the mutation is in-flight before settling it with a 500 response.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the row and open the confirmation dialog.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));
    const deleteSelectedBtn = screen.getByTestId(
      "button-bulk-delete-newsletter",
    ) as HTMLButtonElement;
    await user.click(deleteSelectedBtn);

    // Click Confirm — fires the DELETE and holds the mutation in pending state.
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // While isPending=true the "Delete selected" button must be disabled.
    await waitFor(() => expect(deleteSelectedBtn.disabled).toBe(true));

    // Settle the DELETE with a 500 — mutation resolves via Promise.allSettled,
    // onSuccess clears the selection and closes the dialog.
    resolveDelete(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Once isPending flips back to false the dialog closes and the selection is
    // cleared — the button is removed from the DOM, which is proof it is no
    // longer stuck in a disabled/pending state.
    await waitFor(() =>
      expect(screen.queryByTestId("button-bulk-delete-confirm")).toBeNull(),
    );
    // If the button is still mounted it must not be disabled.
    const btn = screen.queryByTestId("button-bulk-delete-newsletter");
    if (btn) {
      expect(btn).not.toBeDisabled();
    }
  });

  it("'select all' header checkbox selects every row and shows the correct count", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFullFetchMock(() => [SUBSCRIBER, SUBSCRIBER_2]);

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Click the header "select all" checkbox.
    const selectAll = await screen.findByTestId("checkbox-select-all-newsletter");
    fireEvent.click(selectAll);

    // Both rows are now selected → Delete selected button should show count 2.
    const deleteBtn = await screen.findByTestId("button-bulk-delete-newsletter");
    expect(deleteBtn.textContent).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// 7. Real component test — export button is disabled during bulk delete
// ---------------------------------------------------------------------------

describe("ContentManagement — export button is disabled while bulk delete is in flight", () => {
  it("export button becomes disabled when bulk delete mutation is pending", async () => {
    const user = userEvent.setup();

    // A DELETE that never settles — keeps the mutation in isPending state.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    // Verify export button is enabled before the delete starts.
    const exportBtn = await screen.findByTestId("button-export-newsletter-csv");
    expect((exportBtn as HTMLButtonElement).disabled).toBe(false);

    // Open the confirmation dialog and confirm the bulk delete.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // The export button must be disabled while the DELETE is in flight.
    await waitFor(() => {
      expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the pending DELETE so React can clean up state.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("export button re-enables after the bulk delete completes", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    let deleted = false;
    (globalThis as any).fetch = buildFullFetchMock(
      () => (deleted ? [] : [SUBSCRIBER]),
      () => jsonOk({}),
      (url) => {
        if (url.includes("/newsletter/1")) deleted = true;
        return pendingDelete;
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    const exportBtn = await screen.findByTestId("button-export-newsletter-csv");

    // Start the bulk delete.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // Wait for the button to go disabled.
    await waitFor(() => {
      expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the DELETE so the mutation settles.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation completes the subscriber is gone so the export button
    // is no longer rendered (empty subscriber list hides it). Either outcome
    // (button absent OR re-enabled) confirms the guard lifted correctly.
    await waitFor(() => {
      const btn = screen.queryByTestId("button-export-newsletter-csv") as HTMLButtonElement | null;
      const isGone = btn === null;
      const isEnabled = btn !== null && !btn.disabled;
      expect(isGone || isEnabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Real component test — confirm button disabled state during bulk delete
// ---------------------------------------------------------------------------

describe("ContentManagement — confirm button is disabled while bulk delete is in flight", () => {
  it("button-bulk-delete-confirm becomes disabled when the mutation is pending", async () => {
    const user = userEvent.setup();

    // A DELETE that never settles — keeps the mutation in isPending state.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open the confirmation dialog.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));

    // Confirm button is enabled before clicking.
    const confirmBtn = await screen.findByTestId("button-bulk-delete-confirm");
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);

    // Click confirm — this fires the DELETE and keeps the dialog open while
    // the mutation is pending (onOpenChange is blocked during isPending).
    await user.click(confirmBtn);

    // The confirm button must be disabled while the DELETE is in flight.
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the pending DELETE so React can clean up state.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("button-bulk-delete-confirm is no longer disabled after the bulk delete completes", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    // Keep two subscribers in the list after deletion so the dialog can
    // theoretically reopen; DELETE only touches subscriber 1.
    let deleted = false;
    (globalThis as any).fetch = buildFullFetchMock(
      () => (deleted ? [SUBSCRIBER_2] : [SUBSCRIBER, SUBSCRIBER_2]),
      () => jsonOk({}),
      (url: string) => {
        if (url.includes("/newsletter/1")) deleted = true;
        return pendingDelete;
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select subscriber 1 only.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open dialog and confirm.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    const confirmBtn = await screen.findByTestId("button-bulk-delete-confirm");
    await user.click(confirmBtn);

    // Wait for the button to go disabled (mutation is in flight).
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the DELETE so the mutation settles.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation completes the dialog closes (selection is cleared).
    // Either the confirm button is gone OR re-enabled confirms the guard lifted.
    await waitFor(() => {
      const btn = screen.queryByTestId("button-bulk-delete-confirm") as HTMLButtonElement | null;
      const isGone = btn === null;
      const isEnabled = btn !== null && !btn.disabled;
      expect(isGone || isEnabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Real component test — cancel button disabled state during bulk delete
// ---------------------------------------------------------------------------

describe("ContentManagement — cancel button is disabled while bulk delete is in flight", () => {
  it("button-bulk-delete-cancel becomes disabled when the mutation is pending", async () => {
    const user = userEvent.setup();

    // A DELETE that never settles — keeps the mutation in isPending state.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open the confirmation dialog.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));

    // Cancel button is enabled before the mutation starts.
    const cancelBtn = await screen.findByTestId("button-bulk-delete-cancel");
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(false);

    // Click confirm — fires the DELETE and keeps the dialog open while pending.
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // The cancel button must be disabled while the DELETE is in flight.
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the pending DELETE so React can clean up state.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("button-bulk-delete-cancel is no longer disabled after the bulk delete completes", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    // Keep two subscribers so the dialog can potentially reopen; only
    // subscriber 1 is deleted.
    let deleted = false;
    (globalThis as any).fetch = buildFullFetchMock(
      () => (deleted ? [SUBSCRIBER_2] : [SUBSCRIBER, SUBSCRIBER_2]),
      () => jsonOk({}),
      (url: string) => {
        if (url.includes("/newsletter/1")) deleted = true;
        return pendingDelete;
      },
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select subscriber 1 only.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open dialog and confirm.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    const cancelBtn = await screen.findByTestId("button-bulk-delete-cancel");
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // Wait for the cancel button to go disabled (mutation in flight).
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the DELETE so the mutation settles.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation completes the dialog closes (selection cleared).
    // Either the cancel button is gone OR re-enabled confirms the guard lifted.
    await waitFor(() => {
      const btn = screen.queryByTestId("button-bulk-delete-cancel") as HTMLButtonElement | null;
      const isGone = btn === null;
      const isEnabled = btn !== null && !btn.disabled;
      expect(isGone || isEnabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Real component test — 'Delete selected' button disabled state during bulk delete
// ---------------------------------------------------------------------------

describe("ContentManagement — 'Delete selected' button is disabled while bulk delete is in flight", () => {
  it("'Delete selected' button becomes disabled when the bulk delete mutation is pending", async () => {
    const user = userEvent.setup();

    // A DELETE that never settles — keeps the mutation in isPending state.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    const checkbox = await screen.findByTestId("checkbox-newsletter-1");
    await user.click(checkbox);

    // The 'Delete selected' button should be enabled before the mutation starts.
    const deleteBtn = await screen.findByTestId("button-bulk-delete-newsletter");
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);

    // Open the confirmation dialog and confirm the bulk delete.
    await user.click(deleteBtn);
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // The 'Delete selected' button must be disabled while the DELETE is in flight.
    await waitFor(() => {
      expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Settle the pending DELETE so React can clean up state.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("'Delete selected' button is no longer disabled after the bulk delete completes", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    // After deletion the GET refetch returns two subscribers so the button
    // stays rendered (selection is cleared but we can re-select to verify).
    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER, SUBSCRIBER_2],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select subscriber 1.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    const deleteBtn = await screen.findByTestId("button-bulk-delete-newsletter");

    // Open dialog and confirm.
    await user.click(deleteBtn);
    await user.click(await screen.findByTestId("button-bulk-delete-confirm"));

    // Wait for the button to go disabled (mutation is in flight).
    await waitFor(() => {
      expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the DELETE so the mutation settles.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation completes the selection is cleared, so the
    // 'Delete selected' button is hidden (no selection). Either it is gone
    // OR re-enabled confirms the pending guard lifted correctly.
    await waitFor(() => {
      const btn = screen.queryByTestId("button-bulk-delete-newsletter") as HTMLButtonElement | null;
      const isGone = btn === null;
      const isEnabled = btn !== null && !btn.disabled;
      expect(isGone || isEnabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Real component test — onOpenChange guard keeps dialog open during bulk delete
// ---------------------------------------------------------------------------

describe("ContentManagement — dialog stays open while bulk delete is in flight", () => {
  it("pressing Escape while the DELETE is pending does not close the dialog", async () => {
    const user = userEvent.setup();

    // A DELETE that never settles — keeps the mutation in isPending state.
    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open the confirmation dialog.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));

    // Confirm — fires the DELETE and keeps the mutation pending.
    const confirmBtn = await screen.findByTestId("button-bulk-delete-confirm");
    await user.click(confirmBtn);

    // Wait for the mutation to be in flight (confirm button is now disabled).
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Attempt to dismiss the dialog via the Escape key.
    // The onOpenChange guard must block this while isPending is true.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    });

    // The dialog must still be mounted — both action buttons remain visible.
    await waitFor(() => {
      expect(screen.queryByTestId("button-bulk-delete-confirm")).not.toBeNull();
      expect(screen.queryByTestId("button-bulk-delete-cancel")).not.toBeNull();
    });

    // Settle the pending DELETE so React can clean up state.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("'Delete selected' button is disabled immediately after Confirm is clicked", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Verify the "Delete selected" button exists and is enabled before the dialog.
    const deleteSelectedBtn = screen.getByTestId(
      "button-bulk-delete-newsletter",
    ) as HTMLButtonElement;
    expect(deleteSelectedBtn.disabled).toBe(false);

    // Open the confirmation dialog.
    await user.click(deleteSelectedBtn);

    // Confirm — fires the DELETE and keeps the mutation pending.
    const confirmBtn = await screen.findByTestId("button-bulk-delete-confirm");
    await user.click(confirmBtn);

    // The "Delete selected" header button must become disabled while the
    // mutation is in flight — guarding against a second dialog open or
    // duplicate DELETE requests.
    await waitFor(() => {
      expect(deleteSelectedBtn.disabled).toBe(true);
    });

    // Settle the pending DELETE so React can clean up.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("dialog closes normally after the bulk delete settles", async () => {
    const user = userEvent.setup();

    let resolveDelete!: (r: Response) => void;
    const pendingDelete = new Promise<Response>((res) => {
      resolveDelete = res;
    });

    (globalThis as any).fetch = buildFullFetchMock(
      () => [SUBSCRIBER],
      () => jsonOk({}),
      () => pendingDelete,
    );

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    // Select the subscriber row.
    await user.click(await screen.findByTestId("checkbox-newsletter-1"));

    // Open the confirmation dialog and confirm.
    await user.click(screen.getByTestId("button-bulk-delete-newsletter"));
    const confirmBtn = await screen.findByTestId("button-bulk-delete-confirm");
    await user.click(confirmBtn);

    // Wait until the mutation is in flight.
    await waitFor(() => {
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the DELETE — the mutation settles and the guard is lifted.
    resolveDelete(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation settles the dialog closes (selection is cleared).
    await waitFor(() => {
      expect(screen.queryByTestId("button-bulk-delete-confirm")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Clear filters button
// ---------------------------------------------------------------------------

describe("ContentManagement — newsletter Clear filters button", () => {
  it("is hidden when no filter is active", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    await screen.findByTestId("input-search-newsletter");
    expect(screen.queryByTestId("button-clear-newsletter-filters")).toBeNull();
  });

  it("appears when a search string is entered and disappears after clearing", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const searchInput = await screen.findByTestId("input-search-newsletter");
    await user.type(searchInput, "alice");

    const clearBtn = await screen.findByTestId("button-clear-newsletter-filters");
    expect(clearBtn).toBeTruthy();

    await user.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("button-clear-newsletter-filters")).toBeNull();
    });
    expect((searchInput as HTMLInputElement).value).toBe("");
  });

  it("appears when a status filter is set and disappears after clearing", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const statusSelect = await screen.findByTestId("select-newsletter-status-filter");
    await user.selectOptions(statusSelect, "active");

    const clearBtn = await screen.findByTestId("button-clear-newsletter-filters");
    expect(clearBtn).toBeTruthy();

    await user.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("button-clear-newsletter-filters")).toBeNull();
    });
    expect((statusSelect as HTMLSelectElement).value).toBe("all");
  });

  it("resets both search and status filter simultaneously", async () => {
    const user = userEvent.setup();
    (globalThis as any).fetch = buildFetchMock([SUBSCRIBER], () => jsonOk({}));

    renderContentManagement();

    const newsletterTab = await screen.findByTestId("content-tab-newsletter");
    await user.click(newsletterTab);

    const searchInput = await screen.findByTestId("input-search-newsletter");
    const statusSelect = await screen.findByTestId("select-newsletter-status-filter");

    await user.type(searchInput, "bob");
    await user.selectOptions(statusSelect, "inactive");

    const clearBtn = await screen.findByTestId("button-clear-newsletter-filters");
    await user.click(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("button-clear-newsletter-filters")).toBeNull();
    });
    expect((searchInput as HTMLInputElement).value).toBe("");
    expect((statusSelect as HTMLSelectElement).value).toBe("all");
  });
});
