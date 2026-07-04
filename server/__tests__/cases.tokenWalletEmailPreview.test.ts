import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "tws-preview-test-admin";
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
    buildTokenWalletConfirmedEmailHtml: vi.fn(
      (_userName: string, _caseReference: string) => ({
        subject: `Token Wallet Setup Confirmed — Case ${_caseReference}`,
        preheader: "Your token wallet setup has been verified by your compliance officer.",
        html: `<html><body>Dear ${_userName}, Case: ${_caseReference}</body></html>`,
      }),
    ),
    sendTokenWalletSetupConfirmedEmail: vi.fn(async () => ({ success: true })),
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
    let sendResult: { success: boolean; error?: string } = { success: true };
    try {
      sendResult = await params.send();
    } catch {
      sendResult = { success: false };
    }
    // Simulate the audit row that the real sendCaseEmailWithAudit writes via
    // storage.createAuditLog so tests can assert on audit log presence without
    // needing to use the real emailNotify implementation.
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
  id: "CASE-PREVIEW-1",
  accessCode: "PREV-0001",
  userName: "Preview User",
  userEmail: "preview@example.com",
  status: "active",
  letterSent: false,
  tokenWalletSetupLink: "https://wallet.example.com/setup/abc123",
  tokenWalletSetupNote: null,
  tokenWalletSetupConfirmed: false,
  tokenWalletSetupConfirmedAt: null,
  tokenWalletSetupConfirmedBy: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  auditLogs.length = 0;
  sentEmails.length = 0;
  currentCase = { ...baseCase };
});

// ---------------------------------------------------------------------------
// GET /api/cases/:id/token-wallet-email-preview
// ---------------------------------------------------------------------------

