import { db, type DbExecutor } from "./db";
import { storage } from "./storage";
import { communityThreadViews } from "@shared/schema";
import { lt, lte, sql } from "drizzle-orm";

// Task #640 — periodic prune of community_thread_views rows older than
// the 48-hour deduplication window. Previously the hot path in
// recordViewIfNew fired a probabilistic DELETE (0.5% chance) on every
// counted view, which was noisy in the request path and left stale rows
// around for much longer than the TTL under low traffic. This sweep runs
// on a regular cadence outside the request path so the table stays small
// without adding latency risk to view-count requests.

export const COMMUNITY_THREAD_VIEWS_TTL_HOURS = 48;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

export const COMMUNITY_THREAD_VIEWS_CLEANUP_AUDIT_ACTION =
  "community_thread_views_cleanup";

function log(message: string): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [express] ${message}`);
}

let sweepInFlight = false;

export interface CommunityThreadViewsCleanupResult {
  deleted: number;
  cutoff: string;
  skipped: boolean;
}

export async function runCommunityThreadViewsCleanup(
  options: {
    // Who triggered the sweep. The hourly background cadence leaves this
    // unset (attributed to "system"); the admin-facing on-demand trigger
    // (Task #802) passes the acting admin so the audit row is traceable.
    triggeredBy?: string | null;
    // When the manual trigger wraps the sweep in a transaction, the DELETE
    // and its audit row must run through the same executor so an audit
    // failure rolls the deletion back too.
    executor?: DbExecutor;
  } = {},
): Promise<CommunityThreadViewsCleanupResult> {
  if (sweepInFlight) {
    return {
      deleted: 0,
      cutoff: new Date().toISOString(),
      skipped: true,
    };
  }
  sweepInFlight = true;
  try {
    const cutoff = new Date(
      Date.now() - COMMUNITY_THREAD_VIEWS_TTL_HOURS * 60 * 60 * 1000,
    );
    const deleted = await deleteStaleCommunityThreadViews(
      cutoff,
      options.executor,
    );
    if (deleted > 0) {
      // Suppress the audit row on no-op sweeps (deleted === 0) so the
      // hourly cadence doesn't spam the log with "removed 0 rows" entries.
      const auditEntry = {
        adminUsername: options.triggeredBy ?? "system",
        action: COMMUNITY_THREAD_VIEWS_CLEANUP_AUDIT_ACTION,
        targetType: "community_thread_views",
        targetId: null,
        previousValue: null,
        newValue: JSON.stringify({
          deleted,
          cutoff: cutoff.toISOString(),
          ttlHours: COMMUNITY_THREAD_VIEWS_TTL_HOURS,
        }),
        ipAddress: null,
        userAgent: null,
      };
      if (options.executor) {
        // Inside a caller-supplied transaction we MUST write the audit row
        // through it and let any failure propagate so the wrapping
        // runInTransaction rolls back the deletion too.
        await storage.createAuditLog(auditEntry, options.executor);
      } else {
        try {
          await storage.createAuditLog(auditEntry);
        } catch (err) {
          console.error(
            "Failed to write community-thread-views cleanup audit log:",
            err,
          );
        }
      }
      log(
        `Pruned ${deleted} stale community_thread_views row(s) older than ${COMMUNITY_THREAD_VIEWS_TTL_HOURS}h`,
      );
    }
    return { deleted, cutoff: cutoff.toISOString(), skipped: false };
  } catch (err) {
    // When running inside a caller-supplied transaction, propagate the
    // error so the wrapping runInTransaction rolls back the deletion +
    // audit row together. The background sweep (no executor) keeps the
    // swallow-and-log behavior so a transient failure doesn't kill the
    // hourly timer.
    if (options.executor) {
      throw err;
    }
    console.error("Error during community thread views cleanup sweep:", err);
    return {
      deleted: 0,
      cutoff: new Date().toISOString(),
      skipped: false,
    };
  } finally {
    sweepInFlight = false;
  }
}

// Read-only count of community_thread_views rows that the next sweep would
// remove (older than the 48h TTL). Returns null when the query fails so the
// UI can render "unavailable" rather than misleadingly showing 0.
export async function countStaleCommunityThreadViews(
  executor: DbExecutor = db,
): Promise<number | null> {
  const cutoff = new Date(
    Date.now() - COMMUNITY_THREAD_VIEWS_TTL_HOURS * 60 * 60 * 1000,
  );
  try {
    const result = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(communityThreadViews)
      .where(lte(communityThreadViews.createdAt, cutoff));
    return result[0]?.count ?? 0;
  } catch (err) {
    console.error("Failed to count stale community_thread_views rows:", err);
    return null;
  }
}

// Exported so it can be called directly from tests and the admin route
// without going through the full sweep (which has a re-entrancy guard).
export async function deleteStaleCommunityThreadViews(
  cutoff: Date,
  executor: DbExecutor = db,
): Promise<number> {
  const result = await executor
    .delete(communityThreadViews)
    .where(lt(communityThreadViews.createdAt, cutoff))
    .returning({ id: communityThreadViews.id });
  return result.length;
}

export function startCommunityThreadViewsCleanupSweep(): void {
  void runCommunityThreadViewsCleanup();
  setInterval(() => {
    void runCommunityThreadViewsCleanup();
  }, SWEEP_INTERVAL_MS);
  log(
    `Community thread views cleanup sweep started (every hour, TTL=${COMMUNITY_THREAD_VIEWS_TTL_HOURS}h)`,
  );
}
