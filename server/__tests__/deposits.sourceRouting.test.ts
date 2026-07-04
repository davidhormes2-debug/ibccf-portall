import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// ---------------------------------------------------------------------------
// Server-side source-routing guard for collectMergedReceipts.
//
// The fan-out in collectMergedReceipts uses three branches:
//   wantDeposits — fires when category is in DEPOSIT_RECEIPT_CATEGORIES
//   wantCert     — fires when category === 'certificate'
//   wantStamp    — fires when category === 'stamp_duty'
//
// EXPECTED_SOURCE below is the fully-enumerated, hardcoded map of every known
// category to its source table.  Two guards keep it honest:
//
//  1. A structural guard — EXPECTED_SOURCE must contain exactly the union of
//     DEPOSIT_RECEIPT_CATEGORIES and the two dedicated-table categories.  Any
//     divergence (new category added to one list but not the other) fails here.
//
//  2. Per-category routing tests — for each entry in EXPECTED_SOURCE we hit
//     GET /api/deposits/all-receipts?category=<cat> with fixture rows in ALL
//     three source tables and assert that ONLY rows from the expected source
//     are returned.  Adding a new category to DEPOSIT_RECEIPT_CATEGORIES
//     without a corresponding fan-out branch (or mis-mapping it in
//     EXPECTED_SOURCE) will cause the relevant routing test to fail.
// ---------------------------------------------------------------------------

const TEST_ADMIN_USERNAME = "source-routing-test-admin";
let savedAdminUsername: string | undefined;
beforeAll(() => {
  savedAdminUsername = process.env.ADMIN_USERNAME;
  process.env.ADMIN_USERNAME = TEST_ADMIN_USERNAME;
});
afterAll(() => {
  process.env.ADMIN_USERNAME = savedAdminUsername;
});

// Mutable storage fixtures — reset per test.
let depositRows: any[] = [];
let certRows: any[] = [];
let stampRows: any[] = [];

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

    getAllDepositReceipts: vi.fn(async () => depositRows),
    getAllCertificateFeePayments: vi.fn(async () => certRows),
    getAllStampDutyReceipts: vi.fn(async () => stampRows),

    getCaseById: vi.fn(async (id: string) => ({ id, accessCode: "IBCCF-TEST" })),
    getAllCases: vi.fn(async () => []),
  }),
}));

const { depositsRouter, DEPOSIT_RECEIPT_CATEGORIES } = await import(
  "../routes/deposits"
);

function buildAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/deposits", depositsRouter);
  return app;
}

const app = buildAdminApp();
const auth = { Authorization: "Bearer test-token" };

// ---------------------------------------------------------------------------
// THE MAP TO MAINTAIN.
//
// `certificate` and `stamp_duty` have dedicated source tables.  Every other
// category currently lives in `deposit_receipts` and must appear in
// DEPOSIT_RECEIPT_CATEGORIES (server/routes/deposits.ts).
//
// When you add a new category:
//   • If it belongs in deposit_receipts  → add it to DEPOSIT_RECEIPT_CATEGORIES
//     in deposits.ts.  It will be picked up here automatically via the
//     structural guard below and a routing test will run for it.
//   • If it has a NEW dedicated table    → add a `wantXxx` branch in
//     collectMergedReceipts AND add it to DEDICATED_TABLE_CATEGORIES here.
// ---------------------------------------------------------------------------
const DEDICATED_TABLE_CATEGORIES: Record<string, "certificate" | "stamp_duty"> = {
  certificate: "certificate",
  stamp_duty: "stamp_duty",
};

// Build the full expected map: all deposit categories → 'deposit', plus the
// two dedicated-table overrides.  Using a spread means adding a category to
// DEPOSIT_RECEIPT_CATEGORIES automatically populates the map, so the only
// manual step is for NEW dedicated-table categories.
const EXPECTED_SOURCE: Record<string, "deposit" | "certificate" | "stamp_duty"> = {
  ...Object.fromEntries(
    (DEPOSIT_RECEIPT_CATEGORIES as readonly string[]).map((c) => [c, "deposit" as const]),
  ),
  ...DEDICATED_TABLE_CATEGORIES,
};

// ---------------------------------------------------------------------------
// Fixture rows for the three source tables.
// Every test sets depositRows / certRows / stampRows to these so ALL three
// sources have data — the category filter must suppress two of the three.
// ---------------------------------------------------------------------------

