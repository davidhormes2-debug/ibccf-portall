import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Emergency admin-credential reset (Task #2398)
//
// Covers the self-service recovery path an admin can use without a database
// console: POST /api/admin/emergency-reset/request emails a single-use token
// to ADMIN_RECOVERY_EMAIL, and POST /api/admin/emergency-reset/confirm
// consumes it to set new admin credentials.
//
// ADMIN_RECOVERY_EMAIL is read into a module-level const in server/routes/
// admin.ts (same pattern as ADMIN_USERNAME/ADMIN_PASSWORD), so each scenario
// that needs a different value re-imports the module fresh via
// vi.resetModules() + a dynamic import, rather than mutating process.env
// after the module has already loaded.
// ============================================================================

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "testadmin";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "S0me!StrongPassw0rd#2024";

const appSettings = new Map<string, string>();

const getAppSetting = vi.fn(async (key: string) => {
  const value = appSettings.get(key);
  return value !== undefined ? { key, value, updatedAt: new Date(), updatedBy: "system" } : undefined;
});
const setAppSetting = vi.fn(async (key: string, value: string) => {
  appSettings.set(key, value);
  return { key, value };
});
const createAuditLog = vi.fn(async () => ({ id: 1 }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAppSetting,
    setAppSetting,
    createAuditLog,
    atomicIncrementRateLimit: vi.fn(async ({ windowResetAt }: { windowResetAt: Date }) => ({
      count: 1,
      resetAt: windowResetAt,
    })),
  }),
}));

vi.mock("../static", () => ({
  getBuildStamp: () => "test-build",
  getBootTimeIso: () => new Date().toISOString(),
  serveStaticAssets: vi.fn(),
}));

const sendAdminEmergencyResetEmail = vi.fn(async () => ({ success: true }));
vi.mock("../services/EmailService", () => ({
  emailService: {
    sendAdminEmergencyResetEmail,
  },
}));

async function buildApp(recoveryEmail: string | undefined) {
  vi.resetModules();
  if (recoveryEmail) {
    process.env.ADMIN_RECOVERY_EMAIL = recoveryEmail;
  } else {
    delete process.env.ADMIN_RECOVERY_EMAIL;
  }
  const { adminRouter } = await import("../routes/admin");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

describe("POST /api/admin/emergency-reset/request", () => {
  beforeEach(() => {
    appSettings.clear();
    vi.clearAllMocks();
  });

  it("returns 503 when ADMIN_RECOVERY_EMAIL is not configured", async () => {
    const app = await buildApp(undefined);
    const res = await request(app).post("/api/admin/emergency-reset/request").send({});
    expect(res.status).toBe(503);
    expect(sendAdminEmergencyResetEmail).not.toHaveBeenCalled();
  });

  it("issues a token and emails it when configured, never echoing the token itself", async () => {
    const app = await buildApp("recovery@example.com");
    const res = await request(app).post("/api/admin/emergency-reset/request").send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    expect(sendAdminEmergencyResetEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendAdminEmergencyResetEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe("recovery@example.com");
    expect(emailArgs.resetLink).toContain("/admin/emergency-reset?token=");
    expect(setAppSetting).toHaveBeenCalledWith(
      "admin_emergency_reset_token_hash",
      expect.any(String),
      "system",
    );
  });

  it("window duration is exactly 3 600 000 ms (1 hour) — recovery-flood snapshot guard", async () => {
    // Rationale: emergencyResetRequestLimiter (see server/routes/admin.ts) caps
    // requests at 3 per IP per 1-hour window. Each accepted request sends an
    // email and rewrites the single-use recovery token, so the window bounds
    // worst-case mail-bombing / token-thrash throughput. Quietly shortening
    // the window multiplies the effective attack rate the same way raising
    // the cap would, without any code-review signal. Time is frozen so
    // `windowResetAt` can be asserted for EXACT equality. If you intentionally
    // change the window, update the literal 3_600_000 here in the same commit.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = await buildApp("recovery@example.com");

      const atomicIncrementRateLimit = (await import("../storage")).storage
        .atomicIncrementRateLimit as unknown as import("vitest").Mock;
      atomicIncrementRateLimit.mockClear();

      await request(app).post("/api/admin/emergency-reset/request").send({});

      expect(atomicIncrementRateLimit).toHaveBeenCalledTimes(1);
      const windowResetAt: Date = atomicIncrementRateLimit.mock.calls[0][0].windowResetAt;
      expect(
        windowResetAt.getTime() - fixedNow,
        "admin emergency-reset window must be exactly 3 600 000 ms (1 hour) — raise this assertion if the window is intentionally changed",
      ).toBe(3_600_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/admin/emergency-reset/confirm", () => {
  beforeEach(() => {
    appSettings.clear();
    vi.clearAllMocks();
  });

  async function requestResetAndGetToken(): Promise<{ app: express.Express; token: string }> {
    const app = await buildApp("recovery@example.com");
    await request(app).post("/api/admin/emergency-reset/request").send({});
    const resetLink: string = sendAdminEmergencyResetEmail.mock.calls[0][0].resetLink;
    const url = new URL(resetLink);
    return { app, token: url.searchParams.get("token")! };
  }

  it("rejects a confirm attempt with no pending token", async () => {
    const app = await buildApp("recovery@example.com");
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token: "bogus", newPassword: "AnotherStr0ng!Passw0rd#" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token even when one is pending", async () => {
    const { app } = await requestResetAndGetToken();
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token: "wrong-token", newPassword: "AnotherStr0ng!Passw0rd#" });
    expect(res.status).toBe(401);
  });

  it("rejects a weak new password", async () => {
    const { app, token } = await requestResetAndGetToken();
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "password" });
    expect(res.status).toBe(422);
  });

  it("rejects a trivial new username", async () => {
    const { app, token } = await requestResetAndGetToken();
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "AnotherStr0ng!Passw0rd#", newUsername: "admin" });
    expect(res.status).toBe(422);
    expect(appSettings.get("admin_username_override")).toBeUndefined();
  });

  it("trims leading/trailing whitespace from newUsername before storing the override", async () => {
    // Regression guard: a stray trailing space saved verbatim would make
    // production login's strict-equality username check unsatisfiable via
    // any normal UI input, silently locking the admin out.
    const { app, token } = await requestResetAndGetToken();
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "AnotherStr0ng!Passw0rd#", newUsername: "  spacedadmin  " });
    expect(res.status).toBe(200);
    expect(appSettings.get("admin_username_override")).toBe("spacedadmin");
  });

  it("accepts a valid token + strong password, sets the override, and is single-use", async () => {
    const { app, token } = await requestResetAndGetToken();

    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "AnotherStr0ng!Passw0rd#", newUsername: "newrecoveryadmin" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const storedHash = appSettings.get("admin_password_override");
    expect(storedHash).toBeTruthy();
    expect(await bcrypt.compare("AnotherStr0ng!Passw0rd#", storedHash!)).toBe(true);
    expect(appSettings.get("admin_username_override")).toBe("newrecoveryadmin");

    // Token is consumed — a second confirm with the same token must fail.
    const replay = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "YetAnotherStr0ng!Passw0rd#" });
    expect(replay.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const { app, token } = await requestResetAndGetToken();
    // Force the stored expiry into the past.
    appSettings.set("admin_emergency_reset_token_expires_at", new Date(Date.now() - 1000).toISOString());
    const res = await request(app)
      .post("/api/admin/emergency-reset/confirm")
      .send({ token, newPassword: "AnotherStr0ng!Passw0rd#" });
    expect(res.status).toBe(401);
  });
});
