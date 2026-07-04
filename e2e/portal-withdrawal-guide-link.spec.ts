// e2e/portal-withdrawal-guide-link.spec.ts
//
// Regression guard for the "Withdrawal Guide" sidebar nav link in PortalShell.
//
// WHAT THIS TESTS
// ───────────────
// After login, the portal sidebar contains a nav item with
// data-testid="nav-withdrawalGuide".  The test verifies that:
//
//   1. The link is visible in the sidebar after portal login.
//   2. Its `href` attribute is exactly "/withdrawal-guide".
//   3. Its `target` attribute is "_blank" (opens in a new tab).
//
// These three properties are the core contract of the nav-item definition in
// PortalShell.tsx.  A regression that removes the item, changes the URL, or
// drops the new-tab flag would be caught here before reaching users.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  uniqueAccessCode,
  loginAdminApi,
  createCase,
  deleteCase,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

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

async function loginPortal(
  page: import("@playwright/test").Page,
  accessCode: string,
  pin: string,
): Promise<void> {
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

// ---------------------------------------------------------------------------

test.describe("Portal — Withdrawal Guide sidebar link", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run portal e2e tests");
    }
  });

  const TEST_PIN = "246810";

  test("nav-withdrawalGuide is visible with correct href and target", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdminApi(api);

    const accessCode = uniqueAccessCode();
    await createCase(api, adminToken, accessCode);
    await setPin(api, accessCode, TEST_PIN);

    await loginPortal(page, accessCode, TEST_PIN);

    // ── Locate the nav item ────────────────────────────────────────────────
    const link = page.getByTestId("nav-withdrawalGuide");
    await expect(link).toBeVisible({ timeout: 10_000 });

    // ── href must point at the guide page ─────────────────────────────────
    await expect(link).toHaveAttribute("href", "/withdrawal-guide");

    // ── Must open in a new tab ─────────────────────────────────────────────
    await expect(link).toHaveAttribute("target", "_blank");

    await api.dispose();
  });
});
