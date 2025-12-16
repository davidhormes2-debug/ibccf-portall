import { Router } from "express";
import { storage } from "../storage";
import { insertActiveVisitorSchema, insertVisitorHistorySchema, insertBlockedVisitorSchema, insertOfflineMessageSchema, insertChatSatisfactionRatingSchema } from "@shared/schema";
import { checkAdminAuth } from "./middleware";

const router = Router();

// Heartbeat - update visitor activity
router.post("/heartbeat", async (req, res) => {
  try {
    const {
      visitorId,
      caseId,
      currentPage,
      pageTitle,
      referrer,
      deviceType,
      browser,
      os,
      screenResolution,
      isIdle,
    } = req.body;

    if (!visitorId) {
      return res.status(400).json({ error: "visitorId is required" });
    }

    // Get IP and location from request
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';

    // Check if visitor exists
    const existingVisitor = await storage.getActiveVisitorByVisitorId(visitorId);

    if (existingVisitor) {
      // Update existing visitor
      const pagesViewed = existingVisitor.pagesViewed ? JSON.parse(existingVisitor.pagesViewed) : [];
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
        lastHeartbeatAt: new Date(),
        caseId: caseId || existingVisitor.caseId,
      });

      res.json({ success: true, visitorId, isNew: false });
    } else {
      // Create new visitor
      const newVisitor = await storage.createActiveVisitor({
        visitorId,
        caseId,
        currentPage,
        pageTitle,
        referrer,
        deviceType,
        browser,
        os,
        screenResolution,
        ipAddress,
        pagesViewed: JSON.stringify([currentPage].filter(Boolean)),
        pageViewCount: 1,
        isIdle: false,
        engagementScore: 10,
        sessionStartedAt: new Date(),
        lastHeartbeatAt: new Date(),
      });

      res.json({ success: true, visitorId, isNew: true, id: newVisitor.id });
    }
  } catch (error) {
    console.error("Heartbeat error:", error);
    res.status(500).json({ error: "Failed to process heartbeat" });
  }
});

