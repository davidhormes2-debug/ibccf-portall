import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateEnv,
  isSessionSecretWeak,
  getSessionSecretWeakReason,
  WEAK_SESSION_SECRETS,
  isAdminUsernameTrivial,
  getAdminUsernameTrivialReason,
  TRIVIAL_ADMIN_USERNAMES,
  KEYBOARD_WALK_SEQUENCES,
} from "./env";
import { isAdminPasswordWeak } from "@shared/passwordStrength";
import { emitStartupSecurityWarnings } from "./startupWarnings";

// ============================================================================
// getSessionSecretWeakReason — unit tests
// ============================================================================

describe("getSessionSecretWeakReason", () => {
  it("returns 'too_short' for undefined (missing)", () => {
    expect(getSessionSecretWeakReason(undefined)).toBe("too_short");
  });

  it("returns 'too_short' for empty string", () => {
    expect(getSessionSecretWeakReason("")).toBe("too_short");
  });

  it("returns 'too_short' for a secret shorter than 32 characters", () => {
    expect(getSessionSecretWeakReason("tooshort")).toBe("too_short");
    expect(getSessionSecretWeakReason("a".repeat(31))).toBe("too_short");
  });

  it("returns 'blocklisted' for long values on the blocklist (>= 32 chars, so too_short is cleared first)", () => {
    // These are exactly 32 chars and appear in INSECURE_SESSION_SECRET_VALUES
    expect(getSessionSecretWeakReason("12345678901234567890123456789012")).toBe("blocklisted");
    expect(getSessionSecretWeakReason("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("blocklisted");
    // Longer blocklisted placeholder (38 chars)
    expect(getSessionSecretWeakReason("a-very-long-random-string-here-32+chars")).toBe("blocklisted");
  });

  it("returns 'blocklisted' for case-insensitive blocklist matches (long values that pass length check)", () => {
    // These are >= 32 chars so the too_short check passes; they must then be caught by the blocklist
    expect(getSessionSecretWeakReason("A-VERY-LONG-RANDOM-STRING-HERE-32+CHARS")).toBe("blocklisted");
    expect(getSessionSecretWeakReason("REPLACE-ME-WITH-A-REAL-SECRET-KEY")).toBe("blocklisted");
  });

  it("returns 'low_entropy' for a 32-char repeated-pattern string not in the blocklist", () => {
    // 'b' repeated — not in INSECURE_SESSION_SECRET_VALUES
    expect(getSessionSecretWeakReason("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe("low_entropy");
  });

  it("returns 'low_entropy' for a qwerty keyboard-walk string", () => {
    expect(getSessionSecretWeakReason("qwertyuiopqwertyuiopqwertyuiopqw")).toBe("low_entropy");
  });

  it("returns 'low_entropy' for a cycling numeric pattern", () => {
    expect(getSessionSecretWeakReason("12345123451234512345123451234512")).toBe("low_entropy");
  });

  it("returns null for a strong 32-character secret", () => {
    expect(getSessionSecretWeakReason("X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo")).toBeNull();
  });

  it("returns null for a 64-char hex string (openssl rand -hex 32 output)", () => {
    expect(
      getSessionSecretWeakReason(
        "a3f1c2b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
      ),
    ).toBeNull();
  });
});

describe("WEAK_SESSION_SECRETS × isSessionSecretWeak sync", () => {
  it("flags every entry in WEAK_SESSION_SECRETS as weak", () => {
    const notFlagged: string[] = [];
    for (const s of WEAK_SESSION_SECRETS) {
      if (!isSessionSecretWeak(s)) {
        notFlagged.push(s);
      }
    }
    expect(notFlagged).toEqual([]);
  });
});

describe("isSessionSecretWeak", () => {
  it("returns true for undefined (missing)", () => {
    expect(isSessionSecretWeak(undefined)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isSessionSecretWeak("")).toBe(true);
  });

  it("returns true for a secret shorter than 32 characters", () => {
    expect(isSessionSecretWeak("tooshort")).toBe(true);
    expect(isSessionSecretWeak("a".repeat(31))).toBe(true);
  });

  it("returns true for a 32-character secret on the blocklist", () => {
    expect(isSessionSecretWeak("12345678901234567890123456789012")).toBe(true);
    expect(isSessionSecretWeak("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
  });

  it("returns false for a strong 32-character secret not on the blocklist", () => {
    expect(isSessionSecretWeak("X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo")).toBe(false);
  });

  it("returns false for a 64-character hex string (openssl rand -hex 32 output)", () => {
    expect(
      isSessionSecretWeak(
        "a3f1c2b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
      ),
    ).toBe(false);
  });
});

describe("validateEnv — SESSION_SECRET", () => {
  const STRONG_PASSWORD = "Str0ng!Pass#word99";
  const STRONG_USERNAME = "ibccf_superuser_x9";

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      SESSION_SECRET: process.env.SESSION_SECRET,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.ADMIN_PASSWORD = STRONG_PASSWORD;
    process.env.ADMIN_USERNAME = STRONG_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SESSION_SECRET = savedEnv.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = savedEnv.ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = savedEnv.ADMIN_USERNAME;
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
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    vi.restoreAllMocks();
  });

  it("exits with code 1 when SESSION_SECRET is absent", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SESSION_SECRET is shorter than 32 characters", () => {
    process.env.SESSION_SECRET = "tooshort";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SESSION_SECRET matches a known-insecure value", () => {
    process.env.SESSION_SECRET = "supersecret";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SESSION_SECRET is a 32-char blocklisted string", () => {
    process.env.SESSION_SECRET = "12345678901234567890123456789012";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs to stderr (console.error) when fatally rejecting a weak secret", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_SESSION_SECRET=1 and secret is absent", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_SESSION_SECRET=1 and secret is too short", () => {
    process.env.SESSION_SECRET = "weak";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("logs a warning (not error) when escape hatch is active", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when SESSION_SECRET is a strong 32+ char secret", () => {
    process.env.SESSION_SECRET = "X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit for a 64-char hex string produced by openssl rand -hex 32", () => {
    process.env.SESSION_SECRET =
      "a3f1c2b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits even when ALLOW_WEAK_SESSION_SECRET=1 and NODE_ENV=production", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT warn when escape hatch is ignored in production", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits in production even when secret is too short and escape hatch is set", () => {
    process.env.SESSION_SECRET = "weak";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when ALLOW_WEAK_SESSION_SECRET is 'true' (only '1' is accepted)", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "true";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when ALLOW_WEAK_SESSION_SECRET is 'yes' (only '1' is accepted)", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "yes";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when ALLOW_WEAK_SESSION_SECRET is '0' (only '1' is accepted)", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "0";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("error message includes the [SECURITY] prefix", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SECURITY]"),
    );
  });

  it("warning message includes the [SECURITY] prefix when escape hatch is active", () => {
    delete process.env.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SECURITY]"),
    );
  });

  it("rejects a 31-character secret (one below minimum) but accepts a 32-character strong secret", () => {
    process.env.SESSION_SECRET = "x".repeat(31);
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledTimes(1);

    exitSpy.mockClear();

    process.env.SESSION_SECRET = "xK9#mQpLt2@WzRvNdYeAjHcBsFoGiUl7";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("error message mentions 'missing or shorter than 32 characters' when secret is absent", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or shorter than 32 characters"),
    );
  });

  it("error message mentions 'missing or shorter than 32 characters' when secret is too short", () => {
    process.env.SESSION_SECRET = "tooshort";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or shorter than 32 characters"),
    );
  });

  it("error message mentions 'known-insecure placeholder' when secret is blocklisted", () => {
    // Must be >= 32 chars so the too_short check passes and the blocklist check fires
    process.env.SESSION_SECRET = "a-very-long-random-string-here-32+chars";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("known-insecure placeholder value"),
    );
  });

  it("error message mentions 'entropy is too low' when secret is a repeated pattern", () => {
    // 'b' repeated 32 times — not in blocklist, long enough, but low entropy
    process.env.SESSION_SECRET = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("entropy is too low"),
    );
  });

  it("error message mentions 'entropy is too low' when secret is a keyboard walk", () => {
    process.env.SESSION_SECRET = "qwertyuiopqwertyuiopqwertyuiopqw";
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("entropy is too low"),
    );
  });

  it("error message includes 'openssl rand -hex 32' as the example fix for all failure reasons", () => {
    const scenarios: [string, string | undefined][] = [
      ["too_short — absent", undefined],
      ["too_short — too short", "tooshort"],
      ["blocklisted", "supersecret"],
      ["low_entropy — repeated", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    ];

    for (const [_label, secretVal] of scenarios) {
      errorSpy.mockClear();
      if (secretVal === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = secretVal;
      }
      delete process.env.ALLOW_WEAK_SESSION_SECRET;
      validateEnv();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("openssl rand -hex 32"),
      );
    }
  });

  it("warning message includes the reason-specific detail when escape hatch is active for blocklisted secret", () => {
    // Must be >= 32 chars so the blocklist check fires rather than too_short
    process.env.SESSION_SECRET = "a-very-long-random-string-here-32+chars";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("known-insecure placeholder value"),
    );
  });

  it("warning message includes the reason-specific detail when escape hatch is active for low-entropy secret", () => {
    process.env.SESSION_SECRET = "qwertyuiopqwertyuiopqwertyuiopqw";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("entropy is too low"),
    );
  });
});

