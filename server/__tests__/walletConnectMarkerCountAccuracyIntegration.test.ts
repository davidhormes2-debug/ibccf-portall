import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { vi } from "vitest";

// Integration coverage for GET
// /api/admin/wallet-connect-alert-marker-cleanup (countOrphanedWalletConnectAlertMarkers).
// Verifies that the count reported by the GET endpoint stays truthful across
// the full seed → count → sweep → re-count cycle against a live Postgres DB:
//
//   1. Seed orphaned markers (fired + muted) for a phantom case ID (one that
//      has no row in `cases`).
//   2. GET returns orphaned >= 1 (the seeds are counted).
//   3. POST /run executes the cleanup sweep.
//   4. GET now returns orphaned === 0 and scanned did NOT increase.
//
// Skips gracefully when no DATABASE_URL / NEON_DATABASE_URL is configured,
// matching the pattern from walletConnectMarkerCleanupRunIntegration.test.ts.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[walletConnectMarkerCountAccuracyIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB count-accuracy checks.",
  );
}

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

const { adminRouter } = await import("../routes/admin");
const { __resetWalletConnectAlertCleanupGuardForTests } = await import(
  "../services/walletConnectAlert"
);

const FIRED_PREFIX = "wallet_connect_alert_fired:";
const MUTE_PREFIX = "wallet_connect_alert_muted:";

let pool: Pool;
let phantomCaseId: string;

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  app.use("/api/admin", adminRouter);
  return app;
}

describeIfDb(
  "wallet-connect marker GET count stays accurate before and after cleanup",
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
        await pool.query(
          `DELETE FROM audit_logs
             WHERE action = 'wallet_connect_alert_marker_cleanup_run'
               AND created_at > now() - interval '1 hour'
               AND new_value LIKE '%"skipped":false%'`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[walletConnectMarkerCountAccuracyIntegration] cleanup failed:",
          err,
        );
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
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

      await pool.query(
        `DELETE FROM audit_logs
           WHERE action IN ('wallet_connect_alert_marker_cleanup',
                            'wallet_connect_alert_marker_cleanup_run')
             AND new_value LIKE $1`,
        [`%${phantomCaseId}%`],
      );

      __resetWalletConnectAlertCleanupGuardForTests();
    });

    it("reports orphaned >= 1 before cleanup and 0 after, with scanned not increasing", async () => {
      const app = buildApp();

      const before = await request(app)
        .get("/api/admin/wallet-connect-alert-marker-cleanup")
        .set("Authorization", "Bearer t");
      expect(before.status).toBe(200);
      expect(before.body.orphaned).toBeGreaterThanOrEqual(1);
      const scannedBefore: number = before.body.scanned;

      const sweep = await request(app)
        .post("/api/admin/wallet-connect-alert-marker-cleanup/run")
        .set("Authorization", "Bearer t")
        .send({});
      expect(sweep.status).toBe(200);
      expect(sweep.body.skipped).toBe(false);

      __resetWalletConnectAlertCleanupGuardForTests();

      const after = await request(app)
        .get("/api/admin/wallet-connect-alert-marker-cleanup")
        .set("Authorization", "Bearer t");
      expect(after.status).toBe(200);
      expect(after.body.orphaned).toBe(0);
      expect(after.body.scanned).toBeLessThanOrEqual(scannedBefore);
    });
  },
);
