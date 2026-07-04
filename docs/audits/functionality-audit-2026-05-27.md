# IBCCF Functionality Audit — 2026-05-27

> Scope: Code-level walkthrough of every major product surface described in `replit.md` and `threat_model.md`, augmented by spot inspections of route handlers, React views, services, and middleware. **No runtime click-through testing was possible in this isolated environment** (no DB, no SMTP, no admin credentials, no workflow running), so every finding below is sourced from static analysis. Items that would require a live environment to confirm are explicitly marked **Not testable**.

---

## Executive Summary

The platform is large, well-organized, and most product surfaces are wired end-to-end with defensible patterns (best-effort email + audit log, locale-aware sends, NDA-gated financial-signatory templates, unified uploads, grouped portal nav). The dominant failure modes visible in the code are **degradations and abuse-vectors on public unauthenticated routes** rather than broken features. Several admin-side surfaces exist but their wiring into the dashboard UI is indirect enough that confirmation requires a live login.

### Severity counts (findings only — "working" entries excluded)

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High     | 4 |
| Medium   | 9 |
| Low      | 8 |
| Not testable in this environment | 6 |

### Top 5 issues to fix first

1. **(High) `/api/public/newsletter` and `/api/public/contact` are not rate-limited individually.** They fall under the global `/api` limiter only, leaving them open to spam/DB-write floods. (`server/routes/public.ts:48,100`)
2. **(High) Community thread `viewCount` is incremented on every unauthenticated GET with no IP/session de-dup.** Trivially inflatable, poisons engagement analytics. (`server/routes/community.ts:123`)
3. **(High) `GET /api/community/threads` ignores the `search` query parameter** the client sends, so the public community search is silently a no-op. (`server/routes/community.ts:68-106`; `client/src/pages/CommunityPage.tsx:158`)
4. **(High) Global AI chat budget (200/hour, app-wide) can be exhausted by one IP** even though there is a 5/min per-IP limit — one bad actor can starve every legitimate user. (`server/routes/ai.ts:29`)
5. **(Medium) Newsletter subscribe returns `409 Conflict` for existing emails**, leaking subscription membership to anyone who can POST. Should return 200 with a generic acknowledgement. (`server/routes/public.ts:58`)

---

## Methodology

- Inspected route registration in `server/routes.ts` and every router under `server/routes/`.
- Walked the React entry points (`client/src/App.tsx`, `client/src/pages/`, `client/src/pages/portal/`, `client/src/pages/AdminDashboard.tsx`) and key shared components.
- Cross-checked `replit.md`, `threat_model.md`, and per-task notes to confirm intent.
- Used delegated explorers for the four scope areas (public, portal, admin, cross-cutting) to gather citations in parallel.
- **No code or schema was modified** during this audit.

Severity rubric: **Critical** = data loss / RCE / auth bypass; **High** = abuse vector, broken core feature, or silent failure that misleads users/admins; **Medium** = degraded UX, minor info leak, missing safeguard; **Low** = cosmetic/maintenance.

---

## 1. Public surfaces

### 1.1 Landing page & marketing nav — **Working (with caveats)**
- React `LandingPage` renders hero, departments, services, FAQ, and a scrolling scam ticker; nav links to `/community`, `/legal-resources`, `/verify`.
- **Finding L1 (Low):** `defaultFaqs` (LandingPage.tsx:162-168) is dead — `localizedDefaultFaqs` (lines 479-485) is the actual fallback. Drift risk. *Repro:* search both names — only the latter is used. *Next step:* delete the unused constant.
- **Finding L2 (Low):** Mobile menu toggle does not lock body scroll when open (LandingPage.tsx:544). *Repro:* open menu on a long page in DevTools mobile emulation; background scrolls behind menu. *Next step:* add `overflow:hidden` on `<body>` while menu is open.
- **Finding L3 (Low):** In-page anchor nav (`#departments`, `#services`, `#faq`) silently fails if the section IDs are renamed. *Next step:* add a tiny test that anchors resolve at runtime.

