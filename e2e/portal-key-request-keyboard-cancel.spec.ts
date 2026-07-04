// e2e/portal-key-request-keyboard-cancel.spec.ts
//
// Regression guard for keyboard accessibility on the inline Key Request
// resubmit form in the portal (KeyRequestView).
//
// WHAT THIS TESTS
// ───────────────
// The resubmit form in KeyRequestView is reachable via TWO entry points:
//
//   • The "rejected" status card  — covered by the first describe block.
//   • The "expired" status card   — covered by the second describe block.
//
// Each entry point shares the same card-resubmit-form div and the same
// keyboard handlers, but setting up the expired path requires a direct DB
// update (there is no admin API to force-expire a request).  Both paths
// are tested separately so a regression on either entry point is caught.
//
// For each entry point the form must:
//
//   1. Close when the user presses Enter on the focused Cancel button
//      (keyboard activation — the native <button> handler fires on Enter).
//
//   2. Close when the user presses Escape from anywhere inside the div
//      (via the onKeyDown Escape handler on the container).
//
// These tests exercise each path independently so a regression that breaks
// only the keyboard path (while mouse clicks still work) is caught early.

import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

function uniqueAccessCode(): string {
  return "E2EKR-" + randomBytes(5).toString("hex").toUpperCase();
}

function uniqueEmail(): string {
  return `e2e-kr-${randomBytes(3).toString("hex")}@example.com`;
}

async function loginAdmin(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.status(), "admin login").toBe(200);
  const body = await res.json();
  expect(body.success, "admin login success").toBe(true);
  expect(typeof body.token, "admin token type").toBe("string");
  return body.token as string;
}

async function createCase(
  api: APIRequestContext,
  token: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${token}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const caseId = (await created.json()).id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      userName: "KR Keyboard Test User",
      userEmail: uniqueEmail(),
      status: "active",
    },
  });
  expect(patched.status(), "patch case").toBe(200);

  return caseId;
}

async function setPin(
  api: APIRequestContext,
  accessCode: string,
  pin: string,
): Promise<void> {
  const res = await api.post("/api/cases/set-pin", {
    data: { accessCode, pin },
  });
  expect(res.status(), "set pin").toBe(200);
}

async function loginPortal(page: Page, accessCode: string, pin: string): Promise<void> {
  await page.goto("/dashboard");
  await page.getByTestId("input-access-code").fill(accessCode);
  await page.getByTestId("button-login").click();
  const pinInput = page.getByTestId("input-pin");
  await expect(pinInput).toBeVisible();
  await pinInput.fill(pin);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
    timeout: 10_000,
  });
}

