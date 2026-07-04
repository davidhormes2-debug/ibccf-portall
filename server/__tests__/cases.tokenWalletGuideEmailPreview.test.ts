import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "tws-guide-preview-test-admin";
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

let currentCase: any = null;

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
    getCaseById: vi.fn(async () => currentCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => ({
      ...(currentCase ?? {}),
      ...data,
    })),
    createCase: vi.fn(),
    getAllCases: vi.fn(),
    getCaseByAccessCode: vi.fn(),
    getCaseById: vi.fn(async () => currentCase),
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    buildTokenWalletSetupGuideEmailHtml: vi.fn(
      (_userName: string, _caseReference: string, _opts: any) => ({
        subject: `Your Token Wallet Setup Guide Is Ready — Case ${_caseReference}`,
        preheader: "Your compliance officer has shared your token wallet setup guide.",
        html: `<html><body>Dear ${_userName}, Link: ${_opts.setupLink}${_opts.note ? `, Note: ${_opts.note}` : ""}</body></html>`,
      }),
    ),
    sendTokenWalletSetupGuideEmail: vi.fn(async () => ({ success: true })),
    sendTokenWalletSetupConfirmedEmail: vi.fn(async () => ({ success: true })),
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
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
    let sendResult: { success: boolean; error?: string } = { success: true };
    try {
      sendResult = await params.send();
    } catch {
      sendResult = { success: false };
    }
    auditLogs.push({
      action: sendResult.success ? `email_${params.tag}` : `email_${params.tag}_failed`,
      targetType: "case",
      targetId: params.caseId,
      adminUsername: params.adminUser ?? "system",
      newValue: sendResult.success
        ? `Email sent (${params.tag}) to ${params.to}`
        : `Email send failed (${params.tag}) to ${params.to}`,
    });
    return { sent: sendResult.success };
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
  id: "CASE-GUIDE-PREV-1",
  accessCode: "GUID-0001",
  userName: "Guide Preview User",
  userEmail: "guidepreview@example.com",
  status: "active",
  letterSent: false,
  tokenWalletSetupLink: "https://setup.example.com/guide",
  tokenWalletSetupNote: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  auditLogs.length = 0;
  sentEmails.length = 0;
  currentCase = { ...baseCase };
});

// ---------------------------------------------------------------------------
// GET /api/cases/:id/token-wallet-guide-email-preview
// ---------------------------------------------------------------------------

