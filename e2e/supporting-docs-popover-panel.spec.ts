// Task #513 — End-to-end coverage for the per-case Supporting Docs surfaces:
//   • SupportingDocsQuickPopover  (quick-action popover on CasesTab)
//   • SupportingDocumentsPanel    (per-case panel inside the case-detail dialog)
//
// For each surface the tests confirm:
//   1. Approve and reject actions work via the surface's own UI.
//   2. loadUserDocPendingCounts() fires after every action — verified by
//      confirming the per-case badge (`badge-user-doc-pending-{caseId}`)
//      disappears once the last pending document is actioned.
//
// ── Architecture: shared browser session ─────────────────────────────────
// Each describe block contains a SINGLE test that logs in once and runs
// multiple scenarios via test.step().  This avoids the 30-60s per-test
// login overhead that would exceed the 240s test timeout when all five
// scenarios ran as independent tests.
//
// ── Why we use addInitScript + page.evaluate() ────────────────────────────
// The admin dashboard has two sources of instability that defeat Playwright's
// standard locator.click() mechanism:
//
//  1. The login form is wrapped in Framer-Motion animations.  While the form
//     is exiting, the tab-nav elements rendered by the newly-mounted dashboard
//     are considered "unstable" by Playwright's actionability checker, which
//     waits until all position changes have stopped.
//
//  2. After login, the dashboard starts a setInterval(loadData, 3000) polling
//     loop that causes React to continuously re-render.  Combined with the
//     `transition-all` CSS on TabsTrigger buttons and the `animate-pulse` class
//     on pending-upload badges, the actionability checker never sees a "stable"
//     frame and waits indefinitely.
//
// Solution A — addInitScript (login):
//   Inject the pre-fetched bearer token into sessionStorage BEFORE the page
//   initialises.  The React app detects the token, skips the login form
//   entirely, and mounts the dashboard directly — no Framer-Motion exit
//   animation, no transition delay.
//
// Solution B — jsClick() via page.evaluate() (animated elements):
//   Dispatch a synchronous MouseEvent via page.evaluate(), bypassing
//   Playwright's actionability checks entirely.  DOM diagnostic confirmed:
//   evaluate() returns immediately and the Radix PopoverTrigger opens
//   (data-state=open) synchronously via React event delegation.
//   CRITICAL: do NOT wrap in setTimeout() inside evaluate() — that schedules
//   a macro-task that runs while the CDP channel is open for subsequent
//   Playwright calls, causing toBeVisible() etc. to stall indefinitely.
//
// Solution C — fillSearchInput() via page.evaluate() (case list filter):
//   Directly set the native input value and fire `input`/`change` events so
//   React's controlled input re-renders with the filtered case list.  This
//   is 10x faster than Playwright's fill() because it skips the actionability
//   stability check (which stalls on the transition-all CSS of adjacent tabs).
//   After fillSearchInput() the case list shows only the test case, so
//   badge waits drop from ~20 s to ~1 s.
//
// ── Why we reuse the global admin token ──────────────────────────────────
// The global-setup.ts project fetches one bearer token before any test runs.
// We read it from .auth/admin.json and reuse it for all API seeding calls.
// This avoids hitting the admin-login rate limiter (which triggered 429s when
// each test attempted a fresh POST /api/admin/login).

import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode,
  TINY_PNG_DATA_URL,
  createCase as _createCase,
  issuePortalSession,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

async function createCase(
  api: APIRequestContext,
  adminToken: string,
  accessCode: string,
  label: string,
): Promise<string> {
  return _createCase(api, adminToken, accessCode, { userName: label });
}

async function uploadSupportingDoc(
  api: APIRequestContext,
  caseId: string,
  sessionToken: string,
  fileName: string,
): Promise<number> {
  const res = await api.post(`/api/cases/${caseId}/user-documents`, {
    headers: { "x-portal-session-token": sessionToken },
    data: {
      fileData: TINY_PNG_DATA_URL,
      fileName,
      category: "general",
      description: "E2E supporting document",
    },
  });
  expect(res.status(), "upload supporting doc").toBe(201);
  return (await res.json()).id as number;
}

