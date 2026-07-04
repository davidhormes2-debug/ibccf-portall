// Task #812 — End-to-end coverage for the Analytics-overview KPI cards
// (`card-withdrawal-pending-kpi` / `card-sealed-kpi` in
// client/src/components/admin/tabs/AnalyticsTab.tsx).
//
// Task #805 added a "Pending Withdrawals" KPI card to the admin Analytics
// overview. It shows the total pending-withdrawal count and, when clicked,
// switches to the Cases tab with the withdrawal-pending filter applied. The
// sibling "Sealed Cases" KPI behaves the same way (sealed filter). Neither had
// automated coverage, so a refactor could silently break the count or the
// click-through. These specs close that gap end-to-end:
//
//   1. Seed a case via the admin API and submit a real pending withdrawal
//      request over the portal API.
//   2. Log into the admin dashboard, open the Analytics tab, and confirm the
//      "Pending Withdrawals" card renders with a count reflecting the seeded
//      request (`text-withdrawal-pending-count` >= 1).
//   3. Click the card and assert we land on the Cases tab with the
//      withdrawal-pending filter pill active (`aria-pressed="true"`).
//   4. Separately, confirm the "Sealed Cases" card renders and its
//      click-through switches to the Cases tab with the sealed filter applied
//      (`select-sealed-filter` shows "Sealed Only").

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  loginAdminUi as loginAdminUiBase,
  localTimeout,
} from "./helpers";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

async function submitWithdrawalRequest(
  api: APIRequestContext,
  caseId: string,
  sessionToken: string,
  pin: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/withdrawal-requests`, {
    headers: { "x-portal-session-token": sessionToken },
    data: {
      amount: "1000",
      asset: "USDT",
      network: "TRC20",
      withdrawalType: "full",
      requestedWalletAddress: "TWithdrawE2EWalletAddress123456",
      confirmationChannel: "email",
      pin,
      termsAccepted: true,
      userNote: "E2E analytics KPI card test",
    },
  });
  expect(res.status(), "submit withdrawal request").toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}

async function loginAdminUi(page: import("@playwright/test").Page) {
  await loginAdminUiBase(page);
  // Wait for the explicit "initial data settled" sentinel (cases loaded AND
  // pending-counts fetched) so the Analytics totals reflect real data rather
  // than racing the 3s polling loop. It is rendered hidden, so wait on
  // "attached" rather than "visible".
  await expect(page.getByTestId("admin-data-ready")).toBeAttached({
    timeout: 30_000,
  });
}

// Reads the Analytics "Pending Withdrawals" count. Returns 0 if absent.
async function readWithdrawalKpiCount(
  page: import("@playwright/test").Page,
): Promise<number> {
  const el = page.getByTestId("text-withdrawal-pending-count");
  if ((await el.count()) === 0) return 0;
  const txt = (await el.first().textContent()) ?? "";
  const n = parseInt(txt.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

test.describe("Admin — Analytics overview KPI cards", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  // Each flow drives a full seed → admin-dashboard load → tab navigation
  // round-trip. global-setup warms the admin chunk once up front, so no test
  // here pays the one-time dev-mode compile. A single-scenario
  // seed+load+navigate runs well under 60s in CI, so 120s is a comfortable ≥2x
  // budget — matching the other admin specs.
  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  test("Pending Withdrawals card renders the seeded total and click-through filters Cases", async ({
    page,
    baseURL,
  }) => {
    // global-setup already warmed the admin chunk, so this test pays only the
    // seed → load → navigate round-trip (no dev-mode compile). It runs well
    // under 60s in CI, comfortably inside the 120s budget.
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // ---------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode("E2EAK");
    const pin = "246802";
    const caseId = await createCase(api, adminToken, accessCode, {
      extraPatch: { withdrawalWindowEnabled: true },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    await submitWithdrawalRequest(api, caseId, sessionToken, pin);

    // ------------------------------------------------ sign in to admin UI
    await loginAdminUi(page);

    // Open the Analytics tab.
    await page.getByTestId("tab-analytics").click({ force: true });

    // The card renders, and its total reflects at least the request we seeded.
    // The count is sourced from the withdrawal-pending cross-tab sync, which
    // may settle a tick after the page mounts, so poll it.
    await expect(page.getByTestId("card-withdrawal-pending-kpi")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => readWithdrawalKpiCount(page), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);

    // ----------------------------------------------------- click-through
    await page.getByTestId("button-withdrawal-pending-kpi").click();

    // We should now be on the Cases tab with the withdrawal-pending filter
    // active. The quick-triage pill only renders when the total > 0 (true
    // because we seeded a request) and is pressed when the filter is on.
    const pill = page.getByTestId("button-filter-withdrawal-pending");
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toHaveAttribute("aria-pressed", "true");

    await api.dispose();
  });

  test("Sealed Cases card renders and click-through applies the sealed filter on Cases", async ({
    page,
  }) => {
    // The sealed click-through only exercises the card → Cases-tab filter wiring,
    // so it does not need a seeded sealed case: the card is always rendered.
    await loginAdminUi(page);

    await page.getByTestId("tab-analytics").click({ force: true });

    await expect(page.getByTestId("card-sealed-kpi")).toBeVisible({
      timeout: 30_000,
    });
    // The count is a non-negative integer.
    const countText =
      (await page.getByTestId("text-sealed-count").textContent()) ?? "";
    expect(/^\d+$/.test(countText.trim())).toBe(true);

    // ----------------------------------------------------- click-through
    await page.getByTestId("button-sealed-kpi").click();

    // Cases tab now shows the sealed filter applied. The Select trigger
    // displays the selected option's label.
    const sealedFilter = page.getByTestId("select-sealed-filter");
    await expect(sealedFilter).toBeVisible({ timeout: 15_000 });
    await expect(sealedFilter).toContainText("Sealed Only");
  });
});
