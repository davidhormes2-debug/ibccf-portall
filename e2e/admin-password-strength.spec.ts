import { test, expect } from "@playwright/test";
import { PASSWORD_WEAK_HINTS } from "../shared/passwordStrength";

test.describe("Admin login — password strength meter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  test("meter is hidden when the password field is empty", async ({ page }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await expect(passwordInput).toBeVisible();

    await expect(page.getByText("Weak")).not.toBeVisible();
    await expect(page.getByText("Medium")).not.toBeVisible();
    await expect(page.getByText("Strong")).not.toBeVisible();
  });

  test('shows "Weak" in red for a short password', async ({ page }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("abc");

    const label = page.getByText("Weak");
    await expect(label).toBeVisible();
    await expect(label).toHaveClass(/text-red-400/);

    await expect(page.getByText("Medium")).not.toBeVisible();
    await expect(page.getByText("Strong")).not.toBeVisible();
  });

  test('shows "Medium" in amber for a password that meets length but not all complexity rules', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("Abc12345");

    const label = page.getByText("Medium");
    await expect(label).toBeVisible();
    await expect(label).toHaveClass(/text-amber-400/);

    await expect(page.getByText("Weak")).not.toBeVisible();
    await expect(page.getByText("Strong")).not.toBeVisible();
  });

  test('shows "Strong" in green for a password with ≥12 chars, mixed case, digit, and special char', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("Str0ng!Pass#2024");

    const label = page.getByText("Strong");
    await expect(label).toBeVisible();
    await expect(label).toHaveClass(/text-green-400/);

    await expect(page.getByText("Weak")).not.toBeVisible();
    await expect(page.getByText("Medium")).not.toBeVisible();
  });

  test("meter disappears when the password field is cleared", async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("abc");
    await expect(page.getByText("Weak")).toBeVisible();

    await passwordInput.fill("");
    await expect(page.getByText("Weak")).not.toBeVisible();
    await expect(page.getByText("Medium")).not.toBeVisible();
    await expect(page.getByText("Strong")).not.toBeVisible();
  });

  test("login-strength-hint shows a reason-specific message for a weak password", async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("abc");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveText("");
  });

  test("login-strength-hint is absent for a strong password", async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("Str0ng!Pass#2024");

    await expect(page.getByTestId("login-strength-hint")).not.toBeVisible();
  });

  test('login-strength-hint shows "too short" message for a password under 8 characters', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("abc");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.too_short);
  });

  test('login-strength-hint shows "blocklisted" message for a well-known weak password', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("password");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.blocklisted);
  });

  test('login-strength-hint shows "keyboard walk" message when password contains a common keyboard sequence', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("MyQwerty9!");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.keyboard_walk);
  });

  test('login-strength-hint shows "keyboard walk" message for a number-row diagonal pattern (2Ws3Ed4Rf5Tg!)', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("2Ws3Ed4Rf5Tg!");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.keyboard_walk);
  });

  test('login-strength-hint shows "repetitive pattern" message for a long low-entropy password', async ({
    page,
  }) => {
    const passwordInput = page.getByTestId("input-admin-password");
    await passwordInput.fill("abcabcABCABC");

    const hint = page.getByTestId("login-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.repetitive_pattern);
  });
});
