import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "tws-guide-email-test-admin";
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
  id: "case-tws-guide-1",
  accessCode: "ABCD-8888",
  userName: "Guide User",
  userEmail: "guideuser@example.com",
  status: "active",
  letterSent: false,
  tokenWalletSetupLink: null,
  tokenWalletSetupNote: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  auditLogs.length = 0;
  sentEmails.length = 0;
  updatedCase = null;
  beforeCase = { ...baseCase };
});

describe("PATCH /api/cases/:id — token wallet setup guide email", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("(a) link set for first time: fires token_wallet_setup_link_sent and calls sendTokenWalletSetupGuideEmail", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupLink: null, tokenWalletSetupNote: null };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: "https://setup.example.com/guide" });

    expect(res.status).toBe(200);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("token_wallet_setup_link_sent");
    expect(sentEmails[0].to).toBe("guideuser@example.com");
    expect(sentEmails[0].caseId).toBe("case-tws-guide-1");

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce();
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledWith(
      "guideuser@example.com",
      "Guide User",
      "case-tws-guide-1",
      expect.objectContaining({
        setupLink: "https://setup.example.com/guide",
      }),
    );
  });

  it("(b) link unchanged (no-op PATCH): no email dispatched", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupLink: "https://setup.example.com/guide",
      tokenWalletSetupNote: null,
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: "https://setup.example.com/guide" });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(0);

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupGuideEmail).not.toHaveBeenCalled();
  });

  it("(c) link cleared (set to null): no email dispatched even though value changed", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupLink: "https://setup.example.com/guide",
      tokenWalletSetupNote: null,
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: null });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(0);

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupGuideEmail).not.toHaveBeenCalled();
  });

  it("(d) audit row token_wallet_setup_set emitted when link changes", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupLink: null, tokenWalletSetupNote: null };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: "https://setup.example.com/guide" });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_set");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-tws-guide-1");
    const payload = JSON.parse(audit.newValue);
    expect(payload.link).toBe("https://setup.example.com/guide");
  });

  it("(e) note change alone (with existing link) triggers email", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupLink: "https://setup.example.com/guide",
      tokenWalletSetupNote: "Old note",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupNote: "Updated officer note" });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("token_wallet_setup_link_sent");

    const { emailService } = await import("../services/EmailService");
    expect(emailService.sendTokenWalletSetupGuideEmail).toHaveBeenCalledOnce();
  });

  it("(f) audit row NOT emitted when link and note are unchanged", async () => {
    beforeCase = {
      ...baseCase,
      tokenWalletSetupLink: "https://setup.example.com/guide",
      tokenWalletSetupNote: "Some note",
    };

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({
        tokenWalletSetupLink: "https://setup.example.com/guide",
        tokenWalletSetupNote: "Some note",
      });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_set");
    expect(audit).toBeUndefined();
  });

  it("(g) sendCaseEmailWithAudit rejects → PATCH still returns 200 with updated case", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupLink: null, tokenWalletSetupNote: null };

    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    vi.mocked(sendCaseEmailWithAudit).mockRejectedValueOnce(new Error("SMTP timeout"));

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: "https://setup.example.com/guide" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenWalletSetupLink: "https://setup.example.com/guide" });
  });

  it("(h) audit row token_wallet_setup_set still written when sendCaseEmailWithAudit throws", async () => {
    beforeCase = { ...baseCase, tokenWalletSetupLink: null, tokenWalletSetupNote: null };

    const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
    vi.mocked(sendCaseEmailWithAudit).mockRejectedValueOnce(new Error("Connection refused"));

    const res = await request(app)
      .patch("/api/cases/case-tws-guide-1")
      .set(auth)
      .send({ tokenWalletSetupLink: "https://setup.example.com/guide" });

    expect(res.status).toBe(200);
    const audit = auditLogs.find((a) => a.action === "token_wallet_setup_set");
    expect(audit).toBeTruthy();
    expect(audit.targetId).toBe("case-tws-guide-1");
  });
});
