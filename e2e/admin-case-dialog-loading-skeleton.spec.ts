// Regression guard: the admin case dialog skeleton-to-content cross-fade must
// work correctly whenever the dialog opens.
//
// What this spec covers:
//
//   1. While the three async fetches (messages, stamp-duty receipts, last
//      reminder) are in flight, BOTH the header skeleton
//      (aria-label="Loading case header") AND the body skeleton
//      (aria-label="Loading case details") must be visible, and the real
//      tab content (data-testid="case-detail-tabs") must be absent.
//
//   2. Once all fetches settle, both skeletons must disappear and the real
//      tab content plus the real dialog header
//      (data-testid="header-action-open-mirror") must appear — i.e. neither
//      skeleton and the content are ever simultaneously visible at steady
//      state.
//
// The "loading while in flight" assertion is the hard part: if the fetches
// resolve before the first Playwright paint we would never see the skeleton.
// To avoid that race we intercept the three internal API calls and delay them
// by 600 ms each, giving Playwright a comfortable window to observe the
// intermediate state.
//
// Relevant source:
//   - client/src/pages/AdminDashboard.tsx  — AnimatePresence blocks
//   - client/src/components/admin/CaseDialogSkeleton.tsx — skeleton components

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { localTimeout } from "./helpers";
import { randomBytes } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

function uniqueAccessCode(): string {
  return `DLGSKEL-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function uniqueEmail(): string {
  return `e2e-dlgskel-${randomBytes(3).toString("hex")}@example.com`;
}

async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
): Promise<string> {
  const created = await api.post("/api/cases", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { accessCode, status: "active" },
  });
  expect(created.status(), "create case").toBe(200);
  const body = await created.json();
  const caseId = body.id as string;

  const patched = await api.patch(`/api/cases/${caseId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      userName: "Dialog Loading Skeleton E2E",
      userEmail: uniqueEmail(),
      status: "active",
    },
  });
  expect(patched.status(), "patch case").toBe(200);
  return caseId;
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => { if (t) sessionStorage.setItem("adminToken", t); },
    token,
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
}

// Opens the case-detail dialog for a given case via the Cases tab search +
// manage dropdown. Returns once the "Manage" menu item has been clicked.
async function openCaseDialog(
  page: import("@playwright/test").Page,
  caseId: string,
  accessCode: string,
): Promise<void> {
  const search = page.getByTestId("input-search-cases");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(accessCode);

  const manageButton = page.getByTestId(`button-manage-case-${caseId}`);
  await expect(manageButton).toBeVisible({ timeout: 15_000 });
  await manageButton.click();

  const manageItem = page.getByTestId(`menu-manage-${caseId}`);
  await expect(manageItem).toBeVisible({ timeout: 5_000 });
  await manageItem.click();
}

