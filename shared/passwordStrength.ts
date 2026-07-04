/**
 * Shared password-strength utilities used by both the server (startup/login
 * validation in server/routes/admin.ts) and the client (AdminDashboard
 * password-strength meter).
 *
 * Keeping the list and the rating function in ONE place means the two
 * consumers can never silently diverge — there is nothing to sync.
 */

/**
 * Well-known weak passwords that are trivially guessable even when they
 * technically meet length requirements.  The server startup check and the
 * client-side strength meter both reference this set so they always agree
 * on what constitutes "Weak".
 */
export const WEAK_ADMIN_PASSWORDS: ReadonlySet<string> = new Set([
  "password",
  "password1",
  "password123",
  "Password1",
  "Password123",
  "Password1!",
  "P@ssw0rd",
  "P@ssword1",
  "Passw0rd",
  "admin",
  "admin123",
  "Admin123",
  "Admin1234",
  "admin1234",
  "administrator",
  "Administrator",
  "letmein",
  "letmein1",
  "welcome",
  "welcome1",
  "Welcome1",
  "qwerty",
  "qwerty123",
  "Qwerty123",
  "abc123",
  "Abc123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "iloveyou",
  "sunshine",
  "monkey",
  "dragon",
  "master",
  "superman",
  "batman",
  "trustno1",
  "changeme",
  "changeme1",
  "ChangeMe1",
  "ibccf",
  "ibccf123",
  "Ibccf123",
  "blockchain",
  "Blockchain1",
  "compliance",
  "Compliance1",
]);

export type PasswordStrength = "Weak" | "Medium" | "Strong";

/**
 * The specific reason a password is rated "Weak".
 *
 * - `too_short`          — fewer than 8 characters.
 * - `blocklisted`        — appears in WEAK_ADMIN_PASSWORDS.
 * - `keyboard_walk`      — contains a consecutive sequence of ≥
 *                          MIN_PASSWORD_WALK_LENGTH characters from a known
 *                          keyboard-walk path (rows, diagonals, alphabet).
 * - `repetitive_pattern` — ≥ 12 chars but Shannon entropy below MIN_PASSWORD_ENTROPY
 *                          (repeated-pattern or keyboard-walk passwords that
 *                          weren't caught by the explicit walk check).
 */
export type PasswordWeakReason =
  | "too_short"
  | "blocklisted"
  | "keyboard_walk"
  | "repetitive_pattern";

/**
 * Human-readable hint text for each weak-password reason.  Shown beneath
 * the password input in the strength meter.
 */
export const PASSWORD_WEAK_HINTS: Record<PasswordWeakReason, string> = {
  too_short: "Password must be at least 8 characters.",
  blocklisted: "This is a well-known weak password — choose something unique.",
  keyboard_walk:
    "Password contains a common keyboard sequence (e.g. qwerty, qazwsx, edcrfv).",
  repetitive_pattern: "Avoid repeating character patterns (e.g. abcabcABC, qwertyQWERTY).",
};

/**
 * Extended result from `getPasswordStrengthDetail`.
 * `weakReason` is set only when `strength === "Weak"`.
 */
export interface PasswordStrengthDetail {
  strength: PasswordStrength;
  weakReason?: PasswordWeakReason;
}

/**
 * Computes the Shannon entropy (bits per character) of a string.
 *
 * Defined here (the shared module) so it is importable from both the client
 * bundle and the server without pulling in Node-only dependencies.
 * `server/env.ts` has its own copy of this helper for the session-secret
 * strength check; the two implementations are intentionally independent to
 * keep the shared module free of cross-cutting server concerns.
 *
 * Reference values:
 *   "aaa…"   (1 unique char)              →  0    bits/char
 *   "abcabc…" (3 unique chars, balanced)  → ~1.58 bits/char
 *   repeated-pattern "abcabcABCABC12!"    → ~3.1  bits/char
 *   12-char all-unique random string      → ~3.58 bits/char
 *   hex-random (16 unique chars, balanced)→  4    bits/char
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Minimum number of consecutive characters from a `KEYBOARD_WALK_SEQUENCES`
 * entry that must appear in a password for it to be flagged as a keyboard
 * walk.
 *
 * 6 is chosen to avoid false positives on short common substrings (e.g. "asdf"
 * in a legitimate password) while reliably catching obvious diagonal and
 * row-based walks such as "qazwsx", "edcrfv", "qwerty", "123456", etc.
 */
export const MIN_PASSWORD_WALK_LENGTH = 6;

