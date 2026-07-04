import { Router } from "express";
import { storage, DatabaseStorage } from "../storage";
import { insertOfflineMessageSchema, insertChatSatisfactionRatingSchema } from "@shared/schema";
import { checkAdminAuth } from "./middleware";
import {
  parseUserAgent,
  lookupIpGeo,
  getCachedIpGeo,
  inferPersona,
  computeRiskScore,
} from "../services/visitor-intel";
import { warnOnce } from "../lib/warnOnce";
import { issueSatisfactionToken, verifySatisfactionToken } from "../lib/satisfactionToken";
import { notificationService } from "../services/NotificationService";
import {
  rateLimiter,
  VISITOR_OFFLINE_MSG_RATE_LIMIT_NAMESPACE,
  VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE,
  VISITOR_HEARTBEAT_RATE_LIMIT_NAMESPACE,
  VISITOR_TYPING_RATE_LIMIT_NAMESPACE,
  VISITOR_TYPING_GET_RATE_LIMIT_NAMESPACE,
  VISITOR_AGENT_STATUS_RATE_LIMIT_NAMESPACE,
  VISITOR_END_SESSION_RATE_LIMIT_NAMESPACE,
} from "../middleware/security";

const PUBLIC_WRITE_MAX = 5;
const PUBLIC_WRITE_WINDOW_MS = 60 * 1000;

// Heartbeat is sent every ~20 s by legitimate clients. 60 req/min allows a
// visitor with up to ~3 browser tabs while still capping runaway bots.
const HEARTBEAT_RATE_MAX = 60;
// Typing indicators fire on every keystroke burst; 120 req/min is generous
// for a real user but throttles automated flooding.
const TYPING_RATE_MAX = 120;

const router = Router();

// Single source of truth for the stale visitor window. Defined as a static
// on DatabaseStorage so both the storage read filter and this route share
// the same value. Must stay ≥ 3× the client heartbeat interval (20s).
const STALE_VISITOR_TIMEOUT_MS = DatabaseStorage.ACTIVE_VISITOR_STALE_MS;

// Extract the originating client IP. `app.set("trust proxy", 1)` is
// configured in server/index.ts so Express resolves req.ip from the
// single trusted upstream hop. We never read X-Forwarded-For directly
// — doing so would let any caller forge the IP and bypass per-IP rate
// limits or blocklist checks.
function clientIp(req: import("express").Request): string {
  return (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

// Parse a JSON-encoded text column safely. Returns the fallback if the
// value is null/empty/malformed. We use this everywhere we read the
// pageTimeline / pagesViewed / persona reasoning columns so callers
// never have to think about the underlying TEXT-as-JSON storage shape.
function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

interface PageTimelineEntry {
  path: string;
  title?: string;
  enteredAt: number; // ms epoch
  leftAt?: number;
  dwellMs?: number;
}

// In-memory typing indicators (cleared after 3 seconds of inactivity).
// Hard cap prevents an attacker from exhausting process memory by submitting
// many unique caseId values — entries are cheap individually but unbounded
// growth would cause `GET /typing/:caseId` to iterate an ever-growing map.
const TYPING_INDICATORS_MAX = 500;
const typingIndicators: Map<string, { caseId: string; sender: 'user' | 'admin'; timestamp: number }> = new Map();

// Clean up stale typing indicators every 3 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of typingIndicators.entries()) {
    if (now - value.timestamp > 3000) {
      typingIndicators.delete(key);
    }
  }
}, 3000);

