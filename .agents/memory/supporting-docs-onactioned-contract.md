---
name: SupportingDocuments onActioned finally-block contract
description: Why every approve/reject path in SupportingDocumentsPanel fires onActioned in finally (even on failure), and the Tab's known double-fetch-on-mount test convention.
---

# onActioned fires in `finally` — even when the PATCH fails

Every approve/reject path in `SupportingDocumentsPanel` (single-row `act()`, bulk
approve/reject, selection actions) AND `SupportingDocsQuickPopover` calls
`onActioned?.()` in a `finally` block, so the badge-refresh runs on success AND
failure.

**Why:** the badge count must reconverge with the server regardless of whether
the mutation succeeded; a failed PATCH still needs a refresh to show true state.
This is pinned by multiple test suites that assert "calls onActioned even when
the PATCH fails / throws" (BulkDocumentActions.test.tsx, SupportingDocsQuickPopover.test.tsx).

**How to apply:** do NOT "fix" any path to call onActioned only on success — it
will pass one stale test but break several others that encode the finally-block
contract. If you see an old test expecting "does NOT call onActioned on failure,"
that test is stale; update it to the finally-block contract, not the production code.

# SupportingDocumentsTab fires TWO load() fetches on mount

The statusFilter effect and the caseIdFilter effect both call `load()` on mount,
so a freshly-mounted Tab issues two identical GETs. This is known/expected.

**How to apply (tests):** absorb both mount fetches with the same payload —
`.mockResolvedValueOnce(initial).mockResolvedValueOnce(initial).mockResolvedValue(reload)`.
To trigger a caseId-filter reload WITHOUT the Task #508 zero-overlap confirmation
dialog, set the filter to a string that matches the selected docs' caseId (e.g.
`"case-abc"`) so the debounce `hasOverlap` check passes and the reload fires
immediately. Zero-overlap filter strings instead pop a confirm dialog and do not
auto-reload. (Reference pattern: SupportingDocumentsTabSelectionPruning.test.tsx.)
