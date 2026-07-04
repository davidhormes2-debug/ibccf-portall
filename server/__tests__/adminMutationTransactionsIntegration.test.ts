import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Router } from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";

// Task #147 — confirms that audit-log failures actually roll back the
// underlying DB row when the real Drizzle/pg transaction aborts, not
// just when a mock pretends to. Each of the six admin surfaces from
// Task #144 (document review, deposit-receipt PATCH, withdrawal-review,
// declaration review, blocked-IP block/unblock, announcement
// create/update/delete) is exercised against a live Postgres connection.
//
// The tests skip with a clear message if neither DATABASE_URL nor
// NEON_DATABASE_URL is configured in the environment, so they're a
// no-op for contributors without a local Postgres.
//
// We force the audit insert to throw by patching `storage.createAuditLog`
// at the route entry. Because the route invokes it inside
// `storage.runInTransaction(...)`, drizzle's `db.transaction` callback
// rejects and Postgres rolls back the preceding row mutation. We then
// SELECT directly from the DB to prove the row is unchanged — i.e. the
// transactional boundary really held.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

// Task #156 — POST /api/admin/login reads ADMIN_USERNAME / ADMIN_PASSWORD
// at module-load time via destructuring of process.env, so we must pin
// them BEFORE `await import("../routes/admin")` below for the login
// rollback test to be able to reach the success branch.
const TEST_LOGIN_USERNAME = "task156-int-admin";
const TEST_LOGIN_PASSWORD = "task156-int-pass";
const PREV_ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const PREV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
process.env.ADMIN_USERNAME = TEST_LOGIN_USERNAME;
process.env.ADMIN_PASSWORD = TEST_LOGIN_PASSWORD;

const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[adminMutationTransactionsIntegration] Skipped: set DATABASE_URL or NEON_DATABASE_URL to run real-DB rollback checks.",
  );
}

// Avoid loading the production middleware (it does network/auth work
// against the same DB and would inflate audit-log noise during test
// runs). The route exercise is the rollback — auth is incidental.
// The RBAC role gate (`requireAdminRole`, layered on top of
// `checkAdminAuth` after the admin-roles work) reads `req.adminRole`,
// which the production `checkAdminAuth` resolves from the admin's
// session via `resolveAdminRoleFromUsername`. Our stub bypasses that
// DB round-trip, so it must set `req.adminRole` itself — otherwise
// every route gated with `requireAdminRole(...)` 403s before the
// handler (and its transaction) ever runs, which is a test-harness
// drift, not a real rollback regression.
vi.mock("../routes/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/middleware")>();
  return {
    ...actual,
    checkAdminAuth: (req: any, _res: any, next: any) => {
      req.admin = { username: "integration-test-admin" };
      req.adminUsername = "integration-test-admin";
      req.adminRole = "super_admin";
      next();
    },
    isValidAdminToken: async () => true,
  };
});

// Email side effects fire as fire-and-forget *after* the transaction
// commits, but they are still imported lazily by the routes. Stub them
// so we never actually attempt SMTP from a unit test run.
import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({ sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })) }),
}));
vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));
vi.mock("../services/portal-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/portal-auth")>();
  return {
    ...actual,
    requirePortalAccess: (_req: any, _res: any, next: any) => next(),
    requireUnsealed: (_req: any, _res: any, next: any) => next(),
    requirePortalSessionOnly: (_req: any, _res: any, next: any) => next(),
    isAuthorizedForCase: async () => true,
    isPortalSessionValidForCase: async () => true,
  };
});

// Imports AFTER mocks.
const { storage } = await import("../storage");
const { documentRequestsRouter } = await import("../routes/content");
const { depositsRouter } = await import("../routes/deposits");
const { adminRouter, blockedIpsRouter } = await import("../routes/admin");
const { registerCaseWithdrawalRoutes } = await import("../routes/withdrawalRequests");
const { communicationsRouter } = await import("../routes/communications");
// Task #173 — additional surfaces extended into the rollback pattern.
const { casesRouter } = await import("../routes/cases");
const { registerCaseLedgerRoutes } = await import("../routes/caseLedger");
const { registerCaseWithdrawalActivationRoutes } = await import(
  "../routes/withdrawalActivation"
);

