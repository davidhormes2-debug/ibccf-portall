---
name: New e2e spec CI registration
description: What has to be updated when adding a new Playwright e2e spec so it actually runs in CI and is enforced as a required check.
---

Adding a spec file under `e2e/*.spec.ts` does **not** make it run in CI by itself.
This project runs each Playwright spec as its own dedicated GitHub Actions job
(own ephemeral Postgres service container, own required branch-protection status
check) rather than one big Playwright job that runs every spec.

**Why:** per-spec isolation avoids one flaky/slow spec blocking or contaminating
the DB state of unrelated specs, and lets branch protection require every
individual e2e scenario by name.

**How to apply:** a new spec needs updates in all of these places, or it will
silently never execute in CI even though it passes locally:
1. `.github/workflows/e2e-tests.yml` — add a new `e2e-<short-name>:` job, copied
   from an existing job of the same shape (services.postgres block with a unique
   `POSTGRES_DB` name, the standard env block, the standard checkout/setup-node/
   playwright-install steps, then a `npx playwright test e2e/<file>.spec.ts` step,
   then report/trace upload steps with unique artifact names).
2. `scripts/required-checks.txt` — add the exact `E2E Tests / Playwright E2E — <Job
   Display Name>` context string (must match the job's `name:` field exactly).
3. `docs/ci-checks.md` — add a bullet under the E2E section describing what the
   spec covers, ending with the same "required branch protection status check"
   phrasing used by every other entry.
4. `replit.md` — add the same check name to the `**E2E Tests**:` bulleted list
   under "CI / required branch protection checks".

After adding, `bash scripts/check-action-job-coverage.sh` and
`bash scripts/check-protection-sync.sh` are the intended validators, but in this
sandbox `check-protection-sync.sh`'s replit.md-annotation section fails for
essentially *all* existing checks (it greps for the literal phrase `required
branch protection status check: "X"` in replit.md, but replit.md only lists
check names in a comma-separated bullet, not that phrase) — this is a
pre-existing, sandbox-wide false failure unrelated to any single spec's
addition, not something to chase or fix as part of adding one spec.
