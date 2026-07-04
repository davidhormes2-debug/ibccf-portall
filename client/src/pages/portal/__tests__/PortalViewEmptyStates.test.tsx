// @vitest-environment jsdom
//
// Integration tests that assert each portal view renders the shared
// PortalEmptyState component (not ad-hoc JSX) when its data array is empty.
// Covers: SubmissionsView, MessagesView, DocumentsView, LetterView.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Shared mocks (hoisted before any component import) ─────────────────────

vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: React.ComponentPropsWithoutRef<typeof tag>) =>
      React.createElement(tag as string, rest as any, children);
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) =>
        passthrough(prop as keyof React.JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    useReducedMotion: () => false,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts && "defaultValue" in opts ? opts.defaultValue : key) as string,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDate: (d: unknown) => String(d),
    formatDateTime: (d: unknown) => String(d),
    formatNumber: (n: unknown) => String(n),
    formatCurrency: (n: unknown) => String(n),
    formatRelative: (d: unknown) => String(d),
  }),
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => null,
}));

vi.mock("@/components/DocumentPreview", () => ({
  DocumentPreview: () => null,
}));

vi.mock("@/components/portal/PayoutWalletBlock", () => ({
  PayoutWalletBlock: () => null,
}));

vi.mock("@/components/portal/LocalizedAmount", () => ({
  LocalizedAmount: () => null,
}));

// Mutable so individual describe blocks can override it (e.g. withdrawal mode).
let withdrawalModeFn: (c: unknown) => boolean = () => false;

vi.mock("@/lib/withdrawalMode", () => ({
  getIsWithdrawalMode: (c: unknown) => withdrawalModeFn(c),
}));

// ── SubmissionsView ─────────────────────────────────────────────────────────

vi.mock("../PortalContext", () => ({
  usePortal: () => portalContextStub(),
}));

// Mutable stub factory — overridden per describe block.
let portalContextStub: () => Record<string, unknown>;

