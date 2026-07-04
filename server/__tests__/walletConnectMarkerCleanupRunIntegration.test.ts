import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// Integration coverage for POST
// /api/admin/wallet-connect-alert-marker-cleanup/run. The existing unit tests
// mock storage and therefore only prove the call shape; this test exercises
// the real handler against live Postgres so we can verify that:
//
//   1. When the trigger audit insert ("wallet_connect_alert_marker_cleanup_run")
//      throws, both the marker deletion AND the in-sweep
//      ("wallet_connect_alert_marker_cleanup") audit row are rolled back by
//      the wrapping storage.runInTransaction.
//   2. The happy path commits all three writes atomically: the orphaned markers
//      are deleted, the in-sweep audit row is present, and the trigger audit
//      row is present.
//
// Skips with a clear message when no DATABASE_URL / NEON_DATABASE_URL is
// configured, mirroring communityParticipantCleanupRunIntegration.test.ts.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[walletConnectMarkerCleanupRunIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB rollback checks.",
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

// Use a stable phantom caseId that will never appear in `cases` so the
// marker is always orphaned.
let phantomCaseId: string;

const FIRED_PREFIX = "wallet_connect_alert_fired:";
const MUTE_PREFIX = "wallet_connect_alert_muted:";

// Sad-path helper: throw ONLY for the trigger audit so the in-sweep
// audit succeeds first and we can prove BOTH writes get rolled back
// when the second one fails.
async function withFailingTriggerAudit<T>(fn: () => Promise<T>): Promise<T> {
  const original = storage.createAuditLog;
  (storage as any).createAuditLog = async (entry: any, executor?: unknown) => {
    if (entry?.action === "wallet_connect_alert_marker_cleanup_run") {
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
  "wallet-connect marker cleanup trigger rolls back against real Postgres",
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
        // Sweep everything keyed to this test run (covers sad-path rows
        // that were intentionally left in place and happy-path rows that
        // were already deleted by the sweep).
        if (phantomCaseId) {
          await pool.query(
            `DELETE FROM app_settings WHERE key = $1 OR key = $2`,
            [
              `${FIRED_PREFIX}${phantomCaseId}`,
              `${MUTE_PREFIX}${phantomCaseId}`,
            ],
          );
          await pool.query(
            `DELETE FROM audit_logs
               WHERE action IN ('wallet_connect_alert_marker_cleanup',
                                'wallet_connect_alert_marker_cleanup_run')
                 AND new_value LIKE $1`,
            [`%${phantomCaseId}%`],
          );
        }
        // Also sweep by timestamp as a safety net for the trigger audit
        // rows (their newValue carries the sweep summary, not the caseId).
        await pool.query(
          `DELETE FROM audit_logs
             WHERE action = 'wallet_connect_alert_marker_cleanup_run'
               AND created_at > now() - interval '1 hour'
               AND (new_value LIKE '%"skipped":false%' OR new_value LIKE '%"deleted"%')`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[walletConnectMarkerCleanupRunIntegration] cleanup failed:",
          err,
        );
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
      // Fresh phantom case ID per test — a UUID that is never inserted into
      // `cases`, so both markers are always orphaned from the sweep's
      // perspective.
      phantomCaseId = randomUUID();

      await pool.query(
        `INSERT INTO app_settings (key, value)
         VALUES ($1, 'true'), ($2, 'true')
         ON CONFLICT (key) DO UPDATE SET value = 'true'`,
        [
          `${FIRED_PREFIX}${phantomCaseId}`,
          `${MUTE_PREFIX}${phantomCaseId}`,
        ],
      );

      // Clear any audit rows from prior runs so per-test assertions on
      // counts are unambiguous.
      await pool.query(
        `DELETE FROM audit_logs
           WHERE action IN ('wallet_connect_alert_marker_cleanup',
                            'wallet_connect_alert_marker_cleanup_run')
             AND new_value LIKE $1`,
        [`%${phantomCaseId}%`],
      );
    });

    it("rolls back the marker deletions AND the in-sweep audit row when the trigger audit insert fails", async () => {
      const app = buildApp();
      const res = await withFailingTriggerAudit(() =>
        request(app)
          .post(
            "/api/admin/wallet-connect-alert-marker-cleanup/run",
          )
          .set("Authorization", "Bearer t")
          .send({}),
      );
      expect(res.status).toBe(500);

      // Both orphaned markers must still exist — the wrapping
      // runInTransaction should have rolled back the DELETE when the
      // trigger audit threw.
      const markers = await pool.query(
        `SELECT key FROM app_settings WHERE key IN ($1, $2)`,
        [
          `${FIRED_PREFIX}${phantomCaseId}`,
          `${MUTE_PREFIX}${phantomCaseId}`,
        ],
      );
      expect(markers.rows.length).toBe(2);

      // Neither audit row should have committed. Key on new_value
      // containing the phantom caseId (the in-sweep row includes it in
      // sampleCaseIds).
      const audits = await pool.query(
        `SELECT action FROM audit_logs
           WHERE action IN ('wallet_connect_alert_marker_cleanup',
                            'wallet_connect_alert_marker_cleanup_run')
             AND new_value LIKE $1`,
        [`%${phantomCaseId}%`],
      );
      expect(audits.rows.length).toBe(0);
    });

    it("commits the marker deletions together with both audit rows on the happy path", async () => {
      const app = buildApp();
      const startedAt = new Date(Date.now() - 1000);
      const res = await request(app)
        .post("/api/admin/wallet-connect-alert-marker-cleanup/run")
        .set("Authorization", "Bearer t")
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(2);
      expect(res.body.skipped).toBe(false);

      // Both orphaned markers must be gone.
      const markers = await pool.query(
        `SELECT key FROM app_settings WHERE key IN ($1, $2)`,
        [
          `${FIRED_PREFIX}${phantomCaseId}`,
          `${MUTE_PREFIX}${phantomCaseId}`,
        ],
      );
      expect(markers.rows.length).toBe(0);

      // The in-sweep audit row must exist and contain the phantom caseId
      // in its sampleCaseIds.
      const inSweep = await pool.query(
        `SELECT id FROM audit_logs
           WHERE action = 'wallet_connect_alert_marker_cleanup'
             AND created_at >= $1
             AND new_value LIKE $2`,
        [startedAt, `%${phantomCaseId}%`],
      );
      expect(inSweep.rows.length).toBe(1);

      // The trigger audit row carries the sweep summary (deleted/scanned/
      // skipped) — no caseId — so bound it by the timestamp captured
      // immediately before the request instead.
      const trigger = await pool.query(
        `SELECT id FROM audit_logs
           WHERE action = 'wallet_connect_alert_marker_cleanup_run'
             AND created_at >= $1`,
        [startedAt],
      );
      expect(trigger.rows.length).toBeGreaterThanOrEqual(1);
    });
  },
);
