// Sentry SDK is initialised in ./instrument.ts. In dev it is preloaded
// via the Node `--import ./server/instrument.ts` flag (so auto-instrumentation
// of express/http/pg installs hooks BEFORE those modules load). In production
// the bundled CJS output runs as `node dist/index.cjs`, so we also import
// instrument here as the very first import — that guarantees Sentry.init()
// fires at startup even when --import isn't available. The init guard inside
// instrument.ts is idempotent, so the dev double-load is harmless.
import "./instrument";
import * as Sentry from "@sentry/node";

import { validateEnv } from "./env";
validateEnv();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { sitemapRouter } from "./routes/sitemap";
import { tutorialVideoRouter } from "./routes/tutorial-video";
import { healthRouter } from "./routes/health";
import { serveStatic } from "./static";
import { createServer } from "http";
import {
  securityHeaders,
  corsMiddleware,
  rateLimiter,
  inputSanitizer,
  hydratePersistedRateLimits,
} from "./middleware";
import { startBotResponseProcessor } from "./services/bot-response-generator";
import { expirePendingRequests } from "./routes/access-key-requests";
import { storage } from "./storage";
import { emitStartupSecurityWarnings } from "./startupWarnings";
import { startAuditLogRetentionSweep } from "./audit-retention";
import { startApprovedDocumentArchiveSweep } from "./document-archive";
import { startNdaIntegritySweep } from "./nda-integrity-sweep";
import { startPortalSessionCleanupSweep } from "./services/session-store";
import { startCommunityParticipantCleanupSweep } from "./community-cleanup";
import { startCommunityThreadViewsCleanupSweep } from "./community-thread-views-cleanup";
import {
  startWalletConnectAlertMarkerCleanupSweep,
  startWalletConnectCompletionBackfill,
} from "./services/walletConnectAlert";
import { startPortalWarningExpirySweep } from "./portal-warning-expiry-sweep";
import { startHealthProbe } from "./services/healthProbe";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

// Replit (and the local dev preview) front this server with exactly one
// reverse proxy hop. Trusting that single hop lets `req.ip` resolve the
// real client address from `x-forwarded-for` while still rejecting spoofed
// header values an attacker prepends — Express skips one trusted hop from
// the right of the chain. This is what the rate limiter and audit logger
// rely on; without it, brute-force lockout could be bypassed by sending a
// fake `X-Forwarded-For` header per request.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(securityHeaders());
app.use(corsMiddleware());

// JSON body parsing is split into two parsers so we don't expose a 12mb
// attack surface to every endpoint just because deposit receipts need it.
//
// - The global parser (256kb) covers every JSON endpoint in the app —
//   admin operations, login, messages, declarations, etc. None of those
//   payloads exceed a few KB in normal use, so 256kb is a generous ceiling
//   that still bounds the work an unauthenticated client can force the
//   process to do before our /api rate limiter even sees the request.
//
// - The receipt parser (12mb) runs ONLY on POST /api/cases/:id/deposit-
//   receipts, where the body is a base64-encoded image (2-8mb raw → up to
//   ~10.7mb after base64). The matching client-side guard in
//   PortalContext.uploadReceipt rejects files over 8mb raw before any
//   network call happens, so this server ceiling is the second line of
//   defence rather than the primary check.
const captureRawBody = (req: import("http").IncomingMessage, _res: unknown, buf: Buffer) => {
  req.rawBody = buf;
};
const globalJsonParser = express.json({ limit: "256kb", verify: captureRawBody });
const receiptJsonParser = express.json({ limit: "12mb", verify: captureRawBody });

app.use((req, res, next) => {
  // Route-scoped large-body opt-in. Match the specific POST so a GET on the
  // same path still uses the small global parser.
  if (req.method === "POST" && /^\/api\/cases\/[^/]+\/deposit-receipts$/.test(req.path)) {
    return receiptJsonParser(req, res, next);
  }
  // Task #72 — Stamp Duty Deposit receipt uploads use the same base64
  // image/PDF data URL shape (up to 10 MB raw → ~13.4 MB after base64,
  // but the route itself rejects anything > 10 MB so 12 MB here is the
  // matching second line of defence).
  if (
    req.method === "POST" &&
    /^\/api\/cases\/[^/]+\/stamp-duty\/receipts$/.test(req.path)
  ) {
    return receiptJsonParser(req, res, next);
  }
  return globalJsonParser(req, res, next);
});

app.use(express.urlencoded({ extended: false, limit: "256kb" }));

// Capture the requesting user's preferred locale (set by the browser via
// the `X-User-Locale` header from `client/src/lib/queryClient.ts`). Used
// by EmailService to render transactional emails in the user's language.
// The header is also accepted from `Accept-Language` as a fallback when
// requests come from outside the SPA (e.g. direct portal links).
import { normalizeLocale, type ServerLocale } from "./services/i18n";
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userLocale?: ServerLocale;
    }
  }
}
app.use((req, _res, next) => {
  const headerLocale =
    (req.headers["x-user-locale"] as string | undefined) ??
    (req.headers["accept-language"] as string | undefined);
  req.userLocale = normalizeLocale(headerLocale);
  next();
});

