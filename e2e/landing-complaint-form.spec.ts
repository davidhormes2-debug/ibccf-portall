import { test, expect } from "@playwright/test";

// No admin credentials are required: the complaint form is a fully public
// surface, so this spec carries no test.skip() env-var guard and therefore
// nothing for check-e2e-skip-guards.sh to enforce.

// Expected translated strings for the complaint form heading and submit button
// in each non-English locale, sourced from
// client/src/i18n/locales/<code>/landing.json (contact.formHeading /
// contact.submitButton).  Updating this table is the companion step whenever a
// landing.json translation for these two keys changes.
const LOCALE_STRINGS: Record<
  string,
  { formHeading: string; submitButton: string; labelName: string }
> = {
  es: {
    formHeading: "Enviar una Queja",
    submitButton: "Enviar Queja",
    labelName: "Nombre Completo *",
  },
  fr: {
    formHeading: "Soumettre une Plainte",
    submitButton: "Soumettre la Plainte",
    labelName: "Nom Complet *",
  },
  de: {
    formHeading: "Beschwerde Einreichen",
    submitButton: "Beschwerde Einreichen",
    labelName: "Vollständiger Name *",
  },
  pt: {
    formHeading: "Enviar uma Reclamação",
    submitButton: "Enviar Reclamação",
    labelName: "Nome Completo *",
  },
  zh: {
    formHeading: "提交投诉",
    submitButton: "提交投诉",
    labelName: "全名 *",
  },
};

test.describe("Landing page complaint form — locale switching", () => {
  // Iterate over every non-English locale.  For each one we:
  //   1. Load the landing page in English (default)
  //   2. Switch via the LanguageSwitcher in the marketing header
  //   3. Scroll to the complaint form and assert the heading, a field label,
  //      and the submit button are all rendered in the selected language —
  //      i.e. none of them still show the English strings.
  for (const [code, strings] of Object.entries(LOCALE_STRINGS)) {
    test(`renders the complaint form in ${code}`, async ({ page }) => {
      await page.goto("/");

      // Open the LanguageSwitcher dropdown.  There can be two triggers on the
      // page (header + compact/mobile); use the first (desktop header) one.
      const switcher = page.getByTestId("button-language-switcher").first();
      await switcher.scrollIntoViewIfNeeded();
      await switcher.click();

      // Select the target locale.
      await page.getByTestId(`menu-language-${code}`).click();

      // Scroll the complaint form into view so the assertions don't time out
      // waiting for an element that is below the fold.
      await page.getByTestId("complaint-input-name").scrollIntoViewIfNeeded();

      // --- form heading ---
      // The h3 sits just above the <form>; it contains only the translated
      // heading text so a getByText exact-match is reliable.
      const heading = page.getByText(strings.formHeading, { exact: true });
      await expect(heading).toBeVisible({ timeout: 8_000 });
      await expect(
        page.getByText("Submit a Complaint", { exact: true }),
      ).not.toBeVisible();

      // --- field label ---
      const nameLabel = page.getByText(strings.labelName, { exact: true });
      await expect(nameLabel).toBeVisible();

      // --- submit button ---
      const submitBtn = page.getByTestId("complaint-submit-button");
      await expect(submitBtn).toContainText(strings.submitButton);
      await expect(submitBtn).not.toContainText("Submit Complaint");
    });
  }
});

