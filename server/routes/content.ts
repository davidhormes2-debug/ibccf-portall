import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { checkAdminAuth, isValidAdminToken } from "./middleware";
import { requireAdminRole } from "./adminPermissions";
import { requirePortalAccess, requireUnsealed } from "../services/portal-auth";
import { warnOnce } from "../lib/warnOnce";
import { getPublicBaseUrl } from "../lib/publicBaseUrl";

// ── Admin username resolution ─────────────────────────────────────────────
// Looks up the bearer token from the Authorization header and returns the
// adminUsername stored in the session (same pattern as cases.ts).
async function resolveAdminUsernameFromReq(
  req: { headers: { authorization?: string | string[] | undefined } },
): Promise<string> {
  try {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith("Bearer ")) return "Admin";
    const token = header.slice("Bearer ".length).trim();
    if (!token) return "Admin";
    const session = await storage.getAdminSessionByToken(token);
    return session?.adminUsername || "Admin";
  } catch {
    return "Admin";
  }
}

// ── Document-upload alert email resolution ──────────────────────────────────
// Resolution order for the document-upload alert recipient:
//   1. DOCUMENT_UPLOAD_ALERT_EMAIL env var (operator-level override).
//   2. app_settings.document_upload_alert_email (admin-editable without redeploy).
//   3. Falls back to ADMIN_ALERT_EMAIL / app_settings.admin_alert_email so
//      existing ops teams get upload alerts without any additional config.
// Both sources support comma-separated lists. Returns [] when nothing is set
// so the alert silently no-ops rather than crashing.

export const DOCUMENT_UPLOAD_ALERT_EMAIL_SETTING_KEY = "document_upload_alert_email";

// Lightweight RFC-5322-ish validation (same as nda-integrity-sweep).
const DOC_EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parseDocumentUploadAlertRecipients(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface DocumentUploadAlertEmailSetting {
  recipients: string[];
  value: string;
  source: "env" | "db" | "fallback" | "default";
  envOverride: boolean;
  storedValue: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function resolveDocumentUploadAlertRecipientsLocal(): Promise<string[]> {
  // 1. Dedicated env var.
  const fromEnv = process.env.DOCUMENT_UPLOAD_ALERT_EMAIL?.trim();
  if (fromEnv) return parseDocumentUploadAlertRecipients(fromEnv);
  // 2. DB-stored dedicated setting.
  try {
    const row = await storage.getAppSetting(DOCUMENT_UPLOAD_ALERT_EMAIL_SETTING_KEY);
    if (row?.value?.trim()) return parseDocumentUploadAlertRecipients(row.value);
  } catch (err) {
    warnOnce(
      "content:doc-upload-alert-email-read",
      "[content] failed to read document_upload_alert_email setting:",
      err,
    );
  }
  // 3. Fall back to the shared admin alert email (env then DB).
  const adminEnv = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (adminEnv) return parseDocumentUploadAlertRecipients(adminEnv);
  try {
    const row = await storage.getAppSetting("admin_alert_email");
    if (row?.value?.trim()) return parseDocumentUploadAlertRecipients(row.value);
  } catch (err) {
    warnOnce(
      "content:doc-upload-admin-alert-email-fallback-read",
      "[content] failed to read admin_alert_email fallback for document upload:",
      err,
    );
  }
  return [];
}

export async function readDocumentUploadAlertEmailSetting(): Promise<DocumentUploadAlertEmailSetting> {
  const envRaw = process.env.DOCUMENT_UPLOAD_ALERT_EMAIL?.trim() ?? "";
  let storedValue = "";
  let updatedAt: Date | null = null;
  let updatedBy: string | null = null;
  try {
    const row = await storage.getAppSetting(DOCUMENT_UPLOAD_ALERT_EMAIL_SETTING_KEY);
    if (row) {
      storedValue = (row.value ?? "").trim();
      updatedAt = row.updatedAt ?? null;
      updatedBy = row.updatedBy ?? null;
    }
  } catch (err) {
    warnOnce(
      "content:doc-upload-alert-email-metadata-read",
      "[content] failed to read document_upload_alert_email metadata:",
      err,
    );
  }
  if (envRaw) {
    return {
      recipients: parseDocumentUploadAlertRecipients(envRaw),
      value: envRaw,
      source: "env",
      envOverride: true,
      storedValue,
      updatedAt,
      updatedBy,
    };
  }
  if (storedValue) {
    return {
      recipients: parseDocumentUploadAlertRecipients(storedValue),
      value: storedValue,
      source: "db",
      envOverride: false,
      storedValue,
      updatedAt,
      updatedBy,
    };
  }
  // Derive fallback so the UI can show where the effective recipients come from.
  const adminEnv = process.env.ADMIN_ALERT_EMAIL?.trim() ?? "";
  if (adminEnv) {
    return {
      recipients: parseDocumentUploadAlertRecipients(adminEnv),
      value: "",
      source: "fallback",
      envOverride: false,
      storedValue: "",
      updatedAt: null,
      updatedBy: null,
    };
  }
  try {
    const row = await storage.getAppSetting("admin_alert_email");
    if (row?.value?.trim()) {
      return {
        recipients: parseDocumentUploadAlertRecipients(row.value),
        value: "",
        source: "fallback",
        envOverride: false,
        storedValue: "",
        updatedAt: null,
        updatedBy: null,
      };
    }
  } catch {
    /* best-effort */
  }
  return {
    recipients: [],
    value: "",
    source: "default",
    envOverride: false,
    storedValue: "",
    updatedAt: null,
    updatedBy: null,
  };
}

export class InvalidDocumentUploadAlertEmailError extends Error {
  invalid: string[];
  constructor(invalid: string[]) {
    super(`Invalid email address(es): ${invalid.join(", ")}`);
    this.name = "InvalidDocumentUploadAlertEmailError";
    this.invalid = invalid;
  }
}

export function validateDocumentUploadAlertEmailRecipients(
  rawValue: string,
): { trimmed: string; recipients: string[] } {
  const trimmed = (rawValue ?? "").trim();
  if (trimmed.length === 0) {
    return { trimmed, recipients: [] };
  }
  const parts = parseDocumentUploadAlertRecipients(trimmed);
  const invalid = parts.filter((r) => !DOC_EMAIL_RE.test(r));
  if (invalid.length > 0) {
    throw new InvalidDocumentUploadAlertEmailError(invalid);
  }
  return { trimmed, recipients: parts };
}

export async function saveDocumentUploadAlertEmailRecipients(
  rawValue: string,
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<DocumentUploadAlertEmailSetting> {
  const { trimmed } = validateDocumentUploadAlertEmailRecipients(rawValue);
  await storage.setAppSetting(
    DOCUMENT_UPLOAD_ALERT_EMAIL_SETTING_KEY,
    trimmed,
    updatedBy ?? null,
    executor,
  );
  if (executor) {
    return {
      recipients: trimmed ? parseDocumentUploadAlertRecipients(trimmed) : [],
      value: trimmed,
      source: trimmed ? "db" : "default",
      envOverride: false,
      storedValue: trimmed,
      updatedAt: null,
      updatedBy: updatedBy ?? null,
    };
  }
  return readDocumentUploadAlertEmailSetting();
}
// ── End document-upload alert helpers ──────────────────────────────────────

export const helpArticlesRouter = Router();

helpArticlesRouter.get("/", async (req, res) => {
  try {
    const articles = await storage.getAllHelpArticles();
    res.json(articles);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch help articles" });
  }
});

helpArticlesRouter.get("/category/:category", async (req, res) => {
  try {
    const articles = await storage.getHelpArticlesByCategory(req.params.category);
    res.json(articles);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch help articles" });
  }
});

helpArticlesRouter.get("/:id", async (req, res) => {
  try {
    const article = await storage.getHelpArticleById(parseInt(req.params.id));
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (!article.isPublished) {
      const isAdmin = await isValidAdminToken(req.headers.authorization);
      if (!isAdmin) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
    }
    res.json(article);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch help article" });
  }
});

helpArticlesRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const articleInput = z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      category: z.string().optional(),
      order: z.string().optional(),
      isPublished: z.boolean().optional()
    }).parse(req.body);

    const article = await storage.createHelpArticle(articleInput);
    res.json(article);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create help article" });
    }
  }
});

