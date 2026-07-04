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

test.describe("Portal — Withdrawal tutorial video", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the portal e2e tests");
    }
  });

  test("tutorial dialog opens from the dashboard card and closes again", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = await loginAdminApi(api);

    const accessCode = uniqueAccessCode();
    const pin = "135790";
    await createCase(api, adminToken, accessCode);
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

    // ---------- Dialog is closed initially ----------
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // ---------- Click the tutorial card → dialog opens ----------
    const watchButton = page.getByTestId("button-watch-withdrawal-tutorial");
    await expect(watchButton).toBeVisible();
    await watchButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // ---------- Video content actually mounts and renders ----------
    // A regression in WithdrawalTutorialVideo / VideoTemplate (broken import,
    // render error, or returning nothing) would leave the dialog open to a
    // blank stage. Asserting the video surface is present and visible fails in
    // that case, since the surface only renders when VideoTemplate mounts.
    const videoStage = dialog.getByTestId("withdrawal-tutorial-video-stage");
    await expect(videoStage).toBeVisible();

    // ---------- Close the dialog → dialog disappears ----------
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await api.dispose();
  });

  // The video's on-screen copy is driven entirely by the active i18n locale
  // (kept in sync with `cases.preferred_locale`) through the `captions.ts`
  // table. A regression in the captions lookup or locale resolution could
  // silently fall back to English without failing the "dialog opens" test
  // above, so these cases assert the *localized* intro badge actually
  // renders for a non-English locale and that English does NOT leak through.
  const localeCases = [
    {
      locale: "es",
      localizedBadge: "Guía del Portal IBCCF",
    },
    {
      locale: "zh",
      localizedBadge: "IBCCF 门户指南",
    },
  ] as const;

  const ENGLISH_BADGE = "IBCCF Portal Guide";

  for (const { locale, localizedBadge } of localeCases) {
    test(`tutorial video renders captions in the chosen language (${locale})`, async ({
      page,
      baseURL,
    }) => {
      const api = await request.newContext({ baseURL });
      const adminToken = await loginAdminApi(api);

      const accessCode = uniqueAccessCode();
      const pin = "246802";
      await createCase(api, adminToken, accessCode);
      await setPin(api, accessCode, pin);

      // The i18n LanguageDetector runs `querystring` first (lookup key
      // `lang`), so `?lang=<code>` forces the requested locale and is then
      // cached to localStorage for the SPA navigations that follow login.
      await page.goto(`/dashboard?lang=${locale}`);

      await page.getByTestId("input-access-code").fill(accessCode);
      await page.getByTestId("button-login").click();

      const pinInput = page.getByTestId("input-pin");
      await expect(pinInput).toBeVisible();
      await pinInput.fill(pin);
      await page.getByTestId("button-login").click();

      await expect(page.getByTestId("input-access-code")).toHaveCount(0);

      // ---------- Open the tutorial dialog ----------
      const watchButton = page.getByTestId("button-watch-withdrawal-tutorial");
      await expect(watchButton).toBeVisible();
      await watchButton.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const videoStage = dialog.getByTestId("withdrawal-tutorial-video-stage");
      await expect(videoStage).toBeVisible();

      // ---------- The intro caption is in the chosen language ----------
      // The intro scene (scene 0) renders the locale-keyed badge first. If
      // the captions lookup or locale resolution regressed to English, the
      // localized string would be absent and the English string present —
      // both assertions guard against that fallback.
      await expect(videoStage.getByText(localizedBadge)).toBeVisible();
      await expect(videoStage.getByText(ENGLISH_BADGE)).toHaveCount(0);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await api.dispose();
    });
  }
});