/**
 * Returns `true` when the lowercased password contains any contiguous
 * substring of length ≥ MIN_PASSWORD_WALK_LENGTH that is itself a contiguous
 * substring of one of the `KEYBOARD_WALK_SEQUENCES` entries (checked in both
 * forward and reverse directions).
 *
 * This mirrors the keyboard-walk detection used by `getUsernameTrivialReason`
 * but operates on a sliding window rather than a full-string match, because
 * a password may contain a walk segment embedded within otherwise varied
 * characters.
 */
export function containsKeyboardWalk(password: string): boolean {
  const lower = password.toLowerCase();
  for (const seq of KEYBOARD_WALK_SEQUENCES) {
    for (const s of [seq, seq.split("").reverse().join("")]) {
      for (let i = 0; i <= s.length - MIN_PASSWORD_WALK_LENGTH; i++) {
        const sub = s.slice(i, i + MIN_PASSWORD_WALK_LENGTH);
        if (lower.includes(sub)) return true;
      }
    }
  }
  return false;
}

/**
 * Minimum Shannon entropy (bits per character) required for an admin password
 * to be considered at least Medium strength.
 *
 * Rationale: a 12-character all-unique password drawn from a typical mixed
 * charset has entropy log₂(12) ≈ 3.58 bits/char. Repeated-pattern passwords
 * such as "abcabcABCABC12!" score ≈ 3.1 bits/char; alternating or keyboard-walk
 * passwords score even lower. A threshold of 3.2 bits/char cleanly rejects both
 * classes while comfortably accepting any genuinely varied password of 12+
 * characters (≥ 11 distinct characters out of 12).
 */
export const MIN_PASSWORD_ENTROPY = 3.2;

/**
 * Rate a password's strength.
 *
 * - "Weak"   — length < 8, OR the password appears in WEAK_ADMIN_PASSWORDS,
 *              OR it is ≥ 12 characters but has Shannon entropy below
 *              MIN_PASSWORD_ENTROPY (repeated-pattern / keyboard-walk passwords
 *              that fool character-class checks)
 * - "Strong" — length ≥ 12, has uppercase + lowercase + digit + special char,
 *              is not in the weak list, and has sufficient entropy
 * - "Medium" — everything else
 *
 * Note: the entropy gate only activates for passwords ≥ 12 characters.
 * Shorter passwords cannot achieve high entropy by construction (an 8-char
 * all-unique string tops out at log₂(8) = 3.0 bits/char) and are already
 * constrained by the length and character-class requirements.
 */
export function getPasswordStrength(password: string): PasswordStrength {
  return getPasswordStrengthDetail(password).strength;
}

/**
 * Like `getPasswordStrength`, but also returns the specific reason the password
 * is rated "Weak" when applicable.  Use this on surfaces that need to explain
 * the failure to the user (e.g. the AdminDashboard password-strength meter).
 */
