// @vitest-environment jsdom
//
// CaseMergedReceiptsPanel category filter — exhaustiveness guard tests.
//
// Contracts verified:
//   1. CATEGORY_LABEL has an entry for every member of MergedReceipt["category"]
//      (enforced at compile-time by the Record type).
//   2. The <SelectItem> list in the filter dropdown has an explicit entry for
//      every key of CATEGORY_LABEL so a new category cannot silently disappear
//      from the UI (this contract is NOT enforced by TypeScript alone).

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { CATEGORY_LABEL } from "../CaseMergedReceiptsPanel";

// ---------------------------------------------------------------------------
// Static structure test — no rendering needed
// ---------------------------------------------------------------------------
describe("CaseMergedReceiptsPanel category filter dropdown — source completeness", () => {
  it("has a <SelectItem value> for every key of CATEGORY_LABEL", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../CaseMergedReceiptsPanel.tsx"),
      "utf8",
    );

    // Anchor on the filter dropdown's SelectContent block.
    // data-testid="filter-merged-panel-category" is on the SelectTrigger
    // immediately preceding the SelectContent we want to inspect.
    const triggerIdx = src.indexOf('data-testid="filter-merged-panel-category"');
    expect(
      triggerIdx,
      'data-testid="filter-merged-panel-category" not found in CaseMergedReceiptsPanel.tsx',
    ).toBeGreaterThan(-1);

    const contentOpen = src.indexOf("<SelectContent>", triggerIdx);
    expect(
      contentOpen,
      "<SelectContent> not found after filter-merged-panel-category trigger",
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
        `Category filter dropdown is missing a <SelectItem value="${category}"> — add it to the <SelectContent> block in CaseMergedReceiptsPanel.tsx`,
      ).toBe(true);
    }
  });

  it("has no extra <SelectItem> values beyond CATEGORY_LABEL keys, 'all', and virtual categories", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../CaseMergedReceiptsPanel.tsx"),
      "utf8",
    );

    const triggerIdx = src.indexOf('data-testid="filter-merged-panel-category"');
    const contentOpen = src.indexOf("<SelectContent>", triggerIdx);
    const contentClose = src.indexOf("</SelectContent>", contentOpen);
    const dropdownBlock = src.slice(contentOpen, contentClose);

    // Extract all value="…" strings from SelectItem tags in the block.
    const selectItemValues = [...dropdownBlock.matchAll(/value="([^"]+)"/g)].map(
      (m) => m[1],
    );

    // Virtual categories are derived from a combination of DB fields —
    // they are not stored as a distinct DB category so they have no
    // CATEGORY_LABEL entry, but they ARE valid filter values.
    const VIRTUAL_FILTER_CATEGORIES = ["reactivation"];

    const allowedValues = new Set<string>([
      "all",
      ...Object.keys(CATEGORY_LABEL),
      ...VIRTUAL_FILTER_CATEGORIES,
    ]);

    for (const val of selectItemValues) {
      expect(
        allowedValues.has(val),
        `Unexpected <SelectItem value="${val}"> in category filter — either add "${val}" to CATEGORY_LABEL, list it in VIRTUAL_FILTER_CATEGORIES, or remove the SelectItem`,
      ).toBe(true);
    }
  });
});
