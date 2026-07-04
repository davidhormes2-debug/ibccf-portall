// @vitest-environment jsdom
//
// Task #626 — Protect against ghost selections in the Supporting Documents tab.
//
// The SupportingDocumentsTab prunes stale selectedIds inline inside load():
//   const newIdSet = new Set(data.map((d) => d.id));
//   setSelectedIds((prev) => new Set([...prev].filter((id) => newIdSet.has(id))));
//
// This file pins that behaviour across three layers of coverage:
//
//   1. Static source assertions — verify the pruning pattern exists in
//      SupportingDocumentsTab.tsx.
//
//   2. Functional harness — a slim self-contained React component that
//      replicates the state + inline pruning so we can drive the lifecycle
//      deterministically without rendering the full component tree.
//
//   3. Full component test — renders the real <SupportingDocumentsTab> and
//      simulates a server reload that removes a selected document, asserting
//      the toolbar count drops correctly.

import React, { useEffect, useState } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Module mocks — must appear before component imports.
// ---------------------------------------------------------------------------

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
      userDocPendingCounts: {},
      loadUserDocPendingCounts: loadUserDocPendingCountsMock,
    }),
  };
});

import { SupportingDocumentsTab } from "../tabs/SupportingDocumentsTab";

// ---------------------------------------------------------------------------
// Static source
// ---------------------------------------------------------------------------

const TAB_SRC = fs.readFileSync(
  path.resolve(__dirname, "../tabs/SupportingDocumentsTab.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SupportingDoc {
  id: number;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  category: string;
  description: null;
  status: string;
  adminNotes: null;
  reviewedAt: null;
  reviewedBy: null;
  uploadedAt: string;
}

function makeDoc(
  id: number,
  fileName: string,
  caseId = "case-abc",
  status = "uploaded",
): SupportingDoc {
  return {
    id,
    caseId,
    fileName,
    fileType: "application/pdf",
    fileSize: "10 KB",
    category: "kyc_id",
    description: null,
    status,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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
// 1. Static source assertions
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab.tsx — ghost-selection pruning (static)", () => {
  it("builds a newIdSet from the loaded data inside load()", () => {
    expect(TAB_SRC).toContain("newIdSet");
    expect(TAB_SRC).toContain("data.map((d) => d.id)");
  });

  it("calls setSelectedIds with a filter keyed to newIdSet.has(id)", () => {
    expect(TAB_SRC).toContain("newIdSet.has(id)");
  });

  it("the pruning runs inside load() alongside setDocs", () => {
    const setDocsIdx = TAB_SRC.indexOf("setDocs(data)");
    expect(setDocsIdx).toBeGreaterThan(-1);
    const setSelectedIdx = TAB_SRC.indexOf("newIdSet.has(id)");
    expect(setSelectedIdx).toBeGreaterThan(-1);
    const between = Math.abs(setSelectedIdx - setDocsIdx);
    expect(between).toBeLessThan(500);
  });

  it("attributes the pruning behaviour to Task #455 in a comment", () => {
    expect(TAB_SRC).toContain("Task #455");
  });
});

// ---------------------------------------------------------------------------
// 2. Functional harness — replicates inline pruning from load()
// ---------------------------------------------------------------------------

interface HarnessProps {
  initialDocs: SupportingDoc[];
}

/**
 * Slim harness that mirrors the selectedIds state and inline pruning from
 * SupportingDocumentsTab.load() without requiring the full component tree.
 *
 * The "Reload" button simulates a server fetch that returns a new doc list;
 * after updating docs it prunes selectedIds exactly as load() does.
 */
function SelectionPruningHarness({ initialDocs }: HarnessProps) {
  const [docs, setDocs] = useState<SupportingDoc[]>(initialDocs);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [nextDocs, setNextDocs] = useState<SupportingDoc[]>(initialDocs);

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const simulateLoad = (incoming: SupportingDoc[]) => {
    setDocs(incoming);
    const newIdSet = new Set(incoming.map((d) => d.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => newIdSet.has(id))));
  };

  return (
    <div>
      {docs.map((doc) => (
        <div key={doc.id} data-testid={`row-${doc.id}`}>
          <input
            type="checkbox"
            data-testid={`checkbox-${doc.id}`}
            checked={selectedIds.has(doc.id)}
            onChange={() => toggle(doc.id)}
          />
          <span>{doc.fileName}</span>
        </div>
      ))}
      <button
        data-testid="reload-without-doc-2"
        onClick={() => simulateLoad(nextDocs)}
      >
        Reload
      </button>
      <span data-testid="selected-count">{selectedIds.size}</span>
      {selectedIds.size > 0 && (
        <span data-testid="toolbar-count">{selectedIds.size} selected</span>
      )}
    </div>
  );
}

