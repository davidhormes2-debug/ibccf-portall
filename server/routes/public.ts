import { Router } from "express";
import { storage } from "../storage";
import { insertNewsletterSubscriberSchema, insertContactSubmissionSchema } from "@shared/schema";
import { z } from "zod";

export const publicRouter = Router();

publicRouter.post("/newsletter", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !z.string().email().safeParse(email).success) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    const subscriber = await storage.createNewsletterSubscriber({ email, isActive: true });
    res.json({ success: true, subscriber });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: "Email already subscribed" });
    }
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

publicRouter.get("/scam-alerts", async (req, res) => {
  try {
    const alerts = await storage.getActiveScamAlerts();
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch scam alerts" });
  }
});

publicRouter.get("/testimonials", async (req, res) => {
  try {
    const testimonials = await storage.getApprovedTestimonials();
    res.json(testimonials);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

publicRouter.get("/statistics", async (req, res) => {
  try {
    const stats = await storage.getSiteStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

publicRouter.get("/faq", async (req, res) => {
  try {
    const faqs = await storage.getActiveFaqItems();
    res.json(faqs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch FAQ items" });
  }
});

publicRouter.post("/contact", async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: "Failed to submit contact form" });
  }
});

export const adminPublicContentRouter = Router();

adminPublicContentRouter.get("/newsletter", async (req, res) => {
  try {
    const subscribers = await storage.getAllNewsletterSubscribers();
    res.json(subscribers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch subscribers" });
  }
});

adminPublicContentRouter.get("/scam-alerts", async (req, res) => {
  try {
    const alerts = await storage.getAllScamAlerts();
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch scam alerts" });
  }
});

adminPublicContentRouter.post("/scam-alerts", async (req, res) => {
  try {
    const alert = await storage.createScamAlert(req.body);
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: "Failed to create scam alert" });
  }
});

adminPublicContentRouter.put("/scam-alerts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const alert = await storage.updateScamAlert(id, req.body);
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: "Failed to update scam alert" });
  }
});

adminPublicContentRouter.delete("/scam-alerts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteScamAlert(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete scam alert" });
  }
});

adminPublicContentRouter.get("/testimonials", async (req, res) => {
  try {
    const testimonials = await storage.getAllTestimonials();
    res.json(testimonials);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

adminPublicContentRouter.post("/testimonials", async (req, res) => {
  try {
    const testimonial = await storage.createTestimonial(req.body);
    res.json(testimonial);
  } catch (error) {
    res.status(500).json({ error: "Failed to create testimonial" });
  }
});

adminPublicContentRouter.put("/testimonials/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const testimonial = await storage.updateTestimonial(id, req.body);
    res.json(testimonial);
  } catch (error) {
    res.status(500).json({ error: "Failed to update testimonial" });
  }
});

adminPublicContentRouter.delete("/testimonials/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteTestimonial(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete testimonial" });
  }
});

adminPublicContentRouter.get("/statistics", async (req, res) => {
  try {
    const stats = await storage.getSiteStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

adminPublicContentRouter.post("/statistics", async (req, res) => {
  try {
    const stat = await storage.createSiteStatistic(req.body);
    res.json(stat);
  } catch (error) {
    res.status(500).json({ error: "Failed to create statistic" });
  }
});

adminPublicContentRouter.put("/statistics/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const stat = await storage.updateSiteStatistic(id, req.body);
    res.json(stat);
  } catch (error) {
    res.status(500).json({ error: "Failed to update statistic" });
  }
});

adminPublicContentRouter.get("/faq", async (req, res) => {
  try {
    const faqs = await storage.getAllFaqItems();
    res.json(faqs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch FAQ items" });
  }
});

adminPublicContentRouter.post("/faq", async (req, res) => {
  try {
    const faq = await storage.createFaqItem(req.body);
    res.json(faq);
  } catch (error) {
    res.status(500).json({ error: "Failed to create FAQ item" });
  }
});

adminPublicContentRouter.put("/faq/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const faq = await storage.updateFaqItem(id, req.body);
    res.json(faq);
  } catch (error) {
    res.status(500).json({ error: "Failed to update FAQ item" });
  }
});

adminPublicContentRouter.delete("/faq/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteFaqItem(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete FAQ item" });
  }
});

adminPublicContentRouter.get("/contact-submissions", async (req, res) => {
  try {
    const submissions = await storage.getAllContactSubmissions();
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch contact submissions" });
  }
});

adminPublicContentRouter.put("/contact-submissions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const submission = await storage.updateContactSubmission(id, req.body);
    res.json(submission);
  } catch (error) {
    res.status(500).json({ error: "Failed to update contact submission" });
  }
});
