import { describe, it, expect } from "vitest";
import {
  WEAK_ADMIN_PASSWORDS,
  getPasswordStrength,
  getPasswordStrengthDetail,
  isAdminPasswordWeak,
  shannonEntropy,
  MIN_PASSWORD_ENTROPY,
  containsKeyboardWalk,
  MIN_PASSWORD_WALK_LENGTH,
} from "@shared/passwordStrength";

// ============================================================================
// Password-strength sync guard
//
// Every password in WEAK_ADMIN_PASSWORDS must be rated "Weak" by
// getPasswordStrength().  This test is the CI trip-wire that catches any
// update to one without a corresponding update to the other — since both the
// server startup check (isAdminPasswordWeak) and the client-side strength
// meter (getPasswordStrength) now import from the same shared module, the
// lists can never silently diverge.
// ============================================================================

describe("WEAK_ADMIN_PASSWORDS × getPasswordStrength sync", () => {
  it("rates every entry in WEAK_ADMIN_PASSWORDS as 'Weak'", () => {
    const nonWeak: string[] = [];

    for (const password of WEAK_ADMIN_PASSWORDS) {
      if (getPasswordStrength(password) !== "Weak") {
        nonWeak.push(password);
      }
    }

    expect(nonWeak).toEqual([]);
  });

  it("isAdminPasswordWeak returns true for every entry in WEAK_ADMIN_PASSWORDS", () => {
    const notFlagged: string[] = [];

    for (const password of WEAK_ADMIN_PASSWORDS) {
      if (!isAdminPasswordWeak(password)) {
        notFlagged.push(password);
      }
    }

    expect(notFlagged).toEqual([]);
  });
});

describe("getPasswordStrength — boundary cases", () => {
  it("rates passwords shorter than 8 characters as Weak", () => {
    expect(getPasswordStrength("")).toBe("Weak");
    expect(getPasswordStrength("abc")).toBe("Weak");
    expect(getPasswordStrength("Abc1!")).toBe("Weak");
    expect(getPasswordStrength("1234567")).toBe("Weak");
  });

  it("rates a strong password (≥12 chars, mixed-case + digit + special) as Strong", () => {
    expect(getPasswordStrength("Tr0ub4dor&3xX")).toBe("Strong");
    expect(getPasswordStrength("C0mpl!anceR0cks")).toBe("Strong");
    expect(getPasswordStrength("X9#mQpLt2@Wz")).toBe("Strong");
  });

  it("rates an 8–11 character password without special chars as Medium", () => {
    expect(getPasswordStrength("Abcde123")).toBe("Medium");
    expect(getPasswordStrength("MyPass99")).toBe("Medium");
  });

  it("rates a long password missing a character class as Medium (not Strong)", () => {
    expect(getPasswordStrength("alllowercasenospecia1")).toBe("Medium");
    expect(getPasswordStrength("ALLUPPERCASENOSPECIA1")).toBe("Medium");
    expect(getPasswordStrength("NoDigitsOrSpecialHere")).toBe("Medium");
  });

  it("isAdminPasswordWeak is false for a clearly strong password", () => {
    expect(isAdminPasswordWeak("Tr0ub4dor&3xX")).toBe(false);
  });

  it("isAdminPasswordWeak is true for a known weak password", () => {
    expect(isAdminPasswordWeak("password")).toBe(true);
    expect(isAdminPasswordWeak("admin")).toBe(true);
    expect(isAdminPasswordWeak("abc")).toBe(true);
  });
});

// ============================================================================
// shannonEntropy — unit tests (mirrors the session-secret variant in
// sessionSecretStrength.test.ts to confirm the shared copy is correct)
// ============================================================================

describe("shannonEntropy (shared/passwordStrength copy)", () => {
  it("returns 0 for an empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for a single repeated character", () => {
    expect(shannonEntropy("aaaaaaaa")).toBe(0);
  });

  it("returns ~1.58 bits/char for a 3-symbol balanced repeated pattern (abcabc…)", () => {
    const h = shannonEntropy("abcabcabcabcabcabcabcabcabcabcab");
    expect(h).toBeGreaterThan(1.5);
    expect(h).toBeLessThan(1.7);
  });

  it("returns ~3.1 bits/char for the repeated-pattern password abcabcABCABC12!", () => {
    const h = shannonEntropy("abcabcABCABC12!");
    expect(h).toBeGreaterThan(3.0);
    expect(h).toBeLessThan(3.2);
  });

  it("returns ≥ 3.58 bits/char for a 12-char all-unique password", () => {
    const h = shannonEntropy("X9#mQpLt2@Wz");
    expect(h).toBeGreaterThanOrEqual(3.5);
  });

  it("entropy increases as the unique-character alphabet grows", () => {
    const twoSymbol   = shannonEntropy("abababababababab");  // ~1.0
    const threeSymbol = shannonEntropy("abcabcabcabcabc");  // ~1.58
    const allUnique   = shannonEntropy("X9#mQpLt2@Wz");    // ~3.58
    expect(twoSymbol).toBeLessThan(threeSymbol);
    expect(threeSymbol).toBeLessThan(allUnique);
  });
});