test.describe("Landing page complaint form", () => {
  test("shows a destructive error toast and keeps the form visible when submission fails", async ({
    page,
  }) => {
    // Intercept the submission and return a server error so we can assert the
    // error path: destructive toast appears, success panel does NOT appear.
    await page.route("**/api/submissions", async (route) => {
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

    await page.getByTestId("complaint-input-name").scrollIntoViewIfNeeded();
    await page.getByTestId("complaint-input-name").fill("Jordan Tester");
    await page.getByTestId("complaint-input-email").fill("jordan.tester@example.com");
    await page.getByTestId("complaint-input-subject").fill("Test error path");
    await page.getByTestId("complaint-input-message").fill("This submission should fail.");

    await page.getByTestId("complaint-submit-button").click();

    // A destructive error toast should appear in the Notifications live region.
    // It MUST use the complaint form's own i18n key (contact.toastErrorTitle =
    // "Submission Failed"), NOT the newsletter namespace's error title
    // (newsletter.errorTitle = "Error").  This is the primary regression guard
    // for the namespace mix-up that was previously present.
    const toast = page
      .getByRole("status")
      .filter({ hasText: "Submission Failed" });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // The description must also come from the complaint-form namespace.
    await expect(toast).toContainText(
      "Your complaint could not be submitted. Please try again.",
    );

    // Regression guard: the newsletter error title "Error" must NOT be what
    // the toast shows — a future namespace regression would use that string.
    // We check that no status element whose *only* visible text is "Error"
    // appears (the complaint description does not contain "Error" so a
    // substring search is safe here).
    const newsletterErrorToast = page
      .getByRole("status")
      .filter({ hasText: /^Error$/ });
    await expect(newsletterErrorToast).not.toBeVisible();

    // The success panel must NOT appear — the user should be able to retry.
    await expect(page.getByTestId("complaint-success")).not.toBeVisible();

    // The form itself must still be present so the user can correct and resubmit.
    await expect(page.getByTestId("complaint-submit-button")).toBeVisible();

    // The user's typed text must be preserved after the failure so they do not
    // have to re-enter everything before retrying.
    await expect(page.getByTestId("complaint-input-name")).toHaveValue("Jordan Tester");
    await expect(page.getByTestId("complaint-input-email")).toHaveValue("jordan.tester@example.com");
    await expect(page.getByTestId("complaint-input-subject")).toHaveValue("Test error path");
    await expect(page.getByTestId("complaint-input-message")).toHaveValue("This submission should fail.");

    // The submit button must be re-enabled so the user can retry without
    // refreshing the page.
    await expect(page.getByTestId("complaint-submit-button")).toBeEnabled();
  });

  test("submits all fields, sends them to /api/submissions, and shows the success toast", async ({
    page,
  }) => {
    // Intercept the submission so the test does not depend on a writable DB and
    // so we can assert the exact payload the form builds — including the three
    // newer optional fields.
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("**/api/submissions", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, id: 1 }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");

    const name = "Jordan Tester";
    const email = "jordan.tester@example.com";
    const subject = "Funds withheld after withdrawal request";
    const platform = "Binance";
    const incidentDate = "Jan 2024";
    const amountLost = "$5,000 USD";
    const message =
      "I attempted to withdraw funds and the platform froze my account demanding additional fees.";

    await page.getByTestId("complaint-input-name").scrollIntoViewIfNeeded();
    await page.getByTestId("complaint-input-name").fill(name);
    await page.getByTestId("complaint-input-email").fill(email);
    await page.getByTestId("complaint-input-subject").fill(subject);
    await page.getByTestId("complaint-input-platform").fill(platform);
    await page.getByTestId("complaint-input-incident-date").fill(incidentDate);
    await page.getByTestId("complaint-input-amount-lost").fill(amountLost);
    await page.getByTestId("complaint-input-message").fill(message);

    await page.getByTestId("complaint-submit-button").click();

    // The success toast announces via the Notifications live region
    // (role="status"). Scope to it so we don't accidentally match the
    // identically-worded heading rendered in the success-state panel.
    const toast = page.getByRole("status").filter({ hasText: "Communication Secure" });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // The form is replaced by its success panel after a successful submit.
    await expect(page.getByTestId("complaint-success")).toBeVisible();

    // Finally, prove every field — especially the three newer ones — was wired
    // into the actual request payload.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toMatchObject({
      name,
      email,
      subject,
      message,
      platform,
      incidentDate,
      amountLost,
    });
  });
});
