---
name: Admin sidebar function-panel localStorage persistence in tests
description: CasesTab (and similar admin tabs with a Functions Sidebar) persist which panel is open to localStorage, which leaks across test cases and flips click semantics.
---

CasesTab's Functions Sidebar persists `activeFunction` (which panel, e.g.
"access-code", "email", "block") to `localStorage` so it survives reload.
`toggleFunction` closes the panel if it's already the active one.

**Why:** in tests that render `<CasesTab />` more than once (multiple `it()`
blocks in one file, or multiple files sharing a jsdom global), a prior test
that left a panel open persists that choice in `localStorage`. The next
test's initial render then starts with that panel already "active", so
clicking the same sidebar button toggles it **closed** instead of open —
producing flaky, order-dependent failures where the panel's contents
(buttons, confirm dialogs) can't be found.

**How to apply:** any test that clicks a sidebar function button in
CasesTab (or another admin tab using the same pattern) must call
`localStorage.clear()` in `beforeEach`, alongside the usual
`sessionStorage`/`ResizeObserver` polyfill setup.
