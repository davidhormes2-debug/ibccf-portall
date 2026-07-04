import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// Task #802 — integration coverage for POST
// /api/admin/community-thread-views-cleanup/run. The unit tests in
// communityThreadViewsCleanup.test.ts mock the DB and prove the call
// shape; this test exercises the real handler against live Postgres to
// verify that:
//
//   1. The happy path deletes the stale thread-view row AND commits the
//      `community_thread_views_cleanup` audit row in the same transaction
//      (attributed to the triggering admin instead of "system").
//   2. When the audit insert throws, the wrapping storage.runInTransaction
//      rolls back the deletion so the stale row survives.
//
// Skips with a clear message when no DATABASE_URL / NEON_DATABASE_URL is
// configured, mirroring communityParticipantCleanupRunIntegration.test.ts.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[communityThreadViewsCleanupRunIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB rollback checks.",
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
let threadId: number;
let viewId: number;
const IP_HASH_PREFIX = "task802-";

// Throw for the cleanup audit so we can prove the deletion gets rolled
// back when the audit write fails inside the wrapping transaction.
async function withFailingCleanupAudit<T>(fn: () => Promise<T>): Promise<T> {
  const original = storage.createAuditLog;
  (storage as any).createAuditLog = async (entry: any, executor?: unknown) => {
    if (entry?.action === "community_thread_views_cleanup") {
      throw new Error("integration-test forced cleanup audit failure");
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
  "Task #802 — community thread-views cleanup trigger against real Postgres",
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
        await pool.query(
          `DELETE FROM community_thread_views WHERE ip_hash LIKE $1`,
          [`${IP_HASH_PREFIX}%`],
        );
        if (threadId) {
          await pool.query(`DELETE FROM community_threads WHERE id = $1`, [
            threadId,
          ]);
        }
        await pool.query(
          `DELETE FROM audit_logs WHERE action = 'community_thread_views_cleanup'
             AND admin_username = 'integration-test-admin'`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[task-802 integration] cleanup failed:", err);
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
      // Fresh thread + a single stale view row (created_at well beyond the
      // 48h TTL so the sweep considers it prunable).
      const ipHash = `${IP_HASH_PREFIX}${randomUUID().slice(0, 8)}`;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const t = await client.query(
          `INSERT INTO community_threads (title, content, author_handle)
           VALUES ('Task 802 thread', 'body', 'tester') RETURNING id`,
        );
        threadId = t.rows[0].id;
        const v = await client.query(
          `INSERT INTO community_thread_views (thread_id, ip_hash, hour_bucket, created_at)
           VALUES ($1, $2, '2020010100', now() - interval '72 hours') RETURNING id`,
          [threadId, ipHash],
        );
        viewId = v.rows[0].id;
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      await pool.query(
        `DELETE FROM audit_logs WHERE action = 'community_thread_views_cleanup'
           AND admin_username = 'integration-test-admin'`,
      );
    });

    it("rolls back the view deletion when the cleanup audit insert fails", async () => {
      const app = buildApp();
      const res = await withFailingCleanupAudit(() =>
        request(app)
          .post("/api/admin/community-thread-views-cleanup/run")
          .set("Authorization", "Bearer t")
          .send({}),
      );
      expect(res.status).toBe(500);

      // The stale view row must still be there — the wrapping
      // runInTransaction should have rolled back the DELETE.
      const views = await pool.query(
        `SELECT id FROM community_thread_views WHERE id = $1`,
        [viewId],
      );
      expect(views.rows.length).toBe(1);
    });

    it("commits the view deletion together with the audit row on the happy path", async () => {
      const app = buildApp();
      const startedAt = new Date(Date.now() - 1000);
      const res = await request(app)
        .post("/api/admin/community-thread-views-cleanup/run")
        .set("Authorization", "Bearer t")
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
      expect(res.body.skipped).toBe(false);

      // The stale view row for our thread must be gone.
      const views = await pool.query(
        `SELECT id FROM community_thread_views WHERE id = $1`,
        [viewId],
      );
      expect(views.rows.length).toBe(0);

      // The cleanup audit row should have committed, attributed to the
      // env-driven admin principal (not "system").
      const audit = await pool.query(
        `SELECT admin_username FROM audit_logs
           WHERE action = 'community_thread_views_cleanup'
             AND created_at >= $1`,
        [startedAt],
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(1);
      expect(
        audit.rows.every((r) => r.admin_username !== "system"),
      ).toBe(true);
    });
  },
);
