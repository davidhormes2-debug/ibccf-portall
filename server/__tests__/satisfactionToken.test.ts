import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  issueSatisfactionToken,
  verifySatisfactionToken,
  SATISFACTION_TOKEN_TTL_S,
} from "../lib/satisfactionToken";

// ============================================================================
// Unit tests for server/lib/satisfactionToken.ts
//
// Covers:
//   1. issueSatisfactionToken — produces a well-formed token string.
//   2. Round-trip: a token issued for (visitorId, caseId) verifies correctly.
//   3. Signature tampering → "signature" rejection.
//   4. Expired token → "expired" rejection.
//   5. visitorId mismatch → "mismatch" rejection.
//   6. caseId mismatch → "mismatch" rejection.
//   7. Malformed token (no dot, wrong sig length) → "malformed" rejection.
//   8. Token missing SESSION_SECRET → throws (issuer side) / "malformed" (verifier side).
//   9. Different SESSION_SECRET → "signature" rejection.
// ============================================================================

const VISITOR = "v_test_abc123";
const CASE_ID = "42";    // varchar in DB
const NOW_MS = 1_000_000_000_000; // arbitrary fixed point

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET =
    "test-secret-that-is-long-enough-for-validation-X9k2";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = ORIGINAL_SECRET;
  }
});

// ── 1. Token shape ────────────────────────────────────────────────────────────

describe("issueSatisfactionToken — token shape", () => {
  it("returns a string with exactly one dot", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
  });

  it("signature part is 64 hex characters (SHA-256)", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const sig = token.split(".")[1];
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── 2. Round-trip ─────────────────────────────────────────────────────────────

describe("verifySatisfactionToken — round-trip", () => {
  it("returns ok:true with a nonce and expiresAt for a freshly issued token", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, NOW_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(typeof result.nonce).toBe("string");
    expect(result.nonce.length).toBeGreaterThan(0);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(Math.floor(result.expiresAt.getTime() / 1000)).toBe(
      Math.floor(NOW_MS / 1000) + SATISFACTION_TOKEN_TTL_S,
    );
  });

  it("accepts a token presented just before expiry", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const almostExpiredMs = NOW_MS + (SATISFACTION_TOKEN_TTL_S - 1) * 1000;
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, almostExpiredMs);
    expect(result.ok).toBe(true);
  });

  it("issues a distinct nonce for every call, even for the same visitor+case", () => {
    const token1 = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const token2 = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const result1 = verifySatisfactionToken(token1, VISITOR, CASE_ID, NOW_MS);
    const result2 = verifySatisfactionToken(token2, VISITOR, CASE_ID, NOW_MS);
    if (!result1.ok || !result2.ok) throw new Error("expected ok results");
    expect(result1.nonce).not.toBe(result2.nonce);
  });
});

// ── 3. Signature tampering ────────────────────────────────────────────────────

describe("verifySatisfactionToken — tampered signature", () => {
  it("rejects a token with last byte of sig flipped", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const dot = token.lastIndexOf(".");
    const sig = token.slice(dot + 1);
    // Flip last hex character
    const lastChar = sig[sig.length - 1];
    const flipped = lastChar === "f" ? "0" : "f";
    const tampered = token.slice(0, dot + 1) + sig.slice(0, -1) + flipped;
    const result = verifySatisfactionToken(tampered, VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a token with payload swapped to a different visitorId but same sig", () => {
    const token1 = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const token2 = issueSatisfactionToken("v_other_visitor", CASE_ID, NOW_MS);
    // Splice payload from token2 + sig from token1 → forge attempt
    const payload2 = token2.split(".")[0];
    const sig1 = token1.split(".")[1];
    const spliced = `${payload2}.${sig1}`;
    const result = verifySatisfactionToken(spliced, "v_other_visitor", CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "signature" });
  });
});

// ── 4. Expiry ─────────────────────────────────────────────────────────────────

describe("verifySatisfactionToken — expired token", () => {
  it("rejects a token whose TTL has elapsed", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const expiredMs = NOW_MS + (SATISFACTION_TOKEN_TTL_S + 1) * 1000;
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, expiredMs);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token exactly at the expiry second", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const exactExpiryMs = NOW_MS + SATISFACTION_TOKEN_TTL_S * 1000;
    // Math.floor(exactExpiryMs/1000) === payload.e; the check is >= so the
    // token is considered expired at the exact expiry second (exclusive TTL).
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, exactExpiryMs);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

// ── 5. visitorId mismatch ─────────────────────────────────────────────────────

describe("verifySatisfactionToken — visitorId mismatch", () => {
  it("rejects when a different visitorId is supplied", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const result = verifySatisfactionToken(token, "v_different", CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});

// ── 6. caseId mismatch ────────────────────────────────────────────────────────

describe("verifySatisfactionToken — caseId mismatch", () => {
  it("rejects when a different caseId is supplied", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const result = verifySatisfactionToken(token, VISITOR, "99", NOW_MS);
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});

// ── 7. Malformed tokens ───────────────────────────────────────────────────────

describe("verifySatisfactionToken — malformed tokens", () => {
  it("rejects an empty string", () => {
    const result = verifySatisfactionToken("", VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a string with no dot separator", () => {
    const result = verifySatisfactionToken("nodothere", VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token whose signature is the wrong length", () => {
    // Correct payload, truncated signature
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    const truncated = token.slice(0, -4);
    const result = verifySatisfactionToken(truncated, VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token whose payload is not valid base64url JSON", () => {
    // Build a token with garbage payload but correct-length sig section
    const fakeSig = "a".repeat(64);
    const garbled = `!!!notbase64!!!.${fakeSig}`;
    const result = verifySatisfactionToken(garbled, VISITOR, CASE_ID, NOW_MS);
    // Signature won't match, so we get "signature" before "malformed" JSON parse
    expect(result.ok).toBe(false);
  });
});

// ── 8. Missing SESSION_SECRET ─────────────────────────────────────────────────

describe("satisfactionToken — missing SESSION_SECRET", () => {
  it("issueSatisfactionToken throws when SESSION_SECRET is absent", () => {
    delete process.env.SESSION_SECRET;
    expect(() => issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS)).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("verifySatisfactionToken returns malformed when SESSION_SECRET is absent", () => {
    // Issue with the secret present, then clear it before verifying
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    delete process.env.SESSION_SECRET;
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});

// ── 9. Wrong SESSION_SECRET ────────────────────────────────────────────────────

describe("satisfactionToken — wrong SESSION_SECRET", () => {
  it("rejects a token signed with a different secret", () => {
    const token = issueSatisfactionToken(VISITOR, CASE_ID, NOW_MS);
    process.env.SESSION_SECRET =
      "completely-different-secret-value-ZZZZZZZZZZZZ";
    const result = verifySatisfactionToken(token, VISITOR, CASE_ID, NOW_MS);
    expect(result).toEqual({ ok: false, reason: "signature" });
  });
});