helpArticlesRouter.patch("/:id", checkAdminAuth, async (req, res) => {
  try {
    const articleInput = z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      category: z.string().optional(),
      order: z.string().optional(),
      isPublished: z.boolean().optional()
    }).parse(req.body);

    const article = await storage.updateHelpArticle(parseInt(req.params.id), articleInput);
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json(article);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update help article" });
    }
  }
});

helpArticlesRouter.delete("/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteHelpArticle(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete help article" });
  }
});

export const userFeedbackRouter = Router();

userFeedbackRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const feedback = await storage.getAllUserFeedback();
    res.json(feedback);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch user feedback" });
  }
});

export function registerCaseFeedbackRoutes(router: Router) {
  router.get("/:id/feedback", requirePortalAccess, async (req, res) => {
    try {
      const feedback = await storage.getUserFeedbackByCaseId(req.params.id);
      res.json(feedback);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch user feedback" });
    }
  });

  router.post("/:id/feedback", requirePortalAccess, requireUnsealed, async (req, res) => {
    try {
      // Feedback must originate from the portal user, not an admin token.
      const callerIsAdmin = await isValidAdminToken(req.headers.authorization);
      if (callerIsAdmin) {
        res.status(403).json({ error: "Admin credentials cannot submit user feedback" });
        return;
      }

      const feedbackInput = z.object({
        rating: z.string().min(1),
        comment: z.string().optional(),
        feedbackType: z.string().optional()
      }).parse(req.body);

      const feedback = await storage.createUserFeedback({
        caseId: req.params.id,
        ...feedbackInput
      });
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to create user feedback" });
      }
    }
  });
}

export const documentRequestsRouter = Router();

// Allowed regulatory document categories (enforced at the route layer because
// the underlying schema column is free-form text — see shared/schema.ts).
// New financial-paperwork categories (bank_statement, tax_return,
// wallet_ownership_proof, aml_screening, beneficial_ownership) were added
// to give admins a richer dropdown without breaking the existing five.
const DOCUMENT_CATEGORIES = [
  'proof_of_income',
  'source_of_funds',
  'kyc_id',
  'fatca_crs',
  'bank_statement',
  'tax_return',
  'wallet_ownership_proof',
  'aml_screening',
  'beneficial_ownership',
  // Financial signatory documents (Task #140) — the user downloads a
  // pre-filled template via GET /api/cases/:id/document-templates/:category,
  // signs offline, and uploads the signed copy through the normal flow.
  'tax_residency_declaration',
  'settlement_authorization',
  'power_of_attorney',
  'custom',
] as const;

// Subset of categories that ship with a downloadable, pre-filled offline
// template (Task #140). Includes the three new categories above plus four
// pre-existing categories that compliance frequently asks the user to
// sign offline. Used by the admin Documents panel to (a) group them in
// the request dropdown and (b) gate them on the NDA-signed precondition,
// and by the portal to surface a "Download template" button next to the
// upload control.
export const FINANCIAL_SIGNATORY_CATEGORIES = [
  'source_of_funds',
  'beneficial_ownership',
  'fatca_crs',
  'aml_screening',
  'tax_residency_declaration',
  'settlement_authorization',
  'power_of_attorney',
] as const;

