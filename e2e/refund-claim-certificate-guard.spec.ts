/**
 * e2e/refund-claim-certificate-guard.spec.ts
 *
 * Regression guard: GET /api/cases/:id/refund-claim/certificate must return
 * 401 when called with a real portal session token.
 *
 * The route is guarded by checkAdminAuth (admin-only).  A portal session token
 * must never be sufficient to download the certificate PDF.  This spec boots
 * the real server (no mocks) so any middleware-wiring regression that mocks
 * could mask is caught at the integration level.
 *
 * Test 1 (baseline):
 *  1. Admin creates a case.
 *  2. A portal session token is obtained for that case.
 *  3. The portal token is sent to GET /refund-claim/certificate — expect 401.
 *     (The auth guard fires before any business logic, so the claim doesn't
 *     need to be in an approved state.)
 *  4. Tear down the test case.
 *
 * Test 2 (approved-claim regression path):
 *  1. Admin creates a case.
 *  2. A portal session token is obtained for that case.
 *  3. Admin activates the refund-claim flow (POST /refund-claim/request).
 *  4. Portal user submits the claim (PATCH /refund-claim with submit:true).
 *  5. Admin approves the claim (POST /refund-claim/approve).
 *  6. The portal token is sent to GET /refund-claim/certificate — expect 401.
 *     This catches a regression where the route checks claim status before
 *     auth, allowing a portal user with an approved claim to slip through.
 *  7. Tear down the test case.
 *
 * Test 3 (rejected-claim regression path):
 *  1. Admin creates a case.
 *  2. A portal session token is obtained for that case.
 *  3. Admin activates the refund-claim flow (POST /refund-claim/request).
 *  4. Portal user submits the claim (PATCH /refund-claim with submit:true).
 *  5. Admin rejects the claim (POST /refund-claim/reject).
 *  6. The portal token is sent to GET /refund-claim/certificate — expect 401.
 *     Symmetric check to Test 2: a rejected claim must not open a different
 *     error-path branch that skips the admin-auth guard.
 *  7. Tear down the test case.
 *
 * Test 4 (mirror/impersonation-token regression path):
 *  1. Admin creates a case.
 *  2. Admin mints a mirror ("open as user") token via
 *     POST /api/admin/cases/:id/mirror-token, then redeems it via
 *     POST /api/admin/cases/redeem-mirror-token to obtain a mirror portal
 *     session token — the same narrow, short-lived credential the "view as
 *     user" flow hands to a real browser tab.
 *  3. The mirror portal session token is sent to
 *     GET /refund-claim/certificate — expect 401.
 *     checkAdminAuth accepts full admin bearer tokens AND mirror tokens for
 *     some routes; this test guards against a future refactor accidentally
 *     widening mirror-token scope to cover the certificate download route,
 *     which must stay admin-bearer-only.
 *  4. Tear down the test case.
 */

import { test, expect, request } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  issuePortalSession,
  deleteCase,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const TEST_PIN = "836492";

