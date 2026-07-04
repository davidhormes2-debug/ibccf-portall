---
name: Post-merge failure alerting env var scoping
description: SLACK_WEBHOOK_URL / SMTP_* are read from two different secret stores depending on which pipeline consumes them — don't assume setting one covers both.
---

`scripts/post-merge.sh` (runs inside the Replit environment as the platform-managed post-merge setup step) and `.github/workflows/branch-protection.yml` (runs in GitHub Actions) both read the same-named vars — `SLACK_WEBHOOK_URL` and the seven `SMTP_*` vars — for alerting, but from **separate secret stores**: Replit env vars/secrets for the former, GitHub Actions repo secrets for the latter.

**Why:** it's easy to assume configuring one covers both, since the var names and alerting behavior look identical. They don't share storage — a value set only in GitHub Secrets is invisible to `scripts/post-merge.sh`, and vice versa.

**How to apply:** when wiring any new alert that fires from a script executed by the Replit post-merge/setup pipeline, document that the required secrets must be set as Replit env vars (via the environment-secrets skill), not just GitHub Secrets — even if a same-named GitHub Secret already exists for CI alerting.
