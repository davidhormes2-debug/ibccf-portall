/**
 * Case-Created Confirmation Email — Timing Gap (PATCH after POST)
 *
 * When an admin creates a case via POST /api/cases without setting userEmail,
 * the fire-and-forget block that sends the case-created confirmation immediately
 * reads userEmail from the DB and silently skips the send because the field is
 * absent at that instant.
 *
 * If the admin subsequently patches userEmail via PATCH /api/cases/:id, no
 * second confirmation send is triggered — the PATCH handler does not call
 * sendCaseCreatedConfirmation.  This test suite documents both halves of that
 * known timing gap and verifies the warning log that alerts admins so they
 * know to re-send manually.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const CASES_ROUTE = path.resolve(__dirname, "../routes/cases.ts");
const src = fs.readFileSync(CASES_ROUTE, "utf8");
const lines = src.split("\n");

// ---------------------------------------------------------------------------
// Helper: extract the source lines belonging to a labelled block, bounded by
// the next top-level router registration (`casesRouter.`) so we never bleed
// into an unrelated handler.
// ---------------------------------------------------------------------------
function extractBlock(startPattern: RegExp): string {
  const startIdx = lines.findIndex((l) => startPattern.test(l));
  if (startIdx === -1) return "";
  // Find the next casesRouter. registration after startIdx to bound the slice
  const endIdx = lines.findIndex(
    (l, i) => i > startIdx && /casesRouter\.(get|post|put|patch|delete)\(/.test(l),
  );
  return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join("\n");
}

const postBlock = extractBlock(/casesRouter\.post\(\s*["'\/](?!.*:id).*["']/);
const patchBlock = extractBlock(/casesRouter\.patch\(\s*["']\/:id["']\s*,/);

// ---------------------------------------------------------------------------
// Timing-gap documentation: POST handler skips email when userEmail is absent
// ---------------------------------------------------------------------------
describe("POST /api/cases — case-created email timing gap", () => {
  it("POST handler only calls sendCaseCreatedConfirmation when caseData.userEmail is truthy", () => {
    // The fire-and-forget block must be guarded by `if (caseData?.userEmail)`.
    // Without this guard the send would still be a no-op (emailService rejects
    // an empty address) but the guard is what makes the skip intentional and
    // auditable.
    expect(postBlock).toContain("sendCaseCreatedConfirmation");
    expect(postBlock).toMatch(/if\s*\(\s*caseData\?\.userEmail\s*\)/);
  });

  it("POST handler sends no email when case is created without userEmail (timing gap documented)", () => {
    // When userEmail is absent at creation time the guard short-circuits;
    // there is no fallback send, no retry, and no queued task.  This is the
    // known timing gap: confirmation is silently skipped.
    //
    // The guard condition appears BEFORE any sendCaseCreatedConfirmation call
    // inside the post block, meaning a falsy userEmail exits the block without
    // sending.
    const guardIdx = postBlock.indexOf("if (caseData?.userEmail)");
    const sendIdx = postBlock.indexOf("sendCaseCreatedConfirmation");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThan(guardIdx);
  });
});

// ---------------------------------------------------------------------------
// Timing-gap documentation: PATCH handler does NOT call sendCaseCreatedConfirmation
// ---------------------------------------------------------------------------
describe("PATCH /api/cases/:id — confirmation email NOT re-sent on userEmail patch", () => {
  it("PATCH handler never calls sendCaseCreatedConfirmation", () => {
    // The PATCH handler triggers several email notifications (letterSent,
    // payout wallet, token wallet setup, etc.) but deliberately does NOT call
    // sendCaseCreatedConfirmation.  Patching userEmail after creation cannot
    // silently re-trigger a confirmation because no such call exists in this
    // handler.
    expect(patchBlock).not.toContain("sendCaseCreatedConfirmation");
  });

  it("PATCH handler has no case_created email tag in its code path", () => {
    // The `case_created` audit tag is only written by the POST handler's
    // fire-and-forget block.  Its absence from the PATCH block confirms that
    // patching userEmail cannot accidentally trigger or log a second send.
    expect(patchBlock).not.toContain("'case_created'");
    expect(patchBlock).not.toContain('"case_created"');
  });
});

// ---------------------------------------------------------------------------
// Warning log: PATCH warns when userEmail is set for the first time
// ---------------------------------------------------------------------------
describe("PATCH /api/cases/:id — first-time userEmail warning log", () => {
  it("PATCH handler logs a warning when userEmail transitions from absent to set", () => {
    // When an admin patches userEmail for the first time the server must
    // emit a console.warn (or warnOnce) so that the audit trail and server
    // logs carry a visible signal.  The message must reference both the
    // timing-gap fact and a suggested action.
    expect(patchBlock).toMatch(
      /cases:patch-user-email-first-set|patch.*userEmail.*first|userEmail.*first.*PATCH/,
    );
  });

  it("warning fires only on the null→set transition, not on every patch", () => {
    // The guard must compare before?.userEmail (the pre-patch value) to the
    // updated email so the warning does not fire when userEmail was already
    // present.  Look for a before?.userEmail falsy check around the warnOnce.
    expect(patchBlock).toMatch(/before\??\.userEmail/);
    expect(patchBlock).toContain("cases:patch-user-email-first-set");
  });
});
