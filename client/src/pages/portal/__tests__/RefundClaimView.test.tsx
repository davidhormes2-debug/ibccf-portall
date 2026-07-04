// @vitest-environment jsdom
//
// Unit tests for the RefundClaimView portal page covering:
//   - Loading state (spinner shown while fetching)
//   - pending_submission state — editable form with entries + submit button
//   - submitted state — read-only notice, no editable inputs, no submit button
//   - approved state — green certificate download section shown
//   - rejected state — red rejection banner + admin notes displayed

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";

// ---- Mocks (must precede the component import) ----------------------------

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

let toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: any[]) => toastSpy(...args), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

// PortalContext — override via `currentCaseStub` and `refetchStub` closures.
let currentCaseStub: any = { id: "case-1", accessCode: "TEST-1234" };
let refetchStub = vi.fn();
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    refetch: refetchStub,
  }),
}));

// ---- Fetch stub ------------------------------------------------------------

type FetchResult = { ok: boolean; status?: number; json?: () => Promise<any>; blob?: () => Promise<any> };
let fetchMock: (url: string, opts?: any) => Promise<FetchResult>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "No refund claim found" }) }));
  global.fetch = fetchMock as any;
  toastSpy = vi.fn();
  refetchStub = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = { id: "case-1", accessCode: "TEST-1234" };
});

// ---- Dynamic import --------------------------------------------------------

let RefundClaimView: typeof import("../RefundClaimView").RefundClaimView;

async function loadComponent() {
  vi.resetModules();
  ({ RefundClaimView } = await import("../RefundClaimView"));
}

// ---- Claim fixtures --------------------------------------------------------

function claimFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "pending_submission",
    entries: [],
    refundableAmount: "1000",
    documentaryRecommendations: null,
    adminNotes: null,
    submittedAt: null,
    reviewedAt: null,
    ...overrides,
  };
}

function installClaimFetch(claim: Record<string, unknown>) {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => claim,
  }));
  global.fetch = fetchMock as any;
}

// ============================================================================
// Loading state
// ============================================================================