function makeDepositRow(id: number, category: string): any {
  return {
    id,
    caseId: "case-X",
    status: "pending",
    category,
    reissueId: null,
    fileName: `${category}.png`,
    notes: null,
    adminNotes: null,
    uploadedAt: new Date("2026-05-01T00:00:00Z"),
  };
}

function makeCertRow(id: number): any {
  return {
    id,
    caseId: "case-X",
    status: "pending",
    amountUsdt: "300",
    fileName: "cert.png",
    notes: null,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date("2026-05-02T00:00:00Z"),
  };
}

function makeStampRow(id: number): any {
  return {
    id,
    caseId: "case-X",
    status: "pending",
    amountUsdt: "250",
    fileName: "stamp.png",
    notes: null,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date("2026-05-03T00:00:00Z"),
  };
}

beforeEach(() => {
  // One deposit row per known deposit category.
  depositRows = (DEPOSIT_RECEIPT_CATEGORIES as readonly string[]).map(
    (cat, idx) => makeDepositRow(100 + idx, cat),
  );
  // One cert row and one stamp row always present.
  certRows = [makeCertRow(200)];
  stampRows = [makeStampRow(300)];
});

// ---------------------------------------------------------------------------
// Guard 1 — structural coverage
// ---------------------------------------------------------------------------

describe("collectMergedReceipts — EXPECTED_SOURCE structural guard", () => {
  it("EXPECTED_SOURCE covers exactly DEPOSIT_RECEIPT_CATEGORIES + dedicated-table categories", () => {
    const allKnown = [
      ...(DEPOSIT_RECEIPT_CATEGORIES as readonly string[]),
      ...Object.keys(DEDICATED_TABLE_CATEGORIES),
    ].sort();
    const mapKeys = Object.keys(EXPECTED_SOURCE).sort();

    const missing = allKnown.filter((k) => !(k in EXPECTED_SOURCE));
    const extra = mapKeys.filter((k) => !allKnown.includes(k));

    expect(
      missing,
      `Categories known to the fan-out are not in EXPECTED_SOURCE: [${missing.join(", ")}]. ` +
        "Add each to EXPECTED_SOURCE with its correct source table.",
    ).toEqual([]);

    expect(
      extra,
      `EXPECTED_SOURCE has keys not present in DEPOSIT_RECEIPT_CATEGORIES or DEDICATED_TABLE_CATEGORIES: [${extra.join(", ")}]. ` +
        "Remove the stale entry or add the category to the appropriate list.",
    ).toEqual([]);
  });

  it("dedicated-table categories are NOT in DEPOSIT_RECEIPT_CATEGORIES (no overlap)", () => {
    for (const cat of Object.keys(DEDICATED_TABLE_CATEGORIES)) {
      expect(
        (DEPOSIT_RECEIPT_CATEGORIES as readonly string[]).includes(cat),
        `"${cat}" appears in both DEPOSIT_RECEIPT_CATEGORIES and DEDICATED_TABLE_CATEGORIES. ` +
          "A dedicated-table category must NOT be in the deposit fan-out list.",
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — per-category routing via the HTTP endpoint
// ---------------------------------------------------------------------------

describe("collectMergedReceipts — per-category source routing", () => {
  for (const [category, expectedSource] of Object.entries(EXPECTED_SOURCE)) {
    it(`category="${category}" routes exclusively to source="${expectedSource}"`, async () => {
      const res = await request(app)
        .get(`/api/deposits/all-receipts?category=${encodeURIComponent(category)}`)
        .set(auth);

      expect(res.status).toBe(200);

      expect(
        res.body.length,
        `category="${category}" returned no rows — fixture setup may be missing a row for this category.`,
      ).toBeGreaterThan(0);

      const wrongSource = res.body.filter(
        (row: any) => row.source !== expectedSource,
      );
      expect(
        wrongSource,
        `category="${category}" should route to "${expectedSource}" only, ` +
          `but got rows from: [${wrongSource.map((r: any) => r.source).join(", ")}]. ` +
          "Update the wantDeposits / wantCert / wantStamp branches in " +
          "collectMergedReceipts (server/routes/deposits.ts) to match.",
      ).toEqual([]);

      const allMatchCategory = res.body.every(
        (row: any) => row.category === category,
      );
      expect(
        allMatchCategory,
        `category="${category}" filter returned rows with mismatched category fields: ` +
          res.body.map((r: any) => r.category).join(", "),
      ).toBe(true);
    });
  }
});
