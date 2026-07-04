// E2E: exercises the full chat-to-rating flow end-to-end at the live server
// level, including the DB-backed nonce anti-replay guard added on top of the
// existing HMAC satToken signature/expiry checks.
//
// Flow under test
// ─────────────────
//  1. Seed a case via the admin API.
//  2. Seed an active_visitors row directly in the DB with hasActiveChat=true
//     and caseId bound to that case. This mirrors the real state a visitor
//     ends up in after an admin-initiated chat (POST /:visitorId/initiate-chat
//     flips hasActiveChat, and caseId is a server-established value never
//     accepted from a public/unauthenticated caller) — see the "caseId
//     supplied by an unauthenticated caller is never trusted" comment in
//     server/routes/visitors.ts. There is no public API to bind caseId onto
//     an active_visitors row, so a direct SQL seed is the only way to exercise
//     this state from an E2E test without adding new production surface.
//  3. POST /api/visitors/end-session — the server should notice hadChat=true
//     and issue a signed `satToken` in the response.
//  4. POST /api/visitors/satisfaction with that satToken — must succeed
//     (201) exactly once.
//  5. Resubmitting the SAME satToken must be rejected — the token's nonce was
//     already claimed in storage.claimSatisfactionTokenNonce(), so the second
//     POST must get 409, not a silent second success.
//
// This closes the gap called out in server/lib/satisfactionToken.ts: unit
// tests cover the token/nonce logic in isolation, but nothing previously
// drove the real end-session -> satisfaction handshake through the live
// server and confirmed replay is actually rejected end-to-end.

import { test, expect } from "@playwright/test";
import { Client } from "pg";
import {
  createCase,
  deleteCase,
  loginAdminApi,
  uniqueAccessCode,
  localTimeout,
} from "./helpers";

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

let ipSuffix = 1;
function freshIp(): string {
  const n = ipSuffix++;
  return `10.211.${Math.floor(n / 256)}.${n % 256}`;
}

/**
 * Seed an active_visitors row with hasActiveChat=true and the given caseId,
 * simulating the post-initiate-chat state described above. No production
 * route accepts caseId or hasActiveChat from an unauthenticated caller, so
 * this bypasses the API and writes the row directly.
 */
async function seedActiveVisitorWithChat(
  databaseUrl: string,
  visitorId: string,
  caseId: string,
): Promise<void> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query(
      `INSERT INTO active_visitors (visitor_id, case_id, has_active_chat, session_started_at, last_heartbeat_at)
       VALUES ($1, $2, true, NOW(), NOW())`,
      [visitorId, caseId],
    );
  } finally {
    await pg.end();
  }
}

/**
 * Delete rows this spec created directly that reference the case by FK
 * (active_visitors.case_id, visitor_history.case_id — written by
 * POST /end-session, chat_satisfaction_ratings.case_id) but that
 * `storage.deleteCase` does not currently clean up. Without this, the
 * teardown `deleteCase()` call 500s on the FK constraint — pre-existing
 * gap in `deleteCase`, out of scope for this spec to fix.
 */
async function cleanupVisitorAndRating(
  databaseUrl: string,
  visitorId: string,
  caseId: string,
): Promise<void> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM chat_satisfaction_ratings WHERE case_id = $1`, [caseId]);
    await pg.query(`DELETE FROM active_visitors WHERE visitor_id = $1`, [visitorId]);
    await pg.query(`DELETE FROM visitor_history WHERE visitor_id = $1`, [visitorId]);
  } finally {
    await pg.end();
  }
}

test.describe("Chat-to-rating flow — satisfaction token anti-replay (live server)", () => {
  test.setTimeout(localTimeout(60_000));

  test.skip(
    !DATABASE_URL,
    "DATABASE_URL is required to seed the active_visitors chat state",
  );

  test("end-session issues a satToken that rates once and rejects replay", async ({
    request,
  }) => {
    const adminToken = await loginAdminApi(request);
    const caseId = await createCase(request, adminToken, uniqueAccessCode("SATE2E"));
    const visitorId = `e2e-sat-flow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const ip = freshIp();

    try {
      // 1. Visitor has an active, admin-initiated chat bound to this case.
      await seedActiveVisitorWithChat(DATABASE_URL, visitorId, caseId);

      // 2. Visitor ends the session — the server should detect hadChat=true
      //    and mint a signed satToken.
      const endSession = await request.post("/api/visitors/end-session", {
        headers: { "X-Forwarded-For": ip },
        data: { visitorId },
      });
      expect(endSession.status(), "end-session should succeed").toBe(200);
      const endSessionBody = await endSession.json();
      expect(
        typeof endSessionBody.satToken,
        "end-session must issue a satToken after a chat session",
      ).toBe("string");
      const satToken = endSessionBody.satToken as string;

      // 4. First rating submission with the token must succeed.
      const ratingPayload = {
        visitorId,
        caseId,
        rating: 5,
        feedback: "Great support, thanks!",
        satToken,
      };
      const firstSubmit = await request.post("/api/visitors/satisfaction", {
        headers: { "X-Forwarded-For": ip },
        data: ratingPayload,
      });
      expect(
        firstSubmit.status(),
        `first satisfaction submission should succeed (got ${firstSubmit.status()}: ${await firstSubmit.text()})`,
      ).toBe(201);

      // 5. Resubmitting the identical satToken must be rejected — the nonce
      //    was already claimed, so this proves the anti-replay guard is wired
      //    into the live route, not just covered by isolated unit tests.
      const replaySubmit = await request.post("/api/visitors/satisfaction", {
        headers: { "X-Forwarded-For": ip },
        data: ratingPayload,
      });
      expect(
        replaySubmit.status(),
        "replaying the same satToken must be rejected, not silently accepted twice",
      ).toBe(409);
    } finally {
      await cleanupVisitorAndRating(DATABASE_URL, visitorId, caseId);
      await deleteCase(request, adminToken, caseId);
    }
  });
});
