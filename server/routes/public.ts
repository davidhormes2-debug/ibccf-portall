import { Router } from "express";
import { storage } from "../storage";

import { z } from "zod";
import { checkAdminAuth } from "./middleware";
import {
  rateLimiter,
  PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE,
  PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE,
  PUBLIC_GET_RATE_LIMIT_NAMESPACE,
} from "../middleware/security";
import { getBuildStamp, getBootTimeIso } from "../static";

export const publicRouter = Router();

// ── Rate-limit constants (must precede route registrations) ─────────────────

// Per-IP rate limit (5/minute) on the public newsletter + contact endpoints.
// These are unauthenticated POSTs that write to the DB and (for contact) can
// trigger SMTP work, so without a per-route bucket a single script could flood
// them with cheap requests. The generic /api limiter (100/min) is too lax for
// these specifically. Each limiter has its own stable persistNamespace so the
// per-IP budget is shared across autoscale instances (otherwise a flood from
// one IP could be sprayed across instances to multiply the effective cap).
const PUBLIC_WRITE_MAX = 5;
const PUBLIC_WRITE_WINDOW_MS = 60 * 1000;

// Per-IP rate limit (60/minute) on unauthenticated public GET endpoints.
// These endpoints hit the DB on cache miss or return cached data from the
// in-memory cache. 60 req/min caps bot polling at the same ceiling as the
// visitor heartbeat and agent-status GETs. Persistent so the budget holds
// across all autoscale instances. The route path is embedded in every cache
// key (see security.ts), so the shared namespace safely covers multiple routes.
const PUBLIC_GET_MAX = 60;
const PUBLIC_GET_WINDOW_MS = 60 * 1000;
const publicGetLimiter = () =>
  rateLimiter(PUBLIC_GET_MAX, PUBLIC_GET_WINDOW_MS, {
    persistNamespace: PUBLIC_GET_RATE_LIMIT_NAMESPACE,
  });

// ── In-memory TTL cache for public read-only endpoints ──────────────────────
// These pages are hit on every visitor's first paint (scam alerts, testimonials,
// FAQ, statistics) and the data only changes when an admin edits content.
// A 60-second cache cuts cold-start latency (Neon serverless can take ~1.5s on
// the first query) and reduces DB load during traffic spikes. Admin write
// endpoints below call invalidatePublicCache(key) so changes take effect
// immediately instead of waiting up to TTL.
const publicCache = new Map<string, { data: unknown; expiresAt: number }>();
const PUBLIC_CACHE_TTL_MS = 60_000;

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = publicCache.get(key);
  if (hit && hit.expiresAt > now) return hit.data as T;
  const data = await loader();
  publicCache.set(key, { data, expiresAt: now + PUBLIC_CACHE_TTL_MS });
  return data;
}

function invalidatePublicCache(key?: string) {
  if (key) publicCache.delete(key);
  else publicCache.clear();
}

function parsePositiveIntId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

// ── Public routes ─────────────────────────────────────────────────────────────

// Public counterpart of /api/admin/build-info: lets the portal shell
// detect when a user's open tab is running an older bundle than what
// the live server is now serving (e.g. after a deploy while a case
// holder left their portal tab open). Same value as the X-Build-Stamp
// response header — see server/static.ts. Never cached so each poll
// hits the live instance rather than a stale shared cache.
publicRouter.get("/build-info", publicGetLimiter(), (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    buildStamp: getBuildStamp(),
    bootTime: getBootTimeIso(),
  });
});

publicRouter.post(
  "/newsletter",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: PUBLIC_NEWSLETTER_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !z.string().email().safeParse(email).success) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      try {
        await storage.createNewsletterSubscriber({ email, isActive: true });
      } catch (error: any) {
        // Swallow the duplicate-email error: respond with the exact same
        // payload as a fresh subscription so the endpoint can't be used to
        // enumerate which addresses are already on the list.
        if (error?.code !== '23505') throw error;
      }
      // Identical response shape for new + duplicate emails — do NOT include
      // the persisted subscriber row, since its presence/absence would leak
      // the same information as the previous 409.
      res.json({ success: true });
    } catch (_e) {
      res.status(500).json({ error: "Failed to subscribe" });
    }
  },
);

publicRouter.get("/scam-alerts", publicGetLimiter(), async (req, res) => {
  try {
    const alerts = await cached("scam-alerts", () => storage.getActiveScamAlerts());
    res.json(alerts);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch scam alerts" });
  }
});

