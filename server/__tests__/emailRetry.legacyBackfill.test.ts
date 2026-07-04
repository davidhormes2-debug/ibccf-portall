import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

// Task #172 — Regression coverage for the legacy email-retry safety net.
//
// Two moving pieces have to stay in sync:
//   1. migrations/0016_backfill_email_failed_metadata.sql stamps legacy
//      `email_<tag>_failed` audit rows (recorded before Task #158, so
//      `metadata IS NULL`) with either an unambiguous source-record FK
//      or `{ ambiguous: true }` when there are zero or multiple matches.
//   2. POST /api/cases/:id/email-audit-logs/:auditId/retry refuses
//      ambiguous rows with a 422 so the retry doesn't silently send
//      "latest matching row on the case" — the exact bug Task #158 fixed.
//
// We exercise the migration against a live Postgres for three seeded
// shapes — one match, two matches, zero matches — assert the resulting
// metadata, re-run to prove idempotency, then hit the retry route
// against the ambiguous rows and assert the guard fires.

const TEST_DB_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[emailRetry.legacyBackfill] Skipped: set DATABASE_URL or NEON_DATABASE_URL to exercise migrations/0016 against a real Postgres.",
  );
}

vi.mock("../routes/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/middleware")>();
  return {
    ...actual,
    checkAdminAuth: (req: any, _res: any, next: any) => {
      req.admin = { username: "task172-test-admin" };
      req.adminUsername = "task172-test-admin";
      next();
    },
    isValidAdminToken: async () => true,
  };
});

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })),
    sendComplianceMessageEmail: vi.fn(async () => ({ success: true })),
  }),
}));
vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async () => ({ sent: true })),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

const { casesRouter } = await import("../routes/cases");

const MIGRATION_SQL = readFileSync(
  path.resolve(
    process.cwd(),
    "migrations/0016_backfill_email_failed_metadata.sql",
  ),
  "utf8",
);

let pool: Pool;
let caseAId: string;
let caseBId: string;
let caseCId: string;
let auditAId: number;
let auditBId: number;
let auditCId: number;
let msgAId: number;

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

