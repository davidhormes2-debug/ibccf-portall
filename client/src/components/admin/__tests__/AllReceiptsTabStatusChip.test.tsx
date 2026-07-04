// @vitest-environment jsdom
//
// Landscape-mobile receipt status chip — exhaustiveness guard tests.
//
// Contracts verified:
//   1. RECEIPT_STATUS_CHIP_CLASSES (exported from AllReceiptsTab) has an
//      entry for every member of the ReceiptStatus union so that TypeScript's
//      Record<ReceiptStatus, string> constraint is honoured at runtime too.
//   2. The badge ternary chain in AllReceiptsTab.tsx has an explicit branch
//      for every ReceiptStatus value so a new union member cannot silently
//      fall through to the assertNeverReceiptStatus guard without being
//      noticed at code-review time.
//   3. Every known ReceiptStatus renders a badge with the expected CSS class
//      and does NOT fall back to the default (unknown-status) styling.

import React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { RECEIPT_STATUS_CHIP_CLASSES } from "../AllReceiptsTab";
import type { ReceiptStatus } from "@/lib/receiptStatus";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("../AdminDashboardContext", () => ({
  useAdminDashboard: () => ({
    adminRole: "super_admin",
    loadReactivationPendingCounts: vi.fn(),
  }),
}));

import { AllReceiptsTab } from "../AllReceiptsTab";

// ---------------------------------------------------------------------------
// Canonical list of all known receipt statuses.
// This list is the ground-truth that the typed Record is checked against.
// When a new status is added to the ReceiptStatus union in receiptStatus.ts,
// TypeScript will require RECEIPT_STATUS_CHIP_CLASSES to be updated (compile
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

// ---------------------------------------------------------------------------
// Session/fetch setup shared across tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (globalThis as any).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this._ as Map<string, string>).get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this._ as Map<string, string>).set(k, String(v));
    },
    removeItem(k: string) {
      (this._ as Map<string, string>).delete(k);
    },
    clear() {
      (this._ as Map<string, string>).clear();
    },
  };
  sessionStorage.setItem("adminToken", "test-token");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Static structure tests — no rendering needed
// ---------------------------------------------------------------------------
describe("RECEIPT_STATUS_CHIP_CLASSES — exhaustiveness guard", () => {
  it("has a non-empty CSS class string for every ReceiptStatus member", () => {
    for (const status of ALL_RECEIPT_STATUSES) {
      const cls = RECEIPT_STATUS_CHIP_CLASSES[status];
      expect(
        cls,
        `RECEIPT_STATUS_CHIP_CLASSES is missing an entry for status "${status}"`,
      ).toBeTruthy();
      expect(typeof cls).toBe("string");
    }
  });

  it("has no extra keys beyond ALL_RECEIPT_STATUSES", () => {
    const recordKeys = Object.keys(RECEIPT_STATUS_CHIP_CLASSES).sort();
    expect(recordKeys).toEqual([...ALL_RECEIPT_STATUSES].sort());
  });
});

// ---------------------------------------------------------------------------
// Source-code guard — mirrors the AllReceiptsTab category-dropdown test
// ---------------------------------------------------------------------------
describe("AllReceiptsTab status badge ternary chain — source completeness", () => {
  it("has an explicit branch for every ReceiptStatus in the badge ternary chain", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AllReceiptsTab.tsx"),
      "utf8",
    );

    // Anchor on the badge testid pattern that was added with this guard, then
    // bound the slice to the closing </Badge> tag so we only inspect the chip.
    const anchorIdx = src.indexOf('data-testid={`badge-receipt-status-');
    expect(
      anchorIdx,
      'data-testid={`badge-receipt-status-…`} not found in AllReceiptsTab.tsx',
    ).toBeGreaterThan(-1);

    // Walk backwards to the opening <Badge to capture the className ternary.
    const badgeOpen = src.lastIndexOf("<Badge", anchorIdx);
    expect(
      badgeOpen,
      "<Badge not found before badge-receipt-status testid",
    ).toBeGreaterThan(-1);

    const badgeClose = src.indexOf("</Badge>", badgeOpen);
    expect(
      badgeClose,
      "</Badge> not found after <Badge for receipt-status chip",
    ).toBeGreaterThan(-1);

    const chipBlock = src.slice(badgeOpen, badgeClose);

    // Every known status must appear as a string literal branch in the block.
    for (const status of ALL_RECEIPT_STATUSES) {
      expect(
        chipBlock.includes(`r.status === "${status}"`),
        `Badge ternary chain is missing a branch for status "${status}"`,
      ).toBe(true);
    }

    // The assertNeverReceiptStatus guard must be present as the final else.
    expect(
      chipBlock.includes("assertNeverReceiptStatus"),
      "assertNeverReceiptStatus guard missing from badge ternary chain",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime rendering test — each known status renders a non-fallback badge
// ---------------------------------------------------------------------------
describe("AllReceiptsTab status badge — renders correct class per status", () => {
  for (const status of ALL_RECEIPT_STATUSES) {
    it(`renders badge with expected class for status "${status}"`, async () => {
      const row = {
        source: "deposit" as const,
        id: 1,
        caseId: "case-test",
        category: "activation" as const,
        status,
        fileName: "file.pdf",
        notes: null,
        adminNotes: null,
        amountUsdt: "100",
        reissueId: null,
        reviewedAt: null,
        reviewedBy: null,
        uploadedAt: "2026-06-01T00:00:00.000Z",
      };

      (globalThis as any).fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify([row]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }) as unknown as Response,
        );

      render(<AllReceiptsTab />);

      const badge = await waitFor(() => {
        const el = screen.getByTestId(`badge-receipt-status-deposit-1`);
        expect(el).toBeTruthy();
        return el;
      });

      const expectedClass = RECEIPT_STATUS_CHIP_CLASSES[status];
      // The badge must carry the expected class (not the fallback "bg-slate-700").
      expect(badge.className).toContain(
        expectedClass.split(" ")[0],
        `Badge for status "${status}" did not receive the expected CSS class`,
      );
      expect(badge.className).not.toContain("bg-slate-700");
    });
  }
});
