// @vitest-environment jsdom
//
// Unit tests for:
//   - RefundClaimRequestDialog: compose tab, optional recommendations, send action,
//     portal preview tab, cancel, loading state.
//   - RefundClaimReviewDialog: fetches claim on open, shows submitted entries,
//     approve/reject actions, approved state (cert download), no-claim fallback.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";

// ---- Mocks (must precede component imports) --------------------------------

vi.mock("framer-motion", () => {
  const passthrough = (Tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: any) =>
      React.createElement(Tag, { ...rest, style: undefined }, children);
    C.displayName = `motion.${String(Tag)}`;
    return C;
  };
  return {
    motion: new Proxy({}, { get: (_t, prop: string) => passthrough(prop as any) }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

// Stub Dialog to render its content immediately (no Radix portal / pointer events).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// Stub Tabs to render active content without Radix state machine.
vi.mock("@/components/ui/tabs", () => {
  const TabsCtx = React.createContext<{ value: string; onValueChange: (v: string) => void }>({
    value: "compose",
    onValueChange: () => {},
  });
  const Tabs = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <TabsCtx.Provider value={{ value, onValueChange }}>
      <div data-testid="tabs">{children}</div>
    </TabsCtx.Provider>
  );
  const TabsList = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-list">{children}</div>
  );
  const TabsTrigger = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    const ctx = React.useContext(TabsCtx);
    return (
      <button
        data-testid={`tab-trigger-${value}`}
        data-state={ctx.value === value ? "active" : "inactive"}
        onClick={() => ctx.onValueChange(value)}
      >
        {children}
      </button>
    );
  };
  const TabsContent = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    const ctx = React.useContext(TabsCtx);
    return ctx.value === value ? <div data-testid={`tab-content-${value}`}>{children}</div> : null;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

// ---- Fetch stub ------------------------------------------------------------

let fetchMock: vi.Mock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  global.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ============================================================================
// RefundClaimRequestDialog
// ============================================================================

import { RefundClaimRequestDialog } from "../RefundClaimRequestDialog";

describe("RefundClaimRequestDialog", () => {
  const caseRow = {
    id: "case-1",
    userName: "Alice Smith",
    userEmail: "alice@example.com",
    refundClaimStatus: null,
  };

  function renderDialog(overrides: Partial<React.ComponentProps<typeof RefundClaimRequestDialog>> = {}) {
    const props: React.ComponentProps<typeof RefundClaimRequestDialog> = {
      open: true,
      caseRow,
      onClose: vi.fn(),
      onSent: vi.fn(),
      authToken: "test-auth-token",
      ...overrides,
    };
    return { ...render(<RefundClaimRequestDialog {...props} />), props };
  }

  it("renders the dialog when open=true", () => {
    renderDialog();
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByText("Send Refund Claim Request")).toBeTruthy();
  });

  it("does NOT render when open=false", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("shows case name and email in the description", () => {
    renderDialog();
    expect(screen.getByText(/Alice Smith/)).toBeTruthy();
    expect(screen.getByText(/alice@example\.com/)).toBeTruthy();
  });

  it("shows the compose tab content by default", () => {
    renderDialog();
    expect(screen.getByTestId("tab-content-compose")).toBeTruthy();
    expect(screen.queryByTestId("tab-content-preview")).toBeNull();
  });

  it("switches to portal preview tab when preview trigger is clicked", () => {
    renderDialog();
    const previewTrigger = screen.getByTestId("tab-trigger-preview");
    fireEvent.click(previewTrigger);
    expect(screen.getByTestId("tab-content-preview")).toBeTruthy();
    expect(screen.queryByTestId("tab-content-compose")).toBeNull();
  });

  it("calls onClose when Cancel is clicked", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByText("Cancel"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("calls POST endpoint with correct payload when Send is clicked", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });

    const { props } = renderDialog();

    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000/i);
    fireEvent.change(amountInput, { target: { value: "1000" } });

    const textarea = screen.getByPlaceholderText(/bank statement/i);
    fireEvent.change(textarea, { target: { value: "Include bank statement for April." } });

    fireEvent.click(screen.getByText(/Send & Enable/));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/cases/case-1/refund-claim/request",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-auth-token",
          }),
          body: JSON.stringify({
            refundableAmount: "1000",
            documentaryRecommendations: "Include bank statement for April.",
          }),
        }),
      );
    });
  });

  it("calls onSent and onClose on successful send", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });

    const { props } = renderDialog();
    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000/i);
    fireEvent.change(amountInput, { target: { value: "500" } });
    fireEvent.click(screen.getByText(/Send & Enable/));

    await waitFor(() => {
      expect(props.onSent).toHaveBeenCalled();
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it("sends null for documentaryRecommendations when the textarea is left blank", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });

    renderDialog();
    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000/i);
    fireEvent.change(amountInput, { target: { value: "1000" } });
    fireEvent.click(screen.getByText(/Send & Enable/));

    await waitFor(() => {
      const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
      expect(body.documentaryRecommendations).toBeNull();
    });
  });

  it("disables the send button when refundable amount is empty", () => {
    renderDialog();
    const sendBtn = screen.getByText(/Send & Enable/).closest("button") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("enables the send button once a refundable amount is entered", () => {
    renderDialog();
    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000/i);
    fireEvent.change(amountInput, { target: { value: "750" } });
    const sendBtn = screen.getByText(/Send & Enable/).closest("button") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it("disables the send button while request is in-flight", async () => {
    const onSent = vi.fn();
    let resolveFetch!: () => void;
    fetchMock.mockReturnValueOnce(
      new Promise<any>((res) => {
        resolveFetch = () => res({ ok: true, status: 200, json: async () => ({ success: true }) });
      })
    );

    renderDialog({ onSent });
    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000/i);
    fireEvent.change(amountInput, { target: { value: "1000" } });
    const sendBtn = screen.getByText(/Send & Enable/).closest("button") as HTMLButtonElement;
    fireEvent.click(sendBtn);

    // Button should be disabled while in-flight (sending=true)
    expect(sendBtn.disabled).toBe(true);

    // Resolve the fetch — onSent fires, confirming the in-flight period ended
    act(() => resolveFetch());
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it("does not call fetch when caseRow is null", () => {
    renderDialog({ caseRow: null });
    const sendBtn = screen.queryByText(/Send & Enable/)?.closest("button");
    if (sendBtn) {
      fireEvent.click(sendBtn);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// RefundClaimReviewDialog
// ============================================================================

import { RefundClaimReviewDialog } from "../RefundClaimReviewDialog";

describe("RefundClaimReviewDialog", () => {
  const sampleClaim = {
    id: 1,
    status: "submitted",
    entries: [
      { amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "tx-abc", network: "TRC20", notes: "First payment" },
    ],
    documentaryRecommendations: "Please include a bank statement.",
    adminNotes: null,
    requestedAt: "2026-01-10T10:00:00Z",
    submittedAt: "2026-01-16T12:00:00Z",
    reviewedAt: null,
    reviewedBy: null,
  };

  function renderReview(overrides: Partial<React.ComponentProps<typeof RefundClaimReviewDialog>> = {}) {
    const props: React.ComponentProps<typeof RefundClaimReviewDialog> = {
      open: true,
      caseId: "case-1",
      caseName: "Alice Smith",
      onClose: vi.fn(),
      onActioned: vi.fn(),
      authToken: "test-auth-token",
      ...overrides,
    };
    return { ...render(<RefundClaimReviewDialog {...props} />), props };
  }

  it("fetches claim on open and shows the dialog", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/cases/case-1/refund-claim",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-auth-token" }),
        }),
      );
    });
  });

  it("renders the dialog title", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Refund Claim Review")).toBeTruthy();
    });
  });

  it("shows 'Submitted' status badge after loading", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Submitted")).toBeTruthy();
    });
  });

  it("renders submitted claim entries with amount and chargedFor", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Activation fee")).toBeTruthy();
      // "500.00 USDT" appears in the entry row AND the total row
      expect(screen.getAllByText("500.00 USDT").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows the documentary recommendations sent to the user", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Please include a bank statement.")).toBeTruthy();
    });
  });

  it("shows the total row summing all entry amounts", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...sampleClaim,
        entries: [
          { amount: "300", chargedFor: "Fee A", date: "2026-01-10", txId: "", network: "", notes: "" },
          { amount: "200", chargedFor: "Fee B", date: "2026-01-11", txId: "", network: "", notes: "" },
        ],
      }),
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("500.00 USDT")).toBeTruthy();
    });
  });

  it("shows approve and reject buttons for submitted status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
      expect(screen.getByText("Reject")).toBeTruthy();
    });
  });

  it("calls POST /approve and fires onActioned + onClose on approval", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find(
        ([url]: any) => typeof url === "string" && url.includes("/approve")
      );
      expect(approveCall).toBeTruthy();
      expect(props.onActioned).toHaveBeenCalled();
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it("calls POST /reject and fires onActioned + onClose on rejection", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Reject")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Reject"));

    await waitFor(() => {
      const rejectCall = fetchMock.mock.calls.find(
        ([url]: any) => typeof url === "string" && url.includes("/reject")
      );
      expect(rejectCall).toBeTruthy();
      expect(props.onActioned).toHaveBeenCalled();
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it("sends adminNotes typed into the review notes textarea with the action", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/notes for the user/i);
    fireEvent.change(textarea, { target: { value: "All good. Approved." } });
    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find(
        ([url]: any) => typeof url === "string" && url.includes("/approve")
      );
      const body = JSON.parse((approveCall as any)[1].body);
      expect(body.adminNotes).toBe("All good. Approved.");
    });
  });

  it("disables both action buttons while an action is in-flight", async () => {
    let resolveAction!: () => void;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockReturnValueOnce(
        new Promise<any>((res) => {
          resolveAction = () => res({ ok: true, json: async () => ({ success: true }) });
        })
      );

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });

    const approveBtn = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    const rejectBtn = screen.getByText("Reject").closest("button") as HTMLButtonElement;

    fireEvent.click(approveBtn);

    expect(approveBtn.disabled).toBe(true);
    expect(rejectBtn.disabled).toBe(true);

    act(() => resolveAction());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("shows 'Claim approved' and download cert button for approved status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" }),
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Claim approved")).toBeTruthy();
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });
  });

  it("does NOT show approve/reject buttons for approved status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" }),
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Claim approved")).toBeTruthy();
    });

    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
  });

  it("shows admin notes on an approved claim", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...sampleClaim,
        status: "approved",
        adminNotes: "Refund confirmed by compliance.",
        reviewedAt: "2026-01-20T09:00:00Z",
      }),
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Refund confirmed by compliance.")).toBeTruthy();
    });
  });

  it("shows 'No entries submitted yet' when entries array is empty", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...sampleClaim, entries: [] }),
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("No entries submitted yet.")).toBeTruthy();
    });
  });

  it("shows the inline error banner (not the no-claim fallback) when fetch rejects with a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("claim-fetch-error")).toBeTruthy();
      expect(screen.getByText("Could not load claim")).toBeTruthy();
    });

    // The generic "no claim" message must NOT appear when there is a fetch error
    expect(screen.queryByText("No refund claim found for this case.")).toBeNull();
  });

  it("shows a destructive toast when the initial fetch rejects with a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not load refund claim",
          variant: "destructive",
        }),
      );
    });
  });

  it("shows the 'No refund claim found' fallback only when fetch succeeds with no claim (not on error)", async () => {
    // Simulate a successful response but with no claim data (null body resolves to null)
    // The component sets claim to whatever the JSON body is; if it's null-like we won't
    // reach the fetchError path. Here we test that a clean open with no prior error
    // shows the no-claim message, not the error banner.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => null });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("No refund claim found for this case.")).toBeTruthy();
    });

    expect(screen.queryByTestId("claim-fetch-error")).toBeNull();
  });

  it("re-triggers the fetch when the Retry button is clicked", async () => {
    // First attempt fails
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId("claim-fetch-error")).toBeTruthy();
    });

    // Second attempt succeeds
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("Submitted")).toBeTruthy();
      expect(screen.queryByTestId("claim-fetch-error")).toBeNull();
    });

    // fetch called twice: initial + retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the Close button and calls onClose when clicked", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleClaim });

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Refund Claim Review")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not fetch when open=false", () => {
    renderReview({ open: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows destructive toast, does NOT call onActioned/onClose, and re-enables buttons when approve returns non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Internal error" }) });

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });

    const approveBtn = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    const rejectBtn = screen.getByText("Reject").closest("button") as HTMLButtonElement;

    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    expect(props.onActioned).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    expect(approveBtn.disabled).toBe(false);
    expect(rejectBtn.disabled).toBe(false);
  });

  it("shows destructive toast, does NOT call onActioned/onClose, and re-enables buttons when reject returns non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "Unprocessable" }) });

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Reject")).toBeTruthy();
    });

    const approveBtn = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    const rejectBtn = screen.getByText("Reject").closest("button") as HTMLButtonElement;

    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    expect(props.onActioned).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    expect(approveBtn.disabled).toBe(false);
    expect(rejectBtn.disabled).toBe(false);
  });

  it("calls GET certificate endpoint with auth header, creates object URL, and triggers anchor click on Download Certificate", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };
    const fakeBlob = new Blob(["PDF content"], { type: "application/pdf" });
    const fakeObjectUrl = "blob:http://localhost/fake-cert-url";

    // First fetch: load claim; second fetch: download certificate (returns blob).
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: true, blob: async () => fakeBlob });

    const createObjectURLMock = vi.fn(() => fakeObjectUrl);
    const revokeObjectURLMock = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });

    const anchorClickMock = vi.fn();
    const fakeAnchor = { href: "", download: "", click: anchorClickMock } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return fakeAnchor;
      return originalCreateElement(tag);
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Download Certificate"));

    await waitFor(() => {
      // Asserts the correct endpoint was called with the Authorization header.
      const certCall = fetchMock.mock.calls.find(
        ([url]: any) => typeof url === "string" && url.includes("/refund-claim/certificate"),
      );
      expect(certCall).toBeTruthy();
      expect((certCall as any)[1]).toMatchObject({
        headers: expect.objectContaining({ Authorization: "Bearer test-auth-token" }),
      });

      // Asserts the blob was turned into an object URL.
      expect(createObjectURLMock).toHaveBeenCalledWith(fakeBlob);

      // Asserts the anchor's click() was triggered (i.e., download was initiated).
      expect(anchorClickMock).toHaveBeenCalled();
    });

    createElementSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does NOT trigger anchor click and re-enables the button when certificate endpoint returns an error", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };

    // First fetch: load claim; second fetch: certificate endpoint returns non-ok.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() });

    const anchorClickMock = vi.fn();
    const fakeAnchor = { href: "", download: "", click: anchorClickMock } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return fakeAnchor;
      return originalCreateElement(tag);
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    const downloadBtn = screen.getByText("Download Certificate").closest("button") as HTMLButtonElement;

    fireEvent.click(downloadBtn);

    // Button should be disabled while the fetch is in-flight.
    expect(downloadBtn.disabled).toBe(true);

    // After the failed response, the finally block must re-enable the button.
    await waitFor(() => {
      expect(downloadBtn.disabled).toBe(false);
    });

    // The anchor click must never have been triggered.
    expect(anchorClickMock).not.toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it("shows the inline cert error banner when the certificate endpoint returns a non-ok response", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Download Certificate"));

    await waitFor(() => {
      expect(screen.getByTestId("cert-download-error")).toBeTruthy();
      expect(screen.getByText("Download failed")).toBeTruthy();
    });

    // The download button must still be visible and re-enabled for retry.
    const downloadBtn = screen.getByText("Download Certificate").closest("button") as HTMLButtonElement;
    expect(downloadBtn.disabled).toBe(false);
  });

  it("shows the inline cert error banner when the certificate fetch rejects with a network error", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Download Certificate"));

    await waitFor(() => {
      expect(screen.getByTestId("cert-download-error")).toBeTruthy();
      expect(screen.getByText("Download failed")).toBeTruthy();
    });

    // Button must be re-enabled for retry.
    const downloadBtn = screen.getByText("Download Certificate").closest("button") as HTMLButtonElement;
    expect(downloadBtn.disabled).toBe(false);
  });

  it("dismisses the cert error banner when the × button is clicked", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Download Certificate"));

    await waitFor(() => {
      expect(screen.getByTestId("cert-download-error")).toBeTruthy();
    });

    // Click the dismiss button (aria-label="Dismiss error").
    fireEvent.click(screen.getByLabelText("Dismiss error"));

    await waitFor(() => {
      expect(screen.queryByTestId("cert-download-error")).toBeNull();
    });
  });

  it("clears the cert error banner when a subsequent download attempt is started", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };
    const fakeBlob = new Blob(["PDF"], { type: "application/pdf" });

    // First attempt fails; second attempt succeeds.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() })
      .mockResolvedValueOnce({ ok: true, blob: async () => fakeBlob });

    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    const fakeAnchor = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return fakeAnchor;
      return originalCreateElement(tag);
    });

    renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    // First click — triggers the error banner.
    fireEvent.click(screen.getByText("Download Certificate"));
    await waitFor(() => {
      expect(screen.getByTestId("cert-download-error")).toBeTruthy();
    });

    // Second click — banner should disappear while in-flight.
    fireEvent.click(screen.getByText("Download Certificate"));
    await waitFor(() => {
      expect(screen.queryByTestId("cert-download-error")).toBeNull();
    });

    createElementSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("clears the cert error banner when the dialog is closed and re-opened", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, blob: async () => new Blob() });

    const { rerender, props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Download Certificate"));

    await waitFor(() => {
      expect(screen.getByTestId("cert-download-error")).toBeTruthy();
    });

    // Close the dialog.
    rerender(<RefundClaimReviewDialog {...props} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();

    // Re-open the dialog (fetching the claim again); the stale banner must not reappear.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => approvedClaim });
    rerender(<RefundClaimReviewDialog {...props} open={true} />);

    await waitFor(() => {
      expect(screen.getByText("Download Certificate")).toBeTruthy();
    });

    expect(screen.queryByTestId("cert-download-error")).toBeNull();
  });

  it("shows destructive toast, does NOT call onActioned/onClose, and re-enables buttons when approve fetch rejects with a network error", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeTruthy();
    });

    const approveBtn = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    const rejectBtn = screen.getByText("Reject").closest("button") as HTMLButtonElement;

    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    expect(props.onActioned).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    expect(approveBtn.disabled).toBe(false);
    expect(rejectBtn.disabled).toBe(false);
  });

  it("shows destructive toast, does NOT call onActioned/onClose, and re-enables buttons when reject fetch rejects with a network error", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    const { props } = renderReview();

    await waitFor(() => {
      expect(screen.getByText("Reject")).toBeTruthy();
    });

    const approveBtn = screen.getByText("Approve").closest("button") as HTMLButtonElement;
    const rejectBtn = screen.getByText("Reject").closest("button") as HTMLButtonElement;

    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    expect(props.onActioned).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    expect(approveBtn.disabled).toBe(false);
    expect(rejectBtn.disabled).toBe(false);
  });

  // ── Inline action-error banner tests ──────────────────────────────────────

  it("shows the inline action-error banner when approve returns non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    renderReview();

    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());

    fireEvent.click(screen.getByText("Approve").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("shows the inline action-error banner when reject returns non-ok", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}) });

    renderReview();

    await waitFor(() => expect(screen.getByText("Reject")).toBeTruthy());

    fireEvent.click(screen.getByText("Reject").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("shows the inline action-error banner when approve fetch rejects with a network error", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());

    fireEvent.click(screen.getByText("Approve").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("shows the inline action-error banner when reject fetch rejects with a network error", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => expect(screen.getByText("Reject")).toBeTruthy());

    fireEvent.click(screen.getByText("Reject").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("shows the inline action-error banner when unapprove returns non-ok", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    renderReview();

    await waitFor(() => expect(screen.getByText("Unapprove")).toBeTruthy());

    fireEvent.click(screen.getByText("Unapprove").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("shows the inline action-error banner when unapprove fetch rejects with a network error", async () => {
    const approvedClaim = { ...sampleClaim, status: "approved", reviewedAt: "2026-01-20T09:00:00Z" };
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => approvedClaim })
      .mockRejectedValueOnce(new Error("Network error"));

    renderReview();

    await waitFor(() => expect(screen.getByText("Unapprove")).toBeTruthy());

    fireEvent.click(screen.getByText("Unapprove").closest("button")!);

    await waitFor(() => {
      expect(screen.getByTestId("action-error-banner")).toBeTruthy();
      expect(screen.getByText("Action failed")).toBeTruthy();
    });
  });

  it("clears the inline action-error banner when a new action is attempted", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const { props } = renderReview();

    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());

    // First attempt fails → banner appears
    fireEvent.click(screen.getByText("Approve").closest("button")!);
    await waitFor(() => expect(screen.getByTestId("action-error-banner")).toBeTruthy());

    // Second attempt succeeds → banner gone, dialog closes
    fireEvent.click(screen.getByText("Approve").closest("button")!);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());

    expect(screen.queryByTestId("action-error-banner")).toBeNull();
  });

  it("dismisses the inline action-error banner when the ✕ button is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => sampleClaim })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    renderReview();

    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());

    fireEvent.click(screen.getByText("Approve").closest("button")!);

    await waitFor(() => expect(screen.getByTestId("action-error-banner")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Dismiss"));

    await waitFor(() => expect(screen.queryByTestId("action-error-banner")).toBeNull());
  });
});
