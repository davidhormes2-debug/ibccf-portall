import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const ADMIN_TOKEN = "admin-token-test";

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || "test-admin";

const auditLogs: any[] = [];
let alertSetting: {
  recipients: string[];
  value: string;
  source: "env" | "db" | "default";
  envOverride: boolean;
  storedValue: string;
  updatedAt: Date | null;
  updatedBy: string | null;
} = {
  recipients: ["docs-ops@example.com"],
  value: "docs-ops@example.com",
  source: "db",
  envOverride: false,
  storedValue: "docs-ops@example.com",
  updatedAt: null,
  updatedBy: null,
};
let sendResultOverride: { success: boolean; error?: string } = { success: true };
let sendShouldThrow: Error | null = null;
const sendCalls: any[] = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
            adminUsername: process.env.ADMIN_USERNAME,
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

vi.mock("../routes/content", () => ({
  readDocumentUploadAlertEmailSetting: vi.fn(async () => alertSetting),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendUserDocumentUploadedAlert: vi.fn(async (opts: any) => {
      sendCalls.push(opts);
      if (sendShouldThrow) throw sendShouldThrow;
      return sendResultOverride;
    }),
  }),
}));

let cachedAdminRouter: Router | null = null;

function buildApp() {
  if (!cachedAdminRouter) {
    throw new Error("adminRouter not loaded yet; beforeAll must run first");
  }
  const app = express();
  app.use(express.json());
  app.use("/api/admin", cachedAdminRouter);
  return app;
}

describe("POST /api/admin/settings/document-upload-alert-email/test", () => {
  beforeAll(async () => {
    const mod = await import("../routes/admin");
    cachedAdminRouter = mod.adminRouter;
  });

  beforeEach(() => {
    auditLogs.length = 0;
    sendCalls.length = 0;
    sendResultOverride = { success: true };
    sendShouldThrow = null;
    alertSetting = {
      recipients: ["docs-ops@example.com"],
      value: "docs-ops@example.com",
      source: "db",
      envOverride: false,
      storedValue: "docs-ops@example.com",
      updatedAt: null,
      updatedBy: null,
    };
  });

  it("requires admin auth", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/admin/settings/document-upload-alert-email/test")
      .send({});
    expect(res.status).toBe(401);
  });

  it("success path: returns 200 + recipients and writes email_document_upload_alert_test audit", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/admin/settings/document-upload-alert-email/test")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      recipients: ["docs-ops@example.com"],
      source: "db",
    });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({
      to: ["docs-ops@example.com"],
      caseId: "CASE-0000",
      documentType: "Identity Verification (KYC)",
      fileName: "example-document.pdf",
      testMode: true,
    });
    const successAudits = auditLogs.filter(
      (a) => a.action === "email_document_upload_alert_test",
    );
    expect(successAudits).toHaveLength(1);
    expect(successAudits[0].targetType).toBe("app_setting");
    expect(successAudits[0].targetId).toBe("document_upload_alert_email");
    expect(successAudits[0].newValue).toContain("docs-ops@example.com");
    expect(
      auditLogs.some(
        (a) => a.action === "email_document_upload_alert_test_failed",
      ),
    ).toBe(false);
  });

  it("no-recipient path: returns 400 and writes email_document_upload_alert_test_failed audit", async () => {
    alertSetting = {
      recipients: [],
      value: "",
      source: "default",
      envOverride: false,
      storedValue: "",
      updatedAt: null,
      updatedBy: null,
    };
    const app = await buildApp();
    const res = await request(app)
      .post("/api/admin/settings/document-upload-alert-email/test")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/recipient/i);
    expect(sendCalls).toHaveLength(0);
    const failedAudits = auditLogs.filter(
      (a) => a.action === "email_document_upload_alert_test_failed",
    );
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0].targetType).toBe("app_setting");
    expect(failedAudits[0].targetId).toBe("document_upload_alert_email");
    expect(failedAudits[0].newValue).toMatch(/no recipient/i);
  });

  it("SMTP-failure path: returns 502 and writes email_document_upload_alert_test_failed audit", async () => {
    sendResultOverride = { success: false, error: "SMTP connection refused" };
    const app = await buildApp();
    const res = await request(app)
      .post("/api/admin/settings/document-upload-alert-email/test")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      success: false,
      recipients: ["docs-ops@example.com"],
      source: "db",
    });
    expect(res.body.error).toContain("SMTP connection refused");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].testMode).toBe(true);
    const failedAudits = auditLogs.filter(
      (a) => a.action === "email_document_upload_alert_test_failed",
    );
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0].newValue).toContain("SMTP connection refused");
    expect(failedAudits[0].newValue).toContain("docs-ops@example.com");
    expect(
      auditLogs.some((a) => a.action === "email_document_upload_alert_test"),
    ).toBe(false);
  });

  it("SMTP-throw path: thrown error is caught, returns 502 with the error message", async () => {
    sendShouldThrow = new Error("network down");
    const app = await buildApp();
    const res = await request(app)
      .post("/api/admin/settings/document-upload-alert-email/test")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("network down");
    const failedAudits = auditLogs.filter(
      (a) => a.action === "email_document_upload_alert_test_failed",
    );
    expect(failedAudits).toHaveLength(1);
  });
});
