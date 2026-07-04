import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Weak-password login block — Task #264
//
// When ADMIN_PASSWORD is set to a value that isAdminPasswordWeak() considers
// dangerous, POST /api/admin/login must return 503 with a clear operator
// message, preventing any login attempt from succeeding.
// ============================================================================

// Set a known-weak password BEFORE the admin router module is loaded so the
// module-level ADMIN_PASSWORD const is also non-empty (which satisfies the
// earlier "not configured" guard) while process.env.ADMIN_PASSWORD remains
// weak for the dynamic check inside the handler.
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "testadmin";
process.env.ADMIN_PASSWORD = "admin123"; // in WEAK_ADMIN_PASSWORDS list

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createAuditLog: vi.fn(async () => ({})),
    getAdminTwoFactor: vi.fn(async () => null),
    createAdminSession: vi.fn(async () => ({ token: "tok" })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAdminSessionByToken: vi.fn(async () => null),
  }),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

// ============================================================================
// validateEnv() — per-reason ADMIN_PASSWORD startup messages (Task #570)
//
// Each of the four PasswordWeakReason branches — too_short, blocklisted,
// keyboard_walk, and repetitive_pattern — must emit a distinct, actionable
// message so operators know exactly what needs to change.
// ============================================================================

describe("validateEnv() — ADMIN_PASSWORD per-reason startup messages", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      SESSION_SECRET: process.env.SESSION_SECRET,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
    };
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ADMIN_USERNAME = "testadmin";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    process.env.SESSION_SECRET =
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    vi.restoreAllMocks();
  });

  function captureWarn(fn: () => void): string[] {
    const msgs: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      msgs.push(args.map(String).join(" "));
    });
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
    return msgs;
  }

  it("too_short: warns that the password is missing or shorter than 8 characters", async () => {
    process.env.ADMIN_PASSWORD = "abc";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /shorter than 8/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("too_short: warning mentions 'ADMIN_PASSWORD' and 'missing' when password is absent", async () => {
    process.env.ADMIN_PASSWORD = "";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /missing/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("blocklisted: warns that the password matches a well-known weak password", async () => {
    process.env.ADMIN_PASSWORD = "admin123";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /well.known weak password/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("blocklisted: warning mentions 'common password list'", async () => {
    process.env.ADMIN_PASSWORD = "Password123";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some((m) => /common password list/i.test(m));
    expect(found).toBe(true);
  });

  it("keyboard_walk: warns that the password contains a common keyboard sequence", async () => {
    // "Qwerty123!" is short enough but contains qwerty (6-char walk segment)
    process.env.ADMIN_PASSWORD = "Qwerty123!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /keyboard/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("keyboard_walk: warning mentions 'keyboard walk' or 'keyboard sequence'", async () => {
    process.env.ADMIN_PASSWORD = "Qwerty123!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some((m) => /keyboard/i.test(m));
    expect(found).toBe(true);
  });

  it("repetitive_pattern: warns about low entropy for a repeated-pattern password", async () => {
    // "abcabcABCABC12!" passes length/character-class checks but Shannon entropy < 3.2
    process.env.ADMIN_PASSWORD = "abcabcABCABC12!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /entropy/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("repetitive_pattern: warning mentions 'repeated character pattern'", async () => {
    process.env.ADMIN_PASSWORD = "abcabcABCABC12!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some((m) => /repeated.character.pattern/i.test(m));
    expect(found).toBe(true);
  });

  it("repetitive_pattern: warning mentions 'Avoid repeating'", async () => {
    process.env.ADMIN_PASSWORD = "abcabcABCABC12!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some((m) => /avoid repeating/i.test(m));
    expect(found).toBe(true);
  });

  it("diagonal_walk: warns when the password contains a number-row diagonal (e.g. 1qaz2wsx)", async () => {
    // "1qaz2wsx" is 8 chars and matches the "1qaz2wsx3edc..." diagonal sequence
    process.env.ADMIN_PASSWORD = "1qaz2wsx";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /keyboard/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("diagonal_walk: warns when the password contains a right-to-left diagonal (e.g. plokij)", async () => {
    // "plokijuh" matches the "plokijuhbygv" right-side diagonal sequence
    process.env.ADMIN_PASSWORD = "plokijuh";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /keyboard/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("diagonal_walk: warns when the password is a mixed-case version of a diagonal walk", async () => {
    // "Qazwsx1!" contains "qazwsx" which is a 6-char diagonal walk segment
    process.env.ADMIN_PASSWORD = "Qazwsx1!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const found = msgs.some(
      (m) =>
        /ADMIN_PASSWORD/i.test(m) &&
        /keyboard/i.test(m),
    );
    expect(found).toBe(true);
  });

  it("emits no warning when the password is strong", async () => {
    process.env.ADMIN_PASSWORD = "Tr0ub4dor&3_Secure!";
    const { validateEnv } = await import("../env");
    const msgs = captureWarn(() => validateEnv());
    const passwordWarned = msgs.some((m) => /ADMIN_PASSWORD/i.test(m));
    expect(passwordWarned).toBe(false);
  });
});

// ============================================================================
// validateEnv() — production escape-hatch flag check
//
// When NODE_ENV=production and any ALLOW_WEAK_* flag is set, validateEnv()
// must call process.exit(1) with a [SECURITY] message listing the flag names.
// In development the same flags must NOT trigger the production exit path.
// ============================================================================

describe("validateEnv() — production escape-hatch flag check", () => {
  let savedEnv: Record<string, string | undefined>;

  // Strong credentials that pass all strength checks so the only possible
  // exit trigger is the production escape-hatch guard.
  const STRONG_PASSWORD = "Tr0ub4dor&3_Secure!";
  const STRONG_USERNAME = "ibccf_ops_9x";
  const STRONG_SESSION_SECRET =
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      SESSION_SECRET: process.env.SESSION_SECRET,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
    };
    // Start each test in production with strong credentials and no flags set.
    process.env.NODE_ENV = "production";
    process.env.ADMIN_PASSWORD = STRONG_PASSWORD;
    process.env.ADMIN_USERNAME = STRONG_USERNAME;
    process.env.SESSION_SECRET = STRONG_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    vi.restoreAllMocks();
  });

  function captureProductionExit(fn: () => void): {
    exitCodes: number[];
    errorMessages: string[];
  } {
    const exitCodes: number[] = [];
    const errorMessages: string[] = [];
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number | string | null) => {
        exitCodes.push(typeof code === "number" ? code : 1);
        return undefined as never;
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorMessages.push(args.map(String).join(" "));
    });
    // Also suppress warn so strength-check warnings don't pollute output.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fn();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
    return { exitCodes, errorMessages };
  }

  it("exits with code 1 and logs [SECURITY] when ALLOW_WEAK_ADMIN_PASSWORD=1 in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes, errorMessages } = captureProductionExit(() =>
      validateEnv(),
    );
    expect(exitCodes).toContain(1);
    const secMsg = errorMessages.find((m) => /\[SECURITY\]/.test(m));
    expect(secMsg).toBeDefined();
    expect(secMsg).toMatch(/ALLOW_WEAK_ADMIN_PASSWORD/);
  });

  it("exits with code 1 and logs [SECURITY] when ALLOW_WEAK_SESSION_SECRET=1 in production", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes, errorMessages } = captureProductionExit(() =>
      validateEnv(),
    );
    expect(exitCodes).toContain(1);
    const secMsg = errorMessages.find((m) => /\[SECURITY\]/.test(m));
    expect(secMsg).toBeDefined();
    expect(secMsg).toMatch(/ALLOW_WEAK_SESSION_SECRET/);
  });

  it("exits with code 1 and logs [SECURITY] when ALLOW_WEAK_ADMIN_USERNAME=1 in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes, errorMessages } = captureProductionExit(() =>
      validateEnv(),
    );
    expect(exitCodes).toContain(1);
    const secMsg = errorMessages.find((m) => /\[SECURITY\]/.test(m));
    expect(secMsg).toBeDefined();
    expect(secMsg).toMatch(/ALLOW_WEAK_ADMIN_USERNAME/);
  });

  it("lists all active flag names when multiple flags are set in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes, errorMessages } = captureProductionExit(() =>
      validateEnv(),
    );
    expect(exitCodes).toContain(1);
    const secMsg = errorMessages.find((m) => /\[SECURITY\]/.test(m));
    expect(secMsg).toBeDefined();
    expect(secMsg).toMatch(/ALLOW_WEAK_ADMIN_PASSWORD/);
    expect(secMsg).toMatch(/ALLOW_WEAK_SESSION_SECRET/);
    expect(secMsg).toMatch(/ALLOW_WEAK_ADMIN_USERNAME/);
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_PASSWORD=1 in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes } = captureProductionExit(() => validateEnv());
    expect(exitCodes).toHaveLength(0);
  });

  it("does NOT exit when ALLOW_WEAK_SESSION_SECRET=1 in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes } = captureProductionExit(() => validateEnv());
    expect(exitCodes).toHaveLength(0);
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_USERNAME=1 in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    const { validateEnv } = await import("../env");
    const { exitCodes } = captureProductionExit(() => validateEnv());
    expect(exitCodes).toHaveLength(0);
  });

  it("does NOT exit in production when no escape-hatch flags are set", async () => {
    const { validateEnv } = await import("../env");
    const { exitCodes } = captureProductionExit(() => validateEnv());
    expect(exitCodes).toHaveLength(0);
  });
});