// Heartbeat - update visitor activity. The client sends the bits it can
// see (visitorId, currentPage, idle flag, screen/lang/tz/connection,
// fingerprint, referrer, raw nav-collected device info). The server
// derives everything else from headers and IP: parsed UA, geo, persona,
// risk score, and the running pageTimeline.
router.post(
  "/heartbeat",
  rateLimiter(HEARTBEAT_RATE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_HEARTBEAT_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const {
      visitorId,
      caseId,
      currentPage,
      pageTitle,
      referrer,
      isIdle,
      // Forensic fields collected client-side
      screenWidth,
      screenHeight,
      screenResolution,
      language,
      timezone,
      connectionType,
      fingerprintHash,
    } = req.body;

    if (!visitorId) {
      return res.status(400).json({ error: "visitorId is required" });
    }

    const ipAddress = clientIp(req);
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? "";
    const parsedUa = parseUserAgent(userAgent);
    const cachedGeo = getCachedIpGeo(ipAddress);

    const existingVisitor = await storage.getActiveVisitorByVisitorId(visitorId);

    // Build the next pageTimeline. Each unique route entered records a new
    // entry. Re-hitting the *same* current page within the heartbeat window
    // is treated as continued dwell, not a new entry.
    const now = Date.now();
    const prevTimeline = existingVisitor
      ? parseJsonArray<PageTimelineEntry>(existingVisitor.pageTimeline)
      : [];
    let nextTimeline: PageTimelineEntry[] = [...prevTimeline];
    if (currentPage) {
      const last = nextTimeline[nextTimeline.length - 1];
      if (!last || last.path !== currentPage) {
        // close out the previous entry's dwell
        if (last && !last.leftAt) {
          last.leftAt = now;
          last.dwellMs = Math.max(0, now - last.enteredAt);
        }
        nextTimeline.push({ path: currentPage, title: pageTitle, enteredAt: now });
      } else if (pageTitle && !last.title) {
        last.title = pageTitle;
      }
    }
    // Hard cap to keep the row small. Drop oldest entries beyond the cap.
    const TIMELINE_CAP = 200;
    if (nextTimeline.length > TIMELINE_CAP) {
      nextTimeline = nextTimeline.slice(nextTimeline.length - TIMELINE_CAP);
    }

    // Persona + risk are derived from the timeline + session metadata.
    const personaResult = inferPersona(
      nextTimeline,
      Boolean(existingVisitor?.hasActiveChat),
      caseId ?? existingVisitor?.caseId ?? null,
    );
    const riskInput = {
      ua: userAgent,
      parsedUa,
      pageTimeline: nextTimeline,
      pageViewCount: nextTimeline.length,
      sessionStartedAt: existingVisitor?.sessionStartedAt
        ? new Date(existingVisitor.sessionStartedAt)
        : new Date(),
      lastHeartbeatAt: new Date(now),
      referrer: referrer ?? existingVisitor?.referrer ?? null,
      asn: cachedGeo?.asn ?? existingVisitor?.asn ?? null,
      hadChat: Boolean(existingVisitor?.hasActiveChat),
    };
    const riskResult = computeRiskScore(riskInput);

    // Probabilistic in-path stale cleanup (~5% of heartbeats).
    // This ensures attacker-created rows from expired IPs are removed
    // automatically without relying solely on the admin-triggered /cleanup
    // endpoint. Fire-and-forget so the heartbeat response is not delayed.
    if (Math.random() < 0.05) {
      storage.cleanupStaleVisitors(STALE_VISITOR_TIMEOUT_MS).catch(() => {});
    }

    // Reject heartbeats from blocked visitors (by visitorId or IP).
    // This must run before any DB write so the blocklist can contain
    // ongoing abuse without requiring a manual cleanup pass each time.
    const isBlocked = await storage.isVisitorBlocked(visitorId);
    if (isBlocked) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Also check whether the originating IP itself is blocked.
    if (ipAddress) {
      const ipBlocked = await storage.isIpAddressBlocked(ipAddress);
      if (ipBlocked) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    // caseId supplied by an unauthenticated caller is never trusted.
    // For existing rows the server-established value is always preserved
    // (see existingVisitor.caseId below). For new rows the field is left
    // null so an attacker cannot forge a case association by crafting a
    // heartbeat — the association can only be written by authenticated paths.

    if (existingVisitor) {
      const pagesViewed = parseJsonArray<string>(existingVisitor.pagesViewed);
      if (currentPage && !pagesViewed.includes(currentPage)) {
        pagesViewed.push(currentPage);
      }

      await storage.updateActiveVisitor(existingVisitor.id, {
        currentPage,
        pageTitle,
        isIdle: isIdle || false,
        idleSince: isIdle ? new Date() : null,
        pagesViewed: JSON.stringify(pagesViewed),
        pageViewCount: pagesViewed.length,
        pageTimeline: JSON.stringify(nextTimeline),
        lastHeartbeatAt: new Date(now),
        // Preserve the server-established caseId; never let the client
        // overwrite it so an attacker cannot re-bind an existing session
        // to a different case by sending a forged caseId in a heartbeat.
        caseId: existingVisitor.caseId,
        // Refresh forensic snapshot in case the client sent newer fields
        userAgent: userAgent || existingVisitor.userAgent,
        deviceType: parsedUa.deviceType !== "unknown" ? parsedUa.deviceType : existingVisitor.deviceType,
        browser: parsedUa.browser ?? existingVisitor.browser,
        browserVersion: parsedUa.browserVersion ?? existingVisitor.browserVersion,
        os: parsedUa.os ?? existingVisitor.os,
        osVersion: parsedUa.osVersion ?? existingVisitor.osVersion,
        screenWidth: screenWidth ?? existingVisitor.screenWidth,
        screenHeight: screenHeight ?? existingVisitor.screenHeight,
        screenResolution:
          screenResolution ??
          (screenWidth && screenHeight ? `${screenWidth}x${screenHeight}` : existingVisitor.screenResolution),
        language: language ?? existingVisitor.language,
        timezone: timezone ?? existingVisitor.timezone,
        connectionType: connectionType ?? existingVisitor.connectionType,
        fingerprintHash: fingerprintHash ?? existingVisitor.fingerprintHash,
        country: cachedGeo?.country ?? existingVisitor.country,
        region: cachedGeo?.region ?? existingVisitor.region,
        city: cachedGeo?.city ?? existingVisitor.city,
        isp: cachedGeo?.isp ?? existingVisitor.isp,
        asn: cachedGeo?.asn ?? existingVisitor.asn,
        persona: personaResult.persona,
        personaConfidence: personaResult.confidence,
        personaReasoning: JSON.stringify(personaResult.reasoning),
        riskScore: riskResult.score,
        riskFlags: JSON.stringify(riskResult.flags),
      });

      // If we don't yet have geo for this IP, kick off a background
      // lookup. The result populates the cache so the next heartbeat
      // (10s later) writes it through to the row. Doing it
      // fire-and-forget keeps the heartbeat fast and avoids blocking
      // on the upstream service.
      if (!cachedGeo && ipAddress) {
        lookupIpGeo(ipAddress).catch(() => {});
      }

      res.json({ success: true, visitorId, isNew: false });
    } else {
      // Per-IP creation cap: allow at most 10 concurrent rows from a single
      // IP to bound table growth from automated scripts using random visitorIds.
      // Legitimate users rarely open more than a handful of tabs simultaneously.
      const MAX_ROWS_PER_IP = 10;
      if (ipAddress) {
        const rowsForIp = await storage.countActiveVisitorsByIp(ipAddress);
        if (rowsForIp >= MAX_ROWS_PER_IP) {
          return res.status(429).json({ error: "Too many concurrent sessions from this address" });
        }
      }

      const newVisitor = await storage.createActiveVisitor({
        visitorId,
        // caseId is intentionally omitted here. An unauthenticated caller
        // can forge any caseId in the request body; accepting it on the
        // initial row creation lets attackers bind fake visitors to real
        // cases and have admin-authored chat messages written into them.
        // The field stays null until an authenticated path sets it.
        currentPage,
        pageTitle,
        referrer,
        deviceType: parsedUa.deviceType !== "unknown" ? parsedUa.deviceType : undefined,
        browser: parsedUa.browser,
        browserVersion: parsedUa.browserVersion,
        os: parsedUa.os,
        osVersion: parsedUa.osVersion,
        userAgent,
        screenWidth,
        screenHeight,
        screenResolution: screenResolution ?? (screenWidth && screenHeight ? `${screenWidth}x${screenHeight}` : undefined),
        language,
        timezone,
        connectionType,
        fingerprintHash,
        ipAddress,
        country: cachedGeo?.country,
        region: cachedGeo?.region,
        city: cachedGeo?.city,
        isp: cachedGeo?.isp,
        asn: cachedGeo?.asn,
        pagesViewed: JSON.stringify([currentPage].filter(Boolean)),
        pageViewCount: 1,
        pageTimeline: JSON.stringify(nextTimeline),
        isIdle: false,
        engagementScore: 10,
        persona: personaResult.persona,
        personaConfidence: personaResult.confidence,
        personaReasoning: JSON.stringify(personaResult.reasoning),
        riskScore: riskResult.score,
        riskFlags: JSON.stringify(riskResult.flags),
        sessionStartedAt: new Date(),
        lastHeartbeatAt: new Date(),
      });

      // Same fire-and-forget geo lookup pattern as above — the result
      // will populate the row on the very next heartbeat.
      if (!cachedGeo && ipAddress) {
        lookupIpGeo(ipAddress).catch(() => {});
      }

      // Notify admin of the new arrival. Fire-and-forget — must never
      // block the heartbeat response or surface errors to the client.
      const geoLabel = cachedGeo
        ? [cachedGeo.city, cachedGeo.country].filter(Boolean).join(', ')
        : (ipAddress || null);
      const deviceLabel =
        [parsedUa.browser, parsedUa.os].filter(Boolean).join(' / ') || 'Unknown device';
      const personaLabel = personaResult.persona
        ? personaResult.persona.replace(/-/g, ' ')
        : null;
      const notifBody = [deviceLabel, geoLabel, personaLabel].filter(Boolean).join(' · ');
      notificationService
        .notifyAdmin('new_visitor', `New visitor on ${currentPage ?? 'the site'}`, notifBody)
        .catch(() => {});

      res.json({ success: true, visitorId, isNew: true, id: newVisitor.id });
    }
  } catch (error) {
    warnOnce("visitors:heartbeat-fail", "Heartbeat error:", error);
    res.status(500).json({ error: "Failed to process heartbeat" });
  }
});