describe("validateEnv — ADMIN_PASSWORD", () => {
  const STRONG_SECRET = "X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo";
  const STRONG_PASSWORD = "Str0ng!Pass#word99";
  const STRONG_USERNAME = "ibccf_superuser_x9";

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      SESSION_SECRET: process.env.SESSION_SECRET,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.SESSION_SECRET = STRONG_SECRET;
    process.env.ADMIN_USERNAME = STRONG_USERNAME;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SESSION_SECRET = savedEnv.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = savedEnv.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = savedEnv.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    vi.restoreAllMocks();
  });

  it("exits with code 1 when ADMIN_PASSWORD is absent", () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_PASSWORD is empty string", () => {
    process.env.ADMIN_PASSWORD = "";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_PASSWORD is too short (< 8 chars)", () => {
    process.env.ADMIN_PASSWORD = "short";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_PASSWORD matches a known-weak value", () => {
    process.env.ADMIN_PASSWORD = "password123";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_PASSWORD is 'admin'", () => {
    process.env.ADMIN_PASSWORD = "admin";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs to stderr (console.error) when fatally rejecting a weak password", () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_PASSWORD=1 and password is absent", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_PASSWORD=1 and password is weak", () => {
    process.env.ADMIN_PASSWORD = "password";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("logs a warning (not error) when escape hatch is active", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ADMIN_PASSWORD is strong", () => {
    process.env.ADMIN_PASSWORD = STRONG_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("isAdminPasswordWeak agrees with validateEnv on weak passwords", () => {
    expect(isAdminPasswordWeak("admin")).toBe(true);
    expect(isAdminPasswordWeak("password123")).toBe(true);
    expect(isAdminPasswordWeak("")).toBe(true);
    expect(isAdminPasswordWeak(STRONG_PASSWORD)).toBe(false);
  });

  // ── Number-row diagonal walks in passwords ──────────────────────────────
  // Task #639: the same alternating number+letter sequences that are blocked
  // in usernames must also be rejected by the password strength checker when
  // they appear as a substring of an otherwise varied password.
  // MIN_PASSWORD_WALK_LENGTH is 6, so a walk substring must be at least 6 chars
  // to trigger the keyboard-walk gate. Each case below uses a walk segment of
  // exactly 6 or more characters from a number-row diagonal sequence, embedded
  // within an otherwise varied password that exceeds 8 characters in total.
  it.each([
    // Forward L→R (seq A): 1q2w3e4r5t6y7u8i9o0p — 6-char walk embedded
    ["1q2w3e!Sec", "seq-A 6-char prefix in password"],
    // Longer substring of seq A
    ["1q2w3e4r!Abc", "longer seq-A substring embedded in password"],
    // Reverse of seq A: p0o9i8u7y6t5r4e3w2q1 — 6-char walk embedded
    ["p0o9i8!Secure", "reverse seq-A 6-char start in password"],
    // Forward R→L (seq B): 0p9o8i7u6y5t4r3e2w1q — 6-char walk embedded
    ["0p9o8i!Secure", "seq-B 6-char prefix in password"],
    // Reverse of seq B: q1w2e3r4t5y6u7i8o9p0 — 6-char walk embedded
    ["q1w2e3!Secure", "reverse seq-B 6-char prefix in password"],
    // Walk appearing mid-password rather than at the start
    ["X!z1q2w3e4r", "seq-A substring mid-password"],
  ])(
    "isAdminPasswordWeak returns true for password containing number-row diagonal walk: %s (%s)",
    (password) => {
      expect(isAdminPasswordWeak(password)).toBe(true);
    },
  );

  it("isAdminPasswordWeak returns false for strong password not containing a number-row diagonal walk", () => {
    expect(isAdminPasswordWeak("X7#mQpLt2@WzR")).toBe(false);
  });

  it("exits even when ALLOW_WEAK_ADMIN_PASSWORD=1 and NODE_ENV=production", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT warn when ADMIN_PASSWORD escape hatch is ignored in production", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits in production even when password is weak and escape hatch is set", () => {
    process.env.ADMIN_PASSWORD = "password";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("error message mentions 'missing or empty' when ADMIN_PASSWORD is absent", () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty"),
    );
  });

  it("error message mentions 'missing or empty' when ADMIN_PASSWORD is empty string", () => {
    process.env.ADMIN_PASSWORD = "";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty"),
    );
  });

  it("error message mentions 'too short' when ADMIN_PASSWORD is fewer than 8 characters", () => {
    process.env.ADMIN_PASSWORD = "short";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("too short"),
    );
  });

  it("error message mentions 'fewer than 8 characters' when ADMIN_PASSWORD is too short", () => {
    process.env.ADMIN_PASSWORD = "short";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("fewer than 8 characters"),
    );
  });

  it("error message mentions 'well-known weak password' when ADMIN_PASSWORD is blocklisted", () => {
    process.env.ADMIN_PASSWORD = "password123";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("well-known weak password"),
    );
  });

  it("error message mentions 'keyboard-walk sequence' when ADMIN_PASSWORD contains a keyboard walk", () => {
    process.env.ADMIN_PASSWORD = "qwertyuiop123";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("keyboard-walk sequence"),
    );
  });

  it("error message mentions 'entropy is too low' when ADMIN_PASSWORD is a repeated pattern", () => {
    process.env.ADMIN_PASSWORD = "abcabcABCABCABC";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("entropy is too low"),
    );
  });

  it("error message includes the [SECURITY] prefix for every failure reason", () => {
    const scenarios: [string, string | undefined][] = [
      ["missing — absent", undefined],
      ["missing — empty", ""],
      ["too_short", "short"],
      ["blocklisted", "password123"],
      ["keyboard_walk", "qwertyuiop123"],
      ["repetitive_pattern", "abcabcABCABCABC"],
    ];

    for (const [_label, passwordVal] of scenarios) {
      errorSpy.mockClear();
      if (passwordVal === undefined) {
        delete process.env.ADMIN_PASSWORD;
      } else {
        process.env.ADMIN_PASSWORD = passwordVal;
      }
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
      validateEnv();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SECURITY]"),
      );
    }
  });

  it("error message includes 'openssl rand -base64 16' as the example fix for all failure reasons", () => {
    const scenarios: [string, string | undefined][] = [
      ["missing — absent", undefined],
      ["missing — empty", ""],
      ["too_short", "short"],
      ["blocklisted", "password123"],
      ["keyboard_walk", "qwertyuiop123"],
      ["repetitive_pattern", "abcabcABCABCABC"],
    ];

    for (const [_label, passwordVal] of scenarios) {
      errorSpy.mockClear();
      if (passwordVal === undefined) {
        delete process.env.ADMIN_PASSWORD;
      } else {
        process.env.ADMIN_PASSWORD = passwordVal;
      }
      delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
      validateEnv();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("openssl rand -base64 16"),
      );
    }
  });

  it("warning message includes 'missing or empty' when escape hatch is active and password is absent", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty"),
    );
  });

  it("warning message includes 'well-known weak password' when escape hatch is active and password is blocklisted", () => {
    process.env.ADMIN_PASSWORD = "password123";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("well-known weak password"),
    );
  });

  it("warning message includes 'keyboard-walk sequence' when escape hatch is active and password is a keyboard walk", () => {
    process.env.ADMIN_PASSWORD = "qwertyuiop123";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("keyboard-walk sequence"),
    );
  });

  it("warning message includes 'entropy is too low' when escape hatch is active and password is repetitive", () => {
    process.env.ADMIN_PASSWORD = "abcabcABCABCABC";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("entropy is too low"),
    );
  });
});