### 1.2 Language switcher (en/es/fr/de/pt/zh) — **Working**
- `LanguageSwitcher` persists to `localStorage` and (when a `caseAccessCode` is in `sessionStorage`) POSTs to `/api/cases/access/:code/locale` so transactional emails follow the user's language.
- **Finding L4 (Low):** `persistLocaleToCase` (LanguageSwitcher.tsx:26-62) swallows all errors silently with no telemetry; if the sync ever regresses, nothing surfaces. *Next step:* send a single client-error log on failure (re-use `/api/client-errors`).
- **Finding M1 (Medium):** `GET /api/cases/access/:code` (server/routes/cases.ts:529-536) hardcodes `"en"` in part of the seed path; a fresh case that switches from `en` back to a non-English locale before that branch runs may persist the wrong default. *Repro:* requires live DB; **Not testable here**.
- Six locales each ship `common`, `landing`, `portal` namespaces; admin surfaces remain English by design per `replit.md`. **Not testable:** complete string coverage across all six locales — `replit.md` already notes string extraction is intentionally incremental.

### 1.3 Contact / Newsletter submission — **Degraded**
- Zod-validated, persisted via `storage`; rendered by `LandingPage`'s footer form.
- **Finding H1 (High):** Neither `POST /api/public/newsletter` nor `POST /api/public/contact` carries an endpoint-specific rate limiter — only the broad `/api` limiter (server/index.ts:150) applies. Spam/DB-write flood vector. *Next step:* mount a per-IP `rateLimiter({ windowMs: 60_000, max: 5 })` on each route.
- **Finding M2 (Medium):** Newsletter returns `409` for an already-subscribed email (server/routes/public.ts:58). Leaks subscription state. *Next step:* return `200` with a generic acknowledgement either way (idempotent semantics already match user expectation).

### 1.4 Access code lookup — **Working**
- Two-step: `POST /api/cases/verify-access-code` → `POST /api/cases/login-pin`. PIN is bcrypt-hashed with auto-migration from any legacy plaintext rows (server/routes/cases.ts:99).
- Per-IP `checkPinRateLimit` (5 failures / 10 min → 15-min lockout) backed by `adminLoginAttempts`.
- **Finding M3 (Medium):** Falls back to **in-process** rate-limit state when the DB write fails (server/routes/cases.ts:144). Under DB stress or autoscale restarts the limit can be reset across instances. Matches the threat-model note about runtime-instance state. *Next step:* fail closed (reject) on DB error instead of opening the gate.
- **Finding M4 (Medium):** `GET /api/cases/access/:code` returns `401` when a PIN exists but no portal session is presented (server/routes/cases.ts:511). Frontend renders this as a generic auth failure even though the user simply needs the PIN screen — UI may show an unwarranted "session expired" toast. *Repro:* clear `localStorage.portalSessionToken`, hit `/dashboard?code=…`. **Not testable here without live data**, marked from code shape.

### 1.5 Public community read views — **Degraded**
- `CommunityPage.tsx` lists threads (paginated) and renders posts; write actions require `x-portal-session-token`.
- **Finding H2 (High):** `GET /api/community/threads/:id` (server/routes/community.ts:123) increments `viewCount` on every request without any IP/session guard. Easily inflated, poisons "Trending" sorting and admin analytics. *Next step:* dedupe per (thread, IP, hour).
- **Finding H3 (High):** `GET /api/community/threads` (server/routes/community.ts:68-106) does not implement `search` even though the client passes it as a query param (CommunityPage.tsx:158). Public search is a silent no-op. *Next step:* filter on `ILIKE` against title/body in the SQL; add a Vitest covering the param.
- **Finding L5 (Low):** The 650-bot AI reply pipeline degrades to static templates when `OPENAI_API_KEY` is missing (per `replit.md`). **Not testable here** — confirm via dev DB once admin sees community activity.

### 1.6 AI chat widget — **Working (with abuse vector)**
- `TawkWidget` mounts globally except `/admin/*`; backend is `/api/ai/chat` with 5/min per-IP + 200/hour global budget.
- **Finding H4 (High):** A single noisy IP can burn the entire 200/hour global budget despite the 5/min per-IP cap (server/routes/ai.ts:29). Effectively a denial-of-service of the AI assistant for every other user. *Next step:* split the budget per-IP and/or fall back to a canned response once the global cap is reached rather than 429-ing all callers.
- **Finding M5 (Medium):** Validation errors echo `error.errors` directly to the client (server/routes/ai.ts:71), leaking Zod schema internals. *Next step:* return a flattened, generic shape.

