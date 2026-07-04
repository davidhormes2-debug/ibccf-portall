---
name: CasesTab confirm-dialog threshold test override
description: How to vary case-list size per-test in CasesTab client tests when a test needs to cross a bulk-confirm threshold, without vi.doMock.
---

`vi.doMock("@/components/admin/AdminDashboardContext", ...)` called inside an `it(...)` block does NOT override the module for a component that was statically `import`ed at the top of the test file (e.g. `import { CasesTab } from "../tabs/CasesTab"`). The top-level `vi.mock(...)` for that context is hoisted and resolved once when the module graph loads; `vi.doMock` only affects *future* dynamic imports, so the override silently has no effect and the test sees the original small case list.

**Why:** Vitest/Vite's mock hoisting resolves `vi.mock` before any test body runs, and `CasesTab` is a static top-of-file import — by the time an `it()` block calls `vi.doMock`, `CasesTab` and its `AdminDashboardContext` binding are already resolved.

**How to apply:** To vary the case list per test (e.g. to push `targetCount` over a bulk-confirm threshold like the access-code rotate/send confirm dialogs), declare a module-level mutable variable (e.g. `let mockCases: Case[] = []`) that the single top-level `vi.mock(...)` factory reads from on every call, and reassign it inside each `it()` before rendering. See `CasesTabAccessCodeBulkConfirm.test.tsx` for the reference pattern (`buildCases(count)` + `mockCases = buildCases(25)`).
