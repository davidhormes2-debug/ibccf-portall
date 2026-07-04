import { db } from "../db";
import { communityKeywordBlocklist } from "@shared/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Community keyword moderation service
// ---------------------------------------------------------------------------
// Loads the active blocklist from the DB with a 60-second TTL cache so that
// high-throughput posting does not hammer the DB on every insert, while still
// picking up changes within a reasonable delay.
//
// DECISION (accepted, not a bug): the cache is process-local. On an
// autoscaled deployment, `invalidateModerationCache()` (called from the
// admin PATCH/POST/DELETE handlers in adminCommunityModeration.ts) only
// clears the cache on the instance that handled the request. Every other
// live instance keeps serving its own cached blocklist until its
// independent CACHE_TTL_MS window expires, so a keyword change can take up
// to 60s to reach 100% of instances/requests.
//
// This is intentionally NOT treated as an access-control gap: keyword
// moderation is a best-effort content filter, not an authorization
// boundary, so a bounded 60s worst-case propagation delay is an acceptable
// trade-off against adding cross-instance coordination (pub/sub or a
// DB-backed version check on every checkContent() call) for a low-severity
// content-moderation feature. If this ever needs tighter guarantees (e.g.
// keyword moderation gains a security-relevant role), replace this cache
// with a cheap DB-stored "last changed at" timestamp check (similar to
// server/services/runtimeFlags.ts) or a pub/sub invalidation signal, and
// add instance-simulation test coverage for it.
// ---------------------------------------------------------------------------

export interface KeywordCheckResult {
  flagged: boolean;
  matchedPattern?: string;
}

let cachedPatterns: Array<{ pattern: string; isWildcard: boolean }> | null = null;
let cacheExpiresAt = 0;
export const CACHE_TTL_MS = 60_000;

export function invalidateModerationCache(): void {
  cachedPatterns = null;
  cacheExpiresAt = 0;
}

async function getActivePatterns(): Promise<Array<{ pattern: string; isWildcard: boolean }>> {
  const now = Date.now();
  if (cachedPatterns !== null && now < cacheExpiresAt) {
    return cachedPatterns;
  }

  const rows = await db
    .select({
      pattern: communityKeywordBlocklist.pattern,
      isWildcard: communityKeywordBlocklist.isWildcard,
    })
    .from(communityKeywordBlocklist)
    .where(eq(communityKeywordBlocklist.isActive, true));

  cachedPatterns = rows;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return rows;
}

// Converts a simple wildcard glob pattern (* = any substring) into a RegExp.
function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(regexStr, "i");
}

/**
 * Checks `text` against the active keyword blocklist.
 * Returns `{ flagged: true, matchedPattern }` on the first match,
 * or `{ flagged: false }` when content is clean.
 *
 * Falls back to `{ flagged: false }` if the DB lookup throws, so a transient
 * DB error never silently blocks a legitimate post.
 */
export async function checkContent(text: string): Promise<KeywordCheckResult> {
  if (!text || text.trim().length === 0) {
    return { flagged: false };
  }

  let patterns: Array<{ pattern: string; isWildcard: boolean }>;
  try {
    patterns = await getActivePatterns();
  } catch {
    return { flagged: false };
  }

  if (patterns.length === 0) {
    return { flagged: false };
  }

  const lower = text.toLowerCase();

  for (const { pattern, isWildcard } of patterns) {
    if (!pattern) continue;

    if (isWildcard) {
      try {
        const re = wildcardToRegex(pattern);
        if (re.test(lower)) {
          return { flagged: true, matchedPattern: pattern };
        }
      } catch {
        // Malformed pattern — skip rather than crash.
        continue;
      }
    } else {
      if (lower.includes(pattern.toLowerCase())) {
        return { flagged: true, matchedPattern: pattern };
      }
    }
  }

  return { flagged: false };
}