export type FinancialSignatoryCategory =
  (typeof FINANCIAL_SIGNATORY_CATEGORIES)[number];

// Human-readable labels for every regulatory document category. These
// drive the admin dropdown, the portal Download-template button label,
// the audit log payload, and the transactional email subject/body so
// the user always sees the same friendly name everywhere.
export const DOCUMENT_CATEGORY_LABELS: Record<
  (typeof DOCUMENT_CATEGORIES)[number],
  string
> = {
  proof_of_income: 'Proof of Income',
  source_of_funds: 'Source of Funds Declaration',
  kyc_id: 'KYC Identity Verification',
  fatca_crs: 'FATCA / CRS Self-Certification',
  bank_statement: 'Bank Statement',
  tax_return: 'Tax Return',
  wallet_ownership_proof: 'Wallet Ownership Proof',
  aml_screening: 'AML Acknowledgement',
  beneficial_ownership: 'Beneficial Ownership / KYC Attestation',
  tax_residency_declaration: 'Tax Residency Declaration',
  settlement_authorization: 'Settlement / Disbursement Authorization',
  power_of_attorney: 'Power of Attorney for Disbursement',
  custom: 'Custom',
};

// Accepted upload MIME types (PDF + common images). Mirrored client-side in
// DocumentsView. Keep these aligned.
const ACCEPTED_DOC_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB hard cap (decoded)
const DATA_URL_PREFIX = /^data:([a-zA-Z0-9+\-./]+);base64,(.+)$/;

export function validateDocumentDataUrl(dataUrl: string): { ok: true; mime: string; bytes: number } | { ok: false; error: string } {
  const match = DATA_URL_PREFIX.exec(dataUrl.trim());
  if (!match) {
    return { ok: false, error: 'File payload must be a base64 data URL.' };
  }
  const mime = match[1].toLowerCase();
  if (!ACCEPTED_DOC_MIME.includes(mime as typeof ACCEPTED_DOC_MIME[number])) {
    return { ok: false, error: `Unsupported file type "${mime}". Allowed: PDF, PNG, JPEG, WebP.` };
  }
  // Estimate decoded byte length from base64 length without actually decoding
  // the entire blob (which would double memory usage on a hot path).
  const b64 = match[2];
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes <= 0) {
    return { ok: false, error: 'File appears to be empty.' };
  }
  if (bytes > MAX_DOC_BYTES) {
    return { ok: false, error: `File is ${(bytes / 1024 / 1024).toFixed(1)} MB. Maximum is 10 MB.` };
  }
  return { ok: true, mime, bytes };
}

// Admin-only: list every document request across every case in one call.
// Replaces N+1 polling on the admin dashboard so user uploads surface in
// near-real-time without thrashing the API.
documentRequestsRouter.get("/", checkAdminAuth, async (_req, res) => {
  try {
    const all = await storage.getAllDocumentRequests();
    res.json(all);
  } catch (error) {
    warnOnce("content:list-doc-requests-fail", "[content] list all document requests failed:", error);
    res.status(500).json({ error: "Failed to fetch document requests" });
  }
});

// Admin-only: fetch one document request including its (potentially
// multi-megabyte) base64 file blob. The list endpoint above strips the
// blob to keep polling cheap; the admin UI calls this on demand when a
// reviewer clicks Preview or Download.
documentRequestsRouter.get("/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const row = await storage.getDocumentRequestById(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (error) {
    warnOnce("content:fetch-doc-request-fail", "[content] fetch document request failed:", error);
    res.status(500).json({ error: "Failed to fetch document request" });
  }
});

// User-facing PATCH: portal calls this to submit a file against an open
// request. Requires a valid portal session for the case that owns the
// request, or a valid admin token. The case association is verified server-side
// by looking up the existing row, so possession of the request id alone is no
// longer sufficient.
documentRequestsRouter.patch("/:id", async (req, res) => {
  try {
    const requestInput = z.object({
      submittedFileData: z.string().min(1),
      submittedFileName: z.string().min(1).max(255),
    }).parse(req.body);

    const fileCheck = validateDocumentDataUrl(requestInput.submittedFileData);
    if (!fileCheck.ok) {
      res.status(400).json({ error: fileCheck.error });
      return;
    }

    // Honour the admin-controlled upload toggle. If the request was
    // paused by an admin, refuse the submission with a 403 so the portal
    // can surface a friendly message instead of silently appearing to
    // succeed. Done before the update so we don't burn a write.
    const existing = await storage.getDocumentRequestById(parseInt(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    // Verify the caller is the case holder (portal session only).
    // Admin bearer tokens must not be accepted here: this action is
    // attributed to the user, so permitting an admin token would let an
    // operator forge a submission that appears user-originated.
    const { isPortalSessionValidForCase } = await import("../services/portal-auth");
    const authorized = await isPortalSessionValidForCase(req, existing.caseId);
    if (!authorized) {
      res.status(401).json({ error: "Portal session required" });
      return;
    }

    if (existing.uploadsEnabled === false) {
      res.status(403).json({ error: "Uploads for this document request are currently paused by the compliance team." });
      return;
    }

    // Block re-submission once compliance has approved the document.
    // The portal UI already hides the upload control for approved requests,
    // but we enforce it here so a direct API call cannot overwrite the
    // exact artifact that was accepted as part of the compliance record.
    if (existing.status === 'approved') {
      res.status(403).json({ error: "This document has already been approved and cannot be replaced." });
      return;
    }

    // Task #173 — wrap the submission update and its audit log in a
    // single DB transaction so an audit-write failure rolls back the
    // status flip and the user can re-upload cleanly.
    let updated: Awaited<ReturnType<typeof storage.updateDocumentRequest>>;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateDocumentRequest(parseInt(req.params.id), {
          submittedFileData: requestInput.submittedFileData,
          submittedFileName: requestInput.submittedFileName,
          status: 'submitted',
          submittedAt: new Date(),
        }, tx);
        if (u) {
          await storage.createAuditLog({
            action: 'document_submitted',
            newValue: `User submitted file "${requestInput.submittedFileName}" for "${u.documentType}" (#${u.id})`,
            adminUsername: 'system',
            targetType: 'case',
            targetId: u.caseId,
          }, tx);
        }
        return u;
      });
    } catch (txErr) {
      console.error('[content] document submit transaction failed:', txErr);
      res.status(500).json({ error: "Failed to update document request" });
      return;
    }
    if (!updated) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyAdmin(
          'document_submitted',
          'Document Submitted for Review',
          `Case ${updated.caseId} submitted "${updated.documentType}".`,
          `/admin`,
        );
      } catch (e) {
        console.error('[content] notify admin document submit failed:', e);
      }
      try {
        const recipients = await resolveDocumentUploadAlertRecipientsLocal();
        if (recipients.length > 0) {
          const { emailService } = await import("../services/EmailService");
          const baseUrl = getPublicBaseUrl();
          await emailService.sendUserDocumentUploadedAlert({
            to: recipients,
            caseId: updated.caseId,
            documentType: updated.documentType,
            fileName: requestInput.submittedFileName,
            dashboardUrl: `${baseUrl}/admin`,
          });
        }
      } catch (e) {
        console.error('[content] document upload alert email failed:', e);
      }
    })();
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      console.error('[content] document submit failed:', error);
      res.status(500).json({ error: "Failed to update document request" });
    }
  }
});

