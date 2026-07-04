# Threat Model

## Project Overview

IBCCF is an Express + React application for blockchain complaint intake, user case portals, regulatory document handling, community discussions, AI-assisted chat, and a privileged admin dashboard. Production traffic terminates at the Express server on port 5000; the server talks directly to PostgreSQL and to external email/OpenAI/Sentry services. The primary production users are public visitors, case holders accessing the portal, and admins operating the dashboard. The current deployment target is Replit autoscale, so future scans should assume that more than one application instance may be live at once even though parts of the code still rely on process-local state.

Production assumptions for future scans:
- Only production-reachable code should be reported.
- `NODE_ENV` is `production` in deployed environments.
- Replit Deployments provides TLS in transit.
- Mockup/sandbox environments are out of scope unless production reachability is demonstrated.

## Assets

- **Case records and portal credentials** — case IDs, access codes, user PINs, withdrawal state, declaration access codes, payout-wallet metadata, and force-logout state. Compromise allows account takeover, impersonation, or unauthorized workflow changes.
- **User PII and regulated documents** — names, emails, phone numbers, declarations, KYC/supporting uploads, deposit receipts, visitor telemetry, and contact submissions. Exposure would leak highly sensitive personal and financial information.
- **Admin authority** — bearer session tokens, admin-only routes, audit logs, blocked-IP controls, messaging, announcements, and case-edit capabilities. Compromise enables full platform control.
- **Communications channels** — SMTP-backed transactional and bulk email flows plus admin-authored announcements/messages. Abuse would enable phishing, spam, or user manipulation.
- **Application secrets and infrastructure state** — database credentials, SMTP credentials, OpenAI/Sentry keys, and runtime configuration. Exposure would expand compromise beyond the application itself.
- **Operational telemetry and logs** — deployment stdout, error logs, and downstream log sinks may carry API payloads, identifiers, and credentials. Exposure would leak regulated user data and enable session replay or account takeover if sensitive responses are logged.

## Trust Boundaries

