import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { requirePortalAccess, requireUnsealed } from "../services/portal-auth";
import { checkAdminAuth } from "./middleware";
import { warnOnce } from "../lib/warnOnce";
import { rateLimiter, SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE } from "../middleware/security";

const PUBLIC_WRITE_MAX = 5;
const PUBLIC_WRITE_WINDOW_MS = 60 * 1000;

export const submissionsRouter = Router();

// Public complaint-intake endpoint — unauthenticated, rate-limited to
// 5 requests per minute per IP. Any future expansion of this route
// (e.g. storing to a dedicated table) should keep the rate limiter
// in place so spam protection is never accidentally stripped.
submissionsRouter.post(
  "/",
  rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
    persistNamespace: SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE,
  }),
  async (req, res) => {
    try {
      const intakeSchema = z.object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().email().max(320),
        subject: z.string().trim().max(300).optional().nullable(),
        message: z.string().trim().min(1).max(5000),
        platform: z.string().trim().max(200).optional().nullable(),
        incidentDate: z.string().trim().max(100).optional().nullable(),
        amountLost: z.string().trim().max(100).optional().nullable(),
      });
      const data = intakeSchema.parse(req.body);
      const complaint = await storage.createPublicComplaint({
        name: data.name,
        email: data.email,
        subject: data.subject ?? null,
        description: data.message,
        status: "new",
        platform: data.platform ?? null,
        incidentDate: data.incidentDate ?? null,
        amountLost: data.amountLost ?? null,
      });
      res.status(201).json({ success: true });

      // Fire-and-forget post-submission side effects. Response is already sent.
      const complaintId = String(complaint.id);
      const submitterName = data.name;
      const submitterEmail = data.email;
      const dashboardUrl = `${process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'https://ibccf.site'}/admin`;

      // In-app admin notification (mirrors the email alert below).
      void (async () => {
        try {
          const { notificationService } = await import("../services/NotificationService");
          await notificationService.notifyAdmin(
            'new_case',
            `New complaint submitted by ${submitterName}`,
            (data.subject ?? '').substring(0, 80) || submitterName,
            dashboardUrl,
          );
        } catch (err) {
          warnOnce('submissions:admin-notify-fail', '[submissions] admin in-app notification failed:', err);
        }
      })();

      // Gap 1: acknowledge to the submitter that we received their complaint.
      void (async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const result = await emailService.sendCaseCreatedConfirmation({
            to: submitterEmail,
            userName: submitterName,
            caseRef: `#${complaintId}`,
            locale: req.userLocale,
          });
          await storage.createAuditLog({
            action: result.success ? 'email_case_created' : 'email_case_created_failed',
            newValue: result.success
              ? `Case-created confirmation sent to ${submitterEmail}`
              : `Case-created confirmation failed: ${result.error ?? 'unknown'}`,
            adminUsername: 'system',
            targetType: 'submission',
            targetId: complaintId,
            metadata: null,
          });
        } catch (err) {
          warnOnce(
            'submissions:case-created-email-fail',
            '[submissions] case-created confirmation email failed:',
            err,
          );
        }
      })();

      // Gap 2: notify admins that a new complaint was submitted.
      void (async () => {
        try {
          const { emailService } = await import("../services/EmailService");
          const { resolveDocumentUploadAlertRecipientsLocal } = await import("./content");
          const recipients = await resolveDocumentUploadAlertRecipientsLocal();
          if (recipients.length > 0) {
            const result = await emailService.sendAdminNewCaseAlert({
              to: recipients,
              caseId: `#${complaintId}`,
              submitterName,
              dashboardUrl,
            });
            await storage.createAuditLog({
              action: result.success ? 'email_admin_new_case' : 'email_admin_new_case_failed',
              newValue: result.success
                ? `Admin new-case alert sent to ${recipients.join(', ')}`
                : `Admin new-case alert failed: ${result.error ?? 'unknown'}`,
              adminUsername: 'system',
              targetType: 'submission',
              targetId: complaintId,
              metadata: null,
            });
          }
        } catch (err) {
          warnOnce(
            'submissions:admin-new-case-alert-fail',
            '[submissions] admin new-case alert failed:',
            err,
          );
        }
      })();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to submit complaint" });
      }
    }
  },
);

submissionsRouter.get("/", checkAdminAuth, async (req, res) => {
  try {
    const submissions = await storage.getAllSubmissions();
    res.json(submissions);
  } catch (_e) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

submissionsRouter.delete("/:id", checkAdminAuth, async (req, res) => {
  try {
    await storage.deleteSubmission(parseInt(req.params.id));
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ error: "Failed to delete submission" });
  }
});

