---
name: CI required-checks three-way sync
description: Adding a new CI job in this repo requires updating docs/config in lockstep, plus a module-load-time env var testing gotcha.
---

Adding a new required CI job (a new named job in the unit-tests workflow) requires keeping the workflow YAML, `scripts/required-checks.txt`, and `docs/ci-checks.md` (plus the CI list in `replit.md`) all naming the exact same job in sync.

**Why:** dedicated coverage tests cross-check these files against each other and against the live workflow YAML; a mismatch fails CI on an unrelated-looking job.

**How to apply:** after adding/renaming a job, run the repo's "annotation coverage" / "CI checks doc coverage" / "action job coverage" checks locally before considering the change done.

**Module-load-time env vars gotcha**: some server modules read secrets like `ADMIN_USERNAME`/`ADMIN_PASSWORD`-style vars into a module-level `const` at import time, not per-request. Tests that need different values across cases must `vi.resetModules()` and re-import the module per case — mutating `process.env` after the first import has no effect.
