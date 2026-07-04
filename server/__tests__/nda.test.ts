import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";
import type {
  cases as CasesTable,
  caseNdas as CaseNdasTable,
} from "@shared/schema";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `baseCase` and `storedNda` below hand-roll `cases` / `case_ndas` columns.
// These Pick<> declarations fail `npm run check` if any referenced column is
// renamed in shared/schema.ts, preventing silent mock drift.
declare const _casesGuard: Pick<
  typeof CasesTable,
  | "id"
  | "accessCode"
  | "userName"
  | "userEmail"
  | "status"
  | "withdrawalStage"
  | "withdrawalAmount"
  | "payoutWalletAddress"
  | "payoutWalletAsset"
  | "payoutWalletNetwork"
  | "sealedAt"
  | "sealedBy"
  | "stampDutyEnabled"
  | "stampDutyStatus"
>;
declare const _caseNdasGuard: Pick<
  typeof CaseNdasTable,
  | "id"
  | "caseId"
  | "templateVersion"
  | "signedName"
  | "signedAt"
  | "contentHash"
  | "signedPdfBase64"
>;

// `checkAdminAuth` validates session.adminUsername === process.env.ADMIN_USERNAME.
// Pin the env var for the duration of this file so admin-bearer requests pass.
const TEST_ADMIN_USERNAME = "nda-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// ---- Module-level state the mocks read/write ------------------------------
const auditLogs: any[] = [];
const sentEmails: any[] = [];
let beforeCase: any = null;
let storedNda: any = null;
let lastUpdatePayload: any = null;
const appSettings = new Map<string, { key: string; value: string }>();

