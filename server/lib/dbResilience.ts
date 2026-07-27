// DB resilience utilities: transient-error classification and a simple
// circuit breaker for periodic background jobs.
//
// When the database is unavailable, background timers keep firing their
// scheduled SQL. Without a circuit breaker they flood logs and hammer the
// DB connection pool. This module provides:
//
//  • isTransientDbError(err) — returns true for connection/timeout/pool
//    failures that are likely to resolve on their own (as opposed to
//    permanent schema/permission errors that warrant investigation).
//
//  • JobCircuitBreaker — tracks consecutive failures for one periodic job.
//    When failures exceed the threshold the circuit "opens" and subsequent
//    calls to shouldSkip() return true, letting the caller bail out quickly
//    and silently instead of issuing a doomed SQL query. After
//    JOB_CB_OPEN_DURATION_MS the circuit moves to half-open and allows one
//    probe attempt; success re-closes it, another failure re-opens it.
//
// ── Env-configurable knobs ───────────────────────────────────────────────────
//
//  JOB_CB_THRESHOLD         — consecutive failures to open the circuit (default 5)
//  JOB_CB_OPEN_DURATION_MS  — how long circuit stays open before probing (default 60 s)

function readEnvInt(key: string, defaultVal: number, min: number): number {
  const raw = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(raw) && raw >= min ? raw : defaultVal;
}

export const JOB_CB_THRESHOLD: number = readEnvInt(
  "JOB_CB_THRESHOLD",
  5,
  1,
);

export const JOB_CB_OPEN_DURATION_MS: number = readEnvInt(
  "JOB_CB_OPEN_DURATION_MS",
  60_000,
  1_000,
);

// ── Transient error classifier ────────────────────────────────────────────────

// PostgreSQL SQLSTATE codes for connection-level / server-side failures that
// are not the application's fault and will resolve once connectivity is
// restored.
const TRANSIENT_PG_CODES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08P01", // protocol_violation (sometimes seen on pool restart)
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (DB starting up)
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
]);

// Node.js / pg driver error messages that indicate a transient infrastructure
// problem rather than a bad query.
const TRANSIENT_PATTERNS = [
  /failed query/i,
  /connection refused/i,
  /econnrefused/i,
  /connection terminated/i,
  /connection reset/i,
  /enotfound/i,
  /etimedout/i,
  /connect timeout/i,
  /query timeout/i,
  /pool.*exhausted/i,
  /too many clients/i,
  /cannot acquire.*connection/i,
  /server.*closed.*connection/i,
  /socket hang up/i,
  /network.*error/i,
  /ssl.*error/i,
  /read ECONNRESET/i,
];

/**
 * Returns true when `err` looks like a transient DB connectivity or pool
 * problem rather than a permanent schema / permission error. Callers can use
 * this to decide whether to degrade gracefully, skip silently, or surface a
 * specific warning instead of a full stack trace.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  // pg-specific SQLSTATE code
  if (typeof e.code === "string" && TRANSIENT_PG_CODES.has(e.code)) {
    return true;
  }

  const msg = typeof e.message === "string" ? e.message : "";
  if (!msg) return false;

  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

/**
 * Simple circuit breaker for a single periodic background job.
 *
 * Usage:
 *
 *   const cb = new JobCircuitBreaker();
 *
 *   async function myJob() {
 *     if (cb.shouldSkip("my-job")) return;   // open → bail quickly
 *     try {
 *       await doDbWork();
 *       cb.onSuccess();
 *     } catch (err) {
 *       cb.onFailure("my-job");
 *       // log / handle err
 *     }
 *   }
 */
export class JobCircuitBreaker {
  private _state: CircuitState = "closed";
  private _consecutiveFailures = 0;
  private _openedAt: number | null = null;
  private readonly _threshold: number;
  private readonly _openDurationMs: number;

  constructor(
    threshold: number = JOB_CB_THRESHOLD,
    openDurationMs: number = JOB_CB_OPEN_DURATION_MS,
  ) {
    this._threshold = threshold;
    this._openDurationMs = openDurationMs;
  }

  /** Current circuit state — exposed for tests and observability. */
  get state(): CircuitState {
    return this._state;
  }

  /** Consecutive failure count — exposed for tests. */
  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /**
   * Returns true when the circuit is open and the cooldown has not yet
   * elapsed (i.e. the caller should skip this tick silently).  When the
   * cooldown elapses the circuit transitions to half-open and this method
   * returns false, allowing one probe attempt.
   */
  shouldSkip(jobName: string): boolean {
    if (this._state !== "open") return false;
    const elapsed = Date.now() - (this._openedAt ?? 0);
    if (elapsed >= this._openDurationMs) {
      this._state = "half-open";
      console.info(
        `[db-resilience] circuit HALF-OPEN for job "${jobName}"; probing DB`,
      );
      return false;
    }
    return true;
  }

  /**
   * Call when the job tick completes successfully. Resets the failure counter
   * and closes the circuit (half-open → closed).
   */
  onSuccess(): void {
    if (this._state !== "closed") {
      console.info(`[db-resilience] circuit CLOSED for job — DB recovered`);
    }
    this._consecutiveFailures = 0;
    this._state = "closed";
    this._openedAt = null;
  }

  /**
   * Call when the job tick fails. Increments the failure counter and opens
   * the circuit once the threshold is reached.
   */
  onFailure(jobName: string): void {
    // If already open, keep it open (reset happens only on success or probe).
    if (this._state === "open") return;

    this._consecutiveFailures++;

    if (this._consecutiveFailures >= this._threshold) {
      this._state = "open";
      this._openedAt = Date.now();
      console.warn(
        `[db-resilience] circuit OPEN for job "${jobName}" after ` +
          `${this._consecutiveFailures} consecutive failures. ` +
          `Skipping until DB recovers (probe in ~${Math.round(this._openDurationMs / 1000)}s).`,
      );
    }
  }

  /** Test helper — reset all state. */
  _resetForTests(): void {
    this._state = "closed";
    this._consecutiveFailures = 0;
    this._openedAt = null;
  }
}
