// @vitest-environment jsdom
//
// AllReceiptsTab category filter — exhaustiveness guard tests.
//
// Contracts verified:
//   1. The <SelectItem> list in the category filter dropdown has an explicit
//      entry for every key of CATEGORY_LABEL so a new category cannot silently
//      disappear from the cross-case All Receipts view (this contract is NOT
//      enforced by TypeScript alone).
//   2. No extra <SelectItem> values appear beyond CATEGORY_LABEL keys, "all",
//      and "reactivation" (the synthetic reactivation-only filter option).
//   3. isReactivationReceipt() matches exactly the receipts the "reactivation"
//      synthetic filter is meant to surface: category="reissue" + reissueId=null.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { CATEGORY_LABEL, isReactivationReceipt } from "../AllReceiptsTab";

// ---------------------------------------------------------------------------
// Static structure test — no rendering needed
// ---------------------------------------------------------------------------
describe("AllReceiptsTab category filter dropdown — source completeness", () => {
  it("has a <SelectItem value> for every key of CATEGORY_LABEL", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AllReceiptsTab.tsx"),
      "utf8",
    );

    // Anchor on the filter dropdown's SelectTrigger.
    // data-testid="filter-all-receipts-category" is on the SelectTrigger
    // immediately preceding the SelectContent we want to inspect.
    const triggerIdx = src.indexOf('data-testid="filter-all-receipts-category"');
    expect(
      triggerIdx,
      'data-testid="filter-all-receipts-category" not found in AllReceiptsTab.tsx',
    ).toBeGreaterThan(-1);

    const contentOpen = src.indexOf("<SelectContent>", triggerIdx);
    expect(
      contentOpen,
      "<SelectContent> not found after filter-all-receipts-category trigger",
    ).toBeGreaterThan(-1);

    const contentClose = src.indexOf("</SelectContent>", contentOpen);
    expect(
      contentClose,
      "</SelectContent> not found after <SelectContent> for category filter",
    ).toBeGreaterThan(-1);

    const dropdownBlock = src.slice(contentOpen, contentClose);

    // Every key in CATEGORY_LABEL must appear as a SelectItem value.
    const categories = Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>;
    for (const category of categories) {
      expect(
        dropdownBlock.includes(`value="${category}"`),
        `Category filter dropdown is missing a <SelectItem value="${category}"> — add it to the <SelectContent> block in AllReceiptsTab.tsx`,
      ).toBe(true);
    }
  });

  it("has no extra <SelectItem> values beyond CATEGORY_LABEL keys, 'all', and 'reactivation'", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../AllReceiptsTab.tsx"),
      "utf8",
    );

    const triggerIdx = src.indexOf('data-testid="filter-all-receipts-category"');
    const contentOpen = src.indexOf("<SelectContent>", triggerIdx);
    const contentClose = src.indexOf("</SelectContent>", contentOpen);
    const dropdownBlock = src.slice(contentOpen, contentClose);

    // Extract all value="…" strings from SelectItem tags in the block.
    const selectItemValues = [...dropdownBlock.matchAll(/value="([^"]+)"/g)].map(
      (m) => m[1],
    );

    // "all" = show-everything sentinel; "reactivation" = synthetic cross-tab filter
    // for reissue receipts with no linked reissue round (not a raw category value).
    const allowedValues = new Set<string>([
      "all",
      "reactivation",
      ...Object.keys(CATEGORY_LABEL),
    ]);

    for (const val of selectItemValues) {
      expect(
        allowedValues.has(val),
        `Unexpected <SelectItem value="${val}"> in category filter — either add "${val}" to CATEGORY_LABEL or remove the SelectItem`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isReactivationReceipt predicate — filter-match contract
// ---------------------------------------------------------------------------
// These tests pin the definition of a "reactivation" receipt so that any drift
// in the predicate (field rename, null-check removal, category rename) is caught
// before the "reactivation" synthetic filter silently returns no rows.
// ---------------------------------------------------------------------------

function makeReceipt(
  overrides: Partial<{
    category: "activation" | "reissue" | "other" | "certificate" | "stamp_duty" | "merge_fee" | "token_deposit";
    reissueId: number | null;
  }>,
) {
  return {
    source: "deposit" as const,
    id: 1,
    caseId: "CASE-001",
    accessCode: null,
    category: "reissue" as const,
    status: "pending" as const,
    fileName: null,
    notes: null,
    adminNotes: null,
    amountUsdt: null,
    reissueId: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isReactivationReceipt predicate", () => {
  it("returns true for category='reissue' with reissueId=null (account reactivation payment)", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "reissue", reissueId: null }))).toBe(true);
  });

  it("returns false for category='reissue' with a non-null reissueId (linked letter-reissue round)", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "reissue", reissueId: 42 }))).toBe(false);
  });

  it("returns false for category='activation' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "activation", reissueId: null }))).toBe(false);
  });

  it("returns false for category='other' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "other", reissueId: null }))).toBe(false);
  });

  it("returns false for category='certificate' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "certificate", reissueId: null }))).toBe(false);
  });

  it("returns false for category='stamp_duty' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "stamp_duty", reissueId: null }))).toBe(false);
  });

  it("returns false for category='merge_fee' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "merge_fee", reissueId: null }))).toBe(false);
  });

  it("returns false for category='token_deposit' with reissueId=null", () => {
    expect(isReactivationReceipt(makeReceipt({ category: "token_deposit", reissueId: null }))).toBe(false);
  });
});