// ---- Mocks ----------------------------------------------------------------
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
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getCaseById: vi.fn(async () => beforeCase),
    getCaseNdaByCaseId: vi.fn(async () => storedNda),
    getLatestNdaIntegrityCheck: vi.fn(async (caseId: string) => {
      const integrityActions = ["nda_integrity_verified", "nda_integrity_failed"];
      for (let i = auditLogs.length - 1; i >= 0; i--) {
        const a = auditLogs[i];
        if (a.targetType === "case" && a.targetId === caseId && integrityActions.includes(a.action)) {
          return { ...a, id: i + 1, createdAt: new Date() };
        }
      }
      return undefined;
    }),
    createCaseNda: vi.fn(async (data: any) => {
      storedNda = { id: 1, ...data };
      return storedNda;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    getAppSetting: vi.fn(async (key: string) => appSettings.get(key)),
    setAppSetting: vi.fn(async (key: string, value: string, _by: string | null) => {
      const row = { key, value };
      appSettings.set(key, row);
      return row;
    }),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
      lastUpdatePayload = data;
      beforeCase = { ...(beforeCase ?? {}), ...data };
      return beforeCase;
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
    sendSettlementSealedEmail: vi.fn(async () => ({ success: true })),
    sendPayoutWalletEmail: vi.fn(async () => ({ success: true })),
    sendLetterReadyEmail: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: vi.fn(async (params: any) => {
    sentEmails.push({ tag: params.tag, caseId: params.caseId, to: params.to });
    await params.send("en");
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Treat any non-empty bearer as a valid portal session for the case.
// Mirror the real auth wiring: portal callers use `x-portal-session-token`
// (the Authorization header is reserved for admin bearer tokens). Tests
// that send only `Authorization: Bearer ...` must therefore be rejected
// by requirePortalAccess unless they're hitting an admin-only route.
vi.mock("../services/portal-auth", () => ({
  requirePortalAccess: (req: any, res: any, next: any) => {
    if (!req.headers["x-portal-session-token"]) return res.status(401).end();
    next();
  },
  isAuthorizedForCase: async (req: any) =>
    !!req.headers["x-portal-session-token"] || !!req.headers.authorization,
  requirePortalSessionOnly: (req: any, res: any, next: any) => {
    if (!req.headers["x-portal-session-token"]) {
      return res.status(401).json({ error: "Portal session required" });
    }
    next();
  },
  requireUnsealed: async (req: any, res: any, next: any) => {
    if (beforeCase?.sealedAt) {
      return res.status(423).json({ error: "Case is sealed." });
    }
    next();
  },
}));

const { casesRouter } = await import("../routes/cases");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-nda-1",
  accessCode: "ABCD-9999",
  userName: "Jane Settlement",
  userEmail: "jane@example.com",
  status: "active",
  withdrawalStage: "14",
  withdrawalAmount: "120,000 USDT",
  payoutWalletAddress: "TJaneAddr123",
  payoutWalletAsset: "USDT",
  payoutWalletNetwork: "TRC20",
  sealedAt: null,
  sealedBy: null,
  // Task #72 — Stamp Duty Deposit gate. The baseline fixture disables
  // the gate so the existing NDA-signing tests (which predate stamp
  // duty) continue to seal without uploading a receipt first. The
  // dedicated (sd1/sd2/sd3) tests override these fields explicitly.
  stampDutyEnabled: false,
  stampDutyStatus: "awaiting_upload",
};

beforeEach(async () => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  storedNda = null;
  lastUpdatePayload = null;
  beforeCase = { ...baseCase };
  appSettings.clear();
  const { __resetRuntimeFlagCacheForTests } = await import(
    "../services/runtimeFlags"
  );
  __resetRuntimeFlagCacheForTests();
});

const auth = { "x-portal-session-token": "test-portal-token" };
const adminAuth = { Authorization: "Bearer test-admin-token" };

describe("Sealed Settlement & NDA — routes", () => {
  const app = buildApp();

  it("(a) GET /:id/nda rejects unauthenticated callers", async () => {
    const res = await request(app).get("/api/cases/case-nda-1/nda");
    expect(res.status).toBe(401);
  });

  it("(b) GET /:id/nda returns 409 for cases before stage 14", async () => {
    beforeCase = { ...baseCase, withdrawalStage: "13" };
    const res = await request(app).get("/api/cases/case-nda-1/nda").set(auth);
    expect(res.status).toBe(409);
    expect(res.body.eligible).toBe(false);
  });

  it("(c) POST /:id/nda/sign records signature, seals the case, and emails the user", async () => {
    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });

    expect(res.status).toBe(201);
    expect(res.body.alreadySigned).toBe(false);
    expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedNda).toBeTruthy();
    expect(lastUpdatePayload?.sealedAt).toBeInstanceOf(Date);
    expect(lastUpdatePayload?.sealedBy).toContain("Jane Settlement");
    expect(auditLogs.find((a) => a.action === "case_sealed")).toBeTruthy();
    expect(sentEmails.find((e) => e.tag === "settlement_sealed")).toBeTruthy();
  });

  it("(d) POST /:id/nda/sign is idempotent — second submission returns existing record without re-sealing", async () => {
    // Prime: a previous signature already exists.
    storedNda = {
      id: 7,
      caseId: "case-nda-1",
      templateVersion: "v1.2026.05",
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-01T12:00:00Z"),
      contentHash: "a".repeat(64),
    };
    beforeCase = { ...baseCase, sealedAt: new Date("2026-05-01T12:00:00Z"), sealedBy: "user:Jane Settlement" };

    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });

    expect(res.status).toBe(200);
    expect(res.body.alreadySigned).toBe(true);
    expect(res.body.contentHash).toBe("a".repeat(64));
    // No additional seal mutation, audit, or email.
    expect(lastUpdatePayload).toBeNull();
    expect(auditLogs.find((a) => a.action === "case_sealed")).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  // Task #72 — Stamp Duty Deposit gate (server side).
  it("(sd1) POST /:id/nda/sign is blocked with code stamp_duty_required when stamp duty is enabled and not approved", async () => {
    beforeCase = { ...baseCase, stampDutyEnabled: true, stampDutyStatus: "awaiting_upload" };
    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("stamp_duty_required");
    // No NDA snapshot, no seal mutation, no email.
    expect(storedNda).toBeNull();
    expect(lastUpdatePayload).toBeNull();
    expect(sentEmails.find((e) => e.tag === "settlement_sealed")).toBeUndefined();
    // Blocking event must be audit-logged for traceability.
    expect(
      auditLogs.find((a) => a.action === "nda_sealing_blocked_by_stamp_duty"),
    ).toBeTruthy();
  });

  it("(sd2) POST /:id/nda/sign succeeds when admin has disabled stamp duty for the case", async () => {
    beforeCase = { ...baseCase, stampDutyEnabled: false, stampDutyStatus: "awaiting_upload" };
    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(res.status).toBe(201);
    expect(storedNda).toBeTruthy();
    expect(
      auditLogs.find((a) => a.action === "nda_sealing_blocked_by_stamp_duty"),
    ).toBeUndefined();
  });

  it("(sd3) POST /:id/nda/sign succeeds when stamp duty has been approved", async () => {
    beforeCase = { ...baseCase, stampDutyEnabled: true, stampDutyStatus: "approved" };
    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(res.status).toBe(201);
    expect(storedNda).toBeTruthy();
  });

  it("(e) POST /:id/nda/sign rejects malformed payloads (missing agreement / short name)", async () => {
    const r1 = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "J", agreed: true });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: false });
    expect(r2.status).toBe(400);
  });

  it("(e2) POST /:id/nda/sign clamps to English when client omits locale and case.preferredLocale is not on the allowlist", async () => {
    // Allowlist: en + es only. Case prefers fr (not approved).
    appSettings.set("nda_signing_locales", {
      key: "nda_signing_locales",
      value: JSON.stringify(["en", "es"]),
    });
    beforeCase = { ...baseCase, preferredLocale: "fr" };

    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });

    expect(res.status).toBe(201);
    expect(storedNda).toBeTruthy();
    const rendered = JSON.parse(storedNda.renderedBody);
    expect(rendered.locale).not.toBe("fr");
    expect(rendered.locale).toBe("en");
  });

  it("(e3) POST /:id/nda/sign honours preferredLocale when it IS on the allowlist (no explicit locale sent)", async () => {
    appSettings.set("nda_signing_locales", {
      key: "nda_signing_locales",
      value: JSON.stringify(["en", "es"]),
    });
    beforeCase = { ...baseCase, preferredLocale: "es" };

    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });

    expect(res.status).toBe(201);
    const rendered = JSON.parse(storedNda.renderedBody);
    expect(rendered.locale).toBe("es");
  });

  it("(e4) POST /:id/nda/sign rejects an explicit non-approved locale with 409", async () => {
    appSettings.set("nda_signing_locales", {
      key: "nda_signing_locales",
      value: JSON.stringify(["en", "es"]),
    });
    beforeCase = { ...baseCase, preferredLocale: "en" };

    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true, locale: "fr" });

    expect(res.status).toBe(409);
    expect(storedNda).toBeNull();
    expect(res.body.allowed).toEqual(["en", "es"]);
  });

  it("(f) PATCH /:id refuses to mutate a sealed case (423 Locked) and strips sealedAt/sealedBy from the body", async () => {
    beforeCase = {
      ...baseCase,
      sealedAt: new Date("2026-05-01T12:00:00Z"),
      sealedBy: "user:Jane Settlement",
    };
    const res = await request(app)
      .patch("/api/cases/case-nda-1")
      .set(auth)
      .set(adminAuth)
      .send({ userName: "Tampered Name", sealedAt: null, sealedBy: null });
    expect(res.status).toBe(423);
    expect(lastUpdatePayload).toBeNull();
  });

  it("(g) POST /:id/nda/override-seal requires admin auth (rejects unauth) and a non-trivial reason", async () => {
    beforeCase = { ...baseCase, sealedAt: new Date("2026-05-01T12:00:00Z"), sealedBy: "user:Jane" };
    // Prime: the case has a previously-signed NDA whose evidence
    // must survive the override and be referenced by the audit row.
    storedNda = {
      id: 7,
      caseId: "case-nda-1",
      templateVersion: "v1.2026.05",
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-01T12:00:00Z"),
      contentHash: "a".repeat(64),
    };

    const unauthed = await request(app).post("/api/cases/case-nda-1/nda/override-seal").send({ reason: "Long-enough reason" });
    expect(unauthed.status).toBe(401);

    const shortReason = await request(app)
      .post("/api/cases/case-nda-1/nda/override-seal")
      .set(adminAuth)
      .send({ reason: "no" });
    expect(shortReason.status).toBe(400);

    const ok = await request(app)
      .post("/api/cases/case-nda-1/nda/override-seal")
      .set(adminAuth)
      .send({ reason: "Approved by compliance manager on call ticket 4421." });
    expect(ok.status).toBe(200);
    expect(lastUpdatePayload).toEqual({ sealedAt: null, sealedBy: null, status: "active" });
    // Historical NDA row must be preserved for audit durability.
    expect(storedNda).toBeTruthy();
    const overrideLog = auditLogs.find((a) => a.action === "case_seal_overridden");
    expect(overrideLog).toBeTruthy();
    // Override audit row must reference the prior NDA's integrity hash.
    expect(overrideLog.newValue).toContain("a".repeat(64));
  });

  it("(g2) override→re-sign lifecycle: portal sees unsigned preview after override and re-sign inserts a new row", async () => {
    // Start sealed with a signed NDA on file.
    beforeCase = { ...baseCase, sealedAt: new Date("2026-05-01T12:00:00Z"), sealedBy: "user:Jane" };
    const priorHash = "a".repeat(64);
    storedNda = {
      id: 7,
      caseId: "case-nda-1",
      templateVersion: "v1.2026.05",
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-01T12:00:00Z"),
      contentHash: priorHash,
      signedPdfBase64: Buffer.from("prior-pdf").toString("base64"),
    };

    // While sealed, portal GET reports signed:true.
    const sealedView = await request(app).get("/api/cases/case-nda-1/nda").set(auth);
    expect(sealedView.status).toBe(200);
    expect(sealedView.body.signed).toBe(true);
    expect(sealedView.body.contentHash).toBe(priorHash);

    // Admin overrides the seal.
    const override = await request(app)
      .post("/api/cases/case-nda-1/nda/override-seal")
      .set(adminAuth)
      .send({ reason: "Compliance reopened per ticket #99887." });
    expect(override.status).toBe(200);
    expect(beforeCase.sealedAt).toBeNull();
    // Historical row preserved.
    expect(storedNda).toBeTruthy();
    expect(storedNda.contentHash).toBe(priorHash);

    // Portal GET must now serve the unsigned preview, NOT the prior signed view.
    const unsealedView = await request(app).get("/api/cases/case-nda-1/nda").set(auth);
    expect(unsealedView.status).toBe(200);
    expect(unsealedView.body.signed).toBe(false);
    expect(unsealedView.body.sealed).toBe(false);
    expect(unsealedView.body.contentHash).toBeUndefined();

    // Portal PDF must NOT return the prior signed artifact. After
    // override it serves a fresh preview (no X-Content-Hash header).
    const portalPdf = await request(app).get("/api/cases/case-nda-1/nda/pdf").set(auth);
    expect(portalPdf.headers["x-content-hash"]).toBeUndefined();

    // Admin can still re-download the historical artifact for audit.
    const adminPdf = await request(app).get("/api/cases/case-nda-1/nda/pdf").set(adminAuth);
    expect(adminPdf.status).toBe(200);
    expect(adminPdf.headers["x-content-hash"]).toBe(priorHash);

    // User re-signs — a fresh row is inserted and the case is re-sealed.
    const resign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect([200, 201]).toContain(resign.status);
    expect(resign.body.alreadySigned).not.toBe(true);
    expect(storedNda.contentHash).not.toBe(priorHash);
    expect(beforeCase.sealedAt).toBeTruthy();
  });
});

