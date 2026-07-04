import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// checkAdminAuth (server/routes/middleware.ts) requires the session's
// adminUsername to match process.env.ADMIN_USERNAME. Set it before the
// dynamic import below so the mocked session validates.
process.env.ADMIN_USERNAME = "test-admin";

// As in declarations.test.ts, we let the REAL sendCaseEmailWithAudit
// helper run so we can verify its `email_<tag>` audit-row contract
// end-to-end alongside the route-level audit actions
// (`document_submitted`, `document_approved`, `document_rejected`).

const auditLogs: any[] = [];
let beforeCase: any = null;
let lastDocUpdate: any = null;
let createdDoc: any = null;
let existingDocStatus: string | null = null;
let existingDocSubmittedAt: Date | null = new Date("2026-05-01T00:00:00Z");
let existingDocMissing = false;
function existingDoc(id: number) {
  if (existingDocMissing) return undefined;
  if (existingDocStatus === null) {
    return {
      id,
      caseId: beforeCase?.id ?? "case-1",
      documentType: "Proof of Income",
      status: "submitted",
      submittedAt: existingDocSubmittedAt,
    };
  }
  return {
    id,
    caseId: beforeCase?.id ?? "case-1",
    documentType: "Proof of Income",
    status: existingDocStatus,
    submittedAt: existingDocSubmittedAt,
  };
}

const sendDocumentRequestedEmail = vi.fn(async () => ({ success: true }));
const sendDocumentApprovedEmail = vi.fn(async () => ({ success: true }));
const sendDocumentRejectedEmail = vi.fn(async () => ({ success: true }));
const sendDocumentUnderReviewEmail = vi.fn(async () => ({ success: true }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: "test-admin",
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => beforeCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getDocumentRequestById: vi.fn(async (id: number) => existingDoc(id)),
    updateDocumentRequest: vi.fn(async (id: number, data: any) => {
      lastDocUpdate = { id, ...data };
      return {
        id,
        caseId: beforeCase?.id ?? "case-1",
        documentType: "Proof of Income",
        ...data,
      };
    }),
    createDocumentRequest: vi.fn(async (data: any) => {
      createdDoc = { id: 42, ...data };
      return createdDoc;
    }),
    getDocumentRequestsByCaseId: vi.fn(async () => []),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

// Routes now funnel doc notifications through the localized wrapper
// `sendLocalizedCaseEmail({ logTag: 'document-…' })`. Dispatch back to
// the per-tag spies so existing assertions hold.
const sendLocalizedCaseEmail = vi.fn(async (opts: { logTag: string }) => {
  if (opts.logTag === "document-requested")
    return sendDocumentRequestedEmail();
  if (opts.logTag === "document-approved")
    return sendDocumentApprovedEmail();
  if (opts.logTag === "document-rejected")
    return sendDocumentRejectedEmail();
  if (opts.logTag === "document-under-review")
    return sendDocumentUnderReviewEmail();
  return { success: true };
});

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendDocumentRequestedEmail,
    sendDocumentApprovedEmail,
    sendDocumentRejectedEmail,
    sendLocalizedCaseEmail,
  }),
}));

// PATCH /api/document-requests/:id uses `isPortalSessionValidForCase`
// (portal-session only — admin bearer tokens are intentionally rejected so
// submissions are always user-attributed). Mock it as a passthrough so
// unit tests can exercise the route logic without wiring real sessions.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isPortalSessionValidForCase: vi.fn(async () => true),
}));

const { documentRequestsRouter, registerCaseDocumentRoutes } = await import(
  "../routes/content"
);
const { Router } = await import("express");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/document-requests", documentRequestsRouter);
  const casesRouter = Router();
  registerCaseDocumentRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
};

// Tiny but valid base64 PDF data URL (header bytes only — passes MIME + size guard).
const TINY_PDF_DATA_URL =
  "data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKCg==";

function emailAudits(tag: string) {
  return auditLogs.filter(
    (a) => a.action === `email_${tag}` || a.action === `email_${tag}_failed`,
  );
}
function actionAudits(action: string) {
  return auditLogs.filter((a) => a.action === action);
}

