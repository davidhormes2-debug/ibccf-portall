// @vitest-environment node
//
// WHY THIS TEST EXISTS
// The action-failed branch in e2e/supporting-docs-approve-reject.spec.ts
// hard-codes the English toast title that appears when the approve/reject
// endpoint returns a 5xx:
//
//   page.getByRole("status").filter({ hasText: "Action failed" })
//
// That string is currently hard-coded (not i18n-extracted) in three admin
// components:
//   - client/src/components/admin/tabs/SupportingDocumentsTab.tsx
//   - client/src/components/admin/SupportingDocsQuickPopover.tsx
//   - client/src/components/admin/SupportingDocumentsPanel.tsx
//
// If the copy is ever renamed or extracted to i18n without also updating
// the e2e spec, the spec silently times out rather than giving a clear
// "copy drift" failure.
//
// This tripwire catches the drift at unit-test time with an actionable
// message: update the E2E_ACTION_FAILED constant below AND the matching
// `.filter({ hasText: "..." })` call in the e2e spec.
//
// The second describe block guards the approve/reject SUCCESS-path toasts
// in the same three components.  SupportingDocumentsTab and
// SupportingDocumentsPanel hard-code the English strings "Document approved"
// / "Document rejected" inside their act() functions; SupportingDocsQuickPopover
// uses i18n keys (toasts.docApproved.title / toasts.docRejected.title).
// Any of these are equally prone to silent drift if copy is renamed or keys
// are moved without updating the other two components.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// The exact string the e2e spec uses as its filter predicate.
// If this drifts from any of the three component files below, update BOTH
// this constant and the matching assertion in
// e2e/supporting-docs-approve-reject.spec.ts.
// ---------------------------------------------------------------------------
const E2E_ACTION_FAILED_TITLE = "Action failed";

// ---------------------------------------------------------------------------
// Hard-coded success-toast titles used in SupportingDocumentsTab and
// SupportingDocumentsPanel act() functions.  SupportingDocsQuickPopover
// delegates to i18n keys instead (see QUICK_POPOVER_* constants below).
// If any of these strings are renamed, update the constants here AND audit
// every component that still relies on the old copy.
//
// E2E NOTE: e2e/supporting-docs-approve-reject.spec.ts intentionally does
// NOT assert these success toasts (they are short-lived and asserting them
// risks flaky timeouts).  If you ever add a success-toast assertion to that
// spec, wire it through a dedicated E2E_DOC_APPROVED_TITLE constant here
// (rather than a bare string in the spec) so copy drift is caught at
// unit-test time before any silent Playwright timeout can occur.
// ---------------------------------------------------------------------------
const DOC_APPROVED_TITLE = "Document approved";
const DOC_REJECTED_TITLE = "Document rejected";

// ---------------------------------------------------------------------------
// i18n key names used by SupportingDocsQuickPopover act().  Guarding the
// key name (not the translated value) catches renames in code that would
// break the i18n lookup without causing a TypeScript error.
// ---------------------------------------------------------------------------
const QUICK_POPOVER_APPROVED_I18N_KEY = "toasts.docApproved.title";
const QUICK_POPOVER_REJECTED_I18N_KEY = "toasts.docRejected.title";

function readSource(relPath: string): string {
  return readFileSync(resolve(__dirname, "../..", relPath), "utf-8");
}

describe("admin supporting-docs action-failed toast copy sync guard", () => {
  it("SupportingDocumentsTab still uses the toast title the e2e spec filters on", () => {
    const src = readSource(
      "client/src/components/admin/tabs/SupportingDocumentsTab.tsx",
    );
    expect(
      src.includes(E2E_ACTION_FAILED_TITLE),
      `SupportingDocumentsTab.tsx no longer contains "${E2E_ACTION_FAILED_TITLE}". ` +
        `Update E2E_ACTION_FAILED_TITLE above AND the matching ` +
        `.filter({ hasText: "..." }) call in e2e/supporting-docs-approve-reject.spec.ts.`,
    ).toBe(true);
  });

  it("SupportingDocsQuickPopover still uses the toast title the e2e spec filters on", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocsQuickPopover.tsx",
    );
    expect(
      src.includes(E2E_ACTION_FAILED_TITLE),
      `SupportingDocsQuickPopover.tsx no longer contains "${E2E_ACTION_FAILED_TITLE}". ` +
        `Update E2E_ACTION_FAILED_TITLE above AND the matching ` +
        `.filter({ hasText: "..." }) call in e2e/supporting-docs-approve-reject.spec.ts.`,
    ).toBe(true);
  });

  it("SupportingDocumentsPanel still uses the toast title the e2e spec filters on", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocumentsPanel.tsx",
    );
    expect(
      src.includes(E2E_ACTION_FAILED_TITLE),
      `SupportingDocumentsPanel.tsx no longer contains "${E2E_ACTION_FAILED_TITLE}". ` +
        `Update E2E_ACTION_FAILED_TITLE above AND the matching ` +
        `.filter({ hasText: "..." }) call in e2e/supporting-docs-approve-reject.spec.ts.`,
    ).toBe(true);
  });
});

