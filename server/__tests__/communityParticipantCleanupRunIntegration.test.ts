import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// Task #162 — integration coverage for POST
// /api/admin/settings/community-participant-retention/run. The existing
// unit tests in communityParticipantCleanupSweep.test.ts and
// adminMutationTransactionsTask157.test.ts mock storage and therefore
// only prove the call shape; this test exercises the real handler
// against live Postgres so we can verify that:
//
//   1. When the trigger audit insert ("community_participant_cleanup_run")
//      throws, both the participant deletion AND the in-sweep
//      ("community_participant_cleanup") audit row are rolled back by
//      the wrapping storage.runInTransaction.
//   2. The happy path commits all three writes atomically: the
//      participant row is deleted, the in-sweep audit row is present,
//      and the trigger audit row is present.
//
// Skips with a clear message when no DATABASE_URL / NEON_DATABASE_URL is
// configured, mirroring adminMutationTransactionsIntegration.test.ts.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[communityParticipantCleanupRunIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB rollback checks.",
  );
}

// Stub admin auth so we don't need a real bearer token; the rollback is
// what we're verifying, not the auth path.
vi.mock("../routes/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/middleware")>();
  return {
    ...actual,
    checkAdminAuth: (req: any, _res: any, next: any) => {
      req.admin = { username: "integration-test-admin" };
      req.adminUsername = "integration-test-admin";
      next();
    },
    isValidAdminToken: async () => true,
  };
});

// Imports AFTER mocks.
const { storage } = await import("../storage");
const { adminRouter } = await import("../routes/admin");

let pool: Pool;
let caseId: string;
let participantId: number;
const HANDLE_PREFIX = "task162-";

// Sad-path helper: throw ONLY for the trigger audit so the in-sweep
// audit succeeds first and we can prove BOTH writes get rolled back
// when the second one fails.
async function withFailingTriggerAudit<T>(fn: () => Promise<T>): Promise<T> {
  const original = storage.createAuditLog;
  (storage as any).createAuditLog = async (entry: any, executor?: unknown) => {
    if (entry?.action === "community_participant_cleanup_run") {
      throw new Error("integration-test forced trigger audit failure");
    }
    return original.call(storage, entry, executor as any);
  };
  try {
    return await fn();
  } finally {
    (storage as any).createAuditLog = original;
  }
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

describeIfDb(
  "Task #162 — community-participant cleanup trigger rolls back against real Postgres",
  () => {
    beforeAll(async () => {
      pool = new Pool({
        connectionString: TEST_DB_URL,
        ssl: TEST_DB_URL!.includes("sslmode=require")
          ? { rejectUnauthorized: true }
          : false,
      });
    });

    afterAll(async () => {
      try {
        // Sweep anything keyed to this test (covers sad-path runs that
        // crashed mid-setup and committed-and-then-deleted happy-path
        // rows alike).
        await pool.query(
          `DELETE FROM community_participants WHERE anonymous_handle LIKE $1`,
          [`${HANDLE_PREFIX}%`],
        );
        await pool.query(`DELETE FROM cases WHERE access_code LIKE 'T162-%'`);
        await pool.query(
          `DELETE FROM audit_logs WHERE action IN ('community_participant_cleanup', 'community_participant_cleanup_run')
             AND admin_username = 'integration-test-admin'`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[task-162 integration] cleanup failed:", err);
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
      // Fresh sealed case + participant for each test. updated_at is
      // forced ~180 days in the past so the default 90-day retention
      // cutoff considers the row prunable.
      caseId = randomUUID();
      const accessCode = `T162-${randomUUID().slice(0, 8)}`;
      const handle = `${HANDLE_PREFIX}${randomUUID().slice(0, 8)}`;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO cases (id, access_code, status, user_name, user_email, sealed_at, updated_at)
           VALUES ($1, $2, 'sealed', 'Test User', 'task162@example.com',
                   now() - interval '180 days', now() - interval '180 days')`,
          [caseId, accessCode],
        );
        const p = await client.query(
          `INSERT INTO community_participants (case_id, anonymous_handle)
           VALUES ($1, $2) RETURNING id`,
          [caseId, handle],
        );
        participantId = p.rows[0].id;
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      // Clear any prior trigger-audit rows so per-test assertions on
      // audit row counts are unambiguous.
      await pool.query(
        `DELETE FROM audit_logs WHERE action IN ('community_participant_cleanup', 'community_participant_cleanup_run')
           AND admin_username = 'integration-test-admin'`,
      );
    });

    it("rolls back the participant deletion AND the in-sweep audit row when the trigger audit insert fails", async () => {
      const app = buildApp();
      const res = await withFailingTriggerAudit(() =>
        request(app)
          .post("/api/admin/settings/community-participant-retention/run")
          .set("Authorization", "Bearer t")
          .send({}),
      );
      expect(res.status).toBe(500);

      // The participant row must still be there — the wrapping
      // runInTransaction should have rolled back the DELETE when the
      // trigger audit threw.
      const participants = await pool.query(
        `SELECT id FROM community_participants WHERE id = $1`,
        [participantId],
      );
      expect(participants.rows.length).toBe(1);

      // Neither audit row should have committed. We key on the case id
      // embedded in newValue (sampleCaseIds for the in-sweep row, the
      // wrapped sweep result for the trigger row) rather than on
      // admin_username — triggeredBy in the handler comes from the
      // env-driven ADMIN_USERNAME constant, not the request principal.
      const audits = await pool.query(
        `SELECT action FROM audit_logs
           WHERE action IN ('community_participant_cleanup', 'community_participant_cleanup_run')
             AND new_value LIKE $1`,
        [`%${caseId}%`],
      );
      expect(audits.rows.length).toBe(0);
    });

    it("commits the participant deletion together with both audit rows on the happy path", async () => {
      const app = buildApp();
      const startedAt = new Date(Date.now() - 1000);
      const res = await request(app)
        .post("/api/admin/settings/community-participant-retention/run")
        .set("Authorization", "Bearer t")
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.removed).toBeGreaterThanOrEqual(1);
      expect(res.body.skipped).toBe(false);

      // The participant row for our sealed/old case must be gone.
      const participants = await pool.query(
        `SELECT id FROM community_participants WHERE id = $1`,
        [participantId],
      );
      expect(participants.rows.length).toBe(0);

      // Exactly one of each audit row should have committed for this
      // admin user — the in-sweep cleanup row and the manual-trigger
      // row, both written inside the same transaction.
      const inSweep = await pool.query(
        `SELECT id FROM audit_logs
           WHERE action = 'community_participant_cleanup'
             AND created_at >= $1
             AND new_value LIKE $2`,
        [startedAt, `%${caseId}%`],
      );
      expect(inSweep.rows.length).toBe(1);

      // The trigger row's newValue only carries the sweep summary
      // (removed/retentionDays/cutoff/skipped) — no caseId — so we
      // bound it by the timestamp captured immediately before the
      // request instead.
      const trigger = await pool.query(
        `SELECT id FROM audit_logs
           WHERE action = 'community_participant_cleanup_run'
             AND created_at >= $1`,
        [startedAt],
      );
      expect(trigger.rows.length).toBe(1);
    });
  },
);
