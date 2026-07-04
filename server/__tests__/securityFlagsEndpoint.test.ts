import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// GET /api/admin/security-flags — response shape contract
//
// Asserts that the endpoint always includes all four required boolean fields:
//   weakAdminPasswordAllowed, weakAdminUsernameAllowed,
//   weakSessionSecretAllowed, isProduction
//
// If a future change to the handler drops or renames any of these fields the
// client-side callout guards would silently suppress the banners instead of
// surfacing the regression. This test makes the omission visible at the
// server layer.
// ============================================================================

const ADMIN_TOKEN = "valid-admin-token-security-flags-shape";

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "testadmin";
process.env.ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "Str0ng!P@ssw0rdForTests#99";

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-shape-test",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            adminUsername: process.env.ADMIN_USERNAME ?? "testadmin",
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async () => ({})),
    getAdminTwoFactor: vi.fn(async () => null),
    getAppSetting: vi.fn(async () => null),
  }),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

function authHeader() {
  return { Authorization: `Bearer ${ADMIN_TOKEN}` };
}

describe("GET /api/admin/security-flags — required field contract", () => {
  it("includes weakAdminPasswordAllowed as a boolean", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("weakAdminPasswordAllowed");
    expect(typeof res.body.weakAdminPasswordAllowed).toBe("boolean");
  });

  it("includes weakAdminUsernameAllowed as a boolean", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("weakAdminUsernameAllowed");
    expect(typeof res.body.weakAdminUsernameAllowed).toBe("boolean");
  });

  it("includes weakSessionSecretAllowed as a boolean", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("weakSessionSecretAllowed");
    expect(typeof res.body.weakSessionSecretAllowed).toBe("boolean");
  });

  it("includes isProduction as a boolean", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("isProduction");
    expect(typeof res.body.isProduction).toBe("boolean");
  });

  it("includes all four required boolean fields in a single response", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    const REQUIRED_BOOLEAN_FIELDS = [
      "weakAdminPasswordAllowed",
      "weakAdminUsernameAllowed",
      "weakSessionSecretAllowed",
      "isProduction",
    ] as const;
    for (const field of REQUIRED_BOOLEAN_FIELDS) {
      expect(res.body, `field "${field}" must be present`).toHaveProperty(
        field,
      );
      expect(
        typeof res.body[field],
        `field "${field}" must be a boolean`,
      ).toBe("boolean");
    }
  });
});
