/**
 * Satisfaction-rating eligibility tokens.
 *
 * A lightweight HMAC-SHA256 receipt issued by the server when a visitor's
 * session ends with `hadChat=true`.  The token encodes:
 *   v  — visitorId (string)
 *   c  — caseId    (number)
 *   e  — expiry    (unix seconds, UTC)
 *   n  — nonce     (random hex string, unique per issued token)
 *
 * Format on the wire:
 *   <base64url(JSON payload)>.<hex HMAC-SHA256>
 *
 * The HMAC key is derived from SESSION_SECRET via a dedicated purpose label so
 * it is namespaced away from the Express session cookie secret even though both
 * share the same underlying env-var.
 *
 * Verification replaces the `visitorHadChatForCase` DB read that previously ran
 * on every POST /api/visitors/satisfaction request, removing the attack surface
 * where IP-rotating bots could drive unbounded DB reads.  The per-IP rate limit
 * (first line of defence) is retained unchanged.
 *
 * Single-use enforcement: `verifySatisfactionToken` only checks the signature,
 * expiry, and visitor/case binding — it does NOT hit the database and cannot
 * by itself know whether a token has already been redeemed. Callers MUST take
 * the `nonce` returned on a successful verification and atomically claim it
 * via `storage.claimSatisfactionTokenNonce()` (backed by a DB primary-key
 * insert, so it is authoritative across every autoscale instance) before
 * treating the request as eligible. This also bounds the blast radius of a
 * SESSION_SECRET compromise: even a forged token can only ever be redeemed
 * once, and rotating the secret invalidates all outstanding tokens instantly
 * without needing to enumerate or revoke individual nonces.
 */

import crypto from "crypto";

/** Token lifetime in seconds (24 h — plenty of window to submit after chat). */
export const SATISFACTION_TOKEN_TTL_S = 24 * 60 * 60;

/** Hex-encoded HMAC-SHA256 length (32 bytes → 64 hex chars). */
const SIG_LEN = 64;

interface TokenPayload {
  v: string;  // visitorId
  c: string;  // caseId (varchar in DB)
  e: number;  // expiry (unix seconds)
  n: string;  // nonce (random hex, unique per issued token)
}

/** Length (bytes) of the random nonce embedded in each token. */
const NONCE_BYTES = 16;

function deriveKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set; cannot issue satisfaction tokens");
  }
  // Namespace the key so tokens are distinct from session cookies.
  return crypto
    .createHmac("sha256", secret)
    .update("satisfaction-token-v1")
    .digest("hex");
}

function toBase64Url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function sign(payload64: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload64).digest("hex");
}

/**
 * Issue a satisfaction-rating eligibility token for the given visitor + case.
 *
 * @param visitorId  Visitor identifier (string, as stored in active_visitors).
 * @param caseId     Case ID (varchar as stored in DB).
 * @param nowMs      Current time in ms (injectable for tests; defaults to Date.now()).
 * @returns          Opaque token string to include in the `end-session` response.
 */
export function issueSatisfactionToken(
  visitorId: string,
  caseId: string,
  nowMs: number = Date.now(),
): string {
  const payload: TokenPayload = {
    v: visitorId,
    c: caseId,
    e: Math.floor(nowMs / 1000) + SATISFACTION_TOKEN_TTL_S,
    n: crypto.randomBytes(NONCE_BYTES).toString("hex"),
  };
  const payload64 = toBase64Url(JSON.stringify(payload));
  const key = deriveKey();
  const sig = sign(payload64, key);
  return `${payload64}.${sig}`;
}

/** Result returned by `verifySatisfactionToken`. */
export type VerifyResult =
  | { ok: true; nonce: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "mismatch" };

/**
 * Verify a satisfaction token previously issued by `issueSatisfactionToken`.
 *
 * Returns `{ ok: true, nonce, expiresAt }` only when all of the following hold:
 *   - The token is correctly structured and the signature is valid.
 *   - The token has not expired.
 *   - The encoded `visitorId` and `caseId` match the supplied values.
 *
 * IMPORTANT: a truthy `ok` here means the token is *authentic*, not that it
 * hasn't been used before. Callers MUST additionally claim `nonce` via
 * `storage.claimSatisfactionTokenNonce(nonce, expiresAt)` and reject the
 * request if that returns `false` — see the module doc-comment above.
 *
 * @param token      Token string from the client request body.
 * @param visitorId  Claimed visitorId from the request body.
 * @param caseId     Claimed caseId from the request body (varchar as stored in DB).
 * @param nowMs      Current time in ms (injectable for tests; defaults to Date.now()).
 */
export function verifySatisfactionToken(
  token: string,
  visitorId: string,
  caseId: string,
  nowMs: number = Date.now(),
): VerifyResult {
  const dot = token.lastIndexOf(".");
  if (dot < 1 || token.length - dot - 1 !== SIG_LEN) {
    return { ok: false, reason: "malformed" };
  }

  const payload64 = token.slice(0, dot);
  const receivedSig = token.slice(dot + 1);

  let key: string;
  try {
    key = deriveKey();
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expectedSig = sign(payload64, key);
  if (!crypto.timingSafeEqual(Buffer.from(receivedSig, "hex"), Buffer.from(expectedSig, "hex"))) {
    return { ok: false, reason: "signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(payload64)) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (Math.floor(nowMs / 1000) >= payload.e) {
    return { ok: false, reason: "expired" };
  }

  if (payload.v !== visitorId || payload.c !== caseId) {
    return { ok: false, reason: "mismatch" };
  }

  if (typeof payload.n !== "string" || payload.n.length === 0) {
    // Tokens issued before the nonce field existed (or a hand-crafted forged
    // payload missing it) can't be safely single-use-enforced.
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, nonce: payload.n, expiresAt: new Date(payload.e * 1000) };
}
