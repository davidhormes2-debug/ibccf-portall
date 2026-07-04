import { Router } from "express";
import { db } from "../db";
import { 
  communityThreads, 
  communityPosts, 
  communityParticipants,
  communityReactions,
  communityThreadViews,
  botProfiles,

  type CommunityParticipant
} from "@shared/schema";
import { eq, desc, asc, and, or, sql, gte, ilike } from "drizzle-orm";
import { checkContent } from "../services/communityModeration";
import { storage } from "../storage";
import { createHash } from "crypto";
import { scheduleResponsesForThread } from "../services/bot-response-generator";
import { isValidAdminToken } from "./middleware";
import { validatePortalSession } from "../services/portal-auth";
import { warnOnce } from "../lib/warnOnce";
import { rateLimiter, COMMUNITY_GET_RATE_LIMIT_NAMESPACE, COMMUNITY_POST_RATE_LIMIT_NAMESPACE } from "../middleware/security";

export const communityRouter = Router();

// ---------------------------------------------------------------------------
// Thread view-count deduplication (Task #489)
// ---------------------------------------------------------------------------
// Persists one row per (threadId, ipHash, hourBucket) in the DB so the
// "at most once per IP per hour" guarantee survives server restarts and holds
// across all autoscale instances.  The upsert is a no-op on conflict so we
// can use the affected-row count to decide whether to increment.
//
// The IP is SHA-256 hashed before storage so raw addresses are never persisted.
// Rows older than 48 hours are pruned with a 0.5% probability on each write
// to keep the table small without a dedicated cron job.
//
// In-process throttle cache
// -------------------------
// Each GET /api/community/threads/:id still hits the rate limiter (60/min per
// IP), but under sustained scraping from many distinct IPs the DB still receives
// one upsert per request. The Map below acts as a short-circuit: once we know
// a (threadId, ipHash, hourBucket) tuple has been recorded in this process we
// skip the round-trip entirely. The key already embeds the hour bucket so stale
// entries from the previous hour are never matched by new requests. The map is
// evicted LRU-style (Map preserves insertion order) and capped at
// VIEW_CACHE_MAX_SIZE entries so memory growth is bounded regardless of
// cardinality.

const VIEW_CACHE_MAX_SIZE = 10_000;
const _viewCache = new Map<string, true>();

/**
 * Clears the in-process view deduplication cache.
 * Exported for use in unit tests only — do not call from production code.
 */
