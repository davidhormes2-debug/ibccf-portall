// @vitest-environment jsdom
//
// Regression guard: AdminWithdrawalRequestsDialog must show the skeleton
// (data-testid="text-wr-admin-loading") while the fetch is in flight and
// switch to real content (rows or empty state) once the fetch resolves.
// A future change that removes the testid, drops the AnimatePresence guard,
// or short-circuits the loading state will fail one of these tests.
//
// We render the component directly rather than through the full
// AdminDashboard to keep the test focused and fast. The only external
// dependencies that need mocking are `fetch` (controlled per-test) and
// `framer-motion` (so AnimatePresence exit transitions resolve
// synchronously in JSDOM).

import React, { act } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { AdminWithdrawalRequestsDialog } from "../AdminWithdrawalRequestsDialog";

// ── Mocks ──────────────────────────────────────────────────────────────────

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// framer-motion: collapse AnimatePresence and motion.div so that
// AnimatePresence exit transitions resolve synchronously in JSDOM.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      ...actual.motion,
      div: ({
        children,
        ...rest
      }: React.HTMLAttributes<HTMLDivElement> & {
        children?: React.ReactNode;
      }) => <div {...rest}>{children}</div>,
    },
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

const MOCK_REQUEST = {
  id: 42,
  caseId: "CASE-001",
  status: "pending" as const,
  amount: "5000",
  asset: "USDT",
  network: "TRC20",
  withdrawalType: "full",
  requestedWalletAddress: "T9xXy1234567890abcdef",
  confirmationChannel: "email",
  createdAt: "2026-01-01T10:00:00Z",
};

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderDialog(
  props: Partial<
    React.ComponentProps<typeof AdminWithdrawalRequestsDialog>
  > = {},
) {
  return render(
    <AdminWithdrawalRequestsDialog
      open={true}
      onOpenChange={vi.fn()}
      caseId="CASE-001"
      caseLabel="Test Case"
      authToken="test-token"
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastSpy.mockClear();
});

// ── Tests: skeleton while loading ──────────────────────────────────────────

describe("AdminWithdrawalRequestsDialog — skeleton while loading", () => {
  it("renders the skeleton element while the fetch is pending", () => {
    // A fetch that never resolves keeps the loading state true.
    let resolveRequest!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveRequest = res;
    });
    vi.stubGlobal("fetch", () => pending);

    renderDialog();

    expect(screen.getByTestId("text-wr-admin-loading")).toBeTruthy();

    // Settle the pending promise so no unhandled rejections remain.
    resolveRequest(makeJsonResponse([]));
  });

  it("does NOT render any content row while the fetch is pending", () => {
    let resolveRequest!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveRequest = res;
    });
    vi.stubGlobal("fetch", () => pending);

    renderDialog();

    expect(
      screen.queryByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
    ).toBeNull();

    resolveRequest(makeJsonResponse([MOCK_REQUEST]));
  });

  it("does NOT render the empty-state message while the fetch is pending", () => {
    let resolveRequest!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveRequest = res;
    });
    vi.stubGlobal("fetch", () => pending);

    renderDialog();

    expect(
      screen.queryByText("No withdrawal requests for this case yet."),
    ).toBeNull();

    resolveRequest(makeJsonResponse([]));
  });
});

// ── Tests: content after loading (with rows) ───────────────────────────────

describe("AdminWithdrawalRequestsDialog — content after loading (rows present)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(makeJsonResponse([MOCK_REQUEST])),
    );
  });

  it("removes the skeleton once the fetch resolves", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });
  });

  it("renders the withdrawal-request row after the fetch resolves", async () => {
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
      ).toBeTruthy();
    });
  });

  it("shows the amount and asset inside the content row", async () => {
    renderDialog();

    await waitFor(() => {
      // The row renders "5000 USDT" as part of the same text node.
      expect(
        screen.getByText((text) =>
          text.includes("5000") && text.includes("USDT"),
        ),
      ).toBeTruthy();
    });
  });
});

// ── Tests: empty state after loading ──────────────────────────────────────

describe("AdminWithdrawalRequestsDialog — empty state after loading", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.resolve(makeJsonResponse([])));
  });

  it("removes the skeleton when the response is an empty list", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });
  });

  it("shows the empty-state message when there are no requests", async () => {
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText("No withdrawal requests for this case yet."),
      ).toBeTruthy();
    });
  });
});

// ── Tests: loading → content transition ───────────────────────────────────

