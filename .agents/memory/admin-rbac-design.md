---
name: Admin RBAC design
description: Role-based access control implementation for admin routes — hierarchy, middleware, gated routes, and known test issue.
---

# Admin RBAC Design

## Role hierarchy
`viewer < agent < admin < super_admin` — defined in `server/routes/adminPermissions.ts` as `ROLE_HIERARCHY`.

`requireAdminRole('admin')` means admin OR super_admin (hierarchical: any role at or above the minimum).

## Role resolution
`resolveAdminRoleFromUsername(username)` in `adminPermissions.ts`:
1. env-var ADMIN_USERNAME → always `super_admin` (legacy compat)
2. Look up `admin_users` table via `db.select()` — returns stored role
3. No row found, unrecognised role, or DB error → `"viewer"` (least privilege)

**Critical invariant:** Only the env-var `ADMIN_USERNAME` gets the `super_admin`
early-return. Any unknown sub-admin username (e.g. from a deleted account with
a still-active session) MUST resolve to `viewer`, never `super_admin`.

`checkAdminAuth` in `middleware.ts` calls this after session validation and attaches the result to `req.adminRole` AND `req.adminUsername`.

## Sub-admin login (Task #1972)
`POST /api/admin/login` now has a two-phase auth:
1. Check env-var credentials (with optional DB override) — authenticatedUsername = effectiveUsername
2. If that fails, query `admin_users` by username, bcrypt.compare password, check `isActive=true`
3. Session is minted with `authenticatedUsername` (the sub-admin's username), so RBAC resolves their role correctly
4. 2FA is skipped for sub-admin accounts (future: per-account 2FA via twoFactorEnabled/twoFactorSecret columns)

**Why:** The session stores `adminUsername`; `resolveAdminRoleFromUsername` reads the role from `admin_users` on every request, so sub-admins automatically get the right role.

## Admin-users CRUD API (`/api/admin-users`)
- `GET /` — list all sub-admin rows (super_admin only), strips passwordHash + twoFactorSecret
- `POST /` — create account with bcrypt hash (BCRYPT_ROUNDS=12); role choices: viewer/agent/admin only
- `PATCH /:id` — update role/email/displayName/isActive/password; audit-logged
- `DELETE /:id` — hard delete; audit-logged
- All routes: `checkAdminAuth` + `requireAdminRole("super_admin")`

**Session revocation:** Disabling (`isActive=false`) or deleting via PATCH/DELETE now calls `revokeAllAdminSessions(username)` immediately. `checkAdminAuth` also verifies `isActive=true` on every sub-admin request and revokes+401s stale sessions.

## Storage methods added (server/storage.ts)
`listAdminUsers`, `getAdminUserByUsername`, `getAdminUserById`, `createAdminUser`, `updateAdminUser`, `deleteAdminUser` — all in IStorage interface and DatabaseStorage class.

## req.adminUsername
Set by `checkAdminAuth` in `middleware.ts` from `session.adminUsername`. Also declared in `Express.Request` augmentation in `adminPermissions.ts`. Use for audit logging instead of falling back to "admin".

## Session validation change
The original `getValidAdminSession` check `session.adminUsername !== ADMIN_USERNAME` was REMOVED so future sub-admin accounts (whose sessions carry their own username) can be accepted. Security is through role gating, not username matching. Legacy single-admin installs unaffected (env-var admin → super_admin).

**Why:** Multi-admin RBAC requires trusting any active/unexpired server-generated session, not just sessions for the env-var admin.

## Priority routes gated
- `blockedIpsRouter GET` → `viewer` (any authenticated admin)
- `blockedIpsRouter POST/DELETE` → `super_admin`
- `adminRouter POST /cases/:id/mirror-token` → `super_admin`
- `documentRequestsRouter POST /:id/approve|reject` → `admin`
- `depositsRouter PATCH /:id` and `PATCH /:id/status` → `admin`
- `casesRouter POST /` and `PATCH /:id` → `admin`
- `casesRouter DELETE /:id` → `super_admin`
- `adminUsersRouter` all routes → `super_admin`

## Test mock pattern
RBAC tests mock `../routes/adminPermissions` to override `resolveAdminRoleFromUsername` with a simple username→role map. Session mocks use different `adminUsername` values ("db-admin-user", "db-viewer-user", etc.) to simulate different roles.

**Trap:** several older test files stub `checkAdminAuth` as a bare `(_req, _res, next) => next()` (predates `requireAdminRole` being added to routes). That stub never sets `req.adminRole`, so any route now gated with `requireAdminRole(...)` sees `req.adminRole` as `undefined` → defaults to `"viewer"` → 403s, even with a correct `resolveAdminRoleFromUsername` mock or none at all — it looks like a real regression (e.g. an expected 200/500 comes back 403) but is purely a stale auth stub. Fix is at the `checkAdminAuth` stub itself: set `req.adminRole` to the minimum role the route under test requires (and `req.adminUsername`) directly in the stub — mocking `adminPermissions` alone does nothing because the bypassed `checkAdminAuth` never calls it. `cases.accessCodeRotation.test.ts` shows the full pattern (real `checkAdminAuth` bypass + role assignment). Other test files using the same bare bypass stub (e.g. `server/__tests__/adminMutationTransactions.test.ts`) should be checked against this trap if their routes are RBAC-gated.

## Pre-existing test failures (NOT caused by RBAC)
`server/__tests__/cases.portalWarning.test.ts` tests (c) and (e) for `portal-warning/override` and (c) for `portal-warning/skip-reactivation` fail because those routes call `disableAndResetPathway` (`server/services/pathwayReset.ts`) which uses raw `db.update(cases)` — bypassing both `storage.updateCase` and `caseService.updateCase` mocks. `pathwayReset` is never mocked in that test file.
