import { Router } from "express";
import { checkDatabase, checkAi, checkSmtp } from "../services/healthCheck";
import { getRecentFailureCount } from "../services/emailFailureAlert";
import { getBuildStamp } from "../static";
import { rateLimiter } from "../middleware";

export const healthRouter = Router();

// Strict in-memory rate limit: 30 req/min per IP. The /health endpoint is
// public (no auth) so we cap it tightly to prevent information-gathering or
// DoS amplification abuse. In-memory is intentional — a per-instance cap is
// sufficient here since no billable downstream call is triggered per probe.
const healthRateLimit = rateLimiter(30, 60_000);

healthRouter.get("/health", healthRateLimit, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const [dbResult, smtpResult, aiResult] = await Promise.allSettled([
    checkDatabase(),
    checkSmtp(),
    checkAi(),
  ]);

  const db =
    dbResult.status === "fulfilled"
      ? dbResult.value
      : { status: "degraded" as const, error: String(dbResult.reason) };
  const smtp =
    smtpResult.status === "fulfilled"
      ? smtpResult.value
      : { status: "degraded" as const, error: String(smtpResult.reason) };
  const ai =
    aiResult.status === "fulfilled"
      ? aiResult.value
      : { status: "degraded" as const, error: String(aiResult.reason) };

  // "unconfigured" counts as healthy — it just means the service isn't
  // wired up in this environment, not that it is broken.
  const isDegraded = (s: { status: string }) => s.status === "degraded";
  const anyDegraded = isDegraded(db) || isDegraded(smtp) || isDegraded(ai);

  const body = {
    db,
    smtp,
    ai,
    // Process-local rolling count of email delivery failures in the last
    // 10 minutes. NOTE: this is per-instance on autoscaled deployments;
    // use the DB-backed audit log for a cross-instance view.
    recentEmailFailures: getRecentFailureCount(10 * 60 * 1000),
    uptime: Math.floor(process.uptime()),
    version: getBuildStamp(),
  };

  res.status(anyDegraded ? 503 : 200).json(body);
});