// ============================================================================
// MIN_PASSWORD_ENTROPY constant
// ============================================================================

describe("MIN_PASSWORD_ENTROPY", () => {
  it("is set to 3.2", () => {
    expect(MIN_PASSWORD_ENTROPY).toBe(3.2);
  });

  it("sits above the entropy of a repeated-pattern password and below a varied strong password", () => {
    const repeatedPattern = shannonEntropy("abcabcABCABC12!"); // ~3.1
    const strongPassword  = shannonEntropy("X9#mQpLt2@Wz");   // ~3.58
    expect(repeatedPattern).toBeLessThan(MIN_PASSWORD_ENTROPY);
    expect(strongPassword).toBeGreaterThan(MIN_PASSWORD_ENTROPY);
  });
});

// ============================================================================
// Entropy-based rejection — repeated-pattern passwords
// ============================================================================

describe("getPasswordStrength — repeated-pattern passwords rated Weak", () => {
  it("rejects abcabcABCABC12! (repeating 3-char cycle with mixed case, digit, special)", () => {
    // Passes length, blocklist, and character-class checks but entropy ≈ 3.1 < 3.2
    expect(getPasswordStrength("abcabcABCABC12!")).toBe("Weak");
    expect(isAdminPasswordWeak("abcabcABCABC12!")).toBe(true);
  });

  it("rejects AaAaAaAaAa!1 (two-char alternating case pattern)", () => {
    // A:5, a:5, !:1, 1:1 — very low entropy
    expect(getPasswordStrength("AaAaAaAaAa!1")).toBe("Weak");
    expect(isAdminPasswordWeak("AaAaAaAaAa!1")).toBe(true);
  });

  it("rejects AbAbAbAbAb1! (two-char alternating with digit and special)", () => {
    expect(getPasswordStrength("AbAbAbAbAb1!")).toBe("Weak");
    expect(isAdminPasswordWeak("AbAbAbAbAb1!")).toBe(true);
  });

  it("rejects AABBCCDDaabb1! (repeated pairs pattern)", () => {
    // A:2, B:2, C:2, D:2, a:2, b:2, 1:1, !:1 — 8 unique chars, length 14
    expect(getPasswordStrength("AABBCCDDaabb1!")).toBe("Weak");
    expect(isAdminPasswordWeak("AABBCCDDaabb1!")).toBe(true);
  });

  it("rejects xyzxyzXYZXYZ1! (6-char cycling pattern)", () => {
    expect(getPasswordStrength("xyzxyzXYZXYZ1!")).toBe("Weak");
    expect(isAdminPasswordWeak("xyzxyzXYZXYZ1!")).toBe(true);
  });
});

// ============================================================================
// Entropy-based rejection — keyboard-walk passwords
// ============================================================================

describe("getPasswordStrength — keyboard-walk passwords rated Weak", () => {
  it("rejects QwertyUiop1! (top-row walk with minimal variation)", () => {
    // q,w,e,r,t,y,u,i,o,p + 1 + ! — 12 unique in 12, but dominated by walk chars
    // Actually all unique so entropy = log2(12) ≈ 3.58 — this one should be Medium.
    // Use a longer repeated walk instead.
    expect(getPasswordStrength("QwertyQwerty1!")).toBe("Weak");
    expect(isAdminPasswordWeak("QwertyQwerty1!")).toBe(true);
  });

  it("rejects AsdfAsdfAsd1! (home-row walk repeated)", () => {
    expect(getPasswordStrength("AsdfAsdfAsd1!")).toBe("Weak");
    expect(isAdminPasswordWeak("AsdfAsdfAsd1!")).toBe(true);
  });

  it("rejects ZxcvZxcvZxcv1! (bottom-row walk repeated with digit and special)", () => {
    expect(getPasswordStrength("ZxcvZxcvZxcv1!")).toBe("Weak");
    expect(isAdminPasswordWeak("ZxcvZxcvZxcv1!")).toBe(true);
  });

  it("rejects 1234512345Ab! (numeric walk repeated with minimal variation)", () => {
    expect(getPasswordStrength("1234512345Ab!")).toBe("Weak");
    expect(isAdminPasswordWeak("1234512345Ab!")).toBe(true);
  });
});

// ============================================================================
// Diagonal keyboard-walk detection — containsKeyboardWalk unit tests
// ============================================================================

