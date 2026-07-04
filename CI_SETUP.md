# CI Setup — Automated Smoke Test

The smoke test workflow (`.github/workflows/smoke-test.yml`) runs after every deployment and hits the live application to verify core paths are healthy. It requires **12 GitHub repository secrets** to boot a temporary test environment and make authenticated requests against the deployed URL.

## How the workflow uses secrets

The workflow has four jobs that run in order:

1. **`validate-secrets`** — Runs first. Checks that all 12 required secrets are non-empty and fails immediately with a named error (`Missing required secret: SMTP_HOST`) if any are absent. This prevents cryptic mid-run failures in later jobs.
2. **`validate-connectivity`** — Runs after `validate-secrets` passes. Performs lightweight TCP/HTTP probes to confirm that the credentials are not just present but actually reachable:
   - **`DATABASE_URL` (TCP)** — extracts the host and port from the connection string and calls `pg_isready` to verify the PostgreSQL server is accepting connections. Fails with `Cannot reach database host: host:port`.
   - **`DATABASE_URL` (credentials)** — runs `psql "$DATABASE_URL" -c "SELECT 1"` to validate the full connection string including username, password, and database name. A rotated password or revoked user will pass the TCP probe but fail here. Fails with `Database credentials rejected`.
   - **`SMTP_HOST:SMTP_PORT`** — opens a TCP connection to the mail server. Fails with `Cannot reach SMTP host: host:port`.
   - **SMTP credentials** — after the TCP probe, a Python `smtplib` script performs a full EHLO/AUTH handshake (STARTTLS on port 587, SSL on port 465) and immediately sends QUIT without delivering any mail. Fails with `SMTP authentication rejected` (exit 2) if the username or password is wrong, or `SMTP protocol error` (exit 1) for handshake/TLS failures — both are distinct from the earlier TCP-reachability check.
   - **`DEPLOY_URL`** — issues an HTTP `GET` and fails if the host doesn't respond (`000`) or returns a 5xx status, with a clear message indicating which condition triggered.
3. **`build`** — Runs after `validate-connectivity` passes. Installs dependencies, type-checks, and builds the application.
4. **`smoke`** — Runs after `build` passes. Hits the live deployment URL and verifies that core paths respond correctly.

If `validate-secrets` fails, no subsequent jobs will run, and GitHub will surface a clear list of which secrets are missing in the Actions log. If `validate-connectivity` fails, `build` and `smoke` are skipped and you get a targeted error pointing to the exact credential or host that is unreachable.

## Adding secrets to the repository

1. Open your GitHub repository.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** for each entry in the table below.

> Secrets are write-only once saved — GitHub never displays the value again. Store a copy somewhere safe (e.g. a password manager).

## Required secrets

