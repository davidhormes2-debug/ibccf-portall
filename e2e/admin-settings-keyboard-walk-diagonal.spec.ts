import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { PASSWORD_WEAK_HINTS } from "../shared/passwordStrength";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

function readAdminToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as {
      token?: string;
    };
    return raw.token ?? "";
  } catch {
    return "";
  }
}

async function loginAndOpenChangePassword(page: Page): Promise<void> {
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

test.describe("Admin settings — number-row diagonal keyboard-walk detection", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the admin settings e2e tests");
    }
  });

  test.beforeEach(async ({ page }) => {
    await loginAndOpenChangePassword(page);
  });

  test('strength meter shows "Weak" and keyboard-walk hint for a number-row diagonal pattern', async ({
    page,
  }) => {
    // "2Ws3Ed4Rf5Tg!" contains the 12-char diagonal "2ws3ed4rf5tg" which is a
    // contiguous substring of the KEYBOARD_WALK_SEQUENCES entry
    // "1qa2ws3ed4rf5tg6yh7uj" (number-row + top-two-letter-rows diagonal).
    // containsKeyboardWalk() detects this via the 6-char sliding-window check,
    // so getPasswordStrengthDetail() returns { strength: "Weak", weakReason:
    // "keyboard_walk" } even though the password has ≥12 chars, mixed case,
    // a digit, and a special character.
    await page.getByTestId("input-cp-new").fill("2Ws3Ed4Rf5Tg!");

    const label = page.getByTestId("cp-strength-label");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Weak");
    await expect(label).toHaveClass(/text-red-400/);

    const hint = page.getByTestId("cp-strength-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(PASSWORD_WEAK_HINTS.keyboard_walk);
  });
});
