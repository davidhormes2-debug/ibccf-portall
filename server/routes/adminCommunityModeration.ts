import { Router } from "express";
import { db } from "../db";
import {
  communityKeywordBlocklist,
  communityPosts,
  communityThreads,
} from "@shared/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { checkAdminAuth } from "./middleware";
import { storage } from "../storage";
import { invalidateModerationCache } from "../services/communityModeration";
import { warnOnce } from "../lib/warnOnce";
import type { Request } from "express";

export const adminCommunityModerationRouter = Router();

function getAdminUsername(req: Request): string {
  return (req as Request & { adminUsername?: string }).adminUsername ?? "admin";
}

// ---------------------------------------------------------------------------
// Keyword blocklist management
// GET  /api/admin/community/keywords        — list all keywords
// POST /api/admin/community/keywords        — add a keyword
// PATCH /api/admin/community/keywords/:id   — enable/disable
// DELETE /api/admin/community/keywords/:id  — remove
// ---------------------------------------------------------------------------

adminCommunityModerationRouter.get(
  "/keywords",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(communityKeywordBlocklist)
        .orderBy(desc(communityKeywordBlocklist.createdAt));
      res.json(rows);
    } catch (err) {
      warnOnce("admin:community-keywords-list-fail", "Error listing keywords:", err);
      res.status(500).json({ error: "Failed to fetch keyword blocklist" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/keywords",
  checkAdminAuth,
  async (req, res) => {
    try {
      const { pattern, isWildcard } = req.body;
      if (!pattern || typeof pattern !== "string" || pattern.trim().length === 0) {
        return res.status(400).json({ error: "pattern is required" });
      }

      const [inserted] = await db
        .insert(communityKeywordBlocklist)
        .values({
          pattern: pattern.trim(),
          isWildcard: Boolean(isWildcard),
          isActive: true,
          createdBy: getAdminUsername(req),
        })
        .returning();

      invalidateModerationCache();

      await storage.createAuditLog({
        action: "community_keyword_added",
        adminUsername: getAdminUsername(req),
        targetType: "community_keyword",
        targetId: String(inserted.id),
        newValue: JSON.stringify({ pattern: inserted.pattern, isWildcard: inserted.isWildcard }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.status(201).json(inserted);
    } catch (err) {
      warnOnce("admin:community-keywords-add-fail", "Error adding keyword:", err);
      res.status(500).json({ error: "Failed to add keyword" });
    }
  },
);

adminCommunityModerationRouter.patch(
  "/keywords/:id",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ error: "isActive (boolean) is required" });
      }

      const [updated] = await db
        .update(communityKeywordBlocklist)
        .set({ isActive })
        .where(eq(communityKeywordBlocklist.id, id))
        .returning();

      if (!updated) return res.status(404).json({ error: "Keyword not found" });

      invalidateModerationCache();

      await storage.createAuditLog({
        action: isActive ? "community_keyword_enabled" : "community_keyword_disabled",
        adminUsername: getAdminUsername(req),
        targetType: "community_keyword",
        targetId: String(id),
        newValue: JSON.stringify({ isActive }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json(updated);
    } catch (err) {
      warnOnce("admin:community-keywords-patch-fail", "Error updating keyword:", err);
      res.status(500).json({ error: "Failed to update keyword" });
    }
  },
);

adminCommunityModerationRouter.delete(
  "/keywords/:id",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [deleted] = await db
        .delete(communityKeywordBlocklist)
        .where(eq(communityKeywordBlocklist.id, id))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Keyword not found" });

      invalidateModerationCache();

      await storage.createAuditLog({
        action: "community_keyword_removed",
        adminUsername: getAdminUsername(req),
        targetType: "community_keyword",
        targetId: String(id),
        previousValue: JSON.stringify({ pattern: deleted.pattern, isWildcard: deleted.isWildcard }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true });
    } catch (err) {
      warnOnce("admin:community-keywords-delete-fail", "Error deleting keyword:", err);
      res.status(500).json({ error: "Failed to delete keyword" });
    }
  },
);

// ---------------------------------------------------------------------------
// Flagged content review queue
// GET  /api/admin/community/flagged                         — list all flagged posts + threads
// POST /api/admin/community/flagged/posts/:id/approve
// POST /api/admin/community/flagged/posts/:id/remove
// POST /api/admin/community/flagged/threads/:id/approve
// POST /api/admin/community/flagged/threads/:id/remove
// POST /api/admin/community/flagged/posts/bulk-approve      — bulk approve by ids[]
// POST /api/admin/community/flagged/posts/bulk-remove       — bulk remove by ids[]
// POST /api/admin/community/flagged/threads/bulk-approve    — bulk approve by ids[]
// POST /api/admin/community/flagged/threads/bulk-remove     — bulk remove by ids[]
// ---------------------------------------------------------------------------

adminCommunityModerationRouter.get(
  "/flagged",
  checkAdminAuth,
  async (_req, res) => {
    try {
      const [flaggedPosts, flaggedThreads] = await Promise.all([
        db
          .select()
          .from(communityPosts)
          .where(eq(communityPosts.isFlagged, true))
          .orderBy(desc(communityPosts.createdAt)),
        db
          .select()
          .from(communityThreads)
          .where(eq(communityThreads.isFlagged, true))
          .orderBy(desc(communityThreads.createdAt)),
      ]);
      res.json({ posts: flaggedPosts, threads: flaggedThreads });
    } catch (err) {
      warnOnce("admin:community-flagged-list-fail", "Error listing flagged content:", err);
      res.status(500).json({ error: "Failed to fetch flagged content" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/posts/:id/approve",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [updated] = await db
        .update(communityPosts)
        .set({ isFlagged: false, flagReason: null })
        .where(and(eq(communityPosts.id, id), eq(communityPosts.isFlagged, true)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Flagged post not found" });

      await storage.createAuditLog({
        action: "community_flagged_post_approved",
        adminUsername: getAdminUsername(req),
        targetType: "community_post",
        targetId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json(updated);
    } catch (err) {
      warnOnce("admin:community-flagged-post-approve-fail", "Error approving post:", err);
      res.status(500).json({ error: "Failed to approve post" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/posts/:id/remove",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [deleted] = await db
        .delete(communityPosts)
        .where(and(eq(communityPosts.id, id), eq(communityPosts.isFlagged, true)))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Flagged post not found" });

      await storage.createAuditLog({
        action: "community_flagged_post_removed",
        adminUsername: getAdminUsername(req),
        targetType: "community_post",
        targetId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true });
    } catch (err) {
      warnOnce("admin:community-flagged-post-remove-fail", "Error removing flagged post:", err);
      res.status(500).json({ error: "Failed to remove post" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/threads/:id/approve",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const [updated] = await db
        .update(communityThreads)
        .set({ isFlagged: false, flagReason: null })
        .where(and(eq(communityThreads.id, id), eq(communityThreads.isFlagged, true)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Flagged thread not found" });

      await storage.createAuditLog({
        action: "community_flagged_thread_approved",
        adminUsername: getAdminUsername(req),
        targetType: "community_thread",
        targetId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json(updated);
    } catch (err) {
      warnOnce("admin:community-flagged-thread-approve-fail", "Error approving thread:", err);
      res.status(500).json({ error: "Failed to approve thread" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/threads/:id/remove",
  checkAdminAuth,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      // Verify the thread exists and is flagged BEFORE touching any child rows.
      // This prevents data loss if the caller supplies an unflagged thread ID.
      const [target] = await db
        .select({ id: communityThreads.id })
        .from(communityThreads)
        .where(and(eq(communityThreads.id, id), eq(communityThreads.isFlagged, true)));

      if (!target) return res.status(404).json({ error: "Flagged thread not found" });

      // Safe to cascade-delete now that we've confirmed the thread is flagged.
      await db.delete(communityPosts).where(eq(communityPosts.threadId, id));

      await db
        .delete(communityThreads)
        .where(eq(communityThreads.id, id));

      await storage.createAuditLog({
        action: "community_flagged_thread_removed",
        adminUsername: getAdminUsername(req),
        targetType: "community_thread",
        targetId: String(id),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true });
    } catch (err) {
      warnOnce("admin:community-flagged-thread-remove-fail", "Error removing flagged thread:", err);
      res.status(500).json({ error: "Failed to remove thread" });
    }
  },
);

// ---------------------------------------------------------------------------
// Bulk actions on flagged content
// ---------------------------------------------------------------------------

adminCommunityModerationRouter.post(
  "/flagged/posts/bulk-approve",
  checkAdminAuth,
  async (req, res) => {
    try {
      const ids: unknown = req.body.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const numericIds = ids.map(Number).filter((n) => !isNaN(n));
      if (numericIds.length === 0) {
        return res.status(400).json({ error: "ids must contain valid numbers" });
      }

      await db
        .update(communityPosts)
        .set({ isFlagged: false, flagReason: null })
        .where(and(inArray(communityPosts.id, numericIds), eq(communityPosts.isFlagged, true)));

      await storage.createAuditLog({
        action: "community_flagged_posts_bulk_approved",
        adminUsername: getAdminUsername(req),
        targetType: "community_post",
        targetId: numericIds.join(","),
        newValue: JSON.stringify({ count: numericIds.length }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true, count: numericIds.length });
    } catch (err) {
      warnOnce("admin:community-flagged-posts-bulk-approve-fail", "Error bulk-approving posts:", err);
      res.status(500).json({ error: "Failed to bulk approve posts" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/posts/bulk-remove",
  checkAdminAuth,
  async (req, res) => {
    try {
      const ids: unknown = req.body.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const numericIds = ids.map(Number).filter((n) => !isNaN(n));
      if (numericIds.length === 0) {
        return res.status(400).json({ error: "ids must contain valid numbers" });
      }

      await db
        .delete(communityPosts)
        .where(and(inArray(communityPosts.id, numericIds), eq(communityPosts.isFlagged, true)));

      await storage.createAuditLog({
        action: "community_flagged_posts_bulk_removed",
        adminUsername: getAdminUsername(req),
        targetType: "community_post",
        targetId: numericIds.join(","),
        newValue: JSON.stringify({ count: numericIds.length }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true, count: numericIds.length });
    } catch (err) {
      warnOnce("admin:community-flagged-posts-bulk-remove-fail", "Error bulk-removing posts:", err);
      res.status(500).json({ error: "Failed to bulk remove posts" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/threads/bulk-approve",
  checkAdminAuth,
  async (req, res) => {
    try {
      const ids: unknown = req.body.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const numericIds = ids.map(Number).filter((n) => !isNaN(n));
      if (numericIds.length === 0) {
        return res.status(400).json({ error: "ids must contain valid numbers" });
      }

      await db
        .update(communityThreads)
        .set({ isFlagged: false, flagReason: null })
        .where(and(inArray(communityThreads.id, numericIds), eq(communityThreads.isFlagged, true)));

      await storage.createAuditLog({
        action: "community_flagged_threads_bulk_approved",
        adminUsername: getAdminUsername(req),
        targetType: "community_thread",
        targetId: numericIds.join(","),
        newValue: JSON.stringify({ count: numericIds.length }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true, count: numericIds.length });
    } catch (err) {
      warnOnce("admin:community-flagged-threads-bulk-approve-fail", "Error bulk-approving threads:", err);
      res.status(500).json({ error: "Failed to bulk approve threads" });
    }
  },
);

adminCommunityModerationRouter.post(
  "/flagged/threads/bulk-remove",
  checkAdminAuth,
  async (req, res) => {
    try {
      const ids: unknown = req.body.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids must be a non-empty array" });
      }
      const numericIds = ids.map(Number).filter((n) => !isNaN(n));
      if (numericIds.length === 0) {
        return res.status(400).json({ error: "ids must contain valid numbers" });
      }

      // Verify threads are flagged before cascading deletes.
      const flaggedThreads = await db
        .select({ id: communityThreads.id })
        .from(communityThreads)
        .where(and(inArray(communityThreads.id, numericIds), eq(communityThreads.isFlagged, true)));

      const confirmedIds = flaggedThreads.map((t) => t.id);
      if (confirmedIds.length === 0) {
        return res.status(404).json({ error: "No matching flagged threads found" });
      }

      // Cascade-delete child posts then the threads themselves.
      await db.delete(communityPosts).where(inArray(communityPosts.threadId, confirmedIds));
      await db.delete(communityThreads).where(inArray(communityThreads.id, confirmedIds));

      await storage.createAuditLog({
        action: "community_flagged_threads_bulk_removed",
        adminUsername: getAdminUsername(req),
        targetType: "community_thread",
        targetId: confirmedIds.join(","),
        newValue: JSON.stringify({ count: confirmedIds.length }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500),
      });

      res.json({ ok: true, count: confirmedIds.length });
    } catch (err) {
      warnOnce("admin:community-flagged-threads-bulk-remove-fail", "Error bulk-removing threads:", err);
      res.status(500).json({ error: "Failed to bulk remove threads" });
    }
  },
);
