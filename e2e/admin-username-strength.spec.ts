import { test, expect, type Page } from "@playwright/test";
import { USERNAME_TRIVIAL_HINTS } from "../shared/passwordStrength";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function loginAndOpenChangeUsername(page: Page): Promise<void> {
  await page.goto("/admin");

  await page.getByTestId("input-admin-username").fill(ADMIN_USERNAME);
  await page.getByTestId("input-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("button-admin-login").click();

  // Wait until the login form is gone (dashboard rendered).
  await expect(page.getByTestId("input-admin-password")).toHaveCount(0, {
    timeout: 30_000,
  });

  // Navigate to the Settings tab, then open the Change Username panel.
  await page.getByTestId("tab-settings").click({ force: true });
  await page.getByTestId("card-change-username").click();

  await expect(page.getByTestId("input-cu-new")).toBeVisible();
}

test.describe("Admin settings — username strength meter", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAndOpenChangeUsername(page);
  });

  test("meter is hidden when the new-username field is empty", async ({
    page,
  }) => {
    await expect(page.getByTestId("cu-strength-meter")).toHaveCount(0);
    await expect(page.getByTestId("cu-strength-label")).toHaveCount(0);
  });

  test('shows "Trivial" in red for a single repeated-character username', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("aaaa");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.repeated_char);
  });

  test('shows "Trivial" in red for a keyboard-walk username (qwerty)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("qwerty");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.keyboard_walk);
  });

  test('shows "Trivial" in red for a keyboard-walk username (asdf)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("asdf");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.keyboard_walk);
  });

  test('shows "Trivial" in red for a reversed keyboard-walk username (ytrewq)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("ytrewq");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.keyboard_walk);
  });

  test('shows "Trivial" in red for a reversed keyboard-walk username (gfdsa)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("gfdsa");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.keyboard_walk);
  });

  test('shows "Trivial" in red for a too-short username (ab)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("ab");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.too_short);
  });

  test('shows "Trivial" in red for a purely-numeric username (80246)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("80246");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.purely_numeric);
  });

  test('shows "Trivial" in red for a blocklisted username (admin)', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("admin");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.blocklisted);
  });

  test('shows "OK" in green for a strong, unique username', async ({
    page,
  }) => {
    await page.getByTestId("input-cu-new").fill("ibccf_ops_2026");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("OK");
    await expect(label).toHaveClass(/text-green-400/);

    await expect(page.getByTestId("cu-strength-hint")).toHaveCount(0);
  });

  test('hint clears and label switches to "OK" when a valid username replaces a trivial one', async ({
    page,
  }) => {
    const input = page.getByTestId("input-cu-new");

    await input.fill("admin");

    const label = page.getByTestId("cu-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Trivial");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cu-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(USERNAME_TRIVIAL_HINTS.blocklisted);

    await input.fill("ibccf_ops_2026");

    await expect(label).toHaveText("OK");
    await expect(label).toHaveClass(/text-green-400/);
    await expect(page.getByTestId("cu-strength-hint")).toHaveCount(0);
  });

  test("meter disappears when the new-username field is cleared", async ({
    page,
  }) => {
    const input = page.getByTestId("input-cu-new");
    await input.fill("qwerty");
    await expect(page.getByTestId("cu-strength-label")).toBeVisible();

    await input.fill("");
    await expect(page.getByTestId("cu-strength-meter")).toHaveCount(0);
    await expect(page.getByTestId("cu-strength-label")).toHaveCount(0);
  });
});
