import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const TEST_ADMIN_USERNAME = "case-ledger-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

/**
 * Task #55 — case-ledger route tests.
 *
 * The router lives at server/routes/caseLedger.ts. It mounts five admin
 * endpoints (list / create / patch / delete / sync) and one portal-facing
 * read endpoint, all under the cases router so `:id` binds to the case row.
 *
 * Every dependency the router touches (storage, email service, portal auth)
 * is mocked here so the suite stays hermetic — no DB, no SMTP, no session
 * store. Auth is mocked to accept any non-empty bearer for admin and any
 * `x-portal-session-token` for the case-scoped portal route.
 */

const auditLogs: any[] = [];
const sentEmails: any[] = [];

let caseRow: any = null;
let ledgerRows: any[] = [];
let nextEntryId = 1;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async () => caseRow),
    updateCase: vi.fn(async (id: string, patch: any) => {
      caseRow = { ...(caseRow ?? {}), ...patch };
      return caseRow;
    }),
    getCaseLedgerEntriesByCaseId: vi.fn(async () =>
      // newest first by entryDate, mirrors the DB ordering
      [...ledgerRows].sort(
        (a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
      ),
    ),
    getCaseLedgerEntryById: vi.fn(async (id: number) =>
      ledgerRows.find((r) => r.id === id),
    ),
    createCaseLedgerEntry: vi.fn(async (data: any) => {
      const row = {
        id: nextEntryId++,
        category: null,
        userNote: null,
        adminNote: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        entryDate: data.entryDate ?? new Date(),
      };
      ledgerRows.push(row);
      return row;
    }),
    updateCaseLedgerEntry: vi.fn(async (id: number, patch: any) => {
      const i = ledgerRows.findIndex((r) => r.id === id);
      if (i === -1) return undefined;
      ledgerRows[i] = { ...ledgerRows[i], ...patch, updatedAt: new Date() };
      return ledgerRows[i];
    }),
    deleteCaseLedgerEntry: vi.fn(async (id: number) => {
      const before = ledgerRows.length;
      ledgerRows = ledgerRows.filter((r) => r.id !== id);
      return ledgerRows.length < before;
    }),
    computeCaseLedgerTotal: vi.fn(async () => {
      if (ledgerRows.length === 0) return "";
      let total = 0;
      for (const r of ledgerRows) {
        const n = Number.parseFloat(String(r.amount ?? "").replace(/,/g, ""));
        if (!Number.isFinite(n)) continue;
        total += r.direction === "debit" ? -n : n;
      }
      const asset =
        ([...ledgerRows].sort(
          (a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
        )[0]?.asset || "USDT").trim() || "USDT";
      return `${total.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${asset}`;
    }),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
    // Task #173 — the ledger routes now wrap their row + audit writes
    // in storage.runInTransaction. For these hermetic mocks we just
    // execute the callback inline with a stub executor; the mocked
    // helpers ignore the executor argument so behaviour is unchanged.
    runInTransaction: vi.fn(async (fn: any) => fn({})),
    // Admin auth middleware uses these:
    getAdminSessionByToken: vi.fn(async () => ({
      id: "sess-1",
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      adminUsername: TEST_ADMIN_USERNAME,
    })),
    updateAdminSessionActivity: vi.fn(async () => {}),
  }),
}));

