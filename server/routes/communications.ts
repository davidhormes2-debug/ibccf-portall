import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { announcements, cases, type Announcement } from "@shared/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { checkAdminAuth } from "./middleware";
import { requireAdminRole } from "./adminPermissions";
import { emailService } from "../services/EmailService";
import { storage } from "../storage";
import { warnOnce } from "../lib/warnOnce";

function adminUserFromReq(req: Request): string {
  return (req as any).adminUsername || (req as any).admin?.username || "admin";
}

function ipFromReq(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff?.toString().split(",")[0];
  return (raw?.trim() || req.ip || req.socket?.remoteAddress || null) as
    | string
    | null;
}

export const communicationsRouter = Router();
export const announcementsPublicRouter = Router();

/* ------------------------------------------------------------------ */
/*  Recipients                                                         */
/* ------------------------------------------------------------------ */

communicationsRouter.get("/recipients", checkAdminAuth, requireAdminRole("agent"), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: cases.id,
        userName: cases.userName,
        userEmail: cases.userEmail,
        accessCode: cases.accessCode,
      })
      .from(cases)
      .where(isNotNull(cases.userEmail));

    const seen = new Set<string>();
    const recipients = rows
      .filter((r) => {
        const email = (r.userEmail || "").trim().toLowerCase();
        if (!email || seen.has(email)) return false;
        seen.add(email);
        return true;
      })
      .map((r) => ({
        id: r.id,
        name: r.userName || "Member",
        email: r.userEmail!,
        accessCode: r.accessCode,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(recipients);
  } catch (error) {
    warnOnce("comm:recipients", "[communications] recipients failed", error);
    res.status(500).json({ error: "Failed to load recipients" });
  }
});

/* ------------------------------------------------------------------ */
/*  Email a single user                                                */
/* ------------------------------------------------------------------ */

const emailSendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
});

communicationsRouter.post("/email-user", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  const parsed = emailSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid request" });
  }
  const { to, subject, body } = parsed.data;
  try {
    const result = await emailService.sendCustomEmail(to, subject, body);
    if (!result.success) {
      return res.status(502).json({ error: result.error || "Send failed" });
    }
    res.json({ success: true, sent: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[communications] email-user failed", error);
    res.status(500).json({ error: `Send failed: ${message}` });
  }
});

/* ------------------------------------------------------------------ */
/*  Bulk email                                                         */
/* ------------------------------------------------------------------ */

const bulkSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  audience: z.enum(["all"]).default("all"),
  testTo: z.string().email().optional(),
  // For full broadcasts (no testTo) the caller MUST send confirmBroadcast=true.
  // This is a safety rail against accidental mass-email triggers from bugs,
  // retried HTTP requests, or curl misuse — the UI sets it explicitly.
  confirmBroadcast: z.boolean().optional(),
});

// Per-admin cooldown so a stuck retry loop or accidental double-click can't
// fan out a second mass email within seconds of the first one.
const BROADCAST_COOLDOWN_MS = 60_000;
const lastBroadcastAt = new Map<string, number>();

communicationsRouter.post("/email-bulk", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid request" });
  }
  const { subject, body, testTo, confirmBroadcast } = parsed.data;

  if (testTo) {
    try {
      const result = await emailService.sendCustomEmail(testTo, subject, body);
      if (!result.success) {
        return res
          .status(502)
          .json({ error: result.error || "Send failed" });
      }
      return res.json({ success: true, sent: 1, mode: "test" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      console.error("[communications] bulk test send failed", error);
      return res.status(500).json({ error: `Send failed: ${message}` });
    }
  }

  if (!confirmBroadcast) {
    return res.status(400).json({
      error:
        "Confirmation required: send confirmBroadcast=true to fan out to all members.",
    });
  }

  const adminUsername = "admin";
  const lastAt = lastBroadcastAt.get(adminUsername) ?? 0;
  const sinceLast = Date.now() - lastAt;
  if (sinceLast < BROADCAST_COOLDOWN_MS) {
    const retryAfter = Math.ceil((BROADCAST_COOLDOWN_MS - sinceLast) / 1000);
    res.setHeader("Retry-After", retryAfter.toString());
    return res.status(429).json({
      error: `Broadcast cooldown active. Try again in ${retryAfter}s.`,
      retryAfter,
    });
  }
  lastBroadcastAt.set(adminUsername, Date.now());

  try {
    const rows = await db
      .select({ email: cases.userEmail })
      .from(cases)
      .where(isNotNull(cases.userEmail));

    const unique = Array.from(
      new Set(
        rows
          .map((r) => (r.email || "").trim().toLowerCase())
          .filter((e) => e.length > 0),
      ),
    );

    // Intentional operational audit log: records who triggered the broadcast,
    // how many recipients were targeted, and the subject line prefix so the
    // server log provides a searchable trail for post-send investigations.
    console.log(
      `[communications] broadcast initiated by "${adminUsername}" → ${unique.length} recipients (subject: "${subject.slice(0, 80)}")`,
    );

    let sent = 0;
    let failed = 0;
    const errors: { email: string; error: string }[] = [];

    for (const email of unique) {
      try {
        const result = await emailService.sendCustomEmail(email, subject, body);
        if (result.success) sent++;
        else {
          failed++;
          errors.push({ email, error: result.error || "Unknown" });
        }
      } catch (innerError) {
        failed++;
        errors.push({
          email,
          error:
            innerError instanceof Error
              ? innerError.message
              : "Unexpected SMTP error",
        });
      }
      // Modest pacing to avoid SMTP rate limits.
      await new Promise((r) => setTimeout(r, 150));
    }

    // Use 207 Multi-Status when the broadcast had partial failures, so callers
    // (and any future automation) can branch on status code, not just body.
    const statusCode = failed === 0 ? 200 : sent > 0 ? 207 : 502;

    res.status(statusCode).json({
      success: failed === 0,
      sent,
      failed,
      total: unique.length,
      errors: errors.slice(0, 25),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[communications] email-bulk failed", error);
    res.status(500).json({ error: `Broadcast failed: ${message}` });
  }
});

/* ------------------------------------------------------------------ */
/*  Announcements (admin)                                              */
/* ------------------------------------------------------------------ */

const announcementInputSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  type: z.enum(["info", "success", "warning", "critical"]).default("info"),
  active: z.boolean().default(true),
  expiresAt: z
    .union([z.string().datetime(), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? new Date(v as string) : null)),
});

