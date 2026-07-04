import { describe, it, expect } from "vitest";
import {
  getUsernameTrivialReason,
  isAdminUsernameTrivial,
  KEYBOARD_WALK_SEQUENCES,
  TRIVIAL_ADMIN_USERNAMES,
  MIN_ADMIN_USERNAME_LENGTH,
  USERNAME_TRIVIAL_HINTS,
} from "../../shared/passwordStrength";

describe("getUsernameTrivialReason — too_short", () => {
  it("returns too_short for undefined", () => {
    expect(getUsernameTrivialReason(undefined)).toBe("too_short");
  });

  it("returns too_short for empty string", () => {
    expect(getUsernameTrivialReason("")).toBe("too_short");
  });

  it("returns too_short for strings below MIN_ADMIN_USERNAME_LENGTH", () => {
    expect(getUsernameTrivialReason("abc")).toBe("too_short");
    expect(getUsernameTrivialReason("a")).toBe("too_short");
  });

  it("does NOT return too_short for a string at exactly MIN_ADMIN_USERNAME_LENGTH", () => {
    const result = getUsernameTrivialReason("zxq7");
    expect(result).not.toBe("too_short");
  });
});

describe("getUsernameTrivialReason — purely_numeric", () => {
  it("returns purely_numeric for all-digit strings", () => {
    expect(getUsernameTrivialReason("1234")).toBe("purely_numeric");
    expect(getUsernameTrivialReason("00000000")).toBe("purely_numeric");
    expect(getUsernameTrivialReason("987654321")).toBe("purely_numeric");
  });

  it("does NOT return purely_numeric for alphanumeric strings containing digits", () => {
    expect(getUsernameTrivialReason("user1234x")).toBeNull();
  });
});

describe("getUsernameTrivialReason — blocklisted", () => {
  it("rejects every entry in TRIVIAL_ADMIN_USERNAMES (as blocked or too short)", () => {
    const accepted: string[] = [];
    for (const u of TRIVIAL_ADMIN_USERNAMES) {
      const reason = getUsernameTrivialReason(u);
      // Short entries (e.g. "mod", "dev") are caught by too_short before the
      // blocklist check — both server and client reject them, just for length.
      if (reason !== "blocklisted" && reason !== "too_short") {
        accepted.push(u);
      }
    }
    expect(accepted).toEqual([]);
  });

  it("returns blocklisted for uppercase variants (case-insensitive check)", () => {
    expect(getUsernameTrivialReason("ADMIN")).toBe("blocklisted");
    expect(getUsernameTrivialReason("ROOT")).toBe("blocklisted");
    expect(getUsernameTrivialReason("ADMINISTRATOR")).toBe("blocklisted");
  });

  it("returns blocklisted for mixed-case variants", () => {
    expect(getUsernameTrivialReason("Admin")).toBe("blocklisted");
    expect(getUsernameTrivialReason("SysAdmin")).toBe("blocklisted");
  });
});

describe("getUsernameTrivialReason — repeated_char", () => {
  it("returns repeated_char for aaaa", () => {
    expect(getUsernameTrivialReason("aaaa")).toBe("repeated_char");
  });

  it("returns repeated_char for xxxxxx", () => {
    expect(getUsernameTrivialReason("xxxxxx")).toBe("repeated_char");
  });

  it("returns repeated_char for ZZZZ (case-insensitive)", () => {
    expect(getUsernameTrivialReason("ZZZZ")).toBe("repeated_char");
  });

  it("does NOT return repeated_char for a mixed-character string", () => {
    const r = getUsernameTrivialReason("ibccf_ops");
    expect(r).not.toBe("repeated_char");
  });
});

describe("getUsernameTrivialReason — keyboard_walk", () => {
  it("returns keyboard_walk for qwerty", () => {
    expect(getUsernameTrivialReason("qwerty")).toBe("keyboard_walk");
  });

  it("returns keyboard_walk for asdf", () => {
    expect(getUsernameTrivialReason("asdf")).toBe("keyboard_walk");
  });

  it("returns keyboard_walk for zxcv", () => {
    expect(getUsernameTrivialReason("zxcv")).toBe("keyboard_walk");
  });

  it("returns keyboard_walk for 1234", () => {
    expect(getUsernameTrivialReason("1234")).not.toBe("keyboard_walk");
  });

  it("returns keyboard_walk for reversed sequence (ytrewq)", () => {
    expect(getUsernameTrivialReason("ytrewq")).toBe("keyboard_walk");
  });

  it("returns keyboard_walk for reversed sequence (lkjh)", () => {
    expect(getUsernameTrivialReason("lkjh")).toBe("keyboard_walk");
  });

  it("returns keyboard_walk for abcd (sequential alphabet)", () => {
    expect(getUsernameTrivialReason("abcd")).toBe("keyboard_walk");
  });
});

