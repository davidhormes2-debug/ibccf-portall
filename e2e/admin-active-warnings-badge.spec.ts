/**
 * e2e/admin-active-warnings-badge.spec.ts
 *
 * Regression guard: the Communications nav badge
 * (`badge-communications-active-warnings` in AdminGroupedNav) must
 * reflect the count returned by GET /api/cases/active-warnings, which
 * must exclude disabled cases even when portalWarningAt is set.
 *
 * The unit tests for that endpoint (cases.activeWarnings.test.ts) verify
 * the disabled-case filter at the server layer.  This spec closes the
 * remaining gap by exercising the full stack — API → poll →
 * AdminDashboard state → AdminGroupedNav badge — inside a real browser.
 *
 * Test 1 — badge present (positive control):
 *   1. Seed a test case and set a portal closure warning on it.
 *   2. Log into the admin dashboard; wait for `admin-data-ready`.
 *   3. Assert `badge-communications-active-warnings` is visible with count > 0.
 *   4. Clear the warning.
 *
 * Test 2 — badge absent when no warnings are active:
 *   1. No warning set on any case.
 *   2. Log into admin and wait for `admin-data-ready`.
 *   3. Assert `badge-communications-active-warnings` is NOT in the DOM.
 *
 * Test 3 — disabled case is excluded (core regression target):
 *   1. Set a portal warning on the test case.
 *   2. Disable the case via the toggle-access API (isDisabled → true).
 *   3. Log into admin and wait for `admin-data-ready`.
 *   4. Assert `badge-communications-active-warnings` is absent — the
 *      endpoint must not count disabled cases regardless of portalWarningAt.
 *   5. Re-enable the case in a finally block so teardown stays clean.
 *
 * Data lifecycle
 * ──────────────
 * One case is created in beforeAll and deleted in afterAll.  A unique random
 * suffix prevents collisions between parallel CI runs.  Any leftover warning
 * and disabled state are cleaned up in afterAll.
 */

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  deleteCase,
  loginAdminUi as loginAdminUiBase,
  clearAdminRateLimit,
  localTimeout,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setWarningViaApi(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  minutes = 30,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/portal-warning`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    data: { minutes, portalMessage: "E2E active-warnings badge test — closing soon" },
  });
  expect(res.status(), "set portal warning via API").toBe(200);
}

async function clearWarningViaApi(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
): Promise<void> {
  await api.delete(`/api/cases/${caseId}/portal-warning`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

async function toggleCaseAccessViaApi(
  api: APIRequestContext,
  adminToken: string,
  caseId: string,
  disabled: boolean,
): Promise<void> {
  const res = await api.post(`/api/cases/${caseId}/toggle-access`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    data: { disabled },
  });
  expect(
    res.status(),
    `toggle-access disabled=${disabled} via API`,
  ).toBe(200);
}

/**
 * Log into the admin dashboard and wait for the `admin-data-ready` hidden
 * sentinel element so the initial data loads (including loadActiveWarnings)
 * have completed before assertions run.
 */
async function loginAdminUi(page: import("@playwright/test").Page): Promise<void> {
  await loginAdminUiBase(page);
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — Communications active-warnings badge", () => {
  test.skip(
    !ADMIN_USERNAME || !ADMIN_PASSWORD,
    "ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the active-warnings badge e2e tests",
  );

  let accessCode: string;
  let caseId: string;
  let adminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    accessCode = uniqueAccessCode("E2EAWB");
    const api = await request.newContext({ baseURL });
    try {
      adminToken = readAdminToken();
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Active Warnings Badge E2E",
      });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await clearWarningViaApi(api, adminToken, caseId);
      await toggleCaseAccessViaApi(api, adminToken, caseId, false).catch(() => {});
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  // ── Test 1: badge appears when a portal warning is active (positive control)

  test("badge-communications-active-warnings is visible when a case has an active portal warning", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }

    try {
      await loginAdminUi(page);

      const badge = page.getByTestId("badge-communications-active-warnings");
      await expect(badge).toBeVisible({ timeout: 15_000 });

      const badgeText = (await badge.textContent()) ?? "";
      const count = parseInt(badgeText.trim(), 10);
      expect(count, "badge must show at least 1 active warning").toBeGreaterThan(0);
    } finally {
      const api2 = await request.newContext({ baseURL });
      try {
        await clearWarningViaApi(api2, adminToken, caseId);
      } finally {
        await api2.dispose();
      }
    }
  });

  // ── Test 2: badge absent when no warnings are active ─────────────────────

  test("badge-communications-active-warnings is absent when no cases have active portal warnings", async ({
    page,
  }) => {
    await loginAdminUi(page);

    const badge = page.getByTestId("badge-communications-active-warnings");
    await expect(badge).not.toBeAttached({ timeout: 10_000 });
  });

  // ── Test 3: disabled case with a warning is excluded (core regression guard)

  test("badge-communications-active-warnings is absent when the only warning belongs to a disabled case", async ({
    page,
    baseURL,
  }) => {
    // Step 1: set a portal warning on the case so portalWarningAt is non-null.
    const api = await request.newContext({ baseURL });
    try {
      await setWarningViaApi(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }

    // Step 2: disable the case.  The endpoint must exclude disabled cases
    // from the active-warnings count even when portalWarningAt is set.
    const api2 = await request.newContext({ baseURL });
    try {
      await toggleCaseAccessViaApi(api2, adminToken, caseId, true);
    } finally {
      await api2.dispose();
    }

    try {
      // Step 3: log into the admin dashboard and wait for the initial
      // loadActiveWarnings() call to complete.
      await loginAdminUi(page);

      // Step 4: assert the badge is absent — the disabled-case filter must
      // prevent the case from appearing in the count.  If this assertion
      // fails it means GET /api/cases/active-warnings is no longer
      // filtering out disabled cases, which is the regression this spec
      // was written to catch.
      const badge = page.getByTestId("badge-communications-active-warnings");
      await expect(badge).not.toBeAttached({ timeout: 10_000 });
    } finally {
      // Step 5: re-enable the case and clear the warning for teardown.
      const api3 = await request.newContext({ baseURL });
      try {
        await toggleCaseAccessViaApi(api3, adminToken, caseId, false);
        await clearWarningViaApi(api3, adminToken, caseId);
      } finally {
        await api3.dispose();
      }
    }
  });
});