vi.mock("../services/portal-auth", () => ({
  // Allow callers presenting a non-empty x-portal-session-token through.
  requirePortalAccess: (req: any, res: any, next: any) => {
    const t = req.headers["x-portal-session-token"];
    if (typeof t === "string" && t.length > 0) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendCustomCaseEmail: vi.fn(async () => ({ success: true })),
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
    await params.send("en");
    return { sent: true };
  }),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// Import the router AFTER all vi.mock calls so the mocked modules resolve.
const { registerCaseLedgerRoutes } = await import("../routes/caseLedger");
const { Router } = await import("express");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const casesRouter = Router();
  registerCaseLedgerRoutes(casesRouter);
  app.use("/api/cases", casesRouter);
  return app;
}

const baseCase = {
  id: "case-1",
  accessCode: "ABCD-1234",
  userName: "Test User",
  userEmail: "user@example.com",
  status: "active",
  userBalance: null,
  userBalanceLastSyncedTotal: null,
};

beforeEach(() => {
  auditLogs.length = 0;
  sentEmails.length = 0;
  ledgerRows = [];
  nextEntryId = 1;
  caseRow = { ...baseCase };
});

describe("Task #55 — case ledger routes", () => {
  const app = buildApp();
  const adminAuth = { Authorization: "Bearer test-admin" };
  const portalAuth = { "x-portal-session-token": "portal-token" };

  it("admin can create a ledger entry, auto-syncs balance, and audit-logs the action", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({
        direction: "credit",
        amount: "500.00",
        asset: "USDT",
        userVisible: true,
        userNote: "Initial credit",
      });

    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({
      direction: "credit",
      amount: "500.00",
      asset: "USDT",
      userVisible: true,
    });
    expect(res.body.newTotal).toBe("500.00 USDT");
    expect(res.body.didSync).toBe(true);
    expect(res.body.manualOverrideActive).toBe(false);
    expect(caseRow.userBalance).toBe("500.00 USDT");
    expect(caseRow.userBalanceLastSyncedTotal).toBe("500.00 USDT");
    expect(auditLogs.some((a) => a.action === "ledger_entry_created")).toBe(true);
    expect(auditLogs.some((a) => a.action === "case_balance_auto_synced")).toBe(true);
  });

  it("rejects invalid amounts at the zod layer", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({ direction: "credit", amount: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("requires admin bearer auth for the admin list endpoint", async () => {
    const res = await request(app).get("/api/cases/case-1/ledger/admin");
    expect(res.status).toBe(401);
  });

  it("portal list returns only userVisible rows and strips adminNote", async () => {
    ledgerRows.push(
      {
        id: 1,
        caseId: "case-1",
        direction: "credit",
        amount: "100.00",
        asset: "USDT",
        category: null,
        entryDate: new Date(),
        userVisible: true,
        userNote: "Visible",
        adminNote: "secret-officer-note",
        createdBy: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        caseId: "case-1",
        direction: "debit",
        amount: "30.00",
        asset: "USDT",
        category: null,
        entryDate: new Date(),
        userVisible: false,
        userNote: null,
        adminNote: "hidden",
        createdBy: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    const res = await request(app)
      .get("/api/cases/case-1/ledger")
      .set(portalAuth);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      direction: "credit",
      amount: "100.00",
      userNote: "Visible",
    });
    expect(res.body[0]).not.toHaveProperty("adminNote");
    expect(res.body[0]).not.toHaveProperty("userVisible");
    expect(res.body[0]).not.toHaveProperty("createdBy");
  });

  it("admin manual balance override stops auto-sync until /sync is called", async () => {
    // Seed: one credit, auto-synced.
    await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({ direction: "credit", amount: "200.00", asset: "USDT" });
    expect(caseRow.userBalance).toBe("200.00 USDT");

    // Admin manually edits the balance — simulate divergence.
    caseRow.userBalance = "999.99 USDT";

    // New entry should NOT overwrite the manual override.
    const res = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({ direction: "credit", amount: "50.00", asset: "USDT" });
    expect(res.status).toBe(201);
    expect(res.body.didSync).toBe(false);
    expect(res.body.manualOverrideActive).toBe(true);
    expect(caseRow.userBalance).toBe("999.99 USDT");
    // ...but the last-synced total IS still refreshed to the new total.
    expect(caseRow.userBalanceLastSyncedTotal).toBe("250.00 USDT");

    // The explicit sync endpoint clears the override.
    const sync = await request(app)
      .post("/api/cases/case-1/ledger/sync")
      .set(adminAuth);
    expect(sync.status).toBe(200);
    expect(sync.body.newTotal).toBe("250.00 USDT");
    expect(sync.body.didSync).toBe(true);
    expect(sync.body.manualOverrideActive).toBe(false);
    expect(caseRow.userBalance).toBe("250.00 USDT");
    expect(auditLogs.some((a) => a.action === "case_balance_manual_sync")).toBe(true);
  });

  it("notifyByEmail dispatches a best-effort email when the case has an email on file", async () => {
    const res = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({
        direction: "credit",
        amount: "75.00",
        asset: "USDT",
        userVisible: true,
        userNote: "Refund",
        notifyByEmail: true,
      });
    expect(res.status).toBe(201);
    // sendCaseEmailWithAudit is invoked async via void; wait a tick for it.
    await new Promise((r) => setTimeout(r, 0));
    expect(sentEmails.some((e) => e.tag === "ledger-entry-added")).toBe(true);
  });

  it("admin can PATCH an entry; re-aggregates the total", async () => {
    const create = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({ direction: "credit", amount: "100.00", asset: "USDT" });
    const id = create.body.entry.id;

    const patch = await request(app)
      .patch(`/api/cases/case-1/ledger/${id}`)
      .set(adminAuth)
      .send({ amount: "175.00" });
    expect(patch.status).toBe(200);
    expect(patch.body.entry.amount).toBe("175.00");
    expect(patch.body.newTotal).toBe("175.00 USDT");
    expect(auditLogs.some((a) => a.action === "ledger_entry_updated")).toBe(true);
  });

  it("admin can DELETE an entry; total goes back to empty when last row gone", async () => {
    const create = await request(app)
      .post("/api/cases/case-1/ledger")
      .set(adminAuth)
      .send({ direction: "credit", amount: "10.00", asset: "USDT" });
    const id = create.body.entry.id;

    const del = await request(app)
      .delete(`/api/cases/case-1/ledger/${id}`)
      .set(adminAuth);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect(del.body.newTotal).toBe("");
    expect(auditLogs.some((a) => a.action === "ledger_entry_deleted")).toBe(true);
  });

  it("returns 404 when patching/deleting an entry that doesn't belong to the case", async () => {
    ledgerRows.push({
      id: 99,
      caseId: "different-case",
      direction: "credit",
      amount: "1.00",
      asset: "USDT",
      category: null,
      entryDate: new Date(),
      userVisible: false,
      userNote: null,
      adminNote: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const patch = await request(app)
      .patch("/api/cases/case-1/ledger/99")
      .set(adminAuth)
      .send({ amount: "2.00" });
    expect(patch.status).toBe(404);

    const del = await request(app)
      .delete("/api/cases/case-1/ledger/99")
      .set(adminAuth);
    expect(del.status).toBe(404);
  });
});
