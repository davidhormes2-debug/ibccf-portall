---
name: AdminDashboard size budget
description: Why client/src/pages/AdminDashboard.tsx must stay under the 500KB Babel threshold and how to keep it there.
---
# AdminDashboard.tsx size budget

Keep `client/src/pages/AdminDashboard.tsx` **under 490000 bytes** — that is the
actual hard-fail budget enforced by `AdminDashboardSizeBudget.test.ts` (with a
~30KB soft-warning band at 460000). The underlying Babel deopt threshold is
500000 bytes; the test's 490000-byte budget leaves ~10KB headroom under that.
Always check the literal `BUDGET_BYTES` constant in the test file rather than
trusting a remembered number — it has drifted before. `wc -c` is the right
measure (raw bytes, not `500*1024`).

**Why:** Above 500000 bytes the Vite React/Babel transform logs "the code generator
has deoptimised the styling … as it exceeds the max of 500KB" and generates code
more slowly on every dev compile.

**How to apply:** When the file approaches the limit, carve self-contained pieces
out into `client/src/components/admin/` — module-scope helper components and large
leaf **dialogs** are the safest extractions (identical JSX/test-ids preserved, props
threaded through). The lowest-risk dialogs to pull are the ones that close over
the *fewest* outer variables: copy the JSX verbatim, thread the closure vars
in as props, and re-acquire `t` / `toast` via `useTranslation()` / `useToast()`
inside the new component rather than passing them. Re-measure with `wc -c`,
then `npm run check` + `npm run build`. Lazy-loading tab panels does NOT help
this particular warning — it is about the file's own source size, not first-load
cost.

**Watch out:** Several `client/src/components/admin/__tests__/*` specs assert against
the **raw text** of AdminDashboard.tsx (fixed-offset `ADMIN_SRC.slice(idx, idx+N)`
windows and brittle source regexes) rather than rendered behavior. Some are already
stale/red independent of any edit (e.g. WalletConnectAlertMarkerCleanup's `} finally {`
window check, CaseDetailTabs' `setWalletPhraseLength(...)` regex). When trimming, these
can flap — verify a failure exists in the pre-edit version before assuming you caused it.
Several admin source-reading specs also flake under full-suite parallel load yet pass
when run individually.

**Also safe:** extracting plain (non-JSX) logic — small async handlers/fetch helpers that
don't need hooks — into a `client/src/lib/*.ts` module and importing it back in. Pass
closure values (case id, auth token, a toast/onFail callback) as explicit params instead
of relying on closure; this is lower-risk than a component extraction since there's no
JSX/props wiring to preserve. Note `authToken`-typed state is often `string | null`, so
downstream helper params must accept `string | null`, not `string`.

**Budget can already be blown on main:** the file has been caught *already over* the
490000 budget before a task even started (i.e. the guard was red at HEAD). Check with
`wc -c` before assuming your change caused a budget failure — but still fix it forward
(extract more) rather than leaving/arguing to skip a red test you touched the file in.
