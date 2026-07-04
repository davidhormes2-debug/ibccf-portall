---
name: Hand-rolled AdminDashboardContextValue test mocks bypass the type checker
description: Some admin tests build their own context object literal (cast `as AdminDashboardContextValue`) instead of using buildMockAdminDashboardContext; adding a required context field won't fail tsc for these, only fail at runtime.
---

`mockAdminDashboardContext.ts`'s `buildMockAdminDashboardContext()` factory is typed against the real `AdminDashboardContextValue` on purpose so a new required field breaks compilation. But a few older test files (e.g. `settingsTabUsernameBadge.test.tsx`, `usernameStrengthBadge.test.tsx`) predate that factory and build their own literal, finishing it with `as AdminDashboardContextValue` — the cast suppresses missing-property errors, so `tsc` stays green while the component crashes at test run time with "Cannot read properties of undefined."

**Why:** discovered when adding a new required context field (`emergencyResetActivity`/`loadEmergencyResetActivity`) passed `npm run check` cleanly but broke two tests that mount the real `SettingsTab` with a hand-rolled context.

**How to apply:** after adding/renaming a required field on `AdminDashboardContextValue`, don't trust `tsc` alone — grep for `as AdminDashboardContextValue` across `client/src/components/admin/__tests__/` and update every hand-rolled literal too (or better, migrate those files to `buildMockAdminDashboardContext`). Then actually run the affected test files, since the type system won't catch this class of drift.
