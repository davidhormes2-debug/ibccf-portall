---
name: Rate-limit window snapshot coverage
description: Every DB-backed rateLimiter(..., {persistNamespace}) call site needs its own frozen-time window-duration test, or a quietly shortened window regresses silently.
---

Every call site of `rateLimiter(max, windowMs, { persistNamespace })` in `server/routes/**` and `server/middleware/security.ts` must have a corresponding test that freezes time (`vi.useFakeTimers()` + `vi.setSystemTime(...)`), fires one request, and asserts `windowResetAt.getTime() - fixedNow` equals the exact literal `windowMs` in milliseconds.

**Why:** A cap-only test (e.g. "returns 429 on the Nth request") only proves the request *count* threshold, not the time window. Someone can quietly shorten the window (e.g. 10 minutes → 10 seconds) and every existing cap test still passes, multiplying the effective attack/abuse rate without any test failure or code-review signal. A wall-clock-tolerant assertion (e.g. "resetAt is roughly windowMs from now, ±buffer") would also let a shortened window slip through — the assertion must be exact-equality under frozen time.

**How to apply:** When adding a new `rateLimiter(...)` call with `persistNamespace`, add a companion window-duration test in the same test file, following the pattern in `server/__tests__/aiChatRateLimit.test.ts`. Before treating a "test all rate limiters" task as done, `grep -rn "persistNamespace:" server/routes/ server/middleware/` and confirm every namespace has a window test — several (OTP issue/verify in `otpRateLimit.test.ts`, community POST in `publicGetRateLimit.test.ts`) had cap tests but no window test until this was checked explicitly.