// End session - visitor leaving. We freeze a *full* forensic snapshot
// into visitor_history before deleting the active row, so the admin
// "Visit History" view has every column it needs without joining back
// to anything.
// Rate-limited to 5 req/min per IP (matching other public write endpoints).
// A single visitor sends one end-session on tab close; bots sending many
// end-sessions would exhaust visitor_history inserts and active_visitor deletes.
router.post(
  "/end-session",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_END_SESSION_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const { visitorId } = req.body;

    if (!visitorId) {
      return res.status(400).json({ error: "visitorId is required" });
    }

    const visitor = await storage.getActiveVisitorByVisitorId(visitorId);

    if (visitor) {
      const sessionEnd = new Date();
      const sessionDuration = Math.floor(
        (sessionEnd.getTime() - new Date(visitor.sessionStartedAt).getTime()) / 1000,
      );

      // Close the dwell on the last open timeline entry so the saved
      // history row reflects total time on the final page.
      const timeline = parseJsonArray<PageTimelineEntry>(visitor.pageTimeline);
      const lastEntry = timeline[timeline.length - 1];
      if (lastEntry && !lastEntry.leftAt) {
        lastEntry.leftAt = sessionEnd.getTime();
        lastEntry.dwellMs = Math.max(0, lastEntry.leftAt - lastEntry.enteredAt);
      }

      await storage.createVisitorHistory({
        visitorId: visitor.visitorId,
        caseId: visitor.caseId,
        pagesViewed: visitor.pagesViewed,
        pageViewCount: visitor.pageViewCount || 0,
        pageTimeline: JSON.stringify(timeline),
        sessionDuration,
        engagementScore: visitor.engagementScore,
        deviceType: visitor.deviceType,
        browser: visitor.browser,
        browserVersion: visitor.browserVersion,
        os: visitor.os,
        osVersion: visitor.osVersion,
        userAgent: visitor.userAgent,
        screenResolution: visitor.screenResolution,
        language: visitor.language,
        timezone: visitor.timezone,
        connectionType: visitor.connectionType,
        fingerprintHash: visitor.fingerprintHash,
        referrer: visitor.referrer,
        ipAddress: visitor.ipAddress,
        country: visitor.country,
        region: visitor.region,
        city: visitor.city,
        isp: visitor.isp,
        asn: visitor.asn,
        persona: visitor.persona,
        personaConfidence: visitor.personaConfidence,
        personaReasoning: visitor.personaReasoning,
        riskScore: visitor.riskScore,
        riskFlags: visitor.riskFlags,
        hadChat: visitor.hasActiveChat || false,
        sessionStartedAt: visitor.sessionStartedAt,
        sessionEndedAt: sessionEnd,
      });

      await storage.deleteActiveVisitor(visitor.id);
    }

    // Issue a short-lived signed token when the visitor had a chat so the
    // satisfaction rating endpoint can verify eligibility without a DB read.
    // Token is only issued when hadChat is true and caseId is known.
    const hadChat = visitor?.hasActiveChat && visitor.caseId != null;
    const satToken =
      hadChat && visitor?.caseId != null
        ? issueSatisfactionToken(visitor.visitorId, visitor.caseId)
        : undefined;

    res.json({ success: true, ...(satToken !== undefined ? { satToken } : {}) });
  } catch (error) {
    warnOnce("visitors:end-session-error", "End session error:", error);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Get all active visitors (admin)
router.get("/active", checkAdminAuth, async (req, res) => {
  try {
    const visitors = await storage.getActiveVisitors();
    res.json(visitors);
  } catch (error) {
    warnOnce("visitors:get-active-visitors-error", "Get active visitors error:", error);
    res.status(500).json({ error: "Failed to get active visitors" });
  }
});

// Get active visitor count
router.get("/count", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.getActiveVisitorCount();
    res.json({ count });
  } catch (error) {
    warnOnce("visitors:get-visitor-count-error", "Get visitor count error:", error);
    res.status(500).json({ error: "Failed to get visitor count" });
  }
});

