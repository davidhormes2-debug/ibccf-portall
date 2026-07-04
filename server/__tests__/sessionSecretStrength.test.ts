import { describe, it, expect } from "vitest";
import {
  INSECURE_SESSION_SECRET_VALUES,
  isSessionSecretWeak,
  shannonEntropy,
  MIN_SESSION_SECRET_ENTROPY,
} from "../env";

// ============================================================================
// Session-secret blocklist sync guard
//
// Every value in INSECURE_SESSION_SECRET_VALUES must be rejected by
// isSessionSecretWeak() regardless of length — even entries that happen to be
// ≥ 32 characters must fail the set check.  This is the CI trip-wire that
// catches any future edit that adds a long placeholder to the blocklist without
// verifying the helper still catches it.
// ============================================================================

describe("INSECURE_SESSION_SECRET_VALUES × isSessionSecretWeak sync", () => {
  it("rejects every entry in INSECURE_SESSION_SECRET_VALUES regardless of length", () => {
    const accepted: string[] = [];

    for (const value of INSECURE_SESSION_SECRET_VALUES) {
      if (!isSessionSecretWeak(value)) {
        accepted.push(value);
      }
    }

    expect(accepted).toEqual([]);
  });
});

describe("isSessionSecretWeak — boundary cases", () => {
  it("rejects undefined", () => {
    expect(isSessionSecretWeak(undefined)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isSessionSecretWeak("")).toBe(true);
  });

  it("rejects secrets shorter than 32 characters that are not in the blocklist", () => {
    expect(isSessionSecretWeak("tooshort")).toBe(true);
    expect(isSessionSecretWeak("exactly31charsbutnotinblocklist")).toBe(true);
  });

  it("accepts a 32-character secret that is not in the blocklist", () => {
    expect(isSessionSecretWeak("xK9#mQpLt2@WzRvNdYeAjHcBsFoGiUl7")).toBe(false);
  });

  it("accepts a longer secret that is not in the blocklist", () => {
    expect(isSessionSecretWeak("a-genuinely-random-secret-value-that-is-long-enough-and-not-known")).toBe(false);
  });
});

describe("isSessionSecretWeak — case-insensitive blocklist matching", () => {
  it("rejects all-uppercase variants of blocklisted values", () => {
    expect(isSessionSecretWeak("CHANGEME")).toBe(true);
    expect(isSessionSecretWeak("SUPERSECRET")).toBe(true);
    expect(isSessionSecretWeak("PASSWORD")).toBe(true);
  });

  it("rejects mixed-case variants of blocklisted values", () => {
    expect(isSessionSecretWeak("Secret")).toBe(true);
    expect(isSessionSecretWeak("KeyboardCat")).toBe(true);
    expect(isSessionSecretWeak("LetMeIn")).toBe(true);
  });

  it("rejects a long uppercase blocklisted value that would otherwise pass the length check", () => {
    expect(isSessionSecretWeak("A-VERY-LONG-RANDOM-STRING-HERE-32+CHARS")).toBe(true);
    expect(isSessionSecretWeak("REPLACE-ME-WITH-A-REAL-SECRET-KEY")).toBe(true);
  });
});

// ============================================================================
// shannonEntropy — unit tests
// ============================================================================

