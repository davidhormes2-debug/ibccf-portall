---
name: Rate limiter route-template keying
description: Per-route rate limiters must key on the matched route pattern, not the literal request URL, or a varying path parameter lets an attacker dodge the cap.
---

`server/middleware/security.ts`'s `rateLimiter()` builds its per-request cache
key as `${namespace}:${clientIP}:${routeKey}`. When `routeKey` was derived
from `req.originalUrl` (the literal URL including path params), any route
mounted with a `:id`-style segment (e.g. `/threads/:id/posts`,
`/posts/:id/react`) got a **fresh counter bucket per distinct ID value**. An
attacker could fan out across thousands of distinct IDs from one IP and never
trip the per-route cap, even though the namespace was shared and the limiter
looked correctly configured.

**Fix:** key on the matched route's pattern instead of the literal path.
Express populates `req.route` (with `req.route.path` = the pattern string,
e.g. `"/threads/:id/posts"`) the moment a router matches a specific route —
this happens *before* any of that route's own middleware runs, including a
`rateLimiter()` instance passed directly as route middleware
(`router.post("/threads/:id/posts", rateLimiter(), handler)`). So
`` `${req.baseUrl}${req.route.path}` `` is safe to read inside the limiter
and correctly collapses all IDs on the same route into one bucket.

**Why:** `req.route` is only set when Express match a `Route` object (i.e.
route-level middleware). It is **not** set for limiters mounted generically
via `app.use("/api/admin/login", limiter())`, where `req.path` inside the
handler is just `"/"`. The original `req.originalUrl` fallback exists
specifically for that case and must be kept — don't replace it outright, only
prefer the route template when available.

**How to apply:** when adding any new per-route persistent rate limiter,
verify it naturally benefits from this (it does, automatically, via the
shared `rateLimiter()` implementation) — no per-call-site changes needed. If
you ever see a *new* place computing a rate-limit key from `req.path` /
`req.originalUrl` directly rather than going through `rateLimiter()`, apply
the same route-template preference there too.
