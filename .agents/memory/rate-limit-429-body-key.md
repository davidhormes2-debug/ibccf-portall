---
name: 429 response body key mismatch
description: The persistent rateLimiter() helper's 429 JSON body uses `message`, not `error` — client error handlers that only read `err.error` will silently swallow the rate-limit signal.
---

`server/middleware/security.ts`'s `rateLimiter()` (used for all persistent, DB-backed per-route limiters) returns `{ message: "Too many requests. Please try again later.", retryAfter }` on a 429 — it does not set an `error` field.

Several client-side mutation error handlers in this codebase read `err.error` from failed JSON responses (a convention used by most non-rate-limit error paths, e.g. Zod validation failures). When a request hits a 429, `err.error` is `undefined`, so those handlers silently fall back to whatever generic message they use for any other failure — the user has no idea they're being rate limited and should just wait.

**Why:** Discovered while adding realistic-burst testing for the community POST rate limiter (Task confirming legitimate reply bursts don't trip it). `client/src/pages/CommunityPage.tsx`'s thread/reply creation mutations had this exact bug.

**How to apply:** Whenever wiring up client-side error handling for any endpoint behind a persistent `rateLimiter()`, check `res.status === 429` explicitly (don't rely on the `error`/`message` field alone) and show a distinct "you're going too fast, please wait" message rather than the generic failure toast.