// Admin-only review endpoints. Approve / reject set the final status, write
// an audit log entry, and best-effort notify the user by email.
async function reviewDocumentRequest(
  req: any,
  res: any,
  decision: 'approved' | 'rejected',
) {
  try {
    const body = z.object({
      adminNotes: z.string().optional(),
    }).parse(req.body ?? {});

    const id = parseInt(req.params.id);

    // No-op guard: if the document is already at the requested final status,
    // skip the route-level audit AND the user notification so re-clicks /
    // accidental replays don't spam the user or pollute the audit trail.
    // Mirrors the verified payout-wallet PATCH guard in cases.ts.
    const existing = await storage.getDocumentRequestById(id);
    const isNoOpStatusChange = !!existing && existing.status === decision;

    const adminUser = (req as any).admin?.username || "Admin";

    // Task #144 — wrap the row update and its audit-log write in a single
    // DB transaction so an audit-write failure rolls back the decision.
    let updated: Awaited<ReturnType<typeof storage.updateDocumentRequest>> | undefined;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateDocumentRequest(id, {
          status: decision,
          adminNotes: body.adminNotes,
          // Stamp approval time so the 90-day archive sweep can age out
          // the file blob from the moment of approval rather than from
          // submission. Rejections leave approvedAt null on purpose; if
          // the user resubmits and the row is later approved we'll stamp
          // it then.
          ...(decision === 'approved' ? { approvedAt: new Date() } : {}),
        }, tx);
        if (!u) return undefined;
        if (!isNoOpStatusChange) {
          await storage.createAuditLog({
            action: decision === 'approved' ? 'document_approved' : 'document_rejected',
            newValue: `Document "${u.documentType}" (#${u.id}) ${decision}${body.adminNotes ? ` — ${body.adminNotes}` : ''}`,
            adminUsername: adminUser,
            targetType: 'case',
            targetId: u.caseId,
          }, tx);
        }
        return u;
      });
    } catch (txErr) {
      console.error('[content] document review transaction failed:', txErr);
      res.status(500).json({ error: "Failed to update document request" });
      return;
    }

    if (!updated) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    if (isNoOpStatusChange) {
      res.json(updated);
      return;
    }

    // Fire-and-forget so SMTP latency doesn't block the admin's review click.
    const userLocale = req.userLocale;
    void (async () => {
      try {
        const caseRow = await storage.getCaseById(updated.caseId);
        if (caseRow?.userEmail) {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const userName = (caseRow.userName ?? "").trim() || caseRow.userEmail;
          await sendCaseEmailWithAudit({
            to: caseRow.userEmail,
            caseId: updated.caseId,
            tag: decision === 'approved' ? 'document-approved' : 'document-rejected',
            adminUser,
            // Task #158 — pin the source request so a retry resends
            // the decision for THIS document, not the latest matching
            // request on the case.
            metadata: {
              documentRequestId: updated.id,
              decision,
              notes: body.adminNotes ?? null,
            },
            send: () =>
              emailService.sendLocalizedCaseEmail({
                to: caseRow.userEmail!,
                userName,
                caseRef: updated.caseId,
                locale: caseRow.preferredLocale ?? userLocale,
                templateKey: decision === 'approved' ? 'documentApproved' : 'documentRejected',
                ctaPath: '/portal?view=documents',
                logTag: decision === 'approved' ? 'document-approved' : 'document-rejected',
                vars: {
                  documentType: updated.documentType,
                  notes: body.adminNotes ?? '',
                },
              }),
          });
        }
      } catch (err) {
        console.error(`[content] document-${decision} email failed:`, err);
      }
    })();

    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        const title = decision === 'approved' ? 'Document Approved' : 'Document Update';
        const msg = decision === 'approved'
          ? `Your document "${updated.documentType}" has been approved.`
          : `Your document "${updated.documentType}" requires attention.${body.adminNotes ? ` Note: ${body.adminNotes}` : ''}`;
        await notificationService.notifyUser(
          updated.caseId,
          `document_${decision}`,
          title,
          msg,
          '/portal?view=documents',
        );
      } catch (e) {
        console.error(`[content] notify user document ${decision} failed:`, e);
      }
    })();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      console.error(`[content] document ${decision} failed:`, error);
      res.status(500).json({ error: "Failed to review document request" });
    }
  }
}

