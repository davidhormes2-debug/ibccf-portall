---
name: Admin source-assertion test brittleness
description: How the admin __tests__ assert against AdminDashboard.tsx/SettingsTab.tsx source, and how to keep those checks from going red on reorganization.
---

Several admin tests in `client/src/components/admin/__tests__/` read the raw
source of `pages/AdminDashboard.tsx` (and `tabs/SettingsTab.tsx`) and assert on
its text to pin production wiring a JSDOM harness can't reach (handlers live
inline in the ~10k-line dashboard).

**Rule:** never slice a fixed-width window (`SRC.slice(idx, idx + N)`) around a
match. Adding a few lines inside a handler silently pushes later assertions
(`} catch`, `} finally {`) out of range and the check goes red even though the
feature works.

**How to apply:** bound the slice to the real syntactic unit — from the
handler/function declaration to the *next* declaration:
- handler body: `SRC.indexOf("\n  const ", idx + 1)` as the end bound
- component body: `SRC.indexOf("\nfunction ", start + 1)` as the end bound
`CaseDetailTabs.test.tsx`'s `extractUpdateWalletPhrase` is the canonical example.
Prefer render/behaviour harnesses over source regexes where practical.

**Why:** these checks exist to catch real wiring drift, not file moves; a
fixed offset couples them to byte positions, which is exactly the noise the
test is supposed to prevent.
