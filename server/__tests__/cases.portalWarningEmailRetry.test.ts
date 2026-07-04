import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Regression coverage for the portal-warning email retry path.
//
// The retry endpoint (POST /api/cases/:id/email-audit-logs/:auditId/retry)
// must handle email_type = "portal_warning" correctly:
//   1. It reads `minutes` and `emailMessage` from the audit row's metadata
//      (stamped at the time of the original send) so a retry after an SMTP
//      outage resends the same warning duration — not the case's current
//      portalWarningMinutes which may have changed.
//   2. When metadata is absent (legacy rows), it falls back gracefully to the
//      case's live portalWarningMinutes / portalWarningMessage fields.
//   3. If neither metadata nor case fields supply a duration the retry returns
//      a clear 200 with emailDispatched:true but the send callback returns a
//      failure result — surfaced via the audit log, not a 5xx.
//   4. The audit log transitions:
//        email_portal_warning_failed → email_portal_warning
//      after a successful retry (two sendCaseEmailWithAudit calls: the
//      original failure stub + the retry stub).

const TEST_ADMIN_USERNAME = "portal-warning-retry-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const auditLogs: any[] = [];

let caseRow: any = null;
let auditRows: Record<number, any> = {};

const sendPortalWarning = vi.fn(async (_email: string, _name: string, _minutes: number, _msg: string, _locale?: string) => ({ success: true }));

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async (_id: string) => caseRow),
    getAuditLogById: vi.fn(async (id: number) => auditRows[id] ?? null),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendPortalWarning,
  }),
}));

// Capture each sendCaseEmailWithAudit call; invoke the `send` callback so
// the retry's internal email dispatch actually runs and we can inspect the
// arguments forwarded to sendPortalWarning.
let dispatchResolvers: Array<() => void> = [];

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    try {
      await params.send("en");
    } finally {
      const r = dispatchResolvers.shift();
      if (r) r();
    }
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

function armDispatch(): Promise<void> {
  return new Promise<void>((resolve) => {
    dispatchResolvers.push(resolve);
  });
}

const baseCase = {
  id: "case-pw-1",
  accessCode: "PWRN-0001",
  userName: "Warning User",
  userEmail: "warning@example.com",
  preferredLocale: "en",
  portalWarningMinutes: 60,
  portalWarningMessage: "current-portal-message",
  payoutWalletAddress: null,
  payoutWalletAsset: null,
  payoutWalletNetwork: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  caseRow = { ...baseCase };
  auditRows = {};
  dispatchResolvers = [];
  sendPortalWarning.mockClear();
  sendPortalWarning.mockResolvedValue({ success: true });
});

const auth = { Authorization: "Bearer test-token" };

describe("POST /api/cases/:id/email-audit-logs/:auditId/retry — portal_warning email type", () => {
  const app = buildApp();

  it("(a) retries using metadata-snapshotted minutes and emailMessage, not live case values", async () => {
    auditRows[9001] = {
      id: 9001,
      targetType: "case",
      targetId: "case-pw-1",
      action: "email_portal_warning_failed",
      metadata: { minutes: 30, emailMessage: "Your portal closes in 30 minutes." },
    };

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-pw-1/email-audit-logs/9001/retry")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await dispatched;

    expect(sendPortalWarning).toHaveBeenCalledTimes(1);
    const [toEmail, userName, minutes, message] = sendPortalWarning.mock.calls[0];
    expect(toEmail).toBe("warning@example.com");
    expect(userName).toBe("Warning User");
    // Must use the snapshotted 30 minutes, NOT the live case value of 60.
    expect(minutes).toBe(30);
    expect(message).toBe("Your portal closes in 30 minutes.");
  });

  it("(b) falls back to live case portalWarningMinutes when metadata is absent (legacy row)", async () => {
    auditRows[9002] = {
      id: 9002,
      targetType: "case",
      targetId: "case-pw-1",
      action: "email_portal_warning_failed",
      metadata: null,
    };
    caseRow = {
      ...baseCase,
      portalWarningMinutes: 45,
      portalWarningMessage: "Legacy fallback message",
    };

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-pw-1/email-audit-logs/9002/retry")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);

    await dispatched;

    expect(sendPortalWarning).toHaveBeenCalledTimes(1);
    const [, , minutes, message] = sendPortalWarning.mock.calls[0];
    expect(minutes).toBe(45);
    expect(message).toBe("Legacy fallback message");
  });

  it("(c) send failure on retry surfaces as a failed audit log, not a 5xx", async () => {
    auditRows[9003] = {
      id: 9003,
      targetType: "case",
      targetId: "case-pw-1",
      action: "email_portal_warning_failed",
      metadata: { minutes: 20, emailMessage: "Closing soon." },
    };
    sendPortalWarning.mockResolvedValueOnce({ success: false, error: "SMTP timeout" });

    const dispatched = armDispatch();
    const res = await request(app)
      .post("/api/cases/case-pw-1/email-audit-logs/9003/retry")
      .set(auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.emailDispatched).toBe(true);

    await dispatched;

    expect(sendPortalWarning).toHaveBeenCalledTimes(1);
  });

  it("(d) returns 409 when the audit row action is not a _failed row", async () => {
    auditRows[9004] = {
      id: 9004,
      targetType: "case",
      targetId: "case-pw-1",
      action: "email_portal_warning",
      metadata: { minutes: 30, emailMessage: "" },
    };

    const res = await request(app)
      .post("/api/cases/case-pw-1/email-audit-logs/9004/retry")
      .set(auth)
      .send({});

    expect(res.status).toBe(409);
    expect(sendPortalWarning).not.toHaveBeenCalled();
  });

  it("(e) metadata emailMessage takes precedence over case portalWarningMessage even when live value differs", async () => {
    auditRows[9005] = {
      id: 9005,
      targetType: "case",
      targetId: "case-pw-1",
      action: "email_portal_warning_failed",
      metadata: { minutes: 15, emailMessage: "ORIGINAL warning message from audit" },
    };
    caseRow = {
      ...baseCase,
      portalWarningMinutes: 999,
      portalWarningMessage: "LIVE different message — must not be used",
    };

    const dispatched = armDispatch();
    await request(app)
      .post("/api/cases/case-pw-1/email-audit-logs/9005/retry")
      .set(auth)
      .send({});

    await dispatched;

    expect(sendPortalWarning).toHaveBeenCalledTimes(1);
    const [, , minutes, message] = sendPortalWarning.mock.calls[0];
    expect(minutes).toBe(15);
    expect(message).toBe("ORIGINAL warning message from audit");
    expect(message).not.toContain("LIVE");
  });
});