documentRequestsRouter.post("/:id/approve", checkAdminAuth, requireAdminRole("admin"), (req, res) =>
  reviewDocumentRequest(req, res, 'approved')
);
documentRequestsRouter.post("/:id/reject", checkAdminAuth, requireAdminRole("admin"), (req, res) =>
  reviewDocumentRequest(req, res, 'rejected')
);

// Admin-only: mark a submitted document as "under review" so the portal
// badge transitions to blue and the user knows compliance is actively
// processing their file. Only valid for documents in `submitted` status;
// already-under-review docs are treated as a no-op.
documentRequestsRouter.post("/:id/mark-under-review", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const adminUser = (req as any).admin?.username || "Admin";

    const existing = await storage.getDocumentRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    if (!existing.submittedAt) {
      res.status(400).json({ error: "Document has not been submitted yet." });
      return;
    }

    if (existing.status === 'under_review') {
      res.json(existing);
      return;
    }

    if (!['submitted'].includes(existing.status ?? '')) {
      res.status(400).json({ error: `Cannot mark a '${existing.status}' document as under review.` });
      return;
    }

    let updated: Awaited<ReturnType<typeof storage.updateDocumentRequest>> | undefined;
    try {
      updated = await storage.runInTransaction(async (tx) => {
        const u = await storage.updateDocumentRequest(id, { status: 'under_review' }, tx);
        if (!u) return undefined;
        await storage.createAuditLog({
          action: 'document_under_review',
          newValue: `Document "${u.documentType}" (#${u.id}) marked under review`,
          adminUsername: adminUser,
          targetType: 'case',
          targetId: u.caseId,
        }, tx);
        return u;
      });
    } catch (txErr) {
      console.error('[content] document mark-under-review transaction failed:', txErr);
      res.status(500).json({ error: "Failed to update document request" });
      return;
    }

    if (!updated) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    // Fire-and-forget notification — tell the user compliance is reviewing.
    const userLocale = (req as any).userLocale;
    void (async () => {
      try {
        const caseRow = await storage.getCaseById(updated.caseId);
        if (caseRow?.userEmail) {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
          const userName = (caseRow.userName ?? "").trim() || caseRow.userEmail;
          await sendCaseEmailWithAudit({
            to: caseRow.userEmail,
            caseId: updated.caseId,
            tag: 'document-under-review',
            adminUser,
            metadata: { documentRequestId: updated.id },
            send: () =>
              emailService.sendLocalizedCaseEmail({
                to: caseRow.userEmail!,
                userName,
                caseRef: updated.caseId,
                locale: caseRow.preferredLocale ?? userLocale,
                templateKey: 'documentUnderReview',
                ctaPath: '/portal?view=documents',
                logTag: 'document-under-review',
                vars: { documentType: updated.documentType },
              }),
          });
        }
      } catch (err) {
        console.error('[content] document-under-review email failed:', err);
      }
    })();

    void (async () => {
      try {
        const { notificationService } = await import("../services/NotificationService");
        await notificationService.notifyUser(
          updated.caseId,
          'document_under_review',
          'Document Under Review',
          `Your document "${updated.documentType}" is now being reviewed by compliance.`,
          '/portal?view=documents',
        );
      } catch (e) {
        console.error('[content] notify user document under_review failed:', e);
      }
    })();

    res.json(updated);
  } catch (error) {
    console.error('[content] document mark-under-review failed:', error);
    res.status(500).json({ error: "Failed to update document request" });
  }
});

// Admin-only: toggle the user-facing upload link on/off for a single
// document request. The unauth submission PATCH consults this flag and
// the portal hides its upload button when false. Always emits an audit
// log entry so the trail shows who paused/resumed and when.
documentRequestsRouter.patch("/:id/uploads-enabled", checkAdminAuth, async (req, res) => {
  try {
    const body = z.object({ uploadsEnabled: z.boolean() }).parse(req.body);
    const id = parseInt(req.params.id);
    const existing = await storage.getDocumentRequestById(id);
    if (!existing) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }
    // No-op: avoid spammy audit rows when an admin double-clicks the toggle.
    if (existing.uploadsEnabled === body.uploadsEnabled) {
      res.json(existing);
      return;
    }
    const adminUser = (req as any).admin?.username || "Admin";
    const updated = await storage.runInTransaction(async (tx) => {
      const u = await storage.updateDocumentRequest(
        id,
        { uploadsEnabled: body.uploadsEnabled },
        tx,
      );
      if (!u) return undefined;
      await storage.createAuditLog(
        {
          action: body.uploadsEnabled ? 'document_uploads_enabled' : 'document_uploads_disabled',
          newValue: `Document "${u.documentType}" (#${u.id}) uploads ${body.uploadsEnabled ? 'enabled' : 'disabled'}`,
          adminUsername: adminUser,
          targetType: 'case',
          targetId: u.caseId,
        },
        tx,
      );
      return u;
    });
    if (!updated) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      console.error('[content] uploads-enabled toggle failed:', error);
      res.status(500).json({ error: "Failed to update upload toggle" });
    }
  }
});