describe("TRIVIAL_ADMIN_USERNAMES × isAdminUsernameTrivial sync", () => {
  it("flags every entry in TRIVIAL_ADMIN_USERNAMES as trivial", () => {
    const notFlagged: string[] = [];
    for (const u of TRIVIAL_ADMIN_USERNAMES) {
      if (!isAdminUsernameTrivial(u)) {
        notFlagged.push(u);
      }
    }
    expect(notFlagged).toEqual([]);
  });
});

describe("isAdminUsernameTrivial", () => {
  it("returns true for undefined (missing)", () => {
    expect(isAdminUsernameTrivial(undefined)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isAdminUsernameTrivial("")).toBe(true);
  });

  it("returns true for 'admin'", () => {
    expect(isAdminUsernameTrivial("admin")).toBe(true);
  });

  it("returns true for 'ADMIN' (case-insensitive)", () => {
    expect(isAdminUsernameTrivial("ADMIN")).toBe(true);
  });

  it("returns true for 'Administrator' (mixed case)", () => {
    expect(isAdminUsernameTrivial("Administrator")).toBe(true);
  });

  it("returns true for 'root'", () => {
    expect(isAdminUsernameTrivial("root")).toBe(true);
  });

  it("returns true for 'user'", () => {
    expect(isAdminUsernameTrivial("user")).toBe(true);
  });

  it("returns false for a unique, non-trivial username", () => {
    expect(isAdminUsernameTrivial("ibccf_superuser_x9")).toBe(false);
  });

  it("returns false for a username that starts with a blocklisted word but is longer", () => {
    expect(isAdminUsernameTrivial("admin_ibccf_9x")).toBe(false);
  });

  it("returns true for a username shorter than 4 characters", () => {
    expect(isAdminUsernameTrivial("a")).toBe(true);
    expect(isAdminUsernameTrivial("ab")).toBe(true);
    expect(isAdminUsernameTrivial("abc")).toBe(true);
  });

  it("returns false for a 4-character non-trivial username (boundary)", () => {
    expect(isAdminUsernameTrivial("zxq7")).toBe(false);
  });

  it("returns true for a purely numeric username", () => {
    expect(isAdminUsernameTrivial("1234")).toBe(true);
    expect(isAdminUsernameTrivial("000000")).toBe(true);
    expect(isAdminUsernameTrivial("987654321")).toBe(true);
  });

  it("returns false for an alphanumeric username containing digits", () => {
    expect(isAdminUsernameTrivial("user1234x")).toBe(false);
  });

  it("returns true for a single repeated character (aaaa)", () => {
    expect(isAdminUsernameTrivial("aaaa")).toBe(true);
  });

  it("returns true for a single repeated character (xxxxxx)", () => {
    expect(isAdminUsernameTrivial("xxxxxx")).toBe(true);
  });

  it("returns true for a single repeated character (ZZZZ, case-insensitive)", () => {
    expect(isAdminUsernameTrivial("ZZZZ")).toBe(true);
  });

  it("returns true for a keyboard walk (qwerty)", () => {
    expect(isAdminUsernameTrivial("qwerty")).toBe(true);
  });

  it("returns true for a keyboard walk (asdf)", () => {
    expect(isAdminUsernameTrivial("asdf")).toBe(true);
  });

  it("returns true for a keyboard walk (zxcv)", () => {
    expect(isAdminUsernameTrivial("zxcv")).toBe(true);
  });

  it("returns true for a keyboard walk (qwertyuiop)", () => {
    expect(isAdminUsernameTrivial("qwertyuiop")).toBe(true);
  });

  it("returns true for a keyboard walk (asdfghjkl)", () => {
    expect(isAdminUsernameTrivial("asdfghjkl")).toBe(true);
  });

  it("returns true for a keyboard walk (zxcvbnm)", () => {
    expect(isAdminUsernameTrivial("zxcvbnm")).toBe(true);
  });

  it("returns true for a reverse keyboard walk (ytrewq)", () => {
    expect(isAdminUsernameTrivial("ytrewq")).toBe(true);
  });

  it("returns true for a reverse keyboard walk (fdsa)", () => {
    expect(isAdminUsernameTrivial("fdsa")).toBe(true);
  });

  it("returns true for a keyboard walk (QWERTY, case-insensitive)", () => {
    expect(isAdminUsernameTrivial("QWERTY")).toBe(true);
  });

  it("returns true for a sequential alphabet walk (abcd)", () => {
    expect(isAdminUsernameTrivial("abcd")).toBe(true);
  });

  it("returns true for a sequential alphabet walk (abcdefgh)", () => {
    expect(isAdminUsernameTrivial("abcdefgh")).toBe(true);
  });

  it("returns false for a non-walk username that happens to contain walk chars mixed with others", () => {
    expect(isAdminUsernameTrivial("qw9rt_x7")).toBe(false);
  });

  it("returns true for a diagonal keyboard walk (qazw)", () => {
    expect(isAdminUsernameTrivial("qazw")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (qazwsx)", () => {
    expect(isAdminUsernameTrivial("qazwsx")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (edcr)", () => {
    expect(isAdminUsernameTrivial("edcr")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (edcrfv)", () => {
    expect(isAdminUsernameTrivial("edcrfv")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (rfvt)", () => {
    expect(isAdminUsernameTrivial("rfvt")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (tgby)", () => {
    expect(isAdminUsernameTrivial("tgby")).toBe(true);
  });

  it("returns true for a reverse diagonal keyboard walk (xswz)", () => {
    expect(isAdminUsernameTrivial("xswz")).toBe(true);
  });

  it("returns true for a reverse diagonal keyboard walk (vfrc)", () => {
    expect(isAdminUsernameTrivial("vfrc")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (1qaz)", () => {
    expect(isAdminUsernameTrivial("1qaz")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (1qaz2wsx)", () => {
    expect(isAdminUsernameTrivial("1qaz2wsx")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (2wsx3edc)", () => {
    expect(isAdminUsernameTrivial("2wsx3edc")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (plok)", () => {
    expect(isAdminUsernameTrivial("plok")).toBe(true);
  });

  it("returns true for a diagonal keyboard walk (plokij)", () => {
    expect(isAdminUsernameTrivial("plokij")).toBe(true);
  });

  it("returns true for a reverse diagonal keyboard walk (koplm)", () => {
    expect(isAdminUsernameTrivial("kolp")).toBe(true);
  });

  // ── Number-row-only diagonal walks ──────────────────────────────────────
  // Alternating number-row key + the letter directly below it, covering all
  // four directions produced by the two sequences and their reverses.
  it.each([
    // Forward left-to-right (seq A): 1→q, 2→w, 3→e …
    ["1q2w", "number-row diagonal L→R start"],
    ["2w3e", "number-row diagonal L→R mid"],
    ["8i9o", "number-row diagonal L→R near end"],
    ["9o0p", "number-row diagonal L→R end"],
    ["1q2w3e4r", "longer number-row diagonal L→R"],
    // Reverse of seq A: p→0, o→9, i→8 …
    ["p0o9", "number-row diagonal R→L (reverse of seq A) start"],
    ["o9i8", "number-row diagonal R→L mid"],
    ["e3w2", "number-row diagonal R→L near start"],
    // Forward right-to-left (seq B): 0→p, 9→o, 8→i …
    ["0p9o", "number-row diagonal R→L (seq B) start"],
    ["9o8i", "number-row diagonal R→L mid (seq B)"],
    ["2w1q", "number-row diagonal R→L end (seq B)"],
    ["0p9o8i7u", "longer number-row diagonal R→L"],
    // Reverse of seq B: q→1, w→2, e→3 …
    ["q1w2", "number-row diagonal L→R (reverse of seq B) start"],
    ["w2e3", "number-row diagonal L→R mid (reverse of seq B)"],
    ["o9p0", "number-row diagonal L→R end (reverse of seq B)"],
  ])("returns true for number-row diagonal walk %s (%s)", (walk) => {
    expect(isAdminUsernameTrivial(walk)).toBe(true);
  });

  it.each([
    ["1q2w", "keyboard_walk"],
    ["0p9o", "keyboard_walk"],
    ["q1w2", "keyboard_walk"],
    ["p0o9", "keyboard_walk"],
  ] as Array<[string, string]>)(
    "getAdminUsernameTrivialReason returns keyboard_walk for number-row diagonal %s",
    (walk, expected) => {
      expect(getAdminUsernameTrivialReason(walk)).toBe(expected);
    },
  );

  it("KEYBOARD_WALK_SEQUENCES — every sequence of >= 4 chars flags as trivial", () => {
    const notFlagged: string[] = [];
    for (const seq of KEYBOARD_WALK_SEQUENCES) {
      for (let start = 0; start <= seq.length - 4; start++) {
        const sub = seq.slice(start, start + 4);
        if (!isAdminUsernameTrivial(sub)) {
          notFlagged.push(sub);
        }
      }
    }
    expect(notFlagged).toEqual([]);
  });
});

// ============================================================================
// getAdminUsernameTrivialReason — unit tests
// ============================================================================

describe("getAdminUsernameTrivialReason", () => {
  it("returns 'missing' for undefined (absent)", () => {
    expect(getAdminUsernameTrivialReason(undefined)).toBe("missing");
  });

  it("returns 'missing' for empty string", () => {
    expect(getAdminUsernameTrivialReason("")).toBe("missing");
  });

  it("returns 'too_short' for a username shorter than 4 characters", () => {
    expect(getAdminUsernameTrivialReason("a")).toBe("too_short");
    expect(getAdminUsernameTrivialReason("ab")).toBe("too_short");
    expect(getAdminUsernameTrivialReason("abc")).toBe("too_short");
  });

  it("returns 'purely_numeric' for a username consisting entirely of digits", () => {
    expect(getAdminUsernameTrivialReason("1234")).toBe("purely_numeric");
    expect(getAdminUsernameTrivialReason("000000")).toBe("purely_numeric");
    expect(getAdminUsernameTrivialReason("987654321")).toBe("purely_numeric");
  });

  it("returns 'blocklisted' for a username in TRIVIAL_ADMIN_USERNAMES", () => {
    expect(getAdminUsernameTrivialReason("admin")).toBe("blocklisted");
    expect(getAdminUsernameTrivialReason("root")).toBe("blocklisted");
    expect(getAdminUsernameTrivialReason("user")).toBe("blocklisted");
    expect(getAdminUsernameTrivialReason("administrator")).toBe("blocklisted");
  });

  it("returns 'blocklisted' for case-insensitive blocklist matches", () => {
    expect(getAdminUsernameTrivialReason("ADMIN")).toBe("blocklisted");
    expect(getAdminUsernameTrivialReason("Admin")).toBe("blocklisted");
  });

  it("returns 'repeated_char' for a username consisting of a single repeated character", () => {
    expect(getAdminUsernameTrivialReason("aaaa")).toBe("repeated_char");
    expect(getAdminUsernameTrivialReason("xxxxxx")).toBe("repeated_char");
    expect(getAdminUsernameTrivialReason("ZZZZ")).toBe("repeated_char");
  });

  it("returns 'keyboard_walk' for a common keyboard-walk sequence", () => {
    expect(getAdminUsernameTrivialReason("qwerty")).toBe("keyboard_walk");
    expect(getAdminUsernameTrivialReason("asdf")).toBe("keyboard_walk");
    expect(getAdminUsernameTrivialReason("zxcv")).toBe("keyboard_walk");
    expect(getAdminUsernameTrivialReason("ytrewq")).toBe("keyboard_walk");
  });

  it("returns null for a strong, non-trivial username", () => {
    expect(getAdminUsernameTrivialReason("ibccf_superuser_x9")).toBeNull();
    expect(getAdminUsernameTrivialReason("zxq7")).toBeNull();
    expect(getAdminUsernameTrivialReason("admin_ibccf_9x")).toBeNull();
  });

  it("agrees with isAdminUsernameTrivial on every case", () => {
    const cases = [
      undefined,
      "",
      "a",
      "abc",
      "1234",
      "admin",
      "ADMIN",
      "aaaa",
      "qwerty",
      "ibccf_superuser_x9",
      "zxq7",
    ];
    for (const username of cases) {
      const reason = getAdminUsernameTrivialReason(username);
      expect(isAdminUsernameTrivial(username)).toBe(reason !== null);
    }
  });
});

describe("validateEnv — ADMIN_USERNAME", () => {
  const STRONG_SECRET = "X7#mQpLt2@WzKjR9dNvYsB4eCgHuFqAo";
  const STRONG_PASSWORD = "Str0ng!Pass#word99";
  const STRONG_USERNAME = "ibccf_superuser_x9";

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      SESSION_SECRET: process.env.SESSION_SECRET,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.SESSION_SECRET = STRONG_SECRET;
    process.env.ADMIN_PASSWORD = STRONG_PASSWORD;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.SESSION_SECRET = savedEnv.SESSION_SECRET;
    process.env.ALLOW_WEAK_SESSION_SECRET = savedEnv.ALLOW_WEAK_SESSION_SECRET;
    process.env.ADMIN_PASSWORD = savedEnv.ADMIN_PASSWORD;
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = savedEnv.ALLOW_WEAK_ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = savedEnv.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = savedEnv.ALLOW_WEAK_ADMIN_USERNAME;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    vi.restoreAllMocks();
  });

  it("exits with code 1 when ADMIN_USERNAME is absent", () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is empty string", () => {
    process.env.ADMIN_USERNAME = "";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is 'admin'", () => {
    process.env.ADMIN_USERNAME = "admin";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is 'user'", () => {
    process.env.ADMIN_USERNAME = "user";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is 'root'", () => {
    process.env.ADMIN_USERNAME = "root";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is 'administrator'", () => {
    process.env.ADMIN_USERNAME = "administrator";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is 'ADMIN' (case-insensitive)", () => {
    process.env.ADMIN_USERNAME = "ADMIN";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs to stderr (console.error) when fatally rejecting a trivial username", () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_USERNAME=1 and username is absent", () => {
    delete process.env.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ALLOW_WEAK_ADMIN_USERNAME=1 and username is trivial", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("logs a warning (not error) when escape hatch is active", () => {
    delete process.env.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT exit when ADMIN_USERNAME is a strong, non-trivial value", () => {
    process.env.ADMIN_USERNAME = STRONG_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("exits even when ALLOW_WEAK_ADMIN_USERNAME=1 and NODE_ENV=production", () => {
    delete process.env.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT warn when ADMIN_USERNAME escape hatch is ignored in production", () => {
    delete process.env.ADMIN_USERNAME;
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits in production even when username is trivial and escape hatch is set", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    process.env.NODE_ENV = "production";
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is shorter than 4 characters", () => {
    process.env.ADMIN_USERNAME = "abc";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when ADMIN_USERNAME is purely numeric", () => {
    process.env.ADMIN_USERNAME = "12345";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("error message mentions 'missing or empty' when username is absent", () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty"),
    );
  });

  it("error message mentions 'missing or empty' when username is empty string", () => {
    process.env.ADMIN_USERNAME = "";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing or empty"),
    );
  });

  it("error message mentions the minimum length requirement", () => {
    process.env.ADMIN_USERNAME = "abc";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("4 characters"),
    );
  });

  it("error message mentions 'shorter than' when username is too short", () => {
    process.env.ADMIN_USERNAME = "abc";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("shorter than"),
    );
  });

  it("error message mentions 'entirely of digits' when username is purely numeric", () => {
    process.env.ADMIN_USERNAME = "12345";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("entirely of digits"),
    );
  });

  it("error message mentions 'well-known trivial value' when username is blocklisted", () => {
    process.env.ADMIN_USERNAME = "admin";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("well-known trivial value"),
    );
  });

  it("error message mentions 'well-known trivial value' for case-insensitive blocklist match", () => {
    process.env.ADMIN_USERNAME = "ADMIN";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("well-known trivial value"),
    );
  });

  it("error message mentions 'single repeated character' when username is a repeated-char string", () => {
    process.env.ADMIN_USERNAME = "aaaa";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("single repeated character"),
    );
  });

  it("error message mentions 'keyboard-walk sequence' when username is a keyboard walk", () => {
    process.env.ADMIN_USERNAME = "qwerty";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("keyboard-walk sequence"),
    );
  });

  it("error message mentions 'keyboard-walk sequence' for a reverse keyboard walk", () => {
    process.env.ADMIN_USERNAME = "ytrewq";
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("keyboard-walk sequence"),
    );
  });

  it("error message includes the [SECURITY] prefix for every failure reason", () => {
    const scenarios: [string, string | undefined][] = [
      ["missing — absent", undefined],
      ["missing — empty", ""],
      ["too_short", "abc"],
      ["purely_numeric", "12345"],
      ["blocklisted", "admin"],
      ["repeated_char", "aaaa"],
      ["keyboard_walk", "qwerty"],
    ];

    for (const [_label, usernameVal] of scenarios) {
      errorSpy.mockClear();
      if (usernameVal === undefined) {
        delete process.env.ADMIN_USERNAME;
      } else {
        process.env.ADMIN_USERNAME = usernameVal;
      }
      delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
      validateEnv();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[SECURITY]"),
      );
    }
  });

  it("warning message includes the reason-specific detail when escape hatch is active for blocklisted username", () => {
    process.env.ADMIN_USERNAME = "admin";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("well-known trivial value"),
    );
  });

  it("warning message includes the reason-specific detail when escape hatch is active for repeated-char username", () => {
    process.env.ADMIN_USERNAME = "aaaa";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("single repeated character"),
    );
  });

  it("warning message includes the reason-specific detail when escape hatch is active for keyboard-walk username", () => {
    process.env.ADMIN_USERNAME = "qwerty";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    validateEnv();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("keyboard-walk sequence"),
    );
  });
});

