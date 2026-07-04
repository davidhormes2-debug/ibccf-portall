/**
 * e2e/stage-transition-guard.spec.ts
 *
 * End-to-end regression guards for the sequential stage-transition enforcement
 * introduced in Task #1951.
 *
 * Test 1 — Non-super_admin skip-forward guard:
 *   1. Create a case as super_admin and set its stage to "1" (initial
 *      assignment, no guard fires because previousStage is null).
 *   2. Create a sub-admin with the "admin" role via POST /api/admin-users.
 *   3. Log in as that sub-admin and obtain a bearer token.
 *   4. Attempt PATCH /api/cases/:id with stage "3" (skip from 1 → 3).
 *   5. Assert the server responds with 400 and a message that mentions
 *      sequential transitions.
 *   6. Confirm the case stage was NOT changed by checking via the admin API.
 *
 * Test 2 — super_admin override writes audit log:
 *   1. Create a separate case and set its stage to "1" (as super_admin).
 *   2. PATCH with overrideStageSequence:true and a non-empty overrideReason,
 *      requesting stage "3" — sent as super_admin.
 *   3. Assert the server responds 200.
 *   4. Query the database to confirm an "override_stage_transition" audit-log
 *      row was written for the correct case, with the correct from/to values
 *      and reason embedded in the JSON payload.
 *
 * Data lifecycle
 * ─────────────
 * Each describe block owns one case.  Cases are created in beforeAll and
 * removed in afterAll.  Sub-admin accounts created for Test 1 are also
 * deleted in afterAll.  Random suffixes prevent collisions between parallel
 * CI runs.
 *
 * Relevant source
 * ───────────────
 * - server/services/CaseService.ts    — StageTransitionError + sequence guard
 * - server/routes/cases.ts            — PATCH /:id, catch block, audit log
 * - server/routes/adminUsers.ts       — POST /api/admin-users
 * - server/__tests__/stageTransitionValidation.test.ts — unit/static coverage
 */

import { test, expect, request } from "@playwright/test";
import { Client } from "pg";
import {
  readAdminToken,
  uniqueAccessCode,
  uniqueEmail,
  createCase,
  deleteCase,
  clearAdminRateLimit,
} from "./helpers";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const DATABASE_URL =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a sub-admin account via POST /api/admin-users. Returns the new user id. */
async function createSubAdmin(
  api: import("@playwright/test").APIRequestContext,
  superAdminToken: string,
  username: string,
  password: string,
  role: "admin" | "agent" | "viewer",
): Promise<number> {
  const res = await api.post("/api/admin-users", {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      "Content-Type": "application/json",
    },
    data: { username, password, role },
  });
  expect(res.status(), `create sub-admin '${username}'`).toBe(201);
  const body = await res.json() as { id: number };
  return body.id;
}

/** Delete a sub-admin account via DELETE /api/admin-users/:id. */
async function deleteSubAdmin(
  api: import("@playwright/test").APIRequestContext,
  superAdminToken: string,
  userId: number,
): Promise<void> {
  await api.delete(`/api/admin-users/${userId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
}

/**
 * Log in as a sub-admin (or any admin) via POST /api/admin/login and return
 * the bearer token.
 */
async function loginAsAdmin(
  api: import("@playwright/test").APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await api.post("/api/admin/login", {
    data: { username, password },
  });
  expect(res.status(), `login as '${username}'`).toBe(200);
  const body = await res.json() as { token: string };
  return body.token;
}

/**
 * PATCH /api/cases/:id with the given stage (and optional override fields).
 * Returns the raw Playwright response so callers can assert on status codes
 * that are NOT 2xx without triggering an expect failure inside this helper.
 */
async function patchCaseStage(
  api: import("@playwright/test").APIRequestContext,
  adminToken: string,
  caseId: string,
  stage: string,
  overrideOptions?: { overrideStageSequence: boolean; overrideReason: string },
): Promise<import("@playwright/test").APIResponse> {
  return api.patch(`/api/cases/${caseId}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    data: {
      stage,
      ...(overrideOptions ?? {}),
    },
  });
}

/**
 * Query the audit_logs table for an override_stage_transition row for the
 * given case.  Returns the first matching row or null.
 */
