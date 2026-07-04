/**
 * Task #449 — Badge count sync across browser tabs via BroadcastChannel
 *
 * Verifies the full broadcast pipeline end-to-end:
 *   1. Two admin pages open within the SAME browser context (required for
 *      BroadcastChannel to propagate across pages — different contexts are
 *      isolated and the channel messages would never arrive).
 *   2. Page 1 becomes the leader (it wins the Web Lock race) and polls
 *      `/api/admin/user-documents/pending-counts` on the 3-second cadence.
 *   3. Page 2 becomes the follower — it receives counts via BroadcastChannel
 *      instead of polling independently.
 *   4. An admin approves a pending document from Page 1 (Supporting Docs tab).
 *   5. Within the next poll + broadcast cycle (~3 s) the per-case badge on
 *      Page 2's Cases tab disappears — without Page 2 ever reloading.
 */

import { test, expect, request } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  TINY_PNG_DATA_URL,
  loginAdminUi,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

test.describe("Admin — pending-count badge syncs across tabs via BroadcastChannel", () => {
  test.beforeAll(() => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD must be set to run the badge-sync e2e tests");
    }
  });

  test(
    "follower tab becomes new leader and picks up badge after leader tab closes",
    async ({ page, context, baseURL }) => {
      test.setTimeout(30_000);
      // ── 1. Seed: create a case with NO pending documents yet ───────────────
      // We want page2 to start with badge hidden (count = 0) so we can
      // observe the badge *appearing* after we upload a doc while page1 is
      // gone — proving page2 took over as leader and resumed polling.
      const api = await request.newContext({ baseURL });
      const adminToken = readAdminToken();

      const accessCode = uniqueAccessCode();

      const caseRes = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode, status: "active" },
      });
      expect(caseRes.status(), "create case").toBe(200);
      const { id: caseId } = await caseRes.json();

      await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          userName: "Leader Failover E2E",
          userEmail: uniqueEmail(),
          status: "active",
        },
      });

      // Issue a portal session for later use (uploading the doc after page1 closes).
      const pinRes = await api.post("/api/cases/set-pin", {
        data: { accessCode, pin: "112233" },
      });
      expect(pinRes.status(), "set pin").toBe(200);
      const { sessionToken } = await pinRes.json();

      // ── 2. Open two pages inside the SAME browser context ─────────────────
      // page1 mounts first → wins the Web Lock → becomes the leader.
      // page2 mounts second → becomes the follower.
      const page1 = page;
      const page2 = await context.newPage();

      try {
        // ── 3. Login and navigate both tabs to the Cases tab ─────────────────
        await loginAdminUi(page1);
        await loginAdminUi(page2);

        await page1.getByTestId("tab-cases").click({ force: true });
        await page2.getByTestId("tab-cases").click({ force: true });

        const badge2 = page2.getByTestId(`badge-user-doc-pending-${caseId}`);

        // No pending docs yet → badge must NOT be visible on page2 after the
        // first leader poll settles.  Allow 15 s for the initial load cycle.
        await expect(badge2).toHaveCount(0, { timeout: 15_000 });

        // ── 4. Close page1 (the leader) ───────────────────────────────────────
        // The browser releases the exclusive Web Lock when the page closes.
        // page2, which is queued behind the lock, acquires it and starts
        // polling as the new leader.
        await page1.close();

        // Allow a brief moment for the lock to transfer and page2 to fire its
        // first poll as the new leader before we introduce a pending document.
        // We don't need to wait long — the lock transfer is nearly instant.
        await page2.waitForTimeout(1_500);

        // ── 5. Upload a supporting document via API (no browser tab involved) ─
        const uploadRes = await api.post(`/api/cases/${caseId}/user-documents`, {
          headers: { "x-portal-session-token": sessionToken },
          data: {
            fileData: TINY_PNG_DATA_URL,
            fileName: "leader-failover-e2e.png",
            category: "general",
            description: "Uploaded after leader tab closed — failover test",
          },
        });
        expect(uploadRes.status(), "upload supporting doc").toBe(201);

        await api.dispose();

        // ── 6. page2 (now the new leader) must show the badge ─────────────────
        // Timeline:
        //   • page2 is now the leader — it polls /api/admin/user-documents/
        //     pending-counts on the 3-second cadence.
        //   • The first poll after the upload returns count = 1 for this case.
        //   • page2 calls setCountsFn({…}), React re-renders, the badge appears.
        //
        // We allow 12 s: up to one full 3-second leader interval + network
        // round-trip + React re-render.
        await expect(badge2).toBeVisible({ timeout: 12_000 });
        await expect(badge2).toContainText("1");

        // Confirm page2 was never navigated away — still on the admin dashboard.
        expect(page2.url(), "page2 URL unchanged").toContain("/admin");
      } finally {
        // page1 is already closed; close page2 if still open.
        if (!page2.isClosed()) await page2.close();
      }
    },
  );

  test(
    "follower tab badge decrements after leader tab approves a document — no page reload required",
    async ({ page, context, baseURL }) => {
      test.setTimeout(30_000);
      // ── 1. Seed: create a case with one pending supporting document ────────
      const api = await request.newContext({ baseURL });
      const adminToken = readAdminToken();

      const accessCode = uniqueAccessCode();

      // Create the case.
      const caseRes = await api.post("/api/cases", {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { accessCode, status: "active" },
      });
      expect(caseRes.status(), "create case").toBe(200);
      const { id: caseId } = await caseRes.json();

      // Give it a name/email so it is clearly identifiable in the dashboard.
      const patchRes = await api.patch(`/api/cases/${caseId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          userName: "Badge Sync E2E",
          userEmail: uniqueEmail(),
          status: "active",
        },
      });
      expect(patchRes.status(), "patch case name").toBe(200);

      // Issue a portal session so we can upload a supporting document.
      const pinRes = await api.post("/api/cases/set-pin", {
        data: { accessCode, pin: "998877" },
      });
      expect(pinRes.status(), "set pin").toBe(200);
      const { sessionToken } = await pinRes.json();

      // Upload one supporting document — its initial status is "uploaded",
      // which counts as pending and causes the badge to appear.
      const uploadRes = await api.post(`/api/cases/${caseId}/user-documents`, {
        headers: { "x-portal-session-token": sessionToken },
        data: {
          fileData: TINY_PNG_DATA_URL,
          fileName: "badge-sync-e2e.png",
          category: "general",
          description: "Created by badge-sync-across-tabs e2e test",
        },
      });
      expect(uploadRes.status(), "upload supporting doc").toBe(201);
      const { id: docId } = await uploadRes.json();

      await api.dispose();

      // ── 2. Open two pages inside the SAME browser context ─────────────────
      // BroadcastChannel is scoped to the browsing-context group.  Two pages
      // from `context.newPage()` share the group and can exchange messages;
      // two separate `browser.newContext()` instances cannot.
      const page1 = page; // leader — mounts first → wins the Web Lock
      const page2 = await context.newPage(); // follower — receives broadcasts

      try {
        // ── 3. Log in to the admin dashboard on both pages ───────────────────
        // Login page1 first so it has a head-start on acquiring the leader lock.
        await loginAdminUi(page1);
        await loginAdminUi(page2);

        // ── 4. Navigate both tabs to the All Cases tab ───────────────────────
        // `usePendingCountsSync` starts on dashboard mount; the Cases tab is
        // where the per-case badge `badge-user-doc-pending-{caseId}` renders.
        await page1.getByTestId("tab-cases").click({ force: true });
        await page2.getByTestId("tab-cases").click({ force: true });

        const badge1 = page1.getByTestId(`badge-user-doc-pending-${caseId}`);
        const badge2 = page2.getByTestId(`badge-user-doc-pending-${caseId}`);

        // Both tabs should see the badge (count = 1) after the first poll.
        await expect(badge1).toBeVisible({ timeout: 15_000 });
        await expect(badge2).toBeVisible({ timeout: 15_000 });

        // ── 5. Page 1 (leader): approve the document ─────────────────────────
        // Navigate to Supporting Docs, filter down to our case, approve.
        await page1.getByTestId("tab-supporting-docs").click({ force: true });
        await page1.getByTestId("filter-supporting-docs-case-id").fill(caseId);

        const docRow = page1.getByTestId(`row-supporting-doc-${docId}`);
        await expect(docRow).toBeVisible({ timeout: 15_000 });
        await page1
          .getByTestId(`button-approve-supporting-doc-${docId}`)
          .click();
        // Optimistic update in page1 — the status badge flips immediately.
        await expect(docRow).toContainText("approved", { timeout: 5_000 });

        // ── 6. Page 2 (follower): badge must disappear without a reload ───────
        // Timeline:
        //   • The leader (page1) polls /api/admin/user-documents/pending-counts
        //     on its 3-second cadence and receives count = 0 for this case.
        //   • It broadcasts the updated counts map over BroadcastChannel.
        //   • The follower (page2) receives the message, calls setCountsFn({…}),
        //     React re-renders, and the badge (rendered only when count > 0)
        //     is unmounted.
        //
        // We allow 12 s to cover: up to one full 3-second leader interval +
        // network round-trip + BroadcastChannel delivery + React re-render.
        await expect(badge2).toHaveCount(0, { timeout: 12_000 });

        // Confirm page2 was never navigated away or reloaded — its URL must
        // still be the admin dashboard (not a fresh page-load URL pattern).
        expect(page2.url(), "page2 URL unchanged").toContain("/admin");
      } finally {
        await page2.close();
      }
    },
  );
});
