// Task #806 — End-to-end coverage for the Cases-tab withdrawal pending badge
// (`badge-cases-withdrawal` in AdminGroupedNav, driven by
// `loadWithdrawalPendingCounts` in AdminDashboard).
//
// The component-level unit tests (AdminGroupedNav.test.tsx) only prove the
// badge renders/clears in response to prop changes. They do NOT prove the live
// count actually decrements after an admin acts on a real withdrawal request.
// These specs close that gap end-to-end:
//
//   1. Seed a case via the admin API, set its PIN + open its withdrawal
//      window, and submit a real pending withdrawal request over the portal API.
//   2. Log into the admin dashboard and confirm the cross-case nav badge
//      (`badge-cases-withdrawal`) reflects the pending count, and the per-case
//      Cases-tab badge (`badge-withdrawal-pending-<caseId>`) is shown.
//   3. Open the per-case review dialog and approve / reject / cancel the request.
//   4. Assert the nav badge total decrements by exactly one (the contract that
//      `onActioned → loadWithdrawalPendingCounts` actually fires and re-fetches),
//      and the per-case badge disappears.
//
// Three independent flows are covered: approve, reject (requires a reviewer
// note), and cancel.

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  loginAdminUi,
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
      userNote: "E2E withdrawal badge sync test",
    },
  });
  expect(res.status(), "submit withdrawal request").toBe(201);
  const body = await res.json();
  expect(typeof body.id).toBe("number");
  return body.id as number;
}