export function registerCaseDocumentRoutes(router: Router) {
  router.get("/:id/document-requests", requirePortalAccess, async (req, res) => {
    try {
      const requests = await storage.getDocumentRequestsByCaseId(req.params.id);
      res.json(requests);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch document requests" });
    }
  });

  router.post("/:id/document-requests", checkAdminAuth, async (req, res) => {
    try {
      const requestInput = z.object({
        documentType: z.string().min(1),
        category: z.enum(DOCUMENT_CATEGORIES).optional(),
        description: z.string().optional(),
        deadline: z.string().optional()
      }).parse(req.body);

      // NDA-signed precondition (Task #140): financial-signatory
      // categories may only be requested after the case is sealed.
      // Enforced here so client-side gating cannot be bypassed.
      if (
        requestInput.category &&
        (FINANCIAL_SIGNATORY_CATEGORIES as readonly string[]).includes(requestInput.category)
      ) {
        const caseRow = await storage.getCaseById(req.params.id);
        if (!caseRow) {
          return res.status(404).json({ error: "Case not found" });
        }
        if (!caseRow.sealedAt) {
          return res.status(409).json({
            error:
              "Financial signatory documents can only be requested after the NDA has been signed.",
          });
        }
      }

      // Drop `category` before insert — it is a routing hint for the
      // audit log + portal template button and is not a schema column.
      const { category: _category, ...insertable } = requestInput;
      const caseId = req.params.id;
      const adminUser = (req as any).admin?.username || "Admin";

      // Audit log so each request — and the optional category the admin
      // picked from the dropdown (Task #140) — is captured for traceability.
      const request = await storage.runInTransaction(async (tx) => {
        const r = await storage.createDocumentRequest(
          {
            caseId,
            ...insertable,
            deadline: requestInput.deadline ? new Date(requestInput.deadline) : undefined,
          },
          tx,
        );
        const tag = requestInput.category
          ? `document_requested:${requestInput.category}`
          : 'document_requested';
        await storage.createAuditLog(
          {
            action: tag,
            newValue: `Document "${requestInput.documentType}" (#${r.id}) requested${requestInput.deadline ? ` (deadline ${requestInput.deadline})` : ''}`,
            adminUsername: adminUser,
            targetType: 'case',
            targetId: caseId,
          },
          tx,
        );
        return r;
      });

      // Notify the user that a document has been requested. Fire-and-forget
      // so SMTP latency doesn't block the admin's create click.
      const userLocale = req.userLocale;
      void (async () => {
        try {
          const caseRow = await storage.getCaseById(caseId);
          if (caseRow?.userEmail) {
            const { emailService } = await import("../services/EmailService");
            const { sendCaseEmailWithAudit } = await import(
              "../services/emailNotify"
            );
            const userName =
              (caseRow.userName ?? "").trim() || caseRow.userEmail;
            await sendCaseEmailWithAudit({
              to: caseRow.userEmail,
              caseId,
              tag: "document-requested",
              adminUser,
              // Task #158 — pin the exact request row this email is
              // about so a later retry resends THIS request's
              // documentType/description/deadline rather than the
              // latest pending request on the case.
              metadata: { documentRequestId: request.id },
              send: () =>
                emailService.sendLocalizedCaseEmail({
                  to: caseRow.userEmail!,
                  userName,
                  caseRef: caseId,
                  locale: caseRow.preferredLocale ?? userLocale,
                  templateKey: 'documentRequested',
                  ctaPath: '/portal?view=documents',
                  logTag: 'document-requested',
                  vars: {
                    documentType: requestInput.documentType,
                    description: requestInput.description ?? '',
                    deadline: requestInput.deadline ?? '',
                  },
                }),
            });
          }
        } catch (err) {
          console.error("[content] document-requested email failed:", err);
        }
      })();

      void (async () => {
        try {
          const { notificationService } = await import("../services/NotificationService");
          await notificationService.notifyUser(
            request.caseId,
            'document_requested',
            'Document Requested',
            `A new document has been requested: "${requestInput.documentType}". Please visit the Documents section to upload.`,
            '/portal?view=documents',
          );
        } catch (e) {
          console.error('[content] notify user document requested failed:', e);
        }
      })();

      res.json(request);
    } catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to create document request" });
      }
    }
  });

  // Download a pre-filled financial signatory template (Task #140).
  // Authenticated: accepts either a valid admin bearer OR a portal session
  // bound to the owning case — mirrors the auth used by the document
  // submission endpoint. Possession of the case id alone is not sufficient.
  router.get(
    "/:id/document-templates/:category",
    async (req, res) => {
      try {
        const caseId = req.params.id;
        const categoryRaw = String(req.params.category || '');
        const { isFinancialSignatoryCategory, buildFinancialSignatoryTemplate, financialSignatoryLabel } =
          await import("../services/financialSignatoryPdf");
        if (!isFinancialSignatoryCategory(categoryRaw)) {
          res.status(400).json({ error: "Unknown template category" });
          return;
        }
        const isAdmin = await isValidAdminToken(req.headers.authorization);
        if (!isAdmin) {
          const { isAuthorizedForCase } = await import("../services/portal-auth");
          const ok = await isAuthorizedForCase(req, caseId);
          if (!ok) {
            res.status(401).json({ error: "Authentication required" });
            return;
          }
        }
        const caseRow = await storage.getCaseById(caseId);
        if (!caseRow) {
          res.status(404).json({ error: "Case not found" });
          return;
        }
        const pdf = await buildFinancialSignatoryTemplate({
          caseRow,
          category: categoryRaw,
        });
        const filename = `${financialSignatoryLabel(categoryRaw).replace(/[^\w.-]+/g, '_')}_${caseRow.id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`,
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(pdf);
      } catch (err) {
        warnOnce("content:financial-signatory-template-fail", "[content] financial signatory template failed:", err);
        res.status(500).json({ error: "Failed to generate template" });
      }
    },
  );

  // Admin-triggered KYC ID verification bundle. Creates the canonical
  // four-document set (ID front/back + selfie holding ID front/back) in
  // one atomic admin action AFTER all proof-of-income documents on the
  // case have been approved. Idempotent: refuses if any of the four
  // KYC bundle documentType strings already exist on the case.
  router.post("/:id/kyc-id-bundle", checkAdminAuth, async (req, res) => {
    try {
      const caseId = req.params.id;
      const existing = await storage.getDocumentRequestsByCaseId(caseId);

      // Identify proof-of-income docs. Match the canonical 'proof_of_income'
      // documentType string (used by the per-case Request flow) plus the
      // declaration-attached variant prefixed by DECLARATION_DOC_PREFIX in
      // server/routes/cases.ts.
      const incomeDocs = existing.filter((d) => {
        const t = (d.documentType ?? "").toLowerCase();
        return (
          t === "proof_of_income" ||
          /proof.*income|income.*proof|proof of source of income/.test(t)
        );
      });
      if (incomeDocs.length === 0) {
        res.status(400).json({
          error:
            "No proof-of-income documents have been submitted for this case yet.",
        });
        return;
      }
      if (!incomeDocs.every((d) => d.status === "approved")) {
        res.status(400).json({
          error:
            "All proof-of-income documents must be approved before requesting KYC ID verification.",
        });
        return;
      }

      const bundle = [
        {
          documentType: "KYC ID — Front",
          description:
            "Upload a clear, full-color photo or scan of the FRONT of your government-issued photo ID (passport, driver licence, or national ID card).",
        },
        {
          documentType: "KYC ID — Back",
          description:
            "Upload the BACK of the same government-issued photo ID. For passports without a back, upload the signature page.",
        },
        {
          documentType: "Selfie holding ID — Front",
          description:
            "Take a selfie clearly showing your face alongside the FRONT of the same ID. Both your face and the ID details must be readable.",
        },
        {
          documentType: "Selfie holding ID — Back",
          description:
            "Take a second selfie clearly showing your face alongside the BACK of the same ID. Both your face and the ID details must be readable.",
        },
      ];

      // Partial-failure-recoverable idempotency. We never insert a
      // documentType that already exists on this case, so a previous
      // partially-failed call can be safely retried — only the missing
      // canonical rows get created. If all 4 are already present we
      // refuse with 409. Without a DB transaction this is the
      // strongest atomicity guarantee we can offer here.
      const existingTypes = new Set(existing.map((d) => d.documentType));
      const missing = bundle.filter((b) => !existingTypes.has(b.documentType));
      if (missing.length === 0) {
        res.status(409).json({
          error:
            "KYC ID verification has already been requested for this case.",
        });
        return;
      }
      const isRepair = missing.length < bundle.length;

      const adminUser = (req as any).admin?.username || "Admin";
      const created = await storage.runInTransaction(async (tx) => {
        const rows = [];
        for (const item of missing) {
          const r = await storage.createDocumentRequest(
            {
              caseId,
              documentType: item.documentType,
              description: item.description,
            },
            tx,
          );
          rows.push(r);
        }
        await storage.createAuditLog(
          {
            action: isRepair
              ? "kyc_id_bundle_repaired"
              : "kyc_id_bundle_requested",
            newValue: isRepair
              ? `KYC ID bundle repaired — created ${rows.length} missing document(s) for case ${caseId}`
              : `KYC ID verification bundle (4 documents) requested for case ${caseId}`,
            adminUsername: adminUser,
            targetType: "case",
            targetId: caseId,
          },
          tx,
        );
        return rows;
      });

      // One combined email rather than four separate notifications.
      // Skip the email on a repair to avoid spamming users when an
      // admin re-runs the action to fill in rows from a partial failure.
      // Fire-and-forget so SMTP latency doesn't block the admin's click.
      const userLocale = req.userLocale;
      void (async () => {
        try {
          const caseRow = await storage.getCaseById(caseId);
          if (!isRepair && caseRow?.userEmail) {
            const { emailService } = await import("../services/EmailService");
            const { sendCaseEmailWithAudit } = await import(
              "../services/emailNotify"
            );
            const userName =
              (caseRow.userName ?? "").trim() || caseRow.userEmail;
            await sendCaseEmailWithAudit({
              to: caseRow.userEmail,
              caseId,
              tag: "document-requested",
              adminUser,
              // Task #158 — the KYC bundle email has a hardcoded body
              // that doesn't depend on any single document_requests
              // row. Stamp the metadata so the retry handler knows to
              // re-render the KYC bundle copy verbatim (rather than
              // picking some pending request row's documentType).
              metadata: {
                kycIdBundle: true,
                documentRequestIds: created.map((c) => c.id),
              },
              send: () =>
                emailService.sendLocalizedCaseEmail({
                  to: caseRow.userEmail!,
                  userName,
                  caseRef: caseId,
                  locale: caseRow.preferredLocale ?? userLocale,
                  templateKey: 'documentRequested',
                  ctaPath: '/portal?view=documents',
                  logTag: 'document-requested',
                  vars: {
                    documentType: 'KYC Identity Verification (4 documents)',
                    description:
                      'Please upload all four KYC documents from the Documents section of your portal: ID Front, ID Back, Selfie holding ID Front, and Selfie holding ID Back.',
                    deadline: '',
                  },
                }),
            });
          }
        } catch (err) {
          console.error("[content] kyc-id-bundle email failed:", err);
        }
      })();

      res.json({ requests: created });
    } catch (error) {
      console.error("[content] kyc-id-bundle creation failed:", error);
      res.status(500).json({ error: "Failed to create KYC ID bundle" });
    }
  });

  // Note: the portal-facing `POST /:id/user-documents` handler lives in
  // `server/routes/cases.ts`. A duplicate previously defined here wrote to
  // the wrong table (`document_requests`) and was dead code because the
  // cases.ts handler was registered first on the same router. Removed in
  // Task #378 so the alert + "New" badge logic from Task #326 runs on the
  // only live path.
}

