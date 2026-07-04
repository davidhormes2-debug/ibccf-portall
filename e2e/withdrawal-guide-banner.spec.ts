import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  uniqueAccessCode,
  loginAdminApi,
  createCase,
  deleteCase,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function createActiveCaseWithBanner(
  api: APIRequestContext,
  token: string,
  accessCode: string,
  withdrawalGuideVisible: boolean,
): Promise<string> {
  const caseId = await createCase(api, token, accessCode, {
    extraPatch: { withdrawalGuideVisible },
  });
  const res = await api.get(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  expect(body.withdrawalGuideVisible).toBe(withdrawalGuideVisible);
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

async function setBannerVisibility(
  api: APIRequestContext,
  token: string,
  caseId: string,
  visible: boolean,
): Promise<void> {
  const res = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { withdrawalGuideVisible: visible },
  });
  expect(res.status(), "toggle banner").toBe(200);
  const body = await res.json();
  expect(body.withdrawalGuideVisible).toBe(visible);
}

test.describe("Portal — Withdrawal Guide banner live toggle", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal e2e tests");
    }
  });

  test("banner appears, disappears, and reappears as the admin toggles withdrawalGuideVisible", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdminApi(api);

    const accessCode = uniqueAccessCode();
    const pin = "135790";
    const caseId = await createActiveCaseWithBanner(
      api,
      adminToken,
      accessCode,
      true,
    );
    await setPin(api, accessCode, pin);

    // ---------- Login to the portal ----------
    await page.goto("/dashboard");

    await page.getByTestId("input-access-code").fill(accessCode);
    await page.getByTestId("button-login").click();

    const pinInput = page.getByTestId("input-pin");
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pin);
    await page.getByTestId("button-login").click();

    // Wait for the authenticated dashboard to render (login form is gone).
    await expect(page.getByTestId("input-access-code")).toHaveCount(0);

    // ---------- Banner is visible when withdrawalGuideVisible === true ----------
    const banner = page.getByTestId("banner-withdrawal-guide");
    await expect(banner).toBeVisible();

    // ---------- Admin toggles OFF → banner disappears after reload ----------
    await setBannerVisibility(api, adminToken, caseId, false);
    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0);
    await expect(page.getByTestId("banner-withdrawal-guide")).toHaveCount(0);

    // ---------- Admin toggles back ON → banner reappears after reload ----------
    await setBannerVisibility(api, adminToken, caseId, true);
    await page.reload();
    await expect(page.getByTestId("input-access-code")).toHaveCount(0);
    await expect(page.getByTestId("banner-withdrawal-guide")).toBeVisible();

    await api.dispose();
  });
});