// ============================================================================
// validateEnv() — production escape-hatch guard source contract
//
// This test reads server/env.ts and asserts that the production escape-hatch
// guard block is structurally present (all three flag checks + the fatal exit).
// If someone removes the guard from the source without touching this test, CI
// will fail immediately — closing the gap where a behavioural-only test suite
// could be silently neutered by deleting both the guard and the tests together.
// ============================================================================

describe("validateEnv() — production escape-hatch guard source contract", () => {
  const ENV_SRC = fs.readFileSync(
    path.resolve(__dirname, "..", "env.ts"),
    "utf8",
  );

  // Locate the guard block by its distinctive opening comment so the slice is
  // anchored to the real syntactic boundary rather than a fixed byte offset.
  const guardStart = ENV_SRC.indexOf("// ESCAPE_HATCH_GUARD_START");
  // The closing brace of the guard block sits just before the closing brace of
  // validateEnv() itself — find the next top-level `}` after guardStart.
  const guardEnd = ENV_SRC.indexOf("\n}", guardStart + 1);
  const guardSrc =
    guardStart !== -1 && guardEnd !== -1
      ? ENV_SRC.slice(guardStart, guardEnd)
      : "";

  it("the guard block is present in server/env.ts (not accidentally deleted)", () => {
    expect(guardStart).toBeGreaterThan(-1);
    // Also assert that the slice is non-empty so a mismatched anchor comment
    // produces an explicit failure here rather than vacuous passes in the six
    // content checks below (an empty string trivially passes every toContain).
    expect(guardSrc.length).toBeGreaterThan(0);
  });

  it("the guard checks ALLOW_WEAK_SESSION_SECRET inside the production block", () => {
    expect(guardSrc).toContain("ALLOW_WEAK_SESSION_SECRET");
  });

  it("the guard checks ALLOW_WEAK_ADMIN_PASSWORD inside the production block", () => {
    expect(guardSrc).toContain("ALLOW_WEAK_ADMIN_PASSWORD");
  });

  it("the guard checks ALLOW_WEAK_ADMIN_USERNAME inside the production block", () => {
    expect(guardSrc).toContain("ALLOW_WEAK_ADMIN_USERNAME");
  });

  it("the guard calls process.exit(1) when a flag is active in production", () => {
    expect(guardSrc).toContain("process.exit(1)");
  });

  it("the guard emits a [SECURITY] message before exiting", () => {
    expect(guardSrc).toContain("[SECURITY]");
  });

  it("the guard is gated on isProduction (not an unconditional exit)", () => {
    expect(guardSrc).toContain("if (isProduction)");
  });
});