describe("containsKeyboardWalk", () => {
  it("detects the left-side diagonal walk qazwsx (forward)", () => {
    expect(containsKeyboardWalk("qazwsx")).toBe(true);
  });

  it("detects edcrfv (mid-left diagonal)", () => {
    expect(containsKeyboardWalk("edcrfv")).toBe(true);
  });

  it("detects tgbyhn (center diagonal)", () => {
    expect(containsKeyboardWalk("tgbyhn")).toBe(true);
  });

  it("detects plokij (right-side diagonal)", () => {
    expect(containsKeyboardWalk("plokij")).toBe(true);
  });

  it("detects the number-row prefixed diagonal 1qaz2wsx", () => {
    expect(containsKeyboardWalk("1qaz2wsx")).toBe(true);
  });

  it("detects reverse diagonals (xswzaq → reverse of qazwsx)", () => {
    expect(containsKeyboardWalk("xswzaq")).toBe(true);
  });

  it("detects a horizontal row walk qwerty", () => {
    expect(containsKeyboardWalk("qwerty")).toBe(true);
  });

  it("detects a diagonal embedded in a longer string", () => {
    expect(containsKeyboardWalk("myQazWsx!pass")).toBe(true);
  });

  it("returns false for a high-entropy password with no walk segment", () => {
    expect(containsKeyboardWalk("Tr0ub4dor&3xX")).toBe(false);
  });

  it("returns false for a 5-char walk segment (below MIN_PASSWORD_WALK_LENGTH)", () => {
    expect(containsKeyboardWalk("qazws")).toBe(false);
  });

  it("MIN_PASSWORD_WALK_LENGTH is 6", () => {
    expect(MIN_PASSWORD_WALK_LENGTH).toBe(6);
  });
});

// ============================================================================
// Diagonal keyboard-walk detection — getPasswordStrengthDetail integration
// ============================================================================

