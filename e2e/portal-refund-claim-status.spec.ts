/**
 * e2e/portal-refund-claim-status.spec.ts
 *
 * Verifies that the portal's Refund Claim view reflects the correct status
 * after an admin approves or rejects a submitted refund claim.
 *
 * Flow (both tests):
 *  1. Create a case and enrol a PIN via the admin API.
 *  2. Admin activates the refund-claim flow (POST /refund-claim/request).
 *  3. Portal session submits the claim (PATCH /refund-claim with submit:true).
 *  4. Open the portal in the browser and navigate to the Refund Claim view —
 *     status banner reads "Submitted — under review".
 *  5. Admin approves (or rejects) via API.
 *  6. Reload the portal page and navigate to the Refund Claim view again —
 *     status banner now reads "Approved" (or "Not approved").
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
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

const TEST_PIN = "741852";

const SAMPLE_ENTRIES = [
  {
    amount: "500",
    chargedFor: "Activation fee",
    date: "2025-01-15",
    txId: "abc123",
    network: "TRC20",
    notes: "E2E test entry",
  },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

async function activateRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/request`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { documentaryRecommendations: "Please provide bank statement." },
  });
  expect(res.status(), "activate refund claim").toBe(200);
}

async function submitRefundClaim(
  api: APIRequestContext,
  sessionToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.patch(`/api/cases/${caseId}/refund-claim`, {
    headers: { "x-portal-session-token": sessionToken },
    data: { entries: SAMPLE_ENTRIES, submit: true },
  });
  expect(res.status(), "submit refund claim").toBe(200);
}

async function approveRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/approve`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { adminNotes: "E2E approval — looks good." },
  });
  expect(res.status(), "approve refund claim").toBe(200);
}

async function rejectRefundClaim(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/refund-claim/reject`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { adminNotes: "E2E rejection — insufficient documentation." },
  });
  expect(res.status(), "reject refund claim").toBe(200);
}

/**
 * Drive the two-step portal login form (access code → PIN) and wait for the
 * portal shell's logout button as the "authenticated" signal.
 */