publicRouter.get("/testimonials", publicGetLimiter(), async (req, res) => {
  try {
    const testimonials = await cached("testimonials", () => storage.getApprovedTestimonials());
    res.json(testimonials);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

publicRouter.get("/statistics", publicGetLimiter(), async (req, res) => {
  try {
    const stats = await cached("statistics", () => storage.getSiteStatistics());
    res.json(stats);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

publicRouter.get("/faq", publicGetLimiter(), async (req, res) => {
  try {
    const faqs = await cached("faq", () => storage.getActiveFaqItems());
    res.json(faqs);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch FAQ items" });
  }
});

publicRouter.post(
  "/contact",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: PUBLIC_CONTACT_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: "Name, email, and message are required" });
      }
      if (!z.string().email().safeParse(email).success) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      const submission = await storage.createContactSubmission({ name, email, subject, message });
      res.json({ success: true, submission });
    } catch (_e) {
      res.status(500).json({ error: "Failed to submit contact form" });
    }
  },
);

export const adminPublicContentRouter = Router();

adminPublicContentRouter.use(checkAdminAuth);

adminPublicContentRouter.get("/newsletter", async (req, res) => {
  try {
    const subscribers = await storage.getAllNewsletterSubscribers();
    res.json(subscribers);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch subscribers" });
  }
});

const updateNewsletterSubscriberSchema = z.object({
  email: z
    .string()
    .min(1, "email must be a non-empty string")
    .email("email must be a valid email")
    .optional(),
  isActive: z.boolean({ invalid_type_error: "isActive must be a boolean" }).optional(),
  unsubscribedAt: z
    .union([z.string().datetime({ message: "unsubscribedAt must be an ISO datetime string" }), z.null()])
    .optional(),
}).passthrough();

adminPublicContentRouter.put("/newsletter/:id", async (req, res) => {
  const parsed = updateNewsletterSubscriberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id must be a numeric subscriber id" });
  }
  try {
    const { email, isActive, unsubscribedAt } = parsed.data as {
      email?: string;
      isActive?: boolean;
      unsubscribedAt?: string | null;
    };
    const update: { email?: string; isActive?: boolean; unsubscribedAt?: Date | null } = {};
    if (email !== undefined) update.email = email;
    if (isActive !== undefined) update.isActive = isActive;
    if (unsubscribedAt !== undefined) {
      update.unsubscribedAt = unsubscribedAt === null ? null : new Date(unsubscribedAt);
    }
    const subscriber = await storage.updateNewsletterSubscriber(id, update);
    res.json(subscriber);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: "Email already subscribed" });
    }
    res.status(500).json({ error: "Failed to update subscriber" });
  }
});

adminPublicContentRouter.delete("/newsletter/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id must be a numeric subscriber id" });
  }
  try {
    const deleted = await storage.deleteNewsletterSubscriber(id);
    if (!deleted) {
      return res.status(404).json({ error: "Subscriber not found" });
    }
    storage.createAuditLog({
      action: "newsletter_subscriber_deleted",
      adminUsername: process.env.ADMIN_USERNAME ?? "admin",
      targetType: "newsletter_subscriber",
      targetId: String(id),
      previousValue: deleted.email,
      newValue: null,
    }).catch(() => {});
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete subscriber" });
  }
});

adminPublicContentRouter.get("/scam-alerts", async (req, res) => {
  try {
    const alerts = await storage.getAllScamAlerts();
    res.json(alerts);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch scam alerts" });
  }
});

const createScamAlertSchema = z.object({
  title: z.string({ required_error: "title is required" }).min(1, "title must be a non-empty string"),
}).passthrough();

adminPublicContentRouter.post("/scam-alerts", async (req, res) => {
  const parsed = createScamAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const alert = await storage.createScamAlert(parsed.data);
    invalidatePublicCache("scam-alerts");
    res.json(alert);
  } catch (_e) {
    res.status(500).json({ error: "Failed to create scam alert" });
  }
});

const updateScamAlertSchema = z.object({
  title: z.string().min(1, "title must be a non-empty string").optional(),
}).passthrough();

adminPublicContentRouter.put("/scam-alerts/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  const parsed = updateScamAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const alert = await storage.updateScamAlert(id, parsed.data);
    invalidatePublicCache("scam-alerts");
    res.json(alert);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update scam alert" });
  }
});

adminPublicContentRouter.delete("/scam-alerts/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  try {
    await storage.deleteScamAlert(id);
    invalidatePublicCache("scam-alerts");
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete scam alert" });
  }
});

adminPublicContentRouter.get("/testimonials", async (req, res) => {
  try {
    const testimonials = await storage.getAllTestimonials();
    res.json(testimonials);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

const createTestimonialSchema = z.object({
  name: z.string({ required_error: "name is required" }).min(1, "name must be a non-empty string"),
  content: z.string({ required_error: "content is required" }).min(1, "content must be a non-empty string"),
}).passthrough();

adminPublicContentRouter.post("/testimonials", async (req, res) => {
  const parsed = createTestimonialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const testimonial = await storage.createTestimonial(parsed.data);
    invalidatePublicCache("testimonials");
    res.json(testimonial);
  } catch (_e) {
    res.status(500).json({ error: "Failed to create testimonial" });
  }
});

const updateTestimonialSchema = z.object({
  name: z.string().min(1, "name must be a non-empty string").optional(),
  content: z.string().min(1, "content must be a non-empty string").optional(),
}).passthrough();

adminPublicContentRouter.put("/testimonials/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  const parsed = updateTestimonialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const testimonial = await storage.updateTestimonial(id, parsed.data);
    invalidatePublicCache("testimonials");
    res.json(testimonial);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update testimonial" });
  }
});