// Supertest does not buffer `application/pdf` into `res.body` by default
// (superagent treats it as text). Use the explicit binary parser so we
// can SHA-256 the exact bytes the route emitted.
function binaryParser(res: any, cb: (err: any, body: Buffer) => void) {
  const data: Buffer[] = [];
  res.on("data", (chunk: Buffer) => data.push(chunk));
  res.on("end", () => cb(null, Buffer.concat(data)));
}

describe("Sealed Settlement & NDA — admin on-demand verify endpoint", () => {
  const app = buildApp();

  it("(v1) POST /:id/nda/verify requires admin auth", async () => {
    storedNda = {
      id: 7,
      caseId: "case-nda-1",
      templateVersion: "v1.2026.05",
      signedName: "Jane",
      signedAt: new Date(),
      contentHash: "a".repeat(64),
      signedPdfBase64: Buffer.from("pdf-bytes").toString("base64"),
    };
    const res = await request(app).post("/api/cases/case-nda-1/nda/verify");
    expect(res.status).toBe(401);
  });

  it("(v2) POST /:id/nda/verify returns 404 when no NDA on file", async () => {
    storedNda = null;
    const res = await request(app)
      .post("/api/cases/case-nda-1/nda/verify")
      .set(adminAuth);
    expect(res.status).toBe(404);
  });

  it("(v3) re-hashing untouched stored bytes returns ok=true and writes nda_integrity_verified", async () => {
    const sign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(sign.status).toBe(201);
    const storedHash: string = sign.body.contentHash;

    const verify = await request(app)
      .post("/api/cases/case-nda-1/nda/verify")
      .set(adminAuth);
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.recomputedHash).toBe(storedHash);
    expect(auditLogs.find((a) => a.action === "nda_integrity_verified")).toBeTruthy();
    expect(auditLogs.find((a) => a.action === "nda_integrity_failed")).toBeUndefined();
  });

  it("(v4) tampered stored bytes produce ok=false and write nda_integrity_failed", async () => {
    const sign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(sign.status).toBe(201);
    const storedHash: string = sign.body.contentHash;

    // Tamper with the persisted PDF bytes (simulates DB-level edit).
    const originalBytes = Buffer.from(storedNda.signedPdfBase64, "base64");
    const tampered = Buffer.from(originalBytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    storedNda = { ...storedNda, signedPdfBase64: tampered.toString("base64") };

    const verify = await request(app)
      .post("/api/cases/case-nda-1/nda/verify")
      .set(adminAuth);
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(false);
    expect(verify.body.storedHash).toBe(storedHash);
    expect(verify.body.recomputedHash).not.toBe(storedHash);
    const failLog = auditLogs.find((a) => a.action === "nda_integrity_failed");
    expect(failLog).toBeTruthy();
    expect(failLog.newValue).toContain(storedHash);

    // The metadata endpoint must surface the failed check so the case
    // stays visibly flagged in the admin UI across reloads.
    const meta = await request(app)
      .get("/api/cases/case-nda-1/nda/metadata")
      .set(adminAuth);
    expect(meta.status).toBe(200);
    expect(meta.body.lastIntegrityCheck?.status).toBe("failed");
  });
});