export function clearViewCache(): void {
  _viewCache.clear();
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function hourBucket(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return `${y}${mo}${d}${h}`;
}

async function recordViewIfNew(threadId: number, ip: string): Promise<boolean> {
  const ipHash = hashIp(ip);
  const bucket = hourBucket();
  const cacheKey = `${threadId}:${ipHash}:${bucket}`;

  // In-process cache hit — skip the DB upsert entirely.
  if (_viewCache.has(cacheKey)) {
    return false;
  }

  const result = await db
    .insert(communityThreadViews)
    .values({ threadId, ipHash, hourBucket: bucket })
    .onConflictDoNothing()
    .returning({ id: communityThreadViews.id });

  // Populate the cache regardless of whether this instance won the insert race
  // or another autoscale instance already wrote the row. Either way the tuple
  // is in the DB and future requests from this process can skip the round-trip.
  if (_viewCache.size >= VIEW_CACHE_MAX_SIZE) {
    const oldest = _viewCache.keys().next().value;
    if (oldest !== undefined) {
      _viewCache.delete(oldest);
    }
  }
  _viewCache.set(cacheKey, true);

  return result.length > 0;
}

// Per-participant cooldown for bot-response scheduling.
// Uses a DB query so the cooldown is enforced consistently across all
// autoscale instances — a process-local Map would grant a fresh bucket
// whenever the user's request lands on a different instance.
//
// We count how many posts/threads this participant has created within the
// cooldown window. Because the triggering post is already committed when
// this runs, a count of exactly 1 means "this is their first post in the
// window" — safe to schedule. A count > 1 means bots were already queued
// for an earlier post in the same window — skip to avoid double-spend.
const BOT_SCHEDULE_COOLDOWN_MS = 60_000; // 1 minute between triggers per user

// Server-side field-length limits for user-submitted community content.
// These cap the prompt size forwarded to OpenAI, bounding the per-call cost.
const THREAD_TITLE_MAX_LEN = 300;
const COMMUNITY_CONTENT_MAX_LEN = 10_000;

// Per-IP rate limit (60/minute) for all unauthenticated community GET endpoints.
// 60 req/min matches the heartbeat/agent-status cap and is generous for human
// browsers while capping automated scraping. Persistent so the budget is
// enforced consistently across autoscale instances. The route path is embedded
// in every cache key (see security.ts), so this shared namespace safely covers
// multiple routes without counter collision.
const COMMUNITY_GET_MAX = 60;
const COMMUNITY_GET_WINDOW_MS = 60 * 1000;
const communityGetLimiter = () =>
  rateLimiter(COMMUNITY_GET_MAX, COMMUNITY_GET_WINDOW_MS, {
    persistNamespace: COMMUNITY_GET_RATE_LIMIT_NAMESPACE,
  });

// Per-IP rate limit (30/minute) for the community POST endpoints (/threads,
// /threads/:id/posts, /posts/:id/react, /participants). These routes
// authenticate inline (admin bearer token or portal session token) inside
// the handler body rather than via a standard auth middleware argument, so a
// request with no token at all still reaches the handler before it is
// rejected with 401. Without this limiter that reachable-but-unauthenticated
// path relied solely on the process-local generic /api ceiling, which resets
// on restart and is not shared across autoscale instances. Persistent so the
// budget holds across all instances.
const COMMUNITY_POST_MAX = 30;
const COMMUNITY_POST_WINDOW_MS = 60 * 1000;
const communityPostLimiter = () =>
  rateLimiter(COMMUNITY_POST_MAX, COMMUNITY_POST_WINDOW_MS, {
    persistNamespace: COMMUNITY_POST_RATE_LIMIT_NAMESPACE,
  });

async function shouldScheduleBotResponses(anonymousHandle: string): Promise<boolean> {
  const since = new Date(Date.now() - BOT_SCHEDULE_COOLDOWN_MS);

  const [postResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.authorHandle, anonymousHandle),
        eq(communityPosts.authorType, "user"),
        gte(communityPosts.createdAt, since),
      ),
    );

  const [threadResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(communityThreads)
    .where(
      and(
        eq(communityThreads.authorHandle, anonymousHandle),
        eq(communityThreads.authorType, "user"),
        gte(communityThreads.createdAt, since),
      ),
    );

  const total = Number(postResult?.count ?? 0) + Number(threadResult?.count ?? 0);
  // total === 1 means only the just-inserted item exists in the window → schedule.
  // total > 1 means a prior post already triggered scheduling within the window → skip.
  return total <= 1;
}

