import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "declarations-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// We deliberately do NOT mock services/emailNotify so that the real
// sendCaseEmailWithAudit helper runs end-to-end. That guarantees we
// observe the exact `email_<tag>` / `email_<tag>_failed` audit rows
// it writes via storage.createAuditLog.

const auditLogs: any[] = [];
let beforeCase: any = null;
let updatedCase: any = null;
let declarationRow: any = null;

const sendDeclarationAccessEmail = vi.fn(async () => ({ success: true }));
const sendDeclarationAssignedEmail = vi.fn(async () => ({ success: true }));
const sendDeclarationApprovedEmail = vi.fn(async () => ({ success: true }));
const sendDeclarationRejectedEmail = vi.fn(async () => ({ success: true }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (_token: string) => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => beforeCase),
    updateCase: vi.fn(async (_id: string, data: any) => {
      updatedCase = { ...(beforeCase ?? {}), ...data };
      return updatedCase;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    createCaseEmail: vi.fn(async () => ({ id: 1 })),
    updateCaseEmailStatus: vi.fn(async () => {}),
    getDeclarationSubmissionById: vi.fn(async (_id: number) => declarationRow),
    updateDeclarationSubmissionStatus: vi.fn(
      async (_id: number, status: string, reviewedBy: string, notes?: string) => {
        declarationRow = {
          id: 1,
          caseId: beforeCase?.id ?? "case-1",
          status,
          reviewedBy,
          reviewerNotes: notes,
        };
        return declarationRow;
      },
    ),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

// Routes now funnel approve/reject notifications through the localized
// wrapper `sendLocalizedCaseEmail({ logTag: 'declaration-approved'|… })`.
// We keep the per-tag spies so the existing assertions still hold by
// dispatching on the wrapper's `logTag`.
const sendLocalizedCaseEmail = vi.fn(async (opts: { logTag: string }) => {
  if (opts.logTag === "declaration-assigned")
    return sendDeclarationAssignedEmail();
  if (opts.logTag === "declaration-approved")
    return sendDeclarationApprovedEmail();
  if (opts.logTag === "declaration-rejected")
    return sendDeclarationRejectedEmail();
  return { success: true };
});

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendDeclarationAccessEmail,
    sendDeclarationAssignedEmail,
    sendDeclarationApprovedEmail,
    sendDeclarationRejectedEmail,
    sendLocalizedCaseEmail,
  }),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
  declarationStatus: "not_requested",
};

function emailAudits(tag: string) {
  return auditLogs.filter(
    (a) => a.action === `email_${tag}` || a.action === `email_${tag}_failed`,
  );
}

beforeEach(() => {
  auditLogs.length = 0;
  updatedCase = null;
  declarationRow = null;
  beforeCase = { ...baseCase };
  sendDeclarationAccessEmail.mockClear();
  sendDeclarationAssignedEmail.mockClear();
  sendDeclarationApprovedEmail.mockClear();
  sendDeclarationRejectedEmail.mockClear();
});

