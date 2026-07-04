/**
 * e2e/certificate-fee-stamp-duty-mirror-guard.spec.ts
 *
 * Regression guard: the certificate-fee-payment and stamp-duty-receipt
 * review routes in server/routes/cases.ts are guarded by `checkAdminAuth`
 * (admin-bearer-only) — the same pattern already covered for the
 * refund-claim certificate download in
 * e2e/refund-claim-certificate-guard.spec.ts. This spec adds the analogous
 * mirror/impersonation-token regression test for those routes:
 *
 *   - GET  /api/cases/:id/certificate/fee-payments/:paymentId  (full row incl. receipt blob)
 *   - POST /api/cases/:id/certificate/fee-payments/:paymentId/approve
 *   - POST /api/cases/:id/certificate/fee-payments/:paymentId/reject
 *   - GET  /api/cases/:id/stamp-duty/receipts/:receiptId       (full row incl. receipt blob)
 *   - POST /api/cases/:id/stamp-duty/receipts/:receiptId/approve
 *   - POST /api/cases/:id/stamp-duty/receipts/:receiptId/reject
 *
 * Each test mints a mirror ("open as user") token the way the admin
 * dashboard's "Open as User" button does, redeems it into a mirror portal
 * session token, and sends that token to the route under test — the auth
 * guard must fire (401) before any business logic, so no real fee-payment
 * or stamp-duty-receipt row needs to exist first. This guards against a
 * future refactor of `checkAdminAuth` or these routes accidentally
 * widening mirror-token scope to a surface that must stay
 * admin-bearer-only.
 *
 * This spec boots the real server (no mocks) so any middleware-wiring
 * regression that unit-test mocks could mask is caught at the integration
 * level, matching the approach in e2e/refund-claim-certificate-guard.spec.ts.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  deleteCase,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// checkAdminAuth fires before any params/business-logic validation, so a
// dummy (nonexistent) numeric id is sufficient to exercise the auth guard —
// no real fee-payment or stamp-duty-receipt row needs to be created first.
const DUMMY_ID = "999999999";

async function mintAndRedeemMirrorToken(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  reason: string,
): Promise<string> {
  const mintRes = await api.post(`/api/admin/cases/${caseId}/mirror-token`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { reason },
  });
  expect(mintRes.status(), "admin must be able to mint a mirror token").toBe(
    200,
  );
  const { mirrorToken } = await mintRes.json();
  expect(typeof mirrorToken).toBe("string");

  const redeemRes = await api.post("/api/admin/cases/redeem-mirror-token", {
    data: { token: mirrorToken },
  });
  expect(redeemRes.status(), "mirror token must redeem successfully").toBe(
    200,
  );
  const { portalSessionToken } = await redeemRes.json();
  expect(typeof portalSessionToken).toBe("string");
  return portalSessionToken as string;
}

test.describe("Certificate fee payment & stamp duty receipt mirror-token guard (real server)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the certificate fee / stamp duty mirror guard e2e tests",
      );
    }
  });

  test("mirror session token is rejected with 401 on the certificate fee payment download endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ECFMG1");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Fee Mirror Guard Test",
      extraPatch: { userEmail: uniqueEmail("e2e-cf-mirror-guard") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for certificate fee payment download guard",
    );

    const res = await api.get(
      `/api/cases/${caseId}/certificate/fee-payments/${DUMMY_ID}`,
      { headers: { "x-portal-session-token": mirrorSessionToken } },
    );
    expect(
      res.status(),
      "certificate fee payment download endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror session token is rejected with 401 on the certificate fee payment approve endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ECFMG2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Fee Mirror Guard Approve Test",
      extraPatch: { userEmail: uniqueEmail("e2e-cf-mirror-guard-approve") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for certificate fee payment approve guard",
    );

    const res = await api.post(
      `/api/cases/${caseId}/certificate/fee-payments/${DUMMY_ID}/approve`,
      {
        headers: { "x-portal-session-token": mirrorSessionToken },
        data: {},
      },
    );
    expect(
      res.status(),
      "certificate fee payment approve endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror session token is rejected with 401 on the certificate fee payment reject endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ECFMG3");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Certificate Fee Mirror Guard Reject Test",
      extraPatch: { userEmail: uniqueEmail("e2e-cf-mirror-guard-reject") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for certificate fee payment reject guard",
    );

    const res = await api.post(
      `/api/cases/${caseId}/certificate/fee-payments/${DUMMY_ID}/reject`,
      {
        headers: { "x-portal-session-token": mirrorSessionToken },
        data: {},
      },
    );
    expect(
      res.status(),
      "certificate fee payment reject endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror session token is rejected with 401 on the stamp duty receipt download endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ESDMG1");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Stamp Duty Mirror Guard Test",
      extraPatch: { userEmail: uniqueEmail("e2e-sd-mirror-guard") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for stamp duty receipt download guard",
    );

    const res = await api.get(
      `/api/cases/${caseId}/stamp-duty/receipts/${DUMMY_ID}`,
      { headers: { "x-portal-session-token": mirrorSessionToken } },
    );
    expect(
      res.status(),
      "stamp duty receipt download endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror session token is rejected with 401 on the stamp duty receipt approve endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ESDMG2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Stamp Duty Mirror Guard Approve Test",
      extraPatch: { userEmail: uniqueEmail("e2e-sd-mirror-guard-approve") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for stamp duty receipt approve guard",
    );

    const res = await api.post(
      `/api/cases/${caseId}/stamp-duty/receipts/${DUMMY_ID}/approve`,
      {
        headers: { "x-portal-session-token": mirrorSessionToken },
        data: {},
      },
    );
    expect(
      res.status(),
      "stamp duty receipt approve endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("mirror session token is rejected with 401 on the stamp duty receipt reject endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ESDMG3");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Stamp Duty Mirror Guard Reject Test",
      extraPatch: { userEmail: uniqueEmail("e2e-sd-mirror-guard-reject") },
    });

    const mirrorSessionToken = await mintAndRedeemMirrorToken(
      api,
      adminToken,
      caseId,
      "E2E regression test for stamp duty receipt reject guard",
    );

    const res = await api.post(
      `/api/cases/${caseId}/stamp-duty/receipts/${DUMMY_ID}/reject`,
      {
        headers: { "x-portal-session-token": mirrorSessionToken },
        data: {},
      },
    );
    expect(
      res.status(),
      "stamp duty receipt reject endpoint must reject a mirror/impersonation session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});
