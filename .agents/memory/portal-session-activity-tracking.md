---
name: Portal session last-activity tracking
description: Where portal_sessions.last_activity_at gets updated and why it lives in validateSession(), not per-route.
---

`portal_sessions` has a `last_activity_at` column (separate from `created_at`/`expires_at`) that is bumped centrally inside `validateSession()` (session-store.ts) via a fire-and-forget `storage.updatePortalSessionActivity(token)` call, rather than in each individual route/middleware that calls it. The active-session lookup (`getActivePortalSessionByCaseId`) orders by `last_activity_at DESC` so the freshest session wins if a case ever has more than one live token.

**Why:** `validateSession` is the single choke point reached by every consumer of a portal token — `validatePortalSession`, `isAuthorizedForCase`, `requirePortalSessionOnly`, community routes, etc. Bumping it there means every real portal request updates the signal exactly once, without having to remember to add the call at each new call site (mirrors `updateAdminSessionActivity`, which is called from `checkAdminAuth`/`isValidAdminToken` for the same reason on the admin side).

**How to apply:** If you add a new consumer of portal session tokens, route it through `validateSession`/`validatePortalSession` rather than reading the `portal_sessions` row directly — otherwise that consumer's traffic won't count as "activity" and admins will see a stale last-active time even though the user is actively using that surface. The admin-facing read path (`GET /api/cases/:id/active-session`, used by the rotate-code confirm dialog) reads via `getActivePortalSessionByCaseId` and deliberately does NOT call `validateSession`, so an admin merely *checking* the signal never counts as the user being active.