| Secret name | Description | Example value | Where to obtain |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the test database. Must include `?sslmode=require` for Neon/Supabase. | `postgresql://user:pass@host/db?sslmode=require` | [Neon](https://console.neon.tech) → project → Connection string; or Railway project → Variables; or Supabase → Settings → Database |
| `SESSION_SECRET` | Secret used to sign Express sessions. Must be at least 32 characters and must not be a common/weak value. | `a-very-long-random-string-here-32+chars` | Generate locally: `openssl rand -hex 32` |
| `ADMIN_USERNAME` | Username for the admin account the smoke test logs in with. | `Admin2025` | Set by the operator at first deploy (matches the `ADMIN_USERNAME` env var on the server) |
| `ADMIN_PASSWORD` | Password for the admin account. | `Admin123456789` | Set by the operator at first deploy (matches the `ADMIN_PASSWORD` env var on the server) |
| `SMTP_HOST` | Hostname of the outbound SMTP server. | `smtp.mailgun.org` | Email provider dashboard → SMTP settings (e.g. Mailgun, SendGrid, Postmark, or your host's mail panel) |
| `SMTP_PORT` | SMTP port number (usually `465` for TLS or `587` for STARTTLS). | `587` | Email provider dashboard → SMTP settings |
| `SMTP_USER` | SMTP authentication username (often the full sender address). | `noreply@example.com` | Email provider dashboard → SMTP settings / credentials |
| `SMTP_PASSWORD` | SMTP authentication password or API key. | `supersecretsmtpkey` | Email provider dashboard → SMTP settings / credentials |
| `SMTP_FROM_NAME` | Display name shown in the From field of outbound emails. | `IBCCF Support` | Chosen by the operator; no external lookup required |
| `SMTP_FROM_ADDRESS` | Envelope sender address for transactional emails. | `noreply@ibccf.com` | Must be a verified sender address in your email provider's dashboard |
| `SMTP_REPLY_TO` | Reply-To address on outbound emails. | `support@ibccf.com` | Chosen by the operator; must be a monitored inbox |
| `DEPLOY_URL` | The full base URL of the live production or staging deployment the smoke test will hit. No trailing slash. | `https://ibccf.example.com` | Your deployment platform (e.g. Replit Deployments → published URL, Railway → domain, Hostinger → custom domain) |

### Notes on specific secrets

**`DATABASE_URL`** — If your deployment uses `NEON_DATABASE_URL` as the env var name instead, the workflow must be updated to use that name too. Either name resolves as the primary database connection; see `server/index.ts` for the precedence logic.

**`SESSION_SECRET`** — The server rejects startup with a fatal error if this value appears on the built-in blocklist of common/weak values (see `server/index.ts`). Use a random 40+ character string generated by a tool such as `openssl rand -hex 32`.

**`DEPLOY_URL`** — This is the URL the smoke test script sends HTTP requests to after deployment finishes. It should match the canonical URL of whatever environment is being tested (production or staging). Example: `https://ibccf.replit.app`.

**SMTP secrets** — Transactional email sends are best-effort and never block requests; the smoke test can still pass if SMTP credentials are wrong, but email delivery will not be validated. Use real credentials if you want the test to cover email flows end-to-end.

## Repository variable — SMOKE_TEST_URL

In addition to the secrets above, you must set one **repository variable** (not an encrypted secret) so the smoke job knows which URL to probe:

| Variable name | Description | Where to set it |
|---|---|---|
| `SMOKE_TEST_URL` | Full base URL of the live deployment the smoke checks will hit (no trailing slash). | **Settings → Secrets and variables → Actions → Variables tab → New repository variable** |

Example value: `https://your-app.up.railway.app`

**Why a variable instead of a secret?** The deployment URL is not sensitive. Storing it as a plain variable keeps it visible in the Actions UI so every team member can confirm which environment is being tested. If your URL must remain private, add `SMOKE_TEST_URL` under **Secrets** instead — the workflow checks `vars.SMOKE_TEST_URL` first and falls back to `secrets.SMOKE_TEST_URL` automatically. You can also supply a one-off URL at run time via the `target_url` workflow-dispatch input without changing the stored value.

## Optional secrets (enhance observability, not required for smoke test to pass)

| Secret name | Description | Where to obtain |
|---|---|---|
| `OPENAI_API_KEY` | Enables AI community replies (GPT-4o-mini). Degrades gracefully to static templates if absent. | [platform.openai.com](https://platform.openai.com) → API keys |
| `SENTRY_DSN` | Server-side Sentry error reporting DSN. | Sentry project → Settings → Client Keys |
| `VITE_SENTRY_DSN` | Client-side Sentry error reporting DSN (same project, same value as `SENTRY_DSN`). | Sentry project → Settings → Client Keys |
| `SENTRY_AUTH_TOKEN` | Used at build time to upload source maps to Sentry. | Sentry → User settings → Auth Tokens |
| `SENTRY_ORG` | Sentry organisation slug for source map uploads (e.g. `my-org`). | Sentry organisation settings |
| `SENTRY_PROJECT` | Sentry project slug for source map uploads (e.g. `ibccf`). | Sentry project settings |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL. When set, the `branch-protection.yml` workflow posts a Slack alert whenever the branch-protection check fails. Without this secret the Slack step is silently skipped. | [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) → Create an Incoming Webhook → copy the Webhook URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, `SMTP_REPLY_TO` | **Dual-purpose.** These seven secrets are already required for the smoke-test workflow (see Required secrets above). When all seven are present they also enable email failure alerts from `branch-protection.yml` — no additional configuration is needed. If you have already added them for the smoke test, branch-protection email alerts are active automatically. | See the Required secrets table above for per-secret details |
| `PROTECTION_SETUP_TOKEN` | GitHub Personal Access Token (classic `repo` scope, or fine-grained `Administration: Read and write`) that enables the weekly **Self-Heal Branch Protection** job in `branch-protection.yml` to automatically re-apply branch protection rules every Monday at 07:00 UTC. Without this secret the self-heal job is skipped gracefully; the daily detection-only check still runs. Recommended lifetime: 90 days — rotate every 75–80 days. Create at GitHub → Settings → Developer settings → Personal access tokens, then store here. | GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic, `repo` scope) |

## Requiring the smoke test to pass before merging (branch protection)

GitHub does not block merges based on workflow results unless you configure a branch protection rule. Without it, a failing smoke check is visible in the CI tab but does not prevent the PR from landing.

### Recommended: run the setup script (one command, repeatable)

The fastest way to configure branch protection is to run the included script. It uses the GitHub CLI to call the REST API and is safe to re-run at any time — the underlying API call is idempotent.

**Prerequisites:**

- [GitHub CLI](https://cli.github.com/) installed (`gh --version` to confirm).
- Authenticated with admin access to the repository: `gh auth login`.
- The smoke-test workflow has run at least once on `main` so GitHub has registered the check names. If the checks haven't run yet, trigger the workflow first:
  ```
  gh workflow run smoke-test.yml --ref main
  ```

**Run the script:**

```bash
# From the repository root — auto-detects the repo from git remote:
bash scripts/setup-github-protection.sh

# Or pass the repo explicitly if you are working in a fork:
bash scripts/setup-github-protection.sh YOUR-ORG/YOUR-REPO

# Stricter teams: also require admins to pass the smoke test before merging:
bash scripts/setup-github-protection.sh --enforce-admins

# Both flags together:
bash scripts/setup-github-protection.sh --enforce-admins YOUR-ORG/YOUR-REPO
```

#### `--enforce-admins` flag

By default the script sets `enforce_admins: false`, which means repository admins can still merge a PR even when the smoke test is failing. Pass `--enforce-admins` to lock this down:

```bash
bash scripts/setup-github-protection.sh --enforce-admins
```

With this flag set, **no one** — including admins — can merge into `main` until both `Smoke Test / Build` and `Smoke Test / Smoke Test` are green. This is recommended for:

- Teams that want a hard guarantee that `main` is always in a deployable state.
- Repositories where multiple admins are active and accidental bypasses are a concern.
- Production branches where a broken build reaching `main` would trigger an automatic deployment.

If you need to unblock an urgent hotfix with a failing check, re-run the script **without** `--enforce-admins` to temporarily relax the rule, merge the fix, then re-enable it:

```bash
bash scripts/setup-github-protection.sh          # relax
# ... merge your hotfix ...
bash scripts/setup-github-protection.sh --enforce-admins  # re-enable
```

The script applies a `PUT /repos/{owner}/{repo}/branches/main/protection` call that enforces:

| Required check | What it covers |
|---|---|
| `Smoke Test / Build` | TypeScript type-check + production build |
| `Smoke Test / Smoke Test` | Live HTTP probes against the deployed URL |

It also sets `strict: true` so branches must be up to date with `main` before merging.

After the script completes, verify the rule in **Settings → Branches → Branch protection rules**, or use the companion check script described below.

---

### Automated verification in CI (Branch Protection Check workflow)

A dedicated workflow (`.github/workflows/branch-protection.yml`) runs `scripts/check-github-protection.sh` automatically so misconfigurations are caught without manual effort:

- **On every push to `main`** — confirms the rule is intact after any merge.
- **Daily at 06:00 UTC** — catches accidental changes made through the GitHub UI or another script run.
- **On demand** — trigger it manually from **Actions → Branch Protection Check → Run workflow**.

The job appears in the Actions tab as **Branch Protection Check / Verify Branch Protection**. A failed run means the protection rule for `main` is missing, no longer lists both required checks, or (when `enforce_admins` is enabled) the enforce-admins setting has been disabled. Re-run `bash scripts/setup-github-protection.sh` to restore it, then push a commit or trigger the workflow manually to confirm.

No additional secrets are required — the workflow uses the built-in `GITHUB_TOKEN` (read-only access to repository metadata is sufficient for fetching branch protection rules).

### Failure notifications

When a monitored CI job fails, a `Notify on Failure` job runs automatically and attempts to alert your team through two optional channels. Both are entirely optional — if neither secret is configured the workflow still passes or fails on its own merits, and the notification step is silently skipped.

This applies to **both** workflows:

- **`smoke-test.yml`** — fires when **any** of the four jobs fails: `validate-secrets` (missing credentials), `validate-connectivity` (unreachable database, SMTP, or deployment host), `build` (type-check or compile error), or `smoke` (live HTTP probes). The alert message includes the name of the failed job so responders know immediately whether to rotate a credential, investigate the deployment host, or look at application code.
- **`branch-protection.yml`** — fires when the `Verify Branch Protection` job fails.

The same `SLACK_WEBHOOK_URL` secret and SMTP secrets power both notification jobs, so a single configuration covers alerts from either workflow.

#### Slack

Set the `SLACK_WEBHOOK_URL` repository secret to receive a Slack message whenever the check fails. The message includes the repository name, the trigger event, and a direct link to the failing run.

| Secret name | Description | Where to obtain |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL for the channel that should receive failure alerts. | [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) → **Create an Incoming Webhook** → select a workspace and channel → copy the **Webhook URL** |

**How to create a Slack incoming webhook:**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From scratch**.
2. Name the app (e.g. `IBCCF CI`) and select the workspace.
3. Under **Features**, click **Incoming Webhooks** and toggle it on.
4. Click **Add New Webhook to Workspace**, choose the channel to post to, and click **Allow**.
5. Copy the **Webhook URL** (it looks like `https://hooks.slack.com/services/T.../B.../...`).
6. Add it as a GitHub repository secret named `SLACK_WEBHOOK_URL` under **Settings → Secrets and variables → Actions → New repository secret**.

If `SLACK_WEBHOOK_URL` is absent or empty the Slack step is skipped with no error.

#### Email

The workflow also supports email alerts using the SMTP secrets that are already required by the smoke-test workflow. All five of the following secrets must be present for the email step to run; if any are absent the step is silently skipped.

| Secret name | Purpose in failure email |
|---|---|
| `SMTP_HOST` | Outbound mail server hostname |
| `SMTP_PORT` | Outbound mail server port (`465` or `587`) |
| `SMTP_USER` | SMTP authentication username |
| `SMTP_PASSWORD` | SMTP authentication password or API key |
| `SMTP_FROM_ADDRESS` | Envelope sender address |
| `SMTP_FROM_NAME` | Display name shown in the From field |
| `SMTP_REPLY_TO` | Address the failure alert is sent **to** |

These secrets are the same ones documented in the **Required secrets** table above. If you have already added them for the smoke-test workflow, email failure alerts are enabled automatically with no extra configuration.

### `enforce_admins` workflow input

The workflow exposes a boolean `workflow_dispatch` input named **`enforce_admins`** (default: `true`) that controls whether `--enforce-admins` is passed to `check-github-protection.sh`:

| Trigger | Behaviour |
|---|---|
| Push to `main` | Always passes `--enforce-admins` (catches regressions on every merge) |
| Scheduled daily run | Always passes `--enforce-admins` (catches UI changes between pushes) |
| Manual dispatch (`workflow_dispatch`) | Passes `--enforce-admins` when the input is `true` (the default); omits it when set to `false` |

When `enforce_admins` is checked and the setting has been disabled on the branch protection rule, the run fails with a clear message:

```
  FAIL  enforce_admins is not enabled — admins can bypass required checks
        Run 'bash scripts/setup-github-protection.sh --enforce-admins' to fix this.
```

To temporarily disable the enforce-admins check for a manual run (e.g. when you intentionally relax the rule for a hotfix), trigger the workflow from **Actions → Branch Protection Check → Run workflow** and uncheck the `enforce_admins` input before clicking **Run workflow**.

---

### Verifying the protection rule (one command)

After running the setup script — or at any point in CI — you can confirm that both required checks are present without opening the GitHub UI:

```bash
# From the repository root — auto-detects the repo from git remote:
bash scripts/check-github-protection.sh

# Or pass the repo explicitly if you are working in a fork:
bash scripts/check-github-protection.sh YOUR-ORG/YOUR-REPO

# Also verify that enforce_admins is enabled (mirrors --enforce-admins on setup):
bash scripts/check-github-protection.sh --enforce-admins

# Both flags together:
bash scripts/check-github-protection.sh --enforce-admins YOUR-ORG/YOUR-REPO
```

The script calls `GET /repos/{owner}/{repo}/branches/main/protection` and reports the result for each required check:

```
Checking branch protection for: your-org/your-repo (branch: main)

  PASS  Smoke Test / Build
  PASS  Smoke Test / Smoke Test

Branch protection is correctly configured — all required checks are present.
```

#### `--enforce-admins` flag

Pass `--enforce-admins` to also verify that `enforce_admins` is enabled on the branch protection rule (i.e. admins cannot bypass required checks). This mirrors the `--enforce-admins` flag on `setup-github-protection.sh` — if you set up the rule with that flag, use the same flag when verifying it:

```bash
bash scripts/check-github-protection.sh --enforce-admins
```

When `enforce_admins` is enabled the output includes an extra line:

```
Checking branch protection for: your-org/your-repo (branch: main)

  PASS  Smoke Test / Build
  PASS  Smoke Test / Smoke Test
  PASS  enforce_admins (admins must also pass required checks)

Branch protection is correctly configured — all required checks are present.
```

If `enforce_admins` is not enabled but the flag was passed, the script exits **1** with a clear message:

```
  FAIL  enforce_admins is not enabled — admins can bypass required checks
        Run 'bash scripts/setup-github-protection.sh --enforce-admins' to fix this.
```

If a check is missing or no rule exists the script exits **1** with a clear message and tells you to run `setup-github-protection.sh` to fix it. Exit **0** means the rule is in place, both checks are required, and (when `--enforce-admins` is passed) admins are also bound by the rule.

You can run this in CI (for example, as a repository health check or post-deploy gate) since it only requires read access to the repository and a `gh` authentication token.

---

### Manual alternative (GitHub UI)

If you prefer to configure the rule through the web UI instead of the script:

1. Open your GitHub repository and go to **Settings → Branches**.
2. Under **Branch protection rules**, click **Add rule** (or edit the existing rule for `main`).
3. In the **Branch name pattern** field enter `main`.
4. Check **Require status checks to pass before merging**.
5. Check **Require branches to be up to date before merging** (recommended — ensures the check ran against the latest merge commit).
6. In the search box that appears, search for and select each of the following checks:

   | Check name | What it covers |
   |---|---|
   | `Smoke Test / Validate Secret Connectivity` | TCP/HTTP probes confirming DATABASE_URL, SMTP, and DEPLOY_URL are reachable |
   | `Smoke Test / Build` | TypeScript type-check + production build |
   | `Smoke Test / Smoke Test` | Live HTTP probes against the deployed URL |

   > **Tip**: The checks only appear in the search box after the workflow has run at least once on `main`. If they are not listed yet, push a commit or trigger the workflow manually (**Actions → Smoke Test → Run workflow**), then come back and add the rules.

7. Optionally enable **Do not allow bypassing the above settings** so that even repository admins cannot force-merge a failing PR.
8. Click **Save changes**.

After this is configured, GitHub will block any PR whose head branch has a failing `Smoke Test / Build` or `Smoke Test / Smoke Test` check, and the **Merge** button on the PR page will remain greyed out until both checks are green.

### Workflow job names

The status check names shown in the GitHub UI are derived from the workflow `name:` and job `name:` fields in `.github/workflows/smoke-test.yml`:

```
Smoke Test        ← workflow name (line 1)
├── Build         ← jobs.build.name  → "Smoke Test / Build"
└── Smoke Test    ← jobs.smoke.name  → "Smoke Test / Smoke Test"
```

If you ever rename a job, remember to update the branch protection rule to match the new name or the check will silently stop gating merges.

## Rotating secrets

If you rotate any credential (e.g. database password, SMTP password), update the corresponding GitHub secret immediately and re-run the smoke test manually (**Actions → smoke-test → Run workflow**) to confirm the new value works before the next automatic run.

---

## Keeping secrets in sync

The required-secrets table above is verified automatically by a lint script. Whenever you add a new required secret to `server/env.ts` (inside `validateEnv()`), the CI workflow auto-inserts the missing entries for you — but you still need to fill in the human-readable columns by hand. The four things that must be in sync are:

1. The `secrets=(...)` array in the `validate-secrets` job of `.github/workflows/smoke-test.yml`.
2. A row in the **Required secrets** table in this file (`CI_SETUP.md`), with all four columns filled in: Secret name, Description, Example value, and Where to obtain.
3. The "requires **N** GitHub repository secrets" count in the first sentence of this file, and the matching "All **N** required secrets are present" echo at the end of the `validate-secrets` run block.
4. Either a `process.env.<NAME>` reference inside `validateEnv()` in `server/env.ts` (so a missing or weak value is caught at server startup), or an entry in the `DOCS_NOT_STARTUP_VALIDATED` exclusion list in `scripts/check-ci-secrets-sync.sh` if the server handles the absence gracefully (e.g. best-effort email sends, ORM-level database connection check). The lint script checks this automatically and fails if a documented secret falls into neither category.

### Auto-sync script

`scripts/sync-ci-secrets.sh` auto-inserts missing entries across all three sources and then fixes the hardcoded counts. Run it locally after adding a new secret to `validateEnv()`:

```bash
bash scripts/sync-ci-secrets.sh
```

The script:
- Reads the authoritative list of required secrets from `validateEnv()` in `server/env.ts`.
- Inserts any secrets that are missing from the `validate-secrets` env: block and `secrets=(...)` array in `smoke-test.yml`.
- Appends a skeleton row (`| \`NAME\` | _TODO: add description_ | \`placeholder\` | _TODO: where to obtain_ |`) to the **Required secrets** table here for any secrets that are missing from the docs.
- Updates the hardcoded counts in both files (delegates to `update-ci-secret-count.sh`).

**After running the script**, fill in the Description, Example value, and Where to obtain columns for any skeleton rows before opening your PR. The lint script will fail if any row in the table still contains a `_TODO:` placeholder — see [Automated check](#automated-check) below.

The script is idempotent — running it when all sources are already in sync makes no changes.

The sync script's insertion logic is covered by an automated test:

```bash
bash scripts/test-sync-ci-secrets.sh
```

The test spins up isolated temp copies of all three files, introduces an artificial gap (a new secret present only in `server/env.ts`), runs `sync-ci-secrets.sh`, and asserts that the env: mapping, secrets=() array entry, and skeleton docs row were all inserted correctly. It then runs the script a second time to confirm idempotency.

### Automated check

A dedicated workflow (`.github/workflows/ci-secrets-sync.yml`) runs `scripts/sync-ci-secrets.sh` (auto-inserts + count fix) followed by `scripts/check-ci-secrets-sync.sh` (drift check) automatically on every push and pull request that touches `CI_SETUP.md`, `smoke-test.yml`, `server/env.ts`, or any of the sync scripts. On push events, any changes made by the auto-sync run are committed back automatically. On pull-request events, a warning annotation is emitted and the author is asked to run the sync script locally.

If the `check-sync` job fails, a `Notify on Failure` job fires automatically. Both the auto-sync step (`sync-ci-secrets.sh`) and the drift-check step (`check-ci-secrets-sync.sh`) run with `continue-on-error: true` so their outcomes are captured independently. A `Resolve failure source` step identifies exactly which step failed and exports it as the `failed_step` job output. The notify job reads that output and names the specific failing step (e.g. `Auto-sync (sync-ci-secrets.sh)` or `Drift-check (check-ci-secrets-sync.sh)`) in the alert body so responders immediately know what to investigate. It posts a Slack alert (when `SLACK_WEBHOOK_URL` is set) and/or sends an email (when the five SMTP secrets are configured), or annotates the Actions run summary when neither channel is configured.

The drift check also enforces that **no row in the Required secrets table may contain a `_TODO:` placeholder** in any column. If a skeleton row inserted by the sync script has not been filled in, the check fails with a clear message listing the offending rows.

Run only the drift check locally at any time (no modifications made):

```bash
bash scripts/check-ci-secrets-sync.sh
```

Example passing output:

```
Secrets in .github/workflows/smoke-test.yml (validate-secrets job):
  ADMIN_PASSWORD
  ADMIN_USERNAME
  DATABASE_URL
  DEPLOY_URL
  SESSION_SECRET
  SMTP_FROM_ADDRESS
  SMTP_FROM_NAME
  SMTP_HOST
  SMTP_PASSWORD
  SMTP_PORT
  SMTP_REPLY_TO
  SMTP_USER

Secrets in CI_SETUP.md (## Required secrets table):
  ADMIN_PASSWORD
  ...

OK: Both files list identical secrets — no drift detected.
```

Example failing output (secret added to workflow but docs not updated):

```
DRIFT DETECTED — CI_SETUP.md and smoke-test.yml are out of sync.

Secrets present in .github/workflows/smoke-test.yml but MISSING from CI_SETUP.md:
  NEW_SECRET

  Fix: add a row for each missing secret to the '## Required secrets'
  table in CI_SETUP.md, filling in the Description, Example value,
  and 'Where to obtain' columns.
```

Example failing output (sync script ran but skeleton row was not filled in):

```
DRIFT DETECTED — secrets are out of sync across one or more sources.

TODO PLACEHOLDERS FOUND in CI_SETUP.md (## Required secrets table):
  | `NEW_SECRET` | _TODO: add description_ | `placeholder` | _TODO: where to obtain_ |

  The sync script inserted skeleton rows for one or more secrets.
  Fill in the Description, Example value, and Where to obtain
  columns for every row that still contains '_TODO:' before opening
  your PR.
```

### PR checklist

The repository's pull request template (`.github/pull_request_template.md`) includes a checklist section that fires when a PR touches `smoke-test.yml` or `server/index.ts`. The automated workflow is the authoritative gate; the PR checklist is an additional reminder for contributors working on those files.

---

# CI Setup — Browser-based portal tests (Playwright e2e)

The `.github/workflows/e2e-tests.yml` workflow runs the Playwright specs under `e2e/` on every push and pull request. It spins up an ephemeral Postgres service container, boots the application against it, and drives the UI with a headless Chromium that Playwright provisions itself.

Locally on Replit the same command works without manual setup: `npm run test:e2e` first runs a `pretest:e2e` hook that idempotently calls `playwright install chromium` to fetch the browser binary into `.cache/ms-playwright/`. The system libraries Chromium depends on (`glib`, `nss`, `nspr`, `atk`, `cups`, `libdrm`, `libxkbcommon`, `mesa`, `pango`, `cairo`, the X11 libs, etc.) are provisioned via the project's `replit.nix` file — keep that file in sync if Playwright bumps its Chromium build and requires additional libraries.

## How the workflow uses secrets

The e2e job sources its environment variables from the workflow file itself (throwaway values for an ephemeral Postgres container that only exists for the duration of the job). It does **not** read production secrets — the goal is to keep the e2e suite hermetic and avoid any chance of mutating real data.

## Required CI secrets

The Playwright specs need an admin account to load the admin login screen and exercise the password-strength meter. The workflow currently bakes in throwaway values, but if you re-run the workflow against a non-ephemeral environment (e.g. a long-lived staging database) you must replace the inline values with GitHub repository secrets:

| Secret name | Description | Used by |
|---|---|---|
| `ADMIN_USERNAME` | Username for the admin account the Playwright specs log in with. Must satisfy the server's username rules (≥ 6 chars, not on the weak-username blocklist, unless `ALLOW_WEAK_ADMIN_PASSWORD=1` is set for the job). | `e2e/admin-password-strength.spec.ts`, `e2e/admin-settings-password-strength.spec.ts` |
| `ADMIN_PASSWORD` | Password for the admin account. Must satisfy the server's password strength rules (≥ 12 chars, mixed case, digit, special char, unless `ALLOW_WEAK_ADMIN_PASSWORD=1` is set for the job). | Same as above. |

To wire them in:

1. Add `ADMIN_USERNAME` and `ADMIN_PASSWORD` under **Settings → Secrets and variables → Actions → New repository secret**.
2. In `.github/workflows/e2e-tests.yml`, replace the inline `env:` entries with `${{ secrets.ADMIN_USERNAME }}` / `${{ secrets.ADMIN_PASSWORD }}`.
3. Remove `ALLOW_WEAK_ADMIN_PASSWORD: "1"` from the workflow `env:` block if the real password already satisfies the strength rules.

> The other env vars the job sets (`DATABASE_URL`, `SESSION_SECRET`, `ALLOW_WEAK_SESSION_SECRET`) are all scoped to the ephemeral Postgres service container and the throwaway in-job process; they never need to be promoted to repository secrets.

## Troubleshooting

- **`browserType.launch: ... libglib-2.0.so.0: cannot open shared object file`** — Chromium's system libraries are missing. In CI the workflow installs them via `npx playwright install --with-deps chromium`; on Replit they are listed in `replit.nix`. If a future Playwright upgrade adds new lib requirements, add the corresponding `pkgs.<lib>` entries to `replit.nix` and re-open the Repl so Nix rebuilds the environment.
- **`Executable doesn't exist at .cache/ms-playwright/chromium-XXXX/...`** — the browser binary hasn't been fetched yet. Run `npm run test:e2e` once (the `pretest:e2e` hook will install it) or run `npx playwright install chromium` manually.
- **`ERR_CONNECTION_REFUSED at http://localhost:5000`** — the dev server failed to start. Check that `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` are all set in the job's `env:` block, and that the Postgres service container is healthy.

---

# CI Setup — Tawk.to Live Widget Staging

The `.github/workflows/e2e-tawkto-live.yml` workflow is a **manually triggered** staging job that runs the portal-warning-contact-support Playwright spec against real Tawk.to credentials. Unlike the regular e2e suite, which stubs `window.Tawk_API`, this job loads the live Tawk.to embed script so any drift between the stub surface and the real API is caught before it reaches production.

Trigger it from the GitHub UI (**Actions → "E2E Tawk.to Live Widget Staging" → Run workflow**) or via the CLI (`gh workflow run e2e-tawkto-live.yml`).

## Required secrets

The job reads two secrets that must be configured before it is run. If either is missing or empty, a **"Verify required secrets are set"** preflight step exits immediately with a readable error message listing which secrets need to be added — no time is wasted on dependency installation or database migrations.

| Secret name | Description | Where to obtain |
|---|---|---|
| `VITE_TAWKTO_PROPERTY_ID` | The Tawk.to property ID for your account. Makes `isTawktoConfigured()` return `true` so the real embed script loads during the test. | [tawk.to](https://tawk.to) dashboard → Administration → Property settings → copy the Property ID |
| `VITE_TAWKTO_WIDGET_ID` | The Tawk.to widget ID (chat widget) within the property. | Same dashboard → select the widget → copy the Widget ID |

Add both under **Settings → Secrets and variables → Actions → New repository secret**.

> These secrets are intentionally excluded from the regular `e2e-tests.yml` workflow. The live-widget describe block in `e2e/portal-warning-contact-support.spec.ts` is gated on `TAWKTO_LIVE_TEST=1`, which is only set in this staging workflow, so the live Tawk.to network calls never occur during ordinary CI runs.

## How the preflight check works

Before any expensive steps (npm install, database push), the **"Verify required secrets are set"** step re-reads both secrets into step-local env variables and checks that neither is empty. If GitHub has not configured one or both secrets, it silently injects an empty string; the check catches this and fails with output like:

```
ERROR: The following required secrets are not set or are empty:
  - VITE_TAWKTO_PROPERTY_ID

Add them under Settings → Secrets and variables → Actions.
See CI_SETUP.md (Tawk.to Live Widget Staging section) for details.
```

## Troubleshooting

- **Preflight fails with "required secrets are not set"** — add the missing secrets listed in the error output to **Settings → Secrets and variables → Actions**.
- **Live-widget describe block is skipped even though secrets are set** — confirm that `TAWKTO_LIVE_TEST` is set to `"1"` in the workflow `env:` block (it is, by default) and that the secrets contain the correct values for your Tawk.to account (wrong IDs cause the embed to fail silently).
- **Tawk.to script times out or fails to initialise** — the live widget depends on Tawk.to's CDN being reachable from the GitHub Actions runner. Intermittent CDN issues are outside your control; re-run the workflow after a few minutes.
