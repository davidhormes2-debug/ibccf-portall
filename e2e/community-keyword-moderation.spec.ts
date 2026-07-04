/**
 * e2e/community-keyword-moderation.spec.ts
 *
 * End-to-end test for the community keyword-moderation full cycle:
 *
 * Thread cycle (Test 1):
 *   1. Admin navigates to Community tab → Keyword Blocklist subtab and adds a
 *      keyword via the UI (input-new-keyword + button-add-keyword).
 *   2. A portal user posts a thread containing that keyword via the API using
 *      an x-portal-session-token.
 *   3. The thread is hidden from the public GET /api/community/threads list
 *      (flagged filter enforcement).
 *   4. The thread appears in GET /api/admin/community/flagged.
 *   5. Admin switches to the Flagged Content subtab and verifies the thread
 *      row is visible in the UI.
 *   6. Admin approves the thread via the UI button.
 *   7. The thread is now visible in the public list (flag cleared).
 *
 * Reply cycle (Test 2):
 *   Same flow for a flagged reply (post) within an unflagged parent thread.
 *
 * Keyword blocklist CRUD cycle (Test 3):
 *   Admin adds a keyword, verifies the row and active switch, disables it via
 *   the toggle, then deletes it via the UI button (with confirm dialog).
 *
 * Remove thread cycle (Test 4):
 *   Same setup as Test 1 but admin clicks Remove instead of Approve.
 *   Thread row disappears from the Flagged Content UI, the thread is absent
 *   from the public thread list, and GET /api/community/threads/:id returns 404.
 *
 * Remove reply cycle (Test 5):
 *   Same setup as Test 2 but admin clicks Remove instead of Approve.
 *   Reply row disappears from the Flagged Content UI and the reply is
 *   absent from the public posts list (permanently deleted).
 *
 * Data lifecycle
 * ──────────────
 * All tests share one case + portal session created in beforeAll and removed
 * in afterAll.  Keywords, threads, and posts created during each test are
 * cleaned up in try/finally blocks so teardown is deterministic.
 */

import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import {
  readAdminToken,
  uniqueAccessCode,
  createCase,
  issuePortalSession,
  deleteCase,
  loginAdminUi,
} from "./helpers";
import { randomBytes } from "node:crypto";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

const TEST_PIN = "445566";

function uid(): string {
  return randomBytes(4).toString("hex");
}

// ─── Admin API teardown helpers ──────────────────────────────────────────────