export function getPasswordStrengthDetail(password: string): PasswordStrengthDetail {
  if (!password || password.length < 8) {
    return { strength: "Weak", weakReason: "too_short" };
  }
  if (WEAK_ADMIN_PASSWORDS.has(password)) {
    return { strength: "Weak", weakReason: "blocklisted" };
  }
  if (containsKeyboardWalk(password)) {
    return { strength: "Weak", weakReason: "keyboard_walk" };
  }
  if (
    password.length >= 12 &&
    shannonEntropy(password) < MIN_PASSWORD_ENTROPY
  ) {
    return { strength: "Weak", weakReason: "repetitive_pattern" };
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (
    password.length >= 12 &&
    hasUpper &&
    hasLower &&
    hasDigit &&
    hasSpecial
  ) {
    return { strength: "Strong" };
  }

  return { strength: "Medium" };
}

/**
 * Returns true when the given password should be rejected as too weak for an
 * admin account.  Mirrors the server-side startup check so the client strength
 * meter and the server always agree on the "Weak" boundary.
 */
export function isAdminPasswordWeak(password: string): boolean {
  return getPasswordStrength(password) === "Weak";
}

/**
 * The specific reason an admin password is rejected at startup.
 *
 * Extends `PasswordWeakReason` with a `missing` variant for the case where
 * the env var is absent or empty — a state that can only arise at the server
 * level (the client strength meter always has a string to rate).
 *
 * - `missing`            — absent or empty string.
 * - `too_short`          — fewer than 8 characters.
 * - `blocklisted`        — appears in WEAK_ADMIN_PASSWORDS.
 * - `keyboard_walk`      — contains a consecutive keyboard-walk segment.
 * - `repetitive_pattern` — long but low Shannon entropy (repeated pattern).
 */
export type AdminPasswordWeakReason =
  | "missing"
  | "too_short"
  | "blocklisted"
  | "keyboard_walk"
  | "repetitive_pattern";

/**
 * Returns the specific reason the admin password would be rejected at startup,
 * or `null` when the password passes all checks (i.e. it is strong enough).
 *
 * Unlike `getPasswordStrengthDetail`, this function also handles the `missing`
 * case (undefined / empty string) so that `validateEnv()` can emit a distinct
 * diagnostic message for every failure mode.
 *
 * Callers that only need a boolean can use `isAdminPasswordWeak` instead.
 */
export function getAdminPasswordWeakReason(
  password: string | undefined,
): AdminPasswordWeakReason | null {
  if (!password) return "missing";
  const detail = getPasswordStrengthDetail(password);
  if (detail.strength !== "Weak") return null;
  return detail.weakReason ?? "too_short";
}

/**
 * Human-readable hint text for each `AdminPasswordWeakReason`.  Mirrors
 * `PASSWORD_WEAK_HINTS` but adds the server-only `missing` variant so the admin
 * login page can surface a targeted, operator-facing hint when the configured
 * ADMIN_PASSWORD is rejected at login time.
 *
 * Phrased for the operator (who controls the env var) rather than an end user
 * picking a new password, since this hint appears on the login screen when the
 * deployed ADMIN_PASSWORD itself is too weak.
 */
export const ADMIN_PASSWORD_WEAK_HINTS: Record<AdminPasswordWeakReason, string> = {
  missing: "ADMIN_PASSWORD is not configured — set a strong password before logging in.",
  too_short: "ADMIN_PASSWORD is too short — use at least 8 characters.",
  blocklisted:
    "ADMIN_PASSWORD is a well-known weak password — choose something unique.",
  keyboard_walk:
    "ADMIN_PASSWORD contains a common keyboard sequence (e.g. qwerty, qazwsx, edcrfv).",
  repetitive_pattern:
    "ADMIN_PASSWORD uses a repeating character pattern (e.g. abcabcABC, qwertyQWERTY).",
};

// ============================================================================
// Admin-username strength — shared between the client strength meter and any
// future server consumer that cannot import from `server/env.ts` directly
// (e.g. a shared validation package).  This file is already imported by both
// the client bundle and the server, so it stays free of Node-only deps.
// ============================================================================

/**
 * Minimum allowed length for an admin username. Anything shorter is trivially
 * brute-forceable regardless of character composition.
 *
 * Imported by `server/env.ts` as the single source of truth.
 */
export const MIN_ADMIN_USERNAME_LENGTH = 4;

/**
 * Common keyboard-walk sequences (rows on a standard QWERTY layout, plus the
 * sequential alphabet). A username whose lowercased value is a contiguous
 * substring of any of these strings — and is at least
 * `MIN_ADMIN_USERNAME_LENGTH` characters long — is considered a keyboard walk
 * and therefore trivially guessable.
 *
 * Both the forward and reverse directions are checked so that `ytrewq` and
 * `lkjhgfdsa` are caught as well.
 *
 * Imported by `server/env.ts` as the single source of truth.
 */
export const KEYBOARD_WALK_SEQUENCES: ReadonlyArray<string> = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
  "abcdefghijklmnopqrstuvwxyz",
  // Diagonal QWERTY paths — each column read top-to-bottom (row1→row2→row3→row4),
  // chained left-to-right: qaz + wsx + edc + rfv + tgb + yhn + ujm
  "qazwsxedcrfvtgbyhnujm",
  // Same diagonal prefixed with the number row: 1qaz + 2wsx + 3edc + 4rfv + 5tgb + 6yhn + 7ujm
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm",
  // Right-side down-left diagonal zigzag across rows 2 and 3: p→l, o→k, i→j, u→h, b→y→g→v
  "plokijuhbygv",
  // Number-row-only diagonals: alternating number key then the letter directly below it,
  // left-to-right (1→q, 2→w, 3→e … 0→p) and right-to-left (0→p, 9→o, 8→i … 1→q).
  // Together with the automatic reverse check these four walks are covered:
  //   forward  of seq A: 1q2w3e4r5t6y7u8i9o0p
  //   reverse  of seq A: p0o9i8u7y6t5r4e3w2q1
  //   forward  of seq B: 0p9o8i7u6y5t4r3e2w1q
  //   reverse  of seq B: q1w2e3r4t5y6u7i8o9p0
  "1q2w3e4r5t6y7u8i9o0p",
  "0p9o8i7u6y5t4r3e2w1q",
  // Number-row + top-two-letter-rows diagonal: number key followed by the two letters
  // directly below it in that column, chained across columns left-to-right.
  // Covers patterns like "1Qa2Ws3Ed!" or "2Ws3Ed4Rf5Tg!" where the user walks across
  // columns using the number plus the first two letter rows (but skips the bottom row),
  // which does NOT appear as a substring of the full-column sequence above.
  //   Example 6-char windows: 1qa2ws, 2ws3ed, 3ed4rf, 4rf5tg, 5tg6yh, 6yh7uj
  "1qa2ws3ed4rf5tg6yh7uj",
  // Right-side columns 8–0: number key followed by the two letters directly below
  // it (top-row then middle-row), chained left-to-right across those three columns.
  //   Column 8 → i, k   Column 9 → o, l   Column 0 → p, ;  (semicolon omitted — not
  //   a letter, but the number+two-letter walk is fully covered by 8ik9ol0p)
  //   Example 6-char windows: 8ik9ol, 9ol0p
  "8ik9ol0p",
];