describe("admin supporting-docs success-toast copy sync guard", () => {
  // ── SupportingDocumentsTab ───────────────────────────────────────────────

  it("SupportingDocumentsTab act() approved branch uses the expected hard-coded toast title", () => {
    const src = readSource(
      "client/src/components/admin/tabs/SupportingDocumentsTab.tsx",
    );
    expect(
      src.includes(DOC_APPROVED_TITLE),
      `SupportingDocumentsTab.tsx no longer contains "${DOC_APPROVED_TITLE}". ` +
        `Update DOC_APPROVED_TITLE above and audit every component that renders ` +
        `a single-document approved toast.`,
    ).toBe(true);
  });

  it("SupportingDocumentsTab act() rejected branch uses the expected hard-coded toast title", () => {
    const src = readSource(
      "client/src/components/admin/tabs/SupportingDocumentsTab.tsx",
    );
    expect(
      src.includes(DOC_REJECTED_TITLE),
      `SupportingDocumentsTab.tsx no longer contains "${DOC_REJECTED_TITLE}". ` +
        `Update DOC_REJECTED_TITLE above and audit every component that renders ` +
        `a single-document rejected toast.`,
    ).toBe(true);
  });

  // ── SupportingDocumentsPanel ─────────────────────────────────────────────

  it("SupportingDocumentsPanel act() approved branch uses the expected hard-coded toast title", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocumentsPanel.tsx",
    );
    expect(
      src.includes(DOC_APPROVED_TITLE),
      `SupportingDocumentsPanel.tsx no longer contains "${DOC_APPROVED_TITLE}". ` +
        `Update DOC_APPROVED_TITLE above and audit every component that renders ` +
        `a single-document approved toast.`,
    ).toBe(true);
  });

  it("SupportingDocumentsPanel act() rejected branch uses the expected hard-coded toast title", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocumentsPanel.tsx",
    );
    expect(
      src.includes(DOC_REJECTED_TITLE),
      `SupportingDocumentsPanel.tsx no longer contains "${DOC_REJECTED_TITLE}". ` +
        `Update DOC_REJECTED_TITLE above and audit every component that renders ` +
        `a single-document rejected toast.`,
    ).toBe(true);
  });

  // ── SupportingDocsQuickPopover (i18n) ─────────────────────────────────────
  // This component delegates to i18n rather than a hard-coded string.
  // Guard the key names so a key rename in code is caught here before it
  // causes a silent broken lookup at runtime.

  it("SupportingDocsQuickPopover act() references the expected i18n key for approved", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocsQuickPopover.tsx",
    );
    expect(
      src.includes(QUICK_POPOVER_APPROVED_I18N_KEY),
      `SupportingDocsQuickPopover.tsx no longer references the i18n key ` +
        `"${QUICK_POPOVER_APPROVED_I18N_KEY}". ` +
        `Update QUICK_POPOVER_APPROVED_I18N_KEY above and ensure the new key ` +
        `is present in every locale file under client/src/i18n/locales/*/admin.json.`,
    ).toBe(true);
  });

  it("SupportingDocsQuickPopover act() references the expected i18n key for rejected", () => {
    const src = readSource(
      "client/src/components/admin/SupportingDocsQuickPopover.tsx",
    );
    expect(
      src.includes(QUICK_POPOVER_REJECTED_I18N_KEY),
      `SupportingDocsQuickPopover.tsx no longer references the i18n key ` +
        `"${QUICK_POPOVER_REJECTED_I18N_KEY}". ` +
        `Update QUICK_POPOVER_REJECTED_I18N_KEY above and ensure the new key ` +
        `is present in every locale file under client/src/i18n/locales/*/admin.json.`,
    ).toBe(true);
  });
});