describe("Sealed Settlement & NDA — round-trip PDF integrity", () => {
  const app = buildApp();

  it("(i) portal: GET /:id/nda/pdf after sign re-hashes to the stored contentHash", async () => {
    const sign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(sign.status).toBe(201);
    const storedHash: string = sign.body.contentHash;
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedNda?.contentHash).toBe(storedHash);

    const pdf = await request(app)
      .get("/api/cases/case-nda-1/nda/pdf")
      .set(auth)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["x-content-hash"]).toBe(storedHash);

    const { sha256Hex } = await import("../services/NdaService");
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(sha256Hex(pdf.body as Buffer)).toBe(storedHash);
  });

  it("(j) admin: GET /:id/nda/pdf re-download re-hashes to the stored contentHash", async () => {
    const sign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(sign.status).toBe(201);
    const storedHash: string = sign.body.contentHash;

    const pdf = await request(app)
      .get("/api/cases/case-nda-1/nda/pdf")
      .set(adminAuth)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["x-content-hash"]).toBe(storedHash);

    const { sha256Hex } = await import("../services/NdaService");
    expect(sha256Hex(pdf.body as Buffer)).toBe(storedHash);
  });

  it("(k0) GET /:id/nda/pdf preview clamps to English when preferredLocale is not on the allowlist and no ?locale is sent", async () => {
    const app = buildApp();
    appSettings.set("nda_signing_locales", {
      key: "nda_signing_locales",
      value: JSON.stringify(["en", "es"]),
    });
    // Eligible (stage 14) and NOT signed → unsigned-preview branch.
    beforeCase = { ...baseCase, preferredLocale: "fr" };
    storedNda = null;

    const pdf = await request(app)
      .get("/api/cases/case-nda-1/nda/pdf")
      .set(auth)
      .buffer(true)
      .parse(binaryParser);

    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    // The preview clamps to English, so the French title must NOT be
    // embedded. (The English title is "Sealed Settlement & NDA".)
    const text = (pdf.body as Buffer).toString("binary");
    // French version uses "Règlement Scellé" / "Confidentialité" — make
    // sure the disallowed-locale body is not what we shipped.
    expect(/R[eè]glement Scell[eé]/.test(text)).toBe(false);
  });

  it("(k) tampering one byte of the stored signed PDF breaks the round-trip hash", async () => {
    const sign = await request(app)
      .post("/api/cases/case-nda-1/nda/sign")
      .set(auth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(sign.status).toBe(201);
    const storedHash: string = sign.body.contentHash;

    // Flip one byte of the persisted PDF — simulating tampering at rest.
    // The stored contentHash is unchanged, so the round-trip assertion
    // (sha256(bytes) === storedHash) must now fail.
    const originalBytes = Buffer.from(storedNda.signedPdfBase64, "base64");
    expect(originalBytes.length).toBeGreaterThan(0);
    const tampered = Buffer.from(originalBytes);
    const flipIdx = Math.floor(tampered.length / 2);
    tampered[flipIdx] = tampered[flipIdx] ^ 0x01;
    storedNda = { ...storedNda, signedPdfBase64: tampered.toString("base64") };

    const pdf = await request(app)
      .get("/api/cases/case-nda-1/nda/pdf")
      .set(adminAuth)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    // The header still advertises the originally-recorded hash...
    expect(pdf.headers["x-content-hash"]).toBe(storedHash);

    // ...but a fresh SHA-256 over the served bytes no longer matches,
    // which is exactly how a tampered artifact would be detected.
    const { sha256Hex } = await import("../services/NdaService");
    const recomputed = sha256Hex(pdf.body as Buffer);
    expect(recomputed).not.toBe(storedHash);
    expect(Buffer.compare(pdf.body as Buffer, originalBytes)).not.toBe(0);
  });
});

