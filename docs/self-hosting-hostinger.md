# Self-Hosting IBCCF on Hostinger Cloud (VPS + PM2 + Nginx)

This runbook covers standing the app up on a **Hostinger Cloud Hosting**
instance (a full VPS with root/SSH access) — as opposed to Hostinger's
managed shared/Business Node.js hosting, which is covered by
[`HOSTINGER_DEPLOY.md`](../HOSTINGER_DEPLOY.md). Use this guide if you want
full control: your own PM2 process manager, your own Nginx reverse proxy,
and Let's Encrypt TLS.

> **Scope note**: this doc only covers the steps this repo's code depends on.
> Actually provisioning the VPS, logging into it, and pointing DNS at it are
> manual steps you perform outside this codebase.

## 1. Prerequisites

- A Hostinger Cloud Hosting (VPS) plan with root/SSH access.
- A domain (or subdomain) pointed at the VPS's IP address (A record).
- Node.js 20.x and `npm` installed on the VPS.
- PostgreSQL, either:
  - **Self-managed on the same VPS** (`apt install postgresql`), or
  - **An external managed Postgres** (Neon, Supabase, Hostinger's own DB
    product, etc.) — any standard `postgresql://` connection string works
    unmodified (see §5, "Database portability notes").

## 2. Export / restore the PostgreSQL database

If you're migrating an existing database (e.g. from Neon or another host):

```bash
# On the OLD database host — dump schema + data
pg_dump "$OLD_DATABASE_URL" --format=custom --file=ibccf.dump

# Copy ibccf.dump to the new VPS (scp, rsync, etc.), then on the NEW host:
createdb ibccf
pg_restore --dbname=ibccf --no-owner --no-privileges ibccf.dump
```

If you're starting fresh, skip the dump/restore and just create an empty
database — the app's `npm run db:push` step (below) creates all tables.

## 3. Set environment variables / secrets on the Hostinger instance

Create a `.env` file (or set real environment variables via your process
manager / systemd unit) with at minimum:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/db?sslmode=require` (or `disable` if Postgres is local-only on the same VPS with no TLS listener) |
| `SESSION_SECRET` | Yes | 32+ random characters, e.g. `openssl rand -hex 32` |
| `ADMIN_USERNAME` | Yes | Non-default, non-guessable (rejected at boot otherwise — see `server/env.ts`) |
| `ADMIN_PASSWORD` | Yes | At least 8 characters, not a known weak/blocklisted password, and not a keyboard-walk sequence (rejected at boot otherwise — see `server/env.ts`). 12+ chars with mixed case + digit + symbol is recommended and required to reach the "Strong" rating shown in the admin UI, but boot only enforces "not Weak". |
| `PUBLIC_BASE_URL` | Strongly recommended | Your public origin, e.g. `https://forum.example.com`. Used to build links in emails, AI-alert admin links, and CORS allow-listing. See §5. |
| `NODE_ENV` | Yes | `production` |
| `PORT` | No | Defaults to `5000`; the Nginx config below assumes `5000` |
| `OPENAI_API_KEY` | Optional | AI community replies fall back to static templates when absent |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_NAME` / `SMTP_FROM_ADDRESS` / `SMTP_REPLY_TO` | Optional | Transactional email is best-effort and never blocks requests if unset |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Optional | Error monitoring |

See `.env.example` in the repo root for the full annotated list.

**Do not commit `.env` to source control.** Load it via your process
manager (PM2's `env_file`, an `EnvironmentFile=` directive in systemd, or
`export`-ing the values in your shell profile before starting PM2).

## 4. Build and start under PM2

```bash
git clone <your-repo-url> ibccf && cd ibccf
npm install
npm run build            # builds client → dist/public, server → dist/index.cjs
npm run db:push          # applies the Drizzle schema to DATABASE_URL
```

Install PM2 globally and start the app with auto-restart:

```bash
npm install -g pm2

pm2 start dist/index.cjs \
  --name ibccf \
  --env production \
  --time

pm2 save                 # persist the process list
pm2 startup              # prints a systemd command — run the one it prints
                          # so PM2 (and this app) survive a VPS reboot