// Check agent availability (for frontend to show offline form).
// Rate-limited to 60 req/min (matching heartbeat) — the same moderate
// cap used by other lightweight visitor GETs. Bots or crawlers polling
// this endpoint at high frequency are throttled before they reach the DB.
// IMPORTANT: must be declared before the /:visitorId wildcard below so that
// Express matches this exact-path route first.
router.get(
  "/agent-status",
  rateLimiter(HEARTBEAT_RATE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_AGENT_STATUS_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
    try {
      // Check if any admin is online
      const availability = await storage.getAdminAvailability('Admin2025');
      const status = availability?.status || 'offline';
      const isOnline = status === 'online';
      res.json({ isOnline, status });
    } catch (error) {
      warnOnce("visitors:agent-status-fail", "Check agent status error:", error);
      res.status(500).json({ error: "Failed to check agent status" });
    }
  },
);

// Get visitor by ID
router.get("/:visitorId", checkAdminAuth, async (req, res) => {
  try {
    const visitor = await storage.getActiveVisitorByVisitorId(req.params.visitorId);
    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }
    res.json(visitor);
  } catch (error) {
    warnOnce("visitors:get-visitor-error", "Get visitor error:", error);
    res.status(500).json({ error: "Failed to get visitor" });
  }
});

// Get visitor history
router.get("/:visitorId/history", checkAdminAuth, async (req, res) => {
  try {
    const history = await storage.getVisitorHistory(req.params.visitorId);
    res.json(history);
  } catch (error) {
    warnOnce("visitors:get-visitor-history-error", "Get visitor history error:", error);
    res.status(500).json({ error: "Failed to get visitor history" });
  }
});