// End session - visitor leaving
router.post("/end-session", async (req, res) => {
  try {
    const { visitorId } = req.body;

    if (!visitorId) {
      return res.status(400).json({ error: "visitorId is required" });
    }

    const visitor = await storage.getActiveVisitorByVisitorId(visitorId);

    if (visitor) {
      // Save to history
      const sessionDuration = Math.floor(
        (new Date().getTime() - new Date(visitor.sessionStartedAt).getTime()) / 1000
      );

      await storage.createVisitorHistory({
        visitorId: visitor.visitorId,
        caseId: visitor.caseId,
        pagesViewed: visitor.pagesViewed,
        pageViewCount: visitor.pageViewCount || 0,
        sessionDuration,
        deviceType: visitor.deviceType,
        browser: visitor.browser,
        country: visitor.country,
        city: visitor.city,
        hadChat: visitor.hasActiveChat || false,
        sessionStartedAt: visitor.sessionStartedAt,
        sessionEndedAt: new Date(),
      });

      // Remove from active visitors
      await storage.deleteActiveVisitor(visitor.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("End session error:", error);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Get all active visitors (admin)
router.get("/active", async (req, res) => {
  try {
    const visitors = await storage.getActiveVisitors();
    res.json(visitors);
  } catch (error) {
    console.error("Get active visitors error:", error);
    res.status(500).json({ error: "Failed to get active visitors" });
  }
});

// Get active visitor count
router.get("/count", async (req, res) => {
  try {
    const count = await storage.getActiveVisitorCount();
    res.json({ count });
  } catch (error) {
    console.error("Get visitor count error:", error);
    res.status(500).json({ error: "Failed to get visitor count" });
  }
});

// Get visitor by ID
router.get("/:visitorId", async (req, res) => {
  try {
    const visitor = await storage.getActiveVisitorByVisitorId(req.params.visitorId);
    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }
    res.json(visitor);
  } catch (error) {
    console.error("Get visitor error:", error);
    res.status(500).json({ error: "Failed to get visitor" });
  }
});

// Get visitor history
router.get("/:visitorId/history", async (req, res) => {
  try {
    const history = await storage.getVisitorHistory(req.params.visitorId);
    res.json(history);
  } catch (error) {
    console.error("Get visitor history error:", error);
    res.status(500).json({ error: "Failed to get visitor history" });
  }
});

// Block visitor
router.post("/block", async (req, res) => {
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
    console.error("Block visitor error:", error);
    res.status(500).json({ error: "Failed to block visitor" });
  }
});

// Get blocked visitors
router.get("/blocked/list", async (req, res) => {
  try {
    const blocked = await storage.getBlockedVisitors();
    res.json(blocked);
  } catch (error) {
    console.error("Get blocked visitors error:", error);
    res.status(500).json({ error: "Failed to get blocked visitors" });
  }
});

// Unblock visitor
router.delete("/blocked/:id", async (req, res) => {
  try {
    await storage.deleteBlockedVisitor(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Unblock visitor error:", error);
    res.status(500).json({ error: "Failed to unblock visitor" });
  }
});

// Check if visitor is blocked
router.get("/blocked/check/:visitorId", async (req, res) => {
  try {
    const isBlocked = await storage.isVisitorBlocked(req.params.visitorId);
    res.json({ blocked: isBlocked });
  } catch (error) {
    console.error("Check blocked error:", error);
    res.status(500).json({ error: "Failed to check blocked status" });
  }
});

// Cleanup stale sessions (older than 30 seconds without heartbeat)
router.post("/cleanup", async (req, res) => {
  try {
    const staleTimeout = 30 * 1000; // 30 seconds
    const count = await storage.cleanupStaleVisitors(staleTimeout);
    res.json({ success: true, cleaned: count });
  } catch (error) {
    console.error("Cleanup error:", error);
    res.status(500).json({ error: "Failed to cleanup stale visitors" });
  }
});

// Get dashboard stats
router.get("/stats/dashboard", async (req, res) => {
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
    console.error("Get dashboard stats error:", error);
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

    // If visitor has a case, send message to that case
    if (visitor.caseId) {
      await storage.createChatMessage({
        caseId: visitor.caseId,
        sender: 'admin',
        message: message || greeting,
        isRead: 'false',
      });
    }

    res.json({ 
      success: true, 
      visitorId,
      caseId: visitor.caseId,
      message: message || greeting 
    });
  } catch (error) {
    console.error("Initiate chat error:", error);
    res.status(500).json({ error: "Failed to initiate chat" });
  }
});

// Add visitor note (internal admin notes about visitors)
router.post("/:visitorId/notes", checkAdminAuth, async (req, res) => {
  try {
    const { note, createdBy } = req.body;
    const visitorId = req.params.visitorId;

    if (!note) {
      return res.status(400).json({ error: "Note is required" });
    }

    const visitor = await storage.getActiveVisitorByVisitorId(visitorId);
    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    // Parse existing notes or create new array
    const existingNotes = visitor.notes ? JSON.parse(visitor.notes) : [];
    existingNotes.push({
      id: Date.now(),
      note,
      createdBy: createdBy || 'admin',
      createdAt: new Date().toISOString(),
    });

    await storage.updateActiveVisitor(visitor.id, {
      notes: JSON.stringify(existingNotes),
    });

    res.json({ success: true, notes: existingNotes });
  } catch (error) {
    console.error("Add note error:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// ==================== OFFLINE MESSAGES ====================

// Submit offline message (when no agents available)
router.post("/offline-messages", async (req, res) => {
  try {
    const parseResult = insertOfflineMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request data", details: parseResult.error.errors });
    }

    const message = await storage.createOfflineMessage(parseResult.data);
    res.status(201).json(message);
  } catch (error) {
    console.error("Create offline message error:", error);
    res.status(500).json({ error: "Failed to create offline message" });
  }
});

// Get all offline messages (admin only)
router.get("/offline-messages", checkAdminAuth, async (req, res) => {
  try {
    const messages = await storage.getAllOfflineMessages();
    res.json(messages);
  } catch (error) {
    console.error("Get offline messages error:", error);
    res.status(500).json({ error: "Failed to get offline messages" });
  }
});

// Get offline messages count (admin only)
router.get("/offline-messages/count", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.getUnreadOfflineMessagesCount();
    res.json({ count });
  } catch (error) {
    console.error("Get offline messages count error:", error);
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
    console.error("Get offline message error:", error);
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
    console.error("Update offline message error:", error);
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
    console.error("Delete offline message error:", error);
    res.status(500).json({ error: "Failed to delete offline message" });
  }
});

// Check agent availability (for frontend to show offline form)
router.get("/agent-status", async (req, res) => {
  try {
    // Check if any admin is online
    const availability = await storage.getAdminAvailability('Admin2025');
    const isOnline = availability?.isOnline || false;
    res.json({ isOnline, status: availability?.status || 'offline' });
  } catch (error) {
    console.error("Check agent status error:", error);
    res.status(500).json({ error: "Failed to check agent status" });
  }
});

// ==================== SATISFACTION RATINGS ====================

// Submit satisfaction rating (user after chat)
router.post("/satisfaction", async (req, res) => {
  try {
    const parseResult = insertChatSatisfactionRatingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request data", details: parseResult.error.errors });
    }

    const rating = await storage.createChatSatisfactionRating(parseResult.data);
    res.status(201).json(rating);
  } catch (error) {
    console.error("Create satisfaction rating error:", error);
    res.status(500).json({ error: "Failed to create satisfaction rating" });
  }
});

// Get all satisfaction ratings (admin only)
router.get("/satisfaction", checkAdminAuth, async (req, res) => {
  try {
    const ratings = await storage.getAllChatSatisfactionRatings();
    res.json(ratings);
  } catch (error) {
    console.error("Get satisfaction ratings error:", error);
    res.status(500).json({ error: "Failed to get satisfaction ratings" });
  }
});

// Get satisfaction ratings for a case
router.get("/satisfaction/case/:caseId", checkAdminAuth, async (req, res) => {
  try {
    const { caseId } = req.params;
    const ratings = await storage.getChatSatisfactionRatingsByCaseId(caseId);
    res.json(ratings);
  } catch (error) {
    console.error("Get case satisfaction ratings error:", error);
    res.status(500).json({ error: "Failed to get satisfaction ratings" });
  }
});

// Get average satisfaction rating (admin only)
router.get("/satisfaction/stats", checkAdminAuth, async (req, res) => {
  try {
    const stats = await storage.getAverageSatisfactionRating();
    res.json(stats);
  } catch (error) {
    console.error("Get satisfaction stats error:", error);
    res.status(500).json({ error: "Failed to get satisfaction stats" });
  }
});

export default router;
