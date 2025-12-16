import { Router } from "express";
import { db } from "../db";
import { 
  communityThreads, 
  communityPosts, 
  communityParticipants,
  communityReactions,
  botProfiles,
  departments
} from "@shared/schema";
import { eq, desc, asc, and, sql } from "drizzle-orm";

export const communityRouter = Router();

// Get all threads (public, paginated)
communityRouter.get("/threads", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;
    const offset = (page - 1) * limit;

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
      })
      .from(communityThreads);

    if (departmentId) {
      query = query.where(eq(communityThreads.departmentId, departmentId)) as typeof query;
    }

    const threads = await query
      .orderBy(desc(communityThreads.isPinned), desc(communityThreads.lastActivityAt))
      .limit(limit)
      .offset(offset);

    res.json(threads);
  } catch (error) {
    console.error("Error fetching threads:", error);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// Get single thread with posts
communityRouter.get("/threads/:id", async (req, res) => {
  try {
    const threadId = parseInt(req.params.id);
    
    // Get thread
    const [thread] = await db
      .select()
      .from(communityThreads)
      .where(eq(communityThreads.id, threadId));

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    // Increment view count
    await db
      .update(communityThreads)
      .set({ viewCount: String(parseInt(thread.viewCount || '0') + 1) })
      .where(eq(communityThreads.id, threadId));

    // Get posts
    const posts = await db
      .select()
      .from(communityPosts)
      .where(and(
        eq(communityPosts.threadId, threadId),
        eq(communityPosts.isHidden, false)
      ))
      .orderBy(asc(communityPosts.createdAt));

    res.json({ thread, posts });
  } catch (error) {
    console.error("Error fetching thread:", error);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// Create new thread (users, bots, or admins)
communityRouter.post("/threads", async (req, res) => {
  try {
    const { departmentId, title, content, participantId, authorHandle, authorType, isPinned } = req.body;

    // If admin/bot posting (with authorHandle provided directly)
    if (authorHandle) {
      const [newThread] = await db
        .insert(communityThreads)
        .values({
          departmentId,
          title,
          content,
          authorType: authorType || 'user',
          authorHandle,
          isPinned: isPinned || false,
        })
        .returning();
      return res.status(201).json(newThread);
    }

    // Regular user posting (requires participantId)
    if (!participantId) {
      return res.status(400).json({ error: "Participant ID or author handle required" });
    }

    // Get participant handle
    const [participant] = await db
      .select()
      .from(communityParticipants)
      .where(eq(communityParticipants.id, participantId));

    if (!participant) {
      return res.status(400).json({ error: "Invalid participant" });
    }

    const [newThread] = await db
      .insert(communityThreads)
      .values({
        departmentId,
        title,
        content,
        authorType: 'user',
        authorHandle: participant.anonymousHandle,
      })
      .returning();

    // Update participant post count
    await db
      .update(communityParticipants)
      .set({ postCount: String(parseInt(participant.postCount || '0') + 1) })
      .where(eq(communityParticipants.id, participantId));

    res.status(201).json(newThread);
  } catch (error) {
    console.error("Error creating thread:", error);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// Create reply to thread
communityRouter.post("/threads/:id/posts", async (req, res) => {
  try {
    const threadId = parseInt(req.params.id);
    const { content, participantId } = req.body;

    // Get participant
    const [participant] = await db
      .select()
      .from(communityParticipants)
      .where(eq(communityParticipants.id, participantId));

    if (!participant) {
      return res.status(400).json({ error: "Invalid participant" });
    }

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

    const [newPost] = await db
      .insert(communityPosts)
      .values({
        threadId,
        content,
        authorType: 'user',
        authorHandle: participant.anonymousHandle,
      })
      .returning();

    // Update thread reply count and last activity
    await db
      .update(communityThreads)
      .set({ 
        replyCount: String(parseInt(thread.replyCount || '0') + 1),
        lastActivityAt: new Date()
      })
      .where(eq(communityThreads.id, threadId));

    // Update participant post count
    await db
      .update(communityParticipants)
      .set({ postCount: String(parseInt(participant.postCount || '0') + 1) })
      .where(eq(communityParticipants.id, participantId));

    res.status(201).json(newPost);
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// React to a post
communityRouter.post("/posts/:id/react", async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { participantId, reactionType } = req.body;

    // Check if already reacted
    const [existing] = await db
      .select()
      .from(communityReactions)
      .where(and(
        eq(communityReactions.postId, postId),
        eq(communityReactions.participantId, participantId)
      ));

    if (existing) {
      return res.status(400).json({ error: "Already reacted" });
    }

    const [reaction] = await db
      .insert(communityReactions)
      .values({
        postId,
        participantId,
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
    console.error("Error creating reaction:", error);
    res.status(500).json({ error: "Failed to create reaction" });
  }
});

// Get or create participant for a case
communityRouter.post("/participants", async (req, res) => {
  try {
    const { caseId, departmentId } = req.body;

    // Check if participant exists
    const [existing] = await db
      .select()
      .from(communityParticipants)
      .where(eq(communityParticipants.caseId, caseId));

    if (existing) {
      return res.json(existing);
    }

    // Generate anonymous handle
    const adjectives = ['Swift', 'Brave', 'Wise', 'Noble', 'Calm', 'Bold', 'True', 'Fair', 'Kind', 'Strong'];
    const nouns = ['Phoenix', 'Eagle', 'Lion', 'Wolf', 'Bear', 'Hawk', 'Tiger', 'Falcon', 'Panther', 'Dragon'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.floor(Math.random() * 9999);
    const anonymousHandle = `${randomAdj}${randomNoun}${randomNum}`;

    const [newParticipant] = await db
      .insert(communityParticipants)
      .values({
        caseId,
        anonymousHandle,
        departmentId
      })
      .returning();

    res.status(201).json(newParticipant);
  } catch (error) {
    console.error("Error creating participant:", error);
    res.status(500).json({ error: "Failed to create participant" });
  }
});

// Update thread (admin only - pin/lock)
communityRouter.patch("/threads/:id", async (req, res) => {
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
    console.error("Error updating thread:", error);
    res.status(500).json({ error: "Failed to update thread" });
  }
});

// Delete thread (admin only)
communityRouter.delete("/threads/:id", async (req, res) => {
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
    console.error("Error deleting thread:", error);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

// Get community stats
communityRouter.get("/stats", async (req, res) => {
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

    res.json({
      threads: threadCount.count,
      posts: postCount.count,
      members: Number(memberCount.count) + Number(botCount.count),
      activeBots: botCount.count
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Get recent activity (for landing page testimonials)
communityRouter.get("/recent", async (req, res) => {
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
      .where(eq(communityPosts.isHidden, false))
      .orderBy(desc(communityPosts.createdAt))
      .limit(limit);

    res.json(recentPosts);
  } catch (error) {
    console.error("Error fetching recent posts:", error);
    res.status(500).json({ error: "Failed to fetch recent posts" });
  }
});