// Extract human-readable text from a PDFKit-produced PDF buffer by
// inflating every FlateDecode stream and concatenating the result.
// PDFKit compresses content streams by default, so a naive
// `buf.toString()` substring search would miss disclaimer copy that
// lives inside those streams. We deliberately tolerate inflate
// failures (some streams — e.g. embedded font subsets — are binary)
// and just skip them.
function extractPdfText(buf: Buffer): string {
  const zlib = require("zlib") as typeof import("zlib");
  // The full latin1 dump catches uncompressed strings and metadata.
  const out: string[] = [buf.toString("latin1")];
  let i = 0;
  while (true) {
    const start = buf.indexOf("stream", i);
    if (start < 0) break;
    // Skip past "stream" + the single EOL byte(s) PDFKit emits.
    let payloadStart = start + "stream".length;
    if (buf[payloadStart] === 0x0d) payloadStart++;
    if (buf[payloadStart] === 0x0a) payloadStart++;
    const end = buf.indexOf("endstream", payloadStart);
    if (end < 0) break;
    // Trim trailing EOL before "endstream".
    let payloadEnd = end;
    if (buf[payloadEnd - 1] === 0x0a) payloadEnd--;
    if (buf[payloadEnd - 1] === 0x0d) payloadEnd--;
    const slice = buf.subarray(payloadStart, payloadEnd);
    try {
      const inflated = zlib.inflateSync(slice);
      out.push(inflated.toString("latin1"));
    } catch {
      // Not a FlateDecode stream (or already raw) — fall back to raw.
      out.push(slice.toString("latin1"));
    }
    i = end + "endstream".length;
  }
  // PDFKit emits text via TJ arrays of either parens-strings or
  // angle-bracketed hex strings (the latter whenever the text
  // contains any byte outside pure ASCII, e.g. " · " or "Ü"). Decode
  // every <hex> chunk we can find in the inflated content streams so
  // assertions against the human-readable copy succeed regardless of
  // which form PDFKit picked.
  const joined = out.join("\n");
  // First, collapse PDF TJ arrays — `[<48> 30 <65> 10 <6c>] TJ` —
  // into the concatenated decoded text ("Hel..."). PDFKit emits one
  // TJ array per styled run, with per-glyph kerning numbers between
  // hex chunks, so without this pass each character would land in
  // its own token and a substring check would never match.
  const collapsedTj = joined.replace(
    /\[(?:\s*(?:<[0-9a-fA-F]+>|-?\d+(?:\.\d+)?)\s*)+\]/g,
    (m) => {
      const parts: string[] = [];
      m.replace(/<([0-9a-fA-F]+)>/g, (_full, hex: string) => {
        if (hex.length % 2 === 0) {
          parts.push(Buffer.from(hex, "hex").toString("latin1"));
        }
        return "";
      });
      return parts.join("");
    },
  );
  // Then decode any remaining lone <hex> string literals (PDF `Tj`
  // operator form) so non-ASCII copy with high-bit bytes is also
  // surfaced as readable text.
  const decodedHex = collapsedTj.replace(/<([0-9a-fA-F]{2,})>/g, (_m, hex: string) => {
    if (hex.length % 2 !== 0) return _m;
    try {
      return Buffer.from(hex, "hex").toString("latin1");
    } catch {
      return _m;
    }
  });
  return joined + "\n" + decodedHex;
}