describe("POST /api/admin/login — weak password blocks all logins", () => {
  it("returns 503 when ADMIN_PASSWORD is in the weak list", async () => {
    const res = await request(buildApp())
      .post("/api/admin/login")
      .send({ username: "testadmin", password: "admin123" });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/too weak/i);
    expect(res.body.error).toMatch(/rotate ADMIN_PASSWORD/i);
  });

  it("includes the specific weakReason in the 503 body for a blocklisted password", async () => {
    const res = await request(buildApp())
      .post("/api/admin/login")
      .send({ username: "testadmin", password: "admin123" });

    expect(res.status).toBe(503);
    expect(res.body.weakReason).toBe("blocklisted");
  });

  it("includes weakReason 'too_short' when ADMIN_PASSWORD is shorter than 8 characters", async () => {
    const original = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "abc";
    try {
      const res = await request(buildApp())
        .post("/api/admin/login")
        .send({ username: "testadmin", password: "abc" });
      expect(res.status).toBe(503);
      expect(res.body.weakReason).toBe("too_short");
    } finally {
      process.env.ADMIN_PASSWORD = original;
    }
  });

  it("includes weakReason 'keyboard_walk' when ADMIN_PASSWORD is a keyboard sequence", async () => {
    const original = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "Qwerty123!";
    try {
      const res = await request(buildApp())
        .post("/api/admin/login")
        .send({ username: "testadmin", password: "Qwerty123!" });
      expect(res.status).toBe(503);
      expect(res.body.weakReason).toBe("keyboard_walk");
    } finally {
      process.env.ADMIN_PASSWORD = original;
    }
  });

  it("includes weakReason 'repetitive_pattern' when ADMIN_PASSWORD has low entropy", async () => {
    const original = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "abcabcABCABC12!";
    try {
      const res = await request(buildApp())
        .post("/api/admin/login")
        .send({ username: "testadmin", password: "abcabcABCABC12!" });
      expect(res.status).toBe(503);
      expect(res.body.weakReason).toBe("repetitive_pattern");
    } finally {
      process.env.ADMIN_PASSWORD = original;
    }
  });

  it("returns 503 even when credentials are correct but password is weak", async () => {
    const res = await request(buildApp())
      .post("/api/admin/login")
      .send({ username: process.env.ADMIN_USERNAME, password: "admin123" });

    expect(res.status).toBe(503);
  });

  it("returns 503 when an empty password is supplied (also weak)", async () => {
    const original = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    try {
      const res = await request(buildApp())
        .post("/api/admin/login")
        .send({ username: "testadmin", password: "" });
      expect(res.status).toBe(503);
    } finally {
      process.env.ADMIN_PASSWORD = original;
    }
  });
});
