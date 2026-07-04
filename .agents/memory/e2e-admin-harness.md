---
name: Admin E2E harness — auth artifacts & fast data-ready signal
description: How Playwright admin specs authenticate, and how to avoid racing the dashboard polling loop
---

# Admin E2E auth artifacts (TWO files, both required)

`e2e/global-setup.ts` (the "setup" Playwright project) must write BOTH:
- `playwright/.auth/admin.json` — full Playwright **storageState** (cookies + localStorage). Consumed only by the `admin-auth` project via `use.storageState` (currently just `admin-login.spec.ts`).
- `e2e/.auth/admin.json` — a tiny `{ "token": "…" }` JSON. Consumed by the ~12 API-seeding specs that call `readAdminToken()` (e.g. `supporting-docs-popover-panel.spec.ts`). They seed cases over REST with `Authorization: Bearer <token>` and inject the same token into `sessionStorage` via `addInitScript` so the dashboard mounts already authenticated.

**Why:** A refactor once changed global-setup to write only the storageState file, which silently 401'd every API-seeding spec on its first `POST /api/cases`. The reuse/verify check also reads the `{token}` file, not the storageState file.
**How to apply:** If you touch global-setup, keep both writes. Both paths are gitignored (`e2e/.auth/`, `playwright/.auth/`) — never commit them; the token is a live secret.

# `loginAdminUi()` must wait on a viewport-agnostic mount signal

`loginAdminUi()` originally waited on `admin-case-finder-trigger`, but that button is `hidden md:inline-flex` (desktop-only). Any spec using `test.use({ viewport: <narrow> })` (e.g. mobile-nav badge specs) hung forever on login since that element never becomes visible below the `md` breakpoint. Fixed by switching the wait target to `button-notifications`, which has no responsive-hide class and mounts at the same time.
**Why:** discovered while validating that admin e2e specs pass under real local timing — this was a genuine, always-failing bug (present since the mobile-viewport spec was added), not a timing/CPU-contention issue.
**How to apply:** any new "dashboard fully mounted" wait added to a shared login helper must be viewport-agnostic, or narrow-viewport specs will silently hang on login regardless of timeout budget.

# Fast "initial data loaded" signal for admin dashboard E2E

`loginAdminUi()` waiting only for `admin-case-finder-trigger` (the shell) returns before `/api/cases` and pending-counts load, so the first `fillSearchInput` + badge wait raced the 3 s `setInterval(loadData, 3000)` polling loop — costing 15-25 s per suite.

Fix: `AdminDashboard.tsx` renders a hidden `data-testid="admin-data-ready"` span only once `!isDataLoading && pendingCountsLoaded` (cases settled AND pending-counts fetched at least once). Specs wait for it with `state: "attached"` (it is `hidden`, so not "visible"). Cut the popover suite ~80→59 s and panel suite ~108→60 s; full panel/popover file ~2.2 min.
**Why:** the polling loop never produces a stable frame; wait on an explicit completion sentinel instead of an interaction side-effect.

# global-setup warms the admin chunk; no single spec absorbs the compile

The first chromium test to navigate to `/admin` historically paid a one-time dev-mode browser compile of `AdminDashboard.tsx` (Babel logs a >500KB "deoptimised" note) because a bare `page.goto("/admin")` only warms the document load, not the lazily-compiled *authenticated* admin chunk. **Fixed:** global-setup now injects the token into sessionStorage (via `addInitScript`, before the goto — that is where the React app reads it) and blocks on the `admin-data-ready` sentinel, so the authenticated dashboard mounts and the admin chunk finishes compiling before any real spec runs. Every admin spec can therefore use the uniform 120s budget; do not re-add per-spec "first spec bears the compile" headroom.
**How to apply:** if you touch `warmAdminDashboard` in `e2e/global-setup.ts`, keep the sessionStorage-before-goto ordering AND the localStorage mirror (storageState only persists localStorage, consumed by the `admin-auth` project).

# (historical) First admin test absorbs the dev-mode AdminDashboard compile

The first chromium test to navigate to `/admin` pays a one-time, heavy dev-mode browser compile of `AdminDashboard.tsx` (Babel logs a >500KB "deoptimised" note). global-setup's `page.goto("/admin")` only warms the document load, not the lazily-compiled admin chunk, so that first real test eats the compile on top of its own work. Locally this blows the 120s shell budget even though the seed + dashboard load themselves succeed; in CI the 25-min job budget absorbs it fine.
**How to apply:** give the first compile-heavy admin spec generous internal waits (≥30-45s on the dashboard-up + `admin-data-ready` sentinels). Don't conclude a local timeout means the spec is broken — check the server log for the seed/data-load 200s. (The per-test budgets were later trimmed once the compile got lighter — see the two updates below; `test.slow()`'s 180s now covers the first spec.)

**Update — tab panels are now `React.lazy` chunks.** All ~15 admin tab/management panels (CasesTab, SettingsTab, SupportingDocumentsTab, ContentManagement, …) are dynamically imported in `AdminDashboard.tsx` and wrapped in a single `<Suspense fallback={<AdminTabLoading label="panel"/>}>` around the `<TabsContent>` block. This pulls ~600KB+ of tab source off the first-load critical path (Radix mounts only the active tab, so one chunk loads at a time). The dominant first-load compile is much smaller now, BUT `AdminDashboard.tsx` itself is still ~550KB so its own >500KB Babel deopt note persists — getting under 512000 bytes would require carving the 10,700-line main component, which the module-scope extractions alone (~35KB) cannot reach.

**Update — spec timeouts lowered after measuring the lazy-load win.** A controlled cold-vs-warm `/admin → admin-data-ready` measurement (fresh browser context, token injected, against a warm dev server) put the cold-vs-warm transform delta at only ~2s — the heavy first compile the old budgets guarded against is gone. So the inflated budgets were trimmed: analytics-kpi first test dropped its explicit `setTimeout(240_000)` and now rides `test.slow()` (180s); the popover suite 180s→120s; the panel suite 240s→150s (kept a touch higher for its Radix dialog open/close workarounds). All keep ≥2x margin over the ~60s typical suite runs.
**Why:** the AdminDashboard.tsx self-compile is still real, but it is no longer the dominant first-load cost, so the 240s safety budgets were pure inflation.
**How to apply (measuring locally):** do NOT trust absolute wall times from the Replit dev container — its huge production dataset makes the cases-list load ~26s vs near-instant in CI's fresh ephemeral Postgres, so foreground/e2e runs here time out misleadingly. Measure the cold-vs-warm *delta* instead, or read per-test durations from an actual CI run.