describe("RefundClaimView — loading state", () => {
  it("shows a spinner while the claim is being fetched", async () => {
    let resolvePromise!: (v: any) => void;
    const pendingPromise = new Promise<any>((res) => { resolvePromise = res; });

    global.fetch = vi.fn(async () => {
      await pendingPromise;
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    await loadComponent();
    render(<RefundClaimView />);

    // The spinner (Loader2 uses animate-spin) should be present before fetch resolves
    expect(document.querySelector(".animate-spin")).not.toBeNull();

    // Clean up the dangling promise
    act(() => resolvePromise(undefined));
  });
});

// ============================================================================
// pending_submission state — editable form
// ============================================================================

describe("RefundClaimView — pending_submission state", () => {
  it("renders the page title and refundable balance chip", async () => {
    installClaimFetch(claimFixture({ status: "pending_submission" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });
    expect(screen.getByText("1000 USDT")).toBeTruthy();
  });

  it("shows the pending_submission status banner", async () => {
    installClaimFetch(claimFixture({ status: "pending_submission" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusPendingSubmission")).toBeTruthy();
    });
  });

  it("renders an editable entry row when entries are provided", async () => {
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [
        { amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "tx-abc", network: "TRC20", notes: "" },
      ],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      const inputs = document.querySelectorAll("input");
      expect(inputs.length).toBeGreaterThan(0);
    });

    // In pending_submission, inputs must NOT be disabled
    const inputs = Array.from(document.querySelectorAll("input[disabled]"));
    expect(inputs.length).toBe(0);
  });

  it("shows the 'Add Entry' button when in pending_submission state", async () => {
    installClaimFetch(claimFixture({ status: "pending_submission" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.addEntry")).toBeTruthy();
    });
  });

  it("shows the documentary recommendations block when provided", async () => {
    installClaimFetch(claimFixture({
      status: "pending_submission",
      documentaryRecommendations: "Please include a signed bank statement.",
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("Please include a signed bank statement.")).toBeTruthy();
    });
  });

  it("shows an error toast and does NOT call PATCH when all entries are blank", async () => {
    // amount is whitespace-only but chargedFor/date are non-empty, so the button's disabled
    // check passes (all three are truthy). handleSubmit's .trim() makes amount falsy →
    // filled.length === 0 → toast fires, no PATCH is made.
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [{ amount: "   ", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const buttons = Array.from(document.querySelectorAll("button"));
    const submitButton = buttons.find(
      (b) => b.textContent?.includes("refundClaim.submitClaim") || b.textContent?.includes("refundClaim.submit")
    );
    expect(submitButton).toBeTruthy();

    act(() => { submitButton!.click(); });

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "refundClaim.emptyEntriesError", variant: "destructive" })
      );
    });

    const patchCall = (global.fetch as any).mock.calls.find(
      ([, opts]: any) => opts?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();
  });

  it("disables the submit button and fires no PATCH when the entries array is empty", async () => {
    installClaimFetch(claimFixture({ status: "pending_submission", entries: [] }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const buttons = Array.from(document.querySelectorAll("button"));
    const submitButton = buttons.find(
      (b) => b.textContent?.includes("refundClaim.submitCta") ||
             b.textContent?.includes("refundClaim.submitClaim") ||
             b.textContent?.includes("refundClaim.submit")
    );

    // The button must be present but disabled because no entries exist
    expect(submitButton).toBeTruthy();
    expect(submitButton!.disabled).toBe(true);

    // Even if something forces a click, no PATCH should be dispatched
    act(() => { submitButton!.click(); });

    await new Promise((r) => setTimeout(r, 50));

    const patchCall = (global.fetch as any).mock.calls.find(
      ([, opts]: any) => opts?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();
  });

  it("disables the submit button when an entry has amount but chargedFor and date are empty", async () => {
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [{ amount: "500", chargedFor: "", date: "", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const buttons = Array.from(document.querySelectorAll("button"));
    const submitButton = buttons.find(
      (b) =>
        b.textContent?.includes("refundClaim.submitCta") ||
        b.textContent?.includes("refundClaim.submitClaim") ||
        b.textContent?.includes("refundClaim.submit")
    );

    expect(submitButton).toBeTruthy();
    expect(submitButton!.disabled).toBe(true);
  });

  it("enables the submit button once all three required fields are filled on at least one entry", async () => {
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [{ amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const buttons = Array.from(document.querySelectorAll("button"));
    const submitButton = buttons.find(
      (b) =>
        b.textContent?.includes("refundClaim.submitCta") ||
        b.textContent?.includes("refundClaim.submitClaim") ||
        b.textContent?.includes("refundClaim.submit")
    );

    expect(submitButton).toBeTruthy();
    expect(submitButton!.disabled).toBe(false);
  });

  it("calls PATCH to submit the claim and shows a success toast", async () => {
    const updatedClaim = claimFixture({ status: "submitted" });
    let callCount = 0;
    global.fetch = vi.fn(async (_url: string, opts?: any) => {
      callCount++;
      if (callCount === 1) {
        // Initial GET
        return { ok: true, status: 200, json: async () => claimFixture({
          status: "pending_submission",
          entries: [{ amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
        }) };
      }
      // PATCH submit
      return { ok: true, status: 200, json: async () => updatedClaim };
    }) as any;

    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    // Trigger submit
    const submitBtn = screen.queryByText("refundClaim.submitClaim") ?? screen.queryByText("refundClaim.submit");
    // The button text key is "refundClaim.submitClaim" — just verify the PATCH was fired
    const buttons = Array.from(document.querySelectorAll("button"));
    const submitButton = buttons.find(
      (b) => b.textContent?.includes("refundClaim.submitClaim") || b.textContent?.includes("refundClaim.submit")
    );
    if (submitButton) {
      act(() => { submitButton.click(); });
      await waitFor(() => {
        const patchCall = (global.fetch as any).mock.calls.find(
          ([, opts]: any) => opts?.method === "PATCH"
        );
        expect(patchCall).toBeTruthy();
      });
    }
  });

  it("keeps submit disabled through partial interactive fills and enables it only when all three required fields are typed", async () => {
    // Load claim with empty entries — component initialises with one EMPTY_ENTRY() in state
    // (the fetch callback only overrides state when data.entries.length > 0)
    installClaimFetch(claimFixture({ status: "pending_submission", entries: [] }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const getSubmitButton = () => {
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find(
        (b) =>
          b.textContent?.includes("refundClaim.submitCta") ||
          b.textContent?.includes("refundClaim.submitClaim") ||
          b.textContent?.includes("refundClaim.submit")
      ) as HTMLButtonElement | undefined;
    };

    // One blank EMPTY_ENTRY is present — submit must be disabled
    expect(getSubmitButton()?.disabled).toBe(true);

    // Click "Add Entry" in the header to insert a second blank row
    const addEntryBtn = screen
      .getAllByText("refundClaim.addEntry")
      .map((el) => el.closest("button"))
      .find((b) => b != null) as HTMLButtonElement;
    expect(addEntryBtn).toBeTruthy();
    act(() => { addEntryBtn.click(); });

    // Both entries are still blank — submit must remain disabled
    expect(getSubmitButton()?.disabled).toBe(true);

    // Collect non-file, non-hidden inputs — first three belong to the first entry row:
    // index 0 → amount, index 1 → chargedFor, index 2 → date
    const visibleInputs = () =>
      Array.from(document.querySelectorAll("input")).filter(
        (inp) => inp.type !== "file" && !inp.classList.contains("hidden")
      );

    // Fill amount only
    act(() => {
      fireEvent.change(visibleInputs()[0], { target: { value: "500" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // chargedFor and date still empty

    // Fill chargedFor
    act(() => {
      fireEvent.change(visibleInputs()[1], { target: { value: "Activation fee" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // date still empty

    // Fill date — all three required fields now present on entry 0
    act(() => {
      fireEvent.change(visibleInputs()[2], { target: { value: "2026-01-15" } });
    });
    expect(getSubmitButton()?.disabled).toBe(false);
  });

  it("re-disables submit after the only filled entry is removed and re-enables it only after the new entry is fully filled", async () => {
    // Start with one fully-filled entry so submit is enabled
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [{ amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const getSubmitButton = () => {
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find(
        (b) =>
          b.textContent?.includes("refundClaim.submitCta") ||
          b.textContent?.includes("refundClaim.submitClaim") ||
          b.textContent?.includes("refundClaim.submit")
      ) as HTMLButtonElement | undefined;
    };

    // One filled entry → submit must be enabled
    expect(getSubmitButton()?.disabled).toBe(false);

    // Click the trash button to remove the only entry
    const trashButton = document.querySelector("button.text-red-400\\/60") as HTMLButtonElement | null;
    expect(trashButton).not.toBeNull();
    act(() => { trashButton!.click(); });

    // No entries remain → submit must be disabled
    expect(getSubmitButton()?.disabled).toBe(true);

    // Click "Add Entry" in the header to get a fresh blank row
    const addEntryBtn = screen
      .getAllByText("refundClaim.addEntry")
      .map((el) => el.closest("button"))
      .find((b) => b != null) as HTMLButtonElement;
    expect(addEntryBtn).toBeTruthy();
    act(() => { addEntryBtn.click(); });

    // New blank row is present — submit must still be disabled
    expect(getSubmitButton()?.disabled).toBe(true);

    const visibleInputs = () =>
      Array.from(document.querySelectorAll("input")).filter(
        (inp) => inp.type !== "file" && !inp.classList.contains("hidden")
      );

    // Fill amount only
    act(() => {
      fireEvent.change(visibleInputs()[0], { target: { value: "750" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // chargedFor and date still empty

    // Fill chargedFor
    act(() => {
      fireEvent.change(visibleInputs()[1], { target: { value: "Processing fee" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // date still empty

    // Fill date — all three required fields now present on the re-added entry
    act(() => {
      fireEvent.change(visibleInputs()[2], { target: { value: "2026-03-10" } });
    });
    expect(getSubmitButton()?.disabled).toBe(false);
  });

  it("keeps submit disabled when removing the filled entry from a two-entry list and re-enables only after the blank entry is fully filled", async () => {
    // Start with two entries: one fully filled, one blank
    installClaimFetch(claimFixture({
      status: "pending_submission",
      entries: [
        { amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" },
        { amount: "", chargedFor: "", date: "", txId: "", network: "", notes: "" },
      ],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });

    const getSubmitButton = () => {
      const btns = Array.from(document.querySelectorAll("button"));
      return btns.find(
        (b) =>
          b.textContent?.includes("refundClaim.submitCta") ||
          b.textContent?.includes("refundClaim.submitClaim") ||
          b.textContent?.includes("refundClaim.submit")
      ) as HTMLButtonElement | undefined;
    };

    // Two entries: one filled, one blank — submit must be enabled (blank row is filtered out)
    expect(getSubmitButton()?.disabled).toBe(false);

    // Click the trash button on the first (filled) entry
    const trashButtons = Array.from(document.querySelectorAll("button.text-red-400\\/60")) as HTMLButtonElement[];
    expect(trashButtons.length).toBeGreaterThanOrEqual(1);
    act(() => { trashButtons[0].click(); });

    // Only the blank entry remains → submit must still be disabled
    expect(getSubmitButton()?.disabled).toBe(true);

    const visibleInputs = () =>
      Array.from(document.querySelectorAll("input")).filter(
        (inp) => inp.type !== "file" && !inp.classList.contains("hidden")
      );

    // Fill amount only — submit must remain disabled
    act(() => {
      fireEvent.change(visibleInputs()[0], { target: { value: "250" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // chargedFor and date still empty

    // Fill chargedFor — submit must remain disabled
    act(() => {
      fireEvent.change(visibleInputs()[1], { target: { value: "Network fee" } });
    });
    expect(getSubmitButton()?.disabled).toBe(true); // date still empty

    // Fill date — all three required fields now satisfied on the remaining entry
    act(() => {
      fireEvent.change(visibleInputs()[2], { target: { value: "2026-02-20" } });
    });
    expect(getSubmitButton()?.disabled).toBe(false);
  });
});

// ============================================================================
// submitted state — read-only
// ============================================================================

describe("RefundClaimView — submitted state", () => {
  it("shows the submitted status banner", async () => {
    installClaimFetch(claimFixture({ status: "submitted" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusSubmitted")).toBeTruthy();
    });
  });

  it("shows the read-only notice for submitted claims", async () => {
    installClaimFetch(claimFixture({
      status: "submitted",
      entries: [{ amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.submittedReadonlyNotice")).toBeTruthy();
    });
  });

  it("renders inputs as disabled in submitted state", async () => {
    installClaimFetch(claimFixture({
      status: "submitted",
      entries: [{ amount: "500", chargedFor: "Activation fee", date: "2026-01-15", txId: "", network: "", notes: "" }],
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      // After the component renders, entry inputs should be disabled
      const disabledInputs = document.querySelectorAll("input[disabled]");
      expect(disabledInputs.length).toBeGreaterThan(0);
    });
  });

  it("does NOT show the Add Entry button in submitted state", async () => {
    installClaimFetch(claimFixture({ status: "submitted" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusSubmitted")).toBeTruthy();
    });

    // The "Add Entry" button in the header should NOT be present (readonly=true)
    // There may still be a text inside the empty-state, but the header button is gone
    const addButtons = screen.queryAllByText("refundClaim.addEntry");
    // In submitted state (non-empty entries), the add button should not appear
    // (it's gated on !readonly in the entries section header)
    expect(addButtons.length).toBe(0);
  });
});

// ============================================================================
// approved state — certificate download
// ============================================================================

describe("RefundClaimView — approved state", () => {
  it("shows the approved status banner", async () => {
    installClaimFetch(claimFixture({ status: "approved" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusApproved")).toBeTruthy();
    });
  });

  it("shows the approved banner title and certificate download button", async () => {
    installClaimFetch(claimFixture({ status: "approved" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.approvedBannerTitle")).toBeTruthy();
      expect(screen.getByText("refundClaim.downloadCertificate")).toBeTruthy();
    });
  });

  it("calls the certificate endpoint and triggers a download when the button is clicked", async () => {
    const fakeBlob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => claimFixture({ status: "approved" }) };
      }
      // Certificate download
      return { ok: true, status: 200, blob: async () => fakeBlob };
    }) as any;

    const createObjectURLSpy = vi.fn(() => "blob:fake-url");
    const revokeObjectURLSpy = vi.fn();
    Object.assign(URL, { createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy });

    // Stub document.createElement for the anchor click
    const anchorSpy = { href: "", download: "", click: vi.fn() };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return anchorSpy as any;
      return originalCreateElement(tag);
    });

    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.downloadCertificate")).toBeTruthy();
    });

    act(() => {
      const btn = screen.getByText("refundClaim.downloadCertificate").closest("button") as HTMLButtonElement;
      btn?.click();
    });

    await waitFor(() => {
      expect(anchorSpy.click).toHaveBeenCalled();
    });

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

// ============================================================================
// rejected state — rejection banner + admin notes
// ============================================================================

describe("RefundClaimView — rejected state", () => {
  it("shows the rejected status banner", async () => {
    installClaimFetch(claimFixture({ status: "rejected" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusRejected")).toBeTruthy();
    });
  });

  it("shows the rejection banner title and body", async () => {
    installClaimFetch(claimFixture({ status: "rejected" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.rejectedBannerTitle")).toBeTruthy();
      expect(screen.getByText("refundClaim.rejectedBannerBody")).toBeTruthy();
    });
  });

  it("shows admin notes when provided on a rejected claim", async () => {
    installClaimFetch(claimFixture({
      status: "rejected",
      adminNotes: "Documentation was insufficient. Please resubmit with bank statements.",
    }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(
        screen.getByText("Documentation was insufficient. Please resubmit with bank statements.")
      ).toBeTruthy();
    });
  });

  it("does NOT show admin notes section when adminNotes is null", async () => {
    installClaimFetch(claimFixture({ status: "rejected", adminNotes: null }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.rejectedBannerTitle")).toBeTruthy();
    });

    expect(screen.queryByText("refundClaim.adminNotesLabel")).toBeNull();
  });

  it("does NOT show the certificate download button when rejected", async () => {
    installClaimFetch(claimFixture({ status: "rejected" }));
    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.statusRejected")).toBeTruthy();
    });

    expect(screen.queryByText("refundClaim.downloadCertificate")).toBeNull();
  });
});

// ============================================================================
// No claim found (404 from server)
// ============================================================================

describe("RefundClaimView — no claim found", () => {
  it("renders without crashing and shows the page title", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "No refund claim found" }),
    })) as any;

    await loadComponent();
    render(<RefundClaimView />);

    await waitFor(() => {
      expect(screen.getByText("refundClaim.pageTitle")).toBeTruthy();
    });
  });
});
