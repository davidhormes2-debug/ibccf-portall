/**
 * Server-side environment validation utilities.
 *
 * Keeping the session-secret blocklist and its helper in ONE place means any
 * future consumer (startup check, middleware, tests) can import from here
 * rather than re-implementing or copying the same `length < 32 || set.has()`
 * logic — the same drift-prevention pattern applied to the admin-password
 * blocklist in `shared/passwordStrength.ts`.
 *
 * `validateEnv()` must be called before the HTTP server binds so that a
 * mis-configured deployment fails fast with a clear diagnostic rather than
 * booting silently and accepting traffic with an insecure configuration.
 *
 * SESSION_SECRET rules:
 *   - Must be present (non-empty)
 *   - Must be at least 32 characters
 *   - Must not match any value in INSECURE_SESSION_SECRET_VALUES
 *
 * ADMIN_PASSWORD rules:
 *   - Must be present (non-empty)
 *   - Must not be rated "Weak" by `isAdminPasswordWeak` from shared/passwordStrength
 *
 * ADMIN_USERNAME rules:
 *   - Must be present (non-empty)
 *   - Must be at least 4 characters long
 *   - Must not be purely numeric (e.g. `1234`)
 *   - Must not be a trivially guessable value (e.g. `admin`, `user`, `root`, `administrator`)
 *   - Must not consist of a single repeated character (e.g. `aaaa`, `xxxxxx`)
 *   - Must not be a common keyboard-walk sequence (e.g. `qwerty`, `asdf`, `zxcv`)
 *
 * Escape hatches for local development:
 *   Set ALLOW_WEAK_SESSION_SECRET=1 to downgrade the SESSION_SECRET fatal exit to a warning.
 *   Set ALLOW_WEAK_ADMIN_PASSWORD=1 to downgrade the ADMIN_PASSWORD fatal exit to a warning.
 *   Set ALLOW_WEAK_ADMIN_USERNAME=1 to downgrade the ADMIN_USERNAME fatal exit to a warning.
 *   These variables are silently ignored when NODE_ENV === 'production' — the fatal exit
 *   always fires in production regardless of escape-hatch state.
 */

import {
  getAdminPasswordWeakReason,
  KEYBOARD_WALK_SEQUENCES,
  TRIVIAL_ADMIN_USERNAMES,
  MIN_ADMIN_USERNAME_LENGTH,
  shannonEntropy,
} from "@shared/passwordStrength";

/**
 * Well-known values that must never be used as the Express session secret.
 * A session secret shorter than 32 characters is also considered insecure
 * regardless of whether it appears in this set (see `isSessionSecretWeak`).
 */
