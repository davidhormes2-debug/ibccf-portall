# Deploying IBCCF to Railway

Railway is the easiest way to deploy this application with a built-in PostgreSQL database.

## Step 1: Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Sign up with your GitHub account (recommended)

## Step 2: Deploy from GitHub

1. Push your code to a GitHub repository (or download from Replit and upload)
2. In Railway dashboard, click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will auto-detect it's a Node.js app

## Step 3: Add PostgreSQL Database

1. In your project, click **"+ New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Railway creates the database instantly

## Step 4: Connect Database to App

1. Click on your web service
2. Go to **"Variables"** tab
3. Click **"Add Variable"**
4. Add: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   (Railway will auto-fill this from your database)

## Step 5: Add Other Environment Variables

Add these variables in the Variables tab:

| Variable | Value |
|----------|-------|
| `SESSION_SECRET` | Any random string (e.g., `my-super-secret-key-2024`) |
| `NODE_ENV` | `production` |
| `OPENAI_API_KEY` | Your OpenAI API key (optional, for AI features) |

## Step 6: Configure Build Settings

In your service settings:
- **Build Command:** `npm run build`
- **Start Command:** `npm start`
- **Root Directory:** `/` (leave empty)

## Step 7: Deploy

Railway will automatically:
1. Install dependencies
2. Build your app
3. Start the server
4. Provide you with a public URL

## Step 8: Initialize Database

After first deployment, you may need to push the database schema:

1. In Railway, go to your PostgreSQL service
2. Copy the connection string
3. Run locally: `DATABASE_URL="your-railway-url" npm run db:push`

Or use Railway CLI:
```bash
npm i -g @railway/cli
railway login
railway link
railway run npm run db:push
```

## Your App URLs

After deployment:
- **Main site:** `https://your-app.up.railway.app`
- **Admin panel:** `https://your-app.up.railway.app/admin`

## Admin Credentials

Set the admin credentials via Railway environment variables before first boot —
do not rely on any hardcoded defaults:

- `ADMIN_USERNAME` — `<choose-a-username>`
- `ADMIN_PASSWORD` — `<choose-a-strong-password>` (the server refuses to start
  on weak / common / low-entropy values)
- `SESSION_SECRET` — `<a-long-random-string>` (use e.g. `openssl rand -hex 32`)

Sign in at `https://your-app.up.railway.app/admin` with the values you set.
User portal access codes are generated per case from the admin dashboard;
there is no shared demo code in production.

## Estimated Cost

~$12/month for:
- Web service (~$8)
- PostgreSQL database (~$4)

Railway uses usage-based pricing, so costs scale with traffic.

## Custom Domain (Optional)

1. Go to your service settings
2. Click **"Settings"** → **"Networking"**
3. Add your custom domain
4. Update your domain's DNS to point to Railway

## Edge Caching of Marketing HTML

The origin emits the following `Cache-Control` header on every marketing /
public-content HTML response (anything that isn't `/portal/*` or `/api/*`):

```
Cache-Control: public, max-age=300, s-maxage=300, stale-while-revalidate=600, must-revalidate
Vary: Accept-Language
ETag: "..."
Last-Modified: <boot time>
```

- `s-maxage=300` tells any upstream shared cache (Railway's edge proxy or a
  CDN you put in front, e.g. Cloudflare) that it may serve the cached HTML
  for up to 5 minutes without revalidating against the origin.
- `stale-while-revalidate=600` lets the edge serve a stale hit for up to 10
  additional minutes while it refreshes in the background, so repeat hits
  during a revalidate window don't touch origin.
- `Vary: Accept-Language` keeps locales partitioned so a `fr` visitor never
  sees the cached `en` payload for the same path.
- Portal (`/portal/*`) and API (`/api/*`) responses are emitted with
  `Cache-Control: no-store` and must remain uncached at the edge.

### Verifying the edge actually caches

If you front Railway with Cloudflare or a similar CDN, look for `cf-cache-status: HIT`
(or your provider's equivalent — Fastly `x-cache: HIT`, Vercel `x-vercel-cache: HIT`)
on the second request for the same URL within 5 minutes:

```
curl -sI https://yourdomain.com/ -H 'Accept-Language: en' | grep -iE 'cache-control|cf-cache-status|x-cache'
curl -sI https://yourdomain.com/ -H 'Accept-Language: en' | grep -iE 'cache-control|cf-cache-status|x-cache'
```

The first call typically returns `MISS`/`EXPIRED`; subsequent calls within
the freshness window should return `HIT`. If you only see `MISS`, double-check
that the edge isn't stripping `Cache-Control` and that the response is not
being marked uncacheable by the proxy (e.g. cookies or unusual `Vary` values).

## GitHub Actions CI — Smoke Test Setup

The repository includes `.github/workflows/smoke-test.yml`, which runs a
suite of HTTP checks against your live deployment after every push to `main`.

> **Full secrets checklist**: See [`CI_SETUP.md`](CI_SETUP.md) for the
> complete list of every GitHub Actions secret and variable required to run
> the automated smoke test, including descriptions, example values, and
> instructions for obtaining each one.

The sections below cover the Railway-specific steps for the two most common
configuration items: the deployment URL variable and the required secrets.

### Step 1 — Configure the required secrets

The workflow validates **12 required secrets** before running any checks. If
any are missing, the `Validate Required Secrets` job fails immediately and
names each missing secret in the log.

Go to **Settings → Secrets and variables → Actions → Secrets tab** and add
all required secrets listed in [`CI_SETUP.md §Required secrets`](CI_SETUP.md#required-secrets).
The key values for a Railway deployment are:

- **`DATABASE_URL`** — use the Railway Postgres connection string (copy from
  your Railway service's **Variables** tab, e.g.
  `postgresql://user:pass@host/db?sslmode=require`).
- **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`** — the credentials the smoke
  test uses to hit the admin endpoints.
- **`DEPLOY_URL`** — your Railway public URL (e.g.
  `https://your-app.up.railway.app`).
- All seven `SMTP_*` secrets and `SESSION_SECRET` — see
  [`CI_SETUP.md`](CI_SETUP.md) for details.

### Step 2 — Find your Railway deployment URL

After your service deploys, Railway displays the public URL in the service
dashboard (e.g. `https://your-app.up.railway.app`). Copy the full URL
including the `https://` scheme.

### Step 3 — Add SMOKE_TEST_URL to your GitHub repository

1. Open your GitHub repository and go to **Settings → Secrets and variables →
   Actions → Variables tab**.
2. Click **New repository variable**.
3. Set **Name** to `SMOKE_TEST_URL`.
4. Set **Value** to your Railway URL (e.g. `https://your-app.up.railway.app`).
5. Click **Add variable**.

**Why a variable instead of a secret?** The URL is not sensitive — Railway
URLs are public. Using a plain variable (rather than an encrypted secret)
makes it visible in the Actions UI so team members can confirm which
environment is being tested. If your deployment URL must stay private, you can
add `SMOKE_TEST_URL` under **Secrets** instead; the workflow checks
`vars.SMOKE_TEST_URL` first and falls back to `secrets.SMOKE_TEST_URL`
automatically.

### Step 4 — Verify it works

Push any commit to `main` (or re-run the workflow manually). The **Smoke
Test** job will print the resolved URL at the start and then run the health
checks. If the URL is missing, the job fails immediately with an actionable
error message pointing back here.

### One-off override via workflow_dispatch

You can also trigger the smoke test against a different URL without changing
the stored variable — for example, to test a staging slot or a PR preview
before merging:

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