describe("Sealed Settlement & NDA — preview translation disclaimer (Task #60 regression)", () => {
  // The disclaimer is conditional on `NDA_TRANSLATIONS_REVIEWED`:
  // once compliance flips it to true, the banner disappears for
  // every locale. These assertions toggle on that flag so the test
  // keeps passing across the eventual cut-over.
  it("(d1) non-English (fr) preview PDF contains the courtesy-translation disclaimer when the flag is still false", async () => {
    const { buildNdaPdf, renderNdaForCase } = await import("../services/NdaService");
    const { NDA_TRANSLATIONS_REVIEWED } = await import("../../shared/ndaTemplate");
    const c: any = { ...baseCase, preferredLocale: "fr" };
    const rendered = renderNdaForCase(c, "fr");
    expect(rendered.locale).toBe("fr");
    const pdf = await buildNdaPdf(rendered); // no signature -> preview
    const text = extractPdfText(pdf);
    if (NDA_TRANSLATIONS_REVIEWED) {
      // Flag flipped: disclaimer must be gone.
      expect(text).not.toContain("Avis de traduction");
      expect(text).not.toContain("à titre de courtoisie");
    } else {
      // Flag still false (current state): disclaimer must travel
      // with the preview PDF if the user prints or shares it.
      expect(text).toContain("Avis de traduction");
      expect(text).toContain("à titre de courtoisie");
    }
  });

  it("(d2) non-English (de) preview PDF also contains the disclaimer when the flag is still false", async () => {
    const { buildNdaPdf, renderNdaForCase } = await import("../services/NdaService");
    const { NDA_TRANSLATIONS_REVIEWED } = await import("../../shared/ndaTemplate");
    const c: any = { ...baseCase, preferredLocale: "de" };
    const rendered = renderNdaForCase(c, "de");
    const pdf = await buildNdaPdf(rendered);
    const text = extractPdfText(pdf);
    if (NDA_TRANSLATIONS_REVIEWED) {
      expect(text).not.toContain("Übersetzungshinweis");
    } else {
      expect(text).toContain("Übersetzungshinweis");
    }
  });

  it("(d3) English preview PDF does NOT contain the disclaimer (English is the controlling text)", async () => {
    const { buildNdaPdf, renderNdaForCase } = await import("../services/NdaService");
    const c: any = { ...baseCase, preferredLocale: "en" };
    const rendered = renderNdaForCase(c, "en");
    expect(rendered.locale).toBe("en");
    const pdf = await buildNdaPdf(rendered);
    const text = extractPdfText(pdf);
    // The English label string itself should never render on an
    // English preview regardless of the flag.
    expect(text).not.toContain("Translation notice");
    expect(text).not.toContain("provided as a courtesy");
  });

  it("(d4) signed PDF (any non-English locale) does NOT contain the disclaimer — preserves byte-stable SHA-256 chain", async () => {
    const { buildNdaPdf, buildNdaVarsForSignedCase, sha256Hex } = await import(
      "../services/NdaService"
    );
    const { renderNda } = await import("../../shared/ndaTemplate");
    const c: any = { ...baseCase, preferredLocale: "fr" };
    const vars = buildNdaVarsForSignedCase(c, "2026-05-17", "fr");
    const rendered = renderNda(vars);
    expect(rendered.locale).toBe("fr");
    const sig = {
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-17T12:34:56Z"),
      signedIp: "203.0.113.10",
      signedUserAgent: "vitest",
    };
    const signed = await buildNdaPdf(rendered, sig);
    const text = extractPdfText(signed);
    // Disclaimer is gated on `!signature` — must be absent in the
    // signed render so existing sealed bytes / hashes never drift.
    expect(text).not.toContain("Avis de traduction");
    expect(text).not.toContain("à titre de courtoisie");
    // Belt-and-braces: re-rendering produces the same hash, proving
    // the signed bytes are deterministic regardless of the flag.
    const again = await buildNdaPdf(rendered, sig);
    expect(sha256Hex(signed)).toBe(sha256Hex(again));
  });
});

