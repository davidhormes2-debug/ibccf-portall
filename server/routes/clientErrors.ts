import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { storage } from "../storage";
import { warnOnce } from "../lib/warnOnce";
import { CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE } from "../middleware/security";

const router = Router();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const DEDUP_WINDOW_MS = 5 * 60_000;

// Hard caps on the in-memory fallback maps so a flood of unique IPs /
// unique stack signatures can never exhaust process memory if the DB
// is unavailable. When the cap is hit we evict the oldest entries
// until we're back under the cap.
const MAX_RECENT_IPS = 5_000;
const MAX_DEDUP_SIGNATURES = 5_000;

// In-memory fallback bucket. The authoritative per-IP counter lives in
// the admin_login_attempts table under the `client_error_report:` prefix
// so an autoscale flood from a single IP is bounded at MAX_PER_WINDOW
// across all instances (not multiplied by instance count). This map is
// only consulted when the DB is unavailable.
const recentFallback = new Map<string, number[]>();
const dedupSeen = new Map<string, number>();

function pruneOldest<T>(map: Map<string, T>, max: number): void {
  if (map.size <= max) return;
  const overflow = map.size - max;
  let i = 0;
  for (const key of map.keys()) {
    if (i++ >= overflow) break;
    map.delete(key);
  }
}

function clientErrorRateLimitKey(ip: string): string {
  return `${CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE}:${ip}`;
}

async function rateLimited(ip: string): Promise<boolean> {
  const now = Date.now();
  const key = clientErrorRateLimitKey(ip);
  try {
    // Atomic additive increment in a single DB round-trip — authoritative
    // across all autoscale instances. The post-increment count is
    // compared against the per-window ceiling.
    const { count } = await storage.atomicIncrementRateLimit({
      key,
      windowResetAt: new Date(now + WINDOW_MS),
    });
    return count > MAX_PER_WINDOW;
  } catch (err) {
    warnOnce(
      "clientErrors:atomic-increment-fail",
      "client-error report limiter: atomic DB increment failed, using in-memory fallback:",
      err,
    );
    const arr = (recentFallback.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (arr.length >= MAX_PER_WINDOW) {
      recentFallback.set(ip, arr);
      return true;
    }
    arr.push(now);
    // Re-set so insertion order reflects most-recent activity for the
    // pruneOldest() eviction policy below.
    recentFallback.delete(ip);
    recentFallback.set(ip, arr);
    pruneOldest(recentFallback, MAX_RECENT_IPS);
    return false;
  }
}

// Test-only escape hatch so unit tests don't carry IP-bucket state
// between cases. Not exported through the route surface.
export function __resetClientErrorRateLimitForTests(): void {
  recentFallback.clear();
  dedupSeen.clear();
}

function isDuplicate(signature: string): boolean {
  const now = Date.now();
  const seenAt = dedupSeen.get(signature);
  if (seenAt !== undefined && now - seenAt < DEDUP_WINDOW_MS) {
    // Bump LRU so a hot signature stays in the map until it goes
    // truly cold (no hits for DEDUP_WINDOW_MS).
    dedupSeen.delete(signature);
    dedupSeen.set(signature, now);
    return true;
  }
  dedupSeen.set(signature, now);
  pruneOldest(dedupSeen, MAX_DEDUP_SIGNATURES);
  return false;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const ip = (req.ip || "unknown").toString();
    if (await rateLimited(ip)) {
      return res.status(429).json({ ok: false });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.slice(0, 2000) : "(no message)";
    const stack = typeof body.stack === "string" ? body.stack.slice(0, 8000) : "";
    const componentStack = typeof body.componentStack === "string" ? body.componentStack.slice(0, 4000) : "";
    const url = typeof body.url === "string" ? body.url.slice(0, 500) : "";
    const userAgent = (req.headers["user-agent"] || "").toString().slice(0, 300);

    // Dedup by (ip + message + first stack frame) within a 5-minute window
    // so one buggy user can't flood the log with the same stack trace.
    const firstFrame = stack.split("\n").slice(0, 2).join("|");
    const signature = createHash("sha1")
      .update(`${ip}|${message}|${firstFrame}`)
      .digest("hex");
    if (isDuplicate(signature)) {
      return res.json({ ok: true, deduplicated: true });
    }

    console.error(
      `[client-error] ip=${ip} url=${url}\n  message: ${message}\n  ua: ${userAgent}\n  stack: ${stack}\n  componentStack: ${componentStack}`
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export default router;
