/**
 * e2e/refund-claim-admin-only-guard.spec.ts
 *
 * Regression guard: POST /api/cases/:id/refund-claim/approve and
 * POST /api/cases/:id/refund-claim/reject must return 401 when called with a
 * real portal session token.
 *
 * The existing unit suite (server/__tests__/cases.refundClaim.test.ts) covers
 * this with mocked middleware.  This spec boots the real server (no mocks) and
 * issues actual HTTP requests so any middleware-wiring regression that mocks
 * could mask is caught at the integration level.
 *
 * Flow:
 *  1. Admin creates a case and activates the refund-claim flow.
 *  2. Portal user submits the claim (so both approve and reject endpoints can
 *     find a claim in "submitted" state, proving the guard fires before any
 *     business logic even runs).
 *  3. A real portal session token is sent to /approve — expect 401.
 *  4. A real portal session token is sent to /reject — expect 401.
 *  5. Tear down the test case.
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

const SAMPLE_ENTRIES = [
  {
    amount: "250",
    chargedFor: "Admin guard test entry",
    date: "2025-03-10",
    txId: "guard-tx-001",
    network: "ERC20",
    notes: "Seeded for admin-only guard spec",
  },
];

test.describe("Refund Claim admin-only route guard (real server)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the refund-claim admin-only guard e2e tests",
      );
    }
  });

  test("portal session token is rejected with 401 on the approve endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCAG1");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Guard Approve Test",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-guard-ap") },
    });

    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    const activateRes = await api.post(
      `/api/cases/${caseId}/refund-claim/request`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { documentaryRecommendations: "Guard test — please submit." },
      },
    );
    expect(activateRes.status(), "activate refund claim").toBe(200);

    const submitRes = await api.patch(`/api/cases/${caseId}/refund-claim`, {
      headers: { "x-portal-session-token": sessionToken },
      data: { entries: SAMPLE_ENTRIES, submit: true },
    });
    expect(submitRes.status(), "portal submits refund claim").toBe(200);

    const approveRes = await api.post(
      `/api/cases/${caseId}/refund-claim/approve`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {},
      },
    );
    expect(
      approveRes.status(),
      "approve endpoint must reject portal session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  test("portal session token is rejected with 401 on the reject endpoint", async ({
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCAG2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Guard Reject Test",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-guard-rej") },
    });

    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    const activateRes = await api.post(
      `/api/cases/${caseId}/refund-claim/request`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { documentaryRecommendations: "Guard test — please submit." },
      },
    );
    expect(activateRes.status(), "activate refund claim").toBe(200);

    const submitRes = await api.patch(`/api/cases/${caseId}/refund-claim`, {
      headers: { "x-portal-session-token": sessionToken },
      data: { entries: SAMPLE_ENTRIES, submit: true },
    });
    expect(submitRes.status(), "portal submits refund claim").toBe(200);

    const rejectRes = await api.post(
      `/api/cases/${caseId}/refund-claim/reject`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {},
      },
    );
    expect(
      rejectRes.status(),
      "reject endpoint must reject portal session token with 401",
    ).toBe(401);

    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});