describe("GET /api/cases/:id/token-wallet-guide-email-preview", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get(
      "/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview",
    );
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the case does not exist", async () => {
    currentCase = null;

    const res = await request(app)
      .get("/api/cases/CASE-MISSING/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the case has no email address on file", async () => {
    currentCase = { ...baseCase, userEmail: null };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 400 when the case has no wallet setup URL saved", async () => {
    currentCase = { ...baseCase, tokenWalletSetupLink: null };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/wallet setup url/i);
  });

  it("returns 400 when the wallet setup URL is blank whitespace", async () => {
    currentCase = { ...baseCase, tokenWalletSetupLink: "   " };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with subject, preheader, html, to, userName, and caseReference", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("subject");
    expect(res.body).toHaveProperty("preheader");
    expect(res.body).toHaveProperty("html");
    expect(res.body).toHaveProperty("to");
    expect(res.body).toHaveProperty("userName");
    expect(res.body).toHaveProperty("caseReference");
  });

  it("returns the correct recipient email in the 'to' field", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.to).toBe("guidepreview@example.com");
  });

  it("returns the case id as the caseReference", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.caseReference).toBe("CASE-GUIDE-PREV-1");
  });

  it("returns the userName from the case record", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.userName).toBe("Guide Preview User");
  });

  it("falls back to the email address as userName when userName is blank", async () => {
    currentCase = { ...baseCase, userName: "   " };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.userName).toBe("guidepreview@example.com");
  });

  it("calls buildTokenWalletSetupGuideEmailHtml with resolved userName, case id, and setup link", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    const { emailService } = await import("../services/EmailService");
    expect(emailService.buildTokenWalletSetupGuideEmailHtml).toHaveBeenCalledOnce();
    expect(emailService.buildTokenWalletSetupGuideEmailHtml).toHaveBeenCalledWith(
      "Guide Preview User",
      "CASE-GUIDE-PREV-1",
      expect.objectContaining({ setupLink: "https://setup.example.com/guide" }),
    );
  });

  it("passes the officer note to buildTokenWalletSetupGuideEmailHtml when one is set", async () => {
    currentCase = { ...baseCase, tokenWalletSetupNote: "Please act quickly." };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    const { emailService } = await import("../services/EmailService");
    expect(emailService.buildTokenWalletSetupGuideEmailHtml).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ note: "Please act quickly." }),
    );
  });

  it("passes null note to buildTokenWalletSetupGuideEmailHtml when no note is set", async () => {
    currentCase = { ...baseCase, tokenWalletSetupNote: null };

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    const { emailService } = await import("../services/EmailService");
    expect(emailService.buildTokenWalletSetupGuideEmailHtml).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ note: null }),
    );
  });

  it("returns 500 with an error field when buildTokenWalletSetupGuideEmailHtml throws", async () => {
    const { emailService } = await import("../services/EmailService");
    vi.mocked(emailService.buildTokenWalletSetupGuideEmailHtml).mockImplementationOnce(() => {
      throw new Error("Rendering failure");
    });

    const res = await request(app)
      .get("/api/cases/CASE-GUIDE-PREV-1/token-wallet-guide-email-preview")
      .set(auth);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// POST /api/cases/:id/send-token-wallet-guide-email
// ---------------------------------------------------------------------------

describe("POST /api/cases/:id/send-token-wallet-guide-email", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(
      "/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email",
    );
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the case does not exist", async () => {
    currentCase = null;

    const res = await request(app)
      .post("/api/cases/CASE-MISSING/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the case has no email address on file", async () => {
    currentCase = { ...baseCase, userEmail: null };

    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 400 when the case has no wallet setup URL saved", async () => {
    currentCase = { ...baseCase, tokenWalletSetupLink: null };

    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/wallet setup url/i);
  });

  it("returns 400 when the wallet setup URL is blank whitespace", async () => {
    currentCase = { ...baseCase, tokenWalletSetupLink: "   " };

    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("responds immediately with success: true and emailDispatched: true", async () => {
    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("response includes a message field confirming the email was queued", async () => {
    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it("dispatches the email via sendCaseEmailWithAudit with tag token_wallet_setup_link_sent", async () => {
    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));

    expect(sentEmails[0].tag).toBe("token_wallet_setup_link_sent");
    expect(sentEmails[0].to).toBe("guidepreview@example.com");
    expect(sentEmails[0].caseId).toBe("CASE-GUIDE-PREV-1");
  });

  it("calls sendTokenWalletSetupGuideEmail with correct args via the fire-and-forget path", async () => {
    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      "guidepreview@example.com",
      "Guide Preview User",
      "CASE-GUIDE-PREV-1",
      expect.objectContaining({ setupLink: "https://setup.example.com/guide" }),
    );
  });

  it("uses the email address as userName when userName is blank", async () => {
    currentCase = { ...baseCase, userName: "" };

    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      "guidepreview@example.com",
      "guidepreview@example.com",
      "CASE-GUIDE-PREV-1",
      expect.any(Object),
    );
  });

  it("passes the officer note in the send call when one is saved", async () => {
    currentCase = { ...baseCase, tokenWalletSetupNote: "Urgent: complete by Friday." };

    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ note: "Urgent: complete by Friday." }),
    );
  });

  it("creates an audit log entry with email_token_wallet_setup_link_sent after a successful send", async () => {
    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_token_wallet_setup_link_sent");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-GUIDE-PREV-1");
  });

  it("creates an _failed audit log entry when the email send throws", async () => {
    const { emailService } = await import("../services/EmailService");
    vi.mocked(emailService.sendTokenWalletSetupGuideEmail).mockRejectedValueOnce(
      new Error("SMTP timeout"),
    );

    await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_token_wallet_setup_link_sent_failed");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-GUIDE-PREV-1");
  });

  it("still returns 200 when the email send fails (fire-and-forget)", async () => {
    const { emailService } = await import("../services/EmailService");
    vi.mocked(emailService.sendTokenWalletSetupGuideEmail).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    const res = await request(app)
      .post("/api/cases/CASE-GUIDE-PREV-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });
});
