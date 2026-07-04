# Deploying IBCCF to Hostinger

This guide explains how to deploy the IBCCF application to Hostinger.

## Prerequisites

1. **Hostinger Business or Cloud Plan** - Required for Node.js support
2. **External PostgreSQL Database** - Hostinger doesn't provide PostgreSQL. Use one of:
   - [Neon](https://neon.tech) (Free tier available)
   - [Supabase](https://supabase.com) (Free tier available)
   - [Railway](https://railway.app)

## Step 1: Set Up Your Database

1. Create a free account on [Neon](https://neon.tech)
2. Create a new project and database
3. Copy the connection string (it looks like: `postgresql://user:pass@host/db?sslmode=require`)

## Step 2: Prepare Your Code

### Option A: Deploy via GitHub (Recommended)

1. Push your code to a GitHub repository
2. Make sure these files are in your repo:
   - `package.json` with build and start scripts
   - All source code files

### Option B: Upload as ZIP

1. Run locally first to build:
   ```bash
   npm install
   npm run build
   ```
2. Zip the entire project folder (excluding `node_modules`)

## Step 3: Deploy on Hostinger

1. Log in to [Hostinger hPanel](https://hpanel.hostinger.com)
2. Go to **Websites** → **Add Website** → **Node.js App**
3. Choose your deployment method:
   - **GitHub**: Connect your repository and select the branch
   - **Upload**: Upload your ZIP file

4. Configure the app settings:
   - **Entry point**: `dist/index.cjs`
   - **Node version**: 18 or higher
   - **Build command**: `npm run build`
   - **Start command**: `npm start`

## Step 4: Set Environment Variables

In the Hostinger Node.js app dashboard, add these environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Your PostgreSQL connection string from Neon/Supabase |
| `SESSION_SECRET` | A random secret string (generate one at random.org) |
| `OPENAI_API_KEY` | Your OpenAI API key (optional, for AI features) |
| `NODE_ENV` | Set to `production` |

## Step 5: Initialize Database

After the first deployment, you need to set up the database tables:

1. Connect to your database using a tool like [pgAdmin](https://www.pgadmin.org/) or the Neon/Supabase web console
2. The tables will be created automatically when the app first connects

Or run the migration command locally with your production DATABASE_URL:
```bash
DATABASE_URL="your-production-url" npm run db:push
```

## Step 6: Custom Domain (Optional)

1. In Hostinger dashboard, go to your website settings
2. Click **Add Domain**
3. Enter your custom domain
4. Update your domain's DNS to point to Hostinger

## Troubleshooting

### App won't start
- Check the logs in Hostinger dashboard
- Verify all environment variables are set correctly
- Make sure DATABASE_URL has `?sslmode=require` at the end

### Database connection errors
- Verify your database URL is correct
- Check if your database provider allows connections from Hostinger's IP

### Build fails
- Ensure Node.js version is 18+
- Check that all dependencies are listed in package.json

## Admin Access

> ⚠️ **SECURITY WARNING — CHANGE BEFORE ACCEPTING REAL TRAFFIC** ⚠️
>
> The default admin credentials below are **publicly documented** in this file.
> Any deployment that goes live without changing them is immediately vulnerable
> to account takeover.  **Do not skip this step.**
>
> **Before the server accepts real traffic you MUST:**
> 1. Set the `ADMIN_USERNAME` environment variable to a non-default value.
> 2. Set the `ADMIN_PASSWORD` environment variable to a strong, unique password
>    (minimum 20 characters, mixed case + digits + symbols).
> 3. Verify the change took effect by logging in with the new credentials and
>    confirming the old ones are rejected.
>
> The values below are **first-boot defaults only** — treat them as placeholders,
> not as real credentials.

After deployment, access the admin panel at:
- URL: `https://yourdomain.com/admin`
- Default username: `Admin2025`  ← **replace via `ADMIN_USERNAME` env var**
- Default password: `Admin123456789`  ← **replace via `ADMIN_PASSWORD` env var**

> ⚠️ These defaults must be rotated before the site goes live. ⚠️

## Edge Caching of Marketing HTML

The origin emits the following `Cache-Control` header on every marketing /
public-content HTML response (anything that isn't `/portal/*` or `/api/*`):

```
Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=600, must-revalidate
Vary: Accept-Language
ETag: "..."
Last-Modified: <boot time>
```

- `s-maxage=300` lets any upstream shared cache (Hostinger's edge / LiteSpeed
  cache, or a CDN like Cloudflare in front of it) reuse the cached HTML for
  up to 5 minutes without hitting origin.
- `stale-while-revalidate=600` lets the edge serve a stale hit for 10 more
  minutes while refreshing in the background, so repeat hits during a
  revalidate never reach origin.
- `Vary: Accept-Language` keeps locales partitioned in shared caches.
- Portal (`/portal/*`) and API (`/api/*`) responses ship with
  `Cache-Control: no-store` and must remain uncached at the edge.

### Verifying the edge actually caches

Hit the same URL twice within the freshness window and look for the cache
status header from your provider (Cloudflare `cf-cache-status`, generic
`x-cache`):

```
curl -sI https://yourdomain.com/ -H 'Accept-Language: en' | grep -iE 'cache-control|cf-cache-status|x-cache'
curl -sI https://yourdomain.com/ -H 'Accept-Language: en' | grep -iE 'cache-control|cf-cache-status|x-cache'
```

The first call usually returns `MISS`/`EXPIRED`; subsequent calls within 5
minutes should return `HIT`. If you only see `MISS`, check that the edge
isn't stripping `Cache-Control`, that no cookies are being attached to
marketing responses, and that LiteSpeed/Cloudflare page rules aren't
overriding the directive.

## GitHub Actions CI — Smoke Test Setup

The repository includes `.github/workflows/smoke-test.yml`, which runs a
suite of HTTP checks against your live deployment after every push to `main`.

> **Full secrets checklist**: See [`CI_SETUP.md`](CI_SETUP.md) for the
> complete list of every GitHub Actions secret and variable required to run
> the automated smoke test, including descriptions, example values, and
> instructions for obtaining each one.

The sections below cover the Hostinger-specific steps for the two most common
configuration items: the deployment URL variable and the required secrets.

### Step 1 — Configure the required secrets

The workflow validates **12 required secrets** before running any checks. If
any are missing, the `Validate Required Secrets` job fails immediately and
names each missing secret in the log.

Go to **Settings → Secrets and variables → Actions → Secrets tab** and add
all required secrets listed in [`CI_SETUP.md §Required secrets`](CI_SETUP.md#required-secrets).
The key values for a Hostinger deployment are:

- **`DATABASE_URL`** — the Neon/Supabase connection string you configured in
  Step 4 (e.g. `postgresql://user:pass@host/db?sslmode=require`).
- **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`** — the credentials the smoke
  test uses to hit the admin endpoints.
- **`DEPLOY_URL`** — your Hostinger public URL or custom domain (e.g.
  `https://yourdomain.com`).
- All seven `SMTP_*` secrets and `SESSION_SECRET` — see
  [`CI_SETUP.md`](CI_SETUP.md) for details.

### Step 2 — Find your Hostinger deployment URL

After your app is deployed, Hostinger displays the public URL in the Node.js
app dashboard (e.g. `https://yourdomain.com` or the temporary Hostinger
preview URL). Copy the full URL including the `https://` scheme.

### Step 3 — Add SMOKE_TEST_URL to your GitHub repository

1. Open your GitHub repository and go to **Settings → Secrets and variables →
   Actions → Variables tab**.
2. Click **New repository variable**.
3. Set **Name** to `SMOKE_TEST_URL`.
4. Set **Value** to your deployment URL (e.g. `https://yourdomain.com`).
5. Click **Add variable**.

**Why a variable instead of a secret?** The URL is not sensitive for most
deployments. Using a plain variable (rather than an encrypted secret) makes it
visible in the Actions UI so team members can confirm which environment is
being tested. If your URL must stay private, add `SMOKE_TEST_URL` under
**Secrets** instead; the workflow checks `vars.SMOKE_TEST_URL` first and falls
back to `secrets.SMOKE_TEST_URL` automatically.

### Step 4 — Verify it works

Push any commit to `main` (or re-run the workflow manually). The **Smoke
Test** job will print the resolved URL at the start and then run the health
checks. If the URL is missing, the job fails immediately with an actionable
error message pointing back here.

### One-off override via workflow_dispatch

You can trigger the smoke test against a different URL without changing the
stored variable — for example, to test a staging or preview environment before
merging:

1. Go to **Actions → Smoke Test → Run workflow**.
2. Enter a value in the **Override the deployment URL to test against** field.
3. Click **Run workflow**.

The `target_url` input takes precedence over `SMOKE_TEST_URL` for that single
run only.

## GitHub Branch Protection — Required Status Checks

To prevent regressions from landing on `main`, configure the following CI jobs
as **required status checks** in **Settings → Branches → Branch protection
rules** for the `main` branch. A PR cannot be merged until every required
check passes.

| Required check | Workflow file | What it covers |
|---|---|---|
| `Vitest` | `unit-tests.yml` | Full server + client unit-test suite |
| `i18n Key Consistency` | `i18n-check.yml` | Translation key parity across all six locales |
| `Tutorial Recordings Freshness` | `unit-tests.yml` | Ensures committed MP4 tutorial recordings are up to date with the current video source (runs when `video/**` or `client/src/components/portal/withdrawal-video/**` changes) |

> **`Tutorial Recordings Freshness` note**: this job runs only when video-related
> paths change (`needs.changes.outputs.video == 'true'`), so it is skipped on
> unrelated PRs. GitHub treats a skipped required check as passing, so it will
> not block non-video PRs. If no MP4 files are committed to
> `video/public/recordings/`, the freshness step is also skipped automatically.

The fastest way to configure all required checks at once is the included script:

```bash
bash scripts/setup-github-protection.sh
```

See [`CI_SETUP.md §Requiring the smoke test to pass before merging`](CI_SETUP.md#requiring-the-smoke-test-to-pass-before-merging)
for full setup instructions and the companion verification script.

### Branch protection drift alerts

The `branch-protection.yml` workflow runs daily and on every push to `main`.
When it detects drift it tries to notify the team through an external channel.
To receive those alerts, add one or both of the following to **Settings →
Secrets and variables → Actions → Secrets**:

| Secret(s) | What it enables |
|---|---|
| `SLACK_WEBHOOK_URL` | Posts a Slack message with the cause and a fix command |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_ADDRESS`, `SMTP_REPLY_TO` | Sends an email alert to `SMTP_REPLY_TO` |

If neither set is present the workflow still annotates the Actions run summary,
but no external notification reaches the team.

## Support

For issues with:
- **Hostinger hosting**: Contact Hostinger support
- **Database (Neon/Supabase)**: Contact the respective provider
- **Application code**: Review logs and error messages
