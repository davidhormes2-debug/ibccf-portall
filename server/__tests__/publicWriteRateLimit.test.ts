import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

// Counter map shared between atomicIncrementRateLimit calls — mirrors the
// pattern used in publicPostRateLimit.test.ts for the keyRequestSubmitLimiter
// snapshot guard so the DB-persistent path is confirmed active for each test.
const atomicCounters = new Map<string, number>();

vi.mock("../storage", () => ({
  storage: createStorageMock({
    createNewsletterSubscriber: vi.fn(async ({ email }: { email: string }) => ({
      id: 1,
      email,
      isActive: true,
    })),
    createContactSubmission: vi.fn(async (data: any) => ({ id: 1, ...data })),
    atomicIncrementRateLimit: vi.fn(
      async ({ key, windowResetAt }: { key: string; windowResetAt: Date }) => {
        const prev = atomicCounters.get(key) ?? 0;
        const next = prev + 1;
        atomicCounters.set(key, next);
        return { count: next, resetAt: windowResetAt };
      },
    ),
  }),
}));

const { publicRouter } = await import("../routes/public");
const { storage } = await import("../storage");

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/public", publicRouter);
  return app;
}

// Use a fresh IP per test so the in-memory rate-limit bucket
// (keyed by IP+route, shared across the test file) does not bleed
// between tests.
let nextIp = 1;
function freshIp(): string {
  return `10.99.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`;
}