```

Useful PM2 commands:

```bash
pm2 logs ibccf           # tail stdout/stderr
pm2 restart ibccf        # restart after a redeploy
pm2 status               # confirm it's online and check restart count
```

`pm2 start ... --time` timestamps log lines; PM2's default behavior already
restarts the process on crash. If you redeploy by pulling new code, re-run
`npm install && npm run build` and then `pm2 restart ibccf`.

## 5. Database portability notes

`server/db.ts` and `drizzle.config.ts` both read `DATABASE_URL` (falling
back to the legacy `NEON_DATABASE_URL` name for backwards compatibility) and
connect via the standard `pg` (`node-postgres`) driver through
`drizzle-orm/node-postgres` — **not** the Neon-specific serverless/WebSocket
driver (`@neondatabase/serverless`). This means:

- No code changes are needed to point at Hostinger's own Postgres, a
  self-managed Postgres on the same VPS, or any other standard Postgres host.
- The only Neon-specific behavior in the connection string handling is the
  `uselibpqcompat=true` flag auto-appended when `sslmode=require` is present
  (silences a libpq-compatibility warning from `pg-connection-string`/`pg`
  v9). This flag is a no-op against non-Neon Postgres — safe to leave as-is.
- If your target Postgres does not support/require TLS (e.g. a local-only
  instance on the same VPS with peer/password auth over a Unix socket or
  localhost TCP), omit `sslmode=require` from the connection string entirely;
  the pool disables SSL automatically when that parameter is absent.

## 6. `PUBLIC_BASE_URL` and portable domain handling

Every place in the codebase that used to build absolute URLs from
Replit-only environment variables (`REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`) now
resolves through a single helper, `server/lib/publicBaseUrl.ts`, with this
precedence:

1. `PUBLIC_BASE_URL` — set this on Hostinger.
2. `APP_BASE_URL` — legacy alias, still honored for existing deployments.
3. `REPLIT_DOMAINS` / `REPLIT_DEV_DOMAIN` — only meaningful on Replit; safe
   to leave unset off-Replit.
4. A hard-coded canonical fallback — only used if nothing else is set, so
   the app never emits a broken `localhost` link.

Set `PUBLIC_BASE_URL=https://your-domain.example.com` (no trailing slash) so
transactional emails, AI-failure admin alert links, and CORS all resolve to
your real domain.

## 7. Nginx reverse proxy + Let's Encrypt TLS

Install Nginx and Certbot:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/ibccf`:

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 15m;   # deposit-receipt/document uploads can be up to ~13.4mb after base64
}
```

Enable the site and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/ibccf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Provision a free TLS certificate and auto-configure HTTPS redirection:

```bash
sudo certbot --nginx -d your-domain.example.com
```

Certbot edits the Nginx config in place to add the `listen 443 ssl;` block
and an HTTP→HTTPS redirect, and installs a systemd timer that renews the
certificate automatically before it expires. Verify the renewal timer is
active:

```bash
sudo systemctl status certbot.timer
```

### Important: `trust proxy`

`server/index.ts` calls `app.set("trust proxy", 1)`, which trusts exactly
**one** reverse-proxy hop in front of Express when reading `X-Forwarded-For`
(used by rate limiting and audit logging to resolve the real client IP).
The Nginx config above is a single hop directly in front of the app, so no
change is needed. If you later add a CDN or load balancer in front of Nginx,
update the trusted-hop count accordingly or IP-based rate limiting can be
bypassed via a spoofed header.

## 8. Smoke test after deploying

```bash
curl -sI https://your-domain.example.com/healthz     # expect 200
curl -sI https://your-domain.example.com/readyz       # expect 200 (confirms DB connectivity)
```

Then sign in at `https://your-domain.example.com/admin` with the
`ADMIN_USERNAME` / `ADMIN_PASSWORD` you configured, and confirm a case loads.

## 9. Redeploy workflow (subsequent updates)

```bash
cd ibccf
git pull
npm install
npm run build
npm run db:push          # only needed if shared/schema.ts changed
pm2 restart ibccf
```