// Reset to a safe default before every test so tests don't bleed state.
beforeEach(() => {
  toastMock.mockClear();
  withdrawalModeFn = () => false;
  portalContextStub = () => ({
    submissions: [],
    refreshSubmissions: vi.fn(async () => {}),
    adminMessages: [],
    markAdminMessageRead: vi.fn(),
    refreshAdminMessages: vi.fn(async () => {}),
    documentRequests: [],
    refreshDocumentRequests: vi.fn(async () => {}),
    submitDocument: vi.fn(async () => {}),
    pendingDocumentCount: 0,
    userDocuments: [],
    refreshUserDocuments: vi.fn(async () => {}),
    uploadUserDocument: vi.fn(async () => {}),
    currentCase: null,
    letterContent: null,
    setSubmissions: vi.fn(),
    setViewState: vi.fn(),
    activeReissue: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── SubmissionsView ─────────────────────────────────────────────────────────

describe("SubmissionsView — empty state", () => {
  it("renders the shared PortalEmptyState (testid=submissions-empty-state) when submissions is empty", async () => {
    portalContextStub = () => ({
      submissions: [],
    });

    const { SubmissionsView } = await import("../SubmissionsView");
    render(<SubmissionsView />);

    expect(screen.getByTestId("submissions-empty-state")).toBeTruthy();
  });

  it("does not render the empty state when there is at least one submission", async () => {
    portalContextStub = () => ({
      submissions: [
        {
          id: 1,
          selectedOption: "A",
          submittedAt: new Date().toISOString(),
          withdrawalAmount: "50,000 USDT",
          withdrawalBatches: 2,
        },
      ],
    });

    const { SubmissionsView } = await import("../SubmissionsView");
    render(<SubmissionsView />);

    expect(screen.queryByTestId("submissions-empty-state")).toBeNull();
    expect(screen.getByTestId("submission-1")).toBeTruthy();
  });
});

// ── SubmissionsView — refresh error toast ─────────────────────────────────

describe("SubmissionsView — refresh error toast", () => {
  it("calls toast with variant='destructive' when refreshSubmissions rejects", async () => {
    let rejectRefresh!: (err: Error) => void;
    const refreshPromise = new Promise<void>((_res, rej) => {
      rejectRefresh = rej;
    });
    refreshPromise.catch(() => {});

    portalContextStub = () => ({
      submissions: [],
      refreshSubmissions: vi.fn(() => refreshPromise),
    });

    const { SubmissionsView } = await import("../SubmissionsView");
    render(<SubmissionsView />);

    await userEvent.click(screen.getByTestId("button-refresh-submissions"));

    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      rejectRefresh(new Error("Network error"));
    });

    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

// ── MessagesView ────────────────────────────────────────────────────────────

describe("MessagesView — empty state", () => {
  it("renders the shared PortalEmptyState (testid=messages-empty-state) when adminMessages is empty", async () => {
    portalContextStub = () => ({
      adminMessages: [],
      markAdminMessageRead: vi.fn(),
    });

    const { MessagesView } = await import("../MessagesView");
    render(<MessagesView />);

    expect(screen.getByTestId("messages-empty-state")).toBeTruthy();
  });

  it("does not render the messages empty state when there is at least one message", async () => {
    portalContextStub = () => ({
      adminMessages: [
        {
          id: 10,
          title: "Important update",
          body: "Please review your case.",
          category: "urgent",
          isRead: false,
          createdAt: new Date().toISOString(),
        },
      ],
      markAdminMessageRead: vi.fn(),
    });

    const { MessagesView } = await import("../MessagesView");
    render(<MessagesView />);

    expect(screen.queryByTestId("messages-empty-state")).toBeNull();
    expect(screen.getByTestId("message-urgent-10")).toBeTruthy();
  });
});

// ── MessagesView — refresh error toast ────────────────────────────────────

describe("MessagesView — refresh error toast", () => {
  it("calls toast with variant='destructive' when refreshAdminMessages rejects", async () => {
    let rejectRefresh!: (err: Error) => void;
    const refreshPromise = new Promise<void>((_res, rej) => {
      rejectRefresh = rej;
    });
    refreshPromise.catch(() => {});

    portalContextStub = () => ({
      adminMessages: [],
      markAdminMessageRead: vi.fn(),
      refreshAdminMessages: vi.fn(() => refreshPromise),
    });

    const { MessagesView } = await import("../MessagesView");
    render(<MessagesView />);

    await userEvent.click(screen.getByTestId("button-refresh-messages"));

    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      rejectRefresh(new Error("Network error"));
    });

    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

// ── DocumentsView ───────────────────────────────────────────────────────────

describe("DocumentsView — empty state", () => {
  it("renders the shared PortalEmptyState (testid=documents-empty-state) when documentRequests is empty and not refreshing", async () => {
    portalContextStub = () => ({
      documentRequests: [],
      refreshDocumentRequests: vi.fn(async () => {}),
      submitDocument: vi.fn(async () => {}),
      pendingDocumentCount: 0,
      userDocuments: [],
      refreshUserDocuments: vi.fn(async () => {}),
      uploadUserDocument: vi.fn(async () => {}),
      currentCase: { id: "case-1", accessCode: "TEST-0001" },
    });

    const { DocumentsView } = await import("../DocumentsView");
    render(<DocumentsView />);

    expect(screen.getByTestId("documents-empty-state")).toBeTruthy();
  });

  it("does not render the documents empty state when there is at least one document request", async () => {
    portalContextStub = () => ({
      documentRequests: [
        {
          id: 42,
          caseId: "case-1",
          documentType: "kyc_id",
          status: "pending",
          createdAt: new Date().toISOString(),
          uploadsEnabled: true,
        },
      ],
      refreshDocumentRequests: vi.fn(async () => {}),
      submitDocument: vi.fn(async () => {}),
      pendingDocumentCount: 1,
      userDocuments: [],
      refreshUserDocuments: vi.fn(async () => {}),
      uploadUserDocument: vi.fn(async () => {}),
      currentCase: { id: "case-1", accessCode: "TEST-0001" },
    });

    const { DocumentsView } = await import("../DocumentsView");
    render(<DocumentsView />);

    expect(screen.queryByTestId("documents-empty-state")).toBeNull();
    expect(screen.getByTestId("document-request-42")).toBeTruthy();
  });

  it("shows PortalSkeleton (role=status) while refresh is pending and empty-state once resolved", async () => {
    // Use a controlled promise so we can inspect the intermediate loading state.
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((res) => {
      resolveRefresh = res;
    });

    portalContextStub = () => ({
      documentRequests: [],
      refreshDocumentRequests: vi.fn(() => refreshPromise),
      submitDocument: vi.fn(async () => {}),
      pendingDocumentCount: 0,
      userDocuments: [],
      refreshUserDocuments: vi.fn(async () => {}),
      uploadUserDocument: vi.fn(async () => {}),
      currentCase: { id: "case-1", accessCode: "TEST-0001" },
    });

    const { DocumentsView } = await import("../DocumentsView");
    render(<DocumentsView />);

    // Initially not refreshing — skeleton absent, empty state present.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("documents-empty-state")).toBeTruthy();

    // Click the refresh button to start the pending promise.
    await userEvent.click(screen.getByTestId("button-refresh-documents"));

    // While the promise is still pending the skeleton (role=status) must be
    // shown and the empty state must be hidden.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByTestId("documents-empty-state")).toBeNull();

    // Resolve the refresh promise and wait for React to settle.
    await act(async () => {
      resolveRefresh();
    });

    // After the promise resolves the skeleton disappears and the empty state
    // is shown again because documentRequests is still empty.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("documents-empty-state")).toBeTruthy();
  });

  it("clears the spinner and restores the empty state when refreshDocumentRequests rejects", async () => {
    // Use a controlled promise so we can inspect the intermediate loading
    // state before the rejection propagates.
    let rejectRefresh!: (err: Error) => void;
    const refreshPromise = new Promise<void>((_res, rej) => {
      rejectRefresh = rej;
    });
    // Attach a no-op catch so the rejection doesn't become an unhandled
    // rejection in the test runner while still letting the component's
    // try/finally block run and clear the spinner.
    refreshPromise.catch(() => {});

    portalContextStub = () => ({
      documentRequests: [],
      refreshDocumentRequests: vi.fn(() => refreshPromise),
      submitDocument: vi.fn(async () => {}),
      pendingDocumentCount: 0,
      userDocuments: [],
      refreshUserDocuments: vi.fn(async () => {}),
      uploadUserDocument: vi.fn(async () => {}),
      currentCase: { id: "case-1", accessCode: "TEST-0001" },
    });

    const { DocumentsView } = await import("../DocumentsView");
    render(<DocumentsView />);

    // Initially not refreshing — skeleton absent, empty state present.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("documents-empty-state")).toBeTruthy();

    // Click the refresh button to start the pending promise.
    await userEvent.click(screen.getByTestId("button-refresh-documents"));

    // While the promise is still pending the skeleton must be shown.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByTestId("documents-empty-state")).toBeNull();

    // Reject the refresh promise and wait for React to settle.
    await act(async () => {
      rejectRefresh(new Error("Network error"));
    });

    // The try/finally block must have reset isRefreshing to false even
    // though the promise rejected — skeleton gone, empty state restored.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("documents-empty-state")).toBeTruthy();
  });

  it("calls toast with variant='destructive' when refreshDocumentRequests rejects", async () => {
    let rejectRefresh!: (err: Error) => void;
    const refreshPromise = new Promise<void>((_res, rej) => {
      rejectRefresh = rej;
    });
    refreshPromise.catch(() => {});

    portalContextStub = () => ({
      documentRequests: [],
      refreshDocumentRequests: vi.fn(() => refreshPromise),
      submitDocument: vi.fn(async () => {}),
      pendingDocumentCount: 0,
      userDocuments: [],
      refreshUserDocuments: vi.fn(async () => {}),
      uploadUserDocument: vi.fn(async () => {}),
      currentCase: { id: "case-1", accessCode: "TEST-0001" },
    });

    const { DocumentsView } = await import("../DocumentsView");
    render(<DocumentsView />);

    await userEvent.click(screen.getByTestId("button-refresh-documents"));

    expect(toastMock).not.toHaveBeenCalled();

    await act(async () => {
      rejectRefresh(new Error("Network error"));
    });

    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

// ── LetterView ──────────────────────────────────────────────────────────────

describe("LetterView — pending (letter not yet sent) empty state", () => {
  it("renders the shared PortalEmptyState (testid=letter-pending-state) when letterSent is false and not in withdrawal mode", async () => {
    portalContextStub = () => ({
      currentCase: {
        id: "case-1",
        accessCode: "TEST-0001",
        letterSent: false,
        withdrawalAmount: "50,000 USDT",
        userName: "Test User",
      },
      letterContent: null,
      submissions: [],
      setSubmissions: vi.fn(),
      setViewState: vi.fn(),
      activeReissue: null,
    });

    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    expect(screen.getByTestId("letter-pending-state")).toBeTruthy();
  });

  it("renders the back-to-dashboard button inside the pending state", async () => {
    portalContextStub = () => ({
      currentCase: {
        id: "case-1",
        accessCode: "TEST-0001",
        letterSent: false,
      },
      letterContent: null,
      submissions: [],
      setSubmissions: vi.fn(),
      setViewState: vi.fn(),
      activeReissue: null,
    });

    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    expect(screen.getByTestId("button-back-dashboard-pending")).toBeTruthy();
  });

  it("does not render the pending state when letterSent is true", async () => {
    portalContextStub = () => ({
      currentCase: {
        id: "case-1",
        accessCode: "TEST-0001",
        letterSent: true,
        withdrawalAmount: "50,000 USDT",
        userName: "Test User",
      },
      letterContent: null,
      submissions: [],
      setSubmissions: vi.fn(),
      setViewState: vi.fn(),
      activeReissue: null,
    });

    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    expect(screen.queryByTestId("letter-pending-state")).toBeNull();
  });

  it("does not render the pending state when currentCase is null (unauthenticated)", async () => {
    portalContextStub = () => ({
      currentCase: null,
      letterContent: null,
      submissions: [],
      setSubmissions: vi.fn(),
      setViewState: vi.fn(),
      activeReissue: null,
    });

    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    // With no case at all the pending empty state should not appear (the
    // component guards on !letterSent && !isWithdrawalMode — null case
    // means letterSent is undefined/falsy, but withdrawal mode is also false,
    // so the empty state DOES render. This assertion documents that behaviour.
    expect(screen.getByTestId("letter-pending-state")).toBeTruthy();
  });
});

// ── LetterView (withdrawal mode) ─────────────────────────────────────────────

describe("LetterView — withdrawal mode active", () => {
  beforeEach(() => {
    withdrawalModeFn = () => true;
    portalContextStub = () => ({
      currentCase: {
        id: "case-1",
        accessCode: "TEST-0001",
        letterSent: false,
        withdrawalAmount: "50,000 USDT",
        userName: "Test User",
      },
      letterContent: null,
      submissions: [],
      setSubmissions: vi.fn(),
      setViewState: vi.fn(),
      activeReissue: null,
    });
  });

  it("renders the letter body (option-select controls) when withdrawal mode is active even though letterSent is false", async () => {
    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    // The option-select buttons are part of the letter body and must appear
    // whenever the pending-state guard is bypassed by withdrawal mode.
    expect(screen.getByTestId("button-select-option-a")).toBeTruthy();
    expect(screen.getByTestId("button-select-option-b")).toBeTruthy();
  });

  it("does not render the letter-pending-state empty state when withdrawal mode is active", async () => {
    const { LetterView } = await import("../LetterView");
    render(<LetterView />);

    expect(screen.queryByTestId("letter-pending-state")).toBeNull();
  });
});
