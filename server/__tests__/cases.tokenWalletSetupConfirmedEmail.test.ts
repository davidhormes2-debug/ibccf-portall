import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "tws-confirm-email-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks ----------------------------------------------------------------

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let beforeCase: any = null;
let updatedCase: any = null;

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
    getCaseById: vi.fn(async () => beforeCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
      updatedCase = { ...(beforeCase ?? {}), ...data };
      return updatedCase;
    }),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(async () => beforeCase),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendTokenWalletSetupConfirmedEmail: vi.fn(async () => ({ success: true })),
    sendTokenWalletSetupUnconfirmedEmail: vi.fn(async () => ({ success: true })),
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
    sendTokenWalletSetupGuideEmail: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({
      tag: params.tag,
      to: params.to,
      caseId: params.caseId,
      adminUser: params.adminUser,
    });
    await params.send();
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-tws-1",
  accessCode: "ABCD-9999",
  userName: "Token User",
  userEmail: "tokenuser@example.com",
  status: "active",
  letterSent: false,
  tokenWalletSetupConfirmed: false,
  tokenWalletSetupConfirmedAt: null,
  tokenWalletSetupConfirmedBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  auditLogs.length = 0;
  sentEmails.length = 0;
  updatedCase = null;
  beforeCase = { ...baseCase };
});

describe("PATCH /api/cases/:id — token wallet setup confirmed email", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("(a) false→true transition: fires email_tws_confirmed and calls sendTokenWalletSetupConfirmedEmail", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupConfirmed: false };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: true });

    expect(res.status).toBe(200);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("email_tws_confirmed");
    expect(sentEmails[0].to).toBe("tokenuser@example.com");
    expect(sentEmails[0].caseId).toBe("case-tws-1");

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledOnce();
    expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledWith(
      "tokenuser@example.com",
      "Token User",
      "case-tws-1",
    );
  });

  it("(b) true→false unconfirm: fires email_tws_unconfirmed (not the confirmed variant)", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupConfirmed: true,
      tokenWalletSetupConfirmedAt: new Date("2025-01-01T00:00:00Z"),
      tokenWalletSetupConfirmedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: false });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("email_tws_unconfirmed");

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupConfirmedEmail).not.toHaveBeenCalled();
    expect(emailService.sendTokenWalletSetupUnconfirmedEmail).toHaveBeenCalledOnce();
  });

  it("(c) true→true no-op: no email dispatched when already confirmed", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupConfirmed: true,
      tokenWalletSetupConfirmedAt: new Date("2025-01-01T00:00:00Z"),
      tokenWalletSetupConfirmedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: true });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(0);

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupConfirmedEmail).not.toHaveBeenCalled();
  });

  it("(d) audit row emitted on false→true transition with correct action", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupConfirmed: false };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: true });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_confirmed");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-tws-1");
    const payload = JSON.parse(audit.newValue);
    expect(payload.confirmed).toBe(true);
  });

  it("(e) audit row emitted on true→false transition with unconfirmed action", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupConfirmed: true,
      tokenWalletSetupConfirmedAt: new Date("2025-01-01T00:00:00Z"),
      tokenWalletSetupConfirmedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: false });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_unconfirmed");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    const payload = JSON.parse(audit.newValue);
    expect(payload.confirmed).toBe(false);
  });

  it("(f) sendCaseEmailWithAudit rejects → PATCH still returns 200 with updated case", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupConfirmed: false };

    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    vi.mocked(sendCaseEmailWithAudit).mockRejectedValueOnce(new Error("SMTP timeout"));

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenWalletSetupConfirmed: true });
  });

  it("(g) audit row token_wallet_setup_confirmed still written when sendCaseEmailWithAudit throws", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupConfirmed: false };

    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    vi.mocked(sendCaseEmailWithAudit).mockRejectedValueOnce(new Error("Connection refused"));

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: true });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_confirmed");
    expect(audit).toBeTruthy();
    expect(audit.targetId).toBe("case-tws-1");
  });

  it("(h) true→false unconfirm: fires email_tws_unconfirmed and calls the unconfirm email method", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupConfirmed: true,
      tokenWalletSetupConfirmedAt: new Date("2025-01-01T00:00:00Z"),
      tokenWalletSetupConfirmedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: false });

    expect(res.status).toBe(200);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("email_tws_unconfirmed");
    expect(sentEmails[0].to).toBe("tokenuser@example.com");
    expect(sentEmails[0].caseId).toBe("case-tws-1");

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupUnconfirmedEmail).toHaveBeenCalledOnce();
    expect(emailService.sendTokenWalletSetupUnconfirmedEmail).toHaveBeenCalledWith(
      "tokenuser@example.com",
      "Token User",
      "case-tws-1",
    );
  });

  // (i) regression guard: the unconfirm email path is wrapped in a best-effort
  // try/catch, so an SMTP failure must never surface as a 500 or swallow the
  // audit row.
  it("(i) true→false unconfirm: sendCaseEmailWithAudit rejects → PATCH still returns 200 and token_wallet_setup_unconfirmed audit row is still written", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupConfirmed: true,
      tokenWalletSetupConfirmedAt: new Date("2025-01-01T00:00:00Z"),
      tokenWalletSetupConfirmedBy: "PriorAdmin",
    };

    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    vi.mocked(sendCaseEmailWithAudit).mockRejectedValueOnce(new Error("SMTP timeout"));

    const res = await request(app)
      .patch("/api/cases/case-tws-1")
      .set(auth)
      .send({ tokenWalletSetupConfirmed: false });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_unconfirmed");
    expect(audit).toBeTruthy();
    expect(audit.targetId).toBe("case-tws-1");
  });
});