describe("AdminWithdrawalRequestsDialog — loading to content transition", () => {
  it("skeleton present during fetch, absent after resolving with a row", async () => {
    let resolveRequest!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveRequest = res;
    });
    vi.stubGlobal("fetch", () => pending);

    renderDialog();

    // Skeleton visible while the fetch is in-flight.
    expect(screen.getByTestId("text-wr-admin-loading")).toBeTruthy();

    // Resolve the fetch with one withdrawal request.
    await act(async () => {
      resolveRequest(makeJsonResponse([MOCK_REQUEST]));
    });

    // Skeleton must be gone.
    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    // The content row must be present.
    expect(
      screen.getByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
    ).toBeTruthy();
  });

  it("skeleton present during fetch, absent after resolving with empty list", async () => {
    let resolveRequest!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveRequest = res;
    });
    vi.stubGlobal("fetch", () => pending);

    renderDialog();

    expect(screen.getByTestId("text-wr-admin-loading")).toBeTruthy();

    await act(async () => {
      resolveRequest(makeJsonResponse([]));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    expect(
      screen.getByText("No withdrawal requests for this case yet."),
    ).toBeTruthy();
  });
});

// ── Tests: non-OK reload guard — stale rows must be cleared ───────────────
//
// These tests cover the regression case where rows were previously loaded
// successfully and the component is then asked to reload (e.g. after an
// approve/reject action). If the reload returns a non-2xx response or throws,
// the old rows must be cleared so the admin cannot act on stale data.

describe("AdminWithdrawalRequestsDialog — non-OK reload guard clears stale rows", () => {
  it("clears stale rows when a reload returns a non-2xx response", async () => {
    // Sequence (all within the same mounted instance):
    //   open=true  → load() call 1 → rows shown
    //   open=false → no load triggered (effect guard: `if (open && caseId)`)
    //   open=true  → load() call 2 → 500 response → rows must be cleared
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse([MOCK_REQUEST]))
      .mockResolvedValueOnce(makeJsonResponse({ error: "Server Error" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const dialogProps = (open: boolean) => ({
      open,
      onOpenChange: vi.fn(),
      caseId: "CASE-001" as const,
      caseLabel: "Test Case",
      authToken: "test-token",
    });

    const { rerender } = render(
      <AdminWithdrawalRequestsDialog {...dialogProps(true)} />,
    );

    // Wait for the first successful load — row must be present.
    await waitFor(() => {
      expect(
        screen.getByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
      ).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Close the dialog — no new fetch expected.
    rerender(<AdminWithdrawalRequestsDialog {...dialogProps(false)} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Reopen — triggers load() again; this time the server returns 500.
    rerender(<AdminWithdrawalRequestsDialog {...dialogProps(true)} />);

    // The stale row from the previous successful load must be cleared.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears stale rows when a reload throws a network error", async () => {
    // Same pattern: open → rows shown → close → reopen → fetch throws → rows cleared.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse([MOCK_REQUEST]))
      .mockRejectedValueOnce(new Error("Network failure"));
    vi.stubGlobal("fetch", fetchMock);

    const dialogProps = (open: boolean) => ({
      open,
      onOpenChange: vi.fn(),
      caseId: "CASE-001" as const,
      caseLabel: "Test Case",
      authToken: "test-token",
    });

    const { rerender } = render(
      <AdminWithdrawalRequestsDialog {...dialogProps(true)} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
      ).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<AdminWithdrawalRequestsDialog {...dialogProps(false)} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<AdminWithdrawalRequestsDialog {...dialogProps(true)} />);

    await waitFor(() => {
      expect(
        screen.queryByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
      ).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Tests: fetch error branches ────────────────────────────────────────────

describe("AdminWithdrawalRequestsDialog — fetch error branches", () => {
  it("fires a destructive toast and removes the skeleton on a non-2xx response", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(makeJsonResponse({ error: "Forbidden" }, 403)),
    );

    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("does not crash and shows no content rows on a non-2xx response", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(makeJsonResponse({ error: "Server Error" }, 500)),
    );

    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    expect(
      screen.queryByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
    ).toBeNull();
  });

  it("fires a destructive toast and removes the skeleton when fetch throws", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Network failure")));

    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("does not crash and shows no content rows when fetch throws", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Network failure")));

    renderDialog();

    await waitFor(() => {
      expect(screen.queryByTestId("text-wr-admin-loading")).toBeNull();
    });

    expect(
      screen.queryByTestId(`row-withdrawal-request-${MOCK_REQUEST.id}`),
    ).toBeNull();
  });
});
