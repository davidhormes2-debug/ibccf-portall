import { test, expect, type Page } from "@playwright/test";
import { PASSWORD_WEAK_HINTS } from "../shared/passwordStrength";
import { readAdminToken } from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function loginAndOpenChangePassword(page: Page): Promise<void> {
  // Inject the pre-fetched bearer token into sessionStorage before the page
  // initialises so the React app skips the login form entirely.
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await page.getByTestId("tab-settings").click({ force: true });
  await page.getByTestId("card-change-password").click();
  await expect(page.getByTestId("input-cp-new")).toBeVisible();
}

test.describe("Admin settings — password strength meter", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAndOpenChangePassword(page);
  });

  test("meter is hidden when the new-password field is empty", async ({
    page,
  }) => {
    await expect(page.getByTestId("cp-strength-meter")).toHaveCount(0);
    await expect(page.getByTestId("cp-strength-label")).toHaveCount(0);
  });

  test('shows "Weak" in red for a short password', async ({ page }) => {
    await page.getByTestId("input-cp-new").fill("abc");

    const label = page.getByTestId("cp-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Weak");
    await expect(label).toHaveClass(/text-red-400/);
  });

  test('shows "Medium" in amber for a password that meets length but not all complexity rules', async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill("Abc12345");

    const label = page.getByTestId("cp-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Medium");
    await expect(label).toHaveClass(/text-amber-400/);
  });

  test('shows "Strong" in green for a password with ≥12 chars, mixed case, digit, and special char', async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill("Str0ng!Pass#2024");

    const label = page.getByTestId("cp-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Strong");
    await expect(label).toHaveClass(/text-green-400/);
  });

  test('shows too_short hint for a password under 8 characters', async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill("abc");

    const hint = page.getByTestId("cp-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.too_short);
  });

  test('shows blocklisted hint for a well-known weak password', async ({
    page,
  }) => {
    await page.getByTestId("input-cp-new").fill("password");

    const hint = page.getByTestId("cp-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.blocklisted);
  });

  test('shows repetitive_pattern hint for a low-entropy password of ≥12 characters', async ({
    page,
  }) => {
    // "abcabcabcabc" has 12 chars and Shannon entropy ≈ 1.58 bits/char (well
    // below the MIN_PASSWORD_ENTROPY threshold of 3.2) and does not contain
    // any keyboard-walk substring of length ≥ 6, so it triggers the
    // repetitive_pattern weak reason.
    await page.getByTestId("input-cp-new").fill("abcabcabcabc");

    const hint = page.getByTestId("cp-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.repetitive_pattern);
  });

  test('shows keyboard_walk hint for a password containing a 6+ char keyboard sequence', async ({
    page,
  }) => {
    // "qwerty1A!" embeds the 6-char keyboard walk "qwerty", which is detected
    // by containsKeyboardWalk() before the entropy check, so it triggers the
    // keyboard_walk weak reason regardless of the added digit/upper/special.
    await page.getByTestId("input-cp-new").fill("qwerty1A!");

    const hint = page.getByTestId("cp-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.keyboard_walk);
  });
});