describe("shannonEntropy", () => {
  it("returns 0 for an empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for a single-character string", () => {
    expect(shannonEntropy("a")).toBe(0);
  });

  it("returns 0 for a string composed entirely of identical characters", () => {
    expect(shannonEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(0);
  });

  it("returns ~1.58 bits/char for a 3-symbol balanced repeated pattern (abcabc…)", () => {
    // 3 unique chars each with probability 1/3 → H = log₂(3) ≈ 1.585
    const h = shannonEntropy("abcabcabcabcabcabcabcabcabcabcab");
    expect(h).toBeGreaterThan(1.5);
    expect(h).toBeLessThan(1.7);
  });

  it("returns ~3.3 bits/char for a qwerty top-row keyboard walk", () => {
    // 10 unique chars recycled over 32 positions → H ≈ 3.3 bits/char
    const h = shannonEntropy("qwertyuiopqwertyuiopqwertyuiopqw");
    expect(h).toBeGreaterThan(3.0);
    expect(h).toBeLessThan(3.5);
  });

  it("returns ~4 bits/char for a balanced 16-symbol (hex) string", () => {
    // Each of 16 hex symbols appears twice → H = log₂(16) = 4
    const h = shannonEntropy("0123456789abcdef0123456789abcdef");
    expect(h).toBeCloseTo(4, 2);
  });

  it("entropy increases as the unique-character alphabet grows", () => {
    const threeSymbol  = shannonEntropy("abcabcabcabcabcabcabcabcabcabcab"); // ~1.58
    const tenSymbol    = shannonEntropy("qwertyuiopqwertyuiopqwertyuiopqw"); // ~3.3
    const sixteenSymbol = shannonEntropy("0123456789abcdef0123456789abcdef"); // ~4
    expect(threeSymbol).toBeLessThan(tenSymbol);
    expect(tenSymbol).toBeLessThan(sixteenSymbol);
  });
});

// ============================================================================
// MIN_SESSION_SECRET_ENTROPY constant
// ============================================================================

describe("MIN_SESSION_SECRET_ENTROPY", () => {
  it("is set to 3.5", () => {
    expect(MIN_SESSION_SECRET_ENTROPY).toBe(3.5);
  });

  it("sits between the entropy of a keyboard walk and a hex random string", () => {
    const keyboardWalk = shannonEntropy("qwertyuiopqwertyuiopqwertyuiopqw");
    const hexRandom    = shannonEntropy("0123456789abcdef0123456789abcdef");
    expect(keyboardWalk).toBeLessThan(MIN_SESSION_SECRET_ENTROPY);
    expect(hexRandom).toBeGreaterThan(MIN_SESSION_SECRET_ENTROPY);
  });
});

// ============================================================================
// isSessionSecretWeak — repeated patterns (entropy-based rejection)
// ============================================================================

describe("isSessionSecretWeak — repeated patterns", () => {
  it("rejects a 32-char string built from a 3-char cycling pattern (abcabc…)", () => {
    expect(isSessionSecretWeak("abcabcabcabcabcabcabcabcabcabcab")).toBe(true);
  });

  it("rejects a 32-char string built from a 2-char cycling pattern (ababab…)", () => {
    expect(isSessionSecretWeak("abababababababababababababababababab")).toBe(true);
  });

  it("rejects a 32-char string built from a 5-char numeric cycling pattern (12345…)", () => {
    expect(isSessionSecretWeak("12345123451234512345123451234512")).toBe(true);
  });

  it("rejects a 32-char all-same-character string not in the explicit blocklist", () => {
    // 'b' repeated — not listed in INSECURE_SESSION_SECRET_VALUES
    expect(isSessionSecretWeak("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(true);
  });

  it("rejects a 32-char string cycling through only digits 0–4", () => {
    expect(isSessionSecretWeak("01234012340123401234012340123401")).toBe(true);
  });
});

// ============================================================================
// isSessionSecretWeak — keyboard walks (entropy-based rejection)
// ============================================================================

describe("isSessionSecretWeak — keyboard walks", () => {
  it("rejects the qwerty top-row walk repeated to fill 32 chars", () => {
    // "qwertyuiop" × 3 + "qw" = 32 chars, H ≈ 3.3 < 3.5
    expect(isSessionSecretWeak("qwertyuiopqwertyuiopqwertyuiopqw")).toBe(true);
  });

  it("rejects the asdf home-row walk repeated to fill 32 chars", () => {
    // "asdfghjkl" (9 unique chars) × 3 + "asdfg" = 32 chars, H ≈ 3.17
    expect(isSessionSecretWeak("asdfghjklasdfghjklasdfghjklasdfg")).toBe(true);
  });

  it("rejects the zxcv bottom-row walk repeated to fill 32 chars", () => {
    // "zxcvbnm" (7 unique chars), H ≈ 2.81 < 3.5
    expect(isSessionSecretWeak("zxcvbnmzxcvbnmzxcvbnmzxcvbnmzxcv")).toBe(true);
  });

  it("rejects a numeric ascending walk (1234567890 repeated to 32 chars)", () => {
    // 10 unique digits but short alphabet, H ≈ 3.32 < 3.5
    expect(isSessionSecretWeak("12345678901234567890123456789012")).toBe(true);
  });
});

// ============================================================================
// isSessionSecretWeak — strong secrets must still pass
// ============================================================================

describe("isSessionSecretWeak — strong secrets accepted", () => {
  it("accepts a 32-char hex random string (16 unique chars, H ≈ 4)", () => {
    expect(isSessionSecretWeak("a3f8b2e9d1c4f7a0b5e2d8c6f3a9b1e4")).toBe(false);
  });

  it("accepts a 64-char hex random string", () => {
    expect(
      isSessionSecretWeak(
        "4e9a1c7d3b0f2e8a6c5d1b9e3f7a2c0d4e9a1c7d3b0f2e8a6c5d1b9e3f7a2c0d"
      )
    ).toBe(false);
  });

  it("accepts a high-variety mixed-symbol secret", () => {
    expect(isSessionSecretWeak("X7#mK9@pL2$nQ5&wR8*zA1!cF4^vG6~H")).toBe(false);
  });

  it("accepts a UUID-formatted string with high character variety", () => {
    // A UUID-like string with broad character distribution (H > 3.5 bits/char)
    expect(isSessionSecretWeak("c3e4f5a6-b7d8-4e9f-a0b1-c2d3e4f5a6b7")).toBe(false);
  });
});