describe("getPasswordStrengthDetail — diagonal keyboard-walk passwords rated Weak", () => {
  it("rejects QazWsx1! (qazwsx diagonal walk, 8 chars)", () => {
    const detail = getPasswordStrengthDetail("QazWsx1!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
    expect(isAdminPasswordWeak("QazWsx1!")).toBe(true);
  });

  it("rejects EdCrFv1! (edcrfv diagonal walk, 8 chars)", () => {
    const detail = getPasswordStrengthDetail("EdCrFv1!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects Plokij1! (plokij right-side diagonal, 8 chars)", () => {
    const detail = getPasswordStrengthDetail("Plokij1!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 1Qaz2Wsx! (number-row diagonal 1qaz2wsx, 9 chars)", () => {
    const detail = getPasswordStrengthDetail("1Qaz2Wsx!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects a password with diagonal walk embedded among other chars", () => {
    const detail = getPasswordStrengthDetail("My!QazWsxPw");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects TgByHn99! (tgbyhn center diagonal, 9 chars)", () => {
    const detail = getPasswordStrengthDetail("TgByHn99!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects reversed diagonal XswZaq1! (reverse of qazwsx)", () => {
    const detail = getPasswordStrengthDetail("XswZaq1!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });
});

// ============================================================================
// Number-row diagonal detection — patterns that skip the bottom letter row
// ============================================================================

describe("containsKeyboardWalk — number-row-only diagonal variants", () => {
  it("detects 1qa2ws (number + top-two-letter-rows diagonal, 6 chars)", () => {
    expect(containsKeyboardWalk("1qa2ws")).toBe(true);
  });

  it("detects 2ws3ed (mid-sequence window)", () => {
    expect(containsKeyboardWalk("2ws3ed")).toBe(true);
  });

  it("detects 5tg6yh7uj (right-half of sequence)", () => {
    expect(containsKeyboardWalk("5tg6yh7uj")).toBe(true);
  });

  it("detects the reverse direction (juh7hy6gt5)", () => {
    expect(containsKeyboardWalk("juh7hy6gt5")).toBe(true);
  });
});

describe("getPasswordStrengthDetail — number-row diagonal passwords rated Weak", () => {
  it("rejects 1Qa2Ws3Ed! (number+two-letter-column interleaved walk, 9 chars)", () => {
    const detail = getPasswordStrengthDetail("1Qa2Ws3Ed!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
    expect(isAdminPasswordWeak("1Qa2Ws3Ed!")).toBe(true);
  });

  it("rejects 2Ws3Ed4Rf5Tg! (shifted number-row diagonal walk, 12 chars)", () => {
    const detail = getPasswordStrengthDetail("2Ws3Ed4Rf5Tg!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 3Ed4Rf5Tg6Yh! (mid-keyboard number-row diagonal, 12 chars)", () => {
    const detail = getPasswordStrengthDetail("3Ed4Rf5Tg6Yh!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 5Tg6Yh7UjX! (right-side number-row diagonal walk, 10 chars)", () => {
    const detail = getPasswordStrengthDetail("5Tg6Yh7UjX!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects a number-row diagonal embedded in a longer password", () => {
    const detail = getPasswordStrengthDetail("My!2Ws3Ed4RfPw");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("confirms 2wsX3edC! (task example) is also caught via the full-column sequence", () => {
    const detail = getPasswordStrengthDetail("2wsX3edC!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 8Ik9Ol0P! (right-side number-row diagonal, all three columns)", () => {
    const detail = getPasswordStrengthDetail("8Ik9Ol0P!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 8ik9ol0p (right-side number-row diagonal, lowercase)", () => {
    const detail = getPasswordStrengthDetail("8ik9ol0p");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 8Ik9Ol!! (6-char right-side walk, padded to min length)", () => {
    const detail = getPasswordStrengthDetail("8Ik9Ol!!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects A8Ik9OlZ (right-side walk embedded in a longer password)", () => {
    const detail = getPasswordStrengthDetail("A8Ik9OlZ");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  // Reversed right-side number-row walks: the sequence "8ik9ol0p" reversed is
  // "p0lo9ki8".  The automatic reverse-direction check in containsKeyboardWalk
  // covers all 6-char windows of that reversed sequence.  Additionally, the
  // companion sequence "0p9o8i7u6y5t4r3e2w1q" (sequence B) means that the
  // prefix "0p9o8i" is already a forward-direction match, so passwords that
  // begin with that run are caught from both directions.

  it("rejects 0P9O8I!! (reversed right-side number-row walk, sequence-B prefix)", () => {
    // "0p9o8i" is the 6-char prefix of KEYBOARD_WALK_SEQUENCES entry
    // "0p9o8i7u6y5t4r3e2w1q", caught by the forward direction check.
    const detail = getPasswordStrengthDetail("0P9O8I!!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });

  it("rejects 0Lo9Ki!! (reversed partial window of 8ik9ol0p)", () => {
    // "0lo9ki" is the second 6-char window of "8ik9ol0p" reversed ("p0lo9ki8"),
    // caught by the reverse-direction check on that sequence.
    const detail = getPasswordStrengthDetail("0Lo9Ki!!");
    expect(detail.strength).toBe("Weak");
    expect(detail.weakReason).toBe("keyboard_walk");
  });
});

// ============================================================================
// Diagonal detection does not regress strong or medium passwords
// ============================================================================

describe("getPasswordStrength — diagonal check does not regress valid passwords", () => {
  it("still rates Tr0ub4dor&3xX as Strong", () => {
    expect(getPasswordStrength("Tr0ub4dor&3xX")).toBe("Strong");
  });

  it("still rates X9#mQpLt2@Wz as Strong", () => {
    expect(getPasswordStrength("X9#mQpLt2@Wz")).toBe("Strong");
  });

  it("still rates Abcde123 as Medium (5-char alphabet run, below walk threshold)", () => {
    expect(getPasswordStrength("Abcde123")).toBe("Medium");
  });

  it("still rates MyPass99 as Medium", () => {
    expect(getPasswordStrength("MyPass99")).toBe("Medium");
  });
});

// ============================================================================
// Entropy-based acceptance — strong passwords must still pass
// ============================================================================

describe("getPasswordStrength — high-entropy passwords still accepted", () => {
  it("rates Tr0ub4dor&3xX as Strong (high variety, all character classes)", () => {
    expect(getPasswordStrength("Tr0ub4dor&3xX")).toBe("Strong");
  });

  it("rates C0mpl!anceR0cks as Strong", () => {
    expect(getPasswordStrength("C0mpl!anceR0cks")).toBe("Strong");
  });

  it("rates X9#mQpLt2@Wz as Strong (12 unique chars, H ≈ 3.58)", () => {
    expect(getPasswordStrength("X9#mQpLt2@Wz")).toBe("Strong");
  });

  it("rates MyP@ssw0rdX12! as Strong (high variety, 13+ unique chars)", () => {
    expect(getPasswordStrength("MyP@ssw0rdX12!")).toBe("Strong");
  });

  it("isAdminPasswordWeak returns false for all high-entropy strong passwords", () => {
    const strongPasswords = [
      "Tr0ub4dor&3xX",
      "C0mpl!anceR0cks",
      "X9#mQpLt2@Wz",
      "MyP@ssw0rdX12!",
      "K9$pLmW2@xNzR7!",
    ];
    for (const pw of strongPasswords) {
      expect(isAdminPasswordWeak(pw), `Expected ${pw} to be strong`).toBe(false);
    }
  });
});
