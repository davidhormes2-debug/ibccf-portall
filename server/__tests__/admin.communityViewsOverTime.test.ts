import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { communityThreadViews as CommunityThreadViewsTable } from "@shared/schema";
import { createStorageMock } from "./helpers/storageMock";

// ── Compile-time schema guard ─────────────────────────────────────────────────
// Ensures that if column names used by getCommunityViewsOverTime are renamed in
// shared/schema.ts, TypeScript reports an error here at `npm run check` time.
// communityThreadViews columns asserted: id, threadId, ipHash, hourBucket, createdAt
declare const _communityThreadViewsGuard: Pick<
  typeof CommunityThreadViewsTable,
  "id" | "threadId" | "ipHash" | "hourBucket" | "createdAt"
>;

// ============================================================================
// GET /api/admin/community/views-over-time — Task #549 / Task #650
//
// The endpoint returns hourly view-count buckets from community_thread_views
// for a configurable window (default 48 h, clamped to 1–48).
//
// Tests verify:
//   1. 401 when no Authorization header is supplied.
//   2. 401 when a bogus bearer token is supplied.
//   3. Happy path — returns { data, windowHours } with correct shape.
//   4. Empty window — returns an empty data array, not an error.
//   5. threadId filter — only the matching thread's rows are included.
//   6. hours clamping: values > 48 are clamped to 48.
//   7. hours clamping: values < 1 are clamped to 1.
//   8. hours clamping: a non-numeric hours value defaults to 48.
//   9. Correct response shape when multiple threads are present.
// ============================================================================

const ADMIN_TOKEN = "valid-admin-token-for-views-over-time-test";
const ADMIN_USERNAME = "testadmin-vot";

process.env.ADMIN_USERNAME = ADMIN_USERNAME;
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Str0ng!P@ssw0rdForTests#99";

// ── storage mock ─────────────────────────────────────────────────────────────
const mockGetCommunityViewsOverTime = vi.fn(
  async (_opts: { hours?: number; threadId?: number }) =>
    [] as { hourBucket: string; views: number }[],
);

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-vot-1",
            adminUsername: ADMIN_USERNAME,
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    getAppSetting: vi.fn(async () => null),
    getCommunityViewsOverTime: mockGetCommunityViewsOverTime,
  }),
}));

const { adminRouter } = await import("../routes/admin");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

function auth() {
  return { Authorization: `Bearer ${ADMIN_TOKEN}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return empty array unless overridden in individual tests
  mockGetCommunityViewsOverTime.mockResolvedValue([]);
});

// ── Authentication ────────────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — authentication", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(buildApp()).get(
      "/api/admin/community/views-over-time",
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when a bogus bearer token is supplied", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set("Authorization", "Bearer completely-wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 when a valid bearer token is supplied", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());
    expect(res.status).toBe(200);
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — response shape", () => {
  it("returns an object with data array and windowHours number", async () => {
    mockGetCommunityViewsOverTime.mockResolvedValue([
      { hourBucket: "2026052914", views: 5 },
    ]);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("windowHours");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.windowHours).toBe("number");
  });

  it("forwards hourBucket and views fields from storage unchanged", async () => {
    const rows = [
      { hourBucket: "2026052912", views: 3 },
      { hourBucket: "2026052913", views: 7 },
    ];
    mockGetCommunityViewsOverTime.mockResolvedValue(rows);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(rows);
  });
});

// ── Empty window ──────────────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — empty window", () => {
  it("returns an empty data array when there are no views in the window", async () => {
    mockGetCommunityViewsOverTime.mockResolvedValue([]);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("does not error when storage returns an empty array", async () => {
    mockGetCommunityViewsOverTime.mockResolvedValue([]);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).not.toBe(500);
  });
});

// ── threadId filter ───────────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — threadId filter", () => {
  it("passes threadId to storage when provided as a query param", async () => {
    mockGetCommunityViewsOverTime.mockResolvedValue([
      { hourBucket: "2026052914", views: 2 },
    ]);

    await request(buildApp())
      .get("/api/admin/community/views-over-time?threadId=42")
      .set(auth());

    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 42 }),
    );
  });

  it("does not pass threadId to storage when param is absent", async () => {
    await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.not.objectContaining({ threadId: expect.anything() }),
    );
  });

  it("returns only the filtered thread's rows in the data array", async () => {
    const filteredRows = [{ hourBucket: "2026052914", views: 4 }];
    mockGetCommunityViewsOverTime.mockResolvedValue(filteredRows);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?threadId=99")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(filteredRows);
  });

  it("ignores a non-numeric threadId and omits it from the storage call", async () => {
    await request(buildApp())
      .get("/api/admin/community/views-over-time?threadId=abc")
      .set(auth());

    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.not.objectContaining({ threadId: expect.anything() }),
    );
  });
});

// ── hours clamping ────────────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — hours clamping", () => {
  it("uses 48 as the default windowHours when hours param is absent", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(48);
  });

  it("passes hours=24 through to storage unchanged and reflects it in windowHours", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=24")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(24);
    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 24 }),
    );
  });

  it("clamps hours > 48 to 48 and returns windowHours = 48", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=100")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(48);
    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 48 }),
    );
  });

  it("clamps hours=0 to 1 (minimum valid value) and returns windowHours=1", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=0")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(1);
    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 1 }),
    );
  });

  it("clamps a negative hours value to 1 and returns windowHours=1", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=-5")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(1);
    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 1 }),
    );
  });

  it("falls back to 48 when hours param is a non-numeric string", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=bad")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(48);
  });

  it("accepts hours=1 (minimum valid value) and reflects it in windowHours", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=1")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(1);
    expect(mockGetCommunityViewsOverTime).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 1 }),
    );
  });

  it("accepts hours=48 (maximum valid value) and reflects it in windowHours", async () => {
    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time?hours=48")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(48);
  });
});

// ── Multi-thread grouping ─────────────────────────────────────────────────────

describe("GET /api/admin/community/views-over-time — multi-thread response", () => {
  it("returns all buckets from storage when multiple threads contribute views", async () => {
    const multiThreadRows = [
      { hourBucket: "2026052910", views: 3 },
      { hourBucket: "2026052911", views: 8 },
      { hourBucket: "2026052912", views: 1 },
    ];
    mockGetCommunityViewsOverTime.mockResolvedValue(multiThreadRows);

    const res = await request(buildApp())
      .get("/api/admin/community/views-over-time")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data).toEqual(multiThreadRows);
  });
});
