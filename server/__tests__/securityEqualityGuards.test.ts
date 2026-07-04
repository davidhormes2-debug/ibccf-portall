/**
 * Source-string assertions for security-critical equality / inequality checks.
 *
 * Each test reads the production source file and verifies that the operator
 * used in a security-gating comparison is the strict form (=== / !==) and
 * NOT the loose form (== / !=), which could allow type-coercion bypasses.
 *
 * Pattern mirrors the existing guard in
 * server/__tests__/declarationWriteRateLimit.test.ts §"declaration
 * access-code equality check uses !== (not !=)".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Security-critical equality operator guards", () => {
  // ── portal-auth.ts: access-code revocation check ──────────────────────────
  //
  // isCaseSessionRevoked compares the DB-stored access code against the value
  // embedded in the session to detect credential rotation (key reissue /
  // reactivation). A loose != would coerce types and could let a stale session
  // survive after the admin rotates the access code.
  it("portal-auth.ts access-code revocation check uses !== (not !=)", () => {
    const src = readFileSync(
      resolve("server/services/portal-auth.ts"),
      "utf8",
    );
    expect(
      src,
      "portal-auth.ts access-code revocation check must use !== (strict inequality, not !=)",
    ).toMatch(/row\.accessCode !== sessionAccessCode/);
    expect(
      src,
      "portal-auth.ts access-code revocation check must NOT use loose != inequality",
    ).not.toMatch(/row\.accessCode !=[^=]/);
  });

  // ── portal-auth.ts: force-logout revocation check ────────────────────────
  //
  // isCaseSessionRevoked uses a strict > comparison to detect whether the DB
  // row's forceLogoutAt timestamp falls after the session's creation time.
  // Using >= would incorrectly revoke sessions born in the same millisecond as
  // the admin action. Any drift toward a loose or widened operator could
  // silently break the revocation boundary in either direction.
  it("portal-auth.ts force-logout revocation check uses > (not >=)", () => {
    const src = readFileSync(
      resolve("server/services/portal-auth.ts"),
      "utf8",
    );
    expect(
      src,
      "portal-auth.ts force-logout check must use new Date(row.forceLogoutAt) > sessionCreatedAt (strict greater-than)",
    ).toMatch(/new Date\(row\.forceLogoutAt\) > sessionCreatedAt/);
    expect(
      src,
      "portal-auth.ts force-logout check must NOT use >= (greater-than-or-equal)",
    ).not.toMatch(/new Date\(row\.forceLogoutAt\) >=[^>]/);
  });

  // ── portal-auth.ts: session-to-case binding check ─────────────────────────
  //
  // isAuthorizedForCase and requirePortalSessionOnly both verify that the
  // session's caseId matches the route's caseId parameter. A loose !=
  // could coerce types and let a session bound to one case satisfy the
  // binding check for a different case.
  it("portal-auth.ts session caseId binding uses !== (not !=)", () => {
    const src = readFileSync(
      resolve("server/services/portal-auth.ts"),
      "utf8",
    );
    expect(
      src,
      "portal-auth.ts session caseId binding must use !== (strict inequality, not !=)",
    ).toMatch(/session\.caseId !== caseId/);
    expect(
      src,
      "portal-auth.ts session caseId binding must NOT use loose != inequality",
    ).not.toMatch(/session\.caseId !=[^=]/);
  });

  // ── cases.ts: legacy plaintext PIN check ──────────────────────────────────
  //
  // verifyPin falls back to a direct string comparison for legacy unhashed
  // PINs before migrating them to bcrypt. A loose == would coerce types
  // (e.g. a numeric 0 matches an empty string in JS) and could allow a
  // plaintext-PIN bypass before the migration completes.
  it("cases.ts legacy plaintext PIN check uses === (not ==)", () => {
    const src = readFileSync(resolve("server/routes/cases.ts"), "utf8");
    expect(
      src,
      "cases.ts legacy PIN comparison must use === (strict equality, not ==)",
    ).toMatch(/pin === storedPin/);
    expect(
      src,
      "cases.ts legacy PIN comparison must NOT use loose == equality",
    ).not.toMatch(/pin ==[^=]/);
  });

  // ── withdrawalRequests.ts: legacy plaintext PIN check ─────────────────────
  //
  // verifyPinOnly in the withdrawal-requests route mirrors the same legacy
  // PIN path. The same type-coercion risk applies here.
  it("withdrawalRequests.ts legacy plaintext PIN check uses === (not ==)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalRequests.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalRequests.ts legacy PIN comparison must use === (strict equality, not ==)",
    ).toMatch(/pin === storedPin/);
    expect(
      src,
      "withdrawalRequests.ts legacy PIN comparison must NOT use loose == equality",
    ).not.toMatch(/pin ==[^=]/);
  });

  // ── admin.ts: env-var admin password fallback check ───────────────────────
  //
  // When no DB-stored password override is present, POST /api/admin/login
  // compares the submitted password against the ADMIN_PASSWORD env var
  // using strict ===. A loose == would coerce types and could allow a
  // numeric-coercible or empty-string value to match.
  it("admin.ts env-var password fallback check uses === (not ==)", () => {
    const src = readFileSync(resolve("server/routes/admin.ts"), "utf8");
    expect(
      src,
      "admin.ts env-var password check must use === (strict equality, not ==)",
    ).toMatch(/password === ADMIN_PASSWORD/);
    expect(
      src,
      "admin.ts env-var password check must NOT use loose == equality",
    ).not.toMatch(/password ==[^=] ADMIN_PASSWORD/);
  });

  // ── admin.ts: session-listing isCurrent annotation ───────────────────────
  //
  // The sessions GET handler annotates which session belongs to the caller by
  // comparing the stored token against the bearer token extracted from the
  // request. While this only affects UI display today, the comparison must
  // stay strict (===) so that a future refactor cannot accidentally widen the
  // trust boundary through type coercion (e.g. a numeric 0 matching a falsy
  // token in a loose == comparison).
  it("admin.ts session isCurrent annotation uses === (not ==)", () => {
    const src = readFileSync(resolve("server/routes/admin.ts"), "utf8");
    expect(
      src,
      "admin.ts isCurrent annotation must use === (strict equality, not ==)",
    ).toMatch(/token === currentToken/);
    expect(
      src,
      "admin.ts isCurrent annotation must NOT use loose == equality",
    ).not.toMatch(/token ==[^=] currentToken/);
  });

  // ── withdrawalActivation.ts: activation-status gate for OTP issuance ──────
  //
  // The OTP-issuance route only allows code delivery when
  // withdrawalActivationStatus is exactly 'awaiting_token'. The gate uses
  // strict !== so that a non-string value (e.g. null / undefined) can never
  // coerce-equal to 'awaiting_token' and sneak past the state-machine check.
  // A loose != would allow type coercion that could let an unexpected status
  // value bypass the gate and issue a security code at the wrong step.
  it("withdrawalActivation.ts awaiting_token status gate uses !== (not !=)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalActivation.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalActivation.ts OTP-issuance status gate must use !== (strict inequality, not !=)",
    ).toMatch(/withdrawalActivationStatus !== 'awaiting_token'/);
    expect(
      src,
      "withdrawalActivation.ts OTP-issuance status gate must NOT use loose != inequality",
    ).not.toMatch(/withdrawalActivationStatus !=[^=]/);
  });

  // ── withdrawalActivation.ts: receipt-linkage status gates ─────────────────
  //
  // The receipt-linkage routes (link-existing and direct-upload) both guard
  // the state transition with three strict !== comparisons: awaiting_deposit,
  // rejected, and awaiting_admin_approval. Any loose != would allow a
  // non-string DB value (e.g. null) to coerce-equal to one of these string
  // literals and skip the gate, permitting a receipt attachment at the wrong
  // step of the activation state machine.
  it("withdrawalActivation.ts receipt-linkage status gates use !== (not !=)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalActivation.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalActivation.ts receipt-linkage must gate on !== 'awaiting_deposit' (strict inequality)",
    ).toMatch(/withdrawalActivationStatus !== 'awaiting_deposit'/);
    expect(
      src,
      "withdrawalActivation.ts receipt-linkage must gate on !== 'rejected' (strict inequality)",
    ).toMatch(/withdrawalActivationStatus !== 'rejected'/);
    expect(
      src,
      "withdrawalActivation.ts receipt-linkage must gate on !== 'awaiting_admin_approval' (strict inequality)",
    ).toMatch(/withdrawalActivationStatus !== 'awaiting_admin_approval'/);
  });

  // ── withdrawalActivation.ts: admin-review activation-status gate ──────────
  //
  // The admin approve/reject route must confirm the case is currently in
  // 'awaiting_admin_approval' before committing an outcome. Without this gate
  // an admin could double-approve or act on a case that is still in an earlier
  // step. The gate uses strict !== so that a non-string DB value (e.g. null)
  // can never coerce-equal to the string literal and produce a spurious early
  // exit path.
  it("withdrawalActivation.ts admin-review status gate uses !== (not !=)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalActivation.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalActivation.ts admin-review must gate on !== 'awaiting_admin_approval' (strict inequality)",
    ).toMatch(/withdrawalActivationStatus !== 'awaiting_admin_approval'/);
  });

  // ── withdrawalActivation.ts: admin-settings auto-advance (token→deposit) ──
  //
  // The admin settings PATCH route auto-advances the activation status from
  // 'awaiting_token' to 'awaiting_deposit' when the OTP requirement is turned
  // off. The comparison uses strict === so that a non-string DB value (e.g.
  // null) can never coerce-equal to 'awaiting_token' and trigger an unintended
  // state transition.
  it("withdrawalActivation.ts auto-advance awaiting_token check uses === (not ==)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalActivation.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalActivation.ts auto-advance must compare === 'awaiting_token' with strict-equality-guard annotation",
    ).toMatch(/=== 'awaiting_token' \/\/ strict-equality-guard/);
    expect(
      src,
      "withdrawalActivation.ts auto-advance must NOT use loose == for awaiting_token comparison",
    ).not.toMatch(/==[^=] 'awaiting_token'/);
  });

  // ── withdrawalActivation.ts: admin-settings auto-advance (deposit→token) ──
  //
  // The symmetric branch re-enables the OTP step by comparing against
  // 'awaiting_deposit'. The strict === prevents a null/undefined DB value
  // from coerce-matching and incorrectly bouncing the user back to the token
  // step when they are not in the deposit step.
  it("withdrawalActivation.ts auto-advance awaiting_deposit check uses === (not ==)", () => {
    const src = readFileSync(
      resolve("server/routes/withdrawalActivation.ts"),
      "utf8",
    );
    expect(
      src,
      "withdrawalActivation.ts auto-advance must compare === 'awaiting_deposit' with strict-equality-guard annotation",
    ).toMatch(/=== 'awaiting_deposit' && \/\/ strict-equality-guard/);
    expect(
      src,
      "withdrawalActivation.ts auto-advance must NOT use loose == for awaiting_deposit comparison",
    ).not.toMatch(/==[^=] 'awaiting_deposit'/);
  });
});