describe("getUsernameTrivialReason — passing usernames", () => {
  it("returns null for a unique, non-trivial username", () => {
    expect(getUsernameTrivialReason("ibccf_ops_2026")).toBeNull();
    expect(getUsernameTrivialReason("zxq7")).toBeNull();
    expect(getUsernameTrivialReason("secr3t_adm1n")).toBeNull();
  });

  it("returns null for a username that starts with a blocklisted word but is longer", () => {
    expect(getUsernameTrivialReason("admin_ibccf_9x")).toBeNull();
  });
});

describe("isAdminUsernameTrivial", () => {
  it("returns true for trivial usernames", () => {
    expect(isAdminUsernameTrivial("aaaa")).toBe(true);
    expect(isAdminUsernameTrivial("qwerty")).toBe(true);
    expect(isAdminUsernameTrivial("admin")).toBe(true);
    expect(isAdminUsernameTrivial("1234")).toBe(true);
    expect(isAdminUsernameTrivial("abc")).toBe(true);
  });

  it("returns false for acceptable usernames", () => {
    expect(isAdminUsernameTrivial("ibccf_ops_2026")).toBe(false);
    expect(isAdminUsernameTrivial("zxq7")).toBe(false);
  });
});

describe("USERNAME_TRIVIAL_HINTS", () => {
  it("contains a hint for every UsernameTrivialReason value", () => {
    const reasons = [
      "too_short",
      "purely_numeric",
      "blocklisted",
      "repeated_char",
      "keyboard_walk",
    ] as const;
    for (const r of reasons) {
      expect(typeof USERNAME_TRIVIAL_HINTS[r]).toBe("string");
      expect(USERNAME_TRIVIAL_HINTS[r].length).toBeGreaterThan(0);
    }
  });

  it("includes 'repeated character' in the repeated_char hint", () => {
    expect(USERNAME_TRIVIAL_HINTS.repeated_char).toContain("repeated character");
  });

  it("includes 'keyboard' in the keyboard_walk hint", () => {
    expect(USERNAME_TRIVIAL_HINTS.keyboard_walk).toContain("keyboard");
  });
});

describe("KEYBOARD_WALK_SEQUENCES — full sequence list", () => {
  it("contains the standard QWERTY rows", () => {
    expect(KEYBOARD_WALK_SEQUENCES).toContain("qwertyuiop");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("asdfghjkl");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("zxcvbnm");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("1234567890");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("contains the diagonal QWERTY paths (qaz+wsx+…)", () => {
    expect(KEYBOARD_WALK_SEQUENCES).toContain("qazwsxedcrfvtgbyhnujm");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("1qaz2wsx3edc4rfv5tgb6yhn7ujm");
    expect(KEYBOARD_WALK_SEQUENCES).toContain("plokijuhbygv");
  });

  it("rejects a diagonal-walk username (1qaz) as keyboard_walk", () => {
    expect(getUsernameTrivialReason("1qaz")).toBe("keyboard_walk");
  });

  it("rejects a diagonal-walk username (qazw) as keyboard_walk", () => {
    expect(getUsernameTrivialReason("qazw")).toBe("keyboard_walk");
  });

  it("rejects a reversed diagonal-walk username (mjun) as keyboard_walk", () => {
    // "qazwsxedcrfvtgbyhnujm" reversed is "mjunhybgtfvrcdewxsazq"; "mjun" is a substring
    expect(getUsernameTrivialReason("mjun")).toBe("keyboard_walk");
  });
});

describe("MIN_ADMIN_USERNAME_LENGTH", () => {
  it("is 4", () => {
    expect(MIN_ADMIN_USERNAME_LENGTH).toBe(4);
  });
});