export const INSECURE_SESSION_SECRET_VALUES: ReadonlySet<string> = new Set([
  "secret",
  "supersecret",
  "super-secret",
  "super_secret",
  "your-secret-key",
  "your_secret_key",
  "yoursecretkey",
  "yoursecret",
  "changeme",
  "change-me",
  "change_me",
  "changeme123",
  "keyboard cat",
  "keyboard-cat",
  "keyboard_cat",
  "keyboardcat",
  "mysecret",
  "my-secret",
  "my_secret",
  "mysecretkey",
  "my-secret-key",
  "my_secret_key",
  "sessionSecret",
  "session-secret",
  "session_secret",
  "sessionsecret",
  "express-session-secret",
  "express_session_secret",
  "cookie_secret",
  "cookie-secret",
  "cookiesecret",
  "app_secret",
  "app-secret",
  "appsecret",
  "ibccf-secret",
  "ibccf_secret",
  "ibccfsecret",
  "ibccf_session",
  "ibccf-session",
  "ibccfsession",
  "development",
  "development_secret",
  "development-secret",
  "dev-secret",
  "dev_secret",
  "devsecret",
  "production",
  "production_secret",
  "production-secret",
  "prod-secret",
  "prod_secret",
  "local_secret",
  "local-secret",
  "localsecret",
  "test-secret",
  "test_secret",
  "testsecret",
  "abc123",
  "123456",
  "password",
  "password123",
  "qwerty",
  "letmein",
  "trustno1",
  "12345678901234567890123456789012",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "abcdefghijklmnopqrstuvwxyz123456",
  "a-very-long-random-string-here-32+chars",
  "replace-me-with-a-real-secret-key",
  "replace_me_with_a_real_secret_key",
  "insert_your_session_secret_here",
  "insert-your-session-secret-here",
  "your_session_secret_here",
  "your-session-secret-here",
  "put_your_secret_here",
  "put-your-secret-here",

  // dotenv .env.example patterns (popular in tutorials and scaffold repos)
  "your-32-char-super-secret-and-unique-key",
  "your_32_char_super_secret_and_unique_key",
  "your-super-secret-and-unique-key-32-chars",
  "enter_your_secret_here",
  "enter-your-secret-here",
  "add_your_secret_here",
  "add-your-secret-here",
  "set_your_secret_here",
  "set-your-secret-here",
  "generate_a_random_secret",
  "generate-a-random-secret",
  "replace-with-your-secret",
  "replace_with_your_secret",

  // "change this" variants seen in Docker Compose and scaffold defaults
  "change_this",
  "change-this",
  "changethis",
  "change_this_secret",
  "change-this-secret",
  "changethissecret",
  "change_this_to_something_random",
  "change-this-to-something-random",
  "please-change-this-secret",
  "please_change_this_secret",
  "super-secret-key-change-me",
  "super_secret_key_change_me",
  "super-secret-key-that-needs-to-be-changed",
  "this-is-not-a-secret",
  "not-a-real-secret",
  "not_a_real_secret",

  // generic "secret-key" family missing from above
  "secretkey",
  "secret-key",
  "secret_key",
  "app_secret_key",
  "app-secret-key",
  "app_key",
  "app-key",
  "appkey",
  "application-key",
  "application_key",

  // JWT / auth-related placeholders frequently copy-pasted into session config
  "jwt-secret",
  "jwt_secret",
  "jwtsecret",
  "auth-secret",
  "auth_secret",
  "authsecret",
  "auth-key",
  "auth_key",
  "authkey",
  "token-secret",
  "token_secret",
  "tokensecret",

  // NextAuth / NextJS scaffold defaults
  "nextauth-secret",
  "nextauth_secret",
  "next-auth-secret",
  "next_auth_secret",

  // NestJS scaffold defaults
  "nest-secret",
  "nest_secret",
  "nestjs-secret",
  "nestjs_secret",

  // placeholder / example / demo / dummy / fake families
  "placeholder",
  "placeholder-secret",
  "placeholder_secret",
  "example-secret",
  "example_secret",
  "sample-secret",
  "sample_secret",
  "demo-secret",
  "demo_secret",
  "dummy-secret",
  "dummy_secret",
  "fake-secret",
  "fake_secret",
  "testing-secret",
  "testing_secret",

  // repetitive-character 32-char strings (satisfy length, still insecure)
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "00000000000000000000000000000000",
  "11111111111111111111111111111111",
  "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
]);

/**
 * Alias kept for backwards compatibility and test imports.
 * @deprecated Use `INSECURE_SESSION_SECRET_VALUES` instead.
 */
export const WEAK_SESSION_SECRETS = INSECURE_SESSION_SECRET_VALUES;

// TRIVIAL_ADMIN_USERNAMES, MIN_ADMIN_USERNAME_LENGTH, KEYBOARD_WALK_SEQUENCES,
// and shannonEntropy are re-exported from @shared/passwordStrength (single
// source of truth) via the import at the top of this file.  Keep them exported
// from here so existing consumers (server tests, admin routes) can import from
// either location without a breaking change.
export { TRIVIAL_ADMIN_USERNAMES, MIN_ADMIN_USERNAME_LENGTH, KEYBOARD_WALK_SEQUENCES, shannonEntropy };

/**
 * Minimum Shannon entropy (bits per character) required for a session secret
 * to be considered strong.
 *
 * Rationale: A truly random hex string (16 symbols) has entropy log₂(16) = 4
 * bits/char. Keyboard-walk strings such as "qwertyuiopqwertyuiop…" score
 * ≈ 3.3 bits/char; short repeated patterns like "abcabcabc…" score ≈ 1.6
 * bits/char. A threshold of 3.5 bits/char rejects both classes while
 * comfortably accepting any reasonably random 32+-character secret (hex,
 * base64, UUID-derived, openssl rand output, etc.).
 */
