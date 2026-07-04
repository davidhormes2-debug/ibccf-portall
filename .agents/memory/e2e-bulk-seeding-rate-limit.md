---
name: E2E bulk fixture seeding vs generic API rate limiter
description: Seeding many records through an admin API POST route in an e2e spec can trip the app's generic per-path rate limiter; how to seed safely instead.
---

Seeding 100+ fixture rows in a Playwright spec by calling an authenticated
admin `POST` create-record API route in a loop/batch can trip the app's
generic `/api` rate limiter (e.g. `rateLimiter()` mounted as
`app.use("/api", rateLimiter())` in this codebase, capped at 100 req/min per
IP **per literal route path**). The limiter runs before auth/role checks, so
a valid admin bearer token does not exempt the calls, and every seed request
shares the exact same path (e.g. `/api/cases`), so they all draw from the
same bucket.

**Why:** discovered while adding a live-DB pagination e2e test that seeded
105 cases via `POST /api/cases` in batches — the batch finished in under a
second (well within the 60s window) and the ~101st request came back 429,
failing the whole seed step non-deterministically depending on batch timing.

**How to apply:** for e2e fixture seeding of many rows, write directly to
Postgres with a bulk `INSERT ... VALUES (...), (...), ... RETURNING id` via a
short-lived `pg.Client` (see `e2e/helpers.ts` for the existing DB-helper
pattern), rather than driving it through the same authenticated API route
the UI uses. The spec still exercises the real API + React render path for
the assertions that matter (e.g. `GET /api/cases` + the tab UI) — only the
*setup* step bypasses the create endpoint. If a test also needs deterministic
row order and the API sorts by `created_at DESC` (or similar), stamp each
seeded row with a distinct, explicit timestamp rather than relying on
tie-break behavior among rows inserted in the same statement/instant.