adminPublicContentRouter.delete("/testimonials/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  try {
    await storage.deleteTestimonial(id);
    invalidatePublicCache("testimonials");
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete testimonial" });
  }
});

adminPublicContentRouter.get("/statistics", async (req, res) => {
  try {
    const stats = await storage.getSiteStatistics();
    res.json(stats);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

const createStatisticSchema = z.object({
  key: z.string({ required_error: "key is required" }).min(1, "key must be a non-empty string"),
  label: z.string({ required_error: "label is required" }).min(1, "label must be a non-empty string"),
  value: z.string({ required_error: "value is required" }).min(1, "value must be a non-empty string"),
}).passthrough();

adminPublicContentRouter.post("/statistics", async (req, res) => {
  const parsed = createStatisticSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const stat = await storage.createSiteStatistic(parsed.data);
    invalidatePublicCache("statistics");
    res.json(stat);
  } catch (_e) {
    res.status(500).json({ error: "Failed to create statistic" });
  }
});

const updateStatisticSchema = z.object({
  label: z.string().min(1, "label must be a non-empty string").optional(),
  value: z.string().min(1, "value must be a non-empty string").optional(),
}).passthrough();

adminPublicContentRouter.put("/statistics/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  const parsed = updateStatisticSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const stat = await storage.updateSiteStatistic(id, parsed.data);
    invalidatePublicCache("statistics");
    res.json(stat);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update statistic" });
  }
});

adminPublicContentRouter.delete("/statistics/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  try {
    await storage.deleteSiteStatistic(id);
    invalidatePublicCache("statistics");
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete statistic" });
  }
});

adminPublicContentRouter.get("/faq", async (req, res) => {
  try {
    const faqs = await storage.getAllFaqItems();
    res.json(faqs);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch FAQ items" });
  }
});

const createFaqSchema = z.object({
  question: z.string({ required_error: "question is required" }).min(1, "question must be a non-empty string"),
  answer: z.string({ required_error: "answer is required" }).min(1, "answer must be a non-empty string"),
}).passthrough();

adminPublicContentRouter.post("/faq", async (req, res) => {
  const parsed = createFaqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const faq = await storage.createFaqItem(parsed.data);
    invalidatePublicCache("faq");
    res.json(faq);
  } catch (_e) {
    res.status(500).json({ error: "Failed to create FAQ item" });
  }
});

const updateFaqSchema = z.object({
  question: z.string().min(1, "question must be a non-empty string").optional(),
  answer: z.string().min(1, "answer must be a non-empty string").optional(),
}).passthrough();

adminPublicContentRouter.put("/faq/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  const parsed = updateFaqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const faq = await storage.updateFaqItem(id, parsed.data);
    invalidatePublicCache("faq");
    res.json(faq);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update FAQ item" });
  }
});

adminPublicContentRouter.delete("/faq/:id", async (req, res) => {
  const id = parsePositiveIntId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }
  try {
    await storage.deleteFaqItem(id);
    invalidatePublicCache("faq");
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete FAQ item" });
  }
});

// ── Portal Refresh Mode — unauthenticated read ──────────────────────
// The portal polls this endpoint every 30 s while the user is logged in.
// Returns { enabled: boolean }. Never throws — falls back to false so a
// transient DB hiccup doesn't lock all users out.
publicRouter.get("/portal-refresh-mode", publicGetLimiter(), async (_req, res) => {
  try {
    const { storage } = await import("../storage");
    const row = await storage.getAppSetting('portal_refresh_mode');
    res.json({ enabled: row?.value === 'true' });
  } catch {
    res.json({ enabled: false });
  }
});

adminPublicContentRouter.get("/contact-submissions", async (req, res) => {
  try {
    const submissions = await storage.getAllContactSubmissions();
    res.json(submissions);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch contact submissions" });
  }
});

const updateContactSubmissionSchema = z.object({
  status: z.string().min(1, "status must be a non-empty string").optional(),
  adminNotes: z.string().min(1, "adminNotes must be a non-empty string").optional(),
}).passthrough();

adminPublicContentRouter.put("/contact-submissions/:id", async (req, res) => {
  const parsed = updateContactSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const id = parseInt(req.params.id);
    const submission = await storage.updateContactSubmission(id, parsed.data);
    res.json(submission);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update contact submission" });
  }
});

// Public complaints intake queue
adminPublicContentRouter.get("/public-complaints", async (_req, res) => {
  try {
    const complaints = await storage.getAllPublicComplaints();
    res.json(complaints);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch public complaints" });
  }
});

const updatePublicComplaintSchema = z.object({
  status: z.string().min(1).optional(),
  adminNotes: z.string().optional(),
}).passthrough();

adminPublicContentRouter.put("/public-complaints/:id", async (req, res) => {
  const parsed = updatePublicComplaintSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    const id = parseInt(req.params.id);
    const complaint = await storage.updatePublicComplaint(id, parsed.data);
    res.json(complaint);
  } catch (_e) {
    res.status(500).json({ error: "Failed to update complaint" });
  }
});

adminPublicContentRouter.delete("/public-complaints/:id", async (req, res) => {
  try {
    await storage.deletePublicComplaint(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete complaint" });
  }
});