test.describe("Admin case dialog — skeleton-to-content loading animation", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("skeleton is visible while fetches are in flight and disappears once they resolve", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // Intercept the three API calls that openAdminMessageDialog fires in
    // parallel and delay each by 600 ms.  That window is long enough for
    // Playwright to observe the skeleton in a single-threaded browser while
    // still keeping the total wait under 2 s.
    await page.route(`**/api/cases/${caseId}/messages*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/last-reminder*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // --------------------------------- open the case-detail dialog
    await openCaseDialog(page, caseId, accessCode);

    // ── Assert BOTH skeletons are visible WHILE the fetches are still in flight ──
    //
    // CaseTabContentSkeleton has aria-label="Loading case details" and
    // CaseDialogHeaderSkeleton has aria-label="Loading case header" — use the
    // accessible labels as selectors so the assertions are tied to semantic
    // intent, not an internal implementation detail like a CSS class name.
    //
    // We do NOT use waitFor here: both skeletons must already be in the DOM at
    // this point (the flag is set synchronously before the dialog opens).
    const bodySkeleton = page.getByLabel("Loading case details");
    const headerSkeleton = page.getByLabel("Loading case header");
    await expect(bodySkeleton).toBeVisible({ timeout: 3_000 });
    await expect(headerSkeleton).toBeVisible({ timeout: 3_000 });

    // The real tab content and real header must be absent while loading.
    await expect(page.getByTestId("case-detail-tabs")).toHaveCount(0);
    await expect(page.getByTestId("header-action-open-mirror")).toHaveCount(0);

    // ── Wait for fetches to settle then assert steady-state ───────────────
    await expect(page.getByTestId("case-detail-tabs")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("header-action-open-mirror")).toBeVisible({
      timeout: 5_000,
    });

    // Both skeletons must be gone once real content is shown.
    await expect(bodySkeleton).toHaveCount(0);
    await expect(headerSkeleton).toHaveCount(0);

    // Verify neither skeleton and the tab content are simultaneously visible.
    const bodySkeletonCount = await bodySkeleton.count();
    const headerSkeletonCount = await headerSkeleton.count();
    const tabsCount = await page.getByTestId("case-detail-tabs").count();
    expect(
      bodySkeletonCount === 0 && headerSkeletonCount === 0 && tabsCount === 1,
      "header/body skeletons and case-detail-tabs must not be visible at the same time",
    ).toBe(true);

    await api.dispose();
  });

  test("opening the dialog a second time re-shows the skeleton then the real content", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // Open the dialog a first time (without the delay — just confirm it works).
    await openCaseDialog(page, caseId, accessCode);
    await expect(page.getByTestId("case-detail-tabs")).toBeVisible({
      timeout: 10_000,
    });

    // Close the dialog (pressing Escape is the most reliable cross-browser way).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("case-detail-tabs")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Add a delay on the second open to catch the skeleton mid-flight.
    await page.route(`**/api/cases/${caseId}/messages*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/last-reminder*`, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    // Re-open the same case.
    await openCaseDialog(page, caseId, accessCode);

    const bodySkeleton = page.getByLabel("Loading case details");
    const headerSkeleton = page.getByLabel("Loading case header");
    await expect(bodySkeleton).toBeVisible({ timeout: 3_000 });
    await expect(headerSkeleton).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("case-detail-tabs")).toHaveCount(0);
    await expect(page.getByTestId("header-action-open-mirror")).toHaveCount(0);

    // Both skeletons disappear and real content appears after load.
    await expect(page.getByTestId("case-detail-tabs")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("header-action-open-mirror")).toBeVisible({
      timeout: 5_000,
    });
    await expect(bodySkeleton).toHaveCount(0);
    await expect(headerSkeleton).toHaveCount(0);

    await api.dispose();
  });

  test("header skeleton exit animation (opacity fade) runs before the element is removed from the DOM", async ({
    page,
    baseURL,
  }) => {
    // This test guards against a regression where the `exit={{ opacity: 0 }}`
    // prop is accidentally stripped from the motion.div wrapper around the
    // header skeleton.
    //
    // When the exit prop is intact, Framer Motion:
    //   1. Keeps the element in the DOM while animating opacity 1 → 0 (150 ms).
    //   2. Removes it only after the animation completes.
    //
    // When the exit prop is missing, Framer Motion removes the element from the
    // DOM immediately on unmount, with no style changes at all.
    //
    // We detect the difference by installing a MutationObserver on the
    // motion.div wrapper (direct parent of the aria-label element) while the
    // skeleton is fully visible.  The observer records whether the wrapper's
    // inline opacity was ever set to a value < 0.99.  If the exit prop is
    // stripped the observer never fires and the assertion fails.

    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // Force real (non-reduced) motion so the 150 ms opacity transition
    // actually runs.  With prefers-reduced-motion:reduce the transition
    // collapses to duration:0 and the intermediate frames are harder to catch.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Delay the three parallel fetches so the skeleton stays visible long
    // enough for us to install the observer before fetches resolve.
    await page.route(`**/api/cases/${caseId}/messages*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/last-reminder*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    // --------------------------------- open the case-detail dialog
    await openCaseDialog(page, caseId, accessCode);

    // Wait for the header skeleton to appear (fetches are still in flight).
    const headerSkeleton = page.getByLabel("Loading case header");
    await expect(headerSkeleton).toBeVisible({ timeout: 3_000 });

    // ── Install MutationObserver while the skeleton is fully visible ────────
    //
    // The motion.div wrapper is the direct parentElement of the skeleton div.
    // Framer Motion applies inline `style.opacity` values to that wrapper as it
    // animates.  We record whether opacity ever drops below 0.99, which proves
    // the exit animation ran rather than the element being torn out instantly.
    //
    // Cleanup is done after the assertions via __headerExitObs.disconnect().
    await page.evaluate(() => {
      (window as Record<string, unknown>).__headerExitOpacityTouched = false;
      const skeletonEl = document.querySelector('[aria-label="Loading case header"]');
      if (!skeletonEl) return;
      const wrapper = skeletonEl.parentElement as HTMLElement | null;
      if (!wrapper) return;
      const obs = new MutationObserver(() => {
        const raw = (wrapper as HTMLElement).style.opacity;
        if (raw !== "") {
          const parsed = parseFloat(raw);
          if (!isNaN(parsed) && parsed < 0.99) {
            (window as Record<string, unknown>).__headerExitOpacityTouched = true;
          }
        }
      });
      obs.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
      (window as Record<string, unknown>).__headerExitObs = obs;
    });

    // ── Wait for fetches to settle (real header appears) ───────────────────
    await expect(page.getByTestId("header-action-open-mirror")).toBeVisible({
      timeout: 10_000,
    });

    // At this exact moment AnimatePresence is running the exit animation on
    // the header skeleton (150 ms).  The element must still be in the DOM.
    const countDuringExit = await headerSkeleton.count();
    expect(
      countDuringExit,
      "header skeleton must still be in the DOM during the AnimatePresence exit " +
        "phase — if it is already gone, the exit animation was skipped entirely",
    ).toBeGreaterThan(0);

    // Give the browser enough time to run the full 150 ms animation frames and
    // let the MutationObserver callbacks flush before we read the flag.
    await page.waitForTimeout(400);

    // ── Core assertion: the exit animation touched the opacity ─────────────
    const exitAnimationRan = await page.evaluate(
      () => (window as Record<string, unknown>).__headerExitOpacityTouched,
    );
    expect(
      exitAnimationRan,
      "Framer Motion must have applied an opacity < 0.99 on the motion.div " +
        "wrapper during the exit animation.  If this fails, the " +
        "`exit={{ opacity: 0 }}` prop was stripped and the skeleton is removed " +
        "from the DOM with no fade at all.",
    ).toBe(true);

    // Disconnect the observer now that the assertions are done.
    await page.evaluate(() => {
      const obs = (window as Record<string, unknown>).__headerExitObs as
        | MutationObserver
        | undefined;
      obs?.disconnect();
    });

    // Confirm the element is fully removed after the animation completes.
    await expect(headerSkeleton).toHaveCount(0, { timeout: 3_000 });

    await api.dispose();
  });

  test("body skeleton exit animation (opacity fade) runs before the element is removed from the DOM", async ({
    page,
    baseURL,
  }) => {
    // This test guards against a regression where the `exit={{ opacity: 0 }}`
    // prop is accidentally stripped from the motion.div wrapper around the
    // body skeleton (CaseTabContentSkeleton).
    //
    // When the exit prop is intact, Framer Motion:
    //   1. Keeps the element in the DOM while animating opacity 1 → 0 (150 ms).
    //   2. Removes it only after the animation completes.
    //
    // When the exit prop is missing, Framer Motion removes the element from the
    // DOM immediately on unmount, with no style changes at all.
    //
    // We detect the difference by installing a MutationObserver on the
    // motion.div wrapper (direct parent of the aria-label element) while the
    // skeleton is fully visible.  The observer records whether the wrapper's
    // inline opacity was ever set to a value < 0.99.  If the exit prop is
    // stripped the observer never fires and the assertion fails.

    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ----------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode();
    const caseId = await createCase(api, adminToken, accessCode);

    // ------------------------------------------ sign in to admin dashboard
    await loginAdminUi(page);

    // Force real (non-reduced) motion so the 150 ms opacity transition
    // actually runs.  With prefers-reduced-motion:reduce the transition
    // collapses to duration:0 and the intermediate frames are harder to catch.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Delay the three parallel fetches so the skeleton stays visible long
    // enough for us to install the observer before fetches resolve.
    await page.route(`**/api/cases/${caseId}/messages*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/receipts*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.route(`**/api/cases/${caseId}/stamp-duty/last-reminder*`, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    // --------------------------------- open the case-detail dialog
    await openCaseDialog(page, caseId, accessCode);

    // Wait for the body skeleton to appear (fetches are still in flight).
    const bodySkeleton = page.getByLabel("Loading case details");
    await expect(bodySkeleton).toBeVisible({ timeout: 3_000 });

    // ── Install MutationObserver while the skeleton is fully visible ────────
    //
    // The motion.div wrapper is the direct parentElement of the skeleton div.
    // Framer Motion applies inline `style.opacity` values to that wrapper as it
    // animates.  We record whether opacity ever drops below 0.99, which proves
    // the exit animation ran rather than the element being torn out instantly.
    //
    // Cleanup is done after the assertions via __bodyExitObs.disconnect().
    await page.evaluate(() => {
      (window as Record<string, unknown>).__bodyExitOpacityTouched = false;
      const skeletonEl = document.querySelector('[aria-label="Loading case details"]');
      if (!skeletonEl) return;
      const wrapper = skeletonEl.parentElement as HTMLElement | null;
      if (!wrapper) return;
      const obs = new MutationObserver(() => {
        const raw = (wrapper as HTMLElement).style.opacity;
        if (raw !== "") {
          const parsed = parseFloat(raw);
          if (!isNaN(parsed) && parsed < 0.99) {
            (window as Record<string, unknown>).__bodyExitOpacityTouched = true;
          }
        }
      });
      obs.observe(wrapper, { attributes: true, attributeFilter: ["style"] });
      (window as Record<string, unknown>).__bodyExitObs = obs;
    });

    // ── Wait for fetches to settle (real tab content appears) ──────────────
    await expect(page.getByTestId("case-detail-tabs")).toBeVisible({
      timeout: 10_000,
    });

    // At this exact moment AnimatePresence is running the exit animation on
    // the body skeleton (150 ms).  The element must still be in the DOM.
    const countDuringExit = await bodySkeleton.count();
    expect(
      countDuringExit,
      "body skeleton must still be in the DOM during the AnimatePresence exit " +
        "phase — if it is already gone, the exit animation was skipped entirely",
    ).toBeGreaterThan(0);

    // Give the browser enough time to run the full 150 ms animation frames and
    // let the MutationObserver callbacks flush before we read the flag.
    await page.waitForTimeout(400);

    // ── Core assertion: the exit animation touched the opacity ─────────────
    const exitAnimationRan = await page.evaluate(
      () => (window as Record<string, unknown>).__bodyExitOpacityTouched,
    );
    expect(
      exitAnimationRan,
      "Framer Motion must have applied an opacity < 0.99 on the motion.div " +
        "wrapper during the exit animation.  If this fails, the " +
        "`exit={{ opacity: 0 }}` prop was stripped and the body skeleton is " +
        "removed from the DOM with no fade at all.",
    ).toBe(true);

    // Disconnect the observer now that the assertions are done.
    await page.evaluate(() => {
      const obs = (window as Record<string, unknown>).__bodyExitObs as
        | MutationObserver
        | undefined;
      obs?.disconnect();
    });

    // Confirm the element is fully removed after the animation completes.
    await expect(bodySkeleton).toHaveCount(0, { timeout: 3_000 });

    await api.dispose();
  });
});
