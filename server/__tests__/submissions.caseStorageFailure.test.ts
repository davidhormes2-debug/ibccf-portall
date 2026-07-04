import { describe, it, expect, vi } from "vitest";
import express, { Router } from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ============================================================================
// Storage-failure tests — POST /api/cases/:id/submissions
//
// Verifies that when storage.createSubmission (or storage.updateCase) rejects,
// the case-scoped submission route returns 500 with the expected error message
// instead of silently swallowing the failure.
// ============================================================================

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async () => ({
      id: "case-abc",
      userName: "Alice",
      userEmail: "alice@example.com",
      withdrawalAmount: "1500 USDT",
      withdrawalBatches: null,
      preferredLocale: null,
      sealedAt: null,
    })),
    getActiveLetterReissue: vi.fn(async () => null),
    createSubmission: vi.fn(async (data: any) => ({ id: 1, ...data })),
    updateCase: vi.fn(async () => undefined),
    getAdminMessagesByCaseId: vi.fn(async () => []),
    atomicIncrementRateLimit: vi.fn(async ({ windowResetAt }: { windowResetAt: Date }) => ({
      count: 1,
      resetAt: windowResetAt,
    })),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (_req: any, _res: any, next: any) => next(),
  requireUnsealed: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/security", () => ({
  rateLimiter: () => (_req: any, _res: any, next: any) => next(),
  SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE: "submissions_post",
}));

const { storage } = await import("../storage");
const { registerCaseSubmissionRoutes } = await import("../routes/submissions");

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerCaseSubmissionRoutes(router);
  app.use("/api/cases", router);
  return app;
}

const VALID_BODY = {
  selectedOption: "A",
  notes: "Please process my withdrawal.",
  userWithdrawalAmount: "1500 USDT",
};

describe("POST /api/cases/:id/submissions — storage failure returns 500", () => {
  it("returns 500 with the expected error when createSubmission throws", async () => {
    vi.mocked(storage.createSubmission).mockRejectedValueOnce(
      new Error("database is down"),
    );

    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-abc/submissions")
      .send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create submission" });
    expect(vi.mocked(storage.createSubmission)).toHaveBeenCalledOnce();
  });

  it("returns 500 with the expected error when updateCase throws", async () => {
    vi.mocked(storage.createSubmission).mockResolvedValueOnce({
      id: 2,
      caseId: "case-abc",
      selectedOption: "A",
    } as any);
    vi.mocked(storage.updateCase).mockRejectedValueOnce(
      new Error("update failed"),
    );

    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-abc/submissions")
      .send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create submission" });
    expect(vi.mocked(storage.updateCase)).toHaveBeenCalledOnce();
  });

  it("returns 200 and the submission on the happy path", async () => {
    const submission = {
      id: 3,
      caseId: "case-abc",
      selectedOption: "A",
      notes: "Please process my withdrawal.",
      withdrawalAmount: "1500 USDT",
    };
    vi.mocked(storage.createSubmission).mockResolvedValueOnce(submission as any);
    vi.mocked(storage.updateCase).mockResolvedValueOnce(undefined as any);

    const app = buildApp();
    const res = await request(app)
      .post("/api/cases/case-abc/submissions")
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, caseId: "case-abc" });
  });
});