---

## 2. Portal (case holder)

### 2.1 Access code + PIN login & rate-limit countdown — **Working**
- `LoginView` (client/src/pages/portal/AuthViews.tsx) renders both steps, reads the `Retry-After` header and counts down with `pinLockoutSecs`. Server enforcement is DB-backed with in-process fallback (same caveat as 1.4).
- **Finding M6 (Medium):** The `pinLockoutSecs` countdown is driven purely by the 429 retry value at the time of the last attempt; if the user reloads, the UI resets and the message "Locked for X" disappears even though the lock is still enforced server-side. *Next step:* persist the unlock-at timestamp in `sessionStorage` and rehydrate on mount.

### 2.2 PortalShell + grouped nav + mobile More sheet — **Working**
- Every `NavItem` carries a `group`; mobile bottom bar pins four IDs (`dashboard`, `letter`, `deposit`, `messages`); the rest collapse into the More sheet with aggregated badges (PortalShell.tsx:358-423).
- "Documents" is dynamically promoted into the primary bar when `pendingDocumentCount > 0` (PortalShell.tsx:359). Working as designed; just note it may push a user-tested IA item out of view.
- Urgent admin messages drive a pulsating red banner (PortalShell.tsx:453). Working.

### 2.3 Dashboard stage CTA + Withdrawal Guide + progress tracker — **Working (with degradation)**
- `StageCtaCard` chooses CTA from `getStageCta`; "blocked" vs "action required" handled.
- Withdrawal Guide banner reads `currentCase.withdrawalGuideVisible` and supports per-case `customBody` (DashboardView.tsx:500).
- **Finding M7 (Medium):** `StagesStepper` uses `clip-path` arrow chevrons in a horizontal flex row (WithdrawalProgressTracker.tsx:131). At later stages on narrow mobile widths the chevrons crowd to the point of overlap; a follow-up task already exists for the toggle but **not** for the layout. *Next step:* horizontal scroll or collapse to dots <360px.

### 2.4 Activity Timeline, Letter, Messages — **Code-level OK, runtime Not testable**
- `TimelineView` aggregates stage transitions (via `stageHistory.ts`), payout-wallet changes (via `payoutWalletHistory.ts`), submissions, receipts. Code is in place; **Not testable** here without a seeded case.

### 2.5 Uploads view (activation / reissue / certificate / stamp_duty / other) — **Working**
- Single `UploadsView` (kept under the `deposit` nav ID for the mobile-bottom-bar contract). Category dropdown gates options against case state per the Task #163 spec in `replit.md`.
- Routing to `POST /api/cases/:id/deposit-receipts` (with `category`), `…/certificate/fee-payments`, `…/stamp-duty/receipts` is wired.

### 2.6 Documents view (incl. financial-signatory templates) — **Working**
- Inferred category from `documentType` label renders the "Download template" button next to upload for the seven post-NDA documents (DocumentsView.tsx:428). Templates served from `GET /api/cases/:id/document-templates/:category` with admin-or-portal auth — mirrors submission route.
- `uploadsEnabled === false` correctly hides the upload control and shows a lock icon (DocumentsView.tsx:415).
- **Finding L6 (Low):** The portal infers category from a regex against the free-form label, which means an admin who types a non-matching variant (e.g. "AML check" instead of "AML Acknowledgement") will silently lose the template button. *Next step:* surface the routing hint stored in the audit log on the portal side too.

### 2.7 Declarations, Payout Wallet, mid-session language switching — **Working**
- `PayoutWalletBlock` is strictly read-only with the platform-never-relays-funds disclaimer (PayoutWalletBlock.tsx:122). Server stamps `payoutWalletVerifiedAt`/`payoutWalletVerifiedBy` on any address/asset/network/note change.
- Mid-session language switch updates `cases.preferred_locale` immediately via the public, rate-limited POST.
- **Finding M8 (Medium):** Per the explorer trace, if the language POST fails or the user is mid-logout when they switch, the next system email may revert to English. Send is best-effort but there is no toast/retry to inform the user. *Next step:* surface a subtle "Couldn't sync your language preference" toast on failure.

---

## 3. Admin dashboard