// Creates a portal key request from within the browser context (so the
// x-portal-session-token is read from the live localStorage entry), then
// uses the admin API to immediately reject it.  After this call the case
// has exactly one key request in "rejected" status.
async function setupRejectedKeyRequest(
  api: APIRequestContext,
  adminToken: string,
  page: Page,
  caseId: string,
): Promise<void> {
  // Create the key request from the browser — this is the only way to attach
  // it to the portal session without re-implementing the session-token read.
  const result = await page.evaluate(async (id: string) => {
    const raw = localStorage.getItem("ibccf_portal_session");
    const token = raw
      ? (JSON.parse(raw) as { token: string }).token
      : "";
    const res = await fetch(`/api/access-key-requests/portal/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-session-token": token,
      },
      body: JSON.stringify({
        userName: "KR Keyboard Test User",
        userEmail: "e2e-kr-sub@example.com",
      }),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }, caseId);
  expect(result.status, "create portal key request").toBe(201);

  // Get the numeric DB id via the admin list so we can reject it.
  const listRes = await api.get("/api/access-key-requests/admin/list", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(listRes.status(), "admin list key requests").toBe(200);
  const list = (await listRes.json()) as Array<{
    id: number;
    requestId: string;
    caseId: string;
  }>;
  const req = list.find((r) => r.caseId === caseId);
  expect(req, "found request in admin list").toBeTruthy();

  const rejectRes = await api.post(
    `/api/access-key-requests/admin/${req!.id}/reject`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        reason: "E2E keyboard-cancel test rejection",
        adminUsername: ADMIN_USERNAME,
      },
    },
  );
  expect(rejectRes.status(), "reject key request").toBe(200);
}

// Creates a portal key request from within the browser context, then uses a
// direct DB update to immediately flip its status to "expired".  This is
// necessary because the server has no admin API endpoint that force-expires a
// request; the only real expiry path is the scheduled `expirePendingRequests`
// job that runs server-side when `expiresAt <= now()`.
//
// Requires DATABASE_URL / NEON_DATABASE_URL to be set; callers must skip the
// test when DATABASE_URL is absent.
async function setupExpiredKeyRequest(
  page: Page,
  caseId: string,
): Promise<void> {
  const result = await page.evaluate(async (id: string) => {
    const raw = localStorage.getItem("ibccf_portal_session");
    const token = raw
      ? (JSON.parse(raw) as { token: string }).token
      : "";
    const res = await fetch(`/api/access-key-requests/portal/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-session-token": token,
      },
      body: JSON.stringify({
        userName: "KR Keyboard Expired Test User",
        userEmail: "e2e-kr-expired@example.com",
      }),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }, caseId);
  expect(result.status, "create portal key request for expiry").toBe(201);

  const pg = new Client({ connectionString: DATABASE_URL });
  try {
    await pg.connect();
    await pg.query(
      `UPDATE access_key_requests
          SET status      = 'expired',
              expires_at  = now() - INTERVAL '1 day',
              updated_at  = now()
        WHERE case_id = $1`,
      [caseId],
    );
  } finally {
    await pg.end();
  }
}

// Navigate to the Key Request view and wait for it to show the rejected
// status with the "Submit New Request" button.  The nav item only appears
// once PortalContext has polled and set hasKeyRequest=true.
async function navigateToKeyRequestView(page: Page): Promise<void> {
  const navItem = page.getByTestId("nav-keyRequest");
  await expect(navItem).toBeVisible({ timeout: 15_000 });
  await navItem.click();
  await expect(page.getByTestId("view-keyRequest")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Portal — Key Request resubmit form keyboard cancel", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal e2e tests");
    }
  });

  test("keyboard cancel: pressing Enter on the focused Cancel button closes the resubmit form", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for keyboard accessibility (WCAG 2.1 AA).
    //
    // A Cancel button that responds to mouse clicks but silently swallows
    // keyboard Enter would be inaccessible to keyboard-only users.  This test
    // exercises the keyboard-Enter path directly, independently of any mouse
    // interaction, to ensure they cannot regress separately.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);
    const accessCode = uniqueAccessCode();
    const pin = "135791";

    const caseId = await createCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    // Log in to the portal so we have a live session for the key-request POST.
    await loginPortal(page, accessCode, pin);
    await setupRejectedKeyRequest(api, adminToken, page, caseId);

    // Reload to let PortalContext pick up the key request via its mount poll.
    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    await navigateToKeyRequestView(page);

    // Open the resubmit form.
    const openBtn = page.getByTestId("button-open-resubmit-form");
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    // ── Focus the Cancel button and press Enter ───────────────────────────────
    // This exercises the button's keyboard activation path.  A regression that
    // wires only onClick (pointer) and not the native button keyboard handler
    // would fail here while mouse clicks continued to work.
    const cancelBtn = page.getByTestId("button-resubmit-cancel");
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press("Enter");

    // ── Resubmit form must disappear ─────────────────────────────────────────
    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });

    // ── User must still be on the KeyRequest view ─────────────────────────────
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    await api.dispose();
  });

  test("keyboard cancel: pressing Escape from within the resubmit form closes it", async ({
    page,
    baseURL,
  }) => {
    // Regression guard for keyboard accessibility (WCAG 2.1 AA).
    //
    // Escape is the conventional keyboard shortcut for dismissing a
    // confirmation prompt.  If the onKeyDown handler is dropped from
    // card-resubmit-form (or Escape is swallowed somewhere in the event chain),
    // keyboard-only users lose an expected exit path.  This test exercises the
    // Escape-key path from both the Cancel button and the Submit button to
    // ensure either focus position works.
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);
    const accessCode = uniqueAccessCode();
    const pin = "135791";

    const caseId = await createCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    await loginPortal(page, accessCode, pin);
    await setupRejectedKeyRequest(api, adminToken, page, caseId);

    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    await navigateToKeyRequestView(page);

    const openBtn = page.getByTestId("button-open-resubmit-form");
    await expect(openBtn).toBeVisible({ timeout: 10_000 });

    // ── First open: Escape with focus on the Cancel button ────────────────────
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    // The keydown event bubbles from the button up to card-resubmit-form, where
    // the onKeyDown handler catches it and calls setShowResubmitForm(false).
    const cancelBtn = page.getByTestId("button-resubmit-cancel");
    await cancelBtn.focus();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    // ── Second open: Escape with focus on the Submit button ───────────────────
    // Confirms the Escape handler works regardless of which button has focus,
    // not just when Cancel is focused.
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    const submitBtn = page.getByTestId("button-resubmit-submit");
    await submitBtn.focus();
    await expect(submitBtn).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    await api.dispose();
  });
});

