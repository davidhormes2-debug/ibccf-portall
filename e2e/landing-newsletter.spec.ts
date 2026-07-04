import { test, expect } from "@playwright/test";

// No admin credentials are required: the newsletter form is a fully public
// surface, so this spec carries no test.skip() env-var guard and therefore
// nothing for check-e2e-skip-guards.sh to enforce.

test.describe("Landing page newsletter subscription", () => {
  test("shows a destructive error toast using newsletter.errorTitle when subscription fails", async ({
    page,
  }) => {
    // Intercept the newsletter POST and return a server error so we can assert
    // the error path: a destructive toast appears using the newsletter namespace
    // key (newsletter.errorTitle = "Error"), NOT the contact-form key
    // (contact.toastErrorTitle = "Submission Failed").
    await page.route("**/api/public/newsletter", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");

    // Scroll the newsletter form into view so the interactions work reliably.
    await page.getByTestId("input-newsletter-email").scrollIntoViewIfNeeded();
    await page.getByTestId("input-newsletter-email").fill("fail@example.com");
    await page.getByTestId("button-subscribe").click();

    // A destructive error toast should appear in the Notifications live region.
    // It MUST use the newsletter namespace key (newsletter.errorTitle = "Error"),
    // NOT the contact-form key (contact.toastErrorTitle = "Submission Failed").
    // This is the primary regression guard for a future namespace mix-up.
    //
    // We scope the toast assertion to the status element that contains BOTH the
    // title "Error" AND the expected description "Internal server error" (the
    // value our mocked 500 response returns as data.error).  Requiring both
    // fields prevents a false-positive from any unrelated toast that happens to
    // contain the word "Error".
    const toast = page
      .getByRole("status")
      .filter({ hasText: "Error" })
      .filter({ hasText: "Internal server error" });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Regression guard: the contact-form error title "Submission Failed" must
    // NOT appear — a namespace regression would wire the wrong i18n key.
    const contactErrorToast = page
      .getByRole("status")
      .filter({ hasText: "Submission Failed" });
    await expect(contactErrorToast).not.toBeVisible();
  });

  test("shows a success toast using newsletter.subscribedTitle when subscription succeeds", async ({
    page,
  }) => {
    // Intercept the newsletter POST and return a 200 so we can assert the
    // success path: a toast appears using the newsletter namespace key
    // (newsletter.subscribedTitle = "Subscribed"), NOT the contact-form
    // success key (contact.toastSuccessTitle = "Complaint Submitted").
    await page.route("**/api/public/newsletter", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");

    // Scroll the newsletter form into view so the interactions work reliably.
    await page.getByTestId("input-newsletter-email").scrollIntoViewIfNeeded();
    await page.getByTestId("input-newsletter-email").fill("success@example.com");
    await page.getByTestId("button-subscribe").click();

    // A success toast should appear in the Notifications live region.
    // It MUST use the newsletter namespace key
    // (newsletter.subscribedTitle = "Subscribed"), NOT the contact-form
    // key (contact.toastSuccessTitle = "Complaint Submitted").
    // We scope the toast assertion to the status element that contains BOTH
    // the title "Subscribed" AND the expected description, preventing a
    // false-positive from any unrelated toast.
    const toast = page
      .getByRole("status")
      .filter({ hasText: "Subscribed" })
      .filter({ hasText: "Added to intelligence briefing distribution." });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Regression guard: the contact-form success title "Complaint Submitted"
    // must NOT appear — a namespace regression would wire the wrong i18n key.
    const contactSuccessToast = page
      .getByRole("status")
      .filter({ hasText: "Complaint Submitted" });
    await expect(contactSuccessToast).not.toBeVisible();
  });
});