/**
 * Well-known trivial values that must never be used as the admin username.
 * These are common defaults that dramatically reduce brute-force resistance.
 *
 * Imported by `server/env.ts` as the single source of truth.
 */
export const TRIVIAL_ADMIN_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "user",
  "root",
  "superuser",
  "super",
  "sysadmin",
  "system",
  "manager",
  "owner",
  "operator",
  "moderator",
  "mod",
  "staff",
  "support",
  "helpdesk",
  "service",
  "guest",
  "test",
  "demo",
  "dev",
  "developer",
  "ibccf",
  "ibccfadmin",
  "ibccf_admin",
  "ibccf-admin",
]);

/**
 * The specific reason a username is considered trivial.
 *
 * - `too_short`       — fewer than `MIN_ADMIN_USERNAME_LENGTH` characters.
 * - `purely_numeric`  — consists only of ASCII digits.
 * - `blocklisted`     — matches a well-known trivial value (case-insensitive).
 * - `repeated_char`   — all characters are the same (e.g. `aaaa`, `xxxxxx`).
 * - `keyboard_walk`   — is a contiguous substring of a QWERTY keyboard row or
 *                       the sequential alphabet (forward or reversed).
 */
export type UsernameTrivialReason =
  | "too_short"
  | "purely_numeric"
  | "blocklisted"
  | "repeated_char"
  | "keyboard_walk";

/**
 * Returns the specific reason the username is trivial, or `null` when it
 * passes all checks and is considered acceptable.
 *
 * Callers that only need a boolean can use `isAdminUsernameTrivial` instead.
 */
export function getUsernameTrivialReason(
  username: string | undefined,
): UsernameTrivialReason | null {
  if (!username || username.length < MIN_ADMIN_USERNAME_LENGTH) return "too_short";
  if (/^\d+$/.test(username)) return "purely_numeric";

  const lower = username.toLowerCase();

  if (TRIVIAL_ADMIN_USERNAMES.has(lower)) return "blocklisted";
  if (new Set(lower).size === 1) return "repeated_char";

  for (const seq of KEYBOARD_WALK_SEQUENCES) {
    const rev = seq.split("").reverse().join("");
    if (seq.includes(lower) || rev.includes(lower)) return "keyboard_walk";
  }

  return null;
}

/**
 * Returns `true` when the given value is too trivial to use as the admin
 * username.  Imported by `server/env.ts` as the single source of truth so
 * the client strength meter and the server always agree.
 */
export function isAdminUsernameTrivial(username: string | undefined): boolean {
  return getUsernameTrivialReason(username) !== null;
}

/**
 * Human-readable hint text for each trivial-username reason.  Shown beneath
 * the username input in the Settings strength meter.
 */
export const USERNAME_TRIVIAL_HINTS: Record<UsernameTrivialReason, string> = {
  too_short: `Username must be at least ${MIN_ADMIN_USERNAME_LENGTH} characters.`,
  purely_numeric: "Username cannot be purely numeric.",
  blocklisted: "Username is a well-known default — choose something unique.",
  repeated_char: "Username uses only a single repeated character (e.g. aaaa).",
  keyboard_walk: "Username is a common keyboard sequence (e.g. qwerty, asdf, zxcv).",
};