async function insertCase(client: any): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO cases (id, access_code, status, user_name, user_email)
       VALUES ($1, $2, 'created', 'Task172 User', 'task172@example.com')`,
    [id, `T172-${randomUUID().slice(0, 8)}`],
  );
  return id;
}

async function insertAdminMessage(
  client: any,
  caseId: string,
  body: string,
): Promise<number> {
  const r = await client.query(
    `INSERT INTO admin_messages (case_id, category, title, body)
       VALUES ($1, 'processing', 'task172', $2) RETURNING id`,
    [caseId, body],
  );
  return r.rows[0].id;
}

async function insertNullMetaFailedAudit(
  client: any,
  caseId: string,
): Promise<number> {
  const r = await client.query(
    `INSERT INTO audit_logs (admin_username, action, target_type, target_id, metadata)
       VALUES ('task172-seed', 'email_compliance-message_failed', 'case', $1, NULL)
       RETURNING id`,
    [caseId],
  );
  return r.rows[0].id;
}

describeIfDb("Task #172 — legacy email-retry backfill + ambiguous-row guard", () => {
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
      for (const id of [caseAId, caseBId, caseCId]) {
        if (!id) continue;
        await pool.query(`DELETE FROM audit_logs WHERE target_id = $1`, [id]);
        await pool.query(`DELETE FROM admin_messages WHERE case_id = $1`, [id]);
        await pool.query(`DELETE FROM cases WHERE id = $1`, [id]);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[task-172 cleanup] failed:", err);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Wipe between tests so each `it` starts from the same shape.
      for (const id of [caseAId, caseBId, caseCId]) {
        if (!id) continue;
        await client.query(`DELETE FROM audit_logs WHERE target_id = $1`, [id]);
        await client.query(`DELETE FROM admin_messages WHERE case_id = $1`, [
          id,
        ]);
        await client.query(`DELETE FROM cases WHERE id = $1`, [id]);
      }
      caseAId = await insertCase(client);
      caseBId = await insertCase(client);
      caseCId = await insertCase(client);

      // (a) one source record, one legacy failed audit row.
      msgAId = await insertAdminMessage(client, caseAId, "alpha body");
      auditAId = await insertNullMetaFailedAudit(client, caseAId);

      // (b) two source records, one legacy failed audit row.
      await insertAdminMessage(client, caseBId, "beta one");
      await insertAdminMessage(client, caseBId, "beta two");
      auditBId = await insertNullMetaFailedAudit(client, caseBId);

      // (c) no source records, one legacy failed audit row.
      auditCId = await insertNullMetaFailedAudit(client, caseCId);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  it("backfills metadata: 1 match → FK, 2 matches → ambiguous, 0 matches → ambiguous", async () => {
    await pool.query(MIGRATION_SQL);

    const { rows } = await pool.query(
      `SELECT id, metadata FROM audit_logs WHERE id = ANY($1::int[]) ORDER BY id`,
      [[auditAId, auditBId, auditCId]],
    );
    const byId = new Map<number, any>(rows.map((r) => [r.id, r.metadata]));

    // (a) stamped with the unambiguous FK.
    expect(byId.get(auditAId)).toEqual({
      adminMessageId: msgAId,
      backfilled: true,
    });

    // (b) ambiguous: multiple source records. Task #171 extended the
    // backfill to also stamp the sorted candidate ids so the admin UI
    // can show the operator which rows are in the running.
    expect(byId.get(auditBId)).toEqual({
      ambiguous: true,
      reason: "multiple_source_records",
      backfilled: true,
      candidateIds: expect.arrayContaining([expect.any(Number)]),
    });
    expect(byId.get(auditBId).candidateIds).toHaveLength(2);

    // (c) ambiguous: no source record.
    expect(byId.get(auditCId)).toEqual({
      ambiguous: true,
      reason: "no_source_record",
      backfilled: true,
    });
  });

  it("is idempotent — re-running leaves already-stamped rows untouched", async () => {
    await pool.query(MIGRATION_SQL);
    const first = await pool.query(
      `SELECT id, metadata FROM audit_logs WHERE id = ANY($1::int[]) ORDER BY id`,
      [[auditAId, auditBId, auditCId]],
    );

    // Mutate one row to a sentinel value; the second migration pass must
    // NOT overwrite it because metadata IS NOT NULL anymore.
    await pool.query(
      `UPDATE audit_logs SET metadata = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ sentinel: "do-not-clobber" }), auditAId],
    );

    await pool.query(MIGRATION_SQL);

    const second = await pool.query(
      `SELECT id, metadata FROM audit_logs WHERE id = ANY($1::int[]) ORDER BY id`,
      [[auditAId, auditBId, auditCId]],
    );
    const secondById = new Map<number, any>(
      second.rows.map((r) => [r.id, r.metadata]),
    );

    // Sentinel survived the re-run.
    expect(secondById.get(auditAId)).toEqual({ sentinel: "do-not-clobber" });
    // Ambiguous rows from the first pass are also unchanged.
    const firstById = new Map<number, any>(
      first.rows.map((r) => [r.id, r.metadata]),
    );
    expect(secondById.get(auditBId)).toEqual(firstById.get(auditBId));
    expect(secondById.get(auditCId)).toEqual(firstById.get(auditCId));
  });

  it("POST /retry returns 422 on an ambiguous audit row (multiple_source_records)", async () => {
    await pool.query(MIGRATION_SQL);
    const app = buildApp();
    const res = await request(app)
      .post(`/api/cases/${caseBId}/email-audit-logs/${auditBId}/retry`)
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/predates per-row retry tracking/i);
  });

  it("POST /retry returns 422 on an ambiguous audit row (no_source_record)", async () => {
    await pool.query(MIGRATION_SQL);
    const app = buildApp();
    const res = await request(app)
      .post(`/api/cases/${caseCId}/email-audit-logs/${auditCId}/retry`)
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/predates per-row retry tracking/i);
  });
});