export function registerCaseSubmissionRoutes(router: Router) {
  router.get("/:id/submissions", requirePortalAccess, async (req, res) => {
    try {
      const submissions = await storage.getSubmissionsByCaseId(req.params.id);
      res.json(submissions);
    } catch (_e) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  router.post(
    "/:id/submissions",
    rateLimiter(PUBLIC_WRITE_MAX, PUBLIC_WRITE_WINDOW_MS, {
      persistNamespace: SUBMISSIONS_POST_RATE_LIMIT_NAMESPACE,
    }),
    requirePortalAccess,
    requireUnsealed,
    async (req, res) => {
    try {
      // Validate the user-entered amount: must contain a positive numeric
      // portion (commas allowed as thousand separators) and stay below a
      // reasonable cap. We keep it free-text to allow currency suffixes
      // like "1500 USDT" — matching the case schema's text column — but
      // refuse strings with no parseable number, zero/negative numbers, or
      // numbers above the cap.
      const MAX_AMOUNT = 1_000_000_000; // 1B USDT — well above any realistic withdrawal
      const parseAmountText = (raw: string): number | null => {
        // Strip leading currency-ish chars then grab the first number.
        const m = raw.replace(/[\s$£€]/g, '').match(/^[-+]?[\d,]*\.?\d+/);
        if (!m) return null;
        const num = Number(m[0].replace(/,/g, ''));
        if (!Number.isFinite(num)) return null;
        return num;
      };
      const submissionInput = z.object({
        // 'A' / 'B' = withdrawal-option selector; 'URL_SUBMISSION' = case opted
        // for an external submission URL (the user has clicked through to the
        // partner form and we record the dispatch).
        selectedOption: z.enum(['A', 'B', 'URL_SUBMISSION']),
        notes: z.string().optional().nullable(),
        // User-entered withdrawal amount captured on the submission step.
        // When provided we store this on the submission row instead of the
        // case-row snapshot so the admin sees what the user actually typed.
        // Free-text to allow currency suffix, but the leading numeric portion
        // is validated to be > 0 and <= MAX_AMOUNT.
        userWithdrawalAmount: z
          .string()
          .trim()
          .max(120)
          .optional()
          .nullable()
          .refine(
            (v) => {
              if (!v) return true; // empty / null is fine — server falls back
              const n = parseAmountText(v);
              return n !== null && n > 0 && n <= MAX_AMOUNT;
            },
            {
              message: `Amount must contain a positive number up to ${MAX_AMOUNT.toLocaleString()}.`,
            },
          ),
      }).parse(req.body);

      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      // When an active reissue round exists, the user must have a 'paid'
      // round (admin-approved deposit receipt) before they can resubmit.
      const activeReissue = await storage.getActiveLetterReissue(req.params.id);
      if (activeReissue && activeReissue.status !== 'paid') {
        res.status(400).json({
          error: activeReissue.status === 'awaiting_deposit'
            ? `This letter has been reissued. Please upload your deposit receipt for the ${activeReissue.reissueFee} reissue fee before resubmitting.`
            : `Your reissue payment is still being reviewed by the compliance team. You can resubmit once it is approved.`,
          requiresReissuePayment: true,
          reissue: activeReissue,
        });
        return;
      }

      // Prefer the user-typed amount; fall back to the case row for legacy
      // clients that don't send the field. Either way, the value persists
      // on the submission row exactly as written.
      const userAmount = submissionInput.userWithdrawalAmount?.trim();
      const submissionData = {
        caseId: req.params.id,
        selectedOption: submissionInput.selectedOption,
        notes: submissionInput.notes || null,
        userName: caseData.userName,
        userEmail: caseData.userEmail,
        withdrawalAmount: userAmount && userAmount.length > 0
          ? userAmount
          : caseData.withdrawalAmount,
        withdrawalBatches: caseData.withdrawalBatches,
      };

      const submission = await storage.createSubmission(submissionData);
      
      await storage.updateCase(req.params.id, { status: 'completed' });
      
      const adminMessages = await storage.getAdminMessagesByCaseId(req.params.id);
      for (const msg of adminMessages) {
        if (msg.category === 'urgent') {
          await storage.updateAdminMessage(msg.id, { category: 'processing' });
        }
      }

      // Confirmation email to the user. Best-effort — a failed send must not
      // discard a successful submission.
      if (caseData.userEmail) {
        try {
          const { emailService } = await import("../services/EmailService");
          const { sendCaseEmailWithAudit } = await import(
            "../services/emailNotify"
          );
          const userName =
            (caseData.userName ?? "").trim() || caseData.userEmail;
          await sendCaseEmailWithAudit({
            to: caseData.userEmail,
            caseId: req.params.id,
            tag: "submission-received",
            adminUser: "user",
            send: () =>
              emailService.sendLocalizedCaseEmail({
                to: caseData.userEmail!,
                userName,
                caseRef: req.params.id,
                locale: caseData.preferredLocale ?? req.userLocale,
                templateKey: "submissionReceived",
                ctaPath: "/portal?view=dashboard",
                logTag: "submission-received",
              }),
          });
        } catch (err) {
          warnOnce(
            "submissions:received-email-fail",
            "[submissions] submission-received email failed:",
            err,
          );
        }
      }

      res.json(submission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
      } else {
        res.status(500).json({ error: "Failed to create submission" });
      }
    }
  });
}