test.describe("Portal — Key Request resubmit form keyboard cancel (expired path)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal e2e tests");
    }
  });

  test("keyboard cancel (expired): pressing Enter on the focused Cancel button closes the resubmit form", async ({
    page,
    baseURL,
  }) => {
    // The expired status card is a separate entry point to the same
    // card-resubmit-form div.  There is no admin API to force-expire a
    // request, so setup requires a direct DB update.  Skip gracefully when
    // DATABASE_URL is absent (e.g. in sandboxed CI tiers without DB access).
    if (!DATABASE_URL) {
      test.skip(true, "DATABASE_URL required to force-expire a key request");
      return;
    }

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);
    const accessCode = uniqueAccessCode();
    const pin = "135791";

    const caseId = await createCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    await loginPortal(page, accessCode, pin);
    await setupExpiredKeyRequest(page, caseId);

    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    await navigateToKeyRequestView(page);

    // The expired card must show the "Submit New Request" button.
    const openBtn = page.getByTestId("button-open-resubmit-form");
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    // ── Focus the Cancel button and press Enter ───────────────────────────────
    const cancelBtn = page.getByTestId("button-resubmit-cancel");
    await cancelBtn.focus();
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press("Enter");

    // ── Resubmit form must disappear ─────────────────────────────────────────
    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });

    // ── User must still be on the KeyRequest view ─────────────────────────────
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    await api.dispose();
  });

  test("keyboard cancel (expired): pressing Escape from within the resubmit form closes it", async ({
    page,
    baseURL,
  }) => {
    // Same skip guard — direct DB access is required to manufacture an
    // expired request without waiting for the scheduled expiry job.
    if (!DATABASE_URL) {
      test.skip(true, "DATABASE_URL required to force-expire a key request");
      return;
    }

    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdmin(api);
    const accessCode = uniqueAccessCode();
    const pin = "135791";

    const caseId = await createCase(api, adminToken, accessCode);
    await setPin(api, accessCode, pin);

    await loginPortal(page, accessCode, pin);
    await setupExpiredKeyRequest(page, caseId);

    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0, {
      timeout: 10_000,
    });

    await navigateToKeyRequestView(page);

    const openBtn = page.getByTestId("button-open-resubmit-form");
    await expect(openBtn).toBeVisible({ timeout: 10_000 });

    // ── First open: Escape with focus on the Cancel button ────────────────────
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    const cancelBtn = page.getByTestId("button-resubmit-cancel");
    await cancelBtn.focus();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    // ── Second open: Escape with focus on the Submit button ───────────────────
    // Confirms the Escape handler works regardless of which button has focus.
    await openBtn.click();
    await expect(page.getByTestId("card-resubmit-form")).toBeVisible({
      timeout: 5_000,
    });

    const submitBtn = page.getByTestId("button-resubmit-submit");
    await submitBtn.focus();
    await expect(submitBtn).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("card-resubmit-form")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.getByTestId("view-keyRequest")).toBeVisible();

    await api.dispose();
  });
});