// ============================================================================
// emitStartupSecurityWarnings — production escape-hatch exit (unit)
// ============================================================================

function flushAllPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("emitStartupSecurityWarnings — exits with code 1 when escape-hatch flags are set in production", () => {
  const MOCK_STORAGE = { createAuditLog: async () => ({}) };

  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ALLOW_WEAK_ADMIN_PASSWORD: process.env.ALLOW_WEAK_ADMIN_PASSWORD,
      ALLOW_WEAK_SESSION_SECRET: process.env.ALLOW_WEAK_SESSION_SECRET,
      ALLOW_WEAK_ADMIN_USERNAME: process.env.ALLOW_WEAK_ADMIN_USERNAME,
    };
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => undefined as never);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_WEAK_ADMIN_PASSWORD;
    delete process.env.ALLOW_WEAK_SESSION_SECRET;
    delete process.env.ALLOW_WEAK_ADMIN_USERNAME;
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
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
    vi.restoreAllMocks();
  });

  it("calls process.exit(1) when ALLOW_WEAK_ADMIN_PASSWORD=1 in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls process.exit(1) when ALLOW_WEAK_SESSION_SECRET=1 in production", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls process.exit(1) when ALLOW_WEAK_ADMIN_USERNAME=1 in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls process.exit(1) only once when all three flags are set in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs a [SECURITY] console.error before exiting when ALLOW_WEAK_ADMIN_PASSWORD=1", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SECURITY]"),
    );
  });

  it("logs a [SECURITY] console.error before exiting when ALLOW_WEAK_SESSION_SECRET=1", async () => {
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SECURITY]"),
    );
  });

  it("logs a [SECURITY] console.error before exiting when ALLOW_WEAK_ADMIN_USERNAME=1", async () => {
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SECURITY]"),
    );
  });

  it("also emits console.warn for each active flag before exiting", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("does NOT call process.exit when no escape-hatch flags are set in production", async () => {
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT call process.exit when escape-hatch flags are set outside production", async () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    emitStartupSecurityWarnings(MOCK_STORAGE);
    await flushAllPromises();
    expect(exitSpy).not.toHaveBeenCalled();
    // In non-production, the code still emits a console.warn per flag
    // (development-mode advisory) but does NOT call exitFn.
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("writes an audit row for ALLOW_WEAK_ADMIN_USERNAME=1 in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    const createAuditLog = vi.fn(async () => ({}));
    emitStartupSecurityWarnings({ createAuditLog });
    await flushAllPromises();
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

  it("writes audit rows for all three flags when all are set in production", async () => {
    process.env.ALLOW_WEAK_ADMIN_PASSWORD = "1";
    process.env.ALLOW_WEAK_SESSION_SECRET = "1";
    process.env.ALLOW_WEAK_ADMIN_USERNAME = "1";
    const createAuditLog = vi.fn(async () => ({}));
    emitStartupSecurityWarnings({ createAuditLog });
    await flushAllPromises();
    // 3 per-flag security_config_warning rows + 1 consolidated
    // security_escape_hatch_flags_in_production row = 4 total.
    expect(createAuditLog).toHaveBeenCalledTimes(4);
  });
});