const DOC_A = makeDoc(10, "passport.pdf");
const DOC_B = makeDoc(11, "bank-statement.pdf");
const DOC_C = makeDoc(12, "utility-bill.pdf");

/**
 * Wrapper that lets us drive nextDocs externally for controlled reload tests.
 */
function ControlledHarness({
  initial,
  reloaded,
}: {
  initial: SupportingDoc[];
  reloaded: SupportingDoc[];
}) {
  const [docs, setDocs] = useState<SupportingDoc[]>(initial);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const simulateLoad = () => {
    setDocs(reloaded);
    const newIdSet = new Set(reloaded.map((d) => d.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => newIdSet.has(id))));
  };

  return (
    <div>
      {docs.map((doc) => (
        <div key={doc.id} data-testid={`row-${doc.id}`}>
          <input
            type="checkbox"
            data-testid={`checkbox-${doc.id}`}
            checked={selectedIds.has(doc.id)}
            onChange={() => toggle(doc.id)}
          />
        </div>
      ))}
      <button data-testid="btn-reload" onClick={simulateLoad}>
        Reload
      </button>
      <span data-testid="selected-count">{selectedIds.size}</span>
      {selectedIds.size > 0 && (
        <span data-testid="toolbar">{selectedIds.size} selected</span>
      )}
    </div>
  );
}