// Block visitor
router.post("/block", checkAdminAuth, async (req, res) => {
  try {
    const { visitorId, ipAddress, reason, blockedBy, expiresAt } = req.body;

    if (!visitorId && !ipAddress) {
      return res.status(400).json({ error: "visitorId or ipAddress is required" });
    }

    const blocked = await storage.createBlockedVisitor({
      visitorId,
      ipAddress,
      reason,
      blockedBy,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    // Remove from active visitors if blocked
    if (visitorId) {
      const visitor = await storage.getActiveVisitorByVisitorId(visitorId);
      if (visitor) {
        await storage.deleteActiveVisitor(visitor.id);
      }
    }

    res.json(blocked);
  } catch (error) {
    warnOnce("visitors:block-visitor-error", "Block visitor error:", error);
    res.status(500).json({ error: "Failed to block visitor" });
  }
});

// Get blocked visitors
router.get("/blocked/list", checkAdminAuth, async (req, res) => {
  try {
    const blocked = await storage.getBlockedVisitors();
    res.json(blocked);
  } catch (error) {
    warnOnce("visitors:get-blocked-visitors-error", "Get blocked visitors error:", error);
    res.status(500).json({ error: "Failed to get blocked visitors" });
  }
});

// Unblock visitor
router.delete("/blocked/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteBlockedVisitor(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    warnOnce("visitors:unblock-visitor-error", "Unblock visitor error:", error);
    res.status(500).json({ error: "Failed to unblock visitor" });
  }
});

