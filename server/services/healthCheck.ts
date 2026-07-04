import nodemailer from "nodemailer";
import OpenAI from "openai";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProbeStatus = "ok" | "degraded" | "unconfigured";

export interface ProbeResult {
  status: ProbeStatus;
  error?: string;
}

/**
 * Which AI probe path actually ran during a given health check.
 *   "models"                  — /v1/models succeeded (default happy path)
 *   "completion"              — completion-only strategy was configured
 *   "models→completion-fallback" — /v1/models returned 404; fell back to a
 *                               completion ping (proxy doesn't expose /v1/models)
 */
export type AiProbeLabel =
  | "models"
  | "completion"
  | "models→completion-fallback";

export interface AiProbeResult extends ProbeResult {
  /** Present on a successful probe; absent when the probe is degraded or unconfigured. */
  probe?: AiProbeLabel;
}

export interface HealthReport {
  db: ProbeResult;
  smtp: ProbeResult;
  ai: AiProbeResult;
  recentEmailFailures: number;
  uptime: number;
  version: string;
}

// ─── Database probe ───────────────────────────────────────────────────────────

export async function checkDatabase(): Promise<ProbeResult> {
  try {
    await db.execute(sql`select 1`);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "degraded",
      error: err instanceof Error ? err.message : "DB check failed",
    };
  }
}

// ─── SMTP probe ───────────────────────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT_RAW = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD =
  process.env.SMTP_PASSWORD ?? process.env.ZOHO_SMTP_PASSWORD;

function isSmtpConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
}

const SMTP_PROBE_TIMEOUT_MS = 5_000;

export async function checkSmtp(): Promise<ProbeResult> {
  if (!isSmtpConfigured()) {
    return { status: "unconfigured" };
  }

  const port = Number.parseInt(SMTP_PORT_RAW ?? "465", 10);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // Enforce a short connection + greeting timeout so the /health endpoint
    // never hangs longer than SMTP_PROBE_TIMEOUT_MS.
    connectionTimeout: SMTP_PROBE_TIMEOUT_MS,
    greetingTimeout: SMTP_PROBE_TIMEOUT_MS,
    socketTimeout: SMTP_PROBE_TIMEOUT_MS,
  });

  try {
    // Race the verify() call against a hard timeout so a hung SMTP server
    // cannot block the health endpoint indefinitely.
    await Promise.race([
      transporter.verify(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("SMTP verify timed out")),
          SMTP_PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "degraded",
      error: err instanceof Error ? err.message : "SMTP check failed",
    };
  } finally {
    transporter.close();
  }
}

// ─── AI / OpenAI probe ────────────────────────────────────────────────────────

const AI_PROBE_TIMEOUT_MS = 5_000;
const AI_PROBE_CACHE_TTL_MS = 60_000; // probe at most once per minute

/**
 * Probe strategy:
 *   "models"     (default) — calls client.models.list(); if the proxy returns
 *                            404 (endpoint not implemented), automatically falls
 *                            back to a minimal chat-completions ping.
 *   "completion"           — skips models.list() and goes directly to a 1-token
 *                            chat completion; use this when the base URL is a
 *                            proxy that never exposes /v1/models.
 *
 * Set via HEALTH_AI_PROBE env var.
 */
export type AiProbeStrategy = "models" | "completion";

function getAiProbeStrategy(): AiProbeStrategy {
  const raw = process.env.HEALTH_AI_PROBE ?? "models";
  return raw === "completion" ? "completion" : "models";
}

/** Model used for the completion fallback probe. */
function getAiProbeModel(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

interface AiProbeCache {
  result: AiProbeResult;
  expiresAt: number;
}

let _aiCache: AiProbeCache | null = null;

function getOpenAIKey(): string | undefined {
  return (
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  );
}

/** Exposed for testing — reset the probe cache between test cases. */
export function _resetAiProbeCache(): void {
  _aiCache = null;
}

/** Probe via models.list() — zero-token, read-only, no billable usage. */
async function probeViaModels(client: OpenAI): Promise<void> {
  await client.models.list();
}

/**
 * Probe via a minimal chat completion — 1-token response.
 * Used as fallback when the proxy doesn't implement /v1/models, or as the
 * primary strategy when HEALTH_AI_PROBE=completion.
 */
async function probeViaCompletion(client: OpenAI): Promise<void> {
  await client.chat.completions.create({
    model: getAiProbeModel(),
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
}

/**
 * Run the AI probe using the configured strategy.
 * Returns the label describing which path actually executed so callers can
 * surface it in the health response.
 *   "models"                     — /v1/models succeeded
 *   "completion"                 — completion-only strategy ran (configured)
 *   "models→completion-fallback" — /v1/models returned 404; fell back to completion
 */
async function runAiProbe(client: OpenAI): Promise<AiProbeLabel> {
  const strategy = getAiProbeStrategy();

  if (strategy === "completion") {
    await probeViaCompletion(client);
    return "completion";
  }

  // "models" strategy with automatic 404 fallback.
  try {
    await probeViaModels(client);
    return "models";
  } catch (err) {
    // Proxy doesn't implement /v1/models — fall back to completion ping.
    if (err instanceof OpenAI.APIError && err.status === 404) {
      await probeViaCompletion(client);
      return "models→completion-fallback";
    }
    throw err;
  }
}

export async function checkAi(): Promise<AiProbeResult> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    return { status: "unconfigured" };
  }

  // Return cached result while still fresh.
  if (_aiCache && Date.now() < _aiCache.expiresAt) {
    return _aiCache.result;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  // Capture the previously cached label before overwriting the cache so we
  // can detect strategy switches between consecutive successful probes.
  const previousProbe = _aiCache?.result?.probe;

  let result: AiProbeResult;
  try {
    const probe = await Promise.race([
      runAiProbe(client),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("OpenAI probe timed out")),
          AI_PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    result = { status: "ok", probe };

    // When the probe strategy changes between two consecutive successful runs,
    // emit a structured log so operators can track intermittent fallbacks
    // instead of seeing only the most-recent cached snapshot.
    if (previousProbe !== undefined && probe !== previousProbe) {
      console.warn(
        JSON.stringify({
          event: "ai_probe_strategy_changed",
          previous: previousProbe,
          current: probe,
        }),
      );
    }
  } catch (err) {
    result = {
      status: "degraded",
      error: err instanceof Error ? err.message : "AI check failed",
    };
  }

  _aiCache = { result, expiresAt: Date.now() + AI_PROBE_CACHE_TTL_MS };
  return result;
}