- **Browser to API** — all client input is untrusted, including access codes, PINs, case IDs, request IDs, document IDs, uploaded base64 blobs, locale headers, and any identifiers sent into public AI or community routes.
- **Public to portal/authenticated user** — public marketing/content endpoints, access-key routes, AI chat, and community endpoints must stay isolated from case-scoped data and mutation routes.
- **Portal user to admin** — the admin dashboard has materially broader privileges and must be enforced server-side on every route, never by path naming or client behavior alone.
- **Admin impersonation to portal user** — the admin mirror / “open as user” flow crosses from administrative authority into user-session authority. Any mirror token or mirrored portal session must stay narrowly scoped, short-lived, auditable, and incapable of silently bypassing controls that are meant to require the real user’s participation.
- **API to PostgreSQL** — backend code can read and mutate the full dataset; broken access control or injection at the API layer directly impacts regulated data.
- **API to external services** — SMTP/OpenAI/Sentry integrations run with server-held secrets and must not be triggerable or influenceable beyond intended workflows.
- **User uploads to admin review surfaces** — regulated documents and receipt blobs originate from untrusted case holders but are later opened or inspected by admins, so upload paths and admin preview/download flows must prevent active-content execution and preserve review integrity.
- **API to observability/logging sinks** — anything written to stdout or collected by log backends crosses an operational trust boundary and must not contain live access codes, session tokens, or uploaded regulated documents.
- **Runtime-instance boundary** — portal session state is partly in-memory while production is configured for autoscale, so any security assumption that depends on process-local state must be evaluated for restart, cross-instance routing, and revocation behavior.
- **Repository/config boundary** — tracked config such as `.replit`, deployment guides, and environment examples can expose production secrets or unsafe runtime defaults if real values are committed.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes.ts`, and all routers under `server/routes/`.
- **Security-relevant runtime config:** `.replit`, deployment docs, and environment examples that shape production auth, secrets, or transport settings.
- **Highest-risk code areas:** `server/routes/cases.ts`, `server/routes/admin.ts`, `server/routes/content.ts`, `server/routes/public.ts`, `server/routes/messages.ts`, `server/routes/submissions.ts`, `server/routes/deposits.ts`, `server/routes/visitors.ts`, `server/routes/community.ts`, `server/routes/departments.ts`, `server/routes/access-key-requests.ts`, `server/routes/ai.ts`, `server/services/bot-response-generator.ts`, `server/services/session-store.ts`, `client/src/pages/AdminMirror.tsx`, `server/storage.ts`.
- **Public surfaces:** `/api/public/*`, `/api/cases/access/:code`, `/api/submissions`, access-key request routes, `/api/ai/chat`, `/api/visitors/heartbeat`, `/api/visitors/offline-messages`, `/api/visitors/satisfaction`, public community endpoints, and any case-scoped route lacking `requirePortalAccess` or `checkAdminAuth`.
- **Authenticated portal surfaces:** case-scoped routes using `requirePortalAccess` or declaration access codes, plus community write routes that accept `x-portal-session-token`.
- **Admin surfaces:** bearer-token routes intended for dashboard use, especially anything mounted under `/api/admin`, `/api/audit-logs`, `/api/document-requests`, `/api/admin/content`, `/api/notifications`, `/api/user-sessions`, and any route labeled admin-only in code comments.
- **Usually dev-only or lower-priority:** Vite/dev middleware, tests, scripts, and build tooling unless production routing or runtime references prove reachability.

## Threat Categories

### Spoofing

The app relies on bearer admin session tokens and portal session tokens delivered in headers, plus weaker user-facing identifiers such as access codes, case IDs, request IDs, and document request IDs. Production security requires every protected route to validate the correct credential server-side, bind it to the requested case/resource, and reject any path that relies on mere possession of a guessable identifier.

### Tampering

Admins can change case state, communications, blocked-IP policy, announcements, department/workflow configuration, and document review outcomes; portal users can submit documents, receipts, community content, and workflow choices. The application must ensure that only the intended principal can mutate each resource, that user-scoped mutations require a valid case-bound session or equivalent proof, and that public routes cannot change sensitive records by sending arbitrary IDs.

Public visitor-support flows deserve extra scrutiny because they write into admin-facing tables (active visitors, offline messages, ratings, and related analytics). Those routes must strip or overwrite internal-only fields server-side so unauthenticated callers cannot forge staff workflow state or poison operational metrics.

Community write flows deserve separate abuse analysis because one authenticated portal action can enqueue multiple background AI jobs. Future scans should verify that community posting/reply routes have quotas and budget controls comparable to the dedicated `/api/ai/chat` surface.

### Information Disclosure

The database contains PII, user portal data, plaintext-equivalent recovery artifacts, regulated documents, visitor telemetry, community/account linkage, and admin-only operational data. The system must limit each response to the minimum fields needed by the caller, keep admin-only datasets behind server-side authorization, and avoid exposing secrets or private records through unguarded read endpoints.

### Denial of Service

Public endpoints accept uploads, contact/newsletter submissions, access-code lookups, community traffic, and AI chat traffic. The system must bound request sizes, rate-limit high-abuse endpoints, and avoid unauthenticated routes that trigger expensive database work or paid third-party work at scale. In this autoscaled deployment model, process-local counters are not sufficient for any control that is meant to be globally authoritative across instances. External-service calls must remain best-effort and non-blocking so they cannot be abused to exhaust worker capacity.

**Accepted exception — community keyword moderation cache**: `server/services/communityModeration.ts` caches the active keyword blocklist per-process for up to 60s (`CACHE_TTL_MS`). `invalidateModerationCache()`, called from the admin keyword add/enable-disable/delete routes in `server/routes/adminCommunityModeration.ts`, only clears the cache on the instance that served the request; other autoscale instances keep serving their own cached list until their independent TTL expires. This is a deliberate, reviewed trade-off, not an oversight: keyword moderation is a best-effort content filter (not an authorization boundary — see Elevation of Privilege), so a bounded ≤60s cross-instance propagation delay for a re-enabled/disabled keyword is acceptable rather than adding pub/sub or a DB-backed version-check on every post. Revisit this exception if keyword moderation is ever given a security-relevant role.

### Elevation of Privilege

This codebase is especially sensitive to broken function-level access control because the same Express app hosts public, portal, community, AI, and admin routes side by side. The core guarantee is that admin-only capabilities must be guarded by `checkAdminAuth`, portal case data must be guarded by `requirePortalAccess` or a narrowly-scoped alternative, revocation controls must be enforced consistently anywhere a portal token is accepted, and public identifiers must never be sufficient to obtain admin powers, alter other users’ cases, or read sensitive datasets. Routes whose semantics are meant to represent the case holder's own submission, acknowledgement, or consent must not rely on `requirePortalAccess` alone when that helper also accepts raw admin bearer tokens.

The admin mirror flow deserves separate scrutiny in this category. A support-only impersonation token must not turn into a long-lived general portal credential or bypass routes that deliberately reject admin bearer tokens to preserve non-repudiation or user-consent guarantees.