// Check if visitor is blocked
router.get("/blocked/check/:visitorId", checkAdminAuth, async (req, res) => {
  try {
    const isBlocked = await storage.isVisitorBlocked(req.params.visitorId);
    res.json({ blocked: isBlocked });
  } catch (error) {
    warnOnce("visitors:check-blocked-error", "Check blocked error:", error);
    res.status(500).json({ error: "Failed to check blocked status" });
  }
});

// Cleanup stale sessions (older than STALE_VISITOR_TIMEOUT_MS without heartbeat)
router.post("/cleanup", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.cleanupStaleVisitors(STALE_VISITOR_TIMEOUT_MS);
    res.json({ success: true, cleaned: count });
  } catch (error) {
    warnOnce("visitors:cleanup-error", "Cleanup error:", error);
    res.status(500).json({ error: "Failed to cleanup stale visitors" });
  }
});

// Get dashboard stats
router.get("/stats/dashboard", checkAdminAuth, async (req, res) => {
  try {
    const activeCount = await storage.getActiveVisitorCount();
    const todayStats = await storage.getTodayVisitorStats();
    
    res.json({
      activeVisitors: activeCount,
      todayVisitors: todayStats.totalVisitors,
      todayChats: todayStats.totalChats,
      avgSessionDuration: todayStats.avgSessionDuration,
    });
  } catch (error) {
    warnOnce("visitors:get-dashboard-stats-error", "Get dashboard stats error:", error);
    res.status(500).json({ error: "Failed to get dashboard stats" });
  }
});

// Proactive chat initiation - admin sends first message to visitor
router.post("/:visitorId/initiate-chat", checkAdminAuth, async (req, res) => {
  try {
    const { message, greeting } = req.body;
    const visitorId = req.params.visitorId;

    if (!message && !greeting) {
      return res.status(400).json({ error: "Message or greeting is required" });
    }

    const visitor = await storage.getActiveVisitorByVisitorId(visitorId);
    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    // Update visitor to indicate active chat
    await storage.updateActiveVisitor(visitor.id, {
      hasActiveChat: true,
      proactiveGreeting: message || greeting,
    });

    // If visitor has a case, send message to that case.
    // Verify the caseId actually exists in the database before writing —
    // defense in depth against any pre-existing spoofed active_visitors rows
    // that may have been created before this fix was deployed.
    if (visitor.caseId) {
      const linkedCase = await storage.getCaseById(visitor.caseId);
      if (linkedCase) {
        await storage.createChatMessage({
          caseId: visitor.caseId,
          sender: 'admin',
          message: message || greeting,
          isRead: 'false',
        });
      }
    }

    res.json({ 
      success: true, 
      visitorId,
      caseId: visitor.caseId,
      message: message || greeting 
    });
  } catch (error) {
    warnOnce("visitors:initiate-chat-error", "Initiate chat error:", error);
    res.status(500).json({ error: "Failed to initiate chat" });
  }
});

// ==================== OFFLINE MESSAGES ====================

