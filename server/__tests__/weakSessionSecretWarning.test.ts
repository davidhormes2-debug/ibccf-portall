import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import { type ProcessExitMock, createProcessExitMock } from "./testHelpers";

/**
 * Flush enough microtask ticks to drain the full async chain inside
 * emitStartupSecurityWarnings: createAuditLog() → .catch() →
 * Promise.allSettled() → .then(() => process.exit(1)).
 * A single Promise.resolve() only covers one tick, which is not enough.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ============================================================================
// Weak-session-secret warning — Task #390
//
// Pins two behaviours introduced in Task #356:
//
//   1. GET /api/admin/security-flags returns weakSessionSecretAllowed: true
//      when ALLOW_WEAK_SESSION_SECRET=1 is set in the environment.
//
//   2. emitStartupSecurityWarnings() — called from the server listen callback
//      via server/startupWarnings.ts — writes a security_config_warning audit
//      row with the expected newValue string when both NODE_ENV=production and
//      ALLOW_WEAK_SESSION_SECRET=1 are present, plus a consolidated
//      security_escape_hatch_flags_in_production row listing all active flags.
//
// The client-side banner rendering is tested separately in
// client/src/components/admin/__tests__/WeakSessionSecretBanner.test.tsx.
// ============================================================================

// ---------------------------------------------------------------------------
// Part 1 — GET /api/admin/security-flags
// ---------------------------------------------------------------------------

// Force-set ADMIN_USERNAME to a known value so isValidAdminToken can match
// the session returned by the mock. Using `||` is unsafe when other test
// files in the same worker have already set a different value.
const TEST_ADMIN_USERNAME = "ibccf_security_flags_test_admin";
const _savedAdminUsername = process.env.ADMIN_USERNAME;
process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
process.env.ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "Str0ng!Pass#word99";

const ADMIN_TOKEN = "test-admin-session-token-security-flags";

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === "test-admin-session-token-security-flags"
        ? {
            id: "session-security-flags-1",
            adminUsername: "ibccf_security_flags_test_admin",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async () => ({})),
  }),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

describe("GET /api/admin/security-flags — weakSessionSecretAllowed field", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      NODE_ENV: process.env.NODE_ENV,
    };
  });

  afterEach(() => {
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET =
        savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
  });

  it("returns weakSessionSecretAllowed: true when ALLOW_WEAK_SESSION_SECRET=1", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakSessionSecretAllowed).toBe(true);
  });

  it("returns weakSessionSecretAllowed: false when ALLOW_WEAK_SESSION_SECRET is not set", async () => {
    delete process.env.ALLOW_WEAK_SESSION_SECRET;

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakSessionSecretAllowed).toBe(false);
  });

  it("returns weakSessionSecretAllowed: false when ALLOW_WEAK_SESSION_SECRET is 'true' (only '1' is accepted)", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "true";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakSessionSecretAllowed).toBe(false);
  });

  it("returns isProduction: true alongside the flag when NODE_ENV=production", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.NODE_ENV = "production";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakSessionSecretAllowed).toBe(true);
    expect(res.body.isProduction).toBe(true);
  });

  it("requires a valid admin bearer token (returns 401 without auth)", async () => {
    const res = await request(buildApp()).get("/api/admin/security-flags");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — emitStartupSecurityWarnings() startup audit row
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — startup audit log for ALLOW_WEAK_SESSION_SECRET", () => {
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ProcessExitMock;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExit = createProcessExitMock();
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET =
        savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    warnSpy.mockRestore();
  });

  it("writes a security_config_warning audit row when NODE_ENV=production and ALLOW_WEAK_SESSION_SECRET=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUsername: "system",
        action: "security_config_warning",
        targetType: "server",
        newValue:
          "ALLOW_WEAK_SESSION_SECRET=1 is active in a production deployment",
      }),
    );
  });

  it("writes a consolidated security_escape_hatch_flags_in_production audit row listing active flags", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUsername: "system",
        action: "security_escape_hatch_flags_in_production",
        targetType: "server",
        targetId: null,
        previousValue: null,
        ipAddress: null,
        userAgent: null,
      }),
    );

    const consolidatedCall = (createAuditLog.mock.calls as unknown[][]).find(
      ([entry]) =>
        (entry as AuditLogEntry).action ===
        "security_escape_hatch_flags_in_production",
    );
    expect(consolidatedCall).toBeDefined();
    const parsed = JSON.parse(
      (consolidatedCall![0] as AuditLogEntry).newValue!,
    );
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_SESSION_SECRET");
    expect(parsed.allowWeakSessionSecret).toBe(true);
    expect(parsed.allowWeakAdminPassword).toBe(false);
    expect(parsed.allowWeakAdminUsername).toBe(false);
  });

  it("writes two audit rows total (one per-flag + one consolidated) when only one flag is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("emits a console.warn when NODE_ENV=production and ALLOW_WEAK_SESSION_SECRET=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const mockStorage = { createAuditLog: vi.fn(async () => ({})) };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    expect(warnSpy).toHaveBeenCalled();
    const warnMessage: string = (warnSpy.mock.calls[0] as string[])[0];
    expect(warnMessage).toContain("ALLOW_WEAK_SESSION_SECRET=1");
    expect(warnMessage).toContain("production");

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();
  });

  it("does NOT write an audit row when ALLOW_WEAK_SESSION_SECRET is absent", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("also writes a security_config_warning audit row when NODE_ENV is not production (every-boot behavior)", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security_config_warning",
        newValue:
          "ALLOW_WEAK_SESSION_SECRET=1 is active in a production deployment",
      }),
    );
  });

  it("does NOT write an audit row when ALLOW_WEAK_SESSION_SECRET='true' (only '1' is accepted)", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "true";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("audit row has null targetId, previousValue, ipAddress, and userAgent", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: null,
        previousValue: null,
        ipAddress: null,
        userAgent: null,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 3 — emitStartupSecurityWarnings() startup audit row for ALLOW_WEAK_ADMIN_PASSWORD
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — startup audit log for ALLOW_WEAK_ADMIN_PASSWORD", () => {
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ProcessExitMock;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExit = createProcessExitMock();
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
  });

  afterEach(() => {
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    warnSpy.mockRestore();
  });

  it("writes a security_config_warning audit row when NODE_ENV=production and ALLOW_WEAK_ADMIN_PASSWORD=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUsername: "system",
        action: "security_config_warning",
        targetType: "server",
        newValue:
          "ALLOW_WEAK_ADMIN_PASSWORD=1 is active in a production deployment",
      }),
    );
  });

  it("writes a consolidated security_escape_hatch_flags_in_production audit row listing active flags", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    const consolidatedCall = (createAuditLog.mock.calls as unknown[][]).find(
      ([entry]) =>
        (entry as AuditLogEntry).action ===
        "security_escape_hatch_flags_in_production",
    );
    expect(consolidatedCall).toBeDefined();
    const parsed = JSON.parse(
      (consolidatedCall![0] as AuditLogEntry).newValue!,
    );
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_ADMIN_PASSWORD");
    expect(parsed.allowWeakAdminPassword).toBe(true);
    expect(parsed.allowWeakSessionSecret).toBe(false);
    expect(parsed.allowWeakAdminUsername).toBe(false);
  });

  it("writes two audit rows total (one per-flag + one consolidated) when only one flag is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("emits a console.warn when NODE_ENV=production and ALLOW_WEAK_ADMIN_PASSWORD=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const mockStorage = { createAuditLog: vi.fn(async () => ({})) };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    expect(warnSpy).toHaveBeenCalled();
    const warnMessage: string = (warnSpy.mock.calls[0] as string[])[0];
    expect(warnMessage).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    expect(warnMessage).toContain("production");

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();
  });

  it("does NOT write an audit row when ALLOW_WEAK_ADMIN_PASSWORD is absent", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("also writes a security_config_warning audit row when NODE_ENV is not production (every-boot behavior)", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security_config_warning",
        newValue:
          "ALLOW_WEAK_ADMIN_PASSWORD=1 is active in a production deployment",
      }),
    );
  });

  it("audit row has null targetId, previousValue, ipAddress, and userAgent", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: null,
        previousValue: null,
        ipAddress: null,
        userAgent: null,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 4 — emitStartupSecurityWarnings() startup audit row for ALLOW_WEAK_ADMIN_USERNAME
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — startup audit log for ALLOW_WEAK_ADMIN_USERNAME", () => {
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ProcessExitMock;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExit = createProcessExitMock();
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
  });

  afterEach(() => {
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    warnSpy.mockRestore();
  });

  it("writes a security_config_warning audit row when NODE_ENV=production and ALLOW_WEAK_ADMIN_USERNAME=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUsername: "system",
        action: "security_config_warning",
        targetType: "server",
        newValue:
          "ALLOW_WEAK_ADMIN_USERNAME=1 is active in a production deployment",
      }),
    );
  });

  it("writes a consolidated security_escape_hatch_flags_in_production audit row listing active flags", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    const consolidatedCall = (createAuditLog.mock.calls as unknown[][]).find(
      ([entry]) =>
        (entry as AuditLogEntry).action ===
        "security_escape_hatch_flags_in_production",
    );
    expect(consolidatedCall).toBeDefined();
    const parsed = JSON.parse(
      (consolidatedCall![0] as AuditLogEntry).newValue!,
    );
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_ADMIN_USERNAME");
    expect(parsed.allowWeakAdminUsername).toBe(true);
    expect(parsed.allowWeakSessionSecret).toBe(false);
    expect(parsed.allowWeakAdminPassword).toBe(false);
  });

  it("writes two audit rows total (one per-flag + one consolidated) when only one flag is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while mockExit is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("emits a console.warn when NODE_ENV=production and ALLOW_WEAK_ADMIN_USERNAME=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const mockStorage = { createAuditLog: vi.fn(async () => ({})) };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    expect(warnSpy).toHaveBeenCalled();
    const warnMessage: string = (warnSpy.mock.calls[0] as string[])[0];
    expect(warnMessage).toContain("ALLOW_WEAK_ADMIN_USERNAME=1");
    expect(warnMessage).toContain("production");

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();
  });

  it("does NOT write an audit row when ALLOW_WEAK_ADMIN_USERNAME is absent", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("also writes a security_config_warning audit row when NODE_ENV is not production (every-boot behavior)", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security_config_warning",
        newValue:
          "ALLOW_WEAK_ADMIN_USERNAME=1 is active in a production deployment",
      }),
    );
  });

  it("audit row has null targetId, previousValue, ipAddress, and userAgent", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage, mockExit);

    // Flush the full async chain so process.exit fires while exitSpy is live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: null,
        previousValue: null,
        ipAddress: null,
        userAgent: null,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 5 — guard test: all three flags absent → zero audit calls in production
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — silent when no escape-hatch flags are set", () => {
  let savedEnv: Record<string, string | undefined>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
    };
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
  });

  afterEach(() => {
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    vi.restoreAllMocks();
  });

  it("calls createAuditLog zero times in production when all three escape-hatch flags are absent", async () => {
    process.env.NODE_ENV = "production";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("calls createAuditLog zero times in production when flags are set to values other than '1'", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "0";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "false";
    process.env.ALLOW_WEAK_SESSION_SECRET = "true";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);

    await Promise.resolve();

    expect(createAuditLog).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part 6 — every-boot guarantee: no deduplication across repeated calls
//
// emitStartupSecurityWarnings() is a pure function with no internal state.
// Calling it N times (simulating N server reboots) must produce N audit rows
// per active flag — there must be no "seen-once" deduplication mechanism.
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — every-boot guarantee (Task #668)", () => {
  let savedEnv: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
  });

  afterEach(() => {
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    vi.restoreAllMocks();
  });

  it("writes four audit rows when called twice in production (2 per-flag + 2 consolidated, no deduplication)", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);
    await flushMicrotasks();

    emitStartupSecurityWarnings(mockStorage);
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(4);
  });

  it("writes two audit rows when called twice (no deduplication) — development", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);
    await flushMicrotasks();

    emitStartupSecurityWarnings(mockStorage);
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(2);
  });

  it("emits a console.warn on every call in development when flag is active", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";

    const mockStorage = { createAuditLog: vi.fn(async () => ({})) };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);
    emitStartupSecurityWarnings(mockStorage);

    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of warnSpy.mock.calls) {
      expect((call as string[])[0]).toContain("ALLOW_WEAK_ADMIN_PASSWORD=1");
    }
  });

  it("does NOT call process.exit in development even when flag is active", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const mockStorage = { createAuditLog: vi.fn(async () => ({})) };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);
    await flushMicrotasks();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part 7 — consolidated row when multiple flags are active simultaneously
// ---------------------------------------------------------------------------

describe("emitStartupSecurityWarnings — consolidated row with multiple flags active", () => {
  let savedEnv: Record<string, string | undefined>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
  });

  afterEach(() => {
    if (savedEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
    if (savedEnv.ALLOW_WEAK_SESSION_SECRET === undefined) {
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
    } else {
      process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_PASSWORD === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    } else {
      process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    }
    if (savedEnv.ALLOW_WEAK_ADMIN_USERNAME === undefined) {
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    } else {
      process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    }
    vi.restoreAllMocks();
  });

  it("writes four audit rows (three per-flag + one consolidated) when all three flags are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);

    // Flush the full async chain so exitSpy is called while it is still live.
    await flushMicrotasks();

    expect(createAuditLog).toHaveBeenCalledTimes(4);
  });

  it("consolidated row lists all three active flags in newValue when all flags are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";

    const createAuditLog = vi.fn(async (_entry?: unknown) => ({}));
    const mockStorage = { createAuditLog };

    const { emitStartupSecurityWarnings } = await import("../startupWarnings");
    emitStartupSecurityWarnings(mockStorage);

    // Flush the full async chain so exitSpy is called while it is still live.
    await flushMicrotasks();

    const consolidatedCall = (createAuditLog.mock.calls as unknown[][]).find(
      ([entry]) =>
        (entry as AuditLogEntry).action ===
        "security_escape_hatch_flags_in_production",
    );
    expect(consolidatedCall).toBeDefined();
    const parsed = JSON.parse(
      (consolidatedCall![0] as AuditLogEntry).newValue!,
    );
    expect(parsed.activeFlags).toHaveLength(3);
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_ADMIN_PASSWORD");
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_SESSION_SECRET");
    expect(parsed.activeFlags).toContain("ALLOW_WEAK_ADMIN_USERNAME");
    expect(parsed.allowWeakAdminPassword).toBe(true);
    expect(parsed.allowWeakSessionSecret).toBe(true);
    expect(parsed.allowWeakAdminUsername).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Part 5 — GET /api/admin/security-flags weakPassword flag (Task #643)
//
// The security-flags endpoint now also exposes `weakPassword: boolean` which
// is true when the ADMIN_PASSWORD env var itself is rated Weak by the shared
// strength checker — catching keyboard-walk passwords set before the walk
// check was introduced.
// ---------------------------------------------------------------------------

describe("GET /api/admin/security-flags — weakPassword flag (diagonal-walk passwords)", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    };
  });

  afterEach(() => {
    if (savedEnv.ADMIN_PASSWORD === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = savedEnv.ADMIN_PASSWORD;
    }
    vi.restoreAllMocks();
  });

  it("returns weakPassword: true when ADMIN_PASSWORD is a diagonal keyboard walk (1qaz2wsx)", async () => {
    process.env.ADMIN_PASSWORD = "1qaz2wsx";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakPassword).toBe(true);
  });

  it("returns weakPassword: true when ADMIN_PASSWORD is a qwerty-row walk with mixed case (Qwerty123!)", async () => {
    process.env.ADMIN_PASSWORD = "Qwerty123!";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakPassword).toBe(true);
  });

  it("returns weakPassword: true when ADMIN_PASSWORD is a right-side diagonal walk (Plokijuh!)", async () => {
    // "plokijuh" (first 8 chars of "plokijuhbygv") is a known diagonal sequence
    process.env.ADMIN_PASSWORD = "Plokijuh!";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakPassword).toBe(true);
  });

  it("returns weakPassword: false when ADMIN_PASSWORD is strong", async () => {
    process.env.ADMIN_PASSWORD = "Str0ng!Pass#word99";

    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.weakPassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type helper used in tests above
// ---------------------------------------------------------------------------

type AuditLogEntry = {
  adminUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  previousValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};
