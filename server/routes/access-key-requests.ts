import { Router } from "express";
import crypto from "crypto";
import { db } from "../db";
import { accessKeyRequests, cases, notifications } from "@shared/schema";
import { eq, and, lte, desc, inArray, gte, ilike } from "drizzle-orm";
import { emailService } from "../services/EmailService";
import { checkAdminAuth } from "./middleware";
import {
  rateLimiter,
  ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE,
  ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE,
} from "../middleware/security";
import { isAuthorizedForCase } from "../services/portal-auth";
import { warnOnce } from "../lib/warnOnce";

// Stricter per-IP limiter for unauthenticated status-lookup routes.
// These endpoints are the only publicly reachable path that touches
// access-key request metadata, so we throttle them more aggressively
// than the global /api limiter (100/min) to make request-ID enumeration
// impractical while still being comfortable for legitimate use.
//
// DB-backed (persistNamespace: ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE) so the
// 20-req/min per-IP cap is globally authoritative across all autoscale
// instances.  Without DB persistence the cap would scale linearly with
// instance count, making per-IP enumeration limits ineffective under load.
const keyRequestStatusLimiter = rateLimiter(20, 60 * 1000, {
  persistNamespace: ACCESS_KEY_STATUS_RATE_LIMIT_NAMESPACE,
});

// Very strict limiter for the public POST / (submit new request) endpoint.
// Each successful submission sends a confirmation email, creates a DB row,
// and generates an admin notification. 5 submissions per 60 minutes per IP
// is more than enough for legitimate use and makes mail-bombing impractical.
// Persisted to the DB so the per-IP cap holds across autoscale instances
// (otherwise the SMTP flood ceiling scales linearly with instance count).
const keyRequestSubmitLimiter = rateLimiter(5, 60 * 60 * 1000, {
  persistNamespace: ACCESS_KEY_SUBMIT_RATE_LIMIT_NAMESPACE,
});

export const accessKeyRequestsRouter = Router();

