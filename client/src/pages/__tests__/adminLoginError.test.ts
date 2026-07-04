import { describe, expect, it } from "vitest";

import {
  ADMIN_PASSWORD_WEAK_HINTS,
  type AdminPasswordWeakReason,
} from "@shared/passwordStrength";
import { getAdminLoginErrorMessage } from "../adminLoginError";

describe("getAdminLoginErrorMessage", () => {
  it("surfaces the server's weak-password message on a 503 response", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: {
        error:
          "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.message).toBe(
      "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
    );
    expect(result?.isWeakPassword).toBe(true);
  });

  it("falls back to a user-friendly paraphrase when the 503 body has no error string", () => {
    const result = getAdminLoginErrorMessage({ status: 503, body: {} });

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/ADMIN_PASSWORD/);
    expect(result?.isWeakPassword).toBe(true);
  });

  it("returns null for non-503 responses so the existing 401 / connection toasts still fire", () => {
    expect(
      getAdminLoginErrorMessage({ status: 401, body: { error: "nope" } }),
    ).toBeNull();
    expect(getAdminLoginErrorMessage({ status: 500, body: {} })).toBeNull();
    expect(getAdminLoginErrorMessage({ status: 200, body: {} })).toBeNull();
  });

  it("still classifies a non-weak 503 message as a server block but flags it as non-weak", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: { error: "Admin credentials not configured" },
    });

    expect(result).not.toBeNull();
    expect(result?.message).toBe("Admin credentials not configured");
    expect(result?.isWeakPassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-reason weakReason parsing and hint mapping
// ---------------------------------------------------------------------------

const REASON_TEST_CASES: Array<{
  reason: AdminPasswordWeakReason;
  description: string;
}> = [
  { reason: "missing", description: "missing ADMIN_PASSWORD" },
  { reason: "too_short", description: "too-short password" },
  { reason: "blocklisted", description: "blocklisted password" },
  { reason: "keyboard_walk", description: "keyboard-walk password" },
  { reason: "repetitive_pattern", description: "repetitive-pattern password" },
];

describe("getAdminLoginErrorMessage — weakReason parsing per AdminPasswordWeakReason", () => {
  for (const { reason, description } of REASON_TEST_CASES) {
    it(`parses weakReason '${reason}' (${description}) and sets weakReasonHint from ADMIN_PASSWORD_WEAK_HINTS`, () => {
      const result = getAdminLoginErrorMessage({
        status: 503,
        body: {
          error: "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
          weakReason: reason,
        },
      });

      expect(result).not.toBeNull();
      expect(result?.isWeakPassword).toBe(true);
      expect(result?.weakReason).toBe(reason);
      expect(result?.weakReasonHint).toBe(ADMIN_PASSWORD_WEAK_HINTS[reason]);
    });

    it(`weakReasonHint for '${reason}' is a non-empty string`, () => {
      const result = getAdminLoginErrorMessage({
        status: 503,
        body: { weakReason: reason },
      });

      expect(typeof result?.weakReasonHint).toBe("string");
      expect((result?.weakReasonHint ?? "").length).toBeGreaterThan(0);
    });
  }

  it("returns no weakReason or weakReasonHint when the 503 body omits weakReason", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: { error: "Admin password is too weak — rotate ADMIN_PASSWORD before logging in" },
    });

    expect(result).not.toBeNull();
    expect(result?.weakReason).toBeUndefined();
    expect(result?.weakReasonHint).toBeUndefined();
  });

  it("returns no weakReason or weakReasonHint when weakReason is an unknown string", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: {
        error: "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
        weakReason: "completely_unknown_reason",
      },
    });

    expect(result).not.toBeNull();
    expect(result?.weakReason).toBeUndefined();
    expect(result?.weakReasonHint).toBeUndefined();
  });

  it("returns no weakReason or weakReasonHint when weakReason is null", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: {
        error: "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
        weakReason: null,
      },
    });

    expect(result).not.toBeNull();
    expect(result?.weakReason).toBeUndefined();
    expect(result?.weakReasonHint).toBeUndefined();
  });

  it("returns no weakReason or weakReasonHint when weakReason is a number", () => {
    const result = getAdminLoginErrorMessage({
      status: 503,
      body: {
        error: "Admin password is too weak — rotate ADMIN_PASSWORD before logging in",
        weakReason: 42,
      },
    });

    expect(result).not.toBeNull();
    expect(result?.weakReason).toBeUndefined();
    expect(result?.weakReasonHint).toBeUndefined();
  });

  it("weakReasonHint for each reason matches exactly what ADMIN_PASSWORD_WEAK_HINTS exports", () => {
    const allReasons: AdminPasswordWeakReason[] = [
      "missing",
      "too_short",
      "blocklisted",
      "keyboard_walk",
      "repetitive_pattern",
    ];
    for (const reason of allReasons) {
      const result = getAdminLoginErrorMessage({
        status: 503,
        body: { weakReason: reason },
      });
      expect(result?.weakReasonHint).toBe(ADMIN_PASSWORD_WEAK_HINTS[reason]);
    }
  });
});
