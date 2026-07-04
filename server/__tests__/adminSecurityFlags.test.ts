import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// GET /api/admin/security-flags — Task #389
//
// The endpoint reads three escape-hatch environment variables and NODE_ENV,
// and returns a flags object that drives the banners rendered in
// AdminDashboard. These tests assert:
//
//   1. Both weakAdminPasswordAllowed and weakAdminUsernameAllowed are true
//      when their corresponding env vars are set to '1', and false otherwise.
//   2. isProduction is true only when NODE_ENV === 'production'.
//   3. The endpoint returns 401 when no valid admin bearer token is supplied.
//   4. Cache-Control: no-store is set so proxies never serve a stale result
//      (e.g. after an operator removes an escape-hatch flag).
// ============================================================================

const ADMIN_TOKEN = "valid-admin-token-for-security-flags-test";

// Set a non-empty password/username before importing the router so the
// module-level const guards (empty string → "not configured") are satisfied.
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "testadmin";
process.env.ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "Str0ng!P@ssw0rdForTests#99";

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-sec-flags",
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
    createAdminSession: vi.fn(async () => ({ token: ADMIN_TOKEN })),
    // security-flags now reads this to resolve the effective username
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

// ── helper: temporarily override one or more env vars for the scope of a test
async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const originals: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    originals[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

afterEach(() => {
  delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
  delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
  delete process.env.ALLOW_WEAK_SESSION_SECRET;
});

describe("GET /api/admin/security-flags — authentication", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(buildApp()).get("/api/admin/security-flags");
    expect(res.status).toBe(401);
  });

  it("returns 401 when a bogus bearer token is supplied", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set("Authorization", "Bearer totally-wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 when a valid bearer token is supplied", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/security-flags — weakAdminPasswordAllowed", () => {
  it("is false when ALLOW_WEAK_ADMIN_PASSWORD is unset", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_PASSWORD: undefined }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakAdminPasswordAllowed).toBe(false);
    });
  });

  it("is false when ALLOW_WEAK_ADMIN_PASSWORD is set to '0'", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_PASSWORD: "0" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.body.weakAdminPasswordAllowed).toBe(false);
    });
  });

  it("is true when ALLOW_WEAK_ADMIN_PASSWORD is set to '1'", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_PASSWORD: "1" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakAdminPasswordAllowed).toBe(true);
    });
  });
});

describe("GET /api/admin/security-flags — weakAdminUsernameAllowed", () => {
  it("is false when ALLOW_WEAK_ADMIN_USERNAME is unset", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_USERNAME: undefined }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakAdminUsernameAllowed).toBe(false);
    });
  });

  it("is false when ALLOW_WEAK_ADMIN_USERNAME is set to '0'", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_USERNAME: "0" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.body.weakAdminUsernameAllowed).toBe(false);
    });
  });

  it("is true when ALLOW_WEAK_ADMIN_USERNAME is set to '1'", async () => {
    await withEnv({ ALLOW_WEAK_ADMIN_USERNAME: "1" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakAdminUsernameAllowed).toBe(true);
    });
  });
});

describe("GET /api/admin/security-flags — isProduction", () => {
  it("is false when NODE_ENV is not 'production'", async () => {
    await withEnv({ NODE_ENV: "test" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.isProduction).toBe(false);
    });
  });

  it("is false when NODE_ENV is 'development'", async () => {
    await withEnv({ NODE_ENV: "development" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.body.isProduction).toBe(false);
    });
  });

  it("is true when NODE_ENV is 'production'", async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.isProduction).toBe(true);
    });
  });
});

describe("GET /api/admin/security-flags — weakSessionSecretAllowed", () => {
  it("is false when ALLOW_WEAK_SESSION_SECRET is unset", async () => {
    await withEnv({ ALLOW_WEAK_SESSION_SECRET: undefined }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakSessionSecretAllowed).toBe(false);
    });
  });

  it("is false when ALLOW_WEAK_SESSION_SECRET is set to '0'", async () => {
    await withEnv({ ALLOW_WEAK_SESSION_SECRET: "0" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.body.weakSessionSecretAllowed).toBe(false);
    });
  });

  it("is true when ALLOW_WEAK_SESSION_SECRET is set to '1'", async () => {
    await withEnv({ ALLOW_WEAK_SESSION_SECRET: "1" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakSessionSecretAllowed).toBe(true);
    });
  });
});