export const MIN_SESSION_SECRET_ENTROPY = 3.5;

/**
 * Identifies the specific reason a session secret is considered weak.
 *
 * - `too_short`   — absent or fewer than 32 characters.
 * - `blocklisted` — matches a known-insecure placeholder value.
 * - `low_entropy` — Shannon entropy is below the minimum threshold, indicating
 *                   a repeated pattern, keyboard walk, or other predictable value.
 */
export type SessionSecretWeakReason = "too_short" | "blocklisted" | "low_entropy";

/**
 * Returns the specific reason the secret is weak, or `null` when the secret
 * passes all checks (i.e. it is strong enough to use).
 *
 * Callers that only need a boolean can use `isSessionSecretWeak` instead.
 */
export function getSessionSecretWeakReason(
  secret: string | undefined,
): SessionSecretWeakReason | null {
  if (!secret || secret.length < 32) return "too_short";
  if (INSECURE_SESSION_SECRET_VALUES.has(secret.toLowerCase())) return "blocklisted";
  if (shannonEntropy(secret) < MIN_SESSION_SECRET_ENTROPY) return "low_entropy";
  return null;
}

/**
 * Returns `true` when the given value is too weak to use as a session secret.
 *
 * A value is considered weak when any of the following are true:
 * - It is absent or its length is less than 32 characters (too short to resist brute-force).
 * - It appears in `INSECURE_SESSION_SECRET_VALUES` (commonly known placeholder).
 * - Its Shannon entropy is below `MIN_SESSION_SECRET_ENTROPY` (repeated pattern or keyboard walk).
 */
export function isSessionSecretWeak(secret: string | undefined): boolean {
  return getSessionSecretWeakReason(secret) !== null;
}

/**
 * Identifies the specific reason an admin username is considered trivial.
 *
 * - `missing`       — absent or empty string.
 * - `too_short`     — fewer than `MIN_ADMIN_USERNAME_LENGTH` characters.
 * - `purely_numeric`— consists entirely of ASCII digits (e.g. `1234`).
 * - `blocklisted`   — matches a known trivially-guessable value in `TRIVIAL_ADMIN_USERNAMES`.
 * - `repeated_char` — consists of a single character repeated (e.g. `aaaa`, `xxxxxx`).
 * - `keyboard_walk` — is a contiguous substring of a known keyboard-walk sequence (e.g. `qwerty`).
 */
export type AdminUsernameTrivialReason =
  | "missing"
  | "too_short"
  | "purely_numeric"
  | "blocklisted"
  | "repeated_char"
  | "keyboard_walk";

/**
 * Returns the specific reason the username is trivial, or `null` when the
 * username passes all checks (i.e. it is acceptable to use).
 *
 * Callers that only need a boolean can use `isAdminUsernameTrivial` instead.
 */
export function getAdminUsernameTrivialReason(
  username: string | undefined,
): AdminUsernameTrivialReason | null {
  if (!username) return "missing";
  if (username.length < MIN_ADMIN_USERNAME_LENGTH) return "too_short";
  if (/^\d+$/.test(username)) return "purely_numeric";
  if (TRIVIAL_ADMIN_USERNAMES.has(username.toLowerCase())) return "blocklisted";

  const lower = username.toLowerCase();

  if (new Set(lower).size === 1) return "repeated_char";

  for (const seq of KEYBOARD_WALK_SEQUENCES) {
    const rev = seq.split("").reverse().join("");
    if (seq.includes(lower) || rev.includes(lower)) return "keyboard_walk";
  }

  return null;
}

