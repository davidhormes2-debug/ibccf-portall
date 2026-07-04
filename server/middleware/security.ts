import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { warnOnce } from "../lib/warnOnce";

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
let nextLimiterNamespace = 0;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_MAX_AUTH_REQUESTS = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;

// Stable namespace used by the admin-login limiter when persisting counters.
// Kept here (rather than baked into adminLoginLimiter) so hydratePersistedRate
// LimitsFromStorage knows which namespaces it owns and can validate them.
export const ADMIN_LOGIN_RATE_LIMIT_NAMESPACE = "admin_login";

// Stable namespaces for every persistent rate limiter in the app. Each entry
// is the prefix `rateLimiter({ persistNamespace })` writes into the
// admin_login_attempts table so `hydratePersistedRateLimits` knows which rows
// to rehydrate after a restart. Add new persistent limiters here AND pass the
// same string as `persistNamespace` at the call site (see e.g. ai.ts,
// withdrawalActivation.ts, withdrawalRequests.ts, public.ts,
// access-key-requests.ts).
export const PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE = "public_newsletter";
export const PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE = "public_contact";
export const AI_CHAT_RATE_LIMIT_NAMESPACE = "ai_chat";
export const OTP_ISSUE_RATE_LIMIT_NAMESPACE = "otp_issue";
export const OTP_VERIFY_RATE_LIMIT_NAMESPACE = "otp_verify";
export const ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE = "access_key_submit";
export const WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE = "withdrawal_submit";
export const CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE = "client_error_report";
export const SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE = "submissions_post";
export const VISITOR_OFFLINE_MSG_RATE_LIMIT_NAMESPACE = "visitor_offline_msg";
export const VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE = "visitor_satisfaction";
export const VISITOR_HEARTBEAT_RATE_LIMIT_NAMESPACE = "visitor_heartbeat";
export const VISITOR_TYPING_RATE_LIMIT_NAMESPACE = "visitor_typing";
export const VISITOR_TYPING_GET_RATE_LIMIT_NAMESPACE = "visitor_typing_get";
export const VISITOR_AGENT_STATUS_RATE_LIMIT_NAMESPACE = "visitor_agent_status";
export const VISITOR_END_SESSION_RATE_LIMIT_NAMESPACE = "visitor_end_session";

// Shared namespace for the read-only access-key-request status/case GET
// endpoints (GET /status/:requestId and GET /case/:caseId).  DB-backed so the
// per-IP cap is globally authoritative across all autoscale instances, matching
// the guarantee provided by every other public-facing rate limiter.
export const ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE = "access_key_status";

// Shared namespace for all unauthenticated public GET endpoints in public.ts.
// The route path is included in every cache key, so a single namespace covers
// multiple endpoints without counter collision.
export const PUBLIC_GET_RATE_LIMIT_NAMESPACE = "public_get";

// Shared namespace for all unauthenticated community GET endpoints in community.ts.
export const COMMUNITY_GET_RATE_LIMIT_NAMESPACE = "community_get";

// Shared namespace for the community POST endpoints in community.ts
// (/threads, /threads/:id/posts, /posts/:id/react, /participants). These
// routes perform their own inline session/admin-token check inside the
// handler body (no requirePortalAccess middleware), so a request with no
// token at all still reaches the handler before being rejected with 401.
// Without a persistent per-IP limiter here, that reachable-but-rejected path
// is otherwise unthrottled beyond the process-local generic /api ceiling,
// which resets on restart and is not shared across autoscale instances.
export const COMMUNITY_POST_RATE_LIMIT_NAMESPACE = "community_post";

// Emergency admin-credential reset (Task #2398). Unauthenticated by design —
// the whole point is to recover access when the admin cannot log in — so it
// must be throttled at least as aggressively as the login limiter itself.
// DB-backed so the cap holds across autoscale instances.
export const ADMIN_EMERGENCY_RESET_RATE_LIMIT_NAMESPACE = "admin_emergency_reset";

// Passkey authentication (Task #2417). `authentication/options` and
// `authentication/verify` are the only unauthenticated POST routes in
// webauthn.ts — a valid credential + short-lived server challenge is still
// required to succeed, but without a per-IP cap an attacker could hammer
// these to enumerate registered credentials or exhaust the in-memory
// `pendingChallenges` map. DB-backed so the cap holds across autoscale
// instances.
export const WEBAUTHN_AUTH_OPTIONS_RATE_LIMIT_NAMESPACE = "webauthn_auth_options";
export const WEBAUTHN_AUTH_VERIFY_RATE_LIMIT_NAMESPACE = "webauthn_auth_verify";