async function findOverrideAuditLog(
  databaseUrl: string,
  caseId: string,
): Promise<{ newValue: string } | null> {
  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const result = await pg.query<{ new_value: string }>(
      `SELECT new_value
         FROM audit_logs
        WHERE action = 'override_stage_transition'
          AND target_type = 'case'
          AND target_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [caseId],
    );
    if (result.rows.length === 0) return null;
    return { newValue: result.rows[0].new_value };
  } finally {
    await pg.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — non-super_admin receives 400 when attempting to skip a stage
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Stage transition guard — non-super_admin skip blocked (real server)", () => {
  let accessCode: string;
  let caseId: string;
  let superAdminToken: string;
  let subAdminUsername: string;
  let subAdminPassword: string;
  let subAdminId: number;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the stage-transition guard E2E tests",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    const api = await request.newContext({ baseURL });
    try {
      superAdminToken = readAdminToken();

      // Create a case with no stage initially.
      accessCode = uniqueAccessCode("E2ESTAGE");
      caseId = await createCase(api, superAdminToken, accessCode, {
        userName: "Stage Guard E2E — Non-Super Admin",
      });

      // Set initial stage to "1". Because previousStage is null the guard
      // does not fire — this is the initial-assignment exemption.
      const stageRes = await patchCaseStage(api, superAdminToken, caseId, "1");
      expect(
        stageRes.status(),
        "set initial stage to 1 (initial assignment, no guard)",
      ).toBe(200);

      // Create a sub-admin with the "admin" role.  The env-var admin cannot
      // be registered as a sub-admin, so we use a distinct username.
      subAdminUsername = `e2e-subadmin-${uniqueAccessCode("sa").toLowerCase()}`;
      subAdminPassword = "SubAdminPass1!";
      subAdminId = await createSubAdmin(
        api,
        superAdminToken,
        subAdminUsername,
        subAdminPassword,
        "admin",
      );
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    try {
      if (subAdminId) {
        await deleteSubAdmin(api, superAdminToken, subAdminId);
      }
      if (caseId) {
        await deleteCase(api, superAdminToken, caseId);
      }
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "PATCH /api/cases/:id returns 400 when a non-super_admin attempts to skip from stage 1 to stage 3",
    async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        // ── Step 1: obtain a bearer token for the sub-admin ───────────────
        const subAdminToken = await loginAsAdmin(
          api,
          subAdminUsername,
          subAdminPassword,
        );

        // ── Step 2: attempt to skip forward from 1 → 3 ───────────────────
        //
        // nextNum (3) !== prevNum + 1 (2) triggers the sequence guard.
        // The sub-admin does not have super_admin role so the override is
        // refused.  The server returns 400 with a message that mentions
        // sequential transitions.
        const patchRes = await patchCaseStage(
          api,
          subAdminToken,
          caseId,
          "3",
        );

        expect(
          patchRes.status(),
          "skip-forward stage change must be rejected with 400",
        ).toBe(400);

        const body = await patchRes.json() as { error?: string };
        expect(
          body.error ?? "",
          "error message must mention sequential transitions",
        ).toContain("sequential");

        // ── Step 3: confirm the case stage was NOT changed ────────────────
        //
        // The guard must abort the transaction before any DB write, so the
        // case stage should still be "1".
        const caseRes = await api.get(`/api/cases/${caseId}`, {
          headers: { Authorization: `Bearer ${superAdminToken}` },
        });
        expect(caseRes.status(), "fetch case after failed skip").toBe(200);
        const caseBody = await caseRes.json() as { stage?: string };
        expect(
          caseBody.stage,
          "case stage must remain at 1 after rejected skip attempt",
        ).toBe("1");
      } finally {
        await api.dispose();
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — super_admin override writes override_stage_transition audit log
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Stage transition guard — super_admin override accepted + audit log (real server)", () => {
  let accessCode: string;
  let caseId: string;
  let superAdminToken: string;

  test.beforeAll(async ({ baseURL }) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set to run the stage-transition override E2E tests",
      );
    }
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL (or NEON_DATABASE_URL) must be set to verify the override_stage_transition audit log",
      );
    }

    if (DATABASE_URL) {
      await clearAdminRateLimit(DATABASE_URL);
    }

    const api = await request.newContext({ baseURL });
    try {
      superAdminToken = readAdminToken();

      // Create a fresh case.
      accessCode = uniqueAccessCode("E2EOVRD");
      caseId = await createCase(api, superAdminToken, accessCode, {
        userName: "Stage Override E2E — Super Admin",
      });

      // Set initial stage to "1" (initial assignment, guard exempt).
      const stageRes = await patchCaseStage(api, superAdminToken, caseId, "1");
      expect(
        stageRes.status(),
        "set initial stage to 1 (initial assignment, no guard)",
      ).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async ({ baseURL }) => {
    if (!caseId) return;
    const api = await request.newContext({ baseURL });
    try {
      await deleteCase(api, superAdminToken, caseId);
    } finally {
      await api.dispose();
    }
  });

  test.setTimeout(120_000);

  test(
    "super_admin can skip stages with overrideStageSequence and the override_stage_transition audit log is written",
    async ({ baseURL }) => {
      const api = await request.newContext({ baseURL });
      try {
        const overrideReason = "E2E test override — fast-track to stage 3";

        // ── Step 1: super_admin overrides the sequence guard ──────────────
        //
        // overrideStageSequence:true + non-empty overrideReason allow the
        // super_admin to move from stage 1 directly to stage 3.
        const patchRes = await patchCaseStage(
          api,
          superAdminToken,
          caseId,
          "3",
          { overrideStageSequence: true, overrideReason },
        );

        expect(
          patchRes.status(),
          "super_admin override must be accepted with 200",
        ).toBe(200);

        // ── Step 2: confirm the case stage was updated ────────────────────
        const caseRes = await api.get(`/api/cases/${caseId}`, {
          headers: { Authorization: `Bearer ${superAdminToken}` },
        });
        expect(caseRes.status(), "fetch case after override").toBe(200);
        const caseBody = await caseRes.json() as { stage?: string };
        expect(
          caseBody.stage,
          "case stage must be updated to 3 after super_admin override",
        ).toBe("3");

        // ── Step 3: verify the audit log row was written ──────────────────
        //
        // The route writes an override_stage_transition row inside the same
        // DB transaction so it must be present immediately after the 200 response.
        const auditRow = await findOverrideAuditLog(DATABASE_URL, caseId);
        expect(
          auditRow,
          "override_stage_transition audit log row must exist for this case",
        ).not.toBeNull();

        // The newValue JSON must contain from, to, adminRole, and reason.
        const payload = JSON.parse(auditRow!.newValue) as {
          from?: number;
          to?: number;
          adminRole?: string;
          reason?: string;
        };
        expect(payload.from, "audit log from must be 1").toBe(1);
        expect(payload.to, "audit log to must be 3").toBe(3);
        expect(
          payload.adminRole,
          "audit log adminRole must be super_admin",
        ).toBe("super_admin");
        expect(
          payload.reason,
          "audit log reason must match the override reason sent",
        ).toBe(overrideReason);
      } finally {
        await api.dispose();
      }
    },
  );
});