async function loginPortalUi(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("input-pin")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("input-pin").fill(pin);
  await page.getByTestId("button-login").click();

  await expect(page.getByTestId("button-logout")).toBeVisible({
    timeout: 20_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal — Refund Claim nav badge clears on approve/reject", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the refund-claim badge e2e tests",
      );
    }
  });

  // ── Badge test 1: pending_submission shows amber badge ────────────────────

  test("nav badge is amber when refund claim is pending_submission", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCBPND");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Badge Pending",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-bpnd") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);
    void sessionToken;

    await activateRefundClaim(api, adminToken, caseId);
    // Status is now "pending_submission" — badge should be amber.

    await loginPortalUi(page, accessCode, TEST_PIN);

    const navItem = page.getByTestId("nav-refundClaim");
    await expect(navItem).toBeVisible({ timeout: 12_000 });

    const badge = page.getByTestId("nav-badge-refundClaim");
    await expect(badge).toBeVisible({ timeout: 8_000 });
    await expect(badge).toHaveClass(/bg-amber-500/);

    // ── Mobile viewport: verify bottom-bar badge testids ──────────────────
    // refundClaim lives in the "More" sheet on mobile, so the primary bottom-bar
    // items (deposit, messages) should carry no badge in this test flow.
    await page.setViewportSize({ width: 375, height: 812 });

    // The mobile bottom bar should be visible at this viewport.
    await expect(page.getByTestId("mobile-nav-deposit")).toBeVisible({
      timeout: 8_000,
    });

    // No deposit receipts were uploaded → mobile-nav-badge-deposit must be absent.
    await expect(
      page.getByTestId("mobile-nav-badge-deposit"),
    ).not.toBeAttached();

    // No admin messages were sent → mobile-nav-badge-messages must be absent.
    await expect(
      page.getByTestId("mobile-nav-badge-messages"),
    ).not.toBeAttached();

    // refundClaim is pending_submission and lives in the "More" sheet on mobile,
    // so the aggregate More button badge must be visible.
    await expect(page.getByTestId("mobile-nav-more-badge")).toBeVisible({
      timeout: 8_000,
    });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Badge test 2: badge disappears after admin approves ───────────────────

  test("nav badge disappears after admin approves the refund claim", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCBAP2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Badge Approve",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-bap2") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);

    await loginPortalUi(page, accessCode, TEST_PIN);

    // Confirm the badge is absent while "submitted" (badge only shows for
    // pending_submission and rejected, not submitted).
    const navItem = page.getByTestId("nav-refundClaim");
    await expect(navItem).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId("nav-badge-refundClaim")).not.toBeAttached();

    // Admin approves.
    await approveRefundClaim(api, adminToken, caseId);

    // Reload and verify badge is still absent for the approved state.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("nav-refundClaim")).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.getByTestId("nav-badge-refundClaim")).not.toBeAttached();

    // Mobile viewport: the "More" badge must also be absent after approval
    // (no badged items remain in the More sheet).
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId("mobile-nav-more")).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      page.getByTestId("mobile-nav-more-badge"),
    ).not.toBeAttached();

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Badge test 3: red badge appears after admin rejects ───────────────────

  test("nav badge turns red after admin rejects the refund claim", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCBREJ");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Badge Reject",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-brej") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);

    // Login to the portal while the claim is "submitted" — no badge expected.
    await loginPortalUi(page, accessCode, TEST_PIN);

    const navItem = page.getByTestId("nav-refundClaim");
    await expect(navItem).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId("nav-badge-refundClaim")).not.toBeAttached();

    // Admin rejects the claim via API while the portal is open.
    await rejectRefundClaim(api, adminToken, caseId);

    // Reload the portal to pick up the updated status.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 20_000,
    });

    // After reload the sidebar badge must be red (rejected state).
    await expect(page.getByTestId("nav-refundClaim")).toBeVisible({
      timeout: 12_000,
    });
    const badge = page.getByTestId("nav-badge-refundClaim");
    await expect(badge).toBeVisible({ timeout: 8_000 });
    await expect(badge).toHaveClass(/bg-red-500/);

    // Mobile viewport: the "More" badge must be visible after rejection.
    // PortalShell's badge logic (PortalShell.tsx line ~393) explicitly
    // includes `rejected` alongside `pending_submission` as badged states, so
    // moreBadgeTotal > 0 and the More button badge remains present — this
    // mirrors the red sidebar badge and prompts the user to revisit the view.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId("mobile-nav-more")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByTestId("mobile-nav-more-badge")).toBeVisible({
      timeout: 8_000,
    });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Badge test 4: mobile-nav-badge-messages is red when admin sends a message

  test("mobile-nav-badge-messages is red on mobile when admin sends an unread message", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EMSGBDG");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Mobile Badge Msg",
      extraPatch: { userEmail: uniqueEmail("e2e-mob-badge-msg") },
    });
    void (await issuePortalSession(api, accessCode, TEST_PIN));

    // Admin sends an unread message so the messages badge > 0.
    const msgRes = await api.post(`/api/cases/${caseId}/admin-messages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        category: "processing",
        title: "E2E Mobile Badge Test",
        body: "This message verifies the mobile nav badge testid.",
      },
    });
    expect(msgRes.status(), "send admin message").toBe(200);

    // Load the portal at mobile viewport so the bottom bar is rendered.
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Desktop sidebar badge for messages should be visible and red.
    const desktopBadge = page.getByTestId("nav-badge-messages");
    await expect(desktopBadge).toBeVisible({ timeout: 8_000 });
    await expect(desktopBadge).toHaveClass(/bg-red-500/);

    // Mobile bottom-bar badge for messages must match: visible and red.
    const mobileBadge = page.getByTestId("mobile-nav-badge-messages");
    await expect(mobileBadge).toBeVisible({ timeout: 8_000 });
    await expect(mobileBadge).toHaveClass(/bg-red-500/);

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal — Refund Claim status reflects admin approve/reject", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the refund-claim e2e tests",
      );
    }
  });

  // ── Test 1: Admin approves the claim ─────────────────────────────────────

  test("portal shows Approved status after admin approves the submitted claim", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCAP");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Approve",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-ap") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);

    await loginPortalUi(page, accessCode, TEST_PIN);

    const navItem = page.getByTestId("nav-refundClaim");
    await expect(navItem).toBeVisible({ timeout: 12_000 });
    await navItem.click();

    // Confirm the initial "submitted" state is rendered before the admin acts.
    await expect(page.getByTestId("refund-claim-status-banner")).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.getByTestId("refund-claim-status-banner")).toContainText(
      "Submitted",
    );

    // Admin approves the claim via API while the portal is open.
    await approveRefundClaim(api, adminToken, caseId);

    // Reload the portal to pick up the updated status.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 20_000,
    });

    // Navigate back to the Refund Claim view.
    const navItemAfterReload = page.getByTestId("nav-refundClaim");
    await expect(navItemAfterReload).toBeVisible({ timeout: 12_000 });
    await navItemAfterReload.click();

    // The status banner must now read "Approved".
    await expect(page.getByTestId("refund-claim-status-banner")).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.getByTestId("refund-claim-status-banner")).toContainText(
      "Approved",
    );

    // The certificate download card is also rendered for approved claims.
    await expect(
      page.getByTestId("refund-claim-approved-cert-card"),
    ).toBeVisible({ timeout: 8_000 });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Test 2: Admin rejects the claim ──────────────────────────────────────

  test("portal shows Not approved status after admin rejects the submitted claim", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2ERCREJ");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E Refund Reject",
      extraPatch: { userEmail: uniqueEmail("e2e-rc-rej") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    await activateRefundClaim(api, adminToken, caseId);
    await submitRefundClaim(api, sessionToken, caseId);

    await loginPortalUi(page, accessCode, TEST_PIN);

    const navItem = page.getByTestId("nav-refundClaim");
    await expect(navItem).toBeVisible({ timeout: 12_000 });
    await navItem.click();

    await expect(page.getByTestId("refund-claim-status-banner")).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.getByTestId("refund-claim-status-banner")).toContainText(
      "Submitted",
    );

    await rejectRefundClaim(api, adminToken, caseId);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 20_000,
    });

    const navItemAfterReload = page.getByTestId("nav-refundClaim");
    await expect(navItemAfterReload).toBeVisible({ timeout: 12_000 });
    await navItemAfterReload.click();

    // The status banner must now read "Not approved".
    await expect(page.getByTestId("refund-claim-status-banner")).toBeVisible({
      timeout: 12_000,
    });
    await expect(page.getByTestId("refund-claim-status-banner")).toContainText(
      "Not approved",
    );

    // The rejection details panel is also visible, including admin notes.
    await expect(
      page.getByTestId("refund-claim-rejection-admin-notes"),
    ).toContainText("E2E rejection — insufficient documentation.");

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal — More sheet badge decrements when key-request messages are read", () => {
  /**
   * Regression guard for the badge-clear path in moreBadgeTotal.
   *
   * When the portal user navigates to the Key Request view, KeyRequestView
   * calls markKeyRequestRead() on mount, which optimistically sets
   * keyRequestNotification to null.  That removes the keyRequest badge
   * contribution from moreBadgeTotal.
   *
   * A refactor that hard-codes badge=1 per item (ignoring the live unread
   * count) would pass the additive badge-sum tests but would fail here
   * because the badge would not clear after the conversation is read.
   *
   * Two scenarios are covered:
   *   A) keyRequest messages read + refundClaim still pending  → badge = 1
   *   B) keyRequest messages read + no other pending items     → badge absent
   */

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the More sheet badge decrement e2e tests",
      );
    }
  });

  // Helper: create a key request for the case via portal session, send one
  // admin message, and return the numeric DB id of the request.
  async function setupKeyRequestWithAdminMessage(
    api: APIRequestContext,
    adminToken: string,
    sessionToken: string,
    caseId: string,
    suffix: string,
  ): Promise<{ requestId: string; dbId: number }> {
    const krRes = await api.post(
      `/api/access-key-requests/portal/${caseId}`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {
          userName: `E2E Read Badge ${suffix}`,
          userEmail: uniqueEmail(`e2e-kr-read-${suffix}`),
          requestReason: `E2E badge-read test key request (${suffix})`,
        },
      },
    );
    expect(krRes.status(), `create key request (${suffix})`).toBe(201);
    const krBody = await krRes.json();
    const requestId = krBody.requestId as string;

    const listRes = await api.get("/api/access-key-requests/admin/list", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status(), "admin list key requests").toBe(200);
    const allRequests = (await listRes.json()) as Array<{
      id: number;
      requestId: string;
    }>;
    const matched = allRequests.find((r) => r.requestId === requestId);
    expect(matched, `key request ${requestId} in admin list`).toBeTruthy();
    const dbId = matched!.id;

    const msgRes = await api.post(
      `/api/access-key-requests/admin/${dbId}/message`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          message: `E2E badge-read admin message (${suffix})`,
          adminUsername: ADMIN_USERNAME,
        },
      },
    );
    expect(msgRes.status(), `send admin message (${suffix})`).toBe(200);

    return { requestId, dbId };
  }

  // ── Scenario A: badge drops from 2 to 1 when keyRequest is read ──────────
  //
  // Setup:  refundClaim(pending_submission, badge=1) + keyRequest(1 unread msg, badge=1)
  //         → moreBadgeTotal = 2 before reading
  // Action: navigate to Key Request view → markKeyRequestRead() fires → badge clears
  // Assert: moreBadgeTotal = 1 (refundClaim only)

  test("More badge drops from 2 to 1 after reading keyRequest messages when refundClaim is still pending", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EKRRD1");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E KR Read Badge 1",
      extraPatch: { userEmail: uniqueEmail("e2e-kr-rdbd1") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // Activate refund claim → badge=1 for refundClaim (pending_submission)
    await activateRefundClaim(api, adminToken, caseId);

    // Create key request + 1 admin message → badge=1 for keyRequest
    await setupKeyRequestWithAdminMessage(api, adminToken, sessionToken, caseId, "rd1");

    // Load portal at mobile viewport so the bottom bar is rendered.
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Pre-condition: aggregate More badge must equal 2.
    const moreBadge = page.getByTestId("mobile-nav-more-badge");
    await expect(moreBadge).toBeVisible({ timeout: 12_000 });
    await expect(moreBadge).toHaveText("2");

    // Navigate to Key Request view via the More sheet.
    // Clicking the nav item fires handleNav → setMoreOpen(false) + setViewState.
    // KeyRequestView mounts and calls markKeyRequestRead() optimistically,
    // which sets keyRequestNotification = null → keyRequestBadge = undefined.
    await page.getByTestId("mobile-nav-more").click();
    await expect(page.getByTestId("nav-keyRequest")).toBeVisible({
      timeout: 8_000,
    });
    await page.getByTestId("nav-keyRequest").click();

    // After KeyRequestView mounts the badge must drop to 1 (refundClaim only).
    await expect(moreBadge).toHaveText("1", { timeout: 10_000 });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Scenario B: badge disappears when keyRequest is the only pending item ─
  //
  // Setup:  keyRequest(1 unread admin msg, badge=1), no refundClaim
  //         → moreBadgeTotal = 1 before reading
  // Action: navigate to Key Request view → markKeyRequestRead() fires → badge clears
  // Assert: mobile-nav-more-badge becomes absent (moreBadgeTotal = 0)

  test("More badge disappears after reading keyRequest messages when no other items are pending", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EKRRD2");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E KR Read Badge 2",
      extraPatch: { userEmail: uniqueEmail("e2e-kr-rdbd2") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // Create key request + 1 admin message → badge=1 for keyRequest only.
    // No refundClaim activated → no other More-sheet badge contributors.
    await setupKeyRequestWithAdminMessage(api, adminToken, sessionToken, caseId, "rd2");

    // Load portal at mobile viewport.
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Pre-condition: badge must show "1" (keyRequest unread message).
    const moreBadge = page.getByTestId("mobile-nav-more-badge");
    await expect(moreBadge).toBeVisible({ timeout: 12_000 });
    await expect(moreBadge).toHaveText("1");

    // Navigate to Key Request view via the More sheet.
    await page.getByTestId("mobile-nav-more").click();
    await expect(page.getByTestId("nav-keyRequest")).toBeVisible({
      timeout: 8_000,
    });
    await page.getByTestId("nav-keyRequest").click();

    // After KeyRequestView mounts, markKeyRequestRead() sets
    // keyRequestNotification = null → moreBadgeTotal = 0 → badge absent.
    await expect(
      page.getByTestId("mobile-nav-more-badge"),
    ).not.toBeAttached({ timeout: 10_000 });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  // ── Scenario C: badge stays absent after a full page reload ───────────────
  //
  // Regression guard for read-count persistence.  The in-session tests above
  // only verify that the optimistic setKeyRequestNotification(null) clears the
  // badge within the same JS session.  This test also reloads the page so the
  // badge is recomputed from scratch (server state + localStorage sentinel).
  //
  // A regression where markKeyRequestRead silently fails to persist the read-
  // count (e.g. the PATCH to mark-read returns 401 because the x-request-email
  // header is missing) would pass the in-session scenarios above but fail here
  // because after reload:
  //   - userMessagesReadCount on the server is still 0
  //   - localStorage ibccf_kr_seen_<requestId> was never written
  //   - effectiveRead = 0, unread = adminMessageCount = 1 → badge reappears

  test("More badge stays absent after page reload following keyRequest read", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EKRRD3");

    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E KR Read Persist",
      extraPatch: { userEmail: uniqueEmail("e2e-kr-rdbd3") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // Create key request + 1 admin message → badge=1 for keyRequest only.
    await setupKeyRequestWithAdminMessage(api, adminToken, sessionToken, caseId, "rd3");

    // Load portal at mobile viewport.
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    // Pre-condition: badge must show "1".
    const moreBadge = page.getByTestId("mobile-nav-more-badge");
    await expect(moreBadge).toBeVisible({ timeout: 12_000 });
    await expect(moreBadge).toHaveText("1");

    // Navigate to Key Request view via the More sheet.
    await page.getByTestId("mobile-nav-more").click();
    await expect(page.getByTestId("nav-keyRequest")).toBeVisible({
      timeout: 8_000,
    });
    await page.getByTestId("nav-keyRequest").click();

    // In-session: badge clears optimistically when KeyRequestView mounts.
    await expect(
      page.getByTestId("mobile-nav-more-badge"),
    ).not.toBeAttached({ timeout: 10_000 });

    // Wait for the async markKeyRequestRead() PATCH to complete so
    // userMessagesReadCount is persisted server-side and localStorage
    // ibccf_kr_seen_<requestId> is written before we reload.
    // Waiting on the actual network response is more reliable than a fixed
    // timeout and eliminates flakiness in slow CI environments.
    await page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/access-key-requests/mark-read/") &&
        resp.request().method() === "PATCH",
      { timeout: 10_000 },
    );

    // Reload the page — badge computation restarts from server state +
    // localStorage.  The badge must remain absent, proving that both the
    // server-side userMessagesReadCount and the localStorage sentinel were
    // persisted by markKeyRequestRead().
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("button-logout")).toBeVisible({
      timeout: 20_000,
    });

    // After reload the More badge must still be absent.
    await expect(
      page.getByTestId("mobile-nav-more-badge"),
    ).not.toBeAttached({ timeout: 15_000 });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Portal — More sheet badge count equals sum of multiple pending items", () => {
  /**
   * Regression guard for moreBadgeTotal arithmetic.
   *
   * The More button badge on the mobile bottom bar is driven by
   * `moreBadgeTotal = mobileSecondary.reduce(sum + item.badge)` in
   * PortalShell.tsx.  This test sets up two independently-badged items that
   * both live in the More sheet — refundClaim (badge=1, pending_submission)
   * and keyRequest (badge=1, one unread admin message) — and asserts that the
   * badge text reads "2", i.e. the sum of both contributors.
   *
   * If moreBadgeTotal double-counts, only one item is counted, or the reduce
   * is rewritten to boolean, the assertion will fail and flag the regression.
   */

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the More sheet badge count e2e test",
      );
    }
  });

  test("mobile-nav-more-badge shows numeric sum when refundClaim and keyRequest are both pending", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EMOTBDG");

    // ── Step 1: Create a case and issue a portal session ─────────────────────
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E More Badge Total",
      extraPatch: { userEmail: uniqueEmail("e2e-mob-tot-bdg") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // ── Step 2: Activate refund claim → refundClaim badge = 1 ────────────────
    // Status becomes "pending_submission"; PortalShell assigns badge=1 for this
    // status, and refundClaim lives in mobileSecondary (not in the bottom bar).
    await activateRefundClaim(api, adminToken, caseId);

    // ── Step 3: Submit a portal key request for this case ────────────────────
    // POST /api/access-key-requests/portal/:caseId requires a valid portal
    // session token bound to the target case.
    const krRes = await api.post(
      `/api/access-key-requests/portal/${caseId}`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {
          userName: "E2E More Badge Total",
          userEmail: uniqueEmail("e2e-mob-tot-kr"),
          requestReason: "E2E badge-count test key request",
        },
      },
    );
    expect(krRes.status(), "create portal key request").toBe(201);
    const krBody = await krRes.json();
    const requestId = krBody.requestId as string;

    // ── Step 4: Admin sends one message → keyRequest unreadCount = 1 ─────────
    // Resolve the numeric DB id by listing admin requests and matching requestId.
    const listRes = await api.get(
      "/api/access-key-requests/admin/list",
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(listRes.status(), "admin list key requests").toBe(200);
    const allRequests = (await listRes.json()) as Array<{
      id: number;
      requestId: string;
    }>;
    const matched = allRequests.find((r) => r.requestId === requestId);
    expect(matched, `key request ${requestId} found in admin list`).toBeTruthy();
    const dbId = matched!.id;

    const msgRes = await api.post(
      `/api/access-key-requests/admin/${dbId}/message`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          message: "E2E badge-count admin message",
          adminUsername: ADMIN_USERNAME,
        },
      },
    );
    expect(msgRes.status(), "send admin message to key request").toBe(200);

    // ── Step 5: Load portal at mobile viewport and verify badge total = 2 ────
    // - refundClaim contributes badge=1 (pending_submission)
    // - keyRequest contributes badge=1 (1 admin message, 0 user-read count)
    // moreBadgeTotal = 1 + 1 = 2
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    const moreBadge = page.getByTestId("mobile-nav-more-badge");
    await expect(moreBadge).toBeVisible({ timeout: 12_000 });
    await expect(moreBadge).toHaveText("2");

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });

  /**
   * Regression guard: confirms the reduce sums multi-digit badge values, not
   * just coerces to boolean.  A refactor that replaces the accumulator with
   * `item.badge > 0 ? 1 : 0` would still pass the sum-of-2 test above but
   * would fail here because it would produce "2" instead of "4".
   *
   * Setup:
   *   - refundClaim: pending_submission → badge = 1
   *   - keyRequest:  3 admin messages  → badge = 3
   *   - moreBadgeTotal                 → expected = 4
   */
  test("mobile-nav-more-badge shows '4' when keyRequest has 3 unread messages and refundClaim is pending", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EMOTBD4");

    // ── Step 1: Create a case and issue a portal session ─────────────────────
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E More Badge Four",
      extraPatch: { userEmail: uniqueEmail("e2e-mob-tot-bd4") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // ── Step 2: Activate refund claim → refundClaim badge = 1 ────────────────
    await activateRefundClaim(api, adminToken, caseId);

    // ── Step 3: Submit a portal key request ──────────────────────────────────
    const krRes = await api.post(
      `/api/access-key-requests/portal/${caseId}`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {
          userName: "E2E More Badge Four",
          userEmail: uniqueEmail("e2e-mob-bd4-kr"),
          requestReason: "E2E badge-sum-4 test key request",
        },
      },
    );
    expect(krRes.status(), "create portal key request").toBe(201);
    const krBody = await krRes.json();
    const requestId = krBody.requestId as string;

    // ── Step 4: Resolve the numeric DB id ────────────────────────────────────
    const listRes = await api.get("/api/access-key-requests/admin/list", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status(), "admin list key requests").toBe(200);
    const allRequests = (await listRes.json()) as Array<{
      id: number;
      requestId: string;
    }>;
    const matched = allRequests.find((r) => r.requestId === requestId);
    expect(
      matched,
      `key request ${requestId} found in admin list`,
    ).toBeTruthy();
    const dbId = matched!.id;

    // ── Step 5: Admin sends 3 messages → keyRequest badge = 3 ────────────────
    for (let i = 1; i <= 3; i++) {
      const msgRes = await api.post(
        `/api/access-key-requests/admin/${dbId}/message`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: {
            message: `E2E badge-sum-4 admin message ${i}`,
            adminUsername: ADMIN_USERNAME,
          },
        },
      );
      expect(
        msgRes.status(),
        `send admin message ${i} to key request`,
      ).toBe(200);
    }

    // ── Step 6: Load portal at mobile viewport and verify badge total = 4 ────
    // - refundClaim contributes badge=1 (pending_submission)
    // - keyRequest  contributes badge=3 (3 admin messages, 0 user-read count)
    // moreBadgeTotal = 1 + 3 = 4
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    const moreBadgeFour = page.getByTestId("mobile-nav-more-badge");
    await expect(moreBadgeFour).toBeVisible({ timeout: 12_000 });
    await expect(moreBadgeFour).toHaveText("4");

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Public key-request status page — localStorage sentinel suppresses portal badge", () => {
  /**
   * Regression guard for the localStorage-based badge suppression path.
   *
   * The public /request-access?tab=check page (RequestAccessKey.tsx, ~line 260)
   * calls PATCH /api/access-key-requests/mark-read/<requestId> and then writes
   *   localStorage.setItem(`ibccf_kr_seen_${requestId}`, String(userMessagesReadCount))
   * when the user views their status with their registered email.
   *
   * PortalContext.tsx (effectiveRead computation, ~line 1287) merges the
   * server-side userMessagesReadCount with the locally-cached localSeen value:
   *   effectiveRead = Math.max(userMessagesReadCount, localSeen)
   *   unread = Math.max(0, adminMessageCount - effectiveRead)
   *
   * A regression that stops writing localStorage on the public page — e.g. the
   * email field is dropped from the UI, the PATCH returns 4xx, or the write is
   * gated behind a condition that is never true — would silently re-show the
   * badge the next time the user logs into the portal on the same device.
   *
   * Flow:
   *  1. Create a case + portal session.
   *  2. Submit a key request (captures requestId and the email used).
   *  3. Admin sends one message → adminMessageCount = 1, badge = 1.
   *  4. As an anonymous user navigate to the public status page, enter the
   *     email, submit the check → mark-read PATCH fires → localStorage written.
   *  5. Login to the portal in the same browser context (localStorage persists).
   *  6. Assert the mobile More badge is absent — proving effectiveRead ≥ 1.
   *
   * The test fails if localStorage is never written because after portal login
   * effectiveRead = 0, unread = 1, and the badge renders "1" instead of absent.
   */

  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the public key-request localStorage e2e tests",
      );
    }
  });

  test("More badge is absent after portal login when the public status page wrote the localStorage sentinel", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();
    const accessCode = uniqueAccessCode("E2EKRPUB");
    const krEmail = uniqueEmail("e2e-kr-pub");

    // ── Step 1: Create a case and issue a portal session ──────────────────────
    const caseId = await createCase(api, adminToken, accessCode, {
      userName: "E2E KR Public Badge",
      extraPatch: { userEmail: uniqueEmail("e2e-kr-pub-case") },
    });
    const sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);

    // ── Step 2: Create a key request via the portal session ───────────────────
    // Use a distinct email so the public status page can supply it to the
    // mark-read endpoint (the PATCH requires X-Request-Email to match).
    const krRes = await api.post(
      `/api/access-key-requests/portal/${caseId}`,
      {
        headers: { "x-portal-session-token": sessionToken },
        data: {
          userName: "E2E KR Public Badge",
          userEmail: krEmail,
          requestReason: "E2E public-page localStorage sentinel test",
        },
      },
    );
    expect(krRes.status(), "create key request").toBe(201);
    const krBody = await krRes.json();
    const requestId = krBody.requestId as string;

    // ── Step 3: Resolve the numeric DB id and send one admin message ──────────
    const listRes = await api.get("/api/access-key-requests/admin/list", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status(), "admin list key requests").toBe(200);
    const allRequests = (await listRes.json()) as Array<{
      id: number;
      requestId: string;
    }>;
    const matched = allRequests.find((r) => r.requestId === requestId);
    expect(matched, `key request ${requestId} in admin list`).toBeTruthy();
    const dbId = matched!.id;

    const msgRes = await api.post(
      `/api/access-key-requests/admin/${dbId}/message`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          message: "E2E public-page sentinel admin message",
          adminUsername: ADMIN_USERNAME,
        },
      },
    );
    expect(msgRes.status(), "send admin message").toBe(200);

    // ── Step 4: Visit the public status page as an anonymous user ─────────────
    // Navigate to /request-access?tab=check&requestId=<requestId>.
    // The page auto-submits a basic status check on mount (no email, so no
    // mark-read); we then enter the email and click "Check Status" to trigger
    // the full PATCH → localStorage write path.
    await page.goto(
      `/request-access?tab=check&requestId=${encodeURIComponent(requestId)}`,
      { waitUntil: "domcontentloaded" },
    );

    // Enter the registered email to unlock the mark-read branch.
    await page.getByTestId("input-check-email").fill(krEmail);
    await page.getByTestId("button-check-status").click();

    // Wait for the mark-read PATCH to complete before navigating away so that
    // the localStorage sentinel is written.
    const markReadResp = await page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/access-key-requests/mark-read/") &&
        resp.request().method() === "PATCH",
      { timeout: 10_000 },
    );
    // PATCH must succeed — a 4xx/5xx means the sentinel was never written.
    expect(markReadResp.status(), "mark-read PATCH status").toBe(200);

    // ── Step 4b: Assert the localStorage sentinel was written ─────────────────
    // This is the primary guard for the regression described in the task.
    // Even if the PATCH updated the server-side userMessagesReadCount, a bug
    // that drops the `localStorage.setItem(...)` call in RequestAccessKey.tsx
    // would still fail here — proving the public page actually wrote the key.
    //
    // Playwright's page.evaluate() runs in the same browser context, so the
    // localStorage state set by RequestAccessKey.tsx is directly observable.
    const sentinelKey = `ibccf_kr_seen_${requestId}`;
    const sentinelValue = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      sentinelKey,
    );
    expect(
      sentinelValue,
      `localStorage["${sentinelKey}"] must be set by the public status page`,
    ).not.toBeNull();
    expect(
      Number(sentinelValue),
      `localStorage["${sentinelKey}"] must be a positive read count`,
    ).toBeGreaterThan(0);

    // ── Step 5: Login to the portal in the same browser context ───────────────
    // The same browser storage partition is used for both the public page and
    // the portal, so the localStorage write from Step 4 persists here.
    await page.setViewportSize({ width: 375, height: 812 });
    await loginPortalUi(page, accessCode, TEST_PIN);

    // ── Step 6: Assert the More sheet badge is absent ─────────────────────────
    // PortalContext computes:
    //   effectiveRead = Math.max(serverUserMessagesReadCount, localSeen)
    //   unread        = Math.max(0, adminMessageCount - effectiveRead)
    //
    // Because Step 4b confirmed localSeen ≥ 1, effectiveRead ≥ 1 and
    // unread = max(0, 1-1) = 0 → badge is absent.
    //
    // This second-level assertion confirms the sentinel also suppresses the
    // badge in the portal's live badge computation path, catching regressions
    // in the PortalContext.tsx effectiveRead merge even when the write is fine.
    await expect(
      page.getByTestId("mobile-nav-more-badge"),
    ).not.toBeAttached({ timeout: 15_000 });

    // Teardown
    await deleteCase(api, adminToken, caseId);
    await api.dispose();
  });
});