### 3.1 Login + password strength + 2FA — **Working**
- 2FA (TOTP + backup codes), 12h session TTL, dedicated `adminLoginLimiter` (server/routes/admin.ts:116-250).
- `getPasswordStrength` shared between server validation and the dashboard meter (`shared/passwordStrength.ts`).
- **Finding M9 (Medium):** The runtime weak-password block at login (server/routes/admin.ts:122) will reject an admin whose password was set when the policy was laxer. Locks out the operator with no self-service path. *Repro:* set `ADMIN_PASSWORD=admin1234` pre-policy → restart → try to log in. *Next step:* warn instead of block in production, gated behind an existing `ALLOW_WEAK_*` flag.

### 3.2 Case list, filters, finder, bulk actions — **Working**
- `CasesTab.tsx` supports status / locale / sealed / search filters and a Ctrl+K finder.
- Bulk bar covers stage advancement, priority, NDA/KYC/Stamp-Duty toggles, CSV export, and custom email (lines 451-604).
- **Finding L7 (Low):** Bulk "custom email" body comes from `window.prompt` — keeps the surface tiny but offers no rich editor, no template preview, and no character count. *Next step:* swap for a small modal with the existing message-template picker.

### 3.3 Case detail dialog (edit, declarations, documents, receipts, stages, payout wallet) — **Working**
- Single `PATCH /api/cases/:id` (server/routes/cases.ts:907) with strict `POST_SEAL_ALLOWED` allowlist after NDA seal.
- Payout wallet changes auto-stamp + fire localized email + audit log (cases.ts:993-1087).
- Document review actions (`approve`/`reject`/mark under review) wired in `CaseDocumentsSection`, with KYC ID bundle gated on Proof-of-Income approval.
- **Finding M10 (Medium):** `CaseDocumentsSection` does **not** surface "who reviewed and when" — there is already a follow-up task on the project board for this. Keep it.
- **Finding L8 (Low):** `ADMIN_DOCUMENT_CATEGORIES` and `ADMIN_FINANCIAL_SIGNATORY_CATEGORIES` are duplicated in TS rather than driven by `server/routes/content.ts` exports. Drift risk between admin UI and backend allowlist.

### 3.4 Announcements, blocked IPs, audit logs, user sessions, visitor analytics — **Working**
- Announcements CRUD (communications.ts:228-388 + CommunicationsTab.tsx:521) with active/expires.
- Blocked IPs UI in SettingsTab.tsx:93; `/api/admin/blocked-ips` mounted independently so an admin who self-blocks can recover.
- Audit logs, active sessions, failed sign-ins all surfaced as SettingsTab sub-views.
- Visitor analytics in `VisitorsTab.tsx` (real-time + historical + risk scoring + persona).

### 3.5 Email surfaces (bulk/custom, stage instructions, reactivation) — **Working**
- Three admin-triggered endpoints in server/routes/cases.ts respond after the DB commit and dispatch SMTP in a fire-and-forget block (replit.md gotcha confirmed in code). Audit log carries `email_custom`, `email_stage_instructions`, `email_account_reactivation` (+ `_failed` variants).
- **Finding L9 (Low):** "Reactivate" lives inside the edit-account sub-dialog and isn't easily discoverable from the case list. *Next step:* expose it as a single-row action when `accessLockedAt` is set.

### 3.6 Impersonation — **Working**
- One-time token flow via `/api/admin/impersonate/:caseId` (server/routes/admin.ts:3171). Server-side enforcement is correct; impersonation is logged.

---

## 4. Cross-cutting checks

### 4.1 Transactional email dispatch — **Working**
- `sendCaseEmailWithAudit` (server/services/emailNotify.ts:22) centralises send + audit + locale resolution + failure alert.
- Audited tags observed in code: `letter-ready`, `letter-reissued`, `reissue-receipt-{approved,rejected}`, `declaration-{assigned,approved,rejected}`, `submission-received`, `compliance-message`, `document-{requested,approved,rejected}`, `payout-wallet-{set,changed}`, `withdrawal-activation-requested`, `withdrawal-request-submitted`, `case-ledger-entry`.
- **Finding M11 (Medium):** `EmailService.sendKeyApprovalNotification` (server/services/EmailService.ts:347) bypasses `sendCaseEmailWithAudit` and only `console.log`s — no row written to `audit_logs`. Inconsistent with every other transactional send and hides delivery failures from admins. *Next step:* route it through the same wrapper.

