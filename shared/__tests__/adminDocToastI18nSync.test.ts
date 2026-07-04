// @vitest-environment node
//
// WHY THIS TEST EXISTS
// e2e/admin-doc-preview-popover.spec.ts hard-codes two English toast title
// strings that come from admin.json's `toasts` namespace:
//
//   .filter({ hasText: "Document approved" })
//     → admin.json  toasts.docApproved.title
//
//   .filter({ hasText: "Document rejected" })
//     → admin.json  toasts.docRejected.title
//
// (A third string — "Preview failed" — is hardcoded directly in the source
// components and does not come from admin.json, so it is not guarded here.)
//
// If either copy key changes without updating the e2e spec, the test silently
// times out instead of giving a clear "copy drift" message.
//
// This file is the tripwire: it reads admin.json directly and asserts that
// each key still holds the value the e2e spec filters on.  A copy change is
// caught here — at unit-test time — with an actionable failure message.
//
// If an assertion fails, update the constant in this file AND update every
// matching `.filter({ hasText: "..." })` call in
// e2e/admin-doc-preview-popover.spec.ts so both stay in sync.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact strings the e2e spec uses as filter predicates.
// ---------------------------------------------------------------------------
const E2E_DOC_APPROVED_TITLE = "Document approved";
const E2E_DOC_REJECTED_TITLE = "Document rejected";

type AdminJson = {
  toasts?: {
    docApproved?: { title?: string };
    docRejected?: { title?: string };
  };
};

describe("admin.json document toast i18n copy sync guard", () => {
  let admin: AdminJson;

  beforeAll(() => {
    const jsonPath = resolve(
      __dirname,
      "../../client/src/i18n/locales/en/admin.json",
    );
    const raw = readFileSync(jsonPath, "utf-8");
    admin = JSON.parse(raw) as AdminJson;
  });

  it("admin.json toasts.docApproved.title matches the string hard-coded in the e2e spec", () => {
    const actual = admin?.toasts?.docApproved?.title;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_DOC_APPROVED_TITLE);
    // If this assertion fails, update E2E_DOC_APPROVED_TITLE above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/admin-doc-preview-popover.spec.ts.
  });

  it("admin.json toasts.docRejected.title matches the string hard-coded in the e2e spec", () => {
    const actual = admin?.toasts?.docRejected?.title;
    expect(actual).toBeDefined();
    expect(actual).toBe(E2E_DOC_REJECTED_TITLE);
    // If this assertion fails, update E2E_DOC_REJECTED_TITLE above AND
    // update the matching .filter({ hasText: "..." }) call in
    // e2e/admin-doc-preview-popover.spec.ts.
  });
});