async function deleteKeyword(
  api: APIRequestContext,
  adminToken: string,
  id: number,
): Promise<void> {
  await api.delete(`/api/admin/community/keywords/${id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

async function deleteThread(
  api: APIRequestContext,
  adminToken: string,
  threadId: number,
): Promise<void> {
  await api.delete(`/api/community/threads/${threadId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

// ─── Admin UI keyword helpers ─────────────────────────────────────────────────

/**
 * Navigate the already-logged-in admin page to the Community tab →
 * Keyword Blocklist subtab, type the keyword, click Add, and wait for the
 * keyword row to appear.  Returns the numeric keyword ID extracted from the
 * data-testid attribute so it can be used for cleanup.
 */
async function addKeywordViaUi(page: Page, keyword: string): Promise<number> {
  await page.getByTestId("tab-community").click({ force: true });

  await expect(page.getByTestId("subtab-keywords")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("subtab-keywords").click({ force: true });

  await expect(page.getByTestId("input-new-keyword")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("input-new-keyword").fill(keyword);
  await page.getByTestId("button-add-keyword").click({ force: true });

  // Wait for a keyword-row-${id} element to appear that contains our keyword.
  const keywordRow = page
    .locator('[data-testid^="keyword-row-"]')
    .filter({ hasText: keyword });
  await expect(keywordRow).toBeVisible({ timeout: 10_000 });

  // Extract the numeric ID from the data-testid attribute.
  const testId = await keywordRow.getAttribute("data-testid");
  const id = testId ? parseInt(testId.replace("keyword-row-", ""), 10) : NaN;
  expect(isNaN(id), `keyword-row testid must contain a numeric ID, got "${testId}"`).toBe(false);

  return id;
}

// ─── Portal-user posting helpers ─────────────────────────────────────────────

async function postThreadAsPortalUser(
  api: APIRequestContext,
  sessionToken: string,
  title: string,
  content: string,
): Promise<{ id: number; isFlagged: boolean }> {
  const res = await api.post("/api/community/threads", {
    headers: { "x-portal-session-token": sessionToken },
    data: { title, content },
  });
  expect(res.status(), "post thread as portal user").toBe(201);
  const body = await res.json();
  return { id: body.id as number, isFlagged: Boolean(body.isFlagged) };
}

async function postReplyAsPortalUser(
  api: APIRequestContext,
  sessionToken: string,
  threadId: number,
  content: string,
): Promise<{ id: number; isFlagged: boolean }> {
  const res = await api.post(`/api/community/threads/${threadId}/posts`, {
    headers: { "x-portal-session-token": sessionToken },
    data: { content },
  });
  expect(res.status(), "post reply as portal user").toBe(201);
  const body = await res.json();
  return { id: body.id as number, isFlagged: Boolean(body.isFlagged) };
}

// ─── Visibility assertion helpers ─────────────────────────────────────────────

async function isThreadInPublicList(
  api: APIRequestContext,
  threadId: number,
): Promise<boolean> {
  const res = await api.get("/api/community/threads?limit=100");
  if (!res.ok()) return false;
  const threads = (await res.json()) as { id: number }[];
  return Array.isArray(threads) && threads.some((t) => t.id === threadId);
}

async function getFlaggedContent(
  api: APIRequestContext,
  adminToken: string,
): Promise<{ posts: { id: number }[]; threads: { id: number }[] }> {
  const res = await api.get("/api/admin/community/flagged", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok()) return { posts: [], threads: [] };
  return res.json();
}

async function isReplyInPublicPosts(
  api: APIRequestContext,
  threadId: number,
  postId: number,
): Promise<boolean> {
  const res = await api.get(`/api/community/threads/${threadId}/posts`);
  if (!res.ok()) return false;
  const posts = (await res.json()) as { id: number }[];
  return Array.isArray(posts) && posts.some((p) => p.id === postId);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

test.describe("Community keyword moderation — E2E", () => {
  let adminToken: string;
  let accessCode: string;
  let caseId: string;
  let sessionToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run community keyword moderation e2e tests",
      );
    }

    adminToken = readAdminToken();
    accessCode = uniqueAccessCode("E2EKWMOD");

    const api = await request.newContext({ baseURL });
    try {
      caseId = await createCase(api, adminToken, accessCode, {
        userName: "Keyword Moderation E2E",
        extraPatch: { withdrawalStage: "1" },
      });
      sessionToken = await issuePortalSession(api, accessCode, TEST_PIN);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, adminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  // ── Test 1: flagged thread cycle ────────────────────────────────────────────

  test(
    "flagged thread is hidden publicly, appears in admin queue, and becomes visible after approval",
    async ({ page, baseURL }) => {
      const keyword = `e2ekw${uid()}`;
      const api = await request.newContext({ baseURL });
      let keywordId: number | null = null;
      let threadId: number | null = null;

      try {
        // ── 1. Admin logs in and adds the keyword via the Keyword Blocklist UI ──
        await loginAdminUi(page);
        keywordId = await addKeywordViaUi(page, keyword);

        // ── 2. Portal user posts a thread containing the keyword ──────────────
        const title = `E2E keyword thread ${uid()}`;
        const content = `This post contains the blocked word: ${keyword}. Safe to delete.`;
        const thread = await postThreadAsPortalUser(api, sessionToken, title, content);
        threadId = thread.id;

        // ── 3. Server must mark the thread as flagged immediately ─────────────
        expect(thread.isFlagged, "thread should be flagged on creation").toBe(true);

        // ── 4. Thread must NOT appear in the public list ──────────────────────
        const visibleBeforeApproval = await isThreadInPublicList(api, threadId);
        expect(
          visibleBeforeApproval,
          "flagged thread must be hidden from public thread list",
        ).toBe(false);

        // ── 5. Thread must appear in the admin flagged queue ──────────────────
        const flagged = await getFlaggedContent(api, adminToken);
        const inFlaggedQueue = flagged.threads.some((t) => t.id === threadId);
        expect(
          inFlaggedQueue,
          "flagged thread must appear in /api/admin/community/flagged",
        ).toBe(true);

        // ── 6. Admin switches to Flagged Content subtab and sees the row ───────
        await expect(page.getByTestId("subtab-flagged")).toBeVisible({
          timeout: 10_000,
        });
        await page.getByTestId("subtab-flagged").click({ force: true });

        // Force a fresh data load so stale React Query cache doesn't hide the
        // row we just created — wait for the API response to settle first.
        const refreshResponsePromise = page.waitForResponse(
          (resp) =>
            resp.url().includes("/api/admin/community/flagged") &&
            resp.status() === 200,
          { timeout: 15_000 },
        );
        await page.getByTestId("button-refresh-flagged").click({ force: true });
        await refreshResponsePromise;

        await expect(
          page.getByTestId(`flagged-thread-row-${threadId}`),
        ).toBeVisible({ timeout: 10_000 });

        // ── 7. Admin approves the thread ──────────────────────────────────────
        await page
          .getByTestId(`button-approve-thread-${threadId}`)
          .click({ force: true });

        // Row must disappear from the Flagged Content tab after approval.
        await expect(
          page.getByTestId(`flagged-thread-row-${threadId}`),
        ).not.toBeVisible({ timeout: 10_000 });

        // ── 8. Thread must now be visible in the public list ──────────────────
        const visibleAfterApproval = await isThreadInPublicList(api, threadId);
        expect(
          visibleAfterApproval,
          "approved thread must now be visible in public thread list",
        ).toBe(true);
      } finally {
        if (threadId !== null) {
          await deleteThread(api, adminToken, threadId).catch(() => {});
        }
        if (keywordId !== null) {
          await deleteKeyword(api, adminToken, keywordId).catch(() => {});
        }
        await api.dispose();
      }
    },
  );

  // ── Test 2: flagged reply cycle ─────────────────────────────────────────────

  test(
    "flagged reply is hidden publicly, appears in admin queue, and becomes visible after approval",
    async ({ page, baseURL }) => {
      const keyword = `e2erpl${uid()}`;
      const api = await request.newContext({ baseURL });
      let keywordId: number | null = null;
      let parentThreadId: number | null = null;
      let postId: number | null = null;

      try {
        // ── 1. Admin logs in and adds the keyword via the Keyword Blocklist UI ──
        await loginAdminUi(page);
        keywordId = await addKeywordViaUi(page, keyword);

        // ── 2. Create an unflagged parent thread via admin API ────────────────
        const parentTitle = `E2E reply-mod parent ${uid()}`;
        const createParent = await api.post("/api/community/threads", {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: {
            title: parentTitle,
            content:
              "E2E parent thread for reply moderation test — safe to delete.",
            authorHandle: "e2e-reply-mod-bot",
            authorType: "admin",
          },
        });
        expect(createParent.status(), "create parent thread").toBe(201);
        const parentBody = await createParent.json();
        parentThreadId = parentBody.id as number;

        // ── 3. Portal user posts a reply containing the keyword ───────────────
        const replyContent = `Reply with blocked word ${keyword} — e2e test.`;
        const reply = await postReplyAsPortalUser(
          api,
          sessionToken,
          parentThreadId,
          replyContent,
        );
        postId = reply.id;

        // ── 4. Server must mark the reply as flagged immediately ──────────────
        expect(reply.isFlagged, "reply should be flagged on creation").toBe(true);

        // ── 5. Reply must NOT appear in the public posts list ─────────────────
        const replyVisibleBeforeApproval = await isReplyInPublicPosts(
          api,
          parentThreadId,
          postId,
        );
        expect(
          replyVisibleBeforeApproval,
          "flagged reply must be hidden from public posts list",
        ).toBe(false);

        // ── 6. Reply must appear in the admin flagged queue ───────────────────
        const flagged = await getFlaggedContent(api, adminToken);
        const postInQueue = flagged.posts.some((p) => p.id === postId);
        expect(
          postInQueue,
          "flagged reply must appear in /api/admin/community/flagged",
        ).toBe(true);

        // ── 7. Admin switches to Flagged Content subtab and sees the row ───────
        await expect(page.getByTestId("subtab-flagged")).toBeVisible({
          timeout: 10_000,
        });
        await page.getByTestId("subtab-flagged").click({ force: true });

        // Force a fresh data load so stale React Query cache doesn't hide the
        // row — wait for the API response to settle before asserting.
        const refreshPostResponsePromise = page.waitForResponse(
          (resp) =>
            resp.url().includes("/api/admin/community/flagged") &&
            resp.status() === 200,
          { timeout: 15_000 },
        );
        await page.getByTestId("button-refresh-flagged").click({ force: true });
        await refreshPostResponsePromise;

        await expect(
          page.getByTestId(`flagged-post-row-${postId}`),
        ).toBeVisible({ timeout: 10_000 });

        // ── 8. Admin approves the reply ───────────────────────────────────────
        await page
          .getByTestId(`button-approve-post-${postId}`)
          .click({ force: true });

        await expect(
          page.getByTestId(`flagged-post-row-${postId}`),
        ).not.toBeVisible({ timeout: 10_000 });

        // ── 9. Reply must now be visible in the public posts list ─────────────
        const replyVisibleAfterApproval = await isReplyInPublicPosts(
          api,
          parentThreadId,
          postId,
        );
        expect(
          replyVisibleAfterApproval,
          "approved reply must now be visible in public posts list",
        ).toBe(true);
      } finally {
        if (parentThreadId !== null) {
          await deleteThread(api, adminToken, parentThreadId).catch(() => {});
        }
        if (keywordId !== null) {
          await deleteKeyword(api, adminToken, keywordId).catch(() => {});
        }
        await api.dispose();
      }
    },
  );

  // ── Test 3: keyword blocklist CRUD via UI ────────────────────────────────────

  test(
    "keyword blocklist UI — add shows row, disable toggles badge, delete removes row",
    async ({ page, baseURL }) => {
      const keyword = `e2ekwui${uid()}`;
      let keywordId: number | null = null;
      const api = await request.newContext({ baseURL });

      try {
        // ── 1. Admin logs in and adds the keyword via the Keyword Blocklist UI ──
        await loginAdminUi(page);
        keywordId = await addKeywordViaUi(page, keyword);

        // ── 2. Verify the row is present and the active switch is ON ──────────
        const keywordRow = page.getByTestId(`keyword-row-${keywordId}`);
        await expect(keywordRow).toBeVisible({ timeout: 5_000 });

        const activeSwitch = page.getByTestId(`switch-keyword-active-${keywordId}`);
        await expect(activeSwitch).toHaveAttribute("data-state", "checked", {
          timeout: 5_000,
        });

        // No "disabled" badge should exist while the keyword is active.
        await expect(keywordRow.getByText("disabled")).not.toBeVisible();

        // ── 3. Toggle the switch to disable the keyword ───────────────────────
        await activeSwitch.click({ force: true });

        // Switch must flip to unchecked and a "disabled" badge must appear.
        await expect(activeSwitch).toHaveAttribute("data-state", "unchecked", {
          timeout: 10_000,
        });
        await expect(keywordRow.getByText("disabled")).toBeVisible({
          timeout: 10_000,
        });

        // ── 4. Delete the keyword via the UI button ───────────────────────────
        // The delete handler calls window.confirm — accept the dialog.
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByTestId(`button-delete-keyword-${keywordId}`)
          .click({ force: true });

        // The row must disappear once the mutation completes.
        await expect(keywordRow).not.toBeVisible({ timeout: 10_000 });

        // Prevent double-cleanup in the finally block.
        keywordId = null;
      } finally {
        if (keywordId !== null) {
          await deleteKeyword(api, adminToken, keywordId).catch(() => {});
        }
        await api.dispose();
      }
    },
  );

  // ── Test 4: remove flagged thread ───────────────────────────────────────────

  test(
    "admin can remove a flagged thread: row disappears from queue and thread is absent from public list",
    async ({ page, baseURL }) => {
      const keyword = `e2ermth${uid()}`;
      const api = await request.newContext({ baseURL });
      let keywordId: number | null = null;
      let threadId: number | null = null;

      try {
        // ── 1. Admin logs in and adds the keyword via the Keyword Blocklist UI ──
        await loginAdminUi(page);
        keywordId = await addKeywordViaUi(page, keyword);

        // ── 2. Portal user posts a thread containing the keyword ──────────────
        const title = `E2E remove thread ${uid()}`;
        const content = `This post contains the blocked word: ${keyword}. Safe to delete.`;
        const thread = await postThreadAsPortalUser(api, sessionToken, title, content);
        threadId = thread.id;

        // ── 3. Server must mark the thread as flagged immediately ─────────────
        expect(thread.isFlagged, "thread should be flagged on creation").toBe(true);

        // ── 4. Thread must NOT appear in the public list ──────────────────────
        const visibleBeforeRemoval = await isThreadInPublicList(api, threadId);
        expect(
          visibleBeforeRemoval,
          "flagged thread must be hidden from public thread list",
        ).toBe(false);

        // ── 5. Thread must appear in the admin flagged queue ──────────────────
        const flagged = await getFlaggedContent(api, adminToken);
        const inFlaggedQueue = flagged.threads.some((t) => t.id === threadId);
        expect(
          inFlaggedQueue,
          "flagged thread must appear in /api/admin/community/flagged",
        ).toBe(true);

        // ── 6. Admin switches to Flagged Content subtab and sees the row ───────
        await expect(page.getByTestId("subtab-flagged")).toBeVisible({
          timeout: 10_000,
        });
        await page.getByTestId("subtab-flagged").click({ force: true });

        const refreshResponsePromise = page.waitForResponse(
          (resp) =>
            resp.url().includes("/api/admin/community/flagged") &&
            resp.status() === 200,
          { timeout: 15_000 },
        );
        await page.getByTestId("button-refresh-flagged").click({ force: true });
        await refreshResponsePromise;

        await expect(
          page.getByTestId(`flagged-thread-row-${threadId}`),
        ).toBeVisible({ timeout: 10_000 });

        // ── 7. Admin removes the thread ───────────────────────────────────────
        // Playwright auto-dismisses confirm() dialogs; register an accept handler
        // before clicking so the remove mutation actually fires.
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByTestId(`button-remove-thread-${threadId}`)
          .click({ force: true });

        // Row must disappear from the Flagged Content tab after removal.
        await expect(
          page.getByTestId(`flagged-thread-row-${threadId}`),
        ).not.toBeVisible({ timeout: 10_000 });

        // ── 8. Thread must NOT appear in the public list (permanently deleted) ─
        const visibleAfterRemoval = await isThreadInPublicList(api, threadId);
        expect(
          visibleAfterRemoval,
          "removed thread must be absent from public thread list",
        ).toBe(false);

        // ── 9. Direct GET /api/community/threads/:id must return 404 ──────────
        const directFetch = await api.get(`/api/community/threads/${threadId}`);
        expect(
          directFetch.status(),
          "removed thread must return 404 on direct public endpoint fetch",
        ).toBe(404);

        // Thread is already deleted — mark null so finally block skips cleanup.
        threadId = null;
      } finally {
        if (threadId !== null) {
          await deleteThread(api, adminToken, threadId).catch(() => {});
        }
        if (keywordId !== null) {
          await deleteKeyword(api, adminToken, keywordId).catch(() => {});
        }
        await api.dispose();
      }
    },
  );

  // ── Test 5: remove flagged reply ────────────────────────────────────────────

  test(
    "admin can remove a flagged reply: row disappears from queue and reply is absent from public posts list",
    async ({ page, baseURL }) => {
      const keyword = `e2ermrpl${uid()}`;
      const api = await request.newContext({ baseURL });
      let keywordId: number | null = null;
      let parentThreadId: number | null = null;
      let postId: number | null = null;

      try {
        // ── 1. Admin logs in and adds the keyword via the Keyword Blocklist UI ──
        await loginAdminUi(page);
        keywordId = await addKeywordViaUi(page, keyword);

        // ── 2. Create an unflagged parent thread via admin API ────────────────
        const parentTitle = `E2E remove-reply parent ${uid()}`;
        const createParent = await api.post("/api/community/threads", {
          headers: { Authorization: `Bearer ${adminToken}` },
          data: {
            title: parentTitle,
            content:
              "E2E parent thread for reply-remove moderation test — safe to delete.",
            authorHandle: "e2e-remove-reply-mod-bot",
            authorType: "admin",
          },
        });
        expect(createParent.status(), "create parent thread").toBe(201);
        const parentBody = await createParent.json();
        parentThreadId = parentBody.id as number;

        // ── 3. Portal user posts a reply containing the keyword ───────────────
        const replyContent = `Reply with blocked word ${keyword} — e2e remove test.`;
        const reply = await postReplyAsPortalUser(
          api,
          sessionToken,
          parentThreadId,
          replyContent,
        );
        postId = reply.id;

        // ── 4. Server must mark the reply as flagged immediately ──────────────
        expect(reply.isFlagged, "reply should be flagged on creation").toBe(true);

        // ── 5. Reply must NOT appear in the public posts list ─────────────────
        const replyVisibleBeforeRemoval = await isReplyInPublicPosts(
          api,
          parentThreadId,
          postId,
        );
        expect(
          replyVisibleBeforeRemoval,
          "flagged reply must be hidden from public posts list",
        ).toBe(false);

        // ── 6. Reply must appear in the admin flagged queue ───────────────────
        const flagged = await getFlaggedContent(api, adminToken);
        const postInQueue = flagged.posts.some((p) => p.id === postId);
        expect(
          postInQueue,
          "flagged reply must appear in /api/admin/community/flagged",
        ).toBe(true);

        // ── 7. Admin switches to Flagged Content subtab and sees the row ───────
        await expect(page.getByTestId("subtab-flagged")).toBeVisible({
          timeout: 10_000,
        });
        await page.getByTestId("subtab-flagged").click({ force: true });

        const refreshPostResponsePromise = page.waitForResponse(
          (resp) =>
            resp.url().includes("/api/admin/community/flagged") &&
            resp.status() === 200,
          { timeout: 15_000 },
        );
        await page.getByTestId("button-refresh-flagged").click({ force: true });
        await refreshPostResponsePromise;

        await expect(
          page.getByTestId(`flagged-post-row-${postId}`),
        ).toBeVisible({ timeout: 10_000 });

        // ── 8. Admin removes the reply ────────────────────────────────────────
        // Playwright auto-dismisses confirm() dialogs; register an accept handler
        // before clicking so the remove mutation actually fires.
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByTestId(`button-remove-post-${postId}`)
          .click({ force: true });

        // Row must disappear from the Flagged Content tab after removal.
        await expect(
          page.getByTestId(`flagged-post-row-${postId}`),
        ).not.toBeVisible({ timeout: 10_000 });

        // ── 9. Reply must NOT appear in the public posts list (permanently deleted) ─
        const replyVisibleAfterRemoval = await isReplyInPublicPosts(
          api,
          parentThreadId,
          postId,
        );
        expect(
          replyVisibleAfterRemoval,
          "removed reply must be absent from public posts list",
        ).toBe(false);

        // Reply is already deleted — mark null so finally block skips cleanup.
        postId = null;
      } finally {
        if (parentThreadId !== null) {
          await deleteThread(api, adminToken, parentThreadId).catch(() => {});
        }
        if (keywordId !== null) {
          await deleteKeyword(api, adminToken, keywordId).catch(() => {});
        }
        await api.dispose();
      }
    },
  );
});