describe("GET /api/cases/:id/token-wallet-email-preview", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get(
      "/api/cases/CASE-PREVIEW-1/token-wallet-email-preview",
    );
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the case does not exist", async () => {
    currentCase = null;

    const res = await request(app)
      .get("/api/cases/CASE-MISSING/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the case has no email address on file", async () => {
    currentCase = { ...baseCase, userEmail: null };

    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/email/i);
  });

  it("returns 200 with subject, preheader, html, to, userName, and caseReference", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
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
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.to).toBe("preview@example.com");
  });

  it("returns the case id as the caseReference", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.caseReference).toBe("CASE-PREVIEW-1");
  });

  it("returns the userName from the case record", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.userName).toBe("Preview User");
  });

  it("falls back to the email address as userName when userName is blank", async () => {
    currentCase = { ...baseCase, userName: "   " };

    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.userName).toBe("preview@example.com");
  });

  it("calls buildTokenWalletConfirmedEmailHtml with the resolved userName and case id", async () => {
    const res = await request(app)
      .get("/api/cases/CASE-PREVIEW-1/token-wallet-email-preview")
      .set(auth);

    expect(res.status).toBe(200);
    const { emailService } = await import("../services/EmailService");
    expect(emailService.buildTokenWalletConfirmedEmailHtml).toHaveBeenCalledOnce();
    expect(emailService.buildTokenWalletConfirmedEmailHtml).toHaveBeenCalledWith(
      "Preview User",
      "CASE-PREVIEW-1",
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/cases/:id/send-token-wallet-confirmed-email
// ---------------------------------------------------------------------------

describe("POST /api/cases/:id/send-token-wallet-confirmed-email", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(
      "/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email",
    );
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the case does not exist", async () => {
    currentCase = null;

    const res = await request(app)
      .post("/api/cases/CASE-MISSING/send-token-wallet-confirmed-email")
      .set(auth);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the case has no email address on file", async () => {
    currentCase = { ...baseCase, userEmail: null };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/email/i);
  });

  it("does not dispatch sendCaseEmailWithAudit when userEmail is null at guard time — response carries a descriptive error", async () => {
    currentCase = { ...baseCase, userEmail: null };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    // Guard fires at the top of the route — 400 with a meaningful message.
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(10);
    expect(res.body.error).toMatch(/email/i);

    // IIFE never starts when the top-level guard fires, so dispatch must not fire.
    // The re-fetch inside the IIFE would also catch this, but the guard prevents
    // even reaching the IIFE. We verify no entry appears in sentEmails.
    await vi.waitFor(() => {
      expect(sentEmails).toHaveLength(0);
    });
  });

  it("returns 400 when no wallet setup URL has been saved for the case", async () => {
    currentCase = { ...baseCase, tokenWalletSetupLink: "" };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("does not dispatch sendCaseEmailWithAudit when tokenWalletSetupLink is blank — response carries a descriptive error", async () => {
    currentCase = {
      ...baseCase,
      tokenWalletSetupLink: "",
      userEmail: "preview@example.com",
    };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    // Guard fires before the IIFE — 400 with a meaningful message.
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(10);

    // Wait long enough for any fire-and-forget IIFE to complete, then assert
    // that no dispatch occurred. Using a real timeout (not waitFor, which
    // resolves immediately on first pass) ensures we actually observe the
    // settled state of the async background path.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(sentEmails).toHaveLength(0);
    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(0);
  });

  it("does not dispatch sendCaseEmailWithAudit when userEmail becomes null after the initial fetch (race simulation)", async () => {
    // First getCaseById call (top-level guard): case HAS email → guard passes, 200 sent.
    // Second getCaseById call (IIFE re-fetch): case NOW has null email → IIFE exits early.
    // This simulates a race where the email is cleared between the guard check and dispatch.
    const { storage } = await import("../storage");
    vi.mocked(storage.getCaseById)
      .mockResolvedValueOnce({ ...baseCase, userEmail: "preview@example.com" } as any)
      .mockResolvedValueOnce({ ...baseCase, userEmail: null } as any);

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    // Guard passed — response is 200 (email was present at guard time).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);

    // Wait until the IIFE re-fetch has run (two getCaseById calls means the IIFE
    // completed its null check and either dispatched or bailed out).
    await vi.waitFor(() => {
      expect(vi.mocked(storage.getCaseById)).toHaveBeenCalledTimes(2);
    });

    // The re-fetch returned null email → dispatch must NOT have fired.
    expect(sentEmails).toHaveLength(0);
  });

  it("does not dispatch sendCaseEmailWithAudit when tokenWalletSetupLink is cleared after the initial fetch (race simulation)", async () => {
    // First getCaseById call (top-level guard): case HAS a valid link → guard passes, 200 sent.
    // Second getCaseById call (IIFE re-fetch): link is now blank → IIFE exits early.
    // This simulates a race where the admin clears the wallet URL between the guard and dispatch.
    const { storage } = await import("../storage");
    vi.mocked(storage.getCaseById)
      .mockResolvedValueOnce({ ...baseCase, tokenWalletSetupLink: "https://wallet.example.com/setup/abc123" } as any)
      .mockResolvedValueOnce({ ...baseCase, tokenWalletSetupLink: "" } as any);

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    // Guard passed — response is 200 (link was present at guard time).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);

    // Wait until the IIFE re-fetch has run.
    await vi.waitFor(() => {
      expect(vi.mocked(storage.getCaseById)).toHaveBeenCalledTimes(2);
    });

    // The re-fetch returned a blank link → dispatch must NOT have fired.
    expect(sentEmails).toHaveLength(0);
    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(0);
  });

  it("responds immediately with success and emailDispatched true", async () => {
    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("dispatches the email via sendCaseEmailWithAudit with tag email_tws_confirmed", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));

    expect(sentEmails[0].tag).toBe("email_tws_confirmed");
    expect(sentEmails[0].to).toBe("preview@example.com");
    expect(sentEmails[0].caseId).toBe("CASE-PREVIEW-1");
  });

  it("calls sendTokenWalletSetupConfirmedEmail with correct args via the fire-and-forget path", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledWith(
      "preview@example.com",
      "Preview User",
      "CASE-PREVIEW-1",
    );
  });

  it("uses the email address as userName when userName is blank", async () => {
    currentCase = { ...baseCase, userName: "" };

    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupConfirmedEmail).toHaveBeenCalledWith(
      "preview@example.com",
      "preview@example.com",
      "CASE-PREVIEW-1",
    );
  });

  it("creates an audit log entry with action email_email_tws_confirmed after a successful send", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_email_tws_confirmed");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-PREVIEW-1");
  });

  it("creates an audit log entry with _failed suffix when the email send throws", async () => {
    const { emailService } = await import("../services/EmailService");
    vi.mocked(emailService.sendTokenWalletSetupConfirmedEmail).mockRejectedValueOnce(
      new Error("SMTP timeout"),
    );

    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-confirmed-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_email_tws_confirmed_failed");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-PREVIEW-1");
  });
});

