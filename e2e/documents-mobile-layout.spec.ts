import { test, expect, type Route } from "@playwright/test";

// Regression guard for Task #302: on a 375 px mobile viewport, at least one
// document card's status badge must be visible without scrolling — neither
// clipped by the sticky portal header nor pushed below the fold.
//
// The Documents view sits deep behind the portal's multi-step auth gateway,
// so we stub the API surface the PortalContext bootstrap reads on entry and
// pre-seed the storage keys the SecurePortal expects after a successful PIN
// login. This keeps the test self-contained and independent of DB state.

// 375x812 — standard iPhone X / 11 / 12 / 13 mini portrait viewport.
// Task #302 specifies the 375 px width breakpoint; the 812 px height is the
// modern mobile portrait standard against which the layout was designed.
const MOBILE_VIEWPORT = { width: 375, height: 812 };

const CASE_ID = "test-case-mobile-docs";
const ACCESS_CODE = "MOBILEDOCS01";
const SESSION_TOKEN = "test-portal-session-token";

const FAKE_CASE = {
  id: CASE_ID,
  accessCode: ACCESS_CODE,
  status: "active",
  userName: "Mobile Test User",
  userEmail: "mobile@test.example",
  landingPage: "documents",
  hasRequirements: true,
  letterSent: false,
  declarationStatus: "not_required",
  showWithdrawalProgress: false,
};

const FAKE_DOCUMENT_REQUESTS = [
  {
    id: 9001,
    caseId: CASE_ID,
    documentType: "Proof of Income",
    description: "Recent payslip or equivalent proof of income.",
    status: "pending",
    uploadsEnabled: true,
    createdAt: new Date().toISOString(),
    deadline: null,
    submittedAt: null,
    submittedFileName: null,
    submittedFileData: null,
    adminNotes: null,
  },
];

function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("Documents view — mobile layout", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("status badge on the first document card is visible at 375px without scrolling", async ({
    page,
  }) => {
    // Catch-all for portal data fetches: empty arrays/objects keep the rest
    // of the shell happy without affecting the Documents view. Playwright
    // matches routes in reverse registration order, so register this FIRST
    // and let the specific handlers below take precedence.
    await page.route("**/api/**", (route) => {
      const url = route.request().url();
      if (url.includes("/declaration")) {
        return jsonRoute(route, {
          declarationStatus: "not_required",
          latest: null,
          attachments: [],
        });
      }
      if (url.includes("/letter")) {
        return jsonRoute(route, {});
      }
      return jsonRoute(route, []);
    });

    // Specific endpoints needed for the Documents view to mount.
    await page.route("**/api/cases/access/**", (route) =>
      jsonRoute(route, FAKE_CASE),
    );
    await page.route(`**/api/cases/${CASE_ID}/document-requests`, (route) =>
      jsonRoute(route, FAKE_DOCUMENT_REQUESTS),
    );
    await page.route("**/api/public/portal-refresh-mode", (route) =>
      jsonRoute(route, { enabled: false }),
    );

    // Seed the storage keys that PortalContext's auto-login effect reads,
    // skipping the access-code + PIN UI entirely. We do this on the origin
    // first so localStorage/sessionStorage writes are accepted.
    await page.goto("/");
    await page.evaluate(
      ({ accessCode, caseId, token }) => {
        sessionStorage.setItem("caseAccessCode", accessCode);
        sessionStorage.setItem("caseId", caseId);
        sessionStorage.setItem("pinVerified", "true");
        localStorage.setItem("ibccf_portal_login_at", String(Date.now()));
        localStorage.setItem(
          "ibccf_portal_session",
          JSON.stringify({
            token,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
          }),
        );
      },
      { accessCode: ACCESS_CODE, caseId: CASE_ID, token: SESSION_TOKEN },
    );

    await page.goto("/dashboard?view=documents");

    // The first document card mounts once PortalContext finishes its
    // bootstrap fetches. Give the animation a moment to settle before
    // measuring geometry.
    const card = page.getByTestId(`document-request-${FAKE_DOCUMENT_REQUESTS[0].id}`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The status badge is the first shadcn `Badge` in the card header. We
    // anchor on the rendered status label ("Action Required" for a `pending`
    // request) to avoid coupling to class-name churn.
    const badge = card.getByText("Action Required").first();
    await expect(badge).toBeVisible();

    // Core regression guard for Task #302: with the Documents view as the
    // landing page on a fresh 375 px load, at least one card's status badge
    // must be visible WITHOUT any page scroll. We explicitly assert the page
    // has not scrolled, then assert the badge is fully in the viewport — no
    // `scrollIntoViewIfNeeded()` is called before this check on purpose.
    const initialScrollY = await page.evaluate(() => window.scrollY);
    expect(initialScrollY, "page should not have scrolled on load").toBe(0);
    await expect(badge).toBeInViewport({ ratio: 1 });

    const badgeBox = await badge.boundingBox();
    const cardBox = await card.boundingBox();
    expect(badgeBox, "badge should have a measurable bounding box").not.toBeNull();
    expect(cardBox, "card should have a measurable bounding box").not.toBeNull();
    if (!badgeBox || !cardBox) return;

    // No in-card scroll either: the badge must sit in the top portion of
    // its card (the header band), not pushed below the body that the user
    // would have to scroll the card to reveal. The card header in this
    // component is small, so a 25% top-band budget is a generous but firm
    // ceiling that still catches the exact regression — the badge being
    // driven out of the card header entirely.
    const headerBudget = cardBox.y + cardBox.height * 0.25;
    expect(badgeBox.y).toBeLessThanOrEqual(headerBudget);

    // And the badge must remain inside its card vertically — no in-card
    // scroll required, and no clipping by the card boundary.
    expect(badgeBox.y).toBeGreaterThanOrEqual(cardBox.y - 1);
    expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(
      cardBox.y + cardBox.height + 1,
    );
  });
});