async function fetchDocStatus(
  api: APIRequestContext,
  adminToken: string,
  docId: number,
): Promise<string | null> {
  const res = await api.get("/api/user-documents", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const docs = (await res.json()) as Array<{ id: number; status: string | null }>;
  return docs.find((d) => d.id === docId)?.status ?? null;
}

// Log into the admin dashboard by injecting the pre-fetched bearer token into
// sessionStorage before the page initialises.  The React app detects the
// token, skips the login form entirely, and mounts the dashboard in
// authenticated state directly — no Framer-Motion exit animation.
// The 1280×900 viewport keeps all case rows within the visible area.
async function loginAdminUi(page: import("@playwright/test").Page) {
  const token = readAdminToken();
  await page.addInitScript(
    (t) => {
      if (t) sessionStorage.setItem("adminToken", t);
    },
    token,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin");
  // Wait for the dashboard shell to mount …
  await expect(page.getByTestId("admin-case-finder-trigger")).toBeVisible({
    timeout: 30_000,
  });
  // … then wait for the deterministic "initial data loaded" sentinel.  It is
  // rendered only after the first /api/cases load settles AND the pending-counts
  // badge data has been fetched at least once.  Waiting on it here means the
  // case list and per-case badges are already populated before any test step
  // runs, so the first fillSearchInput + badge wait resolves in ~1 s instead of
  // racing the 3 s polling loop (which previously cost 15-25 s per suite).  The
  // element is `hidden`, so we wait for it to be ATTACHED rather than visible.
  await page
    .getByTestId("admin-data-ready")
    .waitFor({ state: "attached", timeout: 30_000 });
}

// Dispatch a synthetic pointer+click sequence via page.evaluate(), bypassing
// Playwright's actionability checks.  Sending PointerEvent(pointerdown) before
// MouseEvent(click) satisfies Radix DropdownMenuTrigger (which gates on
// onPointerDown) in addition to Radix PopoverTrigger.  This lets us fire the
// same helper for all interactive elements — manage buttons, menu items,
// popover badges, expand/approve/reject buttons — without worrying whether the
// Playwright actionability checker will stall on CSS transitions or Radix
// Dialog exit animations.
async function jsClick(
  page: import("@playwright/test").Page,
  testId: string,
): Promise<void> {
  await page.evaluate((tid) => {
    const el = document.querySelector(
      `[data-testid="${tid}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, isPrimary: true }));
    el.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, isPrimary: true }));
    el.dispatchEvent(new MouseEvent("click",          { bubbles: true, cancelable: true }));
  }, testId);
}

// Set the Cases-tab search query via native input events so React's
// controlled-input updates immediately.  Skips Playwright's stability
// check — fillSearchInput() returns in <1 ms vs up to 80 s for a
// standard locator.fill() on an element inside a transition-all container.
async function fillSearchInput(
  page: import("@playwright/test").Page,
  value: string,
): Promise<void> {
  await page.evaluate((v) => {
    const el = document.querySelector(
      '[data-testid="input-search-cases"]',
    ) as HTMLInputElement | null;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: SupportingDocsQuickPopover (Cases tab)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — SupportingDocsQuickPopover (per-case popover on Cases tab)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run these e2e tests");
    }
  });

  // Two scenarios in one login session (~60 s typical). This suite runs warm —
  // an earlier alphabetical admin spec (admin-analytics-kpi-cards) absorbs the
  // one-time dev-mode compile — and Task #848's lazy tab panels trimmed the
  // first-load critical path. 120s already sits at the ~2x floor over the warm
  // ~60s run, so it stays here: the warm run never pays the compile, so Task
  // #869's lighter (sub-deopt-threshold) compile gives no room to tighten this
  // one further without dropping below the ≥2x margin.
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    if (!DATABASE_URL) return;
    const pg = new Client({ connectionString: DATABASE_URL });
    try {
      await pg.connect();
      await pg.query("DELETE FROM admin_login_attempts");
    } finally {
      await pg.end();
    }
  });

  test("popover approve and reject scenarios", async ({ page, baseURL }) => {
    const adminToken = readAdminToken();
    const api = await request.newContext({ baseURL });

    // Seed two cases, each with one pending doc.
    const acReject = uniqueAccessCode("E2EPPR");
    const caseIdReject = await createCase(
      api, adminToken, acReject, "Popover Reject E2E",
    );
    const stReject = await issuePortalSession(api, acReject, "246810");
    const docIdReject = await uploadSupportingDoc(
      api, caseIdReject, stReject, "popover-reject-target.png",
    );

    const acApprove = uniqueAccessCode("E2EPPA");
    const caseIdApprove = await createCase(
      api, adminToken, acApprove, "Popover Approve E2E",
    );
    const stApprove = await issuePortalSession(api, acApprove, "246810");
    const docIdApprove = await uploadSupportingDoc(
      api, caseIdApprove, stApprove, "popover-approve-target.png",
    );

    // Single login shared by both scenarios.
    await loginAdminUi(page);

    // ── Scenario 1: reject via per-doc reject button ─────────────────────
    await test.step("reject via per-doc reject button removes doc and clears badge", async () => {
      // Narrow the case list to only this case — badge wait drops from ~20 s to ~1 s.
      await fillSearchInput(page, acReject);

      const badge = page.getByTestId(`badge-user-doc-pending-${caseIdReject}`);
      // expect().toBeVisible() tolerates brief re-renders from the 3 s polling loop.
      await expect(badge).toBeVisible({ timeout: 15_000 });

      // Synchronous dispatchEvent opens the Radix popover immediately.
      await jsClick(page, `badge-user-doc-pending-${caseIdReject}`);

      // Popover rows load async (fetch inside handleOpenChange → load()).
      const docRow = page.getByTestId(`popover-user-doc-row-${docIdReject}`);
      await expect(docRow).toBeVisible({ timeout: 15_000 });

      await jsClick(page, `popover-user-doc-reject-${docIdReject}`);

      // Row disappears optimistically; badge clears when loadUserDocPendingCounts() fires.
      await expect(docRow).toHaveCount(0, { timeout: 10_000 });
      await expect(badge).toHaveCount(0, { timeout: 15_000 });

      expect(await fetchDocStatus(api, adminToken, docIdReject)).toBe("rejected");
    });

    // ── Scenario 2: approve via per-doc approve button ───────────────────
    await test.step("approve via per-doc approve button removes doc and clears badge", async () => {
      await fillSearchInput(page, acApprove);

      const badge = page.getByTestId(`badge-user-doc-pending-${caseIdApprove}`);
      await expect(badge).toBeVisible({ timeout: 15_000 });

      await jsClick(page, `badge-user-doc-pending-${caseIdApprove}`);

      const docRow = page.getByTestId(`popover-user-doc-row-${docIdApprove}`);
      await expect(docRow).toBeVisible({ timeout: 15_000 });

      await jsClick(page, `popover-user-doc-approve-${docIdApprove}`);

      await expect(docRow).toHaveCount(0, { timeout: 10_000 });
      await expect(badge).toHaveCount(0, { timeout: 15_000 });

      expect(await fetchDocStatus(api, adminToken, docIdApprove)).toBe("approved");
    });

    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: SupportingDocumentsPanel (case-detail dialog › Documents tab)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Admin — SupportingDocumentsPanel (per-case panel in case-detail dialog)", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run these e2e tests");
    }
  });

  // Also runs warm (an earlier alphabetical admin spec eats the one-time
  // dev-mode compile, lightened further by Task #848's lazy tab panels and now
  // by Task #869 carving AdminDashboard.tsx below Babel's 500,000-byte deopt
  // threshold). This is the heavier of the two suites — three scenarios driving
  // Radix dialog open/close — but those use the synchronous jsClick() helper
  // (no actionability stall), so the run stays ~60s and the extra 0.5x of
  // headroom the old 150s budget carried is no longer warranted. 120s keeps a
  // comfortable ~2x margin, matching the popover suite.
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    if (!DATABASE_URL) return;
    const pg = new Client({ connectionString: DATABASE_URL });
    try {
      await pg.connect();
      await pg.query("DELETE FROM admin_login_attempts");
    } finally {
      await pg.end();
    }
  });

  // Open the case-detail dialog for `caseId`, then switch to the Documents tab.
  //
  // jsClick (pointerdown+pointerup+click via evaluate) is used for ALL button
  // interactions here — even on the first scenario — because:
  //  • Playwright's regular .click() stalls on the Radix Dialog exit animation
  //    (data-state="closed") from a prior scenario, causing the actionability
  //    checker to wait indefinitely for overlapping elements to clear.
  //  • The PointerEvent sequence satisfies Radix DropdownMenuTrigger (which
  //    gates on onPointerDown) so the dropdown opens correctly.
  //  • The window hook bypasses the transition-all stall on tab triggers.
  async function openCaseDetailDocumentsTab(
    page: import("@playwright/test").Page,
    accessCode: string,
    caseId: string,
  ) {
    await fillSearchInput(page, accessCode);

    await expect(page.getByTestId(`button-manage-case-${caseId}`)).toBeVisible({
      timeout: 15_000,
    });
    await jsClick(page, `button-manage-case-${caseId}`);

    await expect(page.getByTestId(`menu-manage-${caseId}`)).toBeVisible({
      timeout: 5_000,
    });
    await jsClick(page, `menu-manage-${caseId}`);

    // "Open Mirror" header action is a reliable signal the dialog is mounted.
    await expect(page.getByTestId("header-action-open-mirror")).toBeVisible({
      timeout: 15_000,
    });

    // Use the window hook to switch tabs — avoids the actionability stall on
    // the animated tab triggers.
    await page.evaluate(() => { (window as any).__setCaseDetailTab("documents"); });
  }

  test("panel approve, reject and bulk-approve scenarios", async ({ page, baseURL }) => {
    const adminToken = readAdminToken();
    const api = await request.newContext({ baseURL });
    // Seed three cases.
    const acApprove = uniqueAccessCode("E2EPNA");
    const caseIdApprove = await createCase(
      api, adminToken, acApprove, "Panel Approve E2E",
    );
    const stApprove = await issuePortalSession(api, acApprove, "112233");
    const docIdApprove = await uploadSupportingDoc(
      api, caseIdApprove, stApprove, "panel-approve-target.png",
    );

    const acReject = uniqueAccessCode("E2EPNR");
    const caseIdReject = await createCase(
      api, adminToken, acReject, "Panel Reject E2E",
    );
    const stReject = await issuePortalSession(api, acReject, "998877");
    const docIdReject = await uploadSupportingDoc(
      api, caseIdReject, stReject, "panel-reject-target.png",
    );

    const acBulk = uniqueAccessCode("E2EPBA");
    const caseIdBulk = await createCase(
      api, adminToken, acBulk, "Panel Bulk Approve E2E",
    );
    const stBulk = await issuePortalSession(api, acBulk, "246801");
    const docIdBulk1 = await uploadSupportingDoc(
      api, caseIdBulk, stBulk, "panel-bulk-1.png",
    );
    const docIdBulk2 = await uploadSupportingDoc(
      api, caseIdBulk, stBulk, "panel-bulk-2.png",
    );

    // Single login shared by all three scenarios.
    await loginAdminUi(page);

    // ── Scenario 1: approve via expand+approve ────────────────────────────
    // jsClick bypasses the actionability checker so animated elements inside
    // the case-detail dialog don't cause indefinite stalls.
    await test.step("approve via expand+approve clears Cases-tab badge after dialog close", async () => {
      await openCaseDetailDocumentsTab(page, acApprove, caseIdApprove);

      // Wait for expand button to be in the DOM (panel has loaded).
      await expect(page.getByTestId(`button-panel-expand-${docIdApprove}`)).toBeVisible({
        timeout: 15_000,
      });
      await jsClick(page, `button-panel-expand-${docIdApprove}`);

      await expect(page.getByTestId(`button-panel-approve-${docIdApprove}`)).toBeVisible({
        timeout: 5_000,
      });
      await jsClick(page, `button-panel-approve-${docIdApprove}`);

      // Row collapses once the PATCH succeeds.
      await expect(page.getByTestId(`button-panel-expand-${docIdApprove}`)).toHaveCount(0, {
        timeout: 10_000,
      });
      expect(await fetchDocStatus(api, adminToken, docIdApprove)).toBe("approved");

      // Close dialog; verify badge absent — onActioned → loadUserDocPendingCounts().
      await page.keyboard.press("Escape");
      await fillSearchInput(page, acApprove);
      const badge = page.getByTestId(`badge-user-doc-pending-${caseIdApprove}`);
      await expect(badge).toHaveCount(0, { timeout: 15_000 });
    });

    // ── Scenario 2: reject with notes via expand+reject ───────────────────
    await test.step("reject with notes via expand+reject clears Cases-tab badge after dialog close", async () => {
      await openCaseDetailDocumentsTab(page, acReject, caseIdReject);

      await expect(page.getByTestId(`button-panel-expand-${docIdReject}`)).toBeVisible({
        timeout: 15_000,
      });
      await jsClick(page, `button-panel-expand-${docIdReject}`);

      // Fill notes via native setter so React's controlled textarea updates
      // immediately without waiting for Playwright's actionability checks.
      await expect(page.getByTestId(`textarea-panel-doc-notes-${docIdReject}`)).toBeVisible({
        timeout: 5_000,
      });
      await page.evaluate((tid) => {
        const el = document.querySelector(`[data-testid="${tid}"]`) as HTMLTextAreaElement | null;
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, 'Document is expired — please re-upload.');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, `textarea-panel-doc-notes-${docIdReject}`);

      await expect(page.getByTestId(`button-panel-reject-${docIdReject}`)).toBeVisible({
        timeout: 5_000,
      });
      await jsClick(page, `button-panel-reject-${docIdReject}`);

      await expect(page.getByTestId(`button-panel-expand-${docIdReject}`)).toHaveCount(0, {
        timeout: 10_000,
      });
      expect(await fetchDocStatus(api, adminToken, docIdReject)).toBe("rejected");

      await page.keyboard.press("Escape");
      await fillSearchInput(page, acReject);
      const badge = page.getByTestId(`badge-user-doc-pending-${caseIdReject}`);
      await expect(badge).toHaveCount(0, { timeout: 15_000 });
    });

    // ── Scenario 3: bulk approve via panel ────────────────────────────────
    await test.step("bulk approve via panel clears Cases-tab badge after dialog close", async () => {
      await openCaseDetailDocumentsTab(page, acBulk, caseIdBulk);

      await expect(page.getByTestId(`button-panel-expand-${docIdBulk1}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId(`button-panel-expand-${docIdBulk2}`)).toBeVisible({
        timeout: 10_000,
      });

      await expect(page.getByTestId("panel-bulk-approve")).toBeVisible({ timeout: 5_000 });
      await jsClick(page, "panel-bulk-approve");

      await expect(page.getByTestId(`button-panel-expand-${docIdBulk1}`)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(page.getByTestId(`button-panel-expand-${docIdBulk2}`)).toHaveCount(0, {
        timeout: 15_000,
      });

      expect(await fetchDocStatus(api, adminToken, docIdBulk1)).toBe("approved");
      expect(await fetchDocStatus(api, adminToken, docIdBulk2)).toBe("approved");

      await page.keyboard.press("Escape");
      await fillSearchInput(page, acBulk);
      const badge = page.getByTestId(`badge-user-doc-pending-${caseIdBulk}`);
      await expect(badge).toHaveCount(0, { timeout: 15_000 });
    });

    await api.dispose();
  });
});