describe("public newsletter/contact rate limiting", () => {
  beforeEach(() => {
    atomicCounters.clear();
    vi.mocked(storage.atomicIncrementRateLimit).mockClear();
  });

  it("returns an identical generic success response for new and already-subscribed emails (no enumeration leak)", async () => {
    const app = buildApp();

    // Fresh subscribe — the storage mock resolves normally.
    const freshRes = await request(app)
      .post("/api/public/newsletter")
      .set("x-forwarded-for", freshIp())
      .send({ email: "brand-new@example.com" });

    // Duplicate subscribe — the storage mock rejects with Postgres 23505.
    const dupErr: any = new Error("duplicate");
    dupErr.code = "23505";
    (storage.createNewsletterSubscriber as any).mockRejectedValueOnce(dupErr);
    const dupRes = await request(app)
      .post("/api/public/newsletter")
      .set("x-forwarded-for", freshIp())
      .send({ email: "already@example.com" });

    expect(freshRes.status).toBe(200);
    expect(dupRes.status).toBe(200);
    // Bodies must be byte-for-byte identical so an attacker can't infer
    // whether an address was already on the list from the response shape.
    expect(dupRes.body).toEqual(freshRes.body);
    expect(freshRes.body).toEqual({ success: true });
    expect(freshRes.body.subscriber).toBeUndefined();
    expect(dupRes.body.subscriber).toBeUndefined();
    expect(freshRes.body.error).toBeUndefined();
    expect(dupRes.body.error).toBeUndefined();
  });

  it("returns 429 after 5 rapid POSTs to /newsletter from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/public/newsletter")
        .set("x-forwarded-for", ip)
        .send({ email: `user${i}@example.com` });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/public/newsletter")
      .set("x-forwarded-for", ip)
      .send({ email: "user6@example.com" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("newsletter allowed-window cap is exactly 5 — SMTP-flood snapshot guard", async () => {
    // Rationale: each accepted POST /newsletter writes a DB row and the
    // subscription confirmation can trigger outbound SMTP. The cap of 5 per
    // IP per 60-second window was deliberately chosen to make mail-bombing
    // impractical while remaining comfortable for legitimate use (see
    // PUBLIC_WRITE_MAX in server/routes/public.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 5 requests are allowed and the 6th is blocked. Quietly raising
    // the cap degrades the SMTP flood ceiling without any code-review signal —
    // this assertion fails immediately, catching that regression before it
    // ships. If you intentionally change the cap, update the literal 5 in the
    // assertions AND the comment above in the same commit.
    const app = buildApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post("/api/public/newsletter")
          .set("x-forwarded-for", ip)
          .send({ email: `snap${i}@example.com` }),
      ),
    );

    // All 5 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `newsletter request ${i + 1} of 5 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 5 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active), giving a total of exactly 5.
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "publicNewsletterLimiter cap must be exactly 5 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(5);

    // The 6th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/public/newsletter")
      .set("x-forwarded-for", ip)
      .send({ email: "snap6@example.com" });
    expect(blocked.status, "6th newsletter request must be rate-limited (429)").toBe(429);
  });

  it("returns 429 after 5 rapid POSTs to /contact from the same IP", async () => {
    const app = buildApp();
    const ip = freshIp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/public/contact")
        .set("x-forwarded-for", ip)
        .send({ name: "Alice", email: "a@example.com", message: "hello" });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/public/contact")
      .set("x-forwarded-for", ip)
      .send({ name: "Alice", email: "a@example.com", message: "hello" });

    expect(blocked.status).toBe(429);
  });

  it("contact allowed-window cap is exactly 5 — SMTP-flood snapshot guard", async () => {
    // Rationale: each accepted POST /contact writes a DB row and can trigger
    // an outbound SMTP notification. The cap of 5 per IP per 60-second window
    // was deliberately chosen to make mail-bombing impractical while remaining
    // comfortable for legitimate use (see PUBLIC_WRITE_MAX in
    // server/routes/public.ts).
    //
    // This test is a self-contained snapshot: it independently verifies that
    // EXACTLY 5 requests are allowed and the 6th is blocked. Quietly raising
    // the cap degrades the SMTP flood ceiling without any code-review signal —
    // this assertion fails immediately, catching that regression before it
    // ships. If you intentionally change the cap, update the literal 5 in the
    // assertions AND the comment above in the same commit.
    const app = buildApp();
    const ip = freshIp();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/public/contact")
          .set("x-forwarded-for", ip)
          .send({ name: "Bob", email: "b@example.com", message: "test" }),
      ),
    );

    // All 5 requests in the allowed window must be non-429.
    responses.forEach((r, i) =>
      expect(r.status, `contact request ${i + 1} of 5 must be inside the allowed window (non-429)`).not.toBe(429),
    );

    // Each of the 5 allowed requests must have incremented the DB counter
    // exactly once (DB-persistent path is active), giving a total of exactly 5.
    const callsAfterAllowed = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
      (c) => c[0].key.includes(ip),
    ).length;
    expect(
      callsAfterAllowed,
      "publicContactLimiter cap must be exactly 5 per IP per window — raise this assertion if the cap is intentionally changed",
    ).toBe(5);

    // The 6th request must be blocked — window is exhausted.
    const blocked = await request(app)
      .post("/api/public/contact")
      .set("x-forwarded-for", ip)
      .send({ name: "Bob", email: "b@example.com", message: "test" });
    expect(blocked.status, "6th contact request must be rate-limited (429)").toBe(429);
  });

  it("newsletter window duration is exactly 60 000 ms — SMTP-flood snapshot guard", async () => {
    // Rationale: PUBLIC_WRITE_WINDOW_MS (server/routes/public.ts) combines with
    // the 5-request cap to bound worst-case mail-bombing throughput. Quietly
    // shortening the window multiplies the effective per-IP send rate the same
    // way raising the cap would, without any code-review signal — this
    // assertion fails immediately, catching that regression before it ships.
    // If you intentionally change the window, update the literal 60_000 in
    // this assertion in the same commit.
    //
    // Time is frozen with fake timers so `windowResetAt = Date.now() + windowMs`
    // can be asserted for EXACT equality — a wall-clock before/after envelope
    // would let a shortened window slip through whenever request latency
    // happens to fill the gap.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/public/newsletter")
        .set("x-forwarded-for", ip)
        .send({ email: "window-test@example.com" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);

      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "publicNewsletterLimiter window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("contact window duration is exactly 60 000 ms — SMTP-flood snapshot guard", async () => {
    // Rationale: PUBLIC_WRITE_WINDOW_MS (server/routes/public.ts) combines with
    // the 5-request cap to bound worst-case mail-bombing throughput. See the
    // newsletter window test above for the full rationale — mirrored here
    // because /contact uses its own persistNamespace and could regress
    // independently.
    vi.useFakeTimers();
    const fixedNow = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.setSystemTime(fixedNow);
    try {
      const app = buildApp();
      const ip = freshIp();

      await request(app)
        .post("/api/public/contact")
        .set("x-forwarded-for", ip)
        .send({ name: "Window", email: "window-test@example.com", message: "test" });

      const calls = vi.mocked(storage.atomicIncrementRateLimit).mock.calls.filter(
        (c) => c[0].key.includes(ip),
      );
      expect(calls.length).toBeGreaterThan(0);

      const windowResetAt = calls[0][0].windowResetAt.getTime();
      expect(
        windowResetAt - fixedNow,
        "publicContactLimiter window must be exactly 60 000 ms — raise this assertion if the window is intentionally changed",
      ).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
