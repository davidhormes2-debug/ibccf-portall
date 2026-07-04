import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Zod Validation-Leak Tests — PATCH /api/document-requests/:id
//
// The portal document-submission endpoint validates `submittedFileData` and
// `submittedFileName` with Zod. These tests confirm that a malformed body is
// rejected with a plain string error and never exposes raw ZodError internals
// (the `.errors` / `.issues` array, Zod field-level diagnostics, or the word
// "ZodError") to the caller.
//
// The Zod parse is the first operation in the handler — it runs before any
// storage call or portal-auth check — so these tests don't need a live session.
// ============================================================================

vi.mock("../storage", () => ({
  storage: createStorageMock({}),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
  isAuthorizedForCase: vi.fn(async () => true),
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendLocalizedCaseEmail: vi.fn(async () => ({ success: true })),
    sendDocumentRequestedEmail: vi.fn(async () => ({ success: true })),
    sendDocumentApprovedEmail: vi.fn(async () => ({ success: true })),
    sendDocumentRejectedEmail: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/NotificationService", () => ({
  notificationService: {
    notifyAdmin: vi.fn(async () => {}),
  },
}));

const { documentRequestsRouter } = await import("../routes/content");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/document-requests", documentRequestsRouter);
  return app;
}

// ── Helper ───────────────────────────────────────────────────────────────────
function assertNoZodLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/ZodError/i);
  expect(text).not.toMatch(/"errors":\s*\[/);
  expect(text).not.toMatch(/"issues":\s*\[/);
  expect(text).not.toMatch(/"path":/);
  expect(text).not.toMatch(/"code":/);
  expect(text).not.toMatch(/"minimum":/);
  expect(text).not.toMatch(/"maximum":/);
  expect(text).not.toMatch(/"expected":/);
  expect(text).not.toMatch(/"received":/);
}

describe("PATCH /api/document-requests/:id — Zod error not leaked on invalid input", () => {
  it("returns a plain string error when both required fields are missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/document-requests/1")
      .send({});

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when submittedFileData is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/document-requests/1")
      .send({ submittedFileName: "doc.pdf" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when submittedFileName is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/document-requests/1")
      .send({ submittedFileData: "data:application/pdf;base64,abc" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when submittedFileName exceeds max length", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/document-requests/1")
      .send({
        submittedFileData: "data:application/pdf;base64,abc",
        submittedFileName: "F".repeat(256),
      });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });

  it("returns a plain string error when submittedFileData is an empty string", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/api/document-requests/1")
      .send({ submittedFileData: "", submittedFileName: "doc.pdf" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(Array.isArray(res.body.error)).toBe(false);
    assertNoZodLeak(res.body);
  });
});
