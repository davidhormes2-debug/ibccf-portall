---
name: Public POST rate-limit scan coverage strategy
description: Why publicPostRateLimitScan.test.ts uses an explicit TARGET_FILES/EXEMPT_FILES map instead of auto-scanning every server/routes/*.ts file for persistNamespace.
---

`server/__tests__/publicPostRateLimitScan.test.ts` discovers every `server/routes/*.ts` file that instantiates its own `Router()` and requires it to appear in exactly one of two hardcoded maps: `TARGET_FILES` (scanned for the standard `persistNamespace` rate-limiter pattern) or `EXEMPT_FILES` (a file → one-line justification of its actual protection, e.g. per-route `checkAdminAuth`, or a bespoke DB-backed limiter like `checkPinRateLimit`/`atomicIncrementRateLimit`).

**Why:** Several legitimately-protected route files use a different (but still DB-persistent) rate-limiting mechanism than `persistNamespace`, or guard every route with auth middleware instead. Running the `persistNamespace`-specific violation scan against them produces false positives unrelated to whether they're actually safe. A discovery-based "must be categorized somewhere" test still guarantees a brand-new, uncategorized route file fails CI immediately, without requiring every existing file's bespoke protection to be re-verified against one specific pattern.

**How to apply:** When adding a new file under `server/routes/` that calls `Router()`, add it to `TARGET_FILES` (if it should use the standard `persistNamespace` limiter) or to `EXEMPT_FILES` with a short justification — otherwise the coverage test in `publicPostRateLimitScan.test.ts` fails. Known current gaps intentionally left unfixed: `server/routes/webauthn.ts`'s `/authentication/options` and `/authentication/verify` have no rate limiting at all.