describe("Sealed Settlement & NDA — PDF determinism", () => {
  it("(h) two renders of the same signed snapshot produce a byte-identical hash", async () => {
    const { buildNdaPdf, buildNdaVarsForSignedCase, sha256Hex } = await import(
      "../services/NdaService"
    );
    const { renderNda } = await import("../../shared/ndaTemplate");
    const c: any = { ...baseCase };
    const vars = buildNdaVarsForSignedCase(c, "2026-05-17");
    const rendered = renderNda(vars);
    const sig = {
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-17T12:34:56Z"),
      signedIp: "203.0.113.10",
      signedUserAgent: "vitest",
    };
    const a = await buildNdaPdf(rendered, sig);
    const b = await buildNdaPdf(rendered, sig);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(a.length).toBeGreaterThan(1000);
  });

  it("(i) zh-locale PDF embeds a CJK font so Chinese glyphs are present (not Helvetica/WinAnsi)", async () => {
    const { buildNdaPdf, buildNdaVarsForSignedCase, sha256Hex } = await import(
      "../services/NdaService"
    );
    const { renderNda } = await import("../../shared/ndaTemplate");
    const c: any = { ...baseCase, preferredLocale: "zh" };
    const vars = buildNdaVarsForSignedCase(c, "2026-05-17");
    const rendered = renderNda(vars);
    expect(rendered.locale).toBe("zh");
    // Spot-check the localized title is the Chinese version.
    expect(rendered.title).toContain("非披露");

    const sig = {
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-17T12:34:56Z"),
      signedIp: "203.0.113.10",
      signedUserAgent: "vitest",
    };
    const pdf = await buildNdaPdf(rendered, sig);
    const text = pdf.toString("binary");
    // CID-keyed embedded font must be present (Noto Sans SC). Helvetica
    // alone would mean Chinese glyphs are missing.
    expect(/NotoSansSC/.test(text) || /CIDFont/.test(text)).toBe(true);
    // Encoding must NOT be limited to WinAnsi for the body — that's the
    // signature of a Latin-only fallback that cannot render CJK.
    const onlyWinAnsi =
      /WinAnsiEncoding/.test(text) && !/Identity-H/.test(text) && !/CIDFontType/.test(text);
    expect(onlyWinAnsi).toBe(false);
    // Determinism still holds for the zh path.
    const pdf2 = await buildNdaPdf(rendered, sig);
    expect(sha256Hex(pdf)).toBe(sha256Hex(pdf2));
  });

  it("(j) a snapshot signed in one language re-renders to the same bytes after the case's preferred_locale changes", async () => {
    const {
      buildNdaPdf,
      buildNdaVarsForSignedCase,
      extractSnapshotLocale,
      sha256Hex,
    } = await import("../services/NdaService");
    const { renderNda } = await import("../../shared/ndaTemplate");

    // User signs in German.
    const signingTimeCase: any = { ...baseCase, preferredLocale: "de" };
    const signedVars = buildNdaVarsForSignedCase(signingTimeCase, "2026-05-17");
    const signedRendered = renderNda(signedVars);
    expect(signedRendered.locale).toBe("de");
    const sig = {
      signedName: "Jane Settlement",
      signedAt: new Date("2026-05-17T12:34:56Z"),
      signedIp: "203.0.113.10",
      signedUserAgent: "vitest",
    };
    const signedPdf = await buildNdaPdf(signedRendered, sig);
    const signedHash = sha256Hex(signedPdf);
    const renderedBody = JSON.stringify(signedRendered);

    // The user later switches their portal to French. Re-rendering from
    // the snapshot's stored locale must still produce the original German
    // bytes — NOT a fresh French render.
    const laterCase: any = { ...baseCase, preferredLocale: "fr" };
    const snapshotLocale = extractSnapshotLocale(renderedBody);
    expect(snapshotLocale).toBe("de");
    const replayVars = buildNdaVarsForSignedCase(laterCase, "2026-05-17", snapshotLocale);
    const replayPdf = await buildNdaPdf(renderNda(replayVars), sig);
    expect(sha256Hex(replayPdf)).toBe(signedHash);
  });
});