// Get all threads (public, paginated)
communityRouter.get("/threads", communityGetLimiter(), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;
    const rawSearch = typeof req.query.search === "string" ? req.query.search.trim() : "";
    // Cap search length so a pathological query string cannot blow up the LIKE pattern.
    const search = rawSearch.slice(0, 200);
    const offset = (page - 1) * limit;

    const isAdmin = await isValidAdminToken(req.headers['authorization'] as string);

    let query = db
      .select({
        id: communityThreads.id,
        departmentId: communityThreads.departmentId,
        title: communityThreads.title,
        content: communityThreads.content,
        authorType: communityThreads.authorType,
        authorHandle: communityThreads.authorHandle,
        isPinned: communityThreads.isPinned,
        isLocked: communityThreads.isLocked,
        viewCount: communityThreads.viewCount,
        replyCount: communityThreads.replyCount,
        lastActivityAt: communityThreads.lastActivityAt,
        createdAt: communityThreads.createdAt,
        isFlagged: communityThreads.isFlagged,
        flagReason: communityThreads.flagReason,
      })
      .from(communityThreads);

    const conditions = [] as any[];
    // Non-admin callers never see flagged threads.
    if (!isAdmin) {
      conditions.push(or(
        eq(communityThreads.isFlagged, false),
        sql`${communityThreads.isFlagged} IS NULL`,
      ));
    }
    if (departmentId) {
      conditions.push(eq(communityThreads.departmentId, departmentId));
    }
    if (search) {
      // Escape LIKE metacharacters so a literal % or _ in the user's query
      // doesn't act as a wildcard, then wrap in % … % for a substring match.
      const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          ilike(communityThreads.title, pattern),
          ilike(communityThreads.content, pattern),
        ),
      );
    }
    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions)) as typeof query;
    }

    const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "";

    const threads = await (sortBy === "views"
      ? query.orderBy(desc(communityThreads.viewCount))
      : query.orderBy(desc(communityThreads.isPinned), desc(communityThreads.lastActivityAt))
    ).limit(limit).offset(offset);

    res.json(threads);
  } catch (error) {
    warnOnce("community:list-threads-fail", "Error fetching threads:", error);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// Get single thread with posts
communityRouter.get("/threads/:id", communityGetLimiter(), async (req, res) => {
  try {
    const threadId = parseInt(req.params.id);
    
    // Get thread — admins see flagged threads; public gets 404
    const isAdminThread = await isValidAdminToken(req.headers['authorization'] as string);

    const [thread] = await db
      .select()
      .from(communityThreads)
      .where(eq(communityThreads.id, threadId));

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    // Flagged threads are hidden from public view (same as the list endpoint).
    if (thread.isFlagged && !isAdminThread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    // Increment view count — deduplicated to at most once per IP per hour,
    // persisted in DB so the guarantee holds across restarts and instances.
    const clientIp = req.ip ?? "unknown";
    if (await recordViewIfNew(threadId, clientIp)) {
      await db
        .update(communityThreads)
        .set({ viewCount: (thread.viewCount ?? 0) + 1 })
        .where(eq(communityThreads.id, threadId));
    }

    // Get posts — admins see all including flagged, public sees only clean posts
    const postsConditions = [
      eq(communityPosts.threadId, threadId),
      eq(communityPosts.isHidden, false),
    ] as any[];
    if (!isAdminThread) {
      postsConditions.push(or(
        eq(communityPosts.isFlagged, false),
        sql`${communityPosts.isFlagged} IS NULL`,
      ));
    }

    const posts = await db
      .select()
      .from(communityPosts)
      .where(and(...postsConditions))
      .orderBy(asc(communityPosts.createdAt));

    res.json({ thread, posts });
  } catch (error) {
    warnOnce("community:fetch-thread-fail", "Error fetching thread:", error);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

async function getOrCreateParticipantForSession(sessionToken: string): Promise<CommunityParticipant | null> {
  const session = await validatePortalSession(sessionToken);
  if (!session) return null;

  const caseId = session.caseId;
  if (!caseId) return null;

  const [existing] = await db
    .select()
    .from(communityParticipants)
    .where(eq(communityParticipants.caseId, caseId));

  if (existing) return existing;

  const PREMIUM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += PREMIUM_CHARS[Math.floor(Math.random() * PREMIUM_CHARS.length)];
  }
  const anonymousHandle = `Member #${code}`;

  // Upsert against the unique index on case_id (migration 0012) so a
  // simultaneous first-time community request from a sibling app instance
  // can't produce a duplicate participant row. On conflict the INSERT is a
  // no-op and we re-select the row the other instance inserted.
  const [newParticipant] = await db
    .insert(communityParticipants)
    .values({ caseId, anonymousHandle })
    .onConflictDoNothing({ target: communityParticipants.caseId })
    .returning();

  if (newParticipant) return newParticipant;

  const [raced] = await db
    .select()
    .from(communityParticipants)
    .where(eq(communityParticipants.caseId, caseId));

  return raced ?? null;
}

// Create new thread (users, bots, or admins)
communityRouter.post("/threads", communityPostLimiter(), async (req, res) => {
  try {
    const { departmentId, title, content, authorHandle, authorType, isPinned } = req.body;

    const authHeader = req.headers['authorization'] as string;
    const sessionToken = req.headers['x-portal-session-token'] as string;

    // Admin/bot posting via Bearer token — use the supplied authorHandle directly.
    // No content-length limit applied to admin/bot posts; they don't trigger AI spend.
    if (await isValidAdminToken(authHeader)) {
      if (!authorHandle) {
        return res.status(400).json({ error: "Author handle required for admin posts" });
      }
      const safeAuthorType: 'admin' | 'bot' =
        authorType === 'bot' ? 'bot' : 'admin';
      const [newThread] = await db
        .insert(communityThreads)
        .values({
          departmentId,
          title,
          content,
          authorType: safeAuthorType,
          authorHandle,
          isPinned: isPinned || false,
        })
        .returning();
      return res.status(201).json(newThread);
    }

    // Portal user posting — derive handle from their session.
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required. Please sign in to your portal account." });
    }

    const participant = await getOrCreateParticipantForSession(sessionToken);
    if (!participant) {
      return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    }

    // Enforce server-side content length limits to bound OpenAI prompt size.
    if (typeof title === "string" && title.length > THREAD_TITLE_MAX_LEN) {
      return res.status(400).json({ error: `Title must be ${THREAD_TITLE_MAX_LEN} characters or fewer` });
    }
    if (typeof content === "string" && content.length > COMMUNITY_CONTENT_MAX_LEN) {
      return res.status(400).json({ error: `Content must be ${COMMUNITY_CONTENT_MAX_LEN} characters or fewer` });
    }

    // Keyword moderation — check title + content before insert.
    const combinedText = `${title ?? ""} ${content ?? ""}`.trim();
    const modResult = await checkContent(combinedText);

    const [newThread] = await db
      .insert(communityThreads)
      .values({
        departmentId,
        title,
        content,
        authorType: 'user',
        authorHandle: participant.anonymousHandle,
        isPinned: false,
        isFlagged: modResult.flagged,
        flagReason: modResult.flagged
          ? `keyword_match:${modResult.matchedPattern ?? ""}`
          : null,
      })
      .returning();

    if (modResult.flagged) {
      storage.createAuditLog({
        action: "community_post_flagged",
        adminUsername: "system",
        targetType: "community_thread",
        targetId: String(newThread.id),
        newValue: JSON.stringify({ flagReason: newThread.flagReason }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      }).catch(() => {});
    }

    await db
      .update(communityParticipants)
      .set({ postCount: String(parseInt(String(participant.postCount || '0')) + 1) })
      .where(eq(communityParticipants.id, participant.id));

    // Schedule AI-generated bot responses for real user posts (delayed delivery).
    // Only schedule for unflagged threads so bots don't amplify flagged content.
    // Cooldown is enforced via a DB query so it holds across all autoscale instances.
    if (!modResult.flagged && await shouldScheduleBotResponses(participant.anonymousHandle)) {
      scheduleResponsesForThread(newThread.id).catch(err =>
        warnOnce("community:schedule-bots-fail", "Error scheduling bot responses:", err)
      );
    }

    res.status(201).json(newThread);
  } catch (error) {
    warnOnce("community:create-thread-fail", "Error creating thread:", error);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// Get posts for a thread
communityRouter.get("/threads/:id/posts", communityGetLimiter(), async (req, res) => {
  try {
    const threadId = parseInt(req.params.id);
    
    const isAdminPosts = await isValidAdminToken(req.headers['authorization'] as string);
    const postsListConditions = [
      eq(communityPosts.threadId, threadId),
      eq(communityPosts.isHidden, false),
    ] as any[];
    if (!isAdminPosts) {
      postsListConditions.push(or(
        eq(communityPosts.isFlagged, false),
        sql`${communityPosts.isFlagged} IS NULL`,
      ));
    }

    const posts = await db
      .select()
      .from(communityPosts)
      .where(and(...postsListConditions))
      .orderBy(asc(communityPosts.createdAt));

    res.json(posts);
  } catch (error) {
    warnOnce("community:list-posts-fail", "Error fetching posts:", error);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Create reply to thread
communityRouter.post("/threads/:id/posts", communityPostLimiter(), async (req, res) => {
  try {
    const threadId = parseInt(req.params.id);
    const { content, authorHandle: directHandle, authorType } = req.body;

    const authHeader = req.headers['authorization'] as string;
    const sessionToken = req.headers['x-portal-session-token'] as string;

    // Check thread exists and not locked
    const [thread] = await db
      .select()
      .from(communityThreads)
      .where(eq(communityThreads.id, threadId));

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.isLocked) {
      return res.status(403).json({ error: "Thread is locked" });
    }

    let resolvedHandle: string;
    let resolvedParticipantId: number | null = null;
    let resolvedAnonymousHandle: string | null = null;
    // Default to a regular user post; only an authenticated admin request may
    // upgrade authorType to 'admin' or 'bot'. Portal-session posts are always
    // 'user' regardless of what the client supplied in the body.
    let resolvedAuthorType: 'user' | 'admin' | 'bot' = 'user';

    if (await isValidAdminToken(authHeader)) {
      // Admin/bot posting via Bearer token — use the supplied authorHandle directly
      if (!directHandle) {
        return res.status(400).json({ error: "Author handle required for admin posts" });
      }
      resolvedHandle = directHandle;
      if (authorType === 'admin' || authorType === 'bot') {
        resolvedAuthorType = authorType;
      } else {
        resolvedAuthorType = 'admin';
      }
    } else if (sessionToken) {
      // Portal user posting — derive handle from their session
      const participant = await getOrCreateParticipantForSession(sessionToken);
      if (!participant) {
        return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
      }
      resolvedHandle = participant.anonymousHandle;
      resolvedParticipantId = participant.id;
      resolvedAnonymousHandle = participant.anonymousHandle;
      resolvedAuthorType = 'user';
    } else {
      return res.status(401).json({ error: "Authentication required. Please sign in to your portal account." });
    }

    // Enforce server-side content length limit for portal users to bound OpenAI prompt size.
    if (resolvedAuthorType === 'user' && typeof content === "string" && content.length > COMMUNITY_CONTENT_MAX_LEN) {
      return res.status(400).json({ error: `Reply must be ${COMMUNITY_CONTENT_MAX_LEN} characters or fewer` });
    }

    // Keyword moderation — only applied to portal-user posts, not admin/bot content.
    let postIsFlagged = false;
    let postFlagReason: string | null = null;
    if (resolvedAuthorType === 'user') {
      const modResult = await checkContent(content ?? "");
      if (modResult.flagged) {
        postIsFlagged = true;
        postFlagReason = `keyword_match:${modResult.matchedPattern ?? ""}`;
      }
    }

    const [newPost] = await db
      .insert(communityPosts)
      .values({
        threadId,
        content,
        authorType: resolvedAuthorType,
        authorHandle: resolvedHandle,
        isFlagged: postIsFlagged,
        flagReason: postFlagReason,
      })
      .returning();

    if (postIsFlagged) {
      storage.createAuditLog({
        action: "community_post_flagged",
        adminUsername: "system",
        targetType: "community_post",
        targetId: String(newPost.id),
        newValue: JSON.stringify({ flagReason: postFlagReason }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      }).catch(() => {});
    }

    // Update thread reply count and last activity
    await db
      .update(communityThreads)
      .set({
        replyCount: (thread.replyCount ?? 0) + 1,
        lastActivityAt: new Date()
      })
      .where(eq(communityThreads.id, threadId));

    // Update participant post count for portal users
    if (resolvedParticipantId) {
      const [participant] = await db
        .select()
        .from(communityParticipants)
        .where(eq(communityParticipants.id, resolvedParticipantId));
      if (participant) {
        await db
          .update(communityParticipants)
          .set({ postCount: String(parseInt(participant.postCount || '0') + 1) })
          .where(eq(communityParticipants.id, resolvedParticipantId));
      }
    }

    // Schedule AI-generated bot responses for real user replies only (not admin/bot posts).
    // Skip scheduling for flagged posts so bots don't amplify flagged content.
    // Use the resolved (server-trusted) authorType, not the raw request body field, so
    // an admin posting without explicit authorType isn't mistaken for a user.
    // Cooldown is enforced via a DB query so it holds across all autoscale instances.
    if (resolvedAuthorType === 'user' && !postIsFlagged && resolvedAnonymousHandle !== null && await shouldScheduleBotResponses(resolvedAnonymousHandle)) {
      scheduleResponsesForThread(threadId, newPost.id).catch(err =>
        warnOnce("community:schedule-bots-reply-fail", "Error scheduling bot responses:", err)
      );
    }

    res.status(201).json(newPost);
  } catch (error) {
    warnOnce("community:create-post-fail", "Error creating post:", error);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// React to a post — three auth paths:
//   1. Portal session (x-portal-session-token): participantId derived server-side.
//   2. Admin bearer + participantId in body: trusted numeric participantId.
//   3. Admin bearer + botProfileId in body: bot profile looked up, participant
//      resolved from the bot's handle — caller-supplied participantId is ignored.
// All three paths share the same downstream duplicate-check query.
const ALLOWED_REACTION_TYPES = ["like", "helpful", "thanks"] as const;

communityRouter.post("/posts/:id/react", communityPostLimiter(), async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { reactionType } = req.body;

    if (reactionType !== undefined && !ALLOWED_REACTION_TYPES.includes(reactionType)) {
      return res.status(400).json({ error: "Invalid reactionType" });
    }

    const authHeader = req.headers['authorization'] as string;
    const sessionToken = req.headers['x-portal-session-token'] as string;

    let resolvedParticipantId: number;

    if (await isValidAdminToken(authHeader)) {
      if (req.body.botProfileId !== undefined) {
        // Bot-profile path: resolve the community participant from the bot's handle.
        const botId = parseInt(req.body.botProfileId);
        if (!botId || isNaN(botId)) {
          return res.status(400).json({ error: "Invalid botProfileId" });
        }
        const [bot] = await db.select().from(botProfiles).where(eq(botProfiles.id, botId));
        if (!bot) {
          return res.status(404).json({ error: "Bot profile not found" });
        }
        const [botParticipant] = await db
          .select()
          .from(communityParticipants)
          .where(eq(communityParticipants.anonymousHandle, bot.handle));
        if (!botParticipant) {
          return res.status(400).json({ error: "No community participant found for this bot profile" });
        }
        resolvedParticipantId = botParticipant.id;
      } else {
        // Admin path: participantId must be explicitly supplied and trusted
        const bodyId = parseInt(req.body.participantId);
        if (!bodyId || isNaN(bodyId)) {
          return res.status(400).json({ error: "participantId required for admin reactions" });
        }
        resolvedParticipantId = bodyId;
      }
    } else if (sessionToken) {
      // Portal user path: derive participant from session, never trust the body
      const participant = await getOrCreateParticipantForSession(sessionToken);
      if (!participant) {
        return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
      }
      resolvedParticipantId = participant.id;
    } else {
      return res.status(401).json({ error: "Authentication required. Please sign in to your portal account." });
    }

    // Check if already reacted
    const [existing] = await db
      .select()
      .from(communityReactions)
      .where(and(
        eq(communityReactions.postId, postId),
        eq(communityReactions.participantId, resolvedParticipantId)
      ));

    if (existing) {
      return res.status(400).json({ error: "Already reacted" });
    }

    const [reaction] = await db
      .insert(communityReactions)
      .values({
        postId,
        participantId: resolvedParticipantId,
        reactionType: reactionType || 'like'
      })
      .returning();

    // Update post like count
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, postId));

    if (post) {
      await db
        .update(communityPosts)
        .set({ likeCount: String(parseInt(post.likeCount || '0') + 1) })
        .where(eq(communityPosts.id, postId));
    }

    res.status(201).json(reaction);
  } catch (error) {
    warnOnce("community:create-reaction-fail", "Error creating reaction:", error);
    res.status(500).json({ error: "Failed to create reaction" });
  }
});

// Get or create participant — requires a valid portal session or admin token
communityRouter.post("/participants", communityPostLimiter(), async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] as string;
    const sessionToken = req.headers['x-portal-session-token'] as string;
    const { departmentId } = req.body;

    if (await isValidAdminToken(authHeader)) {
      // Admin path: caseId supplied directly in body
      const caseId: string = req.body.caseId;
      if (!caseId) {
        return res.status(400).json({ error: "Case ID is required" });
      }
      const [existing] = await db
        .select()
        .from(communityParticipants)
        .where(eq(communityParticipants.caseId, caseId));
      if (existing) return res.json(existing);

      const PREMIUM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 5; i++) {
        code += PREMIUM_CHARS[Math.floor(Math.random() * PREMIUM_CHARS.length)];
      }
      const anonymousHandle = `Member #${code}`;
      const [newParticipant] = await db
        .insert(communityParticipants)
        .values({ caseId, anonymousHandle, departmentId })
        .returning();
      return res.status(201).json(newParticipant);
    }

    // Portal user path: caseId derived from session
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required. Please sign in to your portal account." });
    }

    const participant = await getOrCreateParticipantForSession(sessionToken);
    if (!participant) {
      return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    }

    res.json(participant);
  } catch (error) {
    warnOnce("community:create-participant-fail", "Error creating participant:", error);
    res.status(500).json({ error: "Failed to create participant" });
  }
});

// Get the current portal user's community handle.
// Lazily creates a participant record on first call (mirrors the behaviour of
// the post/reply routes) so the caller always gets a stable handle back.
communityRouter.get("/participants/me", async (req, res) => {
  try {
    const sessionToken = req.headers['x-portal-session-token'] as string;
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const participant = await getOrCreateParticipantForSession(sessionToken);
    if (!participant) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    res.json({ anonymousHandle: participant.anonymousHandle });
  } catch (error) {
    warnOnce("community:participant-handle-fail", "Error fetching participant handle:", error);
    res.status(500).json({ error: "Failed to fetch handle" });
  }
});

// Get the current portal user's recent community contributions (threads they started + replies they posted)
communityRouter.get("/participants/me/posts", async (req, res) => {
  try {
    const sessionToken = req.headers['x-portal-session-token'] as string;
    if (!sessionToken) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const participant = await getOrCreateParticipantForSession(sessionToken);
    if (!participant) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    // Authored threads
    const threads = await db
      .select({
        id: communityThreads.id,
        content: communityThreads.content,
        createdAt: communityThreads.createdAt,
        threadId: communityThreads.id,
        threadTitle: communityThreads.title,
        authorHandle: communityThreads.authorHandle,
      })
      .from(communityThreads)
      .where(
        and(
          eq(communityThreads.authorHandle, participant.anonymousHandle),
          eq(communityThreads.authorType, "user"),
        )
      );

    // Replies posted by the user
    const replies = await db
      .select({
        id: communityPosts.id,
        content: communityPosts.content,
        createdAt: communityPosts.createdAt,
        likeCount: communityPosts.likeCount,
        threadId: communityPosts.threadId,
        threadTitle: communityThreads.title,
        authorHandle: communityPosts.authorHandle,
      })
      .from(communityPosts)
      .leftJoin(communityThreads, eq(communityPosts.threadId, communityThreads.id))
      .where(
        and(
          eq(communityPosts.authorHandle, participant.anonymousHandle),
          eq(communityPosts.authorType, "user"),
        )
      );

    // Normalize, merge, sort, and limit
    const combined = [
      ...threads.map((t) => ({
        id: t.id,
        type: "thread" as const,
        content: t.content,
        createdAt: t.createdAt,
        likeCount: "0",
        threadId: t.threadId,
        threadTitle: t.threadTitle,
        authorHandle: t.authorHandle,
      })),
      ...replies.map((p) => ({
        id: p.id,
        type: "reply" as const,
        content: p.content,
        createdAt: p.createdAt,
        likeCount: p.likeCount ?? "0",
        threadId: p.threadId,
        threadTitle: p.threadTitle,
        authorHandle: p.authorHandle,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    res.json(combined);
  } catch (error) {
    warnOnce("community:user-posts-fail", "Error fetching user posts:", error);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Update thread (admin only - pin/lock)
communityRouter.patch("/threads/:id", async (req, res) => {
  const authHeader = req.headers['authorization'] as string;
  if (!(await isValidAdminToken(authHeader))) {
    return res.status(401).json({ error: "Admin authentication required." });
  }
  try {
    const threadId = parseInt(req.params.id);
    const { isPinned, isLocked, title, content } = req.body;

    const updateData: Record<string, any> = {};
    if (isPinned !== undefined) updateData.isPinned = isPinned;
    if (isLocked !== undefined) updateData.isLocked = isLocked;
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(communityThreads)
      .set(updateData)
      .where(eq(communityThreads.id, threadId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Thread not found" });
    }

    res.json(updated);
  } catch (error) {
    warnOnce("community:update-thread-fail", "Error updating thread:", error);
    res.status(500).json({ error: "Failed to update thread" });
  }
});

// Delete thread (admin only)
communityRouter.delete("/threads/:id", async (req, res) => {
  const authHeader = req.headers['authorization'] as string;
  if (!(await isValidAdminToken(authHeader))) {
    return res.status(401).json({ error: "Admin authentication required." });
  }
  try {
    const threadId = parseInt(req.params.id);

    // Delete related posts first
    await db
      .delete(communityPosts)
      .where(eq(communityPosts.threadId, threadId));

    // Delete thread
    const [deleted] = await db
      .delete(communityThreads)
      .where(eq(communityThreads.id, threadId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Thread not found" });
    }

    res.json({ success: true, deleted });
  } catch (error) {
    warnOnce("community:delete-thread-fail", "Error deleting thread:", error);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

// Get community stats
communityRouter.get("/stats", communityGetLimiter(), async (req, res) => {
  try {
    const [threadCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(communityThreads);

    const [postCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(communityPosts);

    const [memberCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(communityParticipants);

    const [botCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(botProfiles)
      .where(eq(botProfiles.isActive, true));

    const [viewSum] = await db
      .select({ total: sql<number>`coalesce(sum(${communityThreads.viewCount}::int), 0)` })
      .from(communityThreads);

    res.json({
      threads: threadCount.count,
      posts: postCount.count,
      members: Number(memberCount.count) + Number(botCount.count),
      activeBots: botCount.count,
      totalViews: Number(viewSum.total),
    });
  } catch (error) {
    warnOnce("community:stats-fail", "Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Get recent activity (for landing page testimonials)
communityRouter.get("/recent", communityGetLimiter(), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const recentPosts = await db
      .select({
        id: communityPosts.id,
        content: communityPosts.content,
        authorHandle: communityPosts.authorHandle,
        authorType: communityPosts.authorType,
        createdAt: communityPosts.createdAt,
        threadId: communityPosts.threadId,
      })
      .from(communityPosts)
      .where(and(
        eq(communityPosts.isHidden, false),
        or(
          eq(communityPosts.isFlagged, false),
          sql`${communityPosts.isFlagged} IS NULL`,
        ),
      ))
      .orderBy(desc(communityPosts.createdAt))
      .limit(limit);

    res.json(recentPosts);
  } catch (error) {
    warnOnce("community:recent-posts-fail", "Error fetching recent posts:", error);
    res.status(500).json({ error: "Failed to fetch recent posts" });
  }
});
