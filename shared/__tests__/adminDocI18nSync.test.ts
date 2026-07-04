// @vitest-environment node
//
// WHY THIS TEST EXISTS
// e2e/admin-doc-preview-popover.spec.ts hard-codes three admin-surface toast
// strings that are produced by SupportingDocsQuickPopover:
//
//   .filter({ hasText: "Preview failed" })       — preview error path
//   .filter({ hasText: "Document approved" })    — approve action
//   .filter({ hasText: "Document rejected" })    — reject action
//
// Those titles are the canonical English copy stored in
// client/src/i18n/locales/en/admin.json (keys: previewFailed.title,
// docApproved.title, docRejected.title). If the copy in admin.json ever
// drifts from the strings the e2e spec filters on, the e2e test silently
// times out instead of failing with a clear "copy drift" message.
//
// This test is the tripwire: it reads admin.json directly and asserts each
// key still matches the string the e2e spec hard-codes, so copy drift is
// caught here — at unit-test time — with an actionable failure message
// rather than a cryptic e2e timeout.
//
// UPDATE PROTOCOL
// If any assertion below fails, you must update TWO places in sync:
//   1. The constant in THIS file (E2E_* variables).
//   2. The matching .filter({ hasText: "..." }) call in
//      e2e/admin-doc-preview-popover.spec.ts.
// Never change one without the other — that defeats the purpose of this guard.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e spec uses as its filter predicates.
// If any of these drift from admin.json, update BOTH the constants below
// and the corresponding assertions in e2e/admin-doc-preview-popover.spec.ts.
// ---------------------------------------------------------------------------
const E2E_PREVIEW_FAILED = "Preview failed";
const E2E_DOC_APPROVED = "Document approved";
const E2E_DOC_REJECTED = "Document rejected";

type AdminToasts = {
  previewFailed?: { title?: string };
  docApproved?: { title?: string };
  docRejected?: { title?: string };
};

describe("admin doc toast copy sync guard", () => {
  let toasts: AdminToasts;

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/admin.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    const admin = JSON.parse(raw) as { toasts?: AdminToasts };
    toasts = (admin.toasts ?? {}) as AdminToasts;
  });

  it('admin.json previewFailed.title matches the string hard-coded in the e2e spec', () => {
    const actual = toasts?.previewFailed?.title;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_PREVIEW_FAILED);
    // If this assertion fails, update E2E_PREVIEW_FAILED above AND update the
    // matching .filter({ hasText: "..." }) call in
    // e2e/admin-doc-preview-popover.spec.ts so both stay in sync.
  });

  it('admin.json docApproved.title matches the string hard-coded in the e2e spec', () => {
    const actual = toasts?.docApproved?.title;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_DOC_APPROVED);
    // If this assertion fails, update E2E_DOC_APPROVED above AND update the
    // matching .filter({ hasText: "..." }) call in
    // e2e/admin-doc-preview-popover.spec.ts so both stay in sync.
  });

  it('admin.json docRejected.title matches the string hard-coded in the e2e spec', () => {
    const actual = toasts?.docRejected?.title;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_DOC_REJECTED);
    // If this assertion fails, update E2E_DOC_REJECTED above AND update the
    // matching .filter({ hasText: "..." }) call in
    // e2e/admin-doc-preview-popover.spec.ts so both stay in sync.
  });
});