function generateRequestId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let result = 'REQ-';
  for (let i = 0; i < 16; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// Charset matches generateSecureAccessCode in cases.ts: digits only.
// 10^12 gives 1×10^12 possible values.
const ACCESS_CODE_CHARS = "0123456789";
const ACCESS_CODE_LENGTH = 12;

function generateAccessKey(): string {
  const bytes = crypto.randomBytes(ACCESS_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) {
    code += ACCESS_CODE_CHARS[bytes[i] % ACCESS_CODE_CHARS.length];
  }
  return code;
}

accessKeyRequestsRouter.post("/", keyRequestSubmitLimiter, async (req, res) => {
  try {
    const { userName, userEmail, userPhone, requestReason } = req.body;

    if (!userName || !userEmail) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Per-recipient duplicate suppression: reject if the same email already has
    // a pending request created within the last 24 hours. This prevents the
    // endpoint being scripted to repeatedly target a single victim mailbox and
    // flood the admin review queue with duplicate entries.
    // Use ilike for case-insensitive email comparison.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentDuplicate] = await db
      .select({ id: accessKeyRequests.id })
      .from(accessKeyRequests)
      .where(
        and(
          ilike(accessKeyRequests.userEmail, userEmail.trim()),
          eq(accessKeyRequests.status, 'pending'),
          gte(accessKeyRequests.createdAt, oneDayAgo),
        ),
      )
      .limit(1);

    if (recentDuplicate) {
      // Return 200 with a generic message so the endpoint does not act as an
      // email-existence oracle — the caller cannot distinguish "email already
      // queued" from a successful submission.
      return res.status(200).json({
        message: "Your request has been submitted. Use your Request ID to check the status.",
      });
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

    // Confirmation email is intentionally NOT sent here.
    // The public POST endpoint is unauthenticated — sending an email immediately
    // to the caller-supplied address would let any attacker use the service as
    // an unauthenticated outbound mail relay. The caller receives the requestId
    // in this response, which is sufficient to check status at GET /status/:id.
    // Transactional emails (approval / rejection) are sent only after a human
    // admin has reviewed the request, so no unsolicited mail reaches third parties.

    res.status(201).json({ 
      requestId: newRequest.requestId,
      message: "Your request has been submitted. Use your Request ID to check the status."
    });
  } catch (error) {
    warnOnce("access-key-requests:create-fail", "Error creating access key request:", error);
    res.status(500).json({ error: "Failed to create request" });
  }
});

// Portal endpoint: submit a key request linked to an existing case.
// Requires an active portal session for the target case — the session token
// is the only accepted proof of ownership. Supplying an access code in the
// body is no longer accepted; that weaker path allowed attackers who had
// only seen the access code (e.g. from a leaked email) to redirect the new
// credential to an attacker-controlled address.
accessKeyRequestsRouter.post("/portal/:caseId", async (req, res) => {
  try {
    const { caseId } = req.params;
    const { userName, userEmail, userPhone, requestReason } = req.body;

    if (!userName || !userEmail) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Require an authenticated portal session for this case.
    if (!(await isAuthorizedForCase(req, caseId))) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify the case exists (session already proves ownership, but we still
    // need the record to create the request).
    const [existingCase] = await db
      .select({ id: cases.id, accessCode: cases.accessCode })
      .from(cases)
      .where(eq(cases.id, caseId));

    if (!existingCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    // Sealed-case guard. Once stage 14 is signed, no further user
    // mutations are permitted — including spawning a new access-key
    // request — until an admin clears the seal via Override Seal.
    const [sealCheck] = await db
      .select({ sealedAt: cases.sealedAt })
      .from(cases)
      .where(eq(cases.id, caseId));
    if (sealCheck?.sealedAt) {
      return res.status(423).json({
        error:
          "This case is sealed. No further changes can be made by the case holder.",
      });
    }

    // Prevent duplicate requests only when an active (pending/approved) request exists.
    // Users whose request was rejected or expired are allowed to submit again.
    const [activeRequest] = await db
      .select({ id: accessKeyRequests.id })
      .from(accessKeyRequests)
      .where(
        and(
          eq(accessKeyRequests.caseId, caseId),
          inArray(accessKeyRequests.status, ['pending', 'approved'])
        )
      );

    if (activeRequest) {
      return res.status(409).json({ error: "An active key request already exists for this case" });
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
        userPhone: userPhone || null,
        requestReason: requestReason || null,
        status: 'pending',
        expiresAt,
        caseId,
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

    emailService.sendKeyRequestConfirmation(userEmail, userName, requestId, req.userLocale)
      .catch(err => warnOnce('access-key-requests:confirmation-email-fail', 'Failed to send confirmation email:', err));

    res.status(201).json({
      requestId: newRequest.requestId,
      message: "Your access key request has been submitted and is under review.",
    });
  } catch (error) {
    warnOnce("access-key-requests:portal-create-fail", "Error creating portal key request:", error);
    res.status(500).json({ error: "Failed to create request" });
  }
});

// Old short request IDs (REQ- + 6 chars, ~30 bits of Math.random() entropy) must not
// serve as bearer tokens — they are rejected immediately to eliminate legacy enumeration risk.
const LEGACY_REQUEST_ID_RE = /^REQ-[A-Z0-9]{6}$/;

interface AdminMessageEntry {
  message: string;
  adminUsername: string;
  timestamp: string;
}

interface PublicStatusResponse {
  requestId: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  adminMessages?: AdminMessageEntry[];
  userMessagesReadCount?: number;
}

accessKeyRequestsRouter.get("/status/:requestId", keyRequestStatusLimiter, async (req, res) => {
  try {
    const { requestId } = req.params;

    // Reject legacy short IDs — they lack sufficient entropy to function as
    // bearer tokens. Users with old-format IDs must submit a new request.
    if (LEGACY_REQUEST_ID_RE.test(requestId)) {
      return res.status(410).json({
        error: "This request ID is no longer valid. Please submit a new access key request.",
      });
    }

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.requestId, requestId));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Verify the caller's email as a second factor before returning sensitive
    // staff messages. Possession of the requestId alone (a publicly shareable
    // identifier that appears in email links and browser history) is not
    // sufficient to read workflow correspondence.
    const callerEmail = (req.headers['x-request-email'] as string | undefined)?.trim().toLowerCase();
    const storedEmail = request.userEmail?.trim().toLowerCase();
    const emailVerified = !!(callerEmail && storedEmail && callerEmail === storedEmail);

    // Base response — safe to return to any caller who holds the requestId.
    const response: PublicStatusResponse = {
      requestId: request.requestId,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    };

    // Staff messages are only included when the caller has proved email ownership.
    if (emailVerified) {
      response.adminMessages = request.adminMessages ? JSON.parse(request.adminMessages) : [];
      response.userMessagesReadCount = request.userMessagesReadCount ?? 0;
    }

    if (request.status === 'approved') {
      // The generated key is a live portal credential — it must not be
      // re-exposed through this public, unauthenticated endpoint. The key was
      // already delivered to the user via the approval email. Tracking
      // keyViewedAt is preserved so the admin can see when the email link
      // was first followed.
      if (!request.keyViewedAt) {
        await db
          .update(accessKeyRequests)
          .set({ keyViewedAt: new Date() })
          .where(eq(accessKeyRequests.id, request.id));
      }
    }

    res.json(response);
  } catch (error) {
    warnOnce(
      "access-key-requests:status-fail",
      "Error checking request status:",
      error,
    );
    res.status(500).json({ error: "Failed to check status" });
  }
});

accessKeyRequestsRouter.get("/admin/list", checkAdminAuth, async (req, res) => {
  try {
    const status = req.query.status as string || 'all';

    let query = db.select().from(accessKeyRequests);
    
    if (status !== 'all') {
      query = query.where(eq(accessKeyRequests.status, status)) as typeof query;
    }

    const requests = await query.orderBy(desc(accessKeyRequests.createdAt));

    // Enrich each request with its linked case's caseRef (if any)
    const caseIds = requests.map((r) => r.caseId).filter(Boolean) as string[];
    let caseRefMap: Record<string, string | null> = {};
    if (caseIds.length > 0) {
      const caseRows = await db
        .select({ id: cases.id, caseRef: cases.caseRef })
        .from(cases)
        .where(inArray(cases.id, caseIds));
      caseRefMap = Object.fromEntries(caseRows.map((r) => [r.id, r.caseRef ?? null]));
    }
    const enriched = requests.map((r) => ({
      ...r,
      caseRef: r.caseId ? (caseRefMap[r.caseId] ?? null) : null,
    }));

    res.json(enriched);
  } catch (error) {
    warnOnce("access-key-requests:list-fail", "Error fetching key requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/message", checkAdminAuth, async (req, res) => {
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
      ).catch(err => warnOnce('access-key-requests:message-email-fail', 'Failed to send message notification email:', err));
    }

    res.json(updated);
  } catch (error) {
    warnOnce("access-key-requests:send-message-fail", "Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/approve", checkAdminAuth, async (req, res) => {
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

    // Generate a fresh access code at approval time — never reuse the
    // pre-generated key from submission time, which may be days old.
    // Collision-retry loop mirrors the toggle-access guard in cases.ts:
    // up to 5 attempts, fail with 500 if no unique code is found.
    let freshCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateAccessKey();
      const [collision] = await db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.accessCode, candidate));
      if (!collision) {
        freshCode = candidate;
        break;
      }
    }
    if (!freshCode) {
      return res.status(500).json({ error: "Could not generate a unique access code" });
    }

    // Wrap the case write and request status update in one atomic transaction
    // so a mid-flight crash cannot leave cases.accessCode updated while the
    // request row still shows status='pending'.
    let linkedCaseId = request.caseId;
    const updated = await db.transaction(async (tx) => {
      if (linkedCaseId) {
        await tx
          .update(cases)
          .set({ accessCode: freshCode })
          .where(eq(cases.id, linkedCaseId));
      } else {
        // Non-portal request: create a brand-new case keyed to the fresh code.
        const [newCase] = await tx
          .insert(cases)
          .values({
            accessCode: freshCode,
            status: 'created',
            userName: request.userName,
            userEmail: request.userEmail,
            userMobile: request.userPhone,
          })
          .returning();
        linkedCaseId = newCase.id;
      }

      const [updatedRequest] = await tx
        .update(accessKeyRequests)
        .set({
          status: 'approved',
          adminUsername: adminUsername || 'Admin',
          approvedAt: new Date(),
          caseId: linkedCaseId,
          // Update generatedKey to the code actually issued for audit purposes.
          generatedKey: freshCode,
          updatedAt: new Date(),
        })
        .where(eq(accessKeyRequests.id, id))
        .returning();
      return updatedRequest;
    });

    // Invalidate any active portal sessions for this case — the access code
    // has just been rotated, so existing tokens must not remain valid.
    // Best-effort, outside the transaction.
    if (request.caseId) {
      try {
        const { deleteSessionsByCaseId } = await import("../services/session-store");
        await deleteSessionsByCaseId(request.caseId);
      } catch {
        // best-effort
      }
    }

    // Send approval email. For portal-linked requests the credential goes to
    // the case's authoritative stored email address, not the requester-supplied
    // one. This closes the redirect-to-attacker path: even if an admin
    // inadvertently approves a spoofed portal request the new key is sent to
    // the real case owner's address, not the attacker's.
    const issuedCode = freshCode;
    const approvalEmail = (() => {
      if (linkedCaseId) {
        // Portal request: look up the case's own email.
        return db
          .select({ userEmail: cases.userEmail })
          .from(cases)
          .where(eq(cases.id, linkedCaseId))
          .then(([row]) => row?.userEmail ?? request.userEmail);
      }
      // Non-portal (new case) request: use the contact supplied in the form.
      return Promise.resolve(request.userEmail);
    })();

    approvalEmail.then(email => {
      if (email) {
        emailService.sendKeyApprovalNotification(
          email,
          request.userName || 'User',
          issuedCode,
        ).catch(err => warnOnce('access-key-requests:approval-email-fail', 'Failed to send approval email:', err));
      }
    }).catch(err => warnOnce('access-key-requests:resolve-approval-fail', 'Failed to resolve approval email:', err));

    res.json({
      ...updated,
      message: "Request approved. User can now access their key.",
    });
  } catch (error) {
    warnOnce("access-key-requests:approve-fail", "Error approving request:", error);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/send-verification-email", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { body } = req.body;

    if (typeof body !== "string" || body.trim().length === 0) {
      return res.status(400).json({ error: "Email body is required" });
    }

    const [request] = await db
      .select()
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.id, id));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Use the case's authoritative email if the request is portal-linked
    const recipientEmail = await (async () => {
      if (request.caseId) {
        const [row] = await db
          .select({ userEmail: cases.userEmail })
          .from(cases)
          .where(eq(cases.id, request.caseId));
        return row?.userEmail ?? request.userEmail;
      }
      return request.userEmail;
    })();

    if (!recipientEmail) {
      return res.status(422).json({ error: "No email address on record for this request" });
    }

    const sent = await emailService.sendVerificationQuestionnaire(
      recipientEmail,
      request.userName || "User",
      body.trim(),
    );

    if (!sent) {
      return res.status(502).json({ error: "Email delivery failed — check SMTP configuration" });
    }

    res.json({ message: "Verification questionnaire sent" });
  } catch (error) {
    warnOnce("access-key-requests:verification-email-fail", "Error sending verification email:", error);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

accessKeyRequestsRouter.post("/admin/:id/reject", checkAdminAuth, async (req, res) => {
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

    // Send rejection email to user
    if (request.userEmail) {
      emailService.sendRejectionEmail(
        request.userEmail,
        request.userName || 'User',
        request.requestId,
        reason || undefined
      ).catch(err => warnOnce('access-key-requests:rejection-email-fail', 'Failed to send rejection email:', err));
    }

    res.json({ 
      ...updated, 
      message: "Request rejected." 
    });
  } catch (error) {
    warnOnce("access-key-requests:reject-fail", "Error rejecting request:", error);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

accessKeyRequestsRouter.get("/case/:caseId", keyRequestStatusLimiter, async (req, res) => {
  try {
    const { caseId } = req.params;

    // Require the caller to prove they own this case (portal session bound to
    // caseId) or to be an admin. A bare case UUID is not sufficient — case IDs
    // are exposed in multiple places and treating possession of the UUID as
    // authorization would let anyone enumerate recovery-request state and
    // timing for any case they happen to know about.
    const authorized = await isAuthorizedForCase(req, caseId);
    if (!authorized) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Return the most recent request for this case (users may resubmit after rejection/expiry)
    const [request] = await db
      .select({
        requestId: accessKeyRequests.requestId,
        status: accessKeyRequests.status,
        adminMessages: accessKeyRequests.adminMessages,
        userMessagesReadCount: accessKeyRequests.userMessagesReadCount,
        userEmail: accessKeyRequests.userEmail,
        updatedAt: accessKeyRequests.updatedAt,
      })
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.caseId, caseId))
      .orderBy(desc(accessKeyRequests.createdAt))
      .limit(1);

    if (!request) {
      return res.status(404).json({ error: "No key request found for this case" });
    }

    const messages = request.adminMessages ? JSON.parse(request.adminMessages) : [];

    res.json({
      requestId: request.requestId,
      status: request.status,
      adminMessageCount: messages.length,
      userMessagesReadCount: request.userMessagesReadCount ?? 0,
      userEmail: request.userEmail ?? null,
      lastUpdatedAt: request.updatedAt,
    });
  } catch (error) {
    warnOnce("access-key-requests:case-fetch-fail", "Error fetching key request for case:", error);
    res.status(500).json({ error: "Failed to fetch key request" });
  }
});

accessKeyRequestsRouter.patch("/mark-read/:requestId", keyRequestStatusLimiter, async (req, res) => {
  try {
    const { requestId } = req.params;

    if (LEGACY_REQUEST_ID_RE.test(requestId)) {
      return res.status(410).json({ error: "This request ID is no longer valid." });
    }

    // Email verification is required before mutating the read-state indicator,
    // preventing an observer who learns a requestId from suppressing unread badges.
    const callerEmail = (req.headers['x-request-email'] as string | undefined)?.trim().toLowerCase();
    if (!callerEmail) {
      return res.status(401).json({ error: "Email verification required." });
    }

    const [request] = await db
      .select({
        id: accessKeyRequests.id,
        userEmail: accessKeyRequests.userEmail,
        adminMessages: accessKeyRequests.adminMessages,
      })
      .from(accessKeyRequests)
      .where(eq(accessKeyRequests.requestId, requestId));

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const storedEmail = request.userEmail?.trim().toLowerCase();
    if (!storedEmail || callerEmail !== storedEmail) {
      return res.status(403).json({ error: "Email verification failed." });
    }

    const messages = request.adminMessages ? JSON.parse(request.adminMessages) : [];
    const totalCount = messages.length;

    await db
      .update(accessKeyRequests)
      .set({ userMessagesReadCount: totalCount })
      .where(eq(accessKeyRequests.id, request.id));

    res.json({ userMessagesReadCount: totalCount });
  } catch (error) {
    warnOnce("access-key-requests:mark-read-fail", "Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
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
      console.log(`[access-key-requests] expired ${expired.length} pending key request(s)`);
      for (const request of expired) {
        if (request.userEmail) {
          emailService.sendExpiryEmail(
            request.userEmail,
            request.userName || 'User',
            request.requestId
          ).catch(err => warnOnce('access-key-requests:expiry-email-fail', `Failed to send expiry email for request ${request.requestId}:`, err));
        }
      }
    }

    return expired.length;
  } catch (error) {
    warnOnce("access-key-requests:expire-fail", "Error expiring pending requests:", error);
    return 0;
  }
}