test.describe("Refund Claim certificate download guard (real server)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the refund-claim certificate guard e2e tests",
      );
    }
  });

  test("portal session token is rejected with 401 on the certificate download endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCCG1");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Guard Test",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-cert-guard") },
    });

    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    const certRes = await api.get(
      `/api/cases/${caseId}/refund-claim/certificate`,
      {
        headers: { "x-portal-session-token": sessionToken },
      },
    );
    expect(
      certRes.status(),
      "certificate download endpoint must reject portal session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("portal session token is rejected with 401 even after the claim is approved", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCCG2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Guard Approved Claim",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-cert-guard-approved") },
    });

    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // Step 1: Admin activates the refund-claim flow.
    const activateRes = await api.post(
      `/api/cases/${caseId}/refund-claim/request`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { refundableAmount: "1000", documentaryRecommendations: null },
      },
    );
    expect(
      activateRes.status(),
      "admin must be able to activate the refund-claim flow",
    ).toBe(200);

    // Step 2: Portal user submits the claim.
    const submitRes = await api.patch(`/api/cases/${caseId}/refund-claim`, {
      headers: { "x-portal-session-token": sessionToken },
      data: { entries: [], submit: true },
    });
    expect(
      submitRes.status(),
      "portal user must be able to submit the refund claim",
    ).toBe(200);

    // Step 3: Admin approves the claim.
    const approveRes = await api.post(
      `/api/cases/${caseId}/refund-claim/approve`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { adminNotes: null },
      },
    );
    expect(
      approveRes.status(),
      "admin must be able to approve the refund claim",
    ).toBe(200);

    // Step 4: Portal token must still be rejected — 401 — even though the
    // claim is now in an approved state.  Catches a regression where the route
    // checks claim status before checking auth.
    const certRes = await api.get(
      `/api/cases/${caseId}/refund-claim/certificate`,
      {
        headers: { "x-portal-session-token": sessionToken },
      },
    );
    expect(
      certRes.status(),
      "certificate download endpoint must reject portal session token with 401 even for an approved claim",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("portal session token is rejected with 401 even after the claim is rejected", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCCG3");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Guard Rejected Claim",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-cert-guard-rejected") },
    });

    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // Step 1: Admin activates the refund-claim flow.
    const activateRes = await api.post(
      `/api/cases/${caseId}/refund-claim/request`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { refundableAmount: "1000", documentaryRecommendations: null },
      },
    );
    expect(
      activateRes.status(),
      "admin must be able to activate the refund-claim flow",
    ).toBe(200);

    // Step 2: Portal user submits the claim.
    const submitRes = await api.patch(`/api/cases/${caseId}/refund-claim`, {
      headers: { "x-portal-session-token": sessionToken },
      data: { entries: [], submit: true },
    });
    expect(
      submitRes.status(),
      "portal user must be able to submit the refund claim",
    ).toBe(200);

    // Step 3: Admin rejects the claim.
    const rejectRes = await api.post(
      `/api/cases/${caseId}/refund-claim/reject`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { adminNotes: null },
      },
    );
    expect(
      rejectRes.status(),
      "admin must be able to reject the refund claim",
    ).toBe(200);

    // Step 4: Portal token must still be rejected — 401 — even though the
    // claim is now in a rejected state. Symmetric check to the approved-claim
    // regression test: catches a route that checks claim status before auth.
    const certRes = await api.get(
      `/api/cases/${caseId}/refund-claim/certificate`,
      {
        headers: { "x-portal-session-token": sessionToken },
      },
    );
    expect(
      certRes.status(),
      "certificate download endpoint must reject portal session token with 401 even for a rejected claim",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror (admin-impersonation) session token is rejected with 401 on the certificate download endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCCG4");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Guard Mirror Test",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-cert-guard-mirror") },
    });

    // Step 1: mint a mirror ("open as user") token the way the admin
    // dashboard's "Open as User" button does.
    const mintRes = await api.post(
      `/api/admin/cases/${caseId}/mirror-token`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { reason: "E2E regression test for certificate auth guard" },
      },
    );
    expect(mintRes.status(), "admin must be able to mint a mirror token").toBe(
      200,
    );
    const { mirrorToken } = await mintRes.json();
    expect(typeof mirrorToken).toBe("string");

    // Step 2: redeem it the way /admin/mirror does, yielding a narrow,
    // short-lived mirror portal session token.
    const redeemRes = await api.post(
      "/api/admin/cases/redeem-mirror-token",
      { data: { token: mirrorToken } },
    );
    expect(redeemRes.status(), "mirror token must redeem successfully").toBe(
      200,
    );
    const { portalSessionToken: mirrorSessionToken } = await redeemRes.json();
    expect(typeof mirrorSessionToken).toBe("string");

    // Step 3: the mirror session token must never be sufficient to download
    // the certificate PDF — this route must stay admin-bearer-only even
    // though checkAdminAuth's broader surface accepts mirror tokens
    // elsewhere. A regression that widens mirror-token scope to this route
    // would let an impersonated session pull a document the real admin flow
    // never intended it to reach.
    const certRes = await api.get(
      `/api/cases/${caseId}/refund-claim/certificate`,
      {
        headers: { "x-portal-session-token": mirrorSessionToken },
      },
    );
    expect(
      certRes.status(),
      "certificate download endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});