export const translationsRouter = Router();

translationsRouter.get("/", async (req, res) => {
  try {
    const translations = await storage.getTranslationsByLocale('en');
    res.json(translations);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

translationsRouter.get("/:locale", async (req, res) => {
  try {
    const translations = await storage.getTranslationsByLocale(req.params.locale);
    res.json(translations);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

translationsRouter.post("/", checkAdminAuth, async (req, res) => {
  try {
    const translationInput = z.object({
      locale: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1)
    }).parse(req.body);

    const translation = await storage.createTranslation(translationInput);
    res.json(translation);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to create translation" });
    }
  }
});

translationsRouter.patch("/:id", checkAdminAuth, async (req, res) => {
  try {
    const translationInput = z.object({
      value: z.string().min(1)
    }).parse(req.body);

    const translation = await storage.updateTranslation(parseInt(req.params.id), translationInput);
    if (!translation) {
      res.status(404).json({ error: "Translation not found" });
      return;
    }
    res.json(translation);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      res.status(500).json({ error: "Failed to update translation" });
    }
  }
});

translationsRouter.delete("/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteTranslation(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete translation" });
  }
});

// ------------------------------------------------------------------
// User Documents admin router — mounted at /api/user-documents and
// /api/admin/user-documents
// ------------------------------------------------------------------