describe("GET /api/admin/security-flags — all three flags active simultaneously", () => {
  it("reports all three flags as true when all three escape-hatch env vars are '1'", async () => {
    await withEnv(
      {
        ALLOW_WEAK_ADMIN_PASSWORD: "1",
        ALLOW_WEAK_ADMIN_USERNAME: "1",
        ALLOW_WEAK_SESSION_SECRET: "1",
      },
      async () => {
        const res = await request(buildApp())
          .get("/api/admin/security-flags")
          .set(authHeader());
        expect(res.status).toBe(200);
        expect(res.body.weakAdminPasswordAllowed).toBe(true);
        expect(res.body.weakAdminUsernameAllowed).toBe(true);
        expect(res.body.weakSessionSecretAllowed).toBe(true);
      },
    );
  });
});

describe("GET /api/admin/security-flags — both flags active simultaneously", () => {
  it("reports both weakAdminPasswordAllowed and weakAdminUsernameAllowed as true when both env vars are '1'", async () => {
    await withEnv(
      { ALLOW_WEAK_ADMIN_PASSWORD: "1", ALLOW_WEAK_ADMIN_USERNAME: "1" },
      async () => {
        const res = await request(buildApp())
          .get("/api/admin/security-flags")
          .set(authHeader());
        expect(res.status).toBe(200);
        expect(res.body.weakAdminPasswordAllowed).toBe(true);
        expect(res.body.weakAdminUsernameAllowed).toBe(true);
      },
    );
  });

  it("reports weakAdminPasswordAllowed true but weakAdminUsernameAllowed false when only the password flag is set", async () => {
    await withEnv(
      {
        ALLOW_WEAK_ADMIN_PASSWORD: "1",
        ALLOW_WEAK_ADMIN_USERNAME: undefined,
      },
      async () => {
        const res = await request(buildApp())
          .get("/api/admin/security-flags")
          .set(authHeader());
        expect(res.body.weakAdminPasswordAllowed).toBe(true);
        expect(res.body.weakAdminUsernameAllowed).toBe(false);
      },
    );
  });

  it("reports weakAdminUsernameAllowed true but weakAdminPasswordAllowed false when only the username flag is set", async () => {
    await withEnv(
      {
        ALLOW_WEAK_ADMIN_PASSWORD: undefined,
        ALLOW_WEAK_ADMIN_USERNAME: "1",
      },
      async () => {
        const res = await request(buildApp())
          .get("/api/admin/security-flags")
          .set(authHeader());
        expect(res.body.weakAdminPasswordAllowed).toBe(false);
        expect(res.body.weakAdminUsernameAllowed).toBe(true);
      },
    );
  });
});

describe("GET /api/admin/security-flags — weakPassword field", () => {
  it("is true when ADMIN_PASSWORD is rated Weak (blocklisted)", async () => {
    await withEnv({ ADMIN_PASSWORD: "admin123" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakPassword).toBe(true);
    });
  });

  it("is true when ADMIN_PASSWORD contains a keyboard-walk diagonal (e.g. 1qaz2wsx)", async () => {
    await withEnv({ ADMIN_PASSWORD: "1qaz2wsx" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakPassword).toBe(true);
    });
  });

  it("is true when ADMIN_PASSWORD contains the qwerty row walk (e.g. Qwerty123!)", async () => {
    await withEnv({ ADMIN_PASSWORD: "Qwerty123!" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.weakPassword).toBe(true);
    });
  });

  it("is false when ADMIN_PASSWORD is strong", async () => {
    await withEnv(
      { ADMIN_PASSWORD: "Str0ng!P@ssw0rdForTests#99" },
      async () => {
        const res = await request(buildApp())
          .get("/api/admin/security-flags")
          .set(authHeader());
        expect(res.status).toBe(200);
        expect(res.body.weakPassword).toBe(false);
      },
    );
  });
});

describe("GET /api/admin/security-flags — response shape and caching", () => {
  it("returns all seven expected keys in the response body", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("weakAdminPasswordAllowed");
    expect(res.body).toHaveProperty("weakAdminUsernameAllowed");
    expect(res.body).toHaveProperty("weakSessionSecretAllowed");
    expect(res.body).toHaveProperty("isProduction");
    expect(res.body).toHaveProperty("adminUsernameTrivial");
    expect(res.body).toHaveProperty("weakPassword");
    expect(res.body).toHaveProperty("adminPasswordStrength");
  });

  it("sets Cache-Control: no-store so proxies never serve a stale result", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});

