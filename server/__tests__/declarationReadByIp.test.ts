import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Real-DB regression test for storage.getDeclarationReadAttemptsByIp.
// Asserts per-IP rollup, throttle isolation, null-IP exclusion, and
// window cutoff against a live Postgres. Skipped without a DB URL.

const HAS_DB = Boolean(
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
);
const describeIfDb = HAS_DB ? describe : describe.skip;

const RUN_TAG = randomUUID();
const ADMIN_SENTINEL = `test-decl-read-by-ip-${RUN_TAG}`;
const ipFor = (n: number) => `203.0.113.${n}-test-${RUN_TAG}`;
const IP_A = ipFor(1);
const IP_B = ipFor(2);
const IP_C_NULL_TARGET = ipFor(3);
const IP_OUT_OF_WINDOW = ipFor(4);

describeIfDb("storage.getDeclarationReadAttemptsByIp", () => {
  let storage: typeof import("../storage").storage;
  let db: typeof import("../db").db;
  let auditLogs: typeof import("@shared/schema").auditLogs;

  beforeAll(async () => {
    ({ storage } = await import("../storage"));
    ({ db } = await import("../db"));
    ({ auditLogs } = await import("@shared/schema"));

    const now = Date.now();
    const minute = 60_000;

    const row = (
      ipAddress: string | null,
      action: "declaration_read_unauthorized" | "declaration_read_rate_limited",
      offsetMs: number,
      opts: { credentialType?: string | null; targetId?: string | null } = {},
    ) => ({
      adminUsername: ADMIN_SENTINEL,
      action,
      ipAddress,
      targetType: "case",
      targetId: opts.targetId === undefined ? "case-x" : opts.targetId,
      newValue:
        opts.credentialType === undefined
          ? null
          : JSON.stringify({ credentialType: opts.credentialType }),
      createdAt: new Date(now + offsetMs),
    });

    await db.insert(auditLogs).values([
      row(IP_A, "declaration_read_unauthorized", -10 * minute, {
        credentialType: "wrong_code",
        targetId: "case-A1",
      }),
      row(IP_A, "declaration_read_unauthorized", -9 * minute, {
        credentialType: "wrong_code",
        targetId: "case-A1",
      }),
      row(IP_A, "declaration_read_unauthorized", -8 * minute, {
        credentialType: "wrong_code",
        targetId: "case-A2",
      }),
      row(IP_A, "declaration_read_unauthorized", -7 * minute, {
        credentialType: "case_missing",
        targetId: "case-A3",
      }),
      row(IP_A, "declaration_read_unauthorized", -6 * minute, {
        credentialType: "none",
        targetId: "case-A2",
      }),
      row(IP_A, "declaration_read_rate_limited", -2 * minute, {
        credentialType: "wrong_code",
        targetId: "case-A2",
      }),

      row(IP_B, "declaration_read_unauthorized", -20 * minute, {
        credentialType: "expired_code",
        targetId: "case-B1",
      }),
      row(IP_B, "declaration_read_unauthorized", -19 * minute, {
        credentialType: null,
        targetId: "case-B1",
      }),
      row(IP_B, "declaration_read_rate_limited", -90 * minute, {
        targetId: "case-B1",
      }),

      row(IP_C_NULL_TARGET, "declaration_read_unauthorized", -5 * minute, {
        credentialType: "wrong_code",
        targetId: null,
      }),

      row(IP_OUT_OF_WINDOW, "declaration_read_unauthorized", -120 * minute, {
        credentialType: "wrong_code",
        targetId: "case-OOW",
      }),

      row(null, "declaration_read_unauthorized", -3 * minute, {
        credentialType: "wrong_code",
        targetId: "case-NULL",
      }),
    ]);
  });

  afterAll(async () => {
    try {
      await db.execute(
        sql`DELETE FROM audit_logs
            WHERE admin_username = ${ADMIN_SENTINEL}
              AND action IN ('declaration_read_unauthorized', 'declaration_read_rate_limited')`,
      );
    } catch (err) {
      console.error("declarationReadByIp test cleanup failed:", err);
    }
  });

  it("rolls up attempts, distinct cases, and credential types per IP", async () => {
    const since = new Date(Date.now() - 60 * 60_000);
    const throttleSince = new Date(Date.now() - 15 * 60_000);
    const all = await storage.getDeclarationReadAttemptsByIp(
      since,
      throttleSince,
      500,
    );

    const ours = all.filter((r) =>
      r.ipAddress?.endsWith(`-test-${RUN_TAG}`),
    );
    const byIp = new Map(ours.map((r) => [r.ipAddress, r]));

    expect(byIp.has(IP_OUT_OF_WINDOW)).toBe(false);
    expect(byIp.has("unknown")).toBe(false);
    expect(ours.some((r) => r.ipAddress === null)).toBe(false);

    const a = byIp.get(IP_A);
    expect(a).toBeDefined();
    expect(a!.attemptCount).toBe(6);
    expect(a!.unauthorizedCount).toBe(5);
    expect(a!.rateLimitedCount).toBe(1);
    expect(a!.distinctCaseCount).toBe(3);
    expect(new Set(a!.distinctCaseIds)).toEqual(
      new Set(["case-A1", "case-A2", "case-A3"]),
    );
    expect(a!.credentialTypeCounts).toEqual({
      wrong_code: 3,
      case_missing: 1,
      none: 1,
    });
    expect(a!.isThrottled).toBe(true);

    const b = byIp.get(IP_B);
    expect(b).toBeDefined();
    expect(b!.unauthorizedCount).toBe(2);
    expect(b!.attemptCount).toBe(2);
    expect(b!.rateLimitedCount).toBe(0);
    expect(b!.isThrottled).toBe(false);
    expect(b!.credentialTypeCounts).toEqual({
      expired_code: 1,
      unknown: 1,
    });
    expect(b!.distinctCaseCount).toBe(1);
    expect(b!.distinctCaseIds).toEqual(["case-B1"]);

    const c = byIp.get(IP_C_NULL_TARGET);
    expect(c).toBeDefined();
    expect(c!.attemptCount).toBe(1);
    expect(c!.unauthorizedCount).toBe(1);
    expect(c!.distinctCaseCount).toBe(0);
    expect(c!.distinctCaseIds).toEqual([]);
    expect(c!.credentialTypeCounts).toEqual({ wrong_code: 1 });
  });

  it("respects the `since` window — narrowing it drops older rows", async () => {
    const since = new Date(Date.now() - 4 * 60_000);
    const throttleSince = since;
    const all = await storage.getDeclarationReadAttemptsByIp(
      since,
      throttleSince,
      500,
    );
    const ours = all.filter((r) =>
      r.ipAddress?.endsWith(`-test-${RUN_TAG}`),
    );
    const byIp = new Map(ours.map((r) => [r.ipAddress, r]));

    const a = byIp.get(IP_A);
    expect(a).toBeDefined();
    expect(a!.attemptCount).toBe(1);
    expect(a!.unauthorizedCount).toBe(0);
    expect(a!.rateLimitedCount).toBe(1);
    expect(a!.credentialTypeCounts).toEqual({});

    expect(byIp.has(IP_B)).toBe(false);
  });
});