// Submit offline message (when no agents available).
// Only the fields a public visitor can legitimately supply are accepted;
// internal workflow fields (status, repliedBy, repliedAt, caseId) are
// always set server-side so callers cannot forge ticket state.
const publicOfflineMessageSchema = insertOfflineMessageSchema.pick({
  name: true,
  email: true,
  phone: true,
  subject: true,
  message: true,
});

router.post(
  "/offline-messages",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_OFFLINE_MSG_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const parseResult = publicOfflineMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const message = await storage.createOfflineMessage({
      ...parseResult.data,
      status: "new",
    });
    res.status(201).json(message);
  } catch (error) {
    warnOnce("visitors:create-offline-message-error", "Create offline message error:", error);
    res.status(500).json({ error: "Failed to create offline message" });
  }
});

// Get all offline messages (admin only)
router.get("/offline-messages", checkAdminAuth, async (req, res) => {
  try {
    const messages = await storage.getAllOfflineMessages();
    res.json(messages);
  } catch (error) {
    warnOnce("visitors:get-offline-messages-error", "Get offline messages error:", error);
    res.status(500).json({ error: "Failed to get offline messages" });
  }
});

// Get offline messages count (admin only)
router.get("/offline-messages/count", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.getUnreadOfflineMessagesCount();
    res.json({ count });
  } catch (error) {
    warnOnce("visitors:get-offline-messages-count-error", "Get offline messages count error:", error);
    res.status(500).json({ error: "Failed to get offline messages count" });
  }
});

// Get single offline message (admin only)
router.get("/offline-messages/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const message = await storage.getOfflineMessageById(id);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(message);
  } catch (error) {
    warnOnce("visitors:get-offline-message-error", "Get offline message error:", error);
    res.status(500).json({ error: "Failed to get offline message" });
  }
});

// Update offline message status (admin only)
router.patch("/offline-messages/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const { status, repliedBy } = req.body;
    const updateData: any = { status };
    
    if (status === 'replied' && repliedBy) {
      updateData.repliedBy = repliedBy;
      updateData.repliedAt = new Date();
    }

    const message = await storage.updateOfflineMessage(id, updateData);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(message);
  } catch (error) {
    warnOnce("visitors:update-offline-message-error", "Update offline message error:", error);
    res.status(500).json({ error: "Failed to update offline message" });
  }
});

// Delete offline message (admin only)
router.delete("/offline-messages/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    await storage.deleteOfflineMessage(id);
    res.json({ success: true });
  } catch (error) {
    warnOnce("visitors:delete-offline-message-error", "Delete offline message error:", error);
    res.status(500).json({ error: "Failed to delete offline message" });
  }
});


// ==================== SATISFACTION RATINGS ====================

// Submit satisfaction rating (user after chat).
// adminUsername is stripped and never accepted from public callers.
// visitorId is mandatory: the visitor must have a server-recorded chat
// session (active_visitors.hasActiveChat=true or visitor_history.hadChat=true)
// associated with the stated caseId. This validation uses server-written records
// that cannot be forged via the public heartbeat (hasActiveChat is only set by
// the admin-initiated chat flow; hadChat is written at session-end). One rating
// per visitorId+caseId is enforced to bound metric-spam potential.
const publicSatisfactionRatingSchema = insertChatSatisfactionRatingSchema
  .omit({ adminUsername: true })
  .extend({
    visitorId: insertChatSatisfactionRatingSchema.shape.visitorId.unwrap().unwrap(),
    // Optional signed token issued at chat-end (end-session response).
    // When present and valid the DB read for chat-eligibility is skipped,
    // limiting the attack surface from IP-rotating bots.
    satToken: insertChatSatisfactionRatingSchema.shape.visitorId
      .unwrap()
      .unwrap()
      .optional(),
  });