// Reads the cross-case withdrawal nav badge total. Returns 0 when the badge is
// not rendered (the component hides it when the total is 0).
async function readNavWithdrawalBadge(
  page: import("@playwright/test").Page,
): Promise<number> {
  const badge = page.getByTestId("badge-cases-withdrawal");
  if ((await badge.count()) === 0) return 0;
  const txt = (await badge.first().textContent()) ?? "";
  const n = parseInt(txt.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

test.describe("Admin — withdrawal review decrements the Cases-tab pending badge", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run this e2e test");
    }
  });

  // Each flow drives a full seed → admin-dashboard load → review-dialog
  // round-trip. global-setup warms the admin chunk once up front, so no test
  // here pays the one-time dev-mode compile. A single-scenario
  // seed+load+review runs well under 60s in CI, so 120s is a comfortable ≥2x
  // budget — matching the other admin specs.
  test.beforeEach(() => {
    test.setTimeout(localTimeout(120_000));
  });

  async function seedAndOpenReview(
    page: import("@playwright/test").Page,
    api: APIRequestContext,
    adminToken: string,
    accessPrefix: string,
    pin: string,
  ): Promise<{ caseId: string; requestId: number; before: number }> {
    // ---------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode(accessPrefix);
    const caseId = await createCase(api, adminToken, accessCode, {
      extraPatch: { withdrawalWindowEnabled: true },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);
    const requestId = await submitWithdrawalRequest(
      api,
      caseId,
      sessionToken,
      pin,
    );

    // -------------------------------------------------- sign in to admin UI
    // The Cases tab is the default active section, so no explicit navigation is
    // needed (and clicking the already-active trigger can be intercepted by the
    // dev metadata overlay).
    await loginAdminUi(page);

    // Pin the cases list to just this case via the search box. Without this the
    // full (long, polling-refreshed) list can re-sort/re-paginate and detach the
    // per-case row mid-test. The search matches access code / name / email — not
    // the internal UUID — so we search by the unique access code.
    await page.getByTestId("input-search-cases").fill(accessCode);

    // The per-case badge appears once the pending-counts poll populates. It is
    // the trigger that opens the review dialog.
    const caseBadge = page.getByTestId(`badge-withdrawal-pending-${caseId}`);
    await expect(caseBadge).toBeVisible({ timeout: 30_000 });

    // The cross-case nav badge must also reflect at least this one request.
    const before = await readNavWithdrawalBadge(page);
    expect(before, "nav badge total includes the seeded request").toBeGreaterThanOrEqual(1);

    // Open the per-case review dialog and wait for the request row to load.
    await caseBadge.click();
    await expect(
      page.getByTestId(`row-withdrawal-request-${requestId}`),
    ).toBeVisible({ timeout: 15_000 });

    return { caseId, requestId, before };
  }

  test("approving a withdrawal request decrements the nav badge and clears the per-case badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const { caseId, requestId, before } = await seedAndOpenReview(
      page,
      api,
      adminToken,
      "E2EWA",
      "246802",
    );

    // ----------------------------------------------------------- approve
    await page.getByTestId(`button-wr-approve-${requestId}`).click();

    // onActioned → loadWithdrawalPendingCounts re-fetches; the nav total drops
    // by exactly one.
    await expect
      .poll(() => readNavWithdrawalBadge(page), { timeout: 15_000 })
      .toBe(before - 1);

    // Close the dialog and confirm the per-case badge is gone.
    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(`badge-withdrawal-pending-${caseId}`),
    ).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  test("rejecting a withdrawal request decrements the nav badge and clears the per-case badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const { caseId, requestId, before } = await seedAndOpenReview(
      page,
      api,
      adminToken,
      "E2EWR",
      "135791",
    );

    // ----------------------------------------------------------- reject
    // A reviewer note is mandatory when rejecting.
    await page
      .getByTestId(`textarea-wr-admin-note-${requestId}`)
      .fill("Requested wallet on an unsupported network — please re-apply.");
    await page.getByTestId(`button-wr-reject-${requestId}`).click();

    await expect
      .poll(() => readNavWithdrawalBadge(page), { timeout: 15_000 })
      .toBe(before - 1);

    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(`badge-withdrawal-pending-${caseId}`),
    ).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  test("cancelling a withdrawal request decrements the nav badge and clears the per-case badge", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    const { caseId, requestId, before } = await seedAndOpenReview(
      page,
      api,
      adminToken,
      "E2EWC",
      "864208",
    );

    // ----------------------------------------------------------- cancel
    await page.getByTestId(`button-wr-cancel-${requestId}`).click();

    await expect
      .poll(() => readNavWithdrawalBadge(page), { timeout: 15_000 })
      .toBe(before - 1);

    await page.keyboard.press("Escape");
    await expect(
      page.getByTestId(`badge-withdrawal-pending-${caseId}`),
    ).toHaveCount(0, { timeout: 15_000 });

    await api.dispose();
  });

  // --------------------------------------------------------------------
  // Task #814 — the per-case badge can never reach 2.
  //
  // The task that asked for this coverage assumed a case could hold two or
  // more *pending* withdrawal requests, so that resolving one would drop the
  // per-case badge N→N-1 while it stays visible. That state is unreachable by
  // design: the system enforces "at most one pending request per case" in two
  // independent layers —
  //   1. App layer: the portal submit route returns 409 when a pending request
  //      already exists (server/routes/withdrawalRequests.ts).
  //   2. DB layer: a partial unique index
  //      (migrations/0004_withdrawal_requests_unique_pending.sql) on
  //      (case_id) WHERE status = 'pending' rejects a second pending row even
  //      under a concurrent race.
  // There is no admin create-request route either, so the portal submit is the
  // only creation path and it is capped.
  //
  // This test locks in that invariant end-to-end: a second submit is rejected
  // with 409, the admin pending-counts API reports exactly 1 for the case, and
  // the per-case badge renders as a plain label with no digit. The badge has no
  // numeric counter at all — the unreachable `count > 1` span was removed from
  // CasesTab.tsx since a case can never hold more than one pending request. This
  // assertion now guards against the counter being reintroduced: if anyone adds
  // a digit back to the badge (e.g. while lifting the one-pending cap), it fails
  // and flags that the badge needs its own decrement coverage.
  test("a case cannot accumulate two pending withdrawal requests, so the per-case badge never shows a count", async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const adminToken = readAdminToken();

    // -------------------------------------------------------------- seed
    const accessCode = uniqueAccessCode("E2EW2");
    const pin = "975310";
    const caseId = await createCase(api, adminToken, accessCode, {
      extraPatch: { withdrawalWindowEnabled: true },
    });
    const sessionToken = await issuePortalSession(api, accessCode, pin);

    // First submit succeeds (201).
    await submitWithdrawalRequest(api, caseId, sessionToken, pin);

    // ----------------------------- second submit must be rejected (409)
    const second = await api.post(`/api/cases/${caseId}/withdrawal-requests`, {
      headers: { "x-portal-session-token": sessionToken },
      data: {
        amount: "2000",
        asset: "USDT",
        network: "TRC20",
        withdrawalType: "full",
        requestedWalletAddress: "TWithdrawE2ESecondAddress7890123",
        confirmationChannel: "email",
        pin,
        termsAccepted: true,
        userNote: "Second withdrawal attempt — should be rejected",
      },
    });
    expect(
      second.status(),
      "second pending submit is rejected by the one-pending-per-case cap",
    ).toBe(409);

    // ---------------------- admin pending-counts reports exactly 1 here
    const countsRes = await api.get("/api/withdrawal-requests/pending-counts", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(countsRes.status(), "pending-counts").toBe(200);
    const countsBody = (await countsRes.json()) as {
      counts: Record<string, number>;
    };
    expect(
      countsBody.counts[caseId],
      "exactly one pending request survives the cap",
    ).toBe(1);

    // ------------------- the per-case badge renders without a counter
    await loginAdminUi(page);
    await page.getByTestId("input-search-cases").fill(accessCode);

    const caseBadge = page.getByTestId(`badge-withdrawal-pending-${caseId}`);
    await expect(caseBadge).toBeVisible({ timeout: 30_000 });

    // The badge has no numeric counter span, so its text is the plain label
    // with no digits regardless of the count.
    const badgeText = (await caseBadge.textContent()) ?? "";
    expect(badgeText).toMatch(/WITHDRAWAL PENDING/i);
    expect(
      /\d/.test(badgeText),
      "no numeric counter is shown when the count is 1",
    ).toBe(false);

    await api.dispose();
  });
});