// Health-check endpoints. Mounted before the API rate limiter so deployment
// liveness probes don't burn a request budget. `/healthz` is a pure liveness
// check (process is up); `/readyz` adds a quick database round-trip so the
// load balancer can take this instance out of rotation if Postgres goes away.
// Imports are statically resolved at top-of-file so each probe is a single
// SQL round-trip — no per-request module resolution overhead under heavy
// load-balancer traffic.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: Math.floor(process.uptime()) });
});
app.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.status(200).json({ status: "ready" });
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
      error: err instanceof Error ? err.message : "db check failed",
    });
  }
});

// Unified health endpoint. Mounted before the /api rate limiter (it is NOT
// an /api route) and before the Vite/static catch-all so the SPA shell can't
// shadow it. Has its own strict 30 req/min per-IP rate limit inside the
// router. Public — no authentication required.
app.use(healthRouter);

// Sitemap is mounted before the Vite/static middleware so the SPA catch-all
// can't shadow it in dev, and before the /api rate limiter because it isn't
// an API endpoint and shouldn't consume that budget. Crawlers fetch this
// from the site root (linked by robots.txt) — keep the path stable.
app.use(sitemapRouter);

// Localized tutorial-video recordings. Mounted before the /api rate limiter
// (these are static media, not API calls) and before the Vite/static
// catch-all so the SPA shell can't shadow them. The router validates the
// locale against an allowlist and falls back to English.
app.use(tutorialVideoRouter);

// Global /api ceiling — 100 req/min/IP. Intentionally in-memory only:
// it's a coarse first-pass DoS dampener that fires on every API request,
// so moving it to a per-request DB write would multiply DB load by the
// total API QPS for marginal benefit. Every sensitive endpoint underneath
// has its own DB-backed limiter (admin login, OTP issue/verify, AI chat,
// withdrawal submit, access-key submit, public newsletter/contact, PIN
// login, declaration read/write) that IS authoritative across instances.
app.use("/api", rateLimiter());
app.use("/api", inputSanitizer());

