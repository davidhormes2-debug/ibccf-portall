import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createStorageMock } from "./helpers/storageMock";

const ADMIN_TOKEN = "test-admin-token";
const ADMIN_USERNAME = "test-admin";
process.env.ADMIN_USERNAME = ADMIN_USERNAME;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getAdminSessionByToken: vi.fn(async (token: string) =>
      token === ADMIN_TOKEN
        ? {
            id: "session-1",
            adminUsername: ADMIN_USERNAME,
            isActive: true,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
    ),
    updateAdminSessionActivity: vi.fn(async () => {}),
    createScamAlert: vi.fn(async (data: any) => ({ id: 10, ...data })),
    createTestimonial: vi.fn(async (data: any) => ({ id: 11, ...data })),
    createSiteStatistic: vi.fn(async (data: any) => ({ id: 12, ...data })),
    createFaqItem: vi.fn(async (data: any) => ({ id: 13, ...data })),
    updateScamAlert: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateTestimonial: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateSiteStatistic: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateFaqItem: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateContactSubmission: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    updateNewsletterSubscriber: vi.fn(async (id: number, data: any) => ({ id, ...data })),
    deleteScamAlert: vi.fn(async () => {}),
    deleteTestimonial: vi.fn(async () => {}),
    deleteSiteStatistic: vi.fn(async () => {}),
    deleteFaqItem: vi.fn(async () => {}),
    getActiveScamAlerts: vi.fn(async () => []),
    getApprovedTestimonials: vi.fn(async () => []),
    getSiteStatistics: vi.fn(async () => []),
    getActiveFaqItems: vi.fn(async () => []),
    getAllScamAlerts: vi.fn(async () => []),
    getAllTestimonials: vi.fn(async () => []),
    getAllFaqItems: vi.fn(async () => []),
    getAllContactSubmissions: vi.fn(async () => []),
    getNewsletterSubscribers: vi.fn(async () => []),
    getAppSetting: vi.fn(async () => null),
  }),
}));

const { adminPublicContentRouter } = await import("../routes/public");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/content", adminPublicContentRouter);
  return app;
}

describe("PUT /api/admin/content/scam-alerts/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string title with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/scam-alerts/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ title: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts a valid title update with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/scam-alerts/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ title: "Updated Alert Title" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: "Updated Alert Title" });
  });

  it("accepts a payload with no title field (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/scam-alerts/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ description: "Updated description" });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admin/content/testimonials/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string name with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/testimonials/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string content with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/testimonials/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ content: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid name and content with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/testimonials/2")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "Alice", content: "Great service!" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 2, name: "Alice", content: "Great service!" });
  });

  it("accepts a payload with neither name nor content (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/testimonials/2")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ approved: true });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admin/content/faq/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string question with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/faq/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string answer with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/faq/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ answer: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid question and answer with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/faq/3")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "How does it work?", answer: "Very well." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3, question: "How does it work?", answer: "Very well." });
  });

  it("accepts a payload with neither question nor answer (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/faq/3")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ active: true });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admin/content/statistics/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string label with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/statistics/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ label: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string value with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/statistics/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ value: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid label and value with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/statistics/4")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ label: "Total Cases", value: "1,234" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 4, label: "Total Cases", value: "1,234" });
  });

  it("accepts a payload with neither label nor value (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/statistics/4")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ order: 2 });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/content/scam-alerts — create validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects a missing title with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/scam-alerts")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ description: "Some description" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string title with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/scam-alerts")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ title: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts a valid title with 200", async () => {
    const res = await request(app)
      .post("/api/admin/content/scam-alerts")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ title: "New Scam Alert" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "New Scam Alert" });
  });
});

describe("POST /api/admin/content/testimonials — create validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects a missing name with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/testimonials")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ content: "Great service!" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a missing content with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/testimonials")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "Alice" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string name with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/testimonials")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "", content: "Great service!" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string content with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/testimonials")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "Alice", content: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid name and content with 200", async () => {
    const res = await request(app)
      .post("/api/admin/content/testimonials")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ name: "Alice", content: "Great service!" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Alice", content: "Great service!" });
  });
});

describe("POST /api/admin/content/faq — create validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects a missing question with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/faq")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ answer: "Very well." });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a missing answer with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/faq")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "How does it work?" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string question with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/faq")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "", answer: "Very well." });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string answer with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/faq")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "How does it work?", answer: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid question and answer with 200", async () => {
    const res = await request(app)
      .post("/api/admin/content/faq")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ question: "How does it work?", answer: "Very well." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ question: "How does it work?", answer: "Very well." });
  });
});

describe("POST /api/admin/content/statistics — create validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects a missing label with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "total_cases", value: "1,234" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a missing value with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "total_cases", label: "Total Cases" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string label with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "total_cases", label: "", value: "1,234" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string value with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "total_cases", label: "Total Cases", value: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a missing key with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ label: "Total Cases", value: "1,234" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string key with 400", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "", label: "Total Cases", value: "1,234" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts valid key, label, and value with 200", async () => {
    const res = await request(app)
      .post("/api/admin/content/statistics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ key: "total_cases", label: "Total Cases", value: "1,234" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: "Total Cases", value: "1,234" });
  });
});