const PERSISTENT_RATE_LIMIT_NAMESPACES = new Set<string>([
  ADMIN_LOGIN_RATE_LIMIT_NAMESPACE,
  PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE,
  PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE,
  AI_CHAT_RATE_LIMIT_NAMESPACE,
  OTP_ISSUE_RATE_LIMIT_NAMESPACE,
  OTP_VERIFY_RATE_LIMIT_NAMESPACE,
  ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE,
  WITHDRAWAL_SUBMIT_RATE_LIMIT_NAMESPACE,
  CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE,
  SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE,
  VISITOR_OFFLINE_MSG_RATE_LIMIT_NAMESPACE,
  VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE,
  VISITOR_HEARTBEAT_RATE_LIMIT_NAMESPACE,
  VISITOR_TYPING_RATE_LIMIT_NAMESPACE,
  VISITOR_TYPING_GET_RATE_LIMIT_NAMESPACE,
  VISITOR_AGENT_STATUS_RATE_LIMIT_NAMESPACE,
  VISITOR_END_SESSION_RATE_LIMIT_NAMESPACE,
  ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE,
  PUBLIC_GET_RATE_LIMIT_NAMESPACE,
  COMMUNITY_GET_RATE_LIMIT_NAMESPACE,
  COMMUNITY_POST_RATE_LIMIT_NAMESPACE,
  ADMIN_EMERGENCY_RESET_RATE_LIMIT_NAMESPACE,
  WEBAUTHN_AUTH_OPTIONS_RATE_LIMIT_NAMESPACE,
  WEBAUTHN_AUTH_VERIFY_RATE_LIMIT_NAMESPACE,
]);

