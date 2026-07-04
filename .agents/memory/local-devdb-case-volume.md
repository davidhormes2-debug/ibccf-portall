---
name: Local dev DB case-volume perf ceiling for admin e2e specs
description: Shared Replit dev Postgres accumulates thousands of case rows over time, which can make the admin Cases tab unrenderable (minutes, not seconds) in this sandbox — distinct from CI, which uses a fresh empty DB.
---

## Update: the Cases tab table itself is now paginated server-side

The perf ceiling described below is specific to full unfiltered fetches. The Cases
tab's own table no longer does one of those — it pages/filters via SQL and only ever
renders one page of rows. That closes the ceiling for the table itself but not for
other admin surfaces (badge/KPI counters, some bulk/picker flows) that intentionally
still request the full unfiltered set; those remain exposed to this same class of
problem and are the natural next target if this ceiling resurfaces elsewhere.

**Any client component that adds a real `fetch()` on mount** (as the paginated Cases
table now does) should expect it to add meaningful latency under this sandbox's
variable CPU scheduling, even against a mocked/404'd endpoint in tests — components
that already had tight, explicitly-overridden test timeouts (rather than the
suite default) are the ones likely to need a modest bump. Isolating a single test and
running it alone (not as part of a full-file/suite run) is the fast way to confirm
it's scheduling variance and not an actual regression.

## What happens
The admin Cases tab (`CasesTab.tsx`) fetches the **full** `/api/cases` list unfiltered
and filters/sorts/renders it client-side (no server-side search, no virtualization).
This is fine at normal scale, but the shared Replit dev database in this project has
accumulated several thousand case rows over the project's lifetime (~4,300+ as of
2026-07-04) from cumulative seeding/testing across many unrelated tasks. On this
sandbox's constrained CPU (2 vCPUs, often contended by concurrent Vite/chromium
processes), the first mount of the Cases tab can block the main render thread for
multiple minutes — long enough that even `page.screenshot()` times out, and a
`getByTestId("input-search-cases")` wait of 30s (or even 90s) fails with "element(s)
not found", not because the element is missing, but because React/the browser tab
have not finished the initial synchronous render pass yet.

**Why:** This is a **data-volume** problem specific to this long-lived shared sandbox
DB, not a Playwright timing bug or an app bug in the tested feature. Confirmed via
`.github/workflows/e2e-tests.yml`, which spins up a **fresh, empty** ephemeral Postgres
service container per CI run — so admin Cases-tab-dependent specs render near-instantly
there and are not exposed to this slowdown. A live probe showed `/api/cases` itself
responds in ~0.5s API-side even with ~4,388 rows; the bottleneck is 100% client-side
render/filter of that payload under CPU throttling, not the network or the DB query.

**How to apply:** When a new or existing Playwright spec that visits the admin Cases
tab hangs locally on `input-search-cases` (or similar Cases-tab widgets) never
appearing even after generous timeouts, do not chase it as a functional bug or keep
inflating timeouts indefinitely. Cross-check against `.github/workflows/e2e-tests.yml`
`services.postgres` config to confirm CI's DB is ephemeral/empty, and treat a passing
structural match against an already-CI-green sibling spec (e.g.
`admin-case-dialog-loading-skeleton.spec.ts`) as sufficient confidence, documenting the
local-only verification gap rather than trying to force a full local pass against the
bloated shared dev DB. Do not attempt to bulk-delete unrelated case rows from the shared
dev DB to "fix" this — the ~4,300 rows are not mass e2e leakage (spot-checked: only
~21 matched e2e naming patterns), so mass deletion risks destroying real project data
for an unrelated performance itch.

## Update (2026-07-04): the stall can also be server-side, not just client-render

A later investigation (root-causing why admin specs hang/timeout in this sandbox but
pass in CI) found the earlier "client-render-only" framing was incomplete. Server logs
during a real local Playwright run captured `GET /api/cases 200 in 78442ms` — a
78-second **server-side** round trip for a query that takes ~0.4-0.5s when run directly
(via `psql`/`curl`) moments before and after. Concurrent `curl`-based fan-out of the same
~19-endpoint admin-dashboard request burst (bypassing Chromium/Playwright entirely) did
**not** reproduce any slowdown — every endpoint returned in <1.2s. The stall only shows
up when a real headless Chromium instance is actually driving the browser, and it is
non-deterministic: the same spec run back-to-back in a clean environment sometimes
completes in ~20s and sometimes stalls past 100s.

**Why:** this sandbox has only 2 vCPUs, shared at test time between headless Chromium,
the Vite/tsx dev server, Postgres, and already-running IDE TS language servers. Under
that contention the OS scheduler can starve the Postgres backend process (or the Node
event loop) for tens of seconds even though the query itself is trivial — a genuine
resource-contention effect of running a real end-to-end browser test on a small CPU
allocation, not a query-plan, connection-pool, or app-logic bug (pool exhaustion and
event-loop-wide blocking were both explicitly ruled out: other endpoints kept responding
in <1s during the same window that `/api/cases` stalled). CI does not see this because
it has dedicated CPU and a fresh/empty DB.

**Also confirmed as a compounding (but not sole) factor:** a Playwright run killed
mid-test (Ctrl-C, a wrapping shell/tool timeout, etc.) can leave multiple orphaned
Chromium child processes (renderer/gpu/zygote/network-service, ~10+ processes per
browser instance) running indefinitely in the background, since Playwright's own
teardown never got to run. Each leaked browser instance adds to the same CPU
contention for every subsequent run in that session. Always `pkill -9 -f chrome-linux`
(and `chrome_crashpad`) after a hung/killed local Playwright run, before assuming a
fresh run's slowness reflects steady-state behavior.

**Fix applied (not a full resolution, a mitigation):**
1. `e2e/helpers.ts` exports `localTimeout(ciMs)` — returns `ciMs` unchanged under `CI`,
   doubles it locally. All `admin-*`/`adminPasswordStrengthBadge` specs' explicit
   `test.setTimeout(...)` calls now go through it, so local runs get 2x the CI budget
   (e.g. 120s → 240s) to absorb the observed worst-case ~100s stall. Any *new* admin
   spec should use `test.setTimeout(localTimeout(120_000))` rather than a bare literal.
2. `playwright.config.ts` global `timeout`/`expect.timeout` are doubled for non-CI runs
   the same way (CI values unchanged).
3. Non-CI Chromium is launched through `scripts/niced-chromium.sh` (`nice -n 10`) so it
   yields CPU to the dev server/Postgres under contention; opt out via
   `PLAYWRIGHT_DISABLE_NICE=1`. This reduces but does not eliminate the stall risk.

**Residual limitation:** even with these mitigations, a *single* admin e2e spec run in
this sandbox can legitimately take 20s-4min depending on scheduler luck — there is no
way to make it reliably fast without more CPU, a smaller dev DB, or moving the admin
dashboard's fan-out off a single unfiltered `/api/cases` call (out of scope here; would
need product/schema-level work). If a spec still times out at the new local budget,
re-check for orphaned Chromium processes before concluding the fix regressed.
