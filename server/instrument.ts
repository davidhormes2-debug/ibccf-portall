import * as Sentry from "@sentry/node";

// Idempotency guard — this module can be loaded twice (once via Node's
// `--import` flag in dev, then again as a regular `import "./instrument"`
// at the top of server/index.ts for production parity). The Sentry SDK
// would warn about double init; the flag below short-circuits cleanly.
const g = globalThis as { __ibccfSentryInited?: boolean };

if (!g.__ibccfSentryInited && process.env.SENTRY_DSN) {
  g.__ibccfSentryInited = true;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
