import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "payout-wallet-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Mocks ----------------------------------------------------------------
//
// We mock every module that the cases router pulls in so the PATCH handler
// runs in pure isolation (no DB, no SMTP, no real session lookup).

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let beforeCase: any = null;
let updatedCase: any = null;
let lastUpdatePayload: any = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Middleware: accept any non-empty bearer as a valid admin session.
    getAdminSessionByToken: vi.fn(async (token: string) => ({
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
      lastUpdatePayload = data;
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
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
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
    // Invoke send() so the underlying emailService mock is also exercised.
    await params.send();
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Import AFTER vi.mock calls.
const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
  letterSent: false,
  payoutWalletAddress: null,
  payoutWalletAsset: null,
  payoutWalletNetwork: null,
  payoutWalletNote: null,
  payoutWalletVerifiedAt: null,
  payoutWalletVerifiedBy: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  lastUpdatePayload = null;
  updatedCase = null;
  beforeCase = { ...baseCase };
});

describe("PATCH /api/cases/:id — verified payout wallet", () => {
  const app = buildApp();
  const auth = { Authorization: "Bearer test-token" };

  it("(a) strips client-supplied verifiedAt/verifiedBy on a metadata-only PATCH", async () => {
    // Note: only payoutWalletVerifiedBy (text) is sent here because
    // payoutWalletVerifiedAt is a Date column whose drizzle-zod schema
    // would reject an ISO string at parse time — earlier than the strip
    // logic we're trying to exercise. The strip rule applies to BOTH
    // fields identically, so verifying verifiedBy is sufficient.
    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({
        payoutWalletVerifiedBy: "Attacker",
      });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toBeTruthy();
    expect(lastUpdatePayload).not.toHaveProperty("payoutWalletVerifiedAt");
    expect(lastUpdatePayload).not.toHaveProperty("payoutWalletVerifiedBy");
    // No payout audit and no email when nothing actually changed on the wallet.
    expect(auditLogs.find((a) => a.action === "payout_wallet_updated")).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("(b) no-op wallet PATCH (identical values) does not restamp verifiedAt/By or emit audit/email", async () => {
    beforeCase = {
      ...baseCase,
      payoutWalletAddress: "TXyz123",
      payoutWalletAsset: "USDT",
      payoutWalletNetwork: "TRC20",
      payoutWalletNote: null,
      payoutWalletVerifiedAt: new Date("2024-06-01T00:00:00Z"),
      payoutWalletVerifiedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({
        payoutWalletAddress: "TXyz123",
        payoutWalletAsset: "USDT",
        payoutWalletNetwork: "TRC20",
      });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).not.toHaveProperty("payoutWalletVerifiedAt");
    expect(lastUpdatePayload).not.toHaveProperty("payoutWalletVerifiedBy");
    expect(auditLogs.find((a) => a.action === "payout_wallet_updated")).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("(c1) first-set: real change stamps verifiedAt/By, emits payout_wallet_updated audit + 'payout-wallet-set' email", async () => {
    beforeCase = { ...baseCase, payoutWalletAddress: null };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({
        payoutWalletAddress: "TNewAddress999",
        payoutWalletAsset: "USDT",
        payoutWalletNetwork: "TRC20",
      });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.payoutWalletVerifiedAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.payoutWalletVerifiedBy).toBe("Admin");

    const audit = auditLogs.find((a) => a.action === "payout_wallet_updated");
    expect(audit).toBeTruthy();
    expect(audit.targetType).toBe("case");
    expect(audit.targetId).toBe("case-1");
    expect(JSON.parse(audit.previousValue).address).toBeNull();
    expect(JSON.parse(audit.newValue).address).toBe("TNewAddress999");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("payout-wallet-set");
    expect(sentEmails[0].to).toBe("user@example.com");
  });

  it("(c2) subsequent change emits 'payout-wallet-changed' email tag", async () => {
    beforeCase = {
      ...baseCase,
      payoutWalletAddress: "TOldAddress111",
      payoutWalletAsset: "USDT",
      payoutWalletNetwork: "TRC20",
      payoutWalletVerifiedAt: new Date("2024-06-01T00:00:00Z"),
      payoutWalletVerifiedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ payoutWalletAddress: "TBrandNew222" });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload.payoutWalletVerifiedAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload.payoutWalletVerifiedBy).toBe("Admin");

    const audit = auditLogs.find((a) => a.action === "payout_wallet_updated");
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit.previousValue).address).toBe("TOldAddress111");
    expect(JSON.parse(audit.newValue).address).toBe("TBrandNew222");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("payout-wallet-changed");
  });

  it("(d) clearing the address nulls verifiedAt/By and skips the email", async () => {
    beforeCase = {
      ...baseCase,
      payoutWalletAddress: "TOldAddress111",
      payoutWalletAsset: "USDT",
      payoutWalletNetwork: "TRC20",
      payoutWalletVerifiedAt: new Date("2024-06-01T00:00:00Z"),
      payoutWalletVerifiedBy: "PriorAdmin",
    };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ payoutWalletAddress: "" });

    expect(res.status).toBe(200);
    expect(lastUpdatePayload).toHaveProperty("payoutWalletVerifiedAt", null);
    expect(lastUpdatePayload).toHaveProperty("payoutWalletVerifiedBy", null);
    expect(lastUpdatePayload.payoutWalletAddress).toBeNull();

    // Audit still fires for the change.
    expect(auditLogs.find((a) => a.action === "payout_wallet_updated")).toBeTruthy();
    // No email when the address ends up empty.
    expect(sentEmails).toHaveLength(0);
  });

  it("(e) letterSent false→true still triggers letter-ready email and is unaffected by the payout block", async () => {
    beforeCase = { ...baseCase, letterSent: false };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ letterSent: true });

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].tag).toBe("letter-ready");
    // No payout audit since wallet wasn't touched.
    expect(auditLogs.find((a) => a.action === "payout_wallet_updated")).toBeUndefined();
  });

  it("(e2) letterSent true→true (already sent) does NOT re-fire letter-ready email", async () => {
    beforeCase = { ...baseCase, letterSent: true };

    const res = await request(app)
      .patch("/api/cases/case-1")
      .set(auth)
      .send({ letterSent: true });

    expect(res.status).toBe(200);
    expect(sentEmails.find((e) => e.tag === "letter-ready")).toBeUndefined();
  });
});
