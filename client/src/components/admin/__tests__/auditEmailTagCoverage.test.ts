// Regression guard: every lifecycle email tag used in the three canonical server
// source files must have a human-readable label in AUDIT_ACTION_LABELS so the
// audit UI never silently falls back to the raw action string.
//
// Scanned files:
//   server/services/emailNotify.ts         — defines the email_${tag} pattern
//   server/routes/cases.ts                 — largest source of sendCaseEmailWithAudit calls
//   server/portal-warning-expiry-sweep.ts  — countdown_expired / reactivation_required sweep

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { AUDIT_ACTION_LABELS } from "../auditValueFormatter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../../../../../", relPath), "utf8");
}

/**
 * Extract every `tag: 'X'` / `tag: "X"` literal from sendCaseEmailWithAudit
 * calls.  We exclude tags that already start with `email_` because those
 * produce double-prefixed actions (`email_email_*`) which are a pre-existing
 * naming anomaly in the codebase, not new lifecycle tags.
 */
function extractSendAuditTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/tag:\s*['"]([^'"]+)['"]/g)) {
    const tag = m[1];
    if (!tag.startsWith("email_")) {
      tags.push(tag);
    }
  }
  return [...new Set(tags)];
}

/**
 * Extract direct `email_*` action string literals that appear explicitly as
 * the value of an `action:` key in an audit log call.  Matches both the
 * plain `action: 'email_X'` form and the ternary `action: result.success ?
 * 'email_X' : 'email_X_failed'` form.  This is deliberately stricter than a
 * blanket `email_*` scan so we don't pick up DB column names, comments, or
 * sendCaseEmailWithAudit `tag:` values.
 */
function extractDirectEmailActions(src: string): string[] {
  const actions: string[] = [];
  // Match: action: 'email_X'  OR  action: "email_X"
  // Also matches the success arm of: action: result.success ? 'email_X' : 'email_X_failed'
  for (const m of src.matchAll(/action:\s*(?:result\.success\s*\?\s*)?['"]email_([a-z][a-z0-9_-]*)['"](?:\s*:\s*['"]email_([a-z][a-z0-9_-]*)['"])?/g)) {
    // m[1] is the success action suffix, m[2] (if present) is the failure action suffix
    const successAction = `email_${m[1]}`;
    actions.push(successAction);
    if (m[2]) {
      actions.push(`email_${m[2]}`);
    } else {
      // Standalone action: no paired failure arm — still record it
    }
  }
  return [...new Set(actions)];
}

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

const emailNotifySrc = readSource("server/services/emailNotify.ts");
const casesSrc = readSource("server/routes/cases.ts");
const sweepSrc = readSource("server/portal-warning-expiry-sweep.ts");

const allSendAuditTags = [
  ...extractSendAuditTags(emailNotifySrc),
  ...extractSendAuditTags(casesSrc),
  ...extractSendAuditTags(sweepSrc),
].filter((v, i, a) => a.indexOf(v) === i);

const allDirectEmailActions = [
  ...extractDirectEmailActions(emailNotifySrc),
  ...extractDirectEmailActions(casesSrc),
  ...extractDirectEmailActions(sweepSrc),
].filter((v, i, a) => a.indexOf(v) === i);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AUDIT_ACTION_LABELS — sendCaseEmailWithAudit tag coverage", () => {
  it("is a non-empty map so the guard is meaningful", () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).length).toBeGreaterThan(0);
  });

  it.each(allSendAuditTags)(
    "tag '%s' → email_%s and email_%s_failed both have labels",
    (tag) => {
      const successKey = `email_${tag}`;
      const failureKey = `email_${tag}_failed`;

      expect(
        AUDIT_ACTION_LABELS,
        `Missing label for "${successKey}". ` +
          `Add  ${successKey}: "…human label…"  to AUDIT_ACTION_LABELS in ` +
          `client/src/components/admin/auditValueFormatter.tsx`,
      ).toHaveProperty(successKey);

      expect(
        AUDIT_ACTION_LABELS,
        `Missing label for "${failureKey}". ` +
          `Add  ${failureKey}: "…human label…"  to AUDIT_ACTION_LABELS in ` +
          `client/src/components/admin/auditValueFormatter.tsx`,
      ).toHaveProperty(failureKey);
    },
  );
});

describe("AUDIT_ACTION_LABELS — direct email_* action string coverage", () => {
  it.each(allDirectEmailActions)(
    "direct action '%s' has a label",
    (action) => {
      expect(
        AUDIT_ACTION_LABELS,
        `Missing label for "${action}". ` +
          `Add  ${action}: "…human label…"  to AUDIT_ACTION_LABELS in ` +
          `client/src/components/admin/auditValueFormatter.tsx`,
      ).toHaveProperty(action);
    },
  );
});
