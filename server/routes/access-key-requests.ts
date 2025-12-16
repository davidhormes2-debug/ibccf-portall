import { Router } from "express";
import { db } from "../db";
import { accessKeyRequests, cases, notifications } from "@shared/schema";
import { eq, and, lte, desc } from "drizzle-orm";
import { emailService } from "../services/EmailService";

export const accessKeyRequestsRouter = Router();

function generateRequestId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'REQ-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateAccessKey(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

accessKeyRequestsRouter.post("/", async (req, res) => {
  try {
    const { userName, userEmail, userPhone, requestReason } = req.body;

    if (!userName || !userEmail) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const requestId = generateRequestId();
    const generatedKey = generateAccessKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const [newRequest] = await db
      .insert(accessKeyRequests)
      .values({
        requestId,
        generatedKey,
        userName,
        userEmail,
        userPhone,
        requestReason,
        status: 'pending',
        expiresAt,
      })
      .returning();

    await db.insert(notifications).values({
      recipientType: 'admin',
      recipientId: 'all',
      type: 'new_key_request',
      title: 'New Access Key Request',
      body: `${userName} (${userEmail}) has requested an access key`,
      link: '/admin?tab=key-requests',
      metadata: JSON.stringify({ requestId: newRequest.requestId }),
    });

    // Send confirmation email to user
    emailService.sendKeyRequestConfirmation(userEmail, userName, requestId)
      .catch(err => console.error('Failed to send confirmation email:', err));

    res.status(201).json({ 
      requestId: newRequest.requestId,
      message: "Your request has been submitted. Use your Request ID to check the status."
    });
  } catch (error) {
    console.error("Error creating access key request:", error);
    res.status(500).json({ error: "Failed to create request" });
  }
});

accessKeyRequestsRouter.get("/status/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.requestId, requestId));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const response: any = {
      requestId: request.requestId,
      status: request.status,
      userName: request.userName,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      adminMessages: request.adminMessages ? JSON.parse(request.adminMessages) : [],
    };

    if (request.status === 'approved') {
      response.accessKey = request.generatedKey;
      
      if (!request.keyViewedAt) {
        await db
          .update(accessKeyRequests)
          .set({ keyViewedAt: new Date() })
          .where(eq(accessKeyRequests.id, request.id));
      }
    }

    if (request.status === 'rejected') {
      response.rejectedAt = request.rejectedAt;
    }

    res.json(response);
  } catch (error) {
    console.error("Error checking request status:", error);
    res.status(500).json({ error: "Failed to check status" });
  }
});

accessKeyRequestsRouter.get("/admin/list", async (req, res) => {
  try {
    const status = req.query.status as string || 'all';

    let query = db.select().from(accessKeyRequests);
    
    if (status !== 'all') {
      query = query.where(eq(accessKeyRequests.status, status)) as typeof query;
    }

    const requests = await query.orderBy(desc(accessKeyRequests.createdAt));

    res.json(requests);
  } catch (error) {
    console.error("Error fetching key requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/message", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { message, adminUsername } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.id, id));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const existingMessages = request.adminMessages ? JSON.parse(request.adminMessages) : [];
    existingMessages.push({
      message,
      adminUsername: adminUsername || 'Admin',
      timestamp: new Date().toISOString(),
    });

    const [updated] = await db
      .update(accessKeyRequests)
      .set({ 
        adminMessages: JSON.stringify(existingMessages),
        updatedAt: new Date()
      })
      .where(eq(accessKeyRequests.id, id))
      .returning();

    // Send email notification to user about the message
    if (request.userEmail) {
      emailService.sendAdminMessageNotification(
        request.userEmail,
        request.userName || 'User',
        request.requestId,
        message
      ).catch(err => console.error('Failed to send message notification email:', err));
    }

    res.json(updated);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { adminUsername } = req.body;

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.id, id));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: "Request is not pending" });
    }

    const [newCase] = await db
      .insert(cases)
      .values({
        accessCode: request.generatedKey,
        status: 'created',
        userName: request.userName,
        userEmail: request.userEmail,
        userMobile: request.userPhone,
      })
      .returning();

    const [updated] = await db
      .update(accessKeyRequests)
      .set({ 
        status: 'approved',
        adminUsername: adminUsername || 'Admin',
        approvedAt: new Date(),
        caseId: newCase.id,
        updatedAt: new Date()
      })
      .where(eq(accessKeyRequests.id, id))
      .returning();

    // Send approval email to user
    if (request.userEmail) {
      emailService.sendKeyApprovalNotification(
        request.userEmail,
        request.userName || 'User',
        request.generatedKey
      ).catch(err => console.error('Failed to send approval email:', err));
    }

    res.json({ 
      ...updated, 
      message: "Request approved. User can now access their key." 
    });
  } catch (error) {
    console.error("Error approving request:", error);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/reject", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { adminUsername, reason } = req.body;

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.id, id));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: "Request is not pending" });
    }

    const existingMessages = request.adminMessages ? JSON.parse(request.adminMessages) : [];
    if (reason) {
      existingMessages.push({
        message: `Request rejected: ${reason}`,
        adminUsername: adminUsername || 'Admin',
        timestamp: new Date().toISOString(),
      });
    }

    const [updated] = await db
      .update(accessKeyRequests)
      .set({ 
        status: 'rejected',
        adminUsername: adminUsername || 'Admin',
        adminMessages: JSON.stringify(existingMessages),
        rejectedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(accessKeyRequests.id, id))
      .returning();

    res.json({ 
      ...updated, 
      message: "Request rejected." 
    });
  } catch (error) {
    console.error("Error rejecting request:", error);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

export async function expirePendingRequests() {
  try {
    const now = new Date();
    
    const expired = await db
      .update(accessKeyRequests)
      .set({ 
        status: 'expired',
        updatedAt: now
      })
      .where(
        and(
          eq(accessKeyRequests.status, 'pending'),
          lte(accessKeyRequests.expiresAt, now)
        )
      )
      .returning();

    if (expired.length > 0) {
      console.log(`Expired ${expired.length} pending key request(s)`);
    }

    return expired.length;
  } catch (error) {
    console.error("Error expiring pending requests:", error);
    return 0;
  }
}