import { authRateLimiter } from "./middleware";
import { adminLoginLimiter } from "./routes/admin";
app.use("/api/admin/login", adminLoginLimiter());
// Coarse pre-handler ceiling for /api/cases/verify (10/min/IP). The
// authoritative cross-instance limiter for PIN guessing is the DB-backed
// `pin_login` bucket inside `checkPinRateLimit` in routes/cases.ts — this
// limiter is kept in-memory because it's just a cheap first-pass shield
// in front of that stricter check.
app.use("/api/cases/verify", authRateLimiter());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  // Response body capture is an explicit opt-in via the
  // ENABLE_API_RESPONSE_LOGGING=true environment variable. It must never be
  // enabled in production because responses can contain live credentials
  // (admin bearer tokens, portal session tokens, access keys) and regulated
  // user data (base64 KYC uploads, deposit receipts, letter files). The
  // explicit flag avoids the misconfiguration risk of relying solely on
  // NODE_ENV — an environment that sets NODE_ENV to anything other than
  // "production" (e.g. "staging") would otherwise silently leak secrets.
  // Operational metadata (method / path / status / duration) is safe and
  // logged in every environment.
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  if (process.env.ENABLE_API_RESPONSE_LOGGING === "true") {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Re-populate the in-memory login-rate-limit cache from the database before
  // we start accepting requests. Without this an attacker who hit 429 right
  // before a deploy would get a fresh attempt budget the moment the new
  // process binds the port.
  const hydratedRateLimits = await hydratePersistedRateLimits();
  if (hydratedRateLimits > 0) {
    log(`Restored ${hydratedRateLimits} active login rate-limit counter(s) from database`);
  }

  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // Warn — and record a startup audit row — when the development escape
      // hatches ALLOW_WEAK_ADMIN_PASSWORD=1 or ALLOW_WEAK_SESSION_SECRET=1 are
      // detected in a production deployment. Logic is in startupWarnings.ts so
      // it can be unit-tested independently of the HTTP server lifecycle.
      emitStartupSecurityWarnings(storage);

      startBotResponseProcessor();
      
      setInterval(async () => {
        await expirePendingRequests();
      }, 60000);
      log("Access key expiration checker started (checking every minute)");

      const ADMIN_SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
      const sweepAdminSessions = async () => {
        try {
          const removed = await storage.deleteExpiredAdminSessions();
          if (removed > 0) {
            log(`Deleted ${removed} expired/old-revoked admin session(s)`);
          }
        } catch (err) {
          console.error("Error sweeping expired admin sessions:", err);
        }
      };
      sweepAdminSessions();
      setInterval(sweepAdminSessions, ADMIN_SESSION_SWEEP_INTERVAL_MS);
      log("Admin session cleanup started (checking every hour)");

      // One-time startup: revoke any active admin sessions whose adminUsername
      // does not match the currently configured ADMIN_USERNAME. These are
      // "shadow" sessions that could have been created before this hardening
      // was applied and would be invisible to the normal session management UI.
      const canonicalAdmin = process.env.ADMIN_USERNAME ?? "";
      if (canonicalAdmin) {
        storage
          .revokeNonCanonicalAdminSessions(canonicalAdmin)
          .then((n) => {
            if (n > 0) {
              log(
                `Revoked ${n} shadow admin session(s) with non-canonical username`,
              );
            }
          })
          .catch((err) =>
            console.error("Error revoking non-canonical admin sessions:", err),
          );
      }

      // Persisted login-rate-limit rows expire on a 15-minute schedule, so a
      // 5-minute sweep keeps the table small without thrashing.
      const LOGIN_ATTEMPT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
      const sweepLoginAttempts = async () => {
        try {
          await storage.deleteExpiredAdminLoginAttempts();
        } catch (err) {
          console.error("Error sweeping expired login rate-limit rows:", err);
        }
      };
      sweepLoginAttempts();
      setInterval(sweepLoginAttempts, LOGIN_ATTEMPT_SWEEP_INTERVAL_MS);

      // Satisfaction-token nonce rows are only useful while their parent
      // token could still verify (24h TTL, see SATISFACTION_TOKEN_TTL_S), so
      // a 15-minute sweep keeps the table bounded without needing a fixed
      // per-row TTL job.
      const SATISFACTION_NONCE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
      const sweepSatisfactionNonces = async () => {
        try {
          await storage.deleteExpiredSatisfactionTokenNonces();
        } catch (err) {
          console.error("Error sweeping expired satisfaction-token nonces:", err);
        }
      };
      sweepSatisfactionNonces();
      setInterval(sweepSatisfactionNonces, SATISFACTION_NONCE_SWEEP_INTERVAL_MS);

      // Audit log retention sweep. The audit_logs table grows unbounded
      // (every failed admin login + rate-limit hit writes a row), so we
      // periodically drop anything older than the configured window.
      // The retention window is admin-tunable from the dashboard and
      // persisted in the app_settings table; the AUDIT_LOG_RETENTION_DAYS
      // env var still wins if set, so an operator can hard-pin the value
      // for incident response without losing the dashboard control.
      void startAuditLogRetentionSweep();

      // Archive approved document file blobs older than 90 days.
      // Keeps the row (filename, status, notes, audit trail) but nulls
      // out the base64 payload to control DB size — see
      // server/document-archive.ts.
      startApprovedDocumentArchiveSweep();

      // Nightly integrity check of every sealed NDA PDF. Detects at-rest
      // tampering of case_ndas rows that the on-demand admin Verify
      // button would otherwise only surface when someone happened to
      // click. Failures raise an admin notification + drive the global
      // banner on the dashboard.
      startNdaIntegritySweep();

      // Portal session cleanup. Task #123 persisted portal sessions in
      // Postgres; expired rows are pruned best-effort on every
      // validateSession() call, but a dedicated daily sweep keeps the
      // table size predictable on instances that see little portal
      // traffic. Replaces the in-process setInterval that used to live
      // inside server/services/session-store.ts.
      startPortalSessionCleanupSweep(log);

      // Task #126 — prune community participant rows whose owning case
      // has been sealed/completed beyond the retention window. Deletion
      // of an entire case is handled synchronously by the FK ON DELETE
      // CASCADE (migration 0013); this sweep covers the softer
      // "abandoned, sealed but still kept for compliance" path.
      startCommunityParticipantCleanupSweep();

      // Task #640 — prune community_thread_views rows older than the
      // 48-hour deduplication window. Previously done probabilistically
      // in the view-count request path; moved here to keep the hot path
      // clean and make cleanup predictable under low traffic.
      startCommunityThreadViewsCleanupSweep();

      // Task #764 — prune orphaned wallet-connect alert markers
      // (wallet_connect_alert_fired:/wallet_connect_alert_muted:) whose
      // owning case has been deleted, so the app_settings table doesn't
      // grow one permanent row per case forever.
      startWalletConnectAlertMarkerCleanupSweep();

      // Task #826 — durably persist any wallet_connect_completed audit row that
      // was lost when its best-effort write failed (Task #676) but the durable
      // fired marker recorded the completion. One-time boot sweep; after it runs
      // the per-case timeline + global audit-log read-time reconciliation become
      // a safety net rather than the source of truth.
      startWalletConnectCompletionBackfill();

      // Portal-warning expiry sweep — detects cases whose portal-closure
      // countdown has elapsed but have not yet been disabled, then atomically
      // calls disableAndResetPathway(caseId, "expired", "system") so the audit
      // log records the automatic actor. Runs at boot (to catch expirations that
      // occurred while the server was down) and then every 24 hours.
      startPortalWarningExpirySweep();

      // Scheduled internal health probe — runs every 5 minutes and sends ops
      // alert emails when a service transitions from healthy → degraded, plus
      // recovery alerts when it comes back up.
      startHealthProbe();
    },
  );
})();
