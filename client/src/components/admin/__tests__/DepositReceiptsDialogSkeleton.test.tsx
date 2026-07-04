// @vitest-environment jsdom
//
// Regression guard: DepositReceiptsDialog must render a skeleton while
// isLoading=true and switch to real content (receipt list or empty state)
// once isLoading=false. The transition must not leave stale skeleton nodes
// behind.
//
// We render the component directly rather than through the full
// AdminDashboard to keep the test focused and fast.  The only dependencies
// that need mocking are the ones that perform side-effects (fetch, toast)
// or require heavy context (CaseMergedReceiptsPanel).

import React, { act } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { DepositReceiptsDialog, DEPOSIT_RECEIPT_BADGE_VARIANT } from "../DepositReceiptsDialog";
import type { Case, DepositReceipt } from "../shared";
import type { ReceiptStatus } from "@/lib/receiptStatus";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.name) return `Receipts for ${opts.name}`;
      return key;
    },
  }),
}));

vi.mock("@/components/admin/CaseMergedReceiptsPanel", () => ({
  CaseMergedReceiptsPanel: () => (
    <div data-testid="merged-receipts-panel" />
  ),
}));

// framer-motion: keep real implementation but disable animations so
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
      }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
        <div {...rest}>{children}</div>
      ),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_CASE: Case = {
  id: "case-1",
  userName: "Alice",
  accessCode: "TEST-001",
  email: "alice@example.com",
  status: "active",
  letterSent: false,
  depositPaid: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as Case;

const MOCK_RECEIPT: DepositReceipt = {
  id: 99,
  caseId: "case-1",
  fileName: "proof.jpg",
  imageData: "data:image/jpeg;base64,/9j/abc",
  status: "pending",
  notes: undefined,
  adminNotes: undefined,
  uploadedAt: "2026-05-01T12:00:00Z",
} as unknown as DepositReceipt;

function renderDialog(
  props: Partial<React.ComponentProps<typeof DepositReceiptsDialog>> = {},
) {
  return render(
    <DepositReceiptsDialog
      open={true}
      onOpenChange={vi.fn()}
      selectedCase={MOCK_CASE}
      authToken="test-token"
      adminRole="super_admin"
      mergedReceiptsScrollKey={null}
      depositReceipts={[]}
      isLoading={false}
      pendingReceiptIds={new Set()}
      receiptEmailFlags={{}}
      setReceiptEmailFlags={vi.fn()}
      updateReceiptStatus={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Canonical list of all known receipt statuses.
// When a new status is added to the ReceiptStatus union in receiptStatus.ts,
// TypeScript will require DEPOSIT_RECEIPT_BADGE_VARIANT to be updated (compile
// error), AND this array must also be updated (test failure) — two independent
// signals that prevent silent drift.
// ---------------------------------------------------------------------------
const ALL_RECEIPT_STATUSES: ReceiptStatus[] = [
  "pending",
  "awaiting_admin_approval",
  "reviewed",
  "approved",
  "rejected",
];

// Maps each Badge variant to a CSS class that is unique to that variant so
// the render tests can confirm the correct variant was actually applied.
// These classes come directly from the `badgeVariants` cva definition in
// client/src/components/ui/badge.tsx.
const VARIANT_MARKER_CLASS: Record<
  "default" | "secondary" | "destructive" | "outline",
  string
> = {
  default: "bg-primary",
  secondary: "bg-secondary",
  destructive: "bg-destructive",
  outline: "text-foreground",
};

// Returns true when `cls` is present as a standalone token in the className
// string, preventing partial-substring false-positives
// (e.g. "text-foreground" must not match "text-primary-foreground").
function hasClass(el: Element, cls: string): boolean {
  return el.className.split(/\s+/).includes(cls);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DepositReceiptsDialog — isLoading skeleton", () => {
  it("shows the skeleton region when isLoading=true", () => {
    renderDialog({ isLoading: true });

    const skeleton = screen.getByLabelText("Loading receipts…");
    expect(skeleton).toBeTruthy();
  });

  it("renders three skeleton cards while loading", () => {
    renderDialog({ isLoading: true });

    // The skeleton renders three placeholder rows; each card sits inside
    // the aria-labelled container so we query children of it.
    const skeleton = screen.getByLabelText("Loading receipts…");
    // Three direct child divs (one per placeholder receipt card).
    const cards = skeleton.querySelectorAll(":scope > div");
    expect(cards.length).toBe(3);
  });

  it("does NOT show the empty state while isLoading=true", () => {
    renderDialog({ isLoading: true, depositReceipts: [] });

    expect(screen.queryByText("No receipts uploaded yet")).toBeNull();
  });

  it("does NOT show a receipt row while isLoading=true", () => {
    renderDialog({ isLoading: true, depositReceipts: [MOCK_RECEIPT] });

    // The filename appears in receipt rows; it must not be rendered while
    // the skeleton is showing.
    expect(screen.queryByText("proof.jpg")).toBeNull();
  });
});

describe("DepositReceiptsDialog — isLoading=false, empty receipt list", () => {
  it("shows the empty state message when there are no receipts", () => {
    renderDialog({ isLoading: false, depositReceipts: [] });

    expect(screen.getByText("No receipts uploaded yet")).toBeTruthy();
  });

  it("does NOT show the skeleton when not loading", () => {
    renderDialog({ isLoading: false, depositReceipts: [] });

    expect(screen.queryByLabelText("Loading receipts…")).toBeNull();
  });
});

describe("DepositReceiptsDialog — isLoading=false, with receipts", () => {
  it("renders the receipt filename when isLoading=false", () => {
    renderDialog({ isLoading: false, depositReceipts: [MOCK_RECEIPT] });

    expect(screen.getByText("proof.jpg")).toBeTruthy();
  });

  it("does NOT show the skeleton when receipts are present", () => {
    renderDialog({ isLoading: false, depositReceipts: [MOCK_RECEIPT] });

    expect(screen.queryByLabelText("Loading receipts…")).toBeNull();
  });

  it("shows the pending status badge for a pending receipt", () => {
    renderDialog({ isLoading: false, depositReceipts: [MOCK_RECEIPT] });

    expect(screen.getByText("pending")).toBeTruthy();
  });
});

describe("DepositReceiptsDialog — loading→content transition", () => {
  it("removes the skeleton and shows content after isLoading flips to false", async () => {
    const { rerender } = renderDialog({ isLoading: true, depositReceipts: [] });

    // Initially the skeleton is visible.
    expect(screen.getByLabelText("Loading receipts…")).toBeTruthy();
    expect(screen.queryByText("No receipts uploaded yet")).toBeNull();

    // Simulate the async data fetch completing.
    await act(async () => {
      rerender(
        <DepositReceiptsDialog
          open={true}
          onOpenChange={vi.fn()}
          selectedCase={MOCK_CASE}
          authToken="test-token"
          mergedReceiptsScrollKey={null}
          depositReceipts={[]}
          isLoading={false}
          pendingReceiptIds={new Set()}
          receiptEmailFlags={{}}
          setReceiptEmailFlags={vi.fn()}
          updateReceiptStatus={vi.fn()}
        />,
      );
    });

    // Skeleton must be gone.
    await waitFor(() => {
      expect(screen.queryByLabelText("Loading receipts…")).toBeNull();
    });

    // Real content must be present.
    expect(screen.getByText("No receipts uploaded yet")).toBeTruthy();
  });

  it("removes the skeleton and shows a receipt row after isLoading flips to false", async () => {
    const { rerender } = renderDialog({
      isLoading: true,
      depositReceipts: [MOCK_RECEIPT],
    });

    expect(screen.getByLabelText("Loading receipts…")).toBeTruthy();
    expect(screen.queryByText("proof.jpg")).toBeNull();

    await act(async () => {
      rerender(
        <DepositReceiptsDialog
          open={true}
          onOpenChange={vi.fn()}
          selectedCase={MOCK_CASE}
          authToken="test-token"
          mergedReceiptsScrollKey={null}
          depositReceipts={[MOCK_RECEIPT]}
          isLoading={false}
          pendingReceiptIds={new Set()}
          receiptEmailFlags={{}}
          setReceiptEmailFlags={vi.fn()}
          updateReceiptStatus={vi.fn()}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading receipts…")).toBeNull();
    });

    expect(screen.getByText("proof.jpg")).toBeTruthy();
  });
});

// ── New exhaustiveness + render guard tests ────────────────────────────────

describe("DEPOSIT_RECEIPT_BADGE_VARIANT — exhaustiveness guard", () => {
  it("has a non-null BadgeVariant entry for every ReceiptStatus member", () => {
    for (const status of ALL_RECEIPT_STATUSES) {
      const variant = DEPOSIT_RECEIPT_BADGE_VARIANT[status];
      expect(
        variant,
        `DEPOSIT_RECEIPT_BADGE_VARIANT is missing an entry for status "${status}"`,
      ).toBeTruthy();
      expect(typeof variant).toBe("string");
    }
  });

  it("has no extra keys beyond ALL_RECEIPT_STATUSES", () => {
    const recordKeys = Object.keys(DEPOSIT_RECEIPT_BADGE_VARIANT).sort();
    expect(recordKeys).toEqual([...ALL_RECEIPT_STATUSES].sort());
  });
});

describe("DepositReceiptsDialog badge variant — renders correct variant per status", () => {
  for (const status of ALL_RECEIPT_STATUSES) {
    it(`renders badge with the correct variant class for status "${status}"`, () => {
      const receipt = {
        ...MOCK_RECEIPT,
        id: 42,
        status,
      } as unknown as DepositReceipt;

      renderDialog({ depositReceipts: [receipt] });

      const badge = screen.getByTestId("badge-receipt-status-42");
      expect(badge).toBeTruthy();

      const expectedVariant = DEPOSIT_RECEIPT_BADGE_VARIANT[status];
      const markerClass = VARIANT_MARKER_CLASS[expectedVariant];
      expect(
        hasClass(badge, markerClass),
        `Badge for status "${status}" (variant="${expectedVariant}") should carry CSS class "${markerClass}"; got className="${badge.className}"`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Source-code guard — confirms the badge ternary chain in DepositReceiptsDialog
// has an explicit branch for every ReceiptStatus before delegating to
// assertNeverReceiptStatus.  A developer could remove one branch and the
// DEPOSIT_RECEIPT_BADGE_VARIANT Record check above would still pass because
// that check only inspects the map, not the ternary chain that consumes it.
// ---------------------------------------------------------------------------
describe("DepositReceiptsDialog badge ternary chain — source completeness", () => {
  it("has an explicit branch for every ReceiptStatus in the badge ternary chain", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../DepositReceiptsDialog.tsx"),
      "utf8",
    );

    // Anchor on the badge testid pattern that was added alongside this guard,
    // then walk backwards to the opening <Badge to capture the ternary block.
    const anchorIdx = src.indexOf("data-testid={`badge-receipt-status-");
    expect(
      anchorIdx,
      "data-testid={`badge-receipt-status-…`} not found in DepositReceiptsDialog.tsx",
    ).toBeGreaterThan(-1);

    const badgeOpen = src.lastIndexOf("<Badge", anchorIdx);
    expect(
      badgeOpen,
      "<Badge not found before badge-receipt-status testid",
    ).toBeGreaterThan(-1);

    const badgeClose = src.indexOf("</Badge>", badgeOpen);
    expect(
      badgeClose,
      "</Badge> not found after <Badge for receipt-status badge",
    ).toBeGreaterThan(-1);

    const badgeBlock = src.slice(badgeOpen, badgeClose);

    // Every known status must appear as a string literal branch in the block.
    for (const status of ALL_RECEIPT_STATUSES) {
      expect(
        badgeBlock.includes(`receipt.status === "${status}"`),
        `Badge ternary chain is missing a branch for status "${status}"`,
      ).toBe(true);
    }

    // The assertNeverReceiptStatus guard must be present as the final else.
    expect(
      badgeBlock.includes("assertNeverReceiptStatus"),
      "assertNeverReceiptStatus guard missing from badge ternary chain",
    ).toBe(true);
  });
});