describe("PUT /api/admin/content/contact-submissions/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string status with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/contact-submissions/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ status: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an empty-string adminNotes with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/contact-submissions/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ adminNotes: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("accepts a valid status update with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/contact-submissions/5")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ status: "read" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 5, status: "read" });
  });

  it("accepts valid adminNotes with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/contact-submissions/5")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ adminNotes: "Followed up by email." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 5, adminNotes: "Followed up by email." });
  });

  it("accepts a payload with neither status nor adminNotes (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/contact-submissions/5")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admin/content/newsletter/:id — field validation", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("rejects an empty-string email with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ email: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects an invalid email with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a non-boolean isActive with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/1")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ isActive: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/not-a-number")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/id/i);
  });

  it("accepts a valid email update with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/7")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ email: "new@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 7, email: "new@example.com" });
  });

  it("accepts an isActive=false update with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/7")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 7, isActive: false });
  });

  it("accepts an empty body (partial update) with 200", async () => {
    const res = await request(app)
      .put("/api/admin/content/newsletter/7")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(200);
  });
});

describe("PUT/DELETE /api/admin/content/* — invalid id rejection", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  const invalidIds = ["abc", "1.5", "-1", "0", "12abc", " ", "NaN"];

  const putTargets: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: "scam-alerts", body: { title: "Updated" } },
    { path: "testimonials", body: { name: "Alice" } },
    { path: "faq", body: { question: "How?" } },
    { path: "statistics", body: { label: "Total" } },
  ];

  const deleteTargets = ["scam-alerts", "testimonials", "faq", "statistics"];

  for (const { path, body } of putTargets) {
    for (const bad of invalidIds) {
      it(`PUT /${path}/${JSON.stringify(bad)} returns 400`, async () => {
        const res = await request(app)
          .put(`/api/admin/content/${path}/${encodeURIComponent(bad)}`)
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
          .send(body);
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toMatch(/id/i);
      });
    }
  }

  for (const path of deleteTargets) {
    for (const bad of invalidIds) {
      it(`DELETE /${path}/${JSON.stringify(bad)} returns 400`, async () => {
        const res = await request(app)
          .delete(`/api/admin/content/${path}/${encodeURIComponent(bad)}`)
          .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toMatch(/id/i);
      });
    }
  }

  it("DELETE /scam-alerts/:id still accepts a valid numeric id with 200", async () => {
    const res = await request(app)
      .delete("/api/admin/content/scam-alerts/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// ============================================================================
// Auth-hardening suites — mirrors the pattern in newsletterSubscriberDelete.test.ts
// Covers every rejection path inside checkAdminAuth for each delete endpoint.
// ============================================================================

describe("DELETE /api/admin/content/scam-alerts/:id — auth hardening", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 401 when the Authorization header is missing entirely", async () => {
    const res = await request(app)
      .delete("/api/admin/content/scam-alerts/42");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is random / not recognised by the session store", async () => {
    const res = await request(app)
      .delete("/api/admin/content/scam-alerts/42")
      .set("Authorization", "Bearer totally-random-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has been revoked (revokedAt is set)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-revoked",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/scam-alerts/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has expired (expiresAt is in the past)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-expired",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/scam-alerts/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/admin/content/testimonials/:id — auth hardening", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 401 when the Authorization header is missing entirely", async () => {
    const res = await request(app)
      .delete("/api/admin/content/testimonials/42");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is random / not recognised by the session store", async () => {
    const res = await request(app)
      .delete("/api/admin/content/testimonials/42")
      .set("Authorization", "Bearer totally-random-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has been revoked (revokedAt is set)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-revoked",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/testimonials/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has expired (expiresAt is in the past)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-expired",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/testimonials/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/admin/content/faq/:id — auth hardening", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 401 when the Authorization header is missing entirely", async () => {
    const res = await request(app)
      .delete("/api/admin/content/faq/42");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is random / not recognised by the session store", async () => {
    const res = await request(app)
      .delete("/api/admin/content/faq/42")
      .set("Authorization", "Bearer totally-random-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has been revoked (revokedAt is set)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-revoked",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/faq/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has expired (expiresAt is in the past)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-expired",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/faq/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Statistics DELETE — auth-hardening suite (Task #602)
//
// DELETE /api/admin/content/statistics/:id was introduced alongside this suite.
// Covers every rejection path inside checkAdminAuth, matching the pattern used
// by scam-alerts, testimonials, and faq above.
// ============================================================================

describe("DELETE /api/admin/content/statistics/:id — auth hardening", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it("returns 401 when the Authorization header is missing entirely", async () => {
    const res = await request(app)
      .delete("/api/admin/content/statistics/42");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is random / not recognised by the session store", async () => {
    const res = await request(app)
      .delete("/api/admin/content/statistics/42")
      .set("Authorization", "Bearer totally-random-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has been revoked (revokedAt is set)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-revoked",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/statistics/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session has expired (expiresAt is in the past)", async () => {
    const { storage } = await import("../storage");
    vi.mocked(storage.getAdminSessionByToken).mockResolvedValueOnce({
      id: "session-expired",
      adminUsername: ADMIN_USERNAME,
      isActive: true,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    } as any);

    const res = await request(app)
      .delete("/api/admin/content/statistics/42")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(401);
  });
});

it("DELETE /statistics/:id still accepts a valid numeric id with 200", async () => {
  const app = buildApp();
  const res = await request(app)
    .delete("/api/admin/content/statistics/42")
    .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true });
});