describe("GET /api/admin/security-flags — adminUsernameTrivial", () => {
  it("is false when ADMIN_USERNAME is a non-trivial value like 'testadmin'", async () => {
    // ADMIN_USERNAME is set to 'testadmin' at the top of this file,
    // and getAppSetting returns null (no DB override), so the env var
    // is used and 'testadmin' is not trivial.
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.adminUsernameTrivial).toBe(false);
  });

  it("is true when the DB username override is a trivial value", async () => {
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockResolvedValueOnce({ value: "root" });
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.adminUsernameTrivial).toBe(true);
  });

  it("is false when the DB username override is a non-trivial value", async () => {
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock.mockResolvedValueOnce({ value: "myUniqueAdminHandle99" });
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.adminUsernameTrivial).toBe(false);
  });
});

describe("GET /api/admin/security-flags — adminPasswordStrength", () => {
  it("is 'Weak' when ADMIN_PASSWORD is a blocklisted value", async () => {
    await withEnv({ ADMIN_PASSWORD: "admin123" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Weak");
    });
  });

  it("is 'Weak' when ADMIN_PASSWORD is too short", async () => {
    await withEnv({ ADMIN_PASSWORD: "abc" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Weak");
    });
  });

  it("is 'Weak' when ADMIN_PASSWORD contains a keyboard-walk segment", async () => {
    await withEnv({ ADMIN_PASSWORD: "1qaz2wsx" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Weak");
    });
  });

  it("is 'Medium' when ADMIN_PASSWORD meets length but lacks full character variety", async () => {
    await withEnv({ ADMIN_PASSWORD: "validpass99" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Medium");
    });
  });

  it("is 'Strong' when ADMIN_PASSWORD is long with upper, lower, digit and special char", async () => {
    await withEnv({ ADMIN_PASSWORD: "Str0ng!P@ssw0rdForTests#99" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Strong");
    });
  });

  it("is one of the three valid strength values for the default test password", async () => {
    const res = await request(buildApp())
      .get("/api/admin/security-flags")
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(["Weak", "Medium", "Strong"]).toContain(res.body.adminPasswordStrength);
  });

  it("uses the stored companion strength when a DB override is active", async () => {
    // Simulate: env var is Medium but admin changed to a Strong override via dashboard.
    // getAppSetting is called twice: first for admin_password_override (returns hash),
    // then for admin_password_override_strength (returns 'Strong').
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    // First call: username override (returns null — no username override)
    // Second call: password override active (hash present)
    // Third call: password override strength companion
    getAppSettingMock
      .mockResolvedValueOnce(null) // admin_username_override
      .mockResolvedValueOnce({ value: "$2b$12$fakehashabcdefghijklmno" }) // admin_password_override
      .mockResolvedValueOnce({ value: "Strong" }); // admin_password_override_strength

    await withEnv({ ADMIN_PASSWORD: "validpass99" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      // Should reflect the stored override strength, not the env var Medium rating.
      expect(res.body.adminPasswordStrength).toBe("Strong");
    });
  });

  it("falls back to env var strength when override is active but companion setting is missing", async () => {
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock
      .mockResolvedValueOnce(null) // admin_username_override
      .mockResolvedValueOnce({ value: "$2b$12$fakehashabcdefghijklmno" }) // admin_password_override active
      .mockResolvedValueOnce(null); // admin_password_override_strength missing

    await withEnv({ ADMIN_PASSWORD: "Str0ng!P@ssw0rdForTests#99" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      // Companion missing → falls back to env var strength.
      expect(res.body.adminPasswordStrength).toBe("Strong");
    });
  });

  it("uses env var strength when no DB override is active", async () => {
    const { storage } = await import("../storage");
    const getAppSettingMock = storage.getAppSetting as ReturnType<typeof vi.fn>;
    getAppSettingMock
      .mockResolvedValueOnce(null) // admin_username_override
      .mockResolvedValueOnce(null); // admin_password_override not set

    await withEnv({ ADMIN_PASSWORD: "validpass99" }, async () => {
      const res = await request(buildApp())
        .get("/api/admin/security-flags")
        .set(authHeader());
      expect(res.status).toBe(200);
      expect(res.body.adminPasswordStrength).toBe("Medium");
    });
  });
});