describe("SelectionPruningHarness — ghost-selection removal", () => {
  it("starts with zero selected", () => {
    render(<ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_B]} />);
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("selecting two docs shows count 2", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_B]} />);

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));

    expect(screen.getByTestId("selected-count").textContent).toBe("2");
  });

  it("a reload that drops a selected doc prunes the count from 2 to 1", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_C]} />,
    );

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    await user.click(screen.getByTestId("btn-reload"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("the surviving doc's checkbox remains checked after pruning", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_C]} />,
    );

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));

    await user.click(screen.getByTestId("btn-reload"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
    expect(
      (screen.getByTestId("checkbox-10") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("a reload that drops the only selected doc clears the toolbar", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_C]} />,
    );

    await user.click(screen.getByTestId("checkbox-11"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");

    await user.click(screen.getByTestId("btn-reload"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("0"),
    );
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("a reload that keeps all selected docs preserves the full selection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_B, DOC_C]} />,
    );

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));

    await user.click(screen.getByTestId("btn-reload"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("2"),
    );
  });

  it("dropping an unselected doc does not change the selection count", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ControlledHarness initial={[DOC_A, DOC_B]} reloaded={[DOC_A, DOC_C]} />,
    );

    await user.click(screen.getByTestId("checkbox-10"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");

    await user.click(screen.getByTestId("btn-reload"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Full component test — real <SupportingDocumentsTab> with server reload
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab — ghost selections pruned on server reload", () => {
  it("toolbar count drops from 2 to 1 when a selected doc disappears on reload", async () => {
    // Mount fires a single GET (combined statusFilter+caseIdFilter effect,
    // Task #882); guard it with [DOC_A, DOC_B] so both docs are visible after
    // mount, then return the reloaded set on the subsequent filter-triggered
    // reload.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([DOC_A, DOC_B]))
      .mockResolvedValue(jsonOk([DOC_A, DOC_C]));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-11")).toBeTruthy(),
    );

    fireEvent.click(
      screen
        .getByTestId("row-supporting-doc-10")
        .querySelector('input[type="checkbox"]') as HTMLInputElement,
    );
    fireEvent.click(
      screen
        .getByTestId("row-supporting-doc-11")
        .querySelector('input[type="checkbox"]') as HTMLInputElement,
    );

    await waitFor(() => {
      const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
      expect(toolbar.textContent).toContain("2 documents selected");
    });

    // Use a caseId value that matches the selected docs ("case-abc") so the
    // debounce's hasOverlap check passes and setCaseIdFilter fires immediately
    // instead of showing a confirmation dialog.
    const caseIdInput = screen.getByTestId("filter-supporting-docs-case-id");
    fireEvent.change(caseIdInput, { target: { value: "case-abc" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("row-supporting-doc-11")).toBeNull(),
    );

    const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
    expect(toolbar.textContent).toContain("1 document selected");
  });

  it("toolbar disappears when the only selected doc is absent from the reload", async () => {
    // Mount fires a single GET (combined filter effect, Task #882); the next
    // GET is the filter-triggered reload.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([DOC_A, DOC_B]))
      .mockResolvedValue(jsonOk([DOC_C]));

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-11")).toBeTruthy(),
    );

    fireEvent.click(
      screen
        .getByTestId("row-supporting-doc-11")
        .querySelector('input[type="checkbox"]') as HTMLInputElement,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs"),
      ).toBeTruthy(),
    );

    // Use "case-abc" — matches DOC_B's caseId so the overlap check passes and
    // the reload fires immediately (no confirmation dialog).
    const caseIdInput = screen.getByTestId("filter-supporting-docs-case-id");
    fireEvent.change(caseIdInput, { target: { value: "case-abc" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("toolbar-selection-supporting-docs"),
      ).toBeNull(),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Static source assertions — in-place status-change pruning useEffect
//    (Task #709)
// ---------------------------------------------------------------------------

describe("SupportingDocumentsTab.tsx — in-place status-change pruning useEffect (static)", () => {
  it("contains actionableIdSet built from docs filtered by isActionable", () => {
    expect(TAB_SRC).toContain("actionableIdSet");
    expect(TAB_SRC).toContain("isActionable(d.status)");
  });

  it("filters selectedIds by actionableIdSet.has(id)", () => {
    expect(TAB_SRC).toContain("actionableIdSet.has(id)");
  });

  it("guards on selectedIds.size === 0 before pruning", () => {
    expect(TAB_SRC).toContain("selectedIds.size === 0");
  });

  it("calls setSelectedIds(pruned)", () => {
    expect(TAB_SRC).toContain("setSelectedIds(pruned)");
  });

  it("only updates state when the pruned size actually changed", () => {
    expect(TAB_SRC).toContain("pruned.size !== selectedIds.size");
  });

  it("attributes the behaviour to Task #709 in a comment", () => {
    expect(TAB_SRC).toContain("Task #709");
  });
});

// ---------------------------------------------------------------------------
// 5. Functional harness — in-place status-change pruning
// ---------------------------------------------------------------------------

/**
 * Slim harness that mirrors the selectedIds state and the in-place-status
 * pruning useEffect from SupportingDocumentsTab (Task #709).
 *
 * The "Approve doc N" button simulates a status change that makes a previously
 * selected doc non-actionable while keeping it in the docs array.
 */
function InPlacePruningHarness({
  initialDocs,
}: {
  initialDocs: SupportingDoc[];
}) {
  const [docs, setDocs] = useState<SupportingDoc[]>(initialDocs);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  function isActionableLocal(status: string | null) {
    return !status || status === "uploaded" || status === "reviewed";
  }

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const actionableIdSet = new Set(
      docs.filter((d) => isActionableLocal(d.status)).map((d) => d.id),
    );
    const pruned = new Set(
      [...selectedIds].filter((id) => actionableIdSet.has(id)),
    );
    if (pruned.size !== selectedIds.size) {
      setSelectedIds(pruned);
    }
  }, [docs]);

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approveDoc = (id: number) =>
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "approved" } : d)),
    );

  return (
    <div>
      {docs.map((doc) => (
        <div key={doc.id} data-testid={`row-${doc.id}`}>
          <input
            type="checkbox"
            data-testid={`checkbox-${doc.id}`}
            checked={selectedIds.has(doc.id)}
            onChange={() => toggle(doc.id)}
          />
          <span data-testid={`status-${doc.id}`}>{doc.status}</span>
        </div>
      ))}
      {docs.map((doc) => (
        <button
          key={doc.id}
          data-testid={`approve-${doc.id}`}
          onClick={() => approveDoc(doc.id)}
        >
          Approve {doc.id}
        </button>
      ))}
      <span data-testid="selected-count">{selectedIds.size}</span>
      {selectedIds.size > 0 && (
        <span data-testid="toolbar">{selectedIds.size} selected</span>
      )}
    </div>
  );
}

describe("InPlacePruningHarness — status-change ghost-selection removal", () => {
  it("starts with zero selected", () => {
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B]} />);
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("a selected doc whose status changes to approved is pruned", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B]} />);

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    await user.click(screen.getByTestId("approve-11"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
  });

  it("the remaining doc's checkbox stays checked after pruning", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B]} />);

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));

    await user.click(screen.getByTestId("approve-11"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("1"),
    );
    expect((screen.getByTestId("checkbox-10") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("toolbar disappears when the only selected doc becomes non-actionable", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B]} />);

    await user.click(screen.getByTestId("checkbox-11"));
    expect(screen.getByTestId("toolbar")).toBeTruthy();

    await user.click(screen.getByTestId("approve-11"));

    await waitFor(() =>
      expect(screen.queryByTestId("toolbar")).toBeNull(),
    );
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("no pruning when both selected docs remain actionable", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B, DOC_C]} />);

    await user.click(screen.getByTestId("checkbox-10"));
    await user.click(screen.getByTestId("checkbox-11"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    await user.click(screen.getByTestId("approve-12"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("2"),
    );
  });

  it("no pruning when selection is empty", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InPlacePruningHarness initialDocs={[DOC_A, DOC_B]} />);

    await user.click(screen.getByTestId("approve-10"));

    await waitFor(() =>
      expect(screen.getByTestId("selected-count").textContent).toBe("0"),
    );
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Full component test — in-place status-change pruning via inline approve
//    (Task #709 end-to-end path)
// ---------------------------------------------------------------------------
//
// Unlike Section 3 (which tests the server-reload path via filter changes),
// these tests confirm that an optimistic status mutation inside act() triggers
// the pruning useEffect and drops the toolbar count *without* a server GET.

describe("SupportingDocumentsTab — in-place status-change pruning (full component)", () => {
  it("toolbar count drops from 2 to 1 when one selected doc is approved inline without a server reload", async () => {
    const patchedDoc = { ...DOC_B, status: "approved", reviewedAt: new Date().toISOString(), reviewedBy: "admin" };
    const fetchMock = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (!opts?.method || opts.method === "GET") {
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      }
      return Promise.resolve(jsonOk(patchedDoc));
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-11")).toBeTruthy(),
    );

    // Select both rows using the real component checkboxes.
    fireEvent.click(screen.getByTestId("checkbox-supporting-doc-10"));
    fireEvent.click(screen.getByTestId("checkbox-supporting-doc-11"));

    await waitFor(() => {
      const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
      expect(toolbar.textContent).toContain("2 documents selected");
    });

    // Record how many fetches have fired so far (just the initial GET).
    const fetchCountBefore = fetchMock.mock.calls.length;

    // Click the inline approve button for doc 11 — this triggers the optimistic
    // setDocs() inside act(), which causes the pruning useEffect to fire and
    // remove doc 11 from selectedIds because it is no longer actionable.
    fireEvent.click(screen.getByTestId("button-approve-supporting-doc-11"));

    // Toolbar should drop to 1 driven by the pruning useEffect, not a reload.
    await waitFor(() => {
      const toolbar = screen.getByTestId("toolbar-selection-supporting-docs");
      expect(toolbar.textContent).toContain("1 document selected");
    });

    // Only the PATCH for the approve fired — no extra GET reload.
    const fetchCountAfter = fetchMock.mock.calls.length;
    expect(fetchCountAfter - fetchCountBefore).toBe(1);
    const patchCall = fetchMock.mock.calls[fetchCountAfter - 1];
    expect((patchCall[1] as RequestInit).method).toBe("PATCH");
  });

  it("toolbar disappears when the only selected doc is approved inline", async () => {
    const patchedDoc = { ...DOC_B, status: "approved", reviewedAt: new Date().toISOString(), reviewedBy: "admin" };
    const fetchMock = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (!opts?.method || opts.method === "GET") {
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      }
      return Promise.resolve(jsonOk(patchedDoc));
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-11")).toBeTruthy(),
    );

    // Select only doc 11.
    fireEvent.click(screen.getByTestId("checkbox-supporting-doc-11"));

    await waitFor(() =>
      expect(screen.getByTestId("toolbar-selection-supporting-docs")).toBeTruthy(),
    );

    // Approve doc 11 inline — it becomes non-actionable, the pruning useEffect
    // fires, selectedIds becomes empty, and the toolbar unmounts.
    fireEvent.click(screen.getByTestId("button-approve-supporting-doc-11"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("toolbar-selection-supporting-docs"),
      ).toBeNull(),
    );
  });

  it("doc 10 remains selected and actionable after doc 11 is approved inline", async () => {
    const patchedDoc = { ...DOC_B, status: "approved", reviewedAt: new Date().toISOString(), reviewedBy: "admin" };
    const fetchMock = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (!opts?.method || opts.method === "GET") {
        return Promise.resolve(jsonOk([DOC_A, DOC_B]));
      }
      return Promise.resolve(jsonOk(patchedDoc));
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock;

    render(<SupportingDocumentsTab />);

    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-10")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-supporting-doc-11")).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("checkbox-supporting-doc-10"));
    fireEvent.click(screen.getByTestId("checkbox-supporting-doc-11"));

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs").textContent,
      ).toContain("2 documents selected"),
    );

    fireEvent.click(screen.getByTestId("button-approve-supporting-doc-11"));

    await waitFor(() =>
      expect(
        screen.getByTestId("toolbar-selection-supporting-docs").textContent,
      ).toContain("1 document selected"),
    );

    // Doc 10's checkbox must still be checked.
    expect(
      (screen.getByTestId("checkbox-supporting-doc-10") as HTMLInputElement).checked,
    ).toBe(true);
  });
});
