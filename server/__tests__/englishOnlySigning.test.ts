// Task #87 — Automated coverage proving the signing-locale allowlist
// (Task #88, succeeding the boolean Task #61 flag) is enforced
// everywhere a NEW signing flow could pick a locale. Each assertion
// rewrites the `app_settings.nda_signing_locales` row, bypasses the
// runtimeFlags in-process cache via __resetRuntimeFlagCacheForTests,
// and then re-hits the route to prove the allowlist took effect.

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { cases as CasesTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// `baseCase` below hand-rolls `cases` columns. This Pick<> declaration fails
// `npm run check` if any referenced column is renamed in shared/schema.ts,
// preventing silent mock drift.
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
  | "preferredLocale"
  | "stampDutyEnabled"
  | "sealedAt"
  | "sealedBy"
  | "ndaEnabled"
>;

// ---- Module-level state the mocks read/write ------------------------------
const auditLogs: any[] = [];
const sentEmails: any[] = [];
const appSettings = new Map<string, { key: string; value: string; updatedBy: string | null; updatedAt: Date }>();
let beforeCase: any = null;
let storedNda: any = null;

// ---- Mocks ----------------------------------------------------------------
vi.mock("../storage", () => ({
  storage: createStorageMock({
    // Admin session check — any bearer is accepted.
    getAdminSessionByToken: vi.fn(async () => ({
      id: "session-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getCaseById: vi.fn(async () => beforeCase),
    getAllCases: vi.fn(async () => (beforeCase ? [beforeCase] : [])),
    getCaseNdaByCaseId: vi.fn(async () => storedNda),
    getLatestNdaIntegrityCheck: vi.fn(async () => undefined),
    getLatestNdaIntegrityChecksForCases: vi.fn(async () => new Map()),
    createCaseNda: vi.fn(async (data: any) => {
      storedNda = { id: 1, ...data };
      return storedNda;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    // Task #173 — POST /nda/sign now wraps the createCaseNda +
    // caseService.updateCase + audit triple in a single transaction.
    // The hermetic stub just runs the callback inline with a no-op
    // executor; the mocked helpers ignore the executor argument.
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    getAppSetting: vi.fn(async (key: string) => appSettings.get(key)),
    setAppSetting: vi.fn(async (key: string, value: string, updatedBy?: string | null) => {
      const row = { key, value, updatedBy: updatedBy ?? null, updatedAt: new Date() };
      appSettings.set(key, row);
      return row;
    }),
  }),
}));

vi.mock("../services", () => ({
  caseService: {
    updateCase: vi.fn(async (_id: string, data: any) => {
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

// Auto-finalization is fire-and-forget after sign; stub it out so the
// test doesn't depend on its downstream side effects.
vi.mock("../services/caseFinalize", () => ({
  finalizeCaseAfterNda: vi.fn(async () => {}),
}));

// Portal auth — mirror nda.test.ts: a non-empty x-portal-session-token
// is a valid portal session; admin bearer alone is rejected for portal
// routes. isAuthorizedForCase accepts either (used by the PDF route).
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
    if (beforeCase?.sealedAt) return res.status(423).json({ error: "Case is sealed." });
    next();
  },
}));

const { casesRouter } = await import("../routes/cases");
const {
  NDA_SIGNING_LOCALES_KEY,
  __resetRuntimeFlagCacheForTests,
} = await import("../services/runtimeFlags");
const { extractSnapshotLocale } = await import("../services/NdaService");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-eos-1",
  accessCode: "EOSE-9999",
  userName: "Jane Settlement",
  userEmail: "jane@example.com",
  status: "active",
  withdrawalStage: "14",
  withdrawalAmount: "120,000 USDT",
  payoutWalletAddress: "TJaneAddr123",
  payoutWalletAsset: "USDT",
  payoutWalletNetwork: "TRC20",
  preferredLocale: "en",
  // Task #72 — disable the Stamp Duty Deposit gate so these locale
  // tests can reach the NDA-signing path without uploading a receipt.
  stampDutyEnabled: false,
  sealedAt: null,
  sealedBy: null,
  ndaEnabled: true,
};

// Helper: write the signing-locale allowlist directly through the same
// storage path the runtime service reads from, then drop the 10s
// in-process cache so the next route call observes the new value
// immediately. `englishOnly=true` collapses to ["en"]; `false` opens
// the full six-locale set.
async function setFlag(englishOnly: boolean) {
  const value = englishOnly
    ? ["en"]
    : ["en", "es", "fr", "de", "pt", "zh"];
  appSettings.set(NDA_SIGNING_LOCALES_KEY, {
    key: NDA_SIGNING_LOCALES_KEY,
    value: JSON.stringify(value),
    updatedBy: "test",
    updatedAt: new Date(),
  });
  __resetRuntimeFlagCacheForTests();
}

function binaryParser(res: any, cb: (err: any, body: Buffer) => void) {
  const data: Buffer[] = [];
  res.on("data", (chunk: Buffer) => data.push(chunk));
  res.on("end", () => cb(null, Buffer.concat(data)));
}

// Decode every visible string from a PDFKit-rendered PDF: streams are
// FlateDecoded and body text is emitted as TJ arrays of `<hex>` literals
// (one per Tj run because of character spacing), so a naive
// `pdf.toString()` search misses everything. We inflate each stream,
// pull every `<...>` hex literal and every `(...)` literal, and decode
// the hex to Latin-1 (built-in Helvetica = WinAnsi encoding for the
// Latin locales this test cares about). The resulting blob is enough
// to assert "this PDF contains the English title and not the Spanish
// one" or vice versa.
function decodePdfText(pdf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = pdf.indexOf("stream\n", i);
    if (s < 0) break;
    const e = pdf.indexOf("\nendstream", s);
    if (e < 0) break;
    const data = pdf.subarray(s + 7, e);
    let inflated: Buffer;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const zlib = require("node:zlib") as typeof import("node:zlib");
      inflated = zlib.inflateSync(data);
    } catch {
      i = e + 10;
      continue;
    }
    const str = inflated.toString("binary");
    for (const m of str.matchAll(/<([0-9a-fA-F]+)>/g)) {
      const hex = m[1];
      let decoded = "";
      for (let k = 0; k + 1 < hex.length; k += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      }
      out.push(decoded);
    }
    for (const m of str.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
      out.push(m[1]);
    }
    i = e + 10;
  }
  return out.join(" ");
}

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  appSettings.clear();
  storedNda = null;
  beforeCase = { ...baseCase };
  __resetRuntimeFlagCacheForTests();
});

const portalAuth = { "x-portal-session-token": "test-portal-token" };

describe("Task #87 — Signing-locale allowlist is enforced on every NEW signing path", () => {
  const app = buildApp();

  // -------------------------------------------------------------------
  // (1) Preview JSON — GET /api/cases/:id/nda?locale=fr
  // -------------------------------------------------------------------
  it("GET /nda?locale=fr collapses preview to English when only English is allowed", async () => {
    await setFlag(true);
    const res = await request(app)
      .get("/api/cases/case-eos-1/nda?locale=fr")
      .set(portalAuth);
    expect(res.status).toBe(200);
    expect(res.body.signed).toBe(false);
    // Task #88 replaced the boolean `englishOnlySigning` flag with the
    // full `signingLocales` array so the client can render an accurate
    // picker. When only English is allowed the array is exactly ["en"].
    expect(res.body.signingLocales).toEqual(["en"]);
    expect(res.body.rendered.locale).toBe("en");
    // Spot-check the body really is the English string (not the French
    // one) so a regression that ignored the allowlist but still echoed
    // `locale: "en"` would not pass.
    expect(res.body.rendered.title).toContain("Non-Disclosure");
    expect(res.body.rendered.title).not.toContain("Non-Divulgation");
  });

  it("GET /nda?locale=fr honours the requested French locale when all locales are allowed", async () => {
    await setFlag(false);
    const res = await request(app)
      .get("/api/cases/case-eos-1/nda?locale=fr")
      .set(portalAuth);
    expect(res.status).toBe(200);
    expect(res.body.signingLocales).toEqual(["en", "es", "fr", "de", "pt", "zh"]);
    expect(res.body.rendered.locale).toBe("fr");
    expect(res.body.rendered.title).toContain("Non-Divulgation");
  });

  // -------------------------------------------------------------------
  // (2) Signature snapshot — POST /api/cases/:id/nda/sign { locale }
  // -------------------------------------------------------------------
  it("POST /nda/sign with {locale:'de'} is rejected with 409 when only English is allowed", async () => {
    await setFlag(true);
    const res = await request(app)
      .post("/api/cases/case-eos-1/nda/sign")
      .set(portalAuth)
      .send({ typedName: "Jane Settlement", agreed: true, locale: "de" });
    // Task #88 hardened the sign route into defence-in-depth: a stale
    // client that POSTs a non-allowlisted locale no longer silently
    // collapses to English — the request is rejected outright so the
    // user is forced to refresh and re-pick from the live allowlist.
    expect(res.status).toBe(409);
    expect(res.body.requested).toBe("de");
    expect(res.body.allowed).toEqual(["en"]);
    // No snapshot must have been persisted by a rejected sign attempt.
    expect(storedNda).toBeNull();
    expect(auditLogs.find((a) => a.action === "nda_signed")).toBeUndefined();
  });

  it("POST /nda/sign with no locale seals the snapshot in English when only English is allowed", async () => {
    await setFlag(true);
    const res = await request(app)
      .post("/api/cases/case-eos-1/nda/sign")
      .set(portalAuth)
      .send({ typedName: "Jane Settlement", agreed: true });
    expect(res.status).toBe(201);
    expect(storedNda).toBeTruthy();

    // With no client-supplied locale, the resolver clamps to English
    // because the case's preferredLocale ("en") is on the allowlist.
    expect(extractSnapshotLocale(storedNda.renderedBody)).toBe("en");
    const parsed = JSON.parse(storedNda.renderedBody);
    expect(parsed.locale).toBe("en");
    expect(parsed.title).toContain("Non-Disclosure");

    const signedAudit = auditLogs.find((a) => a.action === "nda_signed");
    expect(signedAudit?.newValue).toContain("locale en");
  });

  it("POST /nda/sign with {locale:'de'} seals the snapshot in German when all locales are allowed", async () => {
    await setFlag(false);
    const res = await request(app)
      .post("/api/cases/case-eos-1/nda/sign")
      .set(portalAuth)
      .send({ typedName: "Jane Settlement", agreed: true, locale: "de" });
    expect(res.status).toBe(201);
    expect(storedNda).toBeTruthy();
    expect(extractSnapshotLocale(storedNda.renderedBody)).toBe("de");
    const parsed = JSON.parse(storedNda.renderedBody);
    expect(parsed.locale).toBe("de");
    expect(parsed.title).toContain("Vergleichsvertrag");

    const signedAudit = auditLogs.find((a) => a.action === "nda_signed");
    expect(signedAudit?.newValue).toContain("locale de");
  });

  // -------------------------------------------------------------------
  // (3) Preview PDF — GET /api/cases/:id/nda/pdf?locale=es
  // -------------------------------------------------------------------
  it("GET /nda/pdf?locale=es produces a PDF whose first text page is English when only English is allowed", async () => {
    await setFlag(true);
    const pdf = await request(app)
      .get("/api/cases/case-eos-1/nda/pdf?locale=es")
      .set(portalAuth)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.isBuffer(pdf.body)).toBe(true);

    // Decode the actual rendered text out of the (FlateDecoded, hex-
    // encoded) PDF content streams and assert English markers ARE
    // present while the Spanish equivalents are NOT — proves the
    // override collapsed to English server-side, not just in the
    // accompanying JSON.
    const text = decodePdfText(pdf.body as Buffer);
    expect(text).toContain("Non-Disclosure");
    expect(text).toContain("WHEREAS");
    expect(text).not.toContain("Acuerdo");
    expect(text).not.toContain("vigencia");
  });

  it("GET /nda/pdf?locale=es renders Spanish when all locales are allowed (control)", async () => {
    await setFlag(false);
    const pdf = await request(app)
      .get("/api/cases/case-eos-1/nda/pdf?locale=es")
      .set(portalAuth)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    const text = decodePdfText(pdf.body as Buffer);
    expect(text).toContain("Acuerdo");
    expect(text).toContain("vigencia");
    expect(text).not.toContain("WHEREAS");
  });
});