router.post(
  "/satisfaction",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_SATISFACTION_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const parseResult = publicSatisfactionRatingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { visitorId, caseId, satToken, ...ratingFields } = parseResult.data;

    // Verify that this visitor actually participated in a chat on this case.
    // Fast path: validate the signed token issued at session-end (no DB read).
    // Slow path: fall back to the DB check for clients without a token.
    if (satToken !== undefined) {
      const verifyResult = verifySatisfactionToken(satToken, visitorId, caseId);
      if (!verifyResult.ok) {
        return res.status(403).json({ error: "No chat session found for this visitor and case" });
      }
      // Signature/expiry/binding are valid, but that alone doesn't prove the
      // token hasn't already been redeemed (e.g. replayed after a
      // SESSION_SECRET rotation, or simply resubmitted). Atomically claim the
      // embedded nonce — a DB primary-key insert that only one caller across
      // the whole autoscale fleet can win — before treating the request as
      // eligible.
      const claimed = await storage.claimSatisfactionTokenNonce(
        verifyResult.nonce,
        verifyResult.expiresAt,
      );
      if (!claimed) {
        return res.status(409).json({ error: "This satisfaction link has already been used" });
      }
    } else {
      // Legacy / token-less path: still supported for backward compatibility.
      // hasActiveChat is set only by the admin-initiated chat flow; hadChat is
      // written server-side at session-end. Neither can be forged by the public
      // heartbeat since that path no longer overwrites caseId on existing rows
      // and hasActiveChat/hadChat are never touched by the public heartbeat.
      const hadChat = await storage.visitorHadChatForCase(visitorId, caseId);
      if (!hadChat) {
        return res.status(403).json({ error: "No chat session found for this visitor and case" });
      }
    }

    // One rating per visitor per case — prevent repeated low-rating spam.
    const alreadyRated = await storage.satisfactionRatingExistsForVisitorCase(visitorId, caseId);
    if (alreadyRated) {
      return res.status(409).json({ error: "Rating already submitted for this session" });
    }

    const rating = await storage.createChatSatisfactionRating({ ...ratingFields, visitorId, caseId });
    res.status(201).json(rating);
  } catch (error) {
    warnOnce("visitors:create-satisfaction-rating-error", "Create satisfaction rating error:", error);
    res.status(500).json({ error: "Failed to create satisfaction rating" });
  }
});

// Typing indicator - set typing status
router.post(
  "/typing",
  rateLimiter(TYPING_RATE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_TYPING_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const { caseId, sender, isTyping } = req.body;

    if (!caseId || !sender) {
      return res.status(400).json({ error: "caseId and sender are required" });
    }

    // Validate sender to the known set of values so the key space is bounded
    // and attacker-supplied values cannot produce unbounded unique map keys.
    if (sender !== 'user' && sender !== 'admin') {
      return res.status(400).json({ error: "sender must be 'user' or 'admin'" });
    }

    const key = `${caseId}_${sender}`;
    
    if (isTyping) {
      // Enforce a hard cap on the map size. If the cap is reached, reject new
      // entries to prevent an attacker from exhausting process memory by
      // submitting many unique caseId values. The per-IP rate limiter still
      // runs upstream, but this cap is the last line of defence against
      // distributed sources or rotating proxies.
      if (!typingIndicators.has(key) && typingIndicators.size >= TYPING_INDICATORS_MAX) {
        return res.status(429).json({ error: "Too many active typing indicators" });
      }
      typingIndicators.set(key, {
        caseId,
        sender,
        timestamp: Date.now(),
      });
    } else {
      typingIndicators.delete(key);
    }

    res.json({ success: true });
  } catch (error) {
    warnOnce("visitors:typing-indicator-error", "Typing indicator error:", error);
    res.status(500).json({ error: "Failed to update typing indicator" });
  }
});

// Get typing status for a case
router.get(
  "/typing/:caseId",
  rateLimiter(TYPING_RATE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: VISITOR_TYPING_GET_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
  try {
    const { caseId } = req.params;
    const now = Date.now();
    
    const typingUsers: { sender: 'user' | 'admin' }[] = [];
    
    for (const [_key, value] of typingIndicators.entries()) {
      if (value.caseId === caseId && now - value.timestamp < 3000) {
        typingUsers.push({ sender: value.sender });
      }
    }

    res.json({ typing: typingUsers });
  } catch (error) {
    warnOnce("visitors:get-typing-status-error", "Get typing status error:", error);
    res.status(500).json({ error: "Failed to get typing status" });
  }
});

export default router;
