---
name: Satisfaction-token single-use enforcement
description: Why a DB-backed nonce table (not just HMAC verification) protects the satisfaction-rating token flow across autoscale instances.
---

`server/lib/satisfactionToken.ts` HMAC tokens prove *authenticity* (correct signature, not expired, bound to visitor+case) but cannot by themselves prove *freshness* — a valid signature only means the token was issued by this server at some point, not that it hasn't already been redeemed.

Single-use enforcement was added as a separate DB-backed layer: each token carries a random nonce, and the first successful claim of that nonce (an `INSERT ... ON CONFLICT DO NOTHING` primary-key insert into a dedicated table) wins; every later claim of the same nonce fails.

**Why:** the app is deployed on autoscale with multiple live instances, so any anti-replay check that lives in process memory only protects the instance that happened to handle a given request — a second instance would accept the replay. A DB primary-key insert is naturally atomic and authoritative across every instance without needing Redis or a distributed lock. This also caps the blast radius of a `SESSION_SECRET` compromise: forged tokens are still only redeemable once each.

**How to apply:** any other single-use / anti-replay token in this codebase (magic links, one-time confirmation tokens, etc.) should follow the same shape — HMAC or JWT for authenticity, plus a DB nonce-claim table for single-use — rather than reaching for an in-memory `Set`. Reuse the `admin_login_attempts` persistence pattern in `server/middleware/security.ts` as the reference for "how this codebase persists per-key state across autoscale instances" generally.