// ---------------------------------------------------------------------------
// POST /api/cases/:id/send-token-wallet-guide-email
// ---------------------------------------------------------------------------

describe("POST /api/cases/:id/send-token-wallet-guide-email", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  const baseCaseWithLink = {
    ...baseCase,
    tokenWalletSetupLink: "https://wallet.example.com/setup/abc123",
    tokenWalletSetupNote: null,
  };

  beforeEach(() => {
    currentCase = { ...baseCaseWithLink };
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).post(
      "/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email",
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
    currentCase = { ...baseCaseWithLink, userEmail: null };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/email/i);
  });

  it("does not dispatch sendCaseEmailWithAudit when userEmail is null at guard time — response carries a descriptive error", async () => {
    currentCase = { ...baseCaseWithLink, userEmail: null };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    // Guard fires before the IIFE — 400 with a meaningful message.
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(10);
    expect(res.body.error).toMatch(/email/i);

    // Wait long enough for any fire-and-forget IIFE to complete, then assert
    // that no dispatch occurred. Using a real timeout (not waitFor, which
    // resolves immediately on first pass) ensures we actually observe the
    // settled state of the async background path.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(sentEmails).toHaveLength(0);
    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(0);
  });

  it("returns 400 when no wallet setup URL has been saved for the case", async () => {
    currentCase = { ...baseCaseWithLink, tokenWalletSetupLink: "" };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("does not dispatch sendCaseEmailWithAudit when tokenWalletSetupLink is blank — response carries a descriptive error", async () => {
    currentCase = {
      ...baseCaseWithLink,
      tokenWalletSetupLink: "",
      userEmail: "preview@example.com",
    };

    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    // Guard fires before the IIFE — 400 with a meaningful message.
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(10);

    // Wait long enough for any fire-and-forget IIFE to complete, then assert
    // that no dispatch occurred. Using a real timeout (not waitFor, which
    // resolves immediately on first pass) ensures we actually observe the
    // settled state of the async background path.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(sentEmails).toHaveLength(0);
    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    expect(vi.mocked(sendCaseEmailWithAudit)).toHaveBeenCalledTimes(0);
  });

  it("responds immediately with success and emailDispatched true", async () => {
    const res = await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailDispatched).toBe(true);
  });

  it("dispatches the email via sendCaseEmailWithAudit with tag token_wallet_setup_link_sent", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(sentEmails).toHaveLength(1));

    expect(sentEmails[0].tag).toBe("token_wallet_setup_link_sent");
    expect(sentEmails[0].to).toBe("preview@example.com");
    expect(sentEmails[0].caseId).toBe("CASE-PREVIEW-1");
  });

  it("calls sendTokenWalletSetupGuideEmail with correct args via the fire-and-forget path", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      "preview@example.com",
      "Preview User",
      "CASE-PREVIEW-1",
      expect.objectContaining({ setupLink: "https://wallet.example.com/setup/abc123" }),
    );
  });

  it("uses the email address as userName when userName is blank", async () => {
    currentCase = { ...baseCaseWithLink, userName: "" };

    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    const { emailService } = await import("../services/EmailService");
    await vi.waitFor(() =>
      expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce(),
    );
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      "preview@example.com",
      "preview@example.com",
      "CASE-PREVIEW-1",
      expect.anything(),
    );
  });

  it("creates an audit log entry with action email_token_wallet_setup_link_sent after a successful send", async () => {
    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_token_wallet_setup_link_sent");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-PREVIEW-1");
  });

  it("creates an audit log entry with _failed suffix when the email send throws", async () => {
    const { emailService } = await import("../services/EmailService");
    vi.mocked(emailService.sendTokenWalletSetupGuideEmail).mockRejectedValueOnce(
      new Error("SMTP timeout"),
    );

    await request(app)
      .post("/api/cases/CASE-PREVIEW-1/send-token-wallet-guide-email")
      .set(auth);

    await vi.waitFor(() => expect(auditLogs).toHaveLength(1));

    const auditEntry = auditLogs[0];
    expect(auditEntry.action).toBe("email_token_wallet_setup_link_sent_failed");
    expect(auditEntry.targetType).toBe("case");
    expect(auditEntry.targetId).toBe("CASE-PREVIEW-1");
  });
});