communicationsRouter.get("/announcements", checkAdminAuth, async (_req, res) => {
  try {
    const items = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));
    res.json(items);
  } catch (error) {
    warnOnce("comm:list-announcements", "[communications] list announcements failed", error);
    res.status(500).json({ error: "Failed to list announcements" });
  }
});

communicationsRouter.post("/announcements", checkAdminAuth, requireAdminRole("admin"), async (req, res) => {
  const parsed = announcementInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid request" });
  }
  try {
    const adminUsername = adminUserFromReq(req);
    const created = await storage.runInTransaction(async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({
          title: parsed.data.title,
          message: parsed.data.message,
          type: parsed.data.type,
          active: parsed.data.active,
          expiresAt: parsed.data.expiresAt,
          createdBy: adminUsername,
        })
        .returning();
      await storage.createAuditLog(
        {
          adminUsername,
          action: "announcement_created",
          targetType: "announcement",
          targetId: row.id,
          newValue: JSON.stringify({
            title: row.title,
            type: row.type,
            active: row.active,
          }),
          ipAddress: ipFromReq(req),
          userAgent: req.headers["user-agent"]?.toString() ?? null,
        },
        tx,
      );
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    console.error("[communications] create announcement failed", error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
});

const announcementPatchSchema = announcementInputSchema.partial();

communicationsRouter.patch(
  "/announcements/:id",
  checkAdminAuth,
  requireAdminRole("admin"),
  async (req, res) => {
    const id = req.params.id;
    const parsed = announcementPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid request" });
    }
    try {
      const updates: Partial<Announcement> = {};
      if (parsed.data.title !== undefined) updates.title = parsed.data.title;
      if (parsed.data.message !== undefined) updates.message = parsed.data.message;
      if (parsed.data.type !== undefined) updates.type = parsed.data.type;
      if (parsed.data.active !== undefined) updates.active = parsed.data.active;
      if (parsed.data.expiresAt !== undefined)
        updates.expiresAt = parsed.data.expiresAt;

      const adminUsername = adminUserFromReq(req);
      const updated = await storage.runInTransaction(async (tx) => {
        const [row] = await tx
          .update(announcements)
          .set(updates)
          .where(eq(announcements.id, id))
          .returning();
        if (!row) return null;
        await storage.createAuditLog(
          {
            adminUsername,
            action: "announcement_updated",
            targetType: "announcement",
            targetId: id,
            newValue: JSON.stringify({ changedFields: Object.keys(updates) }),
            ipAddress: ipFromReq(req),
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return row;
      });
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (error) {
      console.error("[communications] update announcement failed", error);
      res.status(500).json({ error: "Failed to update announcement" });
    }
  },
);

communicationsRouter.delete(
  "/announcements/:id",
  checkAdminAuth,
  requireAdminRole("admin"),
  async (req, res) => {
    const id = req.params.id;
    try {
      const adminUsername = adminUserFromReq(req);
      const deleted = await storage.runInTransaction(async (tx) => {
        const [row] = await tx
          .delete(announcements)
          .where(eq(announcements.id, id))
          .returning();
        if (!row) return null;
        await storage.createAuditLog(
          {
            adminUsername,
            action: "announcement_deleted",
            targetType: "announcement",
            targetId: id,
            previousValue: JSON.stringify({ title: row.title, type: row.type }),
            ipAddress: ipFromReq(req),
            userAgent: req.headers["user-agent"]?.toString() ?? null,
          },
          tx,
        );
        return row;
      });
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("[communications] delete announcement failed", error);
      res.status(500).json({ error: "Failed to delete announcement" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  Public: active announcements                                       */
/* ------------------------------------------------------------------ */

announcementsPublicRouter.get("/active", async (_req, res) => {
  try {
    const now = new Date();
    const items = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.active, true),
          sql`(${announcements.expiresAt} IS NULL OR ${announcements.expiresAt} > ${now})`,
        ),
      )
      .orderBy(desc(announcements.createdAt))
      .limit(5);
    res.json(items);
  } catch (error) {
    warnOnce("comm:active-announcements", "[communications] active announcements failed", error);
    res.status(500).json({ error: "Failed to load announcements" });
  }
});
