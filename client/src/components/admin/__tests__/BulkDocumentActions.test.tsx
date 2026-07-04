// @vitest-environment jsdom
//
// Task #439 — Keep badge counts accurate when bulk-approving or bulk-rejecting
// documents.
//
// Contracts under test:
//   1. SupportingDocsQuickPopover.bulkApprove — "Approve all" in the per-case
//      popover calls onActioned() in a finally block so badge counts are
//      refreshed even when some (or all) PATCHes fail (partial-failure path).
//   2. SupportingDocumentsTab.bulkApproveVisible — "Approve all" in the cross-
//      case inbox calls loadUserDocPendingCounts() in a finally block under the
//      same conditions.
//   3. SupportingDocumentsPanel.act — onActioned() is now fired in the finally
//      block so badge counts are refreshed even on PATCH failure.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (s: string) => s,
    formatDate: (s: string) => s,
    formatNumber: (n: number) => String(n),
    formatCurrency: (n: number) => String(n),
    formatRelative: (s: string) => s,
  }),
}));

// Replace Radix Select with a plain native <select> so JSDOM can drive the
// status filter without fighting the pointer-capture APIs (Task #577 — used by
// the scroll-to-selection tests below; harmless for the other suites, none of
// which inspect the Select internals).
vi.mock("@/components/ui/select", () => {
  const collectItems = (children: React.ReactNode): React.ReactElement[] => {
    const out: React.ReactElement[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const c = child as React.ReactElement<any>;
      if ((c.type as any)?.displayName === "SelectItem") {
        out.push(c);
      } else if (c.props && (c.props as any).children) {
        out.push(...collectItems((c.props as any).children));
      }
    });
    return out;
  };
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => {
    const items = collectItems(children);
    return (
      <select
        data-testid="select-filter-supporting-status-native"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {items.map((it) => (
          <option
            key={(it.props as any).value}
            value={(it.props as any).value}
            data-testid={(it.props as any)["data-testid"]}
          >
            {(it.props as any).children}
          </option>
        ))}
      </select>
    );
  };
  const SelectTrigger = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const SelectValue = () => null;
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const SelectItem: React.FC<{
    value: string;
    children?: React.ReactNode;
    "data-testid"?: string;
  }> = ({ children }) => <>{children}</>;
  (SelectItem as any).displayName = "SelectItem";
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

const loadUserDocPendingCountsMock = vi.fn();

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => ({
      authToken: "test-token",
      cases: [],
      userDocPendingCounts: { "case-abc": 3 },
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

function makeDoc(id: number, caseId = "case-abc") {
  return {
    id,
    caseId,
    fileName: `doc-${id}.pdf`,
    fileType: "application/pdf",
    fileSize: "10 KB",
    category: "kyc_id",
    description: null,
    status: "uploaded",
    uploadedAt: new Date(Date.now() - id * 1000).toISOString(),
  };
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function setupDomStubs() {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ep = Element.prototype as unknown as Record<string, unknown>;
  if (!ep.hasPointerCapture) ep.hasPointerCapture = () => false;
  if (!ep.setPointerCapture) ep.setPointerCapture = () => {};
  if (!ep.releasePointerCapture) ep.releasePointerCapture = () => {};
  if (!ep.scrollIntoView) ep.scrollIntoView = () => {};
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loadUserDocPendingCountsMock.mockClear();
  setupDomStubs();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom */
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — bulk approve
// ---------------------------------------------------------------------------

import { SupportingDocsQuickPopover } from "../SupportingDocsQuickPopover";

const DOC_A = makeDoc(1);
const DOC_B = makeDoc(2);
const DOC_C = makeDoc(3);

describe("SupportingDocsQuickPopover – bulk approve (Task #439)", () => {
  it("shows 'Approve all' button only when there are multiple pending docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([DOC_A, DOC_B]));

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );
  });

  it("calls onActioned once after all PATCHes succeed", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    // Called exactly once (not once per doc)
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  it("calls onActioned even on partial failure (some PATCHes fail)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // First PATCH succeeds, second fails
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when all PATCHes fail", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("removes only successfully-approved docs from the list (partial failure)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // doc 1 succeeds, doc 2 fails
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const bulkBtn = await screen.findByTestId("popover-bulk-approve-case-abc");
    fireEvent.click(bulkBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // doc-1.pdf was approved (row removed); doc-2.pdf failed (row stays)
    await waitFor(() =>
      expect(screen.queryByText("doc-1.pdf")).toBeNull(),
    );
    expect(screen.getByText("doc-2.pdf")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — bulk approve
// ---------------------------------------------------------------------------

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

const TAB_DOC_A = {
  id: 10,
  caseId: "case-abc",
  fileName: "passport.pdf",
  fileType: "application/pdf",
  fileSize: "5 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 10_000).toISOString(),
};

const TAB_DOC_B = {
  ...TAB_DOC_A,
  id: 11,
  fileName: "bank-statement.pdf",
};

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — mount-fetch guard
// ---------------------------------------------------------------------------
// Previously, two separate useEffect hooks (one for statusFilter, one for
// caseIdFilter) both fired load() on initial render, issuing two simultaneous
// GETs.  Tests that used mockResolvedValueOnce for the initial GET would
// silently stall because the second GET consumed the one-shot mock.  The
// combined [statusFilter, caseIdFilter] effect (Task #882) fixes this, but
// only if no future change re-introduces split effects.  This test asserts the
// invariant so any regression surfaces with a clear failure message instead of
// a silent stall.
describe("SupportingDocumentsTab – single GET on mount", () => {
  it("fires exactly one GET request on initial render", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ok: true }));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId("button-bulk-approve-supporting-docs"),
      ).toBeTruthy(),
    );

    const getCount = (
      fetchMock.mock.calls as [unknown, { method?: string } | undefined][]
    ).filter(([, o]) => !o?.method || o.method === "GET").length;
    expect(getCount).toBe(1);
  });
});

describe("SupportingDocumentsTab – bulk approve (Task #439)", () => {
  it("shows 'Approve all' button when there are visible pending docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([TAB_DOC_A, TAB_DOC_B]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );
  });

  it("calls loadUserDocPendingCounts once after all PATCHes succeed", async () => {
    // The Tab fires a single GET on mount (combined statusFilter+caseIdFilter
    // effect, Task #882) and reloads after the batch, so every GET must return
    // the doc array — distinguish by method instead of a single
    // mockResolvedValueOnce, or a later reload would empty the list.
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    // All docs become "approved", so filtered.some(isActionable) turns false
    // and the button disappears.  loadUserDocPendingCounts() is called
    // synchronously in the finally block before the batched state updates that
    // hide the button are committed by React — so once the button is gone the
    // mock count is stable at exactly 1.
    await waitFor(() =>
      expect(screen.queryByTestId("button-bulk-approve-supporting-docs")).toBeNull(),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("calls loadUserDocPendingCounts even on partial failure (some PATCHes fail)", async () => {
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1)
            return Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "approved" }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts even when all PATCHes fail", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Internal Error" }, 500));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts even when PATCHes throw network errors", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("succeeded rows show approved status and failed rows remain uploaded after partial failure (Task #924)", async () => {
    // TAB_DOC_A id=10, TAB_DOC_B id=11.
    // Distinguish by URL: /api/user-documents/10 succeeds, /11 returns 500.
    // bulkApproveVisible updates docs state in-memory (no reload); both rows
    // remain visible.  The succeeded row flips to "approved" while the failed
    // row stays "uploaded".
    const fetchMock = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          if (String(url).endsWith("/10")) {
            return Promise.resolve(
              jsonOk({ ...TAB_DOC_A, status: "approved" }),
            );
          }
          return Promise.resolve(
            jsonOk({ error: "Internal Server Error" }, 500),
          );
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    // loadUserDocPendingCounts must be called exactly once (finally block).
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);

    // Doc 10 (PATCH succeeded) → setDocs flips its status to "approved".
    // Doc 11 (PATCH 500'd)    → status stays "uploaded".
    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10").textContent).toContain("approved"),
    );
    expect(screen.getByTestId("row-supporting-doc-11").textContent).toContain("uploaded");
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — bulk reject (Task #442)
// ---------------------------------------------------------------------------

describe("SupportingDocsQuickPopover – bulk reject (Task #442)", () => {
  it("shows 'Reject all' button only when there are multiple pending docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([DOC_A, DOC_B]));

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-reject-case-abc")).toBeTruthy(),
    );
  });

  it("shows confirmation area when 'Reject all' is clicked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([DOC_A, DOC_B]));

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-reject-confirm-case-abc")).toBeTruthy(),
    );
    expect(screen.getByTestId("popover-bulk-reject-notes-case-abc")).toBeTruthy();
    expect(screen.getByTestId("popover-bulk-reject-confirm-btn-case-abc")).toBeTruthy();
  });

  it("calls onActioned once after all PATCHes succeed", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  it("calls onActioned even on partial failure (some PATCHes fail)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when all PATCHes fail", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("removes only successfully-rejected docs from the list (partial failure)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // doc-1.pdf was rejected (row removed); doc-2.pdf failed (row stays)
    await waitFor(() =>
      expect(screen.queryByText("doc-1.pdf")).toBeNull(),
    );
    expect(screen.getByText("doc-2.pdf")).toBeTruthy();
  });

  it("sends the shared notes with each PATCH when provided", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));
    const rejectAllBtn = await screen.findByTestId("popover-bulk-reject-case-abc");
    fireEvent.click(rejectAllBtn);

    const notesField = await screen.findByTestId("popover-bulk-reject-notes-case-abc");
    fireEvent.change(notesField, { target: { value: "Duplicate upload" } });

    const confirmBtn = screen.getByTestId("popover-bulk-reject-confirm-btn-case-abc");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(2);
    for (const [, opts] of patchCalls) {
      const body = JSON.parse((opts as { body: string }).body);
      expect(body.status).toBe("rejected");
      expect(body.adminNotes).toBe("Duplicate upload");
    }
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — bulk reject (Task #442)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – bulk reject (Task #442)", () => {
  it("shows 'Reject all' button when there are visible pending docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([TAB_DOC_A, TAB_DOC_B]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-reject-supporting-docs")).toBeTruthy(),
    );
  });

  it("shows confirmation panel when 'Reject all' is clicked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([TAB_DOC_A, TAB_DOC_B]));

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject-confirm-supporting-docs")).toBeTruthy(),
    );
    expect(screen.getByTestId("textarea-bulk-reject-notes-supporting-docs")).toBeTruthy();
    expect(screen.getByTestId("button-bulk-reject-confirm-supporting-docs")).toBeTruthy();
  });

  it("calls loadUserDocPendingCounts once after all PATCHes succeed", async () => {
    // The Tab fires a single GET on mount (combined statusFilter+caseIdFilter
    // effect, Task #882) and reloads after the batch, so every GET must return
    // the doc array — distinguish by method instead of a single
    // mockResolvedValueOnce, or a later reload would empty the list.
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    fireEvent.click(confirmBtn);

    // setBulkRejectConfirming(false) is called in the finally block, which
    // removes the confirm panel from the DOM.  loadUserDocPendingCounts() is
    // called synchronously in the same finally block before React commits the
    // batched state updates — so once the panel is gone the mock count is
    // stable at exactly 1.
    await waitFor(() =>
      expect(screen.queryByTestId("panel-bulk-reject-confirm-supporting-docs")).toBeNull(),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("calls loadUserDocPendingCounts even on partial failure (some PATCHes fail)", async () => {
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1)
            return Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts even when all PATCHes fail", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Internal Error" }, 500));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("calls loadUserDocPendingCounts even when PATCHes throw network errors", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId("button-bulk-reject-confirm-supporting-docs");
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
  });

  it("cancelling the confirmation hides the panel and does not fire any PATCHes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk([TAB_DOC_A, TAB_DOC_B]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const cancelBtn = await screen.findByTestId("button-bulk-reject-cancel-supporting-docs");
    fireEvent.click(cancelBtn);

    await waitFor(() =>
      expect(screen.queryByTestId("panel-bulk-reject-confirm-supporting-docs")).toBeNull(),
    );

    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(0);
    expect(loadUserDocPendingCountsMock).not.toHaveBeenCalled();
  });

  it("succeeded rows show rejected status and failed rows remain uploaded after partial failure (Task #924)", async () => {
    // TAB_DOC_A id=10, TAB_DOC_B id=11.
    // Distinguish by URL: /api/user-documents/10 succeeds, /11 returns 500.
    // bulkRejectVisible updates docs state in-memory (no reload); both rows
    // remain visible.  The succeeded row flips to "rejected" while the failed
    // row stays "uploaded".
    const fetchMock = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          if (String(url).endsWith("/10")) {
            return Promise.resolve(
              jsonOk({ ...TAB_DOC_A, status: "rejected" }),
            );
          }
          return Promise.resolve(
            jsonOk({ error: "Internal Server Error" }, 500),
          );
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId("button-bulk-reject-supporting-docs");
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId(
      "button-bulk-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // loadUserDocPendingCounts must be called exactly once (finally block).
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);

    // Doc 10 (PATCH succeeded) → setDocs flips its status to "rejected".
    // Doc 11 (PATCH 500'd)    → status stays "uploaded".
    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10").textContent).toContain("rejected"),
    );
    expect(screen.getByTestId("row-supporting-doc-11").textContent).toContain("uploaded");
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — checkbox row selection (Task #446)
// ---------------------------------------------------------------------------

const SEL_DOC_A = {
  id: 20,
  caseId: "case-sel",
  fileName: "passport.pdf",
  fileType: "application/pdf",
  fileSize: "8 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 5_000).toISOString(),
};

const SEL_DOC_B = {
  ...SEL_DOC_A,
  id: 21,
  fileName: "bank-statement.pdf",
};

const SEL_DOC_APPROVED = {
  ...SEL_DOC_A,
  id: 22,
  fileName: "already-approved.pdf",
  status: "approved",
};

describe("SupportingDocumentsTab – checkbox selection (Task #446)", () => {
  it("renders a checkbox for each actionable row and none for non-actionable rows", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B, SEL_DOC_APPROVED]));

    render(<SupportingDocumentsTab />);

    await waitFor(() => {
      expect(screen.getByTestId("checkbox-supporting-doc-20")).toBeTruthy();
      expect(screen.getByTestId("checkbox-supporting-doc-21")).toBeTruthy();
      expect(screen.queryByTestId("checkbox-supporting-doc-22")).toBeNull();
    });
  });

  it("renders a select-all checkbox in the header when actionable docs exist", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A]));

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("checkbox-select-all-supporting-docs")).toBeTruthy(),
    );
  });

  it("does not render select-all when there are no actionable docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_APPROVED]));

    render(<SupportingDocumentsTab />);

    await waitFor(() => screen.getByTestId("supporting-docs-pending-total"));

    expect(screen.queryByTestId("checkbox-select-all-supporting-docs")).toBeNull();
  });

  it("clicking select-all checks all actionable rows", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B, SEL_DOC_APPROVED]));

    render(<SupportingDocumentsTab />);

    const selectAll = await screen.findByTestId("checkbox-select-all-supporting-docs");
    fireEvent.click(selectAll);

    await waitFor(() => {
      expect(
        (screen.getByTestId("checkbox-supporting-doc-20") as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (screen.getByTestId("checkbox-supporting-doc-21") as HTMLInputElement).checked,
      ).toBe(true);
    });
  });

  it("clicking select-all again deselects all", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B]));

    render(<SupportingDocumentsTab />);

    const selectAll = await screen.findByTestId("checkbox-select-all-supporting-docs");
    fireEvent.click(selectAll);
    await waitFor(() =>
      expect(
        (screen.getByTestId("checkbox-supporting-doc-20") as HTMLInputElement).checked,
      ).toBe(true),
    );
    fireEvent.click(selectAll);
    await waitFor(() =>
      expect(
        (screen.getByTestId("checkbox-supporting-doc-20") as HTMLInputElement).checked,
      ).toBe(false),
    );
  });

  it("individual row checkbox toggles only that row", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B]));

    render(<SupportingDocumentsTab />);

    const cb20 = await screen.findByTestId("checkbox-supporting-doc-20") as HTMLInputElement;
    const cb21 = screen.getByTestId("checkbox-supporting-doc-21") as HTMLInputElement;

    fireEvent.click(cb20);

    await waitFor(() => {
      expect(cb20.checked).toBe(true);
      expect(cb21.checked).toBe(false);
    });
  });

  it("selection toolbar appears when ≥1 actionable row is checked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B]));

    render(<SupportingDocumentsTab />);

    expect(screen.queryByTestId("toolbar-selection-supporting-docs")).toBeNull();

    const cb20 = await screen.findByTestId("checkbox-supporting-doc-20");
    fireEvent.click(cb20);

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-selection-supporting-docs")).toBeTruthy(),
    );
  });

  it("toolbar shows the correct selected count", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A, SEL_DOC_B]));

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-21"));

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs").textContent,
      ).toContain("2 documents selected"),
    );
  });

  it("'Approve selected' fires PATCH only for selected rows", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));

    const approveBtn = await screen.findByTestId("button-approve-selected-supporting-docs");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
        ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
      );
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0][0]).toBe("/api/user-documents/20");
      const body = JSON.parse((patchCalls[0][1] as { body: string }).body);
      expect(body.status).toBe("approved");
    });
  });

  it("'Approve selected' calls loadUserDocPendingCounts in finally", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-approve-selected-supporting-docs"));

    // The PATCH succeeds for doc 20, so setSelectedIds removes it from the
    // selection in the try block, making someActionableSelected false and
    // hiding the toolbar.  loadUserDocPendingCounts() is called synchronously
    // in the finally block before React commits the batched state updates —
    // so once the toolbar is gone the mock count is stable at exactly 1.
    await waitFor(() =>
      expect(screen.queryByTestId("toolbar-selection-supporting-docs")).toBeNull(),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("'Approve selected' calls loadUserDocPendingCounts even when PATCH fails", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-approve-selected-supporting-docs"));

    // setSelectionApproving(false) is called in the finally block, which
    // re-enables the approve button regardless of whether the PATCH succeeded
    // or failed.  loadUserDocPendingCounts() is called synchronously in the
    // same finally block before React commits the batched state updates —
    // so once the button is enabled again the mock count is stable at exactly 1.
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-approve-selected-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("'Reject selected' opens the confirmation panel", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A]));

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));

    await waitFor(() => {
      expect(screen.getByTestId("panel-selection-reject-confirm-supporting-docs")).toBeTruthy();
      expect(screen.getByTestId("textarea-selection-reject-notes-supporting-docs")).toBeTruthy();
    });
  });

  it("confirming rejection fires PATCH with adminNotes for selected rows only", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select only doc 21
    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-21"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));

    const notesField = await screen.findByTestId("textarea-selection-reject-notes-supporting-docs");
    fireEvent.change(notesField, { target: { value: "Insufficient detail" } });

    fireEvent.click(screen.getByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() => {
      const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
        ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
      );
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0][0]).toBe("/api/user-documents/21");
      const body = JSON.parse((patchCalls[0][1] as { body: string }).body);
      expect(body.status).toBe("rejected");
      expect(body.adminNotes).toBe("Insufficient detail");
    });
  });

  it("'Reject selected' calls loadUserDocPendingCounts in finally", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([SEL_DOC_A]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    // setSelectionRejectConfirming(false) is called in the finally block, which
    // removes the confirm panel from the DOM.  loadUserDocPendingCounts() is
    // called synchronously in the same finally block before React commits the
    // batched state updates — so once the panel is gone the mock count is
    // stable at exactly 1.
    await waitFor(() =>
      expect(screen.queryByTestId("panel-selection-reject-confirm-supporting-docs")).toBeNull(),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("'Reject selected' calls loadUserDocPendingCounts even when PATCH fails", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        return Promise.resolve(jsonOk([SEL_DOC_A]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    // setSelectionRejectConfirming(false) is called in the finally block, which
    // removes the confirm panel from the DOM regardless of whether the PATCH
    // succeeded or failed.  loadUserDocPendingCounts() is called synchronously
    // in the same finally block before React commits the batched state updates —
    // so once the panel is gone the mock count is stable at exactly 1.
    await waitFor(() =>
      expect(screen.queryByTestId("panel-selection-reject-confirm-supporting-docs")).toBeNull(),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);
  });

  it("cancelling reject confirmation hides the panel without PATCHing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    await screen.findByTestId("panel-selection-reject-confirm-supporting-docs");

    fireEvent.click(screen.getByTestId("button-selection-reject-cancel-supporting-docs"));

    await waitFor(() =>
      expect(screen.queryByTestId("panel-selection-reject-confirm-supporting-docs")).toBeNull(),
    );
    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(0);
  });

  it("'Clear selection' button hides the toolbar", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([SEL_DOC_A]));

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    await screen.findByTestId("toolbar-selection-supporting-docs");

    fireEvent.click(screen.getByTestId("button-clear-selection-supporting-docs"));

    await waitFor(() =>
      expect(screen.queryByTestId("toolbar-selection-supporting-docs")).toBeNull(),
    );
  });

  it("'Approve selected' — succeeded rows flip to approved, failed rows stay uploaded (Task #925)", async () => {
    // SEL_DOC_A id=20 and SEL_DOC_B id=21.  Select both, then approve.
    // PATCH /20 succeeds; PATCH /21 returns 500.
    // approveSelected() does NOT call load() in its finally block, so the
    // in-memory setDocs update is the final state visible in the DOM.
    // Verify: row 20 → "approved", row 21 → "uploaded".
    // loadUserDocPendingCounts() must be called exactly once (finally block).
    const fetchMock = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          if (String(url).endsWith("/20")) {
            return Promise.resolve(
              jsonOk({ ...SEL_DOC_A, status: "approved" }),
            );
          }
          return Promise.resolve(
            jsonOk({ error: "Internal Server Error" }, 500),
          );
        }
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-21"));

    const approveBtn = await screen.findByTestId("button-approve-selected-supporting-docs");
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-20").textContent).toContain("approved"),
    );
    expect(screen.getByTestId("row-supporting-doc-21").textContent).toContain("uploaded");
  });

  it("'Reject selected' — succeeded rows flip to rejected, failed rows stay uploaded (Task #925)", async () => {
    // SEL_DOC_A id=20 and SEL_DOC_B id=21.  Select both, then reject.
    // PATCH /20 succeeds; PATCH /21 returns 500.
    // rejectSelected() calls await load() in its finally block; the reload
    // GET mock returns the expected partial state so the DOM reflects it.
    // Verify: row 20 → "rejected", row 21 → "uploaded".
    // loadUserDocPendingCounts() must be called exactly once (finally block).
    let getCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          if (String(url).endsWith("/20")) {
            return Promise.resolve(
              jsonOk({ ...SEL_DOC_A, status: "rejected" }),
            );
          }
          return Promise.resolve(
            jsonOk({ error: "Internal Server Error" }, 500),
          );
        }
        getCallCount += 1;
        if (getCallCount === 1) {
          return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
        }
        return Promise.resolve(
          jsonOk([{ ...SEL_DOC_A, status: "rejected" }, SEL_DOC_B]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-20"));
    fireEvent.click(await screen.findByTestId("checkbox-supporting-doc-21"));

    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));

    const confirmBtn = await screen.findByTestId(
      "button-selection-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );
    expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-20").textContent).toContain("rejected"),
    );
    expect(screen.getByTestId("row-supporting-doc-21").textContent).toContain("uploaded");
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — bulk approve + bulk reject (Task #445)
// ---------------------------------------------------------------------------

import { SupportingDocumentsPanel } from "../SupportingDocumentsPanel";

const PANEL_DOC_A = {
  id: 99,
  caseId: "case-abc",
  fileName: "id-card.jpg",
  fileType: "image/jpeg",
  fileSize: "200 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 30_000).toISOString(),
};

const PANEL_DOC_B = {
  ...PANEL_DOC_A,
  id: 100,
  fileName: "bank-statement.pdf",
  fileType: "application/pdf",
};

describe("SupportingDocumentsPanel – bulk reject (Task #445)", () => {
  it("shows 'Reject all' button only when there are ≥2 pending docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject")).toBeTruthy(),
    );
  });

  it("does NOT show 'Reject all' when there is only one pending doc", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("id-card.jpg")).toBeTruthy());
    expect(screen.queryByTestId("panel-bulk-reject")).toBeNull();
  });

  it("shows confirmation area with notes field when 'Reject all' is clicked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject-confirm")).toBeTruthy(),
    );
    expect(screen.getByTestId("panel-bulk-reject-notes")).toBeTruthy();
    expect(screen.getByTestId("panel-bulk-reject-confirm-btn")).toBeTruthy();
  });

  it("hides 'Reject all' button while the confirmation area is open", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject-confirm")).toBeTruthy(),
    );
    expect(screen.queryByTestId("panel-bulk-reject")).toBeNull();
  });

  it("cancelling hides the confirmation area and fires no PATCHes", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);

    const cancelBtn = await screen.findByTestId("panel-bulk-reject-cancel");
    fireEvent.click(cancelBtn);

    await waitFor(() =>
      expect(screen.queryByTestId("panel-bulk-reject-confirm")).toBeNull(),
    );

    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(0);
    expect(onActioned).not.toHaveBeenCalled();
  });

  it("calls onActioned once after all PATCHes succeed", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B]))
      .mockResolvedValue(jsonOk({ ok: true }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  it("calls onActioned even on partial failure (some PATCHes fail)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when all PATCHes fail", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("sends shared notes with each PATCH when provided", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B]))
      .mockResolvedValue(jsonOk({ ok: true }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);

    const notesField = await screen.findByTestId("panel-bulk-reject-notes");
    fireEvent.change(notesField, { target: { value: "Insufficient quality" } });

    const confirmBtn = screen.getByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(2);
    for (const [, opts] of patchCalls) {
      const body = JSON.parse((opts as { body: string }).body);
      expect(body.status).toBe("rejected");
      expect(body.adminNotes).toBe("Insufficient quality");
    }
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — finally-block fix (Task #439)
// ---------------------------------------------------------------------------

const PANEL_DOC = {
  id: 99,
  caseId: "case-abc",
  fileName: "id-card.jpg",
  fileType: "image/jpeg",
  fileSize: "200 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 30_000).toISOString(),
};

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — bulk approve server-reload fix (Task #450)
// ---------------------------------------------------------------------------
//
// bulkApprove previously relied solely on optimistic setDocs state mutation.
// If one or more PATCHes failed the UI could diverge from DB truth.
// The fix adds `await load()` in the finally block so the panel always
// reflects the real server state after the batch completes.

describe("SupportingDocumentsPanel – bulk approve server reload (Task #450)", () => {
  it("calls load() after all PATCHes succeed — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    // Sequence: initial load → PATCH A → PATCH B → reload
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B])) // initial load
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH A
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH B
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_DOC_A, status: "approved" },
          { ...PANEL_DOC_B, status: "approved" },
        ]),
      ); // reload
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // 4 fetches: initial load + 2 PATCHes + 1 reload
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Reload targets the user-documents list endpoint
    const reloadUrl = (fetchMock.mock.calls[3] as [string])[0];
    expect(reloadUrl).toContain("/api/cases/case-abc/user-documents");
  });

  it("reflects server-confirmed approved status after a full-success bulk approve", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B]))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_DOC_A, status: "approved", reviewedBy: "admin" },
          { ...PANEL_DOC_B, status: "approved", reviewedBy: "admin" },
        ]),
      );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // After reload, both docs show "approved" — the bulk-approve button
    // disappears because there are no longer ≥2 pending docs.
    await waitFor(() =>
      expect(screen.queryByTestId("panel-bulk-approve")).toBeNull(),
    );
  });

  it("calls load() after a partial failure — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // first PATCH succeeds, second fails
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        // GET calls: initial load + reload
        return Promise.resolve(
          jsonOk([
            { ...PANEL_DOC_A, status: patchCount >= 1 ? "approved" : "uploaded" },
            PANEL_DOC_B,
          ]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // 4 fetches: initial load + 2 PATCHes + 1 reload
    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    // At least 2 GET calls: initial load + reload
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when all PATCHes fail — always syncs with server", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        // Both GET calls (initial + reload) return same list
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onActioned once after all PATCHes succeed", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
    expect(onActioned).toHaveBeenCalledTimes(1);
  });

  it("calls onActioned even on partial failure (some PATCHes fail)", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          if (patchCount === 1) return Promise.resolve(jsonOk({ ok: true }));
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const approveAllBtn = await screen.findByTestId("panel-bulk-approve");
    fireEvent.click(approveAllBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("shows Approve all button only when ≥2 pending docs are present", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_DOC_A]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("id-card.jpg")).toBeTruthy());
    expect(screen.queryByTestId("panel-bulk-approve")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — checkbox row selection (Task #454)
// ---------------------------------------------------------------------------

const PANEL_SEL_A = {
  id: 201,
  caseId: "case-abc",
  fileName: "passport-sel.pdf",
  fileType: "application/pdf",
  fileSize: "12 KB",
  category: "kyc_id",
  description: null,
  status: "uploaded",
  adminNotes: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: new Date(Date.now() - 6_000).toISOString(),
};

const PANEL_SEL_B = {
  ...PANEL_SEL_A,
  id: 202,
  fileName: "bank-sel.pdf",
};

const PANEL_SEL_APPROVED = {
  ...PANEL_SEL_A,
  id: 203,
  fileName: "already-done.pdf",
  status: "approved",
};

describe("SupportingDocumentsPanel – checkbox selection (Task #454)", () => {
  it("renders a checkbox for each actionable row and none for non-actionable rows", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B, PANEL_SEL_APPROVED]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("checkbox-panel-doc-201")).toBeTruthy();
      expect(screen.getByTestId("checkbox-panel-doc-202")).toBeTruthy();
      expect(screen.queryByTestId("checkbox-panel-doc-203")).toBeNull();
    });
  });

  it("renders a select-all checkbox in the header when actionable docs exist", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("checkbox-panel-select-all")).toBeTruthy(),
    );
  });

  it("does not render select-all when there are no actionable docs", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_APPROVED]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("already-done.pdf")).toBeTruthy());
    expect(screen.queryByTestId("checkbox-panel-select-all")).toBeNull();
  });

  it("clicking select-all checks all actionable rows", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B, PANEL_SEL_APPROVED]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);

    await waitFor(() => {
      expect(
        (screen.getByTestId("checkbox-panel-doc-201") as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement).checked,
      ).toBe(true);
    });
  });

  it("clicking select-all again deselects all", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    await waitFor(() =>
      expect(
        (screen.getByTestId("checkbox-panel-doc-201") as HTMLInputElement).checked,
      ).toBe(true),
    );
    fireEvent.click(selectAll);
    await waitFor(() =>
      expect(
        (screen.getByTestId("checkbox-panel-doc-201") as HTMLInputElement).checked,
      ).toBe(false),
    );
  });

  it("individual row checkbox toggles only that row", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);

    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(false);
    });
  });

  it("selection toolbar appears when ≥1 actionable row is checked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("toolbar-panel-selection")).toBeNull();

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-panel-selection")).toBeTruthy(),
    );
  });

  it("toolbar shows the correct selected count", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("checkbox-panel-doc-202"));

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-panel-selection").textContent,
      ).toContain("2 documents selected"),
    );
  });

  it("'Approve selected' fires PATCH only for selected rows", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));

    const approveBtn = await screen.findByTestId("button-panel-approve-selected");
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
        ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
      );
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0][0]).toBe("/api/admin/user-documents/201");
      const body = JSON.parse((patchCalls[0][1] as { body: string }).body);
      expect(body.status).toBe("approved");
    });
  });

  it("'Approve selected' calls onActioned in finally", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("'Approve selected' calls onActioned even when PATCH fails", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("'Reject selected' opens the confirmation panel", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));

    await waitFor(() => {
      expect(screen.getByTestId("panel-selection-reject-confirm")).toBeTruthy();
      expect(screen.getByTestId("textarea-panel-selection-reject-notes")).toBeTruthy();
    });
  });

  it("confirming rejection fires PATCH with adminNotes for selected rows only", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-202"));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));

    const notesField = await screen.findByTestId("textarea-panel-selection-reject-notes");
    fireEvent.change(notesField, { target: { value: "Poor quality" } });

    fireEvent.click(screen.getByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => {
      const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
        ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
      );
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0][0]).toBe("/api/admin/user-documents/202");
      const body = JSON.parse((patchCalls[0][1] as { body: string }).body);
      expect(body.status).toBe("rejected");
      expect(body.adminNotes).toBe("Poor quality");
    });
  });

  it("'Reject selected' calls onActioned in finally", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("'Reject selected' calls onActioned even when PATCH fails", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        return Promise.resolve(jsonOk([PANEL_SEL_A]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("cancelling reject confirmation hides the panel without PATCHing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A]));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    await screen.findByTestId("panel-selection-reject-confirm");

    fireEvent.click(screen.getByTestId("button-panel-selection-reject-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("panel-selection-reject-confirm")).toBeNull(),
    );
    const patchCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => opts?.method === "PATCH",
    );
    expect(patchCalls.length).toBe(0);
  });

  it("'Clear selection' button hides the toolbar", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId("checkbox-panel-doc-201"));
    await screen.findByTestId("toolbar-panel-selection");

    fireEvent.click(screen.getByTestId("button-panel-clear-selection"));

    await waitFor(() =>
      expect(screen.queryByTestId("toolbar-panel-selection")).toBeNull(),
    );
  });

  it("selection is preserved when expanding then collapsing a row (Task #510)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    // Select one doc
    fireEvent.click(cb201);
    await waitFor(() => expect(cb201.checked).toBe(true));
    expect(cb202.checked).toBe(false);

    // Expand the review panel for that doc
    const expandBtn = screen.getByTestId("button-panel-expand-201");
    fireEvent.click(expandBtn);

    // Selection must still be intact after expanding
    expect(cb201.checked).toBe(true);
    expect(cb202.checked).toBe(false);

    // Collapse the review panel
    fireEvent.click(expandBtn);

    // Selection must still be intact after collapsing
    expect(cb201.checked).toBe(true);
    expect(cb202.checked).toBe(false);

    // The selection toolbar should still be visible
    expect(screen.getByTestId("toolbar-panel-selection")).toBeTruthy();
  });

  it("approving via the expanded per-row panel removes only that doc from selection (Task #581)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);
    fireEvent.click(cb202);
    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(true);
    });

    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");

    fireEvent.click(screen.getByTestId("button-panel-expand-201"));
    const approveBtn = await screen.findByTestId("button-panel-approve-201");
    fireEvent.click(approveBtn);

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("1 document selected"),
    );
    expect(cb202.checked).toBe(true);
  });

  it("rejecting via the expanded per-row panel removes only that doc from selection (Task #581)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);
    fireEvent.click(cb202);
    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(true);
    });

    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");

    fireEvent.click(screen.getByTestId("button-panel-expand-201"));
    const rejectBtn = await screen.findByTestId("button-panel-reject-201");
    fireEvent.click(rejectBtn);

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("1 document selected"),
    );
    expect(cb202.checked).toBe(true);
  });

  it("failed approve PATCH leaves the doc's ID in selectedIds — toolbar count unchanged (Task #716)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH")
          return Promise.resolve(jsonOk({ error: "Internal Server Error" }, 500));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);
    fireEvent.click(cb202);
    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(true);
    });

    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");

    fireEvent.click(screen.getByTestId("button-panel-expand-201"));
    const approveBtn = await screen.findByTestId("button-panel-approve-201");
    fireEvent.click(approveBtn);

    // Wait for the acting spinner to clear (finally block runs)
    await waitFor(() =>
      expect(screen.queryByTestId("button-panel-approve-201")).toBeTruthy(),
    );

    // PATCH failed → selectedIds must NOT have been pruned; count stays at 2
    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");
    expect(cb201.checked).toBe(true);
    expect(cb202.checked).toBe(true);
  });

  it("failed reject PATCH leaves the doc's ID in selectedIds — toolbar count unchanged (Task #716)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH")
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);
    fireEvent.click(cb202);
    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(true);
    });

    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");

    fireEvent.click(screen.getByTestId("button-panel-expand-201"));
    const rejectBtn = await screen.findByTestId("button-panel-reject-201");
    fireEvent.click(rejectBtn);

    // Wait for the acting spinner to clear (finally block runs)
    await waitFor(() =>
      expect(screen.queryByTestId("button-panel-reject-201")).toBeTruthy(),
    );

    // PATCH failed → selectedIds must NOT have been pruned; count stays at 2
    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");
    expect(cb201.checked).toBe(true);
    expect(cb202.checked).toBe(true);
  });

  it("network error during per-row approve leaves the doc's ID in selectedIds — toolbar count unchanged (Task #1441)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH")
          return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    const cb201 = await screen.findByTestId("checkbox-panel-doc-201") as HTMLInputElement;
    const cb202 = screen.getByTestId("checkbox-panel-doc-202") as HTMLInputElement;

    fireEvent.click(cb201);
    fireEvent.click(cb202);
    await waitFor(() => {
      expect(cb201.checked).toBe(true);
      expect(cb202.checked).toBe(true);
    });

    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");

    fireEvent.click(screen.getByTestId("button-panel-expand-201"));
    const approveBtn = await screen.findByTestId("button-panel-approve-201");
    fireEvent.click(approveBtn);

    // Wait for the acting spinner to clear (finally block runs after catch)
    await waitFor(() =>
      expect(screen.queryByTestId("button-panel-approve-201")).toBeTruthy(),
    );

    // Network error → selectedIds must NOT have been pruned; count stays at 2
    expect(screen.getByTestId("toolbar-panel-selection").textContent).toContain("2 documents selected");
    expect(cb201.checked).toBe(true);
    expect(cb202.checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — bulk reject server-reload fix (Task #466)
// ---------------------------------------------------------------------------
//
// bulkReject previously relied solely on optimistic setDocs state mutation.
// If one or more PATCHes failed the UI could diverge from DB truth.
// The fix adds `await load()` in the finally block so the panel always
// reflects the real server state after the batch completes.

describe("SupportingDocumentsPanel – bulk reject server reload (Task #466)", () => {
  it("calls load() after all PATCHes succeed — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B])) // initial load
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH A
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH B
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_DOC_A, status: "rejected" },
          { ...PANEL_DOC_B, status: "rejected" },
        ]),
      ); // reload
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // 4 fetches: initial load + 2 PATCHes + 1 reload
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Reload targets the user-documents list endpoint
    const reloadUrl = (fetchMock.mock.calls[3] as [string])[0];
    expect(reloadUrl).toContain("/api/cases/case-abc/user-documents");
  });

  it("reflects server-confirmed rejected status after a full-success bulk reject", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_DOC_A, PANEL_DOC_B]))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_DOC_A, status: "rejected", reviewedBy: "admin" },
          { ...PANEL_DOC_B, status: "rejected", reviewedBy: "admin" },
        ]),
      );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // After reload, both docs are rejected so there are no pending docs —
    // the bulk-reject button disappears (requires ≥2 pending docs).
    await waitFor(() =>
      expect(screen.queryByTestId("panel-bulk-reject")).toBeNull(),
    );
  });

  it("calls load() after a partial failure — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        // GET calls: initial load + reload
        return Promise.resolve(
          jsonOk([
            { ...PANEL_DOC_A, status: patchCount >= 1 ? "rejected" : "uploaded" },
            PANEL_DOC_B,
          ]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // At least 2 GET calls: initial load + reload
    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("reflects server-reloaded subset after partial failure — panel shows only non-rejected docs", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // PATCH for doc A succeeds, PATCH for doc B fails
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        if (patchCount >= 2) {
          // After the batch the server says: A is rejected, B is still uploaded
          return Promise.resolve(
            jsonOk([
              { ...PANEL_DOC_A, status: "rejected" },
              { ...PANEL_DOC_B, status: "uploaded" },
            ]),
          );
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // After reload: PANEL_DOC_B (bank-statement.pdf) is still uploaded, so it
    // stays visible; PANEL_DOC_A (id-card.jpg) was rejected and should not
    // appear in the pending list.
    await waitFor(() => {
      expect(screen.getByText("bank-statement.pdf")).toBeTruthy();
    });
  });

  it("calls load() even when all PATCHes fail — always syncs with server", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — approve selected server-reload (Task #511)
// ---------------------------------------------------------------------------
//
// approveSelected (Task #454) calls `await load()` in its finally block so
// the panel always reflects the real server state after the batch completes.
// The existing Task #454 tests only verify onActioned — they do not assert
// that the GET reload actually fires. These tests close that gap by counting
// fetch calls and verifying the UI reflects server-confirmed state.

describe("SupportingDocumentsPanel – approve selected server reload (Task #511)", () => {
  it("calls load() after select-all + 'Approve selected' — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    // Sequence: initial load → PATCH 201 → PATCH 202 → reload
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_SEL_A, PANEL_SEL_B])) // initial load
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH 201
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH 202
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_SEL_A, status: "approved" },
          { ...PANEL_SEL_B, status: "approved" },
        ]),
      ); // reload
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    const approveBtn = await screen.findByTestId("button-panel-approve-selected");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // 4 fetches: initial load + 2 PATCHes + 1 reload
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Reload targets the user-documents list endpoint
    const reloadUrl = (fetchMock.mock.calls[3] as [string])[0];
    expect(reloadUrl).toContain("/api/cases/case-abc/user-documents");
  });

  it("reflects server-confirmed approved status after select-all + 'Approve selected'", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_SEL_A, PANEL_SEL_B]))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_SEL_A, status: "approved", reviewedBy: "admin" },
          { ...PANEL_SEL_B, status: "approved", reviewedBy: "admin" },
        ]),
      );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // After reload both docs are approved so there are no pending docs —
    // the select-all checkbox disappears because pendingDocs is empty.
    await waitFor(() =>
      expect(screen.queryByTestId("checkbox-panel-select-all")).toBeNull(),
    );
  });

  it("calls load() after a partial failure — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // first PATCH succeeds, second fails
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        // GET calls: initial load + reload
        return Promise.resolve(
          jsonOk([
            { ...PANEL_SEL_A, status: patchCount >= 1 ? "approved" : "uploaded" },
            PANEL_SEL_B,
          ]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // At least 2 GET calls: initial load + reload
    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when all PATCHes fail — always syncs with server", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        // Both GET calls (initial + reload) return same list
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — reject selected server-reload (Task #582)
// ---------------------------------------------------------------------------
//
// rejectSelected calls `await load()` in its finally block so the panel always
// reflects the real server state after the batch completes. The existing
// Task #454 tests only verify onActioned — they do not assert that the GET
// reload actually fires. These tests close that gap by counting fetch calls
// and verifying the UI reflects server-confirmed state.

describe("SupportingDocumentsPanel – reject selected server reload (Task #582)", () => {
  it("calls load() after select-all + 'Reject selected' — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    // Sequence: initial load → PATCH 201 → PATCH 202 → reload
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_SEL_A, PANEL_SEL_B])) // initial load
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH 201
      .mockResolvedValueOnce(jsonOk({ ok: true }))                // PATCH 202
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_SEL_A, status: "rejected" },
          { ...PANEL_SEL_B, status: "rejected" },
        ]),
      ); // reload
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // 4 fetches: initial load + 2 PATCHes + 1 reload
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Reload targets the user-documents list endpoint
    const reloadUrl = (fetchMock.mock.calls[3] as [string])[0];
    expect(reloadUrl).toContain("/api/cases/case-abc/user-documents");
  });

  it("reflects server-confirmed rejected status after select-all + 'Reject selected'", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PANEL_SEL_A, PANEL_SEL_B]))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(jsonOk({ ok: true }))
      .mockResolvedValueOnce(
        jsonOk([
          { ...PANEL_SEL_A, status: "rejected", reviewedBy: "admin" },
          { ...PANEL_SEL_B, status: "rejected", reviewedBy: "admin" },
        ]),
      );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // After reload both docs are rejected so there are no pending docs —
    // the select-all checkbox disappears because pendingDocs is empty.
    await waitFor(() =>
      expect(screen.queryByTestId("checkbox-panel-select-all")).toBeNull(),
    );
  });

  it("calls load() after a partial failure — fetch count includes reload", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          // first PATCH succeeds, second fails
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        // GET calls: initial load + reload
        return Promise.resolve(
          jsonOk([
            { ...PANEL_SEL_A, status: patchCount >= 1 ? "rejected" : "uploaded" },
            PANEL_SEL_B,
          ]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // At least 2 GET calls: initial load + reload
    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when all PATCHes fail — always syncs with server", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        // Both GET calls (initial + reload) return same list
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls load() even when PATCHes throw network errors", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const selectAll = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SupportingDocumentsPanel – onActioned finally-block contract (Task #439)", () => {
  it("calls onActioned after a successful approve", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([PANEL_DOC]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() => expect(screen.getByText("id-card.jpg")).toBeTruthy());

    // Expand the review section
    fireEvent.click(screen.getByTitle("Review"));
    const approveBtn = await screen.findByText("Approve");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when the PATCH fails (finally-block guard)", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([PANEL_DOC]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() => expect(screen.getByText("id-card.jpg")).toBeTruthy());

    fireEvent.click(screen.getByTitle("Review"));
    const approveBtn = await screen.findByText("Approve");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });

  it("calls onActioned even when the PATCH throws a network error", async () => {
    const onActioned = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([PANEL_DOC]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    await waitFor(() => expect(screen.getByText("id-card.jpg")).toBeTruthy());

    fireEvent.click(screen.getByTitle("Review"));
    const rejectBtn = await screen.findByText("Reject");
    fireEvent.click(rejectBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — isBusy interlock (Task #525)
//
// The `isBusy` flag is true whenever any bulk or individual operation is in
// progress:
//   isBusy = bulkApproving || bulkRejecting || actingId !== null
//            || selectionApproving || selectionRejecting
//
// All action buttons (Approve all / Reject all) carry `disabled={isBusy}` so
// they cannot be clicked while another bulk mutation is still in flight.
//
// These tests hold the PATCH fetches open forever (never-resolving promise)
// to keep the component in the in-flight state while we assert.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsPanel – isBusy interlock (Task #525)", () => {
  it("disables 'Reject all' while a bulk approve is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight bulk approve)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Wait for docs to load — both bulk buttons become visible
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject")).toBeTruthy(),
    );

    // Trigger bulk approve — PATCHes hang so bulkApproving stays true
    fireEvent.click(screen.getByTestId("panel-bulk-approve"));

    // The button label switches to "Approving…" confirming bulkApproving = true
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve").textContent).toContain(
        "Approving",
      ),
    );

    // isBusy = true → "Reject all" must be disabled
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Sanity: "Approve all" is also self-disabled while busy
    expect(
      (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables 'Approve all' while a bulk reject is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight bulk reject)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Wait for docs to load
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject")).toBeTruthy(),
    );

    // Click "Reject all" — this shows the confirmation panel (bulkRejectConfirming = true)
    // The "Reject all" button itself disappears once confirming is open.
    fireEvent.click(screen.getByTestId("panel-bulk-reject"));

    // Confirmation UI appears
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject-confirm-btn")).toBeTruthy(),
    );

    // Confirm the rejection — PATCHes hang so bulkRejecting stays true
    fireEvent.click(screen.getByTestId("panel-bulk-reject-confirm-btn"));

    // The confirm button switches to "Rejecting…" confirming bulkRejecting = true
    await waitFor(() =>
      expect(
        screen.getByTestId("panel-bulk-reject-confirm-btn").textContent,
      ).toContain("Rejecting"),
    );

    // isBusy = true → "Approve all" must be disabled
    expect(
      (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — anyBulkBusy interlock (Task #621)
//
// The `anyBulkBusy` flag is true whenever any bulk or individual operation is
// in progress:
//   anyBulkBusy = bulkApproving || bulkRejecting
//               || selectionApproving || selectionRejecting
//
// Both "Approve all" and "Reject all" carry `disabled={anyBulkBusy || actingId !== null}`
// so neither can be triggered while another bulk mutation is in flight.
//
// These tests hold the PATCH fetches open forever (never-resolving promise)
// to keep the component in the in-flight state while we assert — the same
// strategy used by the SupportingDocumentsPanel isBusy tests (Task #525).
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – anyBulkBusy interlock (Task #621)", () => {
  it("disables 'Reject all' while a bulk approve is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight bulk approve)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });

    render(<SupportingDocumentsTab />);

    // Wait for docs to load — both bulk buttons become visible
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-reject-supporting-docs")).toBeTruthy(),
    );

    // Trigger bulk approve — PATCHes hang so bulkApproving stays true
    fireEvent.click(screen.getByTestId("button-bulk-approve-supporting-docs"));

    // The button label switches to "Approving…" confirming bulkApproving = true
    await waitFor(() =>
      expect(
        screen.getByTestId("button-bulk-approve-supporting-docs").textContent,
      ).toContain("Approving"),
    );

    // anyBulkBusy = true → "Reject all" must be disabled
    expect(
      (screen.getByTestId("button-bulk-reject-supporting-docs") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Sanity: "Approve all" is also self-disabled while busy
    expect(
      (screen.getByTestId("button-bulk-approve-supporting-docs") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables 'Approve all' while a bulk reject is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight bulk reject)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });

    render(<SupportingDocumentsTab />);

    // Wait for docs to load
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-reject-supporting-docs")).toBeTruthy(),
    );

    // Click "Reject all" — sets bulkRejectConfirming=true, button hides, confirmation panel appears
    fireEvent.click(screen.getByTestId("button-bulk-reject-supporting-docs"));

    // Confirmation panel and confirm button appear
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-reject-confirm-supporting-docs")).toBeTruthy(),
    );

    // Click "Confirm rejection" — PATCHes hang so bulkRejecting stays true
    fireEvent.click(screen.getByTestId("button-bulk-reject-confirm-supporting-docs"));

    // The confirm button switches to "Rejecting…" confirming bulkRejecting = true
    await waitFor(() =>
      expect(
        screen.getByTestId("button-bulk-reject-confirm-supporting-docs").textContent,
      ).toContain("Rejecting"),
    );

    // anyBulkBusy = true → "Approve all" must be disabled
    expect(
      (screen.getByTestId("button-bulk-approve-supporting-docs") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — single-row action interlock (Task #687)
//
// `anyBulkBusy` only covers the bulk/selection flags; the single-row approve /
// reject path instead sets `actingId`. Both bulk buttons carry
// `disabled={anyBulkBusy || actingId !== null}`, so a single-row action in
// flight must also disable "Approve all" and "Reject all". Task #621 covers the
// bulk-busy leg — these tests lock in the `actingId !== null` leg.
//
// The row-level PATCH is held open forever (never-resolving promise) so the
// component stays in the in-flight state (actingId !== null) while we assert.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – single-row action interlock (Task #687)", () => {
  it("disables 'Approve all' and 'Reject all' while a single-row approve is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row approve)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });

    render(<SupportingDocumentsTab />);

    // Wait for docs to load — both bulk buttons + the row action buttons appear
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-approve-supporting-docs")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId(`button-approve-supporting-doc-${TAB_DOC_A.id}`)).toBeTruthy(),
    );

    // Trigger a single-row approve — the PATCH hangs so actingId stays set.
    // (DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(
      screen.getByTestId(`button-approve-supporting-doc-${TAB_DOC_A.id}`),
    );

    // actingId !== null → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-bulk-approve-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("button-bulk-reject-supporting-docs") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables 'Approve all' and 'Reject all' while a single-row reject is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row reject)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });

    render(<SupportingDocumentsTab />);

    // Wait for docs to load — both bulk buttons + the row reject button appear
    await waitFor(() =>
      expect(screen.getByTestId("button-bulk-reject-supporting-docs")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId(`button-reject-supporting-doc-${TAB_DOC_A.id}`)).toBeTruthy(),
    );

    // Click the row "Reject" — expands the inline notes + confirm row (no PATCH yet)
    fireEvent.click(
      screen.getByTestId(`button-reject-supporting-doc-${TAB_DOC_A.id}`),
    );
    const confirmBtn = await screen.findByTestId(
      `button-confirm-reject-supporting-doc-${TAB_DOC_A.id}`,
    );

    // Confirm the rejection — the PATCH hangs so actingId stays set.
    // (DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(confirmBtn);

    // actingId !== null → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("button-bulk-approve-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("button-bulk-reject-supporting-docs") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — single-row action interlock (Task #752)
//
// The popover's `isBusy` flag covers both legs:
//   isBusy = bulkApproving || bulkRejecting || actingId !== null
// Both "Approve all" and "Reject all" carry `disabled={isBusy}`, so a single-row
// approve / reject in flight (which sets `actingId`) must also disable the bulk
// buttons. Task #439/#442 cover the bulk legs — these tests lock in the
// `actingId !== null` leg for the per-case popover.
//
// The row-level PATCH is held open forever (never-resolving promise) so the
// component stays in the in-flight state (actingId !== null) while we assert.
// ---------------------------------------------------------------------------

describe("SupportingDocsQuickPopover – single-row action interlock (Task #752)", () => {
  it("disables 'Approve all' and 'Reject all' while a single-row approve is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row approve)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for docs to load — both bulk buttons + the row action buttons appear
    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId(`popover-user-doc-approve-${DOC_A.id}`)).toBeTruthy(),
    );

    // Trigger a single-row approve — the PATCH hangs so actingId stays set.
    // (DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_A.id}`));

    // actingId !== null → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables 'Approve all' and 'Reject all' while a single-row reject is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row reject)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      });

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={2}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for docs to load — both bulk buttons + the row reject button appear
    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-reject-case-abc")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId(`popover-user-doc-reject-${DOC_A.id}`)).toBeTruthy(),
    );

    // The row "Reject" calls act() directly — the PATCH hangs so actingId stays set.
    // (DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(screen.getByTestId(`popover-user-doc-reject-${DOC_A.id}`));

    // actingId !== null → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — single-row action interlock (Task #752)
//
// The panel's `isBusy` flag covers every leg:
//   isBusy = bulkApproving || bulkRejecting || actingId !== null
//            || selectionApproving || selectionRejecting
// Both "Approve all" and "Reject all" carry `disabled={isBusy}`, so a single-row
// approve / reject in flight (which sets `actingId`) must also disable the bulk
// buttons. Task #525 covers the bulk-busy legs — these tests lock in the
// `actingId !== null` leg for the per-case detail panel.
//
// The row-level PATCH is held open forever (never-resolving promise) so the
// component stays in the in-flight state (actingId !== null) while we assert.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsPanel – single-row action interlock (Task #752)", () => {
  it("disables 'Approve all' and 'Reject all' while a single-row approve is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row approve)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Wait for docs to load — both bulk buttons become visible
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    // Expand the first row to reveal its inline approve/reject buttons
    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowApprove = await screen.findByTestId(
      `button-panel-approve-${PANEL_DOC_A.id}`,
    );

    // Trigger a single-row approve — the PATCH hangs so actingId stays set.
    // (PANEL_DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(rowApprove);

    // actingId !== null → isBusy → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables 'Approve all' and 'Reject all' while a single-row reject is in flight", async () => {
    // GET resolves immediately; PATCHes never settle (simulates in-flight row reject)
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return new Promise<never>(() => {});
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
      });

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Wait for docs to load — both bulk buttons become visible
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-reject")).toBeTruthy(),
    );

    // Expand the first row to reveal its inline approve/reject buttons
    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowReject = await screen.findByTestId(
      `button-panel-reject-${PANEL_DOC_A.id}`,
    );

    // The row "Reject" calls act() directly — the PATCH hangs so actingId stays set.
    // (PANEL_DOC_B remains actionable, so the bulk buttons stay rendered.)
    fireEvent.click(rowReject);

    // actingId !== null → isBusy → "Approve all" must become disabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    // …and "Reject all" must be disabled too
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — Array.isArray guard on reload (Task #524)
// ---------------------------------------------------------------------------
//
// Task #524 added `Array.isArray(raw) ? raw : []` inside `load()` so the
// component does not crash when the reload response is a non-array (e.g. an
// error object).  This describe block locks in that guard so any future
// regression is caught immediately.

describe("SupportingDocumentsPanel – non-array reload guard (Task #524)", () => {
  it("does not crash and shows an empty list when the reload after 'Reject all' returns a non-array body", async () => {
    const onActioned = vi.fn();
    let getCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ok: true }));
        }
        getCallCount += 1;
        if (getCallCount === 1) {
          // Initial load — return a valid array so the bulk-reject button appears
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
        }
        // Reload after bulk-reject — 200 OK but body is a non-array object.
        // This exercises the `Array.isArray(raw) ? raw : []` guard in load().
        return Promise.resolve(
          jsonOk({ error: "Internal Server Error" }),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // Wait for initial load
    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    // onActioned fires in the finally block — wait for that to confirm the
    // bulk-reject flow completed (including the reload attempt)
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // The component must not have thrown ("docs.reduce is not a function" etc.)
    // and the doc list must be empty — neither filename appears in the DOM.
    expect(screen.queryByText("id-card.jpg")).toBeNull();
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();

    // The reload fetch was issued (at least 2 GET calls: initial load + reload)
    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) =>
        !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not crash and shows an empty list when the reload returns a non-array after a partial failure", async () => {
    const onActioned = vi.fn();
    let patchCount = 0;
    let getCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        getCallCount += 1;
        if (getCallCount === 1) {
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
        }
        // Reload returns 200 OK but with a non-array body — exercises the guard
        return Promise.resolve(jsonOk({ message: "unexpected non-array" }));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // No crash — neither doc filename appears in the DOM
    expect(screen.queryByText("id-card.jpg")).toBeNull();
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — non-OK reload guard (Task #648)
// ---------------------------------------------------------------------------
//
// Task #524 fixed the happy-path guard (Array.isArray). Task #648 extends the
// protection to the non-OK branch: when the server returns a non-2xx status,
// load() now calls setDocs([]) in its catch block so stale docs are not left
// on screen.

describe("SupportingDocumentsPanel – non-OK reload guard (Task #648)", () => {
  it("clears the doc list when the initial load returns a non-OK status", async () => {
    const onActioned = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      );

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    // The component should not show any stale docs and must not crash
    await waitFor(() =>
      expect(screen.queryByText("id-card.jpg")).toBeNull(),
    );
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();
  });

  it("clears the doc list when the reload after 'Reject all' returns a non-OK status", async () => {
    const onActioned = vi.fn();
    let getCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ok: true }));
        }
        getCallCount += 1;
        if (getCallCount === 1) {
          // Initial load — return a valid array so the bulk-reject button appears
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B]));
        }
        // Reload after bulk-reject — non-2xx status so load() throws before
        // Array.isArray is reached; the catch block must call setDocs([]).
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }) as unknown as Response,
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={onActioned}
      />,
    );

    const rejectAllBtn = await screen.findByTestId("panel-bulk-reject");
    fireEvent.click(rejectAllBtn);
    const confirmBtn = await screen.findByTestId("panel-bulk-reject-confirm-btn");
    fireEvent.click(confirmBtn);

    // onActioned fires in the finally block — wait for that to confirm the
    // bulk-reject flow completed (including the failed reload attempt)
    await waitFor(() => expect(onActioned).toHaveBeenCalledTimes(1));

    // The stale docs must be cleared — not left on screen from the initial load
    expect(screen.queryByText("id-card.jpg")).toBeNull();
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — reject selected server-reload (Task #601)
// ---------------------------------------------------------------------------
//
// rejectSelected calls `await load()` in its finally block (added by Task #601)
// so the cross-case inbox always reflects the real server state after the batch
// completes. The existing Task #446 tests only verify loadUserDocPendingCounts
// — they do not assert that the GET reload fires. These tests close that gap
// by counting fetch calls and verifying the UI reflects server-confirmed state.

describe("SupportingDocumentsTab – reject selected server reload (Task #601)", () => {
  // Count GET calls at a given point in time (excludes PATCHes).
  const getCount = (mock: ReturnType<typeof vi.fn>) =>
    (mock.mock.calls as [unknown, { method?: string } | undefined][]).filter(
      ([, opts]) =>
        !opts?.method || opts.method === "GET",
    ).length;

  it("calls load() after select-all + 'Reject selected' — one extra GET fires after PATCHes settle", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return Promise.resolve(jsonOk({ ok: true }));
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Wait for initial load(s) to settle, then snapshot the baseline GET count.
    await screen.findByTestId("checkbox-select-all-supporting-docs");
    const getsBefore = getCount(fetchMock);

    fireEvent.click(screen.getByTestId("checkbox-select-all-supporting-docs"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    // Exactly one new GET must fire (the reload) — delta proves it, not total count.
    await waitFor(() =>
      expect(getCount(fetchMock)).toBe(getsBefore + 1),
    );
    // The reload must target the cross-case user-documents endpoint.
    const lastGet = (fetchMock.mock.calls as [unknown, { method?: string } | undefined][])
      .filter(([, opts]) =>
        !opts?.method || opts.method === "GET",
      )
      .at(-1) as unknown as [string];
    expect(lastGet[0]).toContain("/api/user-documents");
  });

  it("reflects server-only state after reload — a doc returned only by the server appears in the list", async () => {
    // SEL_DOC_C (id 30) is NOT in the pre-reject list; the reload returns it instead.
    // After optimistic reject of A+B, those rows stay in docs (status=rejected).
    // Only after the server reload does C appear — proving server state won.
    const SEL_DOC_C = { ...SEL_DOC_A, id: 30, fileName: "server-only.pdf" };
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          return Promise.resolve(jsonOk({ ok: true }));
        }
        // Initial GETs (before both PATCHes) return A+B; reload returns only C.
        return Promise.resolve(
          jsonOk(patchCount >= 2 ? [SEL_DOC_C] : [SEL_DOC_A, SEL_DOC_B]),
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const selectAll = await screen.findByTestId("checkbox-select-all-supporting-docs");
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    // C can only appear if the reload GET fired and its result was applied.
    await screen.findByTestId("checkbox-supporting-doc-30");
    // A and B must be gone because the server returned only C.
    expect(screen.queryByTestId("checkbox-supporting-doc-20")).toBeNull();
  });

  it("calls load() after a partial failure — one extra GET fires after PATCHes settle", async () => {
    let patchCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          patchCount += 1;
          return patchCount === 1
            ? Promise.resolve(jsonOk({ ok: true }))
            : Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await screen.findByTestId("checkbox-select-all-supporting-docs");
    const getsBefore = getCount(fetchMock);

    fireEvent.click(screen.getByTestId("checkbox-select-all-supporting-docs"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    await waitFor(() =>
      expect(getCount(fetchMock)).toBe(getsBefore + 1),
    );
  });

  it("calls load() even when all PATCHes fail — one extra GET fires", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await screen.findByTestId("checkbox-select-all-supporting-docs");
    const getsBefore = getCount(fetchMock);

    fireEvent.click(screen.getByTestId("checkbox-select-all-supporting-docs"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    await waitFor(() =>
      expect(getCount(fetchMock)).toBe(getsBefore + 1),
    );
  });

  it("calls load() even when PATCHes throw network errors — one extra GET fires", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(jsonOk([SEL_DOC_A, SEL_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await screen.findByTestId("checkbox-select-all-supporting-docs");
    const getsBefore = getCount(fetchMock);

    fireEvent.click(screen.getByTestId("checkbox-select-all-supporting-docs"));
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    fireEvent.click(await screen.findByTestId("button-selection-reject-confirm-supporting-docs"));

    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    const getCalls = ((fetchMock.mock.calls as any[][]) as any).filter(
      ([, opts]: [unknown, { method?: string } | undefined]) => !opts?.method || opts.method === "GET",
    );
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — scroll-to-selection (Task #577)
//
// Task #507 restores the scroll position after a filter-triggered reload and
// adds a manual "Scroll to selection" toolbar button. These tests lock in both
// behaviours by asserting scrollIntoView is invoked for the previously-selected
// row.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – scroll to selection (Task #577)", () => {
  it("scrolls the previously-selected row into view after a status-filter change", async () => {
    // Both docs are 'uploaded', so they survive a change to the 'all' filter
    // (overlap path) and the first-selected row should be scrolled back. Return
    // a fresh Response per call — a Response body can only be read once, so a
    // shared instance would throw on the second/third reload.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B])));

    // The post-reload scroll runs inside requestAnimationFrame; run it
    // synchronously so the assertion doesn't depend on flushing the rAF queue
    // under fake timers.
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const scrollSpy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});

    render(<SupportingDocumentsTab />);

    // Wait for the rows to render, then select the first one.
    const checkbox = await screen.findByTestId("checkbox-supporting-doc-10");
    fireEvent.click(checkbox);

    scrollSpy.mockClear();

    // Change the status filter from 'uploaded' to 'all' (overlap path).
    const statusSelect = screen.getByTestId(
      "select-filter-supporting-status-native",
    );
    fireEvent.change(statusSelect, { target: { value: "all" } });

    // After the reload settles, the first selected row is scrolled into view.
    const selectedRow = await screen.findByTestId("row-supporting-doc-10");
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
      expect(scrollSpy.mock.instances).toContain(selectedRow);
    });
    rafSpy.mockRestore();
  });

  it("scrolls the first selected row into view when the toolbar button is clicked", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(jsonOk([TAB_DOC_A, TAB_DOC_B]));

    const scrollSpy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});

    render(<SupportingDocumentsTab />);

    // Select the second row so we can assert the button targets *that* row.
    const checkbox = await screen.findByTestId("checkbox-supporting-doc-11");
    fireEvent.click(checkbox);

    scrollSpy.mockClear();

    const scrollBtn = await screen.findByTestId(
      "button-scroll-to-first-selected-supporting-docs",
    );
    fireEvent.click(scrollBtn);

    const selectedRow = screen.getByTestId("row-supporting-doc-11");
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.instances).toContain(selectedRow);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — cancel-button guard keeps panel open during bulk reject
//
// The bulk-reject confirmation panel uses an inline div rather than a Radix
// Dialog, so there is no `onOpenChange` callback to guard.  The equivalent
// lock is `disabled={bulkRejecting}` on the Cancel button, which blocks any
// dismissal while PATCHes are in flight.  These tests verify that guard so
// an accidental removal is caught before it ships.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab – confirm panel stays open while bulk reject is in flight", () => {
  it("clicking Cancel while the PATCH batch is pending does not close the panel", async () => {
    // A PATCH that never settles — keeps bulkRejecting true.
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Open the confirmation panel.
    const rejectAllBtn = await screen.findByTestId(
      "button-bulk-reject-supporting-docs",
    );
    fireEvent.click(rejectAllBtn);

    // Confirm — fires the PATCHes and keeps bulkRejecting = true.
    const confirmBtn = await screen.findByTestId(
      "button-bulk-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // Wait for the mutation to be in flight (Cancel button becomes disabled).
    const cancelBtn = await screen.findByTestId(
      "button-bulk-reject-cancel-supporting-docs",
    );
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Attempt to dismiss via the (now-disabled) Cancel button.
    // The disabled guard must block this while bulkRejecting is true.
    fireEvent.click(cancelBtn);

    // The panel must still be mounted — both action buttons remain visible.
    expect(
      screen.queryByTestId("panel-bulk-reject-confirm-supporting-docs"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("button-bulk-reject-confirm-supporting-docs"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("button-bulk-reject-cancel-supporting-docs"),
    ).not.toBeNull();

    // Settle the pending PATCHes so React can clean up state.
    resolveReject(
      new Response(JSON.stringify({ ...TAB_DOC_A, status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("panel closes normally after the bulk reject settles", async () => {
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    const rejectAllBtn = await screen.findByTestId(
      "button-bulk-reject-supporting-docs",
    );
    fireEvent.click(rejectAllBtn);

    const confirmBtn = await screen.findByTestId(
      "button-bulk-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // Wait until the mutation is in flight (Cancel button is disabled).
    const cancelBtn = await screen.findByTestId(
      "button-bulk-reject-cancel-supporting-docs",
    );
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the PATCH — the mutation settles and the guard is lifted.
    resolveReject(
      new Response(JSON.stringify({ ...TAB_DOC_A, status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation settles the panel closes (setBulkRejectConfirming(false)
    // is called in the finally block).
    await waitFor(() => {
      expect(
        screen.queryByTestId("panel-bulk-reject-confirm-supporting-docs"),
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — selection-level reject panel dismiss-guard
// ---------------------------------------------------------------------------
//
// The selection-level "Reject selected" flow (selectionRejectConfirming /
// selectionRejecting states) has the same disabled={selectionRejecting} guard
// on its Cancel button as the visible-docs bulk-reject panel.  These tests
// verify the guard holds during in-flight PATCHes so the panel cannot be
// dismissed mid-mutation.

describe("SupportingDocumentsTab – selection-level reject panel dismiss-guard", () => {
  it("clicking Cancel while PATCHes are pending does not close the panel", async () => {
    // A PATCH that never settles — keeps selectionRejecting true.
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select all actionable docs so the selection toolbar appears.
    const selectAllCb = await screen.findByTestId(
      "checkbox-select-all-supporting-docs",
    );
    fireEvent.click(selectAllCb);

    // Open the selection-level rejection confirmation panel.
    fireEvent.click(
      screen.getByTestId("button-reject-selected-supporting-docs"),
    );

    // Confirm — fires the PATCHes and keeps selectionRejecting = true.
    const confirmBtn = await screen.findByTestId(
      "button-selection-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // Wait for the mutation to be in flight (Cancel button becomes disabled).
    const cancelBtn = await screen.findByTestId(
      "button-selection-reject-cancel-supporting-docs",
    );
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Attempt to dismiss via the (now-disabled) Cancel button.
    // The disabled guard must block this while selectionRejecting is true.
    fireEvent.click(cancelBtn);

    // The panel must still be mounted — both action buttons remain visible.
    expect(
      screen.queryByTestId("panel-selection-reject-confirm-supporting-docs"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("button-selection-reject-confirm-supporting-docs"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("button-selection-reject-cancel-supporting-docs"),
    ).not.toBeNull();

    // Settle the pending PATCHes so React can clean up state.
    resolveReject(
      new Response(JSON.stringify({ ...TAB_DOC_A, status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("panel closes normally after the mutation settles", async () => {
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select all actionable docs.
    const selectAllCb = await screen.findByTestId(
      "checkbox-select-all-supporting-docs",
    );
    fireEvent.click(selectAllCb);

    // Open the confirmation panel.
    fireEvent.click(
      screen.getByTestId("button-reject-selected-supporting-docs"),
    );

    // Confirm — fires the PATCHes.
    const confirmBtn = await screen.findByTestId(
      "button-selection-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // Wait until the mutation is in flight (Cancel button is disabled).
    const cancelBtn = await screen.findByTestId(
      "button-selection-reject-cancel-supporting-docs",
    );
    await waitFor(() => {
      expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
    });

    // Resolve the PATCH — the mutation settles and the guard is lifted.
    resolveReject(
      new Response(JSON.stringify({ ...TAB_DOC_A, status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the mutation settles the panel closes (setSelectionRejectConfirming(false)
    // is called in the finally block).
    await waitFor(() => {
      expect(
        screen.queryByTestId("panel-selection-reject-confirm-supporting-docs"),
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — non-OK reload guard (Task #737)
// ---------------------------------------------------------------------------
//
// Task #648 fixed the non-OK reload guard in SupportingDocumentsPanel (per-case
// panel). Task #737 applies the same protection to SupportingDocumentsTab (the
// cross-case inbox): when load() receives a non-2xx status it throws before
// Array.isArray is reached, and the catch block must call setDocs([]) so stale
// rows are not left on screen.

describe("SupportingDocumentsTab – non-OK reload guard (Task #737)", () => {
  it("clears the doc list when the initial load returns a non-OK status", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      );

    render(<SupportingDocumentsTab />);

    // The component must not show any stale docs and must not crash
    await waitFor(() =>
      expect(screen.queryByText("passport.pdf")).toBeNull(),
    );
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();
  });

  it("clears the doc list when the reload after 'Reject selected' returns a non-OK status", async () => {
    // rejectSelected() calls `await load()` in its finally block (Task #601).
    // If that reload returns non-2xx, load()'s catch block must call setDocs([])
    // so stale docs are not left on screen.
    let getCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...TAB_DOC_A, status: "rejected" }));
        }
        getCallCount += 1;
        if (getCallCount === 1) {
          // Initial load — return a valid array so rows and checkboxes appear
          return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
        }
        // Reload after reject-selected — non-2xx so load() throws before
        // Array.isArray is reached; the catch block must call setDocs([]).
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }) as unknown as Response,
        );
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select all and trigger "Reject selected"
    const selectAllCb = await screen.findByTestId(
      "checkbox-select-all-supporting-docs",
    );
    fireEvent.click(selectAllCb);
    fireEvent.click(screen.getByTestId("button-reject-selected-supporting-docs"));
    const confirmBtn = await screen.findByTestId(
      "button-selection-reject-confirm-supporting-docs",
    );
    fireEvent.click(confirmBtn);

    // loadUserDocPendingCounts fires in the finally block — wait for it to
    // confirm the reject-selected flow (including the failed reload) completed.
    await waitFor(() =>
      expect(loadUserDocPendingCountsMock).toHaveBeenCalledTimes(1),
    );

    // Stale docs must be cleared by the catch block — not left on screen
    expect(screen.queryByText("passport.pdf")).toBeNull();
    expect(screen.queryByText("bank-statement.pdf")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SupportingDocsQuickPopover — single-row act() re-enables bulk buttons (Task #789)
//
// Contracts under test:
//   After a single-row approve or reject settles (success OR failure), `actingId`
//   is cleared in the `finally` block → `isBusy` returns to false → "Approve all"
//   and "Reject all" are no longer disabled (assuming ≥2 actionable docs remain).
//   A regression that left `actingId` set would silently lock admins out of bulk
//   actions with no existing test catching it.
//
// Three docs are used so that after one row is approved/rejected (and removed on
// success, or kept on failure) at least two actionable docs remain — keeping the
// bulk buttons rendered and visible for the assertion.
// ---------------------------------------------------------------------------

describe("SupportingDocsQuickPopover – single-row act re-enables bulk buttons (Task #789)", () => {
  it("re-enables 'Approve all' and 'Reject all' after a single-row approve succeeds", async () => {
    // DOC_A (id=1) is approved (removed from list); DOC_B + DOC_C stay → 2 remain
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ok: true }));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B, DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    // Wait for the popover to load all three docs
    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );

    // Trigger a single-row approve on the first doc
    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_A.id}`));

    // After the PATCH settles, actingId clears → isBusy=false → buttons enabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row approve fails (non-OK PATCH)", async () => {
    // PATCH returns 500 → doc stays → 3 docs remain → bulk buttons visible + enabled
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Internal Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B, DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`popover-user-doc-approve-${DOC_A.id}`));

    // finally block clears actingId even on failure
    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row reject succeeds", async () => {
    // DOC_A (id=1) is rejected (removed from list); DOC_B + DOC_C stay → 2 remain
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ok: true }));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B, DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`popover-user-doc-reject-${DOC_A.id}`));

    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row reject fails (non-OK PATCH)", async () => {
    // PATCH returns 403 → doc stays → 3 docs remain → bulk buttons visible + enabled
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([DOC_A, DOC_B, DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocsQuickPopover
        caseId="case-abc"
        count={3}
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("badge-user-doc-pending-case-abc"));

    await waitFor(() =>
      expect(screen.getByTestId("popover-bulk-approve-case-abc")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`popover-user-doc-reject-${DOC_A.id}`));

    await waitFor(() =>
      expect(
        (screen.getByTestId("popover-bulk-approve-case-abc") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("popover-bulk-reject-case-abc") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — single-row act() re-enables bulk buttons (Task #789)
//
// Mirrors the Popover suite above but for the full per-case detail panel.
// Three docs are used (PANEL_DOC_A, PANEL_DOC_B, and PANEL_DOC_C defined below)
// so that at least two actionable docs remain after the row action, keeping the
// "Approve all" / "Reject all" buttons rendered for the assertion.
//
// The Panel's `act()` function calls `await load()` inside the try block (only
// on success), then clears actingId in `finally`. The GET mock tracks call
// count so the initial load returns 3 docs and the post-success reload returns
// 2 docs (the acting doc removed by the server).
// ---------------------------------------------------------------------------

const PANEL_DOC_C = {
  ...PANEL_DOC_A,
  id: 101,
  fileName: "utility-bill.pdf",
  fileType: "application/pdf",
};

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — approveSelected / rejectSelected re-enable bulk
// buttons (Task #1497)
//
// Contracts under test:
//   After approveSelected() or rejectSelected() settles (success OR failure),
//   `selectionApproving` / `selectionRejecting` is cleared in the `finally`
//   block → `isBusy` returns to false → "Approve all" and "Reject all" are no
//   longer disabled (assuming ≥2 actionable docs remain).
//
// Three docs are used so that after one selected doc is approved/rejected (and
// reloaded from the server), at least two actionable docs remain — keeping the
// bulk buttons rendered and visible for the assertion.
// ---------------------------------------------------------------------------

describe("SupportingDocumentsPanel – approveSelected re-enables bulk buttons (Task #1497)", () => {
  it("re-enables 'Approve all' and 'Reject all' after approveSelected() succeeds", async () => {
    let getCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...PANEL_DOC_A, status: "approved" }));
        }
        getCount += 1;
        if (getCount === 1) {
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`checkbox-panel-doc-${PANEL_DOC_A.id}`));
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after approveSelected() fails (non-OK PATCH)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Internal Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`checkbox-panel-doc-${PANEL_DOC_A.id}`));
    fireEvent.click(screen.getByTestId("button-panel-approve-selected"));

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("SupportingDocumentsPanel – rejectSelected re-enables bulk buttons (Task #1497)", () => {
  it("re-enables 'Approve all' and 'Reject all' after rejectSelected() succeeds", async () => {
    let getCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...PANEL_DOC_A, status: "rejected" }));
        }
        getCount += 1;
        if (getCount === 1) {
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`checkbox-panel-doc-${PANEL_DOC_A.id}`));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));

    const confirmBtn = await screen.findByTestId("button-panel-selection-reject-confirm");
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after rejectSelected() fails (non-OK PATCH)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`checkbox-panel-doc-${PANEL_DOC_A.id}`));
    fireEvent.click(screen.getByTestId("button-panel-reject-selected"));

    const confirmBtn = await screen.findByTestId("button-panel-selection-reject-confirm");
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("SupportingDocumentsPanel – single-row act re-enables bulk buttons (Task #789)", () => {
  it("re-enables 'Approve all' and 'Reject all' after a single-row approve succeeds", async () => {
    // Initial GET → 3 docs. PATCH succeeds → load() fires → second GET → 2 docs.
    // After the reload settles, actingId=null → isBusy=false → buttons enabled.
    let getCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...PANEL_DOC_A, status: "approved" }));
        }
        getCount += 1;
        if (getCount === 1) {
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
        }
        // Reload after success — return the two remaining docs so pendingDocs.length≥2
        return Promise.resolve(jsonOk([PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Wait for docs to load — bulk buttons need pendingDocs.length≥2
    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    // Expand PANEL_DOC_A to reveal the inline approve/reject buttons
    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowApprove = await screen.findByTestId(
      `button-panel-approve-${PANEL_DOC_A.id}`,
    );
    fireEvent.click(rowApprove);

    // After the PATCH + reload settle, actingId clears → buttons re-enabled
    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row approve fails (non-OK PATCH)", async () => {
    // PATCH returns 500 → load() is NOT called → 3 docs remain → buttons visible + enabled
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Internal Server Error" }, 500));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowApprove = await screen.findByTestId(
      `button-panel-approve-${PANEL_DOC_A.id}`,
    );
    fireEvent.click(rowApprove);

    // finally block clears actingId even on failure → isBusy=false
    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row reject succeeds", async () => {
    // Initial GET → 3 docs. PATCH succeeds → load() fires → second GET → 2 docs.
    let getCount = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ ...PANEL_DOC_A, status: "rejected" }));
        }
        getCount += 1;
        if (getCount === 1) {
          return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowReject = await screen.findByTestId(
      `button-panel-reject-${PANEL_DOC_A.id}`,
    );
    fireEvent.click(rowReject);

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("re-enables 'Approve all' and 'Reject all' after a single-row reject fails (non-OK PATCH)", async () => {
    // PATCH returns 403 → load() is NOT called → 3 docs remain → buttons visible + enabled
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") {
          return Promise.resolve(jsonOk({ error: "Forbidden" }, 403));
        }
        return Promise.resolve(jsonOk([PANEL_DOC_A, PANEL_DOC_B, PANEL_DOC_C]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("panel-bulk-approve")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId(`button-panel-expand-${PANEL_DOC_A.id}`));
    const rowReject = await screen.findByTestId(
      `button-panel-reject-${PANEL_DOC_A.id}`,
    );
    fireEvent.click(rowReject);

    await waitFor(() =>
      expect(
        (screen.getByTestId("panel-bulk-approve") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByTestId("panel-bulk-reject") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsTab — selection-level approve toolbar dismiss-guard
// ---------------------------------------------------------------------------
//
// The selection-level "Approve selected" flow (selectionApproving state) uses
// disabled={anyBulkBusy} on the toolbar button, where anyBulkBusy includes
// selectionApproving.  These tests verify the guard holds during in-flight
// PATCHes so the button cannot be clicked again mid-mutation, and that it
// re-enables once the batch settles.

describe("SupportingDocumentsTab – selection-level approve toolbar dismiss-guard", () => {
  it("toolbar 'Approve selected' button is disabled while selection approves are in flight", async () => {
    // A PATCH that never settles — keeps selectionApproving true.
    let resolveApprove!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveApprove = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select all actionable docs so the selection toolbar appears.
    const selectAllCb = await screen.findByTestId(
      "checkbox-select-all-supporting-docs",
    );
    fireEvent.click(selectAllCb);

    // Click "Approve selected" — fires the PATCHes and sets selectionApproving = true.
    const approveBtn = await screen.findByTestId(
      "button-approve-selected-supporting-docs",
    );
    fireEvent.click(approveBtn);

    // While the PATCHes are pending, anyBulkBusy is true so the button must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-approve-selected-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Settle the pending PATCHes so React can clean up state.
    resolveApprove(
      new Response(JSON.stringify({ ...TAB_DOC_A, status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("toolbar re-enables after the selection approve batch settles", async () => {
    // Select only TAB_DOC_A (one doc) so only a single PATCH fires.  Fail
    // that PATCH with 500 so the doc stays "uploaded" and the toolbar remains
    // visible once selectionApproving resets to false in the finally block.
    let resolveApprove!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveApprove = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([TAB_DOC_A, TAB_DOC_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    // Select only TAB_DOC_A via its individual checkbox.
    const checkboxA = await screen.findByTestId(
      `checkbox-supporting-doc-${TAB_DOC_A.id}`,
    );
    fireEvent.click(checkboxA);

    // Click "Approve selected" — fires one PATCH for TAB_DOC_A.
    const approveBtn = await screen.findByTestId(
      "button-approve-selected-supporting-docs",
    );
    fireEvent.click(approveBtn);

    // Wait until the mutation is in flight (button becomes disabled).
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-approve-selected-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Resolve the PATCH with 500 — TAB_DOC_A stays "uploaded" so it remains
    // selected and actionable; the toolbar stays on screen after the batch
    // settles and selectionApproving resets to false.
    resolveApprove(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // After the batch settles, anyBulkBusy becomes false and the button
    // re-enables.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-approve-selected-supporting-docs") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — selection-level approve in-flight guard
// ---------------------------------------------------------------------------
//
// The Panel's "Approve selected" button (selectionApproving state) carries
// disabled={isBusy} where isBusy includes selectionApproving
// || selectionRejecting. These tests verify the guard holds during in-flight
// PATCHes so the button cannot be clicked again mid-mutation, and that it
// re-enables once the batch settles — matching the equivalent Tab suite above.

// ---------------------------------------------------------------------------
// SupportingDocumentsPanel — selection-level reject in-flight guard
// ---------------------------------------------------------------------------
//
// The Panel's "Reject selected" confirm button (selectionRejecting state)
// carries disabled={selectionRejecting} where selectionRejecting is also
// included in isBusy. These tests verify the guard holds during in-flight
// PATCHes so the confirm button cannot be clicked again mid-mutation, and
// that it re-enables once the batch settles — matching the equivalent
// selection-approve guard suite above.

describe("SupportingDocumentsPanel – selection-level reject in-flight guard", () => {
  it("confirm button is disabled while selection rejects are in flight", async () => {
    // A PATCH that never settles — keeps selectionRejecting true.
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Select all actionable docs so the selection toolbar appears.
    const selectAllCb = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAllCb);

    // Open the rejection confirm area.
    const rejectBtn = await screen.findByTestId("button-panel-reject-selected");
    fireEvent.click(rejectBtn);

    // Click the confirm button — fires the PATCHes and sets selectionRejecting = true.
    const confirmBtn = await screen.findByTestId("button-panel-selection-reject-confirm");
    fireEvent.click(confirmBtn);

    // While the PATCHes are pending, selectionRejecting is true so the button must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-selection-reject-confirm") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Settle the pending PATCHes so React can clean up state.
    resolveReject(
      new Response(JSON.stringify({ ...PANEL_SEL_A, status: "rejected" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("button re-enables after the selection reject batch settles", async () => {
    // The Panel's finally block clears the selection and reloads docs, so the
    // toolbar (and its confirm button) disappears after the batch settles.
    // To verify selectionRejecting resets, we re-select docs, re-open the
    // confirm area, and assert the confirm button is enabled — proving
    // selectionRejecting returned to false.
    let resolveReject!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveReject = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        // Every GET (initial load + post-reject reload) returns both docs as
        // "uploaded" so the select-all checkbox is available after the reload.
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Select only PANEL_SEL_A via its individual checkbox.
    const checkboxA = await screen.findByTestId(
      `checkbox-panel-doc-${PANEL_SEL_A.id}`,
    );
    fireEvent.click(checkboxA);

    // Open the rejection confirm area and click confirm — fires one PATCH.
    fireEvent.click(await screen.findByTestId("button-panel-reject-selected"));
    fireEvent.click(await screen.findByTestId("button-panel-selection-reject-confirm"));

    // Wait until the mutation is in flight (confirm button becomes disabled).
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-selection-reject-confirm") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Resolve the PATCH with 500 — the Panel finally block clears the
    // selection, reloads docs, and resets selectionRejecting to false.
    resolveReject(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Wait for the selection to be cleared (toolbar disappears) which signals
    // the finally block finished and selectionRejecting reset to false.
    await waitFor(() => {
      expect(screen.queryByTestId("toolbar-panel-selection")).toBeNull();
    });

    // Re-select docs and re-open confirm area; the confirm button must be
    // enabled, confirming selectionRejecting is false now that the batch settled.
    const selectAllCb = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAllCb);

    fireEvent.click(await screen.findByTestId("button-panel-reject-selected"));

    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-selection-reject-confirm") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });
});

describe("SupportingDocumentsPanel – selection-level approve in-flight guard", () => {
  it("isBusy button is disabled while selection approves are in flight", async () => {
    // A PATCH that never settles — keeps selectionApproving true.
    let resolveApprove!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveApprove = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Select all actionable docs so the selection toolbar appears.
    const selectAllCb = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAllCb);

    // Click "Approve selected" — fires the PATCHes and sets selectionApproving = true.
    const approveBtn = await screen.findByTestId("button-panel-approve-selected");
    fireEvent.click(approveBtn);

    // While the PATCHes are pending, isBusy is true so the button must be disabled.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-approve-selected") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Settle the pending PATCHes so React can clean up state.
    resolveApprove(
      new Response(JSON.stringify({ ...PANEL_SEL_A, status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("button re-enables after the selection approve batch settles", async () => {
    // The Panel's finally block clears the selection and reloads docs, so the
    // toolbar (and its "Approve selected" button) disappears after the batch
    // settles.  To verify isBusy resets, we re-select docs after the reload
    // and assert the button is enabled (not disabled) — proving selectionApproving
    // returned to false.
    let resolveApprove!: (r: Response) => void;
    const pendingPatch = new Promise<Response>((res) => {
      resolveApprove = res;
    });

    const fetchMock = vi
      .fn()
      .mockImplementation((_url: unknown, opts?: { method?: string }) => {
        if (opts?.method === "PATCH") return pendingPatch;
        // Every GET (initial load + post-approve reload) returns both docs as
        // "uploaded" so the select-all checkbox is available after the reload.
        return Promise.resolve(jsonOk([PANEL_SEL_A, PANEL_SEL_B]));
      });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(
      <SupportingDocumentsPanel
        caseId="case-abc"
        authToken="test-token"
        onActioned={vi.fn()}
      />,
    );

    // Select only PANEL_SEL_A via its individual checkbox.
    const checkboxA = await screen.findByTestId(
      `checkbox-panel-doc-${PANEL_SEL_A.id}`,
    );
    fireEvent.click(checkboxA);

    // Click "Approve selected" — fires one PATCH for PANEL_SEL_A.
    fireEvent.click(await screen.findByTestId("button-panel-approve-selected"));

    // Wait until the mutation is in flight (button becomes disabled).
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-approve-selected") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // Resolve the PATCH with 500 — the Panel finally block clears the
    // selection, reloads docs, and resets selectionApproving to false.
    resolveApprove(
      new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Wait for the selection to be cleared (toolbar disappears) which signals
    // the finally block finished and selectionApproving reset to false.
    await waitFor(() => {
      expect(screen.queryByTestId("toolbar-panel-selection")).toBeNull();
    });

    // Re-select docs to make the toolbar reappear; the button must be enabled,
    // confirming isBusy is false now that the batch has fully settled.
    const selectAllCb = await screen.findByTestId("checkbox-panel-select-all");
    fireEvent.click(selectAllCb);

    await waitFor(() => {
      expect(
        (screen.getByTestId("button-panel-approve-selected") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });
});