/**
 * Returns `true` when the given value is too trivial to use as the admin username.
 *
 * A value is considered trivial when any of the following are true:
 * - It is absent or empty, or
 * - It is shorter than `MIN_ADMIN_USERNAME_LENGTH` characters, or
 * - It consists only of ASCII digits (e.g. `1234`), or
 * - It appears in `TRIVIAL_ADMIN_USERNAMES` (case-insensitive match), or
 * - It consists of a single character repeated (e.g. `aaaa`, `xxxxxx`), or
 * - It is a contiguous substring of a known keyboard-walk sequence (e.g. `qwerty`, `asdf`).
 */
export function isAdminUsernameTrivial(username: string | undefined): boolean {
  return getAdminUsernameTrivialReason(username) !== null;
}

/**
 * Returns `true` when `ALLOW_WEAK_ADMIN_PASSWORD=1` is present in the
 * environment, regardless of whether `NODE_ENV` is production.
 *
 * In production the escape hatch is already ignored by `validateEnv()` (the
 * fatal exit fires anyway), but the flag may still be SET, which is itself a
 * misconfiguration that should be visible to admins.
 */
export function isWeakAdminPasswordAllowed(): boolean {
  return process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1";
}

/**
 * Returns `true` when `ALLOW_WEAK_SESSION_SECRET=1` is present in the
 * environment, regardless of whether `NODE_ENV` is production.
 *
 * In production the escape hatch is already ignored by `validateEnv()` (the
 * fatal exit fires anyway), but the flag may still be SET, which is itself a
 * misconfiguration that should be visible to admins.
 */
export function isWeakSessionSecretAllowed(): boolean {
  return process.env.ALLOW_WEAK_SESSION_SECRET === "1";
}

/**
 * Validate critical environment variables at process startup.
 *
 * Exits the process with code 1 on fatal mis-configuration unless the
 * relevant escape-hatch variable is set (development use only).
 */