let pool: Pool;
let caseId: string;
let documentRequestId: number;
let depositReceiptId: number;
let withdrawalRequestId: number;
let declarationSubmissionId: number;
let announcementId: string;
const blockedIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

// Helper: monkey-patch storage.createAuditLog to throw, run a block,
// then restore. The throw propagates out of the route's
// runInTransaction callback so drizzle issues a real ROLLBACK.
async function withFailingAudit<T>(fn: () => Promise<T>): Promise<T> {
  const original = storage.createAuditLog;
  (storage as any).createAuditLog = async () => {
    throw new Error("integration-test forced audit failure");
  };
  try {
    return await fn();
  } finally {
    (storage as any).createAuditLog = original;
  }
}

function buildApp(mount: (a: express.Express) => void) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.set("trust proxy", true);
  mount(app);
  return app;
}

describeIfDb("Task #147 — admin mutation transactions roll back against a real Postgres", () => {
  beforeAll(async () => {
    pool = new Pool({
      connectionString: TEST_DB_URL,
      ssl: TEST_DB_URL!.includes("sslmode=require") ? { rejectUnauthorized: true } : false,
    });
  });

  afterAll(async () => {
    // Best-effort cleanup of every row this test inserted.
    try {
      await pool.query(`DELETE FROM withdrawal_requests WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM declaration_submissions WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM deposit_receipts WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM document_requests WHERE case_id = $1`, [caseId]);
      // Task #173 — sweep the additional child rows our new tests touch.
      await pool.query(`DELETE FROM case_ledger_entries WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM stamp_duty_receipts WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM withdrawal_security_tokens WHERE case_id = $1`, [caseId]);
      await pool.query(`DELETE FROM audit_logs WHERE target_id = $1`, [caseId]);
      await pool.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
      await pool.query(`DELETE FROM blocked_ips WHERE ip_address = $1`, [blockedIp]);
      await pool.query(`DELETE FROM audit_logs WHERE target_id = $1`, [blockedIp]);
      await pool.query(
        `DELETE FROM admin_mirror_tokens WHERE case_id = $1`,
        [caseId],
      );
      if (announcementId) {
        await pool.query(`DELETE FROM announcements WHERE id = $1`, [announcementId]);
        await pool.query(`DELETE FROM audit_logs WHERE target_id = $1`, [announcementId]);
      }
      // Task #156 — sweep any admin-session rows or login audit logs
      // left behind by the /login rollback test.
      await pool.query(
        `DELETE FROM admin_sessions WHERE admin_username = $1`,
        [TEST_LOGIN_USERNAME],
      );
      await pool.query(
        `DELETE FROM audit_logs WHERE admin_username = $1`,
        [TEST_LOGIN_USERNAME],
      );
      if (PREV_ADMIN_USERNAME === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = PREV_ADMIN_USERNAME;
      if (PREV_ADMIN_PASSWORD === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = PREV_ADMIN_PASSWORD;
      // Leftover announcement rows from sad-path tests that may have
      // committed *before* this run started — we keyed everything to a
      // distinctive title prefix so we can sweep them safely.
      await pool.query(
        `DELETE FROM announcements WHERE title LIKE 'task147-test-%'`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[task-147 integration] cleanup failed:", err);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Fresh case + child rows for every test so the rollback assertions
    // start from a clean slate. We do this in a single transaction so
    // partial seeding can't leave the DB in a half state if a test
    // crashes mid-setup.
    caseId = randomUUID();
    const accessCode = `T147-${randomUUID().slice(0, 8)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO cases (id, access_code, status, user_name, user_email)
         VALUES ($1, $2, 'created', 'Test User', 'integration-test@example.com')`,
        [caseId, accessCode],
      );
      const doc = await client.query(
        `INSERT INTO document_requests (case_id, document_type, status)
         VALUES ($1, 'KYC ID', 'submitted') RETURNING id`,
        [caseId],
      );
      documentRequestId = doc.rows[0].id;
      const receipt = await client.query(
        `INSERT INTO deposit_receipts (case_id, status) VALUES ($1, 'pending') RETURNING id`,
        [caseId],
      );
      depositReceiptId = receipt.rows[0].id;
      const wr = await client.query(
        `INSERT INTO withdrawal_requests
           (case_id, status, amount, asset, network, withdrawal_type,
            requested_wallet_address, confirmation_channel)
         VALUES ($1, 'pending', '100', 'USDT', 'TRC20', 'full',
                 'TXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV', 'email')
         RETURNING id`,
        [caseId],
      );
      withdrawalRequestId = wr.rows[0].id;
      const decl = await client.query(
        `INSERT INTO declaration_submissions
           (case_id, full_name, email, country_of_residence, date_of_birth,
            access_code, not_sanctioned_jurisdictions, no_sanctioned_transactions,
            acknowledge_usdt_not_supported, understand_false_info_consequences,
            source_of_income, regulatory_acknowledgment, signature_full_name,
            signature_date, status)
         VALUES ($1, 'Test User', 'integration-test@example.com', 'CH', '1990-01-01',
                 $2, true, true, true, true, 'salary', true,
                 'Test User', '2026-01-01', 'submitted')
         RETURNING id`,
        [caseId, accessCode],
      );
      declarationSubmissionId = decl.rows[0].id;
      const ann = await client.query(
        `INSERT INTO announcements (title, message, type, active)
         VALUES ('task147-test-existing', 'msg', 'info', true) RETURNING id`,
      );
      announcementId = ann.rows[0].id;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Ensure the IP under test is NOT pre-blocked.
    await pool.query(`DELETE FROM blocked_ips WHERE ip_address = $1`, [blockedIp]);
  });

  // --------------------------------------------------------------
  it("rolls back document_requests.status when audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/document-requests", documentRequestsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/document-requests/${documentRequestId}/approve`)
        .set("Authorization", "Bearer t")
        .send({}),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT status, approved_at FROM document_requests WHERE id = $1`,
      [documentRequestId],
    );
    expect(rows[0].status).toBe("submitted");
    expect(rows[0].approved_at).toBeNull();
  });

  // --------------------------------------------------------------
  it("rolls back deposit_receipts.status when audit insert fails (PATCH /:id)", async () => {
    const app = buildApp((a) => a.use("/api/deposit-receipts", depositsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/deposit-receipts/${depositReceiptId}`)
        .set("Authorization", "Bearer t")
        .send({ status: "approved", adminNotes: "should not stick" }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT status, admin_notes FROM deposit_receipts WHERE id = $1`,
      [depositReceiptId],
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].admin_notes).toBeNull();
  });

  it("rolls back deposit_receipts.status when audit insert fails (PATCH /:id/status)", async () => {
    const app = buildApp((a) => a.use("/api/deposit-receipts", depositsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/deposit-receipts/${depositReceiptId}/status`)
        .set("Authorization", "Bearer t")
        .send({ status: "approved" }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT status FROM deposit_receipts WHERE id = $1`,
      [depositReceiptId],
    );
    expect(rows[0].status).toBe("pending");
  });

  // --------------------------------------------------------------
  it("rolls back withdrawal_requests.status when audit insert fails", async () => {
    const app = buildApp((a) => {
      const router = (express.Router as unknown as () => Router)();
      registerCaseWithdrawalRoutes(router);
      a.use("/api/cases", router);
    });
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/cases/${caseId}/withdrawal-requests/${withdrawalRequestId}`)
        .set("Authorization", "Bearer t")
        .send({ status: "approved", adminNote: "should not stick" }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT status, reviewed_at, admin_note FROM withdrawal_requests WHERE id = $1`,
      [withdrawalRequestId],
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].reviewed_at).toBeNull();
    expect(rows[0].admin_note).toBeNull();
  });

  // --------------------------------------------------------------
  it("rolls back declaration_submissions.status AND the mirrored case row when audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const before = await pool.query(
      `SELECT declaration_status FROM cases WHERE id = $1`,
      [caseId],
    );
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/admin/declaration-submissions/${declarationSubmissionId}/status`)
        .set("Authorization", "Bearer t")
        .send({ status: "approved" }),
    );
    expect(res.status).toBe(500);
    const decl = await pool.query(
      `SELECT status, reviewed_at, reviewed_by FROM declaration_submissions WHERE id = $1`,
      [declarationSubmissionId],
    );
    expect(decl.rows[0].status).toBe("submitted");
    expect(decl.rows[0].reviewed_at).toBeNull();
    expect(decl.rows[0].reviewed_by).toBeNull();
    // The case-row mirror must also have rolled back atomically.
    const after = await pool.query(
      `SELECT declaration_status FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(after.rows[0].declaration_status).toBe(before.rows[0].declaration_status);
  });

  // --------------------------------------------------------------
  it("rolls back blocked_ips INSERT when audit insert fails (block)", async () => {
    const app = buildApp((a) => a.use("/api/admin/blocked-ips", blockedIpsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .post("/api/admin/blocked-ips")
        .set("Authorization", "Bearer t")
        .send({ ipAddress: blockedIp, reason: "should not stick" }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT ip_address FROM blocked_ips WHERE ip_address = $1`,
      [blockedIp],
    );
    expect(rows.length).toBe(0);
  });

  it("rolls back blocked_ips DELETE when audit insert fails (unblock)", async () => {
    // Seed a block row first so the unblock has something to delete.
    await pool.query(
      `INSERT INTO blocked_ips (ip_address, reason, blocked_by) VALUES ($1, 'seed', 'seed')
       ON CONFLICT (ip_address) DO NOTHING`,
      [blockedIp],
    );
    const app = buildApp((a) => a.use("/api/admin/blocked-ips", blockedIpsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .delete(`/api/admin/blocked-ips/${blockedIp}`)
        .set("Authorization", "Bearer t"),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT ip_address FROM blocked_ips WHERE ip_address = $1`,
      [blockedIp],
    );
    expect(rows.length).toBe(1);
  });

  // --------------------------------------------------------------
  it("rolls back announcements INSERT when audit insert fails (create)", async () => {
    const app = buildApp((a) => a.use("/api/admin", communicationsRouter));
    const title = `task147-test-create-${randomUUID().slice(0, 8)}`;
    const res = await withFailingAudit(() =>
      request(app)
        .post("/api/admin/announcements")
        .set("Authorization", "Bearer t")
        .send({ title, message: "msg", type: "info", active: true }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT id FROM announcements WHERE title = $1`,
      [title],
    );
    expect(rows.length).toBe(0);
  });

  it("rolls back announcements UPDATE when audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/admin", communicationsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/admin/announcements/${announcementId}`)
        .set("Authorization", "Bearer t")
        .send({ title: "task147-test-mutated" }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT title FROM announcements WHERE id = $1`,
      [announcementId],
    );
    expect(rows[0].title).toBe("task147-test-existing");
  });

  // --------------------------------------------------------------
  // Task #156 — mirror-token redemption was previously a delete-then-
  // best-effort-audit pair (audit failure swallowed), meaning a dropped
  // audit-log insert silently consumed the single-use token with no
  // record. The redeem route now wraps the consume + audit in a single
  // transaction, so an audit failure rolls back the delete and the
  // token remains redeemable for the next attempt.
  it("rolls back admin_mirror_tokens consume when audit insert fails", async () => {
    const mirrorToken = `t156-${randomUUID()}`;
    await pool.query(
      `INSERT INTO admin_mirror_tokens
         (token, case_id, access_code, issued_by, reason, expires_at)
       VALUES ($1, $2, 'AC-156', 'task156-admin', 'integration test mirror redeem',
               now() + interval '2 minutes')`,
      [mirrorToken, caseId],
    );
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .post("/api/admin/cases/redeem-mirror-token")
        .send({ token: mirrorToken }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT token FROM admin_mirror_tokens WHERE token = $1`,
      [mirrorToken],
    );
    expect(rows.length).toBe(1);
  });

  // --------------------------------------------------------------
  // Task #156 — declaration request/regenerate/clear and admin login
  // each previously paired a row mutation with a createAuditLog call
  // that was either swallowed (login) or missing entirely (the three
  // declaration routes). Each pair now commits atomically inside
  // runInTransaction, so a forced audit failure must leave the row
  // unchanged.
  it("rolls back cases.declaration_status when /request-declaration audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const before = await pool.query(
      `SELECT declaration_status, declaration_access_code FROM cases WHERE id = $1`,
      [caseId],
    );
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/admin/cases/${caseId}/request-declaration`)
        .set("Authorization", "Bearer t")
        .send({ sendEmail: false }),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT declaration_status, declaration_access_code, declaration_requested_at
         FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(after.rows[0].declaration_status).toBe(
      before.rows[0].declaration_status,
    );
    expect(after.rows[0].declaration_access_code).toBe(
      before.rows[0].declaration_access_code,
    );
    expect(after.rows[0].declaration_requested_at).toBeNull();
  });

  it("rolls back cases.declaration_access_code when /regenerate-declaration-access-code audit insert fails", async () => {
    // Seed a known (unique) access code so we can compare after the
    // failed call. The column has a uniqueness constraint so we
    // randomise the seed to avoid colliding with prior test rows.
    const seededCode = `t156-${randomUUID().slice(0, 12)}`;
    await pool.query(
      `UPDATE cases SET declaration_access_code = $1 WHERE id = $2`,
      [seededCode, caseId],
    );
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/admin/cases/${caseId}/regenerate-declaration-access-code`)
        .set("Authorization", "Bearer t")
        .send({}),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT declaration_access_code FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(after.rows[0].declaration_access_code).toBe(seededCode);
  });

  it("rolls back cases.declaration_status when /clear-declaration-request audit insert fails", async () => {
    // Seed a non-default declaration state so the rollback assertion is
    // meaningful (the route otherwise sets fields to null/'not_requested').
    await pool.query(
      `UPDATE cases
          SET declaration_status = 'pending',
              declaration_requested_at = now(),
              declaration_requested_by = 'seed-admin'
        WHERE id = $1`,
      [caseId],
    );
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/admin/cases/${caseId}/clear-declaration-request`)
        .set("Authorization", "Bearer t")
        .send({}),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT declaration_status, declaration_requested_at, declaration_requested_by
         FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(after.rows[0].declaration_status).toBe("pending");
    expect(after.rows[0].declaration_requested_at).not.toBeNull();
    expect(after.rows[0].declaration_requested_by).toBe("seed-admin");
  });

  it("rolls back admin_sessions INSERT on /login when audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/admin", adminRouter));
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM admin_sessions WHERE admin_username = $1`,
      [TEST_LOGIN_USERNAME],
    );
    const res = await withFailingAudit(() =>
      request(app)
        .post("/api/admin/login")
        .send({
          username: TEST_LOGIN_USERNAME,
          password: TEST_LOGIN_PASSWORD,
        }),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM admin_sessions WHERE admin_username = $1`,
      [TEST_LOGIN_USERNAME],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // ==============================================================
  // Task #173 — additional surfaces extended into the same rollback
  // pattern. Each test forces `storage.createAuditLog` to throw, hits
  // a route that now wraps its row mutation + audit in
  // runInTransaction, expects a 500, and asserts the underlying row
  // is unchanged in the live Postgres connection.
  // ==============================================================

  it("(#173) rolls back cases.is_disabled when toggle-access audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/cases", casesRouter));
    const before = await pool.query(
      `SELECT is_disabled FROM cases WHERE id = $1`,
      [caseId],
    );
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/toggle-access`)
        .set("Authorization", "Bearer t")
        .send({ disabled: true }),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT is_disabled, force_logout_at FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(after.rows[0].is_disabled).toBe(before.rows[0].is_disabled);
    expect(after.rows[0].force_logout_at).toBeNull();
  });

  it("(#173) rolls back document_requests.status when /:id submission audit insert fails", async () => {
    // Reset the seeded row to a state the PATCH /:id (user submission)
    // endpoint can write to — the seed uses 'submitted' which would be a
    // no-op for the status flip and weaken the rollback assertion.
    await pool.query(
      `UPDATE document_requests
          SET status = 'requested',
              submitted_file_data = NULL,
              submitted_file_name = NULL,
              submitted_at = NULL
        WHERE id = $1`,
      [documentRequestId],
    );
    const app = buildApp((a) =>
      a.use("/api/document-requests", documentRequestsRouter),
    );
    // 1-byte PDF data URL — passes the `validateDocumentDataUrl` check.
    const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQK";
    const res = await withFailingAudit(() =>
      request(app)
        .patch(`/api/document-requests/${documentRequestId}`)
        .set("Authorization", "Bearer t")
        .send({
          submittedFileData: pdfDataUrl,
          submittedFileName: "kyc.pdf",
        }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT status, submitted_at, submitted_file_name
         FROM document_requests WHERE id = $1`,
      [documentRequestId],
    );
    expect(rows[0].status).toBe("requested");
    expect(rows[0].submitted_at).toBeNull();
    expect(rows[0].submitted_file_name).toBeNull();
  });

  it("(#173) rolls back case_ledger_entries INSERT when audit insert fails", async () => {
    const app = buildApp((a) => {
      const router = (express.Router as unknown as () => Router)();
      registerCaseLedgerRoutes(router);
      a.use("/api/cases", router);
    });
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM case_ledger_entries WHERE case_id = $1`,
      [caseId],
    );
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/ledger`)
        .set("Authorization", "Bearer t")
        .send({
          direction: "credit",
          amount: "42.5",
          asset: "USDT",
          userVisible: true,
        }),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM case_ledger_entries WHERE case_id = $1`,
      [caseId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("(#173) rolls back cases.user_balance on /ledger/sync when audit insert fails", async () => {
    // Seed a manual-override balance + a single ledger entry so the
    // sync route has a delta to apply. The rollback should leave the
    // admin-typed balance intact.
    await pool.query(
      `INSERT INTO case_ledger_entries
         (case_id, direction, amount, asset, user_visible, created_by)
       VALUES ($1, 'credit', '100', 'USDT', true, 'seed-admin')`,
      [caseId],
    );
    await pool.query(
      `UPDATE cases
          SET user_balance = '999',
              user_balance_last_synced_total = '0'
        WHERE id = $1`,
      [caseId],
    );
    const app = buildApp((a) => {
      const router = (express.Router as unknown as () => Router)();
      registerCaseLedgerRoutes(router);
      a.use("/api/cases", router);
    });
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/ledger/sync`)
        .set("Authorization", "Bearer t")
        .send({}),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT user_balance, user_balance_last_synced_total
         FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(rows[0].user_balance).toBe("999");
    expect(rows[0].user_balance_last_synced_total).toBe("0");
  });

  it("(#173) rolls back cases.withdrawal_address_submitted when activation /address audit insert fails", async () => {
    // Seed the case at the final stage so the activation route accepts
    // the address submission instead of 403-ing on the stage check.
    await pool.query(
      `UPDATE cases
          SET withdrawal_stage = '14',
              withdrawal_activation_status = 'pending_address',
              withdrawal_security_token_required = false,
              withdrawal_address_submitted = NULL,
              withdrawal_details_asset = NULL,
              withdrawal_details_network = NULL,
              withdrawal_details_amount = NULL
        WHERE id = $1`,
      [caseId],
    );
    const app = buildApp((a) => {
      const router = (express.Router as unknown as () => Router)();
      registerCaseWithdrawalActivationRoutes(router);
      a.use("/api/cases", router);
    });
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/withdrawal-activation/address`)
        .set("Authorization", "Bearer t")
        .send({
          withdrawalAddressSubmitted: "TXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV",
          withdrawalDetailsAsset: "USDT",
          withdrawalDetailsNetwork: "TRC20",
          withdrawalDetailsAmount: "100",
        }),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT withdrawal_address_submitted, withdrawal_details_asset,
              withdrawal_activation_status
         FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(rows[0].withdrawal_address_submitted).toBeNull();
    expect(rows[0].withdrawal_details_asset).toBeNull();
    expect(rows[0].withdrawal_activation_status).toBe("pending_address");
  });

  it("(#173) rolls back stamp_duty_receipts INSERT when audit insert fails", async () => {
    // Make sure the case is in a state the route accepts (enabled +
    // not already approved + not awaiting review).
    await pool.query(
      `UPDATE cases
          SET stamp_duty_enabled = true,
              stamp_duty_status = 'awaiting_upload'
        WHERE id = $1`,
      [caseId],
    );
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM stamp_duty_receipts WHERE case_id = $1`,
      [caseId],
    );
    const app = buildApp((a) => a.use("/api/cases", casesRouter));
    const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQK";
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/stamp-duty/receipts`)
        .set("Authorization", "Bearer t")
        .send({ fileData: pdfDataUrl, fileName: "stamp.pdf" }),
    );
    expect(res.status).toBe(500);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM stamp_duty_receipts WHERE case_id = $1`,
      [caseId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const caseAfter = await pool.query(
      `SELECT stamp_duty_status FROM cases WHERE id = $1`,
      [caseId],
    );
    expect(caseAfter.rows[0].stamp_duty_status).toBe("awaiting_upload");
  });

  it("(#173) rolls back declaration-attachment document_requests INSERT when audit insert fails", async () => {
    // The route requires declarationStatus='pending' + a per-case access
    // code, and a clean declaration_submissions slot for this case so
    // the upstream createDeclarationSubmission insert doesn't trip on
    // any per-case uniqueness assumption introduced later.
    const declAccessCode = `DECL-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `DELETE FROM declaration_submissions WHERE case_id = $1`,
      [caseId],
    );
    await pool.query(
      `UPDATE cases
          SET declaration_status = 'pending',
              declaration_access_code = $2,
              declaration_access_expires_at = NOW() + INTERVAL '1 day',
              sealed_at = NULL
        WHERE id = $1`,
      [caseId, declAccessCode],
    );
    const beforeDocs = await pool.query(
      `SELECT count(*)::int AS n FROM document_requests
        WHERE case_id = $1 AND document_type LIKE 'Declaration:%'`,
      [caseId],
    );
    const app = buildApp((a) => a.use("/api/cases", casesRouter));
    const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQK";
    const res = await withFailingAudit(() =>
      request(app)
        .post(`/api/cases/${caseId}/declaration`)
        .set("Authorization", "Bearer t")
        .send({
          fullName: "Test User",
          email: "integration-test@example.com",
          countryOfResidence: "CH",
          dateOfBirth: "1990-01-01",
          accessCode: declAccessCode,
          notSanctionedJurisdictions: true,
          noSanctionedTransactions: true,
          acknowledgeUsdtNotSupported: true,
          understandFalseInfoConsequences: true,
          sourceOfIncome: "salary",
          monthlyIncome: "5000-10000",
          regulatoryAcknowledgment: true,
          internationalTermsAcknowledged: true,
          processingFeeTxHash: "0xabcdef1234567890",
          signatureFullName: "Test User",
          signatureDate: "2026-01-01",
          declarationAttachments: [
            {
              category: "proof_of_income",
              fileName: "psoi.pdf",
              fileData: pdfDataUrl,
            },
          ],
        }),
    );
    // The route preserves partial-success semantics across the
    // attachment loop (each per-item exception is caught and surfaced
    // in `attachmentFailures`), so the response is 200 even when every
    // attachment audit fails. The rollback guarantee we care about is
    // per-item: the forced audit failure must roll back that item's
    // document_requests INSERT, and the response must surface the
    // failure to the caller instead of silently persisting it.
    expect(res.status).toBe(200);
    expect(res.body.attachmentsCreated).toBe(0);
    expect(Array.isArray(res.body.attachmentFailures)).toBe(true);
    expect(res.body.attachmentFailures.length).toBe(1);
    const afterDocs = await pool.query(
      `SELECT count(*)::int AS n FROM document_requests
        WHERE case_id = $1 AND document_type LIKE 'Declaration:%'`,
      [caseId],
    );
    expect(afterDocs.rows[0].n).toBe(beforeDocs.rows[0].n);
  });

  it("rolls back announcements DELETE when audit insert fails", async () => {
    const app = buildApp((a) => a.use("/api/admin", communicationsRouter));
    const res = await withFailingAudit(() =>
      request(app)
        .delete(`/api/admin/announcements/${announcementId}`)
        .set("Authorization", "Bearer t"),
    );
    expect(res.status).toBe(500);
    const { rows } = await pool.query(
      `SELECT id FROM announcements WHERE id = $1`,
      [announcementId],
    );
    expect(rows.length).toBe(1);
  });
});