// Resolve the client IP for rate-limiting and audit purposes.
//
// We deliberately do NOT read `x-forwarded-for` directly. Express's `req.ip`
// already does the right thing once `app.set("trust proxy", ...)` is
// configured (see server/index.ts): it parses x-forwarded-for and skips the
// configured number of trusted hops, so an attacker can no longer just send
// `X-Forwarded-For: 1.2.3.4` to evade the lockout. If `req.ip` is unavailable
// we fall back to the raw socket address rather than the spoofable header.
function getClientIP(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export interface RateLimiterOptions {
  // Fire-and-forget hook invoked the moment a request is throttled. Useful for
  // audit logging — the hook runs before the 429 response is sent and any
  // thrown error is swallowed so it can never break the response path.
  onThrottled?: (req: Request) => void | Promise<void>;
  // When set, counters for this limiter are mirrored to the
  // `admin_login_attempts` table so an active lockout survives a server
  // restart. The string becomes the limiter's namespace prefix in the cache
  // key, so it MUST be stable across deploys (otherwise rows from the previous
  // process would never be matched after restart).
  persistNamespace?: string;
}

// Mirror an in-memory record to the persistent store. Fire-and-forget: a DB
// blip must never break the login response, so failures are only logged. The
// in-memory cache stays the source of truth for the live process.
function _persistRecord(key: string, record: RateLimitRecord): void {
  storage
    .upsertAdminLoginAttempt({
      key,
      count: record.count,
      resetAt: new Date(record.resetTime),
    })
    .catch((err) =>
      warnOnce(
        "rateLimiter:persist-fail",
        "rateLimiter: failed to persist counter",
        err,
      ),
    );
}

export function rateLimiter(
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  options: RateLimiterOptions = {},
) {
  // Each call to rateLimiter() gets a unique namespace so two limiters mounted
  // on overlapping paths (e.g. the generic /api limiter and the strict
  // /api/admin/login limiter) don't share counter rows in `rateLimitStore`.
  // Without this, every login request would tick both buckets and the strict
  // 5/15min budget would burn down twice as fast as configured.
  //
  // Persistent limiters opt out of the auto-generated namespace and supply a
  // stable string instead — the in-memory namespace counter resets on every
  // restart, which would otherwise prevent rehydrated rows from ever matching
  // a new request's cache key.
  const namespace = options.persistNamespace ?? `rl${nextLimiterNamespace++}`;
  const persist = Boolean(options.persistNamespace);
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientIP = getClientIP(req);
    const now = Date.now();
    // Prefer the matched route's *pattern* (e.g. "/threads/:id/posts") over the
    // literal request URL. Express sets req.route once a router has matched a
    // specific route, before any of that route's own middleware (including
    // this one) runs — so when rateLimiter() is passed directly as route
    // middleware (router.post("/threads/:id/posts", rateLimiter(), handler)),
    // req.route.path is already populated with the pattern, not the literal
    // path segment values. Without this, an attacker could fan out across
    // thousands of distinct :id values (e.g. /threads/1/posts, /threads/2/posts,
    // ...) and get a fresh counter bucket per ID, never tripping the per-route
    // cap. Falls back to originalUrl when req.route is unset — e.g. limiters
    // mounted generically via app.use("/api/admin/login", limiter()), where
    // Express never attaches a Route object and req.path inside the handler
    // would just be "/".
    const routeTemplate =
      req.route && typeof req.route.path === "string"
        ? `${req.baseUrl || ""}${req.route.path}`
        : null;
    const routeKey = (routeTemplate ?? (req.originalUrl || req.path)).split("?")[0];
    const key = `${namespace}:${clientIP}:${routeKey}`;

    if (persist) {
      // Atomic additive increment in a single DB round-trip — authoritative
      // across all autoscale instances. Every request (including denied ones)
      // increments so a sustained brute-force never resets its budget by being
      // routed to a fresh instance. The RETURNING clause gives the post-increment
      // count and window end without a separate read.
      let effectiveCount: number;
      let effectiveResetTime: number;
      try {
        const { count, resetAt } = await storage.atomicIncrementRateLimit({
          key,
          windowResetAt: new Date(now + windowMs),
        });
        effectiveCount = count;
        effectiveResetTime = resetAt.getTime();
        // Mirror in local cache so the generic /api rate-limiter (which is
        // non-persistent but shares the same request) can use it for display.
        rateLimitStore.set(key, { count, resetTime: effectiveResetTime });
      } catch (err) {
        // DB unavailable — fall back to in-memory. Degraded but not disabled:
        // the limiter still works per-instance rather than failing open.
        warnOnce(
          "rateLimiter:atomic-increment-fail",
          "rateLimiter: atomic DB increment failed, using in-memory fallback:",
          err,
        );
        const mem = rateLimitStore.get(key);
        if (!mem || now > mem.resetTime) {
          const fresh: RateLimitRecord = { count: 1, resetTime: now + windowMs };
          rateLimitStore.set(key, fresh);
          return next();
        }
        mem.count++;
        effectiveCount = mem.count;
        effectiveResetTime = mem.resetTime;
      }

      if (effectiveCount > maxRequests) { // > (not >=): atomicIncrementRateLimit returns the post-increment count; lockout fires when the NEW count exceeds maxRequests (i.e. on the maxRequests+1th call). Changing to >= would block the maxRequests-th attempt — one call too early.
        if (options.onThrottled) {
          try {
            const maybePromise = options.onThrottled(req);
            if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
              (maybePromise as Promise<void>).catch((err) =>
                console.error("rateLimiter onThrottled hook failed:", err),
              );
            }
          } catch (err) {
            console.error("rateLimiter onThrottled hook threw:", err);
          }
        }
        const retryAfter = Math.ceil((effectiveResetTime - now) / 1000);
        res.setHeader("Retry-After", retryAfter);
        return res.status(429).json({
          message: "Too many requests. Please try again later.",
          retryAfter,
        });
      }
      return next();
    }

    // Non-persistent limiters: pure in-memory, no DB round-trip.
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      const fresh: RateLimitRecord = { count: 1, resetTime: now + windowMs };
      rateLimitStore.set(key, fresh);
      return next();
    }

    if (record.count >= maxRequests) { // >= (not >): count is the pre-increment value (incremented below); lockout fires at the maxRequests-th stored count. Changing to > would silently allow one extra attempt before blocking.
      if (options.onThrottled) {
        try {
          const maybePromise = options.onThrottled(req);
          if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
            (maybePromise as Promise<void>).catch((err) =>
              console.error("rateLimiter onThrottled hook failed:", err),
            );
          }
        } catch (err) {
          console.error("rateLimiter onThrottled hook threw:", err);
        }
      }
      res.setHeader("Retry-After", Math.ceil((record.resetTime - now) / 1000));
      return res.status(429).json({
        message: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
}

export function authRateLimiter() {
  return rateLimiter(RATE_LIMIT_MAX_AUTH_REQUESTS);
}

// Stricter limiter dedicated to admin login to slow down brute-force guessing.
// 5 attempts per 15 minutes per IP — successful and failed alike (so an attacker
// can't keep retrying after a lockout starts). The counters are persisted to
// the database so a restart (deploy, crash) can't reset an active lockout.
export function loginRateLimiter(
  options: Omit<RateLimiterOptions, "persistNamespace"> = {},
) {
  return rateLimiter(LOGIN_RATE_LIMIT_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_MS, {
    ...options,
    persistNamespace: ADMIN_LOGIN_RATE_LIMIT_NAMESPACE,
  });
}

// Reload counter rows from the database into the in-memory cache. Called once
// during server startup so an attacker who tripped the lockout right before a
// restart still sees 429 once the new process accepts traffic. Safe to call
// multiple times — rows that have since expired are skipped.
export async function hydratePersistedRateLimits(): Promise<number> {
  try {
    const rows = await storage.getActiveAdminLoginAttempts();
    const now = Date.now();
    let hydrated = 0;
    for (const row of rows) {
      const resetTime = row.resetAt.getTime();
      if (resetTime <= now) continue;
      // Defensive: only hydrate rows whose namespace is one we know about, so
      // a stale schema or hand-edited row can't pollute unrelated buckets.
      const namespacePrefix = row.key.split(":", 1)[0];
      if (!PERSISTENT_RATE_LIMIT_NAMESPACES.has(namespacePrefix)) continue;
      rateLimitStore.set(row.key, { count: row.count, resetTime });
      hydrated++;
    }
    return hydrated;
  } catch (err) {
    // A failed hydration is not fatal — the limiter still works in-memory,
    // we just lose cross-restart persistence for this boot.
    console.error("rateLimiter: failed to hydrate persisted counters", err);
    return 0;
  }
}

export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Explicit indexing directive. Lighthouse flags "Page is blocked
    // from indexing" when an X-Robots-Tag header advertises noindex
    // (the Replit dev preview adds one automatically). We override
    // here so the public marketing surface is indexable, while keeping
    // authenticated areas (admin/portal) and the API non-indexable to
    // match the existing robots.txt.
    const p = req.path || "";
    const nonIndexable =
      p.startsWith("/api") ||
      p.startsWith("/admin") ||
      p.startsWith("/portal") ||
      p.startsWith("/dashboard") ||
      // `/contact-admin` is a session-gated support route (see
      // seo_strategy.md), not a discovery page — it must never be
      // advertised as indexable even though it isn't under one of the
      // authenticated-area prefixes above.
      p === "/contact-admin";
    // Replit's dev-preview proxy injects its own `X-Robots-Tag: noindex`
    // header upstream of this middleware. Express's `setHeader` *replaces*
    // any value the app itself set on the response, but a header coming
    // from a downstream proxy can still appear in the final response if
    // it was attached before we ran. `removeHeader` guarantees only our
    // directive is sent for public marketing pages — otherwise crawlers
    // see two conflicting values and treat any `noindex` as final, which
    // is exactly the Lighthouse "Page is blocked from indexing" failure.
    res.removeHeader("X-Robots-Tag");
    res.setHeader(
      "X-Robots-Tag",
      nonIndexable ? "noindex, nofollow" : "index, follow",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.tawk.to; style-src 'self' 'unsafe-inline' https://*.tawk.to https://fonts.googleapis.com; img-src 'self' data: blob: https://*.tawk.to; font-src 'self' data: https://*.tawk.to https://fonts.gstatic.com; connect-src 'self' https://*.tawk.to wss://*.tawk.to https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io; frame-src 'self' blob: https://tawk.to https://*.tawk.to;"
    );
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.removeHeader("X-Powered-By");
    next();
  };
}

const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /data:\s*text\/html/gi,
];

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    let sanitized = value;
    for (const pattern of DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }
    sanitized = sanitized
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitizedObj[key] = sanitizeValue(val);
    }
    return sanitizedObj;
  }
  return value;
}

export function inputSanitizer() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeValue(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeValue(req.query) as typeof req.query;
    }
    next();
  };
}

export function corsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const configuredOrigins = process.env.CORS_ORIGINS?.split(",") || [];
    const allowedOrigins = [
      process.env.APP_URL || "",
      process.env.PUBLIC_BASE_URL || "",
      process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "",
      "http://localhost:5000",
      "http://localhost:5173",
      "http://0.0.0.0:5000",
      ...configuredOrigins,
    ].filter(Boolean);

    const origin = req.headers.origin;

    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(_o => origin.endsWith('.replit.dev'))) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Request-Email");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, record] of entries) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);
