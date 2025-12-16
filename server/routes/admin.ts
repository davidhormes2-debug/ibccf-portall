import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth, ADMIN_TOKEN } from "./middleware";

export const adminRouter = Router();

adminRouter.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === "Admin2025" && password === "Admin123456789") {
      res.json({ success: true, token: ADMIN_TOKEN });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

adminRouter.get("/verify", checkAdminAuth, (req, res) => {
  res.json({ valid: true });
});

export const auditLogsRouter = Router();

auditLogsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const logs = await storage.getAllAuditLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

export const adminSessionsRouter = Router();

adminSessionsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const sessions = await storage.getActiveAdminSessions('Admin2025');
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch admin sessions" });
  }
});

adminSessionsRouter.post("/", async (req, res) => {
  try {
    const sessionInput = z.object({
      adminUsername: z.string().min(1),
      token: z.string().min(1),
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
      location: z.string().optional(),
      expiresAt: z.string().optional()
    }).parse(req.body);

    const session = await storage.createAdminSession({
      ...sessionInput,
      expiresAt: sessionInput.expiresAt ? new Date(sessionInput.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    res.json(session);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create admin session" });
    }
  }
});

adminSessionsRouter.post("/:id/revoke", checkAdminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    await storage.revokeAdminSession(req.params.id, reason || 'Manual revocation');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to revoke session" });
  }
});

export const notificationsRouter = Router();

notificationsRouter.get("/admin", checkAdminAuth, async (req, res) => {
  try {
    const notifications = await storage.getNotificationsByRecipient('admin', 'admin');
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.get("/case/:caseId", async (req, res) => {
  try {
    const notifications = await storage.getNotificationsByRecipient('user', req.params.caseId);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const notificationInput = z.object({
      recipientType: z.enum(['admin', 'user']),
      recipientId: z.string().optional(),
      type: z.string().min(1),
      title: z.string().min(1),
      body: z.string().optional(),
      link: z.string().optional(),
      metadata: z.string().optional()
    }).parse(req.body);

    const notification = await storage.createNotification(notificationInput);
    res.json(notification);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create notification" });
    }
  }
});

notificationsRouter.post("/:id/read", async (req, res) => {
  try {
    await storage.markNotificationAsRead(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

notificationsRouter.get("/admin/unread", checkAdminAuth, async (req, res) => {
  try {
    const count = await storage.getUnreadNotificationCount('admin', 'admin');
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

export const userSessionsRouter = Router();

userSessionsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const allSessions = await storage.getAllUserSessions();
    res.json(allSessions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user sessions" });
  }
});

userSessionsRouter.post("/:id/deactivate", checkAdminAuth, async (req, res) => {
  try {
    const session = await storage.deactivateUserSession(parseInt(req.params.id));
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: "Failed to deactivate session" });
  }
});

export function registerCaseSessionRoutes(router: Router) {
  router.get("/:id/sessions", checkAdminAuth, async (req, res) => {
    try {
      const sessions = await storage.getUserSessionsByCaseId(req.params.id);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  });

  router.post("/:id/sessions", async (req, res) => {
    try {
      const sessionInput = z.object({
        sessionToken: z.string().min(1),
        ipAddress: z.string().optional(),
        userAgent: z.string().optional(),
        location: z.string().optional(),
        expiresAt: z.string().optional()
      }).parse(req.body);

      const session = await storage.createUserSession({
        caseId: req.params.id,
        ...sessionInput,
        expiresAt: sessionInput.expiresAt ? new Date(sessionInput.expiresAt) : undefined
      });
      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create user session" });
      }
    }
  });
}

export const twoFactorRouter = Router();

twoFactorRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const config = await storage.getAdminTwoFactor('Admin2025');
    res.json(config || { isEnabled: false });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch 2FA config" });
  }
});

twoFactorRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const configInput = z.object({
      adminUsername: z.string().min(1),
      secret: z.string().min(1),
      backupCodes: z.string().optional()
    }).parse(req.body);

    const config = await storage.createAdminTwoFactor(configInput);
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to create 2FA config" });
    }
  }
});

twoFactorRouter.patch("/", checkAdminAuth, async (req, res) => {
  try {
    const configInput = z.object({
      isEnabled: z.boolean().optional(),
      backupCodes: z.string().optional()
    }).parse(req.body);

    const config = await storage.updateAdminTwoFactor('Admin2025', configInput);
    if (!config) {
      res.status(404).json({ error: "2FA config not found" });
      return;
    }
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update 2FA config" });
    }
  }
});
