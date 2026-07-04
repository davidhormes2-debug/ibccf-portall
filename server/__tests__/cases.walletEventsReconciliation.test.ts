import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ── Regression coverage for Task #787 (timeline reconciliation) ──────────────
//
// GET /api/cases/:id/wallet-events (Task #765) synthesizes a
// `wallet_connect_completed` event from the durable
// `wallet_connect_alert_fired:<caseId>` marker when the best-effort audit row
// is missing (Task #676 made that row best-effort). These tests cover the
// route-level reconciliation that the dispatcher-only suite
// (walletConnectAlert.test.ts) does not exercise:
//   • marker present, no audit row     → exactly one synthesized completion
//   • marker present, audit row present → no duplicate completion
//   • synthesized walletName falls back to cases.walletExchangeName and
//     observedAt is taken from the marker's updatedAt
//
// The wallet-events handler reads the audit timeline via the dynamically
// imported `db` (a select→from→where→orderBy chain) and reconciles via
// `storage.getAppSetting` (marker) + `storage.getCaseById` (wallet fallback).

const TEST_ADMIN_USERNAME = "wallet-events-recon-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

const CASE_ID = "case-1";
const ACCESS_CODE = "ABCD-1234";

// ── DB mock ──────────────────────────────────────────────────────────────────
// The same select→from→where chain backs two callers:
//   1. portal-auth's isCaseSessionRevoked() — awaits `where()` directly and
//      expects an array of case rows.
//   2. the wallet-events handler — calls `.orderBy()` and expects audit rows.
// So `where()` returns a thenable that resolves to the revocation row when
// awaited, and exposes `.orderBy()` that resolves to the audit rows.
let auditRows: any[] = [];
let revocationRow: {
  isDisabled: boolean;
  forceLogoutAt: Date | null;
  accessCode: string;
} | null = { isDisabled: false, forceLogoutAt: null, accessCode: ACCESS_CODE };

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const thenable: any = {
            orderBy: vi.fn(async () => auditRows),
            then: (onFulfilled: any, onRejected: any) =>
              Promise.resolve(revocationRow ? [revocationRow] : []).then(
                onFulfilled,
                onRejected,
              ),
          };
          return thenable;
        }),
      })),
    })),
  },
}));

// ── Storage mock ─────────────────────────────────────────────────────────────
let markerRow: { value: string; updatedAt: Date | null } | undefined;
let caseRow: any = { id: CASE_ID, walletExchangeName: null };
const portalSessionStore = new Map<string, any>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAppSetting: vi.fn(async (key: string) =>
      key.startsWith("wallet_connect_alert_fired:") ? markerRow : undefined,
    ),
    getCaseById: vi.fn(async (_id: string) => caseRow),
    // Portal session persistence backing createSession/validateSession.
    createPortalSession: vi.fn(async (data: any) => {
      const row = { ...data, createdAt: new Date() };
      portalSessionStore.set(data.token, row);
      return row;
    }),
    getPortalSession: vi.fn(async (token: string) =>
      portalSessionStore.get(token),
    ),
    deletePortalSession: vi.fn(async (token: string) => {
      portalSessionStore.delete(token);
    }),
  }),
}));

const { casesRouter } = await import("../routes/cases");
const { createSession } = await import("../services/session-store");
const { storage } = await import("../storage");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/cases", casesRouter);
  return app;
}

const app = buildApp();

async function getWalletEvents(token: string) {
  return request(app)
    .get(`/api/cases/${CASE_ID}/wallet-events`)
    .set("x-portal-session-token", token);
}

describe("GET /api/cases/:id/wallet-events — timeline reconciliation", () => {
  let token: string;

  beforeEach(async () => {
    auditRows = [];
    revocationRow = { isDisabled: false, forceLogoutAt: null, accessCode: ACCESS_CODE };
    markerRow = undefined;
    caseRow = { id: CASE_ID, walletExchangeName: null };
    portalSessionStore.clear();
    token = await createSession(CASE_ID, ACCESS_CODE);
  });

  it("synthesizes a single wallet_connect_completed event when only the marker exists", async () => {
    // No audit row in the timeline, but the durable marker says it fired.
    auditRows = [];
    markerRow = { value: "true", updatedAt: new Date("2026-01-02T03:04:05.000Z") };

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(1);
  });

  it("does not duplicate the completion event when both the marker and the audit row exist", async () => {
    auditRows = [
      {
        action: "wallet_connect_completed",
        newValue: JSON.stringify({ walletName: "MetaMask" }),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    markerRow = { value: "true", updatedAt: new Date("2026-01-02T03:04:05.000Z") };

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(1);
    // The real audit row is preserved (not overwritten by the synthesized one).
    expect(completed[0].walletName).toBe("MetaMask");
    expect(completed[0].observedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back walletName to the case's walletExchangeName and uses the marker's updatedAt for observedAt", async () => {
    auditRows = [];
    caseRow = { id: CASE_ID, walletExchangeName: "Trust Wallet" };
    markerRow = { value: "true", updatedAt: new Date("2026-05-31T12:00:00.000Z") };

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].walletName).toBe("Trust Wallet");
    expect(completed[0].observedAt).toBe("2026-05-31T12:00:00.000Z");
  });

  it("does not synthesize a completion event when the marker is absent", async () => {
    auditRows = [];
    markerRow = undefined;

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(0);
  });

  // ── Best-effort reconciliation failure paths ─────────────────────────────
  //
  // The marker/case reconciliation is wrapped in a try/catch so a failure to
  // reconcile never breaks the timeline fetch — it still returns whatever
  // audit-derived events it has. These guard against a future refactor that
  // moves the failing call outside the catch (which would surface a 500).

  it("still returns 200 with audit events when the marker lookup (getAppSetting) rejects", async () => {
    auditRows = [
      {
        action: "wallet_exchange_selected",
        newValue: JSON.stringify({ walletName: "MetaMask" }),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    (storage.getAppSetting as any).mockRejectedValueOnce(
      new Error("app-setting store unavailable"),
    );

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    // The existing audit-derived event is preserved.
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].action).toBe("wallet_exchange_selected");
    // No completion is synthesized when reconciliation fails.
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(0);
  });

  it("still returns 200 with audit events when the case lookup (getCaseById) rejects", async () => {
    auditRows = [
      {
        action: "wallet_exchange_selected",
        newValue: JSON.stringify({ walletName: "MetaMask" }),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    // Marker present so reconciliation proceeds to the case lookup, which fails.
    markerRow = { value: "true", updatedAt: new Date("2026-01-02T03:04:05.000Z") };
    (storage.getCaseById as any).mockRejectedValueOnce(
      new Error("case store unavailable"),
    );

    const res = await getWalletEvents(token);

    expect(res.status).toBe(200);
    // The existing audit-derived event is preserved; no completion synthesized.
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].action).toBe("wallet_exchange_selected");
    const completed = res.body.events.filter(
      (e: any) => e.action === "wallet_connect_completed",
    );
    expect(completed).toHaveLength(0);
  });
});