describe("Admin declaration flows", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  describe("POST /api/admin/cases/:id/request-declaration", () => {
    it("rejects unauthenticated callers with 401 (no email, no audit)", async () => {
      const res = await request(app)
        .post("/api/admin/cases/case-1/request-declaration")
        .send({});

      expect(res.status).toBe(401);
      expect(sendDeclarationAssignedEmail).not.toHaveBeenCalled();
      expect(auditLogs).toHaveLength(0);
    });

    it("emits 'declaration-assigned' email + matching email_<tag> audit on success", async () => {
      const res = await request(app)
        .post("/api/admin/cases/case-1/request-declaration")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      expect(updatedCase.declarationStatus).toBe("pending");
      expect(updatedCase.declarationAccessCode).toMatch(/^\d{8}$/);

      // The underlying email send fires exactly once and the wrapper
      // writes exactly one `email_declaration-assigned` audit row.
      expect(sendDeclarationAssignedEmail).toHaveBeenCalledTimes(1);
      const assignedAudits = emailAudits("declaration-assigned");
      expect(assignedAudits).toHaveLength(1);
      expect(assignedAudits[0].action).toBe("email_declaration-assigned");
      expect(assignedAudits[0].targetType).toBe("case");
      expect(assignedAudits[0].targetId).toBe("case-1");

      // The richer access-code email is opt-in via sendEmail flag — not
      // fired here. So only the assigned-email path produced audit rows.
      expect(sendDeclarationAccessEmail).not.toHaveBeenCalled();
      expect(emailAudits("declaration-access")).toHaveLength(0);
    });

    it("does not send the assigned email when the case has no email on file", async () => {
      beforeCase = { ...baseCase, userEmail: null };

      const res = await request(app)
        .post("/api/admin/cases/case-1/request-declaration")
        .set(auth)
        .send({});

      expect(res.status).toBe(200);
      expect(sendDeclarationAssignedEmail).not.toHaveBeenCalled();
      // No `email_declaration-assigned` audit row is written either —
      // sendCaseEmailWithAudit short-circuits before audit on missing `to`.
      expect(emailAudits("declaration-assigned")).toHaveLength(0);
    });
  });

  describe("PATCH /api/admin/declaration-submissions/:id/status", () => {
    it("rejects unauthenticated callers with 401", async () => {
      const res = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .send({ status: "approved" });

      expect(res.status).toBe(401);
      expect(sendDeclarationApprovedEmail).not.toHaveBeenCalled();
      expect(sendDeclarationRejectedEmail).not.toHaveBeenCalled();
      expect(auditLogs).toHaveLength(0);
    });

    it("approve: writes exactly one 'email_declaration-approved' audit and one email send", async () => {
      const res = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(declarationRow.status).toBe("approved");
      expect(updatedCase.declarationStatus).toBe("approved");

      expect(sendDeclarationApprovedEmail).toHaveBeenCalledTimes(1);
      expect(sendDeclarationRejectedEmail).not.toHaveBeenCalled();

      const approvedAudits = emailAudits("declaration-approved");
      expect(approvedAudits).toHaveLength(1);
      expect(approvedAudits[0].action).toBe("email_declaration-approved");
      expect(approvedAudits[0].targetId).toBe("case-1");
      // The twin "rejected" tag must not appear.
      expect(emailAudits("declaration-rejected")).toHaveLength(0);
    });

    it("reject: writes exactly one 'email_declaration-rejected' audit and one email send", async () => {
      const res = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "rejected", reviewerNotes: "Missing signature" });

      expect(res.status).toBe(200);
      expect(declarationRow.status).toBe("rejected");
      expect(declarationRow.reviewerNotes).toBe("Missing signature");
      expect(updatedCase.declarationStatus).toBe("rejected");

      expect(sendDeclarationRejectedEmail).toHaveBeenCalledTimes(1);
      expect(sendDeclarationApprovedEmail).not.toHaveBeenCalled();

      const rejectedAudits = emailAudits("declaration-rejected");
      expect(rejectedAudits).toHaveLength(1);
      expect(rejectedAudits[0].action).toBe("email_declaration-rejected");
      expect(emailAudits("declaration-approved")).toHaveLength(0);
    });

    it("no-op: re-approving an already-approved submission does NOT send a duplicate email or audit", async () => {
      // First call: a real approve. Verify the email + audit fired.
      const first = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "approved" });
      expect(first.status).toBe(200);
      expect(sendDeclarationApprovedEmail).toHaveBeenCalledTimes(1);
      expect(emailAudits("declaration-approved")).toHaveLength(1);

      // Second call with the same status — declarationRow is now
      // already "approved", so the no-op guard must short-circuit the
      // notification path. The route still returns 200 and updates the
      // row (idempotent at the DB layer), but NO new email + NO new
      // email_<tag> audit row may be written.
      const second = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "approved" });
      expect(second.status).toBe(200);
      expect(sendDeclarationApprovedEmail).toHaveBeenCalledTimes(1);
      expect(emailAudits("declaration-approved")).toHaveLength(1);
      // And of course the rejection twin never fires.
      expect(sendDeclarationRejectedEmail).not.toHaveBeenCalled();
      expect(emailAudits("declaration-rejected")).toHaveLength(0);
    });

    it("does not send a review email when the case has no email on file", async () => {
      beforeCase = { ...baseCase, userEmail: null };

      const res = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "approved" });

      expect(res.status).toBe(200);
      expect(sendDeclarationApprovedEmail).not.toHaveBeenCalled();
      expect(emailAudits("declaration-approved")).toHaveLength(0);
    });

    it("rejects an invalid status enum with 400 and emits no email/audit", async () => {
      const res = await request(app)
        .patch("/api/admin/declaration-submissions/1/status")
        .set(auth)
        .send({ status: "submitted" });

      expect(res.status).toBe(400);
      expect(sendDeclarationApprovedEmail).not.toHaveBeenCalled();
      expect(sendDeclarationRejectedEmail).not.toHaveBeenCalled();
      expect(emailAudits("declaration-approved")).toHaveLength(0);
      expect(emailAudits("declaration-rejected")).toHaveLength(0);
    });
  });
});
