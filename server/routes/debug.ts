import { Router } from "express";
import { checkAdminAuth } from "./middleware";

export const debugRouter = Router();

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const isDebugEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_ERROR_REPORTING === "true";

debugRouter.post("/throw", checkAdminAuth, (req, _res) => {
  if (!isDebugEnabled()) {
    throw new HttpError("Debug throw disabled in production", 403);
  }
  const tag = typeof req.body?.tag === "string" ? req.body.tag : "manual";
  throw new Error(
    `Sentry verification throw (server) :: ${tag} :: ${new Date().toISOString()}`,
  );
});

debugRouter.get("/status", checkAdminAuth, (_req, res) => {
  res.json({
    sentryServerConfigured: Boolean(process.env.SENTRY_DSN),
    sentryClientConfigured: Boolean(process.env.VITE_SENTRY_DSN),
    debugEnabled: isDebugEnabled(),
    environment: process.env.NODE_ENV || "development",
  });
});