export function validateEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET;
  const allowWeakSecret =
    !isProduction && process.env.ALLOW_WEAK_SESSION_SECRET === "1";

  const secretWeakReason = getSessionSecretWeakReason(secret);
  if (secretWeakReason !== null) {
    let detail: string;
    if (secretWeakReason === "too_short") {
      detail =
        "SESSION_SECRET is missing or shorter than 32 characters. " +
        "Set a strong, random secret of at least 32 characters " +
        "(e.g. `openssl rand -hex 32`).";
    } else if (secretWeakReason === "blocklisted") {
      detail =
        "SESSION_SECRET matches a known-insecure placeholder value. " +
        "Replace it with a unique, random secret of at least 32 characters " +
        "(e.g. `openssl rand -hex 32`).";
    } else {
      detail =
        "SESSION_SECRET entropy is too low — it looks like a repeated pattern " +
        "or keyboard walk and is too predictable to be safe. " +
        "Generate a truly random secret (e.g. `openssl rand -hex 32`).";
    }
    const msg =
      `[SECURITY] ${detail} ` +
      "To bypass this check in local development only, set ALLOW_WEAK_SESSION_SECRET=1.";

    if (allowWeakSecret) {
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const allowWeakAdminPassword =
    !isProduction && process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1";

  const adminPasswordWeakReason = getAdminPasswordWeakReason(adminPassword);
  if (adminPasswordWeakReason !== null) {
    let detail: string;
    if (adminPasswordWeakReason === "missing") {
      detail =
        "ADMIN_PASSWORD is missing or empty. " +
        "Set a strong password of at least 12 characters with mixed-case letters, a digit, and a special character " +
        "(e.g. `openssl rand -base64 16`).";
    } else if (adminPasswordWeakReason === "too_short") {
      detail =
        "ADMIN_PASSWORD is too short (fewer than 8 characters — shorter than 8). " +
        "Set a strong password of at least 12 characters with mixed-case letters, a digit, and a special character " +
        "(e.g. `openssl rand -base64 16`).";
    } else if (adminPasswordWeakReason === "blocklisted") {
      detail =
        "ADMIN_PASSWORD matches a well-known weak password — it appears on a common password list. " +
        "Choose a unique password that is not a commonly known value " +
        "(e.g. `openssl rand -base64 16`).";
    } else if (adminPasswordWeakReason === "keyboard_walk") {
      detail =
        "ADMIN_PASSWORD contains a common keyboard-walk sequence (e.g. qwerty, qazwsx, edcrfv). " +
        "Choose a password that does not follow a predictable key pattern " +
        "(e.g. `openssl rand -base64 16`).";
    } else {
      detail =
        "ADMIN_PASSWORD entropy is too low — it looks like a repeated character pattern and is too predictable to be safe. " +
        "Avoid repeating the same characters or sub-patterns (e.g. 'abcabcABCABC12!' is rejected). " +
        "Generate a truly random password (e.g. `openssl rand -base64 16`).";
    }
    const msg =
      `[SECURITY] ${detail} ` +
      "To bypass this check in local development only, set ALLOW_WEAK_ADMIN_PASSWORD=1.";

    if (allowWeakAdminPassword) {
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const allowWeakAdminUsername =
    !isProduction && process.env.ALLOW_WEAK_ADMIN_USERNAME === "1";

  const usernameWeakReason = getAdminUsernameTrivialReason(adminUsername);
  if (usernameWeakReason !== null) {
    let detail: string;
    if (usernameWeakReason === "missing") {
      detail =
        "ADMIN_USERNAME is missing or empty. " +
        `Set a unique, non-guessable username at least ${MIN_ADMIN_USERNAME_LENGTH} characters long ` +
        "(e.g. `ibccf_ops_9x`).";
    } else if (usernameWeakReason === "too_short") {
      detail =
        `ADMIN_USERNAME is shorter than ${MIN_ADMIN_USERNAME_LENGTH} characters. ` +
        `Set a username at least ${MIN_ADMIN_USERNAME_LENGTH} characters long ` +
        "(e.g. `ibccf_ops_9x`).";
    } else if (usernameWeakReason === "purely_numeric") {
      detail =
        "ADMIN_USERNAME consists entirely of digits. " +
        "Use a username that contains letters (e.g. `ibccf_ops_9x`).";
    } else if (usernameWeakReason === "blocklisted") {
      detail =
        "ADMIN_USERNAME matches a well-known trivial value (e.g. admin, user, root, administrator). " +
        "Choose a unique, non-guessable username (e.g. `ibccf_ops_9x`).";
    } else if (usernameWeakReason === "repeated_char") {
      detail =
        "ADMIN_USERNAME consists of a single repeated character (e.g. aaaa, xxxxxx). " +
        "Choose a username with varied characters (e.g. `ibccf_ops_9x`).";
    } else {
      detail =
        "ADMIN_USERNAME is a common keyboard-walk sequence (e.g. qwerty, asdf, zxcv). " +
        "Choose a username that is not a predictable key pattern (e.g. `ibccf_ops_9x`).";
    }
    const msg =
      `[SECURITY] ${detail} ` +
      "To bypass this check in local development only, set ALLOW_WEAK_ADMIN_USERNAME=1.";

    if (allowWeakAdminUsername) {
      console.warn(msg);
    } else {
      console.error(msg);
      process.exit(1);
    }
  }

  // ESCAPE_HATCH_GUARD_START
  // In production, escape-hatch flags must never be active — even when the
  // credentials themselves are strong. Fail fast here (before the HTTP server
  // binds or static files are served) so the process exits with a clear
  // [SECURITY] message rather than a cryptic internal error later.
  if (isProduction) {
    const productionFlags: string[] = [];
    if (process.env.ALLOW_WEAK_SESSION_SECRET === "1")
      productionFlags.push("ALLOW_WEAK_SESSION_SECRET");
    if (process.env.ALLOW_WEAK_ADMIN_PASSWORD === "1")
      productionFlags.push("ALLOW_WEAK_ADMIN_PASSWORD");
    if (process.env.ALLOW_WEAK_ADMIN_USERNAME === "1")
      productionFlags.push("ALLOW_WEAK_ADMIN_USERNAME");
    if (productionFlags.length > 0) {
      console.error(
        `[SECURITY] The server cannot start because one or more development ` +
          `escape-hatch flags (${productionFlags.join(", ")}) are active in a production deployment. ` +
          "Remove these flags from your production environment and restart.",
      );
      process.exit(1);
    }
  }
}