const USER_DOCUMENT_STATUSES = ["uploaded", "reviewed", "approved", "rejected"] as const;

export const userDocumentsAdminRouter = Router();

// GET /pending-counts — per-case count of user documents with status='uploaded'.
// Returns { counts: Record<string, number> }. The admin dashboard polls this
// every 5 s to drive the real-time "New uploads" badge on case rows.
// Must be registered BEFORE the /:id routes so Express doesn't interpret
// "pending-counts" as a numeric id.
userDocumentsAdminRouter.get("/pending-counts", checkAdminAuth, async (_req, res) => {
  try {
    const counts = await storage.getPendingUserDocumentCounts();
    res.json({ counts });
  } catch (err) {
    warnOnce("content:pending-user-doc-counts-fail", "[content] pending user-document counts failed:", err);
    res.status(500).json({ error: "Failed to fetch pending counts" });
  }
});

// GET / — list all supporting documents across all cases, stripped of file blobs.
// Optionally filter by ?status= and/or ?caseId=
userDocumentsAdminRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const { status, caseId } = req.query as { status?: string; caseId?: string };
    const validStatuses = USER_DOCUMENT_STATUSES as readonly string[];
    if (status !== undefined && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${USER_DOCUMENT_STATUSES.join(", ")}` });
      return;
    }
    const docs = await storage.getAllUserDocuments({
      ...(status ? { status } : {}),
      ...(caseId ? { caseId } : {}),
    });
    res.json(docs);
  } catch (err) {
    warnOnce("content:list-user-docs-fail", "[content] list all user documents failed:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// GET /:id/file — return the raw base64 file blob for preview (admin only)
userDocumentsAdminRouter.get("/:id/file", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const doc = await storage.getUserDocumentById(id);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ fileData: doc.fileData, fileType: doc.fileType, fileName: doc.fileName });
  } catch (err) {
    warnOnce("content:user-doc-file-fetch-fail", "[content] user-document file fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch document file" });
  }
});

// PATCH /:id — update status and/or adminNotes (admin only).
// Both fields are optional; an empty body is a valid no-op.
userDocumentsAdminRouter.patch("/:id", checkAdminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }

    const body = z.object({
      status: z.enum(USER_DOCUMENT_STATUSES).optional(),
      adminNotes: z.string().optional(),
    }).parse(req.body);

    const existing = await storage.getUserDocumentById(id);
    if (!existing) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    // Empty body — no-op, return the document as-is.
    const updates: { status?: string; adminNotes?: string; reviewedAt?: Date | null; reviewedBy?: string | null } = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.adminNotes !== undefined) updates.adminNotes = body.adminNotes;
    if (Object.keys(updates).length === 0) {
      res.json(existing);
      return;
    }

    const adminUser = await resolveAdminUsernameFromReq(req);

    if (body.status !== undefined) {
      if (body.status === 'uploaded') {
        // Reset to initial state — clear any prior reviewer stamp.
        updates.reviewedAt = null;
        updates.reviewedBy = null;
      } else {
        updates.reviewedAt = new Date();
        updates.reviewedBy = adminUser;
      }
    }

    const updated = await storage.runInTransaction(async (tx) => {
      const u = await storage.updateUserDocument(id, updates, tx);
      if (!u) return undefined;
      const auditAction = updates.status === 'approved'
        ? 'user_document_approved'
        : updates.status === 'rejected'
          ? 'user_document_rejected'
          : updates.status
            ? 'user_document_reviewed'
            : 'user_document_notes_updated';
      await storage.createAuditLog({
        action: auditAction,
        newValue: `Supporting document "${u.fileName}" (#${u.id})${updates.status ? ` ${updates.status}` : ''}${updates.adminNotes ? ` — ${updates.adminNotes}` : ''}`,
        adminUsername: adminUser,
        targetType: 'case',
        targetId: u.caseId,
      }, tx);
      return u;
    });

    if (!updated) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request" });
    } else {
      console.error('[content] user-document patch failed:', error);
      res.status(500).json({ error: "Failed to update document" });
    }
  }
});

// registerCaseUserDocumentRoutes — mounted on the cases router
// GET /api/cases/:id/user-documents lists supporting docs without blobs (admin only)
export function registerCaseUserDocumentRoutes(router: Router) {
  router.get("/:id/user-documents", checkAdminAuth, async (req, res) => {
    try {
      const docs = await storage.getUserDocumentsByCaseId(req.params.id);
      res.json(docs);
    } catch (err) {
      warnOnce("content:case-user-docs-list-fail", "[content] user-documents list failed:", err);
      res.status(500).json({ error: "Failed to fetch supporting documents" });
    }
  });
}
