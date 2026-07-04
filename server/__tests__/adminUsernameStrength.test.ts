import { describe, it, expect } from "vitest";
import {
  TRIVIAL_ADMIN_USERNAMES,
  isAdminUsernameTrivial,
  MIN_ADMIN_USERNAME_LENGTH,
} from "../env";

// ============================================================================
// Admin-username blocklist sync guard
//
// Every value in TRIVIAL_ADMIN_USERNAMES must be rejected by
// isAdminUsernameTrivial() regardless of length. This is the CI trip-wire
// that catches any future edit which adds a trivial username to the blocklist
// without verifying the helper still catches it.
// ============================================================================

describe("TRIVIAL_ADMIN_USERNAMES × isAdminUsernameTrivial sync", () => {
  it("rejects every entry in TRIVIAL_ADMIN_USERNAMES", () => {
    const accepted: string[] = [];

    for (const value of TRIVIAL_ADMIN_USERNAMES) {
      if (!isAdminUsernameTrivial(value)) {
        accepted.push(value);
      }
    }

    expect(accepted).toEqual([]);
  });
});

describe("isAdminUsernameTrivial — boundary cases", () => {
  it("rejects undefined", () => {
    expect(isAdminUsernameTrivial(undefined)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isAdminUsernameTrivial("")).toBe(true);
  });

  it("rejects usernames shorter than the minimum length", () => {
    expect(isAdminUsernameTrivial("abc")).toBe(true);
    expect(isAdminUsernameTrivial("a")).toBe(true);
  });

  it("rejects purely numeric usernames", () => {
    expect(isAdminUsernameTrivial("1234")).toBe(true);
    expect(isAdminUsernameTrivial("00000000")).toBe(true);
  });

  it("accepts a non-trivial username meeting the minimum length", () => {
    expect(isAdminUsernameTrivial("ibccf_ops_2026")).toBe(false);
    expect(
      isAdminUsernameTrivial("a".repeat(MIN_ADMIN_USERNAME_LENGTH) + "_unique"),
    ).toBe(false);
  });
});

describe("isAdminUsernameTrivial — case-insensitive blocklist matching", () => {
  it("rejects all-uppercase variants of blocklisted values", () => {
    expect(isAdminUsernameTrivial("ADMIN")).toBe(true);
    expect(isAdminUsernameTrivial("ROOT")).toBe(true);
    expect(isAdminUsernameTrivial("ADMINISTRATOR")).toBe(true);
    expect(isAdminUsernameTrivial("SUPERUSER")).toBe(true);
  });

  it("rejects mixed-case variants of blocklisted values", () => {
    expect(isAdminUsernameTrivial("Admin")).toBe(true);
    expect(isAdminUsernameTrivial("Root")).toBe(true);
    expect(isAdminUsernameTrivial("Administrator")).toBe(true);
    expect(isAdminUsernameTrivial("SysAdmin")).toBe(true);
    expect(isAdminUsernameTrivial("Ibccf_Admin")).toBe(true);
  });
});