// The review/create routes dispatch the user notification via a
// fire-and-forget `void (async () => {...})()` block (so SMTP latency
// never blocks the admin click). On busy full-suite runs the event loop
// can take a few ms to drain those microtasks + the dynamic imports
// inside them, which used to flake the "expected 1 call, got 0"
// assertions. Poll until the email_<tag> audit row lands (or 5s) so
// the send mock + audit-log writes have all settled before assertions.
async function waitForEmailAudit(tag: string, timeoutMs = 5000) {
  const start = Date.now();
  while (emailAudits(tag).length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  auditLogs.length = 0;
  lastDocUpdate = null;
  createdDoc = null;
  beforeCase = { ...baseCase };
  existingDocStatus = null;
  existingDocSubmittedAt = new Date("2026-05-01T00:00:00Z");
  existingDocMissing = false;
  sendDocumentRequestedEmail.mockClear();
  sendDocumentApprovedEmail.mockClear();
  sendDocumentRejectedEmail.mockClear();
  sendDocumentUnderReviewEmail.mockClear();
});

describe("Document-request flows", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  describe("POST /api/cases/:id/document-requests (admin create)", () => {
    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app)
        .post("/api/cases/case-1/document-requests")
        .send({ documentType: "Proof of Income" });

      expect(res.status).toBe(401);
      expect(sendDocumentRequestedEmail).not.toHaveBeenCalled();
      expect(auditLogs).toHaveLength(0);
    });

    it("emits exactly one 'document-requested' email + one matching email_<tag> audit", async () => {
      const res = await request(app)
        .post("/api/cases/case-1/document-requests")
        .set(auth)
        .send({
          documentType: "Proof of Income",
          category: "proof_of_income",
          description: "Last 3 months of payslips.",
        });

      expect(res.status).toBe(200);
      expect(createdDoc).toBeTruthy();
      expect(createdDoc.documentType).toBe("Proof of Income");

      // The route now dispatches the notification via a fire-and-forget
      // `void (async () => {...})()` so SMTP latency never blocks the
      // admin's create click. Wait for the email_<tag> audit row to
      // land so the dynamic imports + send + audit-log all settle
      // before assertions AND so no work leaks into the next test.
      await waitForEmailAudit("document-requested");

      expect(sendDocumentRequestedEmail).toHaveBeenCalledTimes(1);
      const reqAudits = emailAudits("document-requested");
      expect(reqAudits).toHaveLength(1);
      expect(reqAudits[0].action).toBe("email_document-requested");
      expect(reqAudits[0].targetType).toBe("case");
      expect(reqAudits[0].targetId).toBe("case-1");
    });

    it("rejects an unknown category enum with 400 and emits nothing", async () => {
      const res = await request(app)
        .post("/api/cases/case-1/document-requests")
        .set(auth)
        .send({ documentType: "Mystery", category: "totally_made_up" });

      expect(res.status).toBe(400);
      expect(sendDocumentRequestedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-requested")).toHaveLength(0);
    });
  });

  describe("PATCH /api/document-requests/:id (user/admin submit)", () => {
    it("force-sets status='submitted' + writes a 'document_submitted' audit; sends NO email", async () => {
      // Route requires a valid portal session bound to the owning case
      // (`isPortalSessionValidForCase` in server/routes/content.ts). Admin
      // bearer tokens are deliberately rejected so submissions are always
      // attributed to the case holder, not an operator. The mock above
      // makes `isPortalSessionValidForCase` return true unconditionally.
      const res = await request(app)
        .patch("/api/document-requests/7")
        .set({ "x-portal-session-token": "test-portal-token" })
        .send({
          submittedFileData: TINY_PDF_DATA_URL,
          submittedFileName: "payslip.pdf",
          // Try to self-approve — server must ignore this.
          status: "approved",
        });

      expect(res.status).toBe(200);
      expect(lastDocUpdate.status).toBe("submitted");
      expect(lastDocUpdate.submittedAt).toBeInstanceOf(Date);

      const audit = actionAudits("document_submitted");
      expect(audit).toHaveLength(1);
      expect(audit[0].targetType).toBe("case");
      expect(audit[0].adminUsername).toBe("system");

      // No admin-side email tags fire on user submission — verify all three.
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(sendDocumentRequestedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-approved")).toHaveLength(0);
      expect(emailAudits("document-rejected")).toHaveLength(0);
      expect(emailAudits("document-requested")).toHaveLength(0);
    });

    it("rejects non-PDF/image data URLs with 400 (e.g. .exe disguise)", async () => {
      const res = await request(app)
        .patch("/api/document-requests/7")
        .send({
          submittedFileData:
            "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA",
          submittedFileName: "evil.exe",
        });

      expect(res.status).toBe(400);
      expect(lastDocUpdate).toBeNull();
      expect(actionAudits("document_submitted")).toHaveLength(0);
    });

    it("rejects a non-data-url payload with 400", async () => {
      const res = await request(app)
        .patch("/api/document-requests/7")
        .send({
          submittedFileData: "not-a-data-url",
          submittedFileName: "weird.pdf",
        });

      expect(res.status).toBe(400);
      expect(lastDocUpdate).toBeNull();
    });
  });

  describe("POST /api/document-requests/:id/approve|reject (admin review)", () => {
    it("approve: rejects unauthenticated callers with 401", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/approve")
        .send({});

      expect(res.status).toBe(401);
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(actionAudits("document_approved")).toHaveLength(0);
      expect(emailAudits("document-approved")).toHaveLength(0);
    });

    it("reject: rejects unauthenticated callers with 401", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/reject")
        .send({});

      expect(res.status).toBe(401);
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(actionAudits("document_rejected")).toHaveLength(0);
      expect(emailAudits("document-rejected")).toHaveLength(0);
    });

    it("approve: writes one 'document_approved' route audit + one 'email_document-approved' audit + one email send", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/approve")
        .set(auth)
        .send({ adminNotes: "Looks good." });

      expect(res.status).toBe(200);
      expect(lastDocUpdate.status).toBe("approved");
      expect(lastDocUpdate.adminNotes).toBe("Looks good.");
      expect(lastDocUpdate.approvedAt).toBeInstanceOf(Date);

      await waitForEmailAudit("document-approved");

      expect(actionAudits("document_approved")).toHaveLength(1);
      expect(emailAudits("document-approved")).toHaveLength(1);
      expect(sendDocumentApprovedEmail).toHaveBeenCalledTimes(1);

      // No twin rejection side effects.
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(actionAudits("document_rejected")).toHaveLength(0);
      expect(emailAudits("document-rejected")).toHaveLength(0);
    });

    it("reject: writes one 'document_rejected' audit + one 'email_document-rejected' audit; leaves approvedAt unset", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/reject")
        .set(auth)
        .send({ adminNotes: "Illegible scan." });

      expect(res.status).toBe(200);
      expect(lastDocUpdate.status).toBe("rejected");
      expect(lastDocUpdate.adminNotes).toBe("Illegible scan.");
      expect(lastDocUpdate.approvedAt).toBeUndefined();

      await waitForEmailAudit("document-rejected");

      expect(actionAudits("document_rejected")).toHaveLength(1);
      expect(emailAudits("document-rejected")).toHaveLength(1);
      expect(sendDocumentRejectedEmail).toHaveBeenCalledTimes(1);

      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(actionAudits("document_approved")).toHaveLength(0);
      expect(emailAudits("document-approved")).toHaveLength(0);
    });

    it("no-op approve: re-approving an already-approved request does NOT re-send the email or re-audit", async () => {
      // Pre-condition: the document is ALREADY approved on the storage
      // layer. The no-op guard in reviewDocumentRequest must short-circuit
      // both the route audit and the user notification.
      existingDocStatus = "approved";

      const res = await request(app)
        .post("/api/document-requests/7/approve")
        .set(auth)
        .send({ adminNotes: "Re-clicked by accident" });

      expect(res.status).toBe(200);
      // No duplicate email or audit rows.
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-approved")).toHaveLength(0);
      expect(actionAudits("document_approved")).toHaveLength(0);
      // And no leak into the rejection side.
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-rejected")).toHaveLength(0);
    });

    it("no-op reject: re-rejecting an already-rejected request does NOT re-send the email or re-audit", async () => {
      existingDocStatus = "rejected";

      const res = await request(app)
        .post("/api/document-requests/7/reject")
        .set(auth)
        .send({ adminNotes: "Re-clicked" });

      expect(res.status).toBe(200);
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-rejected")).toHaveLength(0);
      expect(actionAudits("document_rejected")).toHaveLength(0);
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-approved")).toHaveLength(0);
    });

    it("mark-under-review: rejects unauthenticated callers with 401", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .send({});

      expect(res.status).toBe(401);
      expect(lastDocUpdate).toBeNull();
      expect(actionAudits("document_under_review")).toHaveLength(0);
    });

    it("mark-under-review: transitions a 'submitted' document to 'under_review' and writes the audit", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("under_review");
      expect(lastDocUpdate.status).toBe("under_review");

      const audit = actionAudits("document_under_review");
      expect(audit).toHaveLength(1);
      expect(audit[0].targetType).toBe("case");
      expect(audit[0].targetId).toBe("case-1");

      // No twin review-side side effects.
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(actionAudits("document_approved")).toHaveLength(0);
      expect(actionAudits("document_rejected")).toHaveLength(0);
    });

    it("mark-under-review: fires exactly one 'document-under-review' email + matching email_<tag> audit (Task #376)", async () => {
      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);

      // Notification dispatch is fire-and-forget — wait for the
      // email_document-under-review audit row to land before asserting.
      await waitForEmailAudit("document-under-review");

      expect(sendDocumentUnderReviewEmail).toHaveBeenCalledTimes(1);
      const reviewAudits = emailAudits("document-under-review");
      expect(reviewAudits).toHaveLength(1);
      expect(reviewAudits[0].action).toBe("email_document-under-review");
      expect(reviewAudits[0].targetType).toBe("case");
      expect(reviewAudits[0].targetId).toBe("case-1");

      // No twin notification side effects.
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(sendDocumentRejectedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-approved")).toHaveLength(0);
      expect(emailAudits("document-rejected")).toHaveLength(0);
    });

    it("mark-under-review: does NOT send the user email when the case has no email on file — route audit still fires (Task #376)", async () => {
      beforeCase = { ...baseCase, userEmail: null };

      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      // Give the fire-and-forget dispatcher a chance to run; it should
      // short-circuit before calling sendCaseEmailWithAudit when there's
      // no recipient address (so the email_<tag> audit row never lands).
      await new Promise((r) => setTimeout(r, 50));

      expect(sendDocumentUnderReviewEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-under-review")).toHaveLength(0);
      // The route-level audit for the transition itself still fires.
      expect(actionAudits("document_under_review")).toHaveLength(1);
    });

    it("mark-under-review: no-op (already under_review) does NOT re-send the email or re-audit (Task #376)", async () => {
      existingDocStatus = "under_review";

      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      // Short-circuit branch: no email and no email-audit row.
      await new Promise((r) => setTimeout(r, 50));
      expect(sendDocumentUnderReviewEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-under-review")).toHaveLength(0);
      expect(actionAudits("document_under_review")).toHaveLength(0);
    });

    it("mark-under-review: no-op (200) when document is already under_review — no update, no audit", async () => {
      existingDocStatus = "under_review";

      const res = await request(app)
        .post("/api/document-requests/7/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("under_review");
      // Short-circuits before update / audit.
      expect(lastDocUpdate).toBeNull();
      expect(actionAudits("document_under_review")).toHaveLength(0);
    });

    it.each(["pending", "approved", "rejected"] as const)(
      "mark-under-review: rejects a '%s' document with 400",
      async (status) => {
        existingDocStatus = status;
        if (status === "pending") existingDocSubmittedAt = null;

        const res = await request(app)
          .post("/api/document-requests/7/mark-under-review")
          .set(auth)
          .send({});

        expect(res.status).toBe(400);
        expect(lastDocUpdate).toBeNull();
        expect(actionAudits("document_under_review")).toHaveLength(0);
      },
    );

    it("mark-under-review: returns 404 when the document does not exist", async () => {
      existingDocMissing = true;

      const res = await request(app)
        .post("/api/document-requests/9999/mark-under-review")
        .set(auth)
        .send({});

      expect(res.status).toBe(404);
      expect(lastDocUpdate).toBeNull();
      expect(actionAudits("document_under_review")).toHaveLength(0);
    });

    it("does not send a review email when the case has no email on file (route audit still fires)", async () => {
      beforeCase = { ...baseCase, userEmail: null };

      const res = await request(app)
        .post("/api/document-requests/7/approve")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      expect(sendDocumentApprovedEmail).not.toHaveBeenCalled();
      expect(emailAudits("document-approved")).toHaveLength(0);
      // Route-level audit still fires for the review action itself.
      expect(actionAudits("document_approved")).toHaveLength(1);
    });
  });
});