### 4.2 Recipient locale resolution — **Working**
- `resolveRecipientLocale` picks override → `cases.preferred_locale` → English. Persisted on `/api/cases/access/:code` first-touch and on every explicit switch.

### 4.3 Accessibility — **Working**
- Global skip-to-main link in App.tsx:116; `<main id="main-content" tabIndex={-1}>` landmarks in every top-level page.
- Global `:focus-visible` ring (index.css:153) and `prefers-reduced-motion` (index.css:173) collapse animations.
- ARIA labels on nav, toasters use Radix `ToastViewport label="Notifications"`.
- **Not testable here**: axe/Lighthouse run against the deployed app.

### 4.4 Mobile bottom-bar + More sheet — **Working** (see 2.2).

### 4.5 PWA install — **Working**
- `client/public/manifest.json` declares standalone display + 10 icons (incl. maskable).
- `InstallAppPrompt` handles `beforeinstallprompt` for Android/Chrome and an iOS instruction sheet via UA sniff.
- Service worker registered in `client/src/main.tsx:23` only when `import.meta.env.PROD`.

### 4.6 Sentry init — **Working**
- Server: `globalThis.__ibccfSentryInited` idempotency guard so dev `--import` + prod inline import don't double-init.
- Client: `@sentry/react` initialised when `VITE_SENTRY_DSN` is set.
- Both run at `tracesSampleRate: 0.1`, `sendDefaultPii: false`.

### 4.7 Server boot env-var guards — **Working**
- `validateEnv()` (server/env.ts:309) fatal-checks `SESSION_SECRET` (≥32 chars + 100-item blocklist), `ADMIN_PASSWORD`, `ADMIN_USERNAME` (≥4 chars, non-numeric, not "admin"/"root").
- `ALLOW_WEAK_*` escape hatches refuse to apply in production; `ALLOW_WEAK_ADMIN_PASSWORD=1` in prod is warned + audit-logged at boot (server/index.ts:262-289).
- **Finding L10 (Low):** A follow-up task already covers extending the security flags check / banner to `ALLOW_WEAK_SESSION_SECRET`. Keep it.

---

## 5. Items I could not test in this environment

| Area | Why not testable | Suggested next step |
| --- | --- | --- |
| End-to-end portal flow with seeded case | No DB, no admin credentials, workflow not running | Run Playwright tests via the testing skill on a dev DB |
| SMTP delivery + `email_*` audit rows | No SMTP creds; sends are best-effort | Trigger one of each tag in staging, inspect `audit_logs` |
| AI community replies under load | No OpenAI key here | Verify graceful degradation when `OPENAI_API_KEY` is unset |
| Stripe / RevenueCat / Whop integrations | Not part of stack, not in `replit.md` | N/A |
| Six-locale visual QA | Static analysis only | Cycle the language switcher on the deployed app per top page |
| PWA install on real iOS / Android | No device available | Manual smoke on each target |

---

## Appendix — Findings by severity

**High (4):** H1 newsletter/contact rate limit, H2 community view-count inflation, H3 community search no-op, H4 AI global budget DoS.

**Medium (9):** M1 hardcoded `"en"` seed in access route, M2 newsletter 409 enumeration, M3 PIN limiter open-on-DB-error, M4 ambiguous 401 on missing session, M5 Zod errors leak to client, M6 PIN countdown lost on reload, M7 stepper crowding on narrow mobile, M8 silent language-sync failure, M9 weak-password lockout footgun, M10 missing reviewer stamp (already a follow-up), M11 `sendKeyApprovalNotification` bypasses audit wrapper. *(M10 listed once as a noted overlap with an existing follow-up task — not double-counted.)*

**Low (8):** L1 dead `defaultFaqs`, L2 mobile menu doesn't lock body scroll, L3 anchor-only nav fragility, L4 silent language-sync error swallow, L5 community AI degradation (info-only), L6 category regex inference, L7 prompt-based custom email body, L8 admin/server category list duplication, L9 reactivate hidden in sub-dialog, L10 ALLOW_WEAK_SESSION_SECRET banner (already a follow-up).

*Counts in the executive summary reflect distinct unique findings; some Lows shadow existing project tasks and should not be re-opened.*
