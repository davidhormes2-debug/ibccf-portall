import type { Express } from "express";
import { type Server } from "http";

import {
  casesRouter,
  submissionsRouter,
  registerCaseSubmissionRoutes,
  messagesRouter,
  registerCaseMessageRoutes,
  scheduledMessagesRouter,
  registerCaseScheduledMessageRoutes,
  chatTemplatesRouter,
  messageTemplatesRouter,
  depositsRouter,
  registerCaseDepositRoutes,
  adminRouter,
  auditLogsRouter,
  adminSessionsRouter,
  notificationsRouter,
  userSessionsRouter,
  visitHistoryRouter,
  registerCaseSessionRoutes,
  twoFactorRouter,
  webAuthnRouter,
  helpArticlesRouter,
  translationsRouter,
  documentRequestsRouter,
  registerCaseDocumentRoutes,
  userFeedbackRouter,
  registerCaseFeedbackRoutes,
  userDocumentsAdminRouter,
  registerCaseUserDocumentRoutes,
  publicRouter,
  adminPublicContentRouter,
  departmentsRouter,
  communityRouter,
  adminCommunityModerationRouter,
  communicationsRouter,
  announcementsPublicRouter,
  accessKeyRequestsRouter,
  visitorsRouter,
  aiRouter,
  debugRouter,
  fxRouter,
  clientErrorsRouter,
  blockedIpsRouter,
  checkIpNotBlocked,
  withdrawalRequestsRouter,
  registerCaseWithdrawalRoutes,
  registerCaseLedgerRoutes,
  registerCaseWithdrawalActivationRoutes,
  withdrawalActivationSettingsRouter,
  adminUsersRouter,
} from "./routes/index";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Block denylisted IPs *before* any case or declaration handler runs.
  // The /api/admin/blocked-ips management endpoints are mounted separately
  // below so an admin who somehow ends up on the list can still unblock
  // themselves through the dashboard.
  app.use("/api/cases", checkIpNotBlocked, casesRouter);
  app.use("/api/submissions", checkIpNotBlocked, submissionsRouter);
  app.use("/api/admin/blocked-ips", blockedIpsRouter);
  app.use("/api/chat", messagesRouter);
  // The handlers in messagesRouter operate on admin_messages rows
  // (PATCH /:id sets category, DELETE /:id removes one, POST /:id/read marks
  // read). The admin dashboard and portal both call these via
  // /api/admin-messages/..., so mount the same router there too. Keeping the
  // /api/chat mount preserves any legacy callers.
  app.use("/api/admin-messages", messagesRouter);
  app.use("/api/chat-templates", chatTemplatesRouter);
  app.use("/api/message-templates", messageTemplatesRouter);
  app.use("/api/scheduled-messages", scheduledMessagesRouter);
  app.use("/api/deposits", depositsRouter);
  app.use("/api/deposit-receipts", depositsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin/visit-history", visitHistoryRouter);
  app.use("/api/audit-logs", auditLogsRouter);
  app.use("/api/admin-sessions", adminSessionsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/user-sessions", userSessionsRouter);
  app.use("/api/two-factor", twoFactorRouter);
  app.use("/api/webauthn", webAuthnRouter);
  app.use("/api/help-articles", helpArticlesRouter);
  app.use("/api/translations", translationsRouter);
  app.use("/api/document-requests", documentRequestsRouter);
  app.use("/api/user-documents", userDocumentsAdminRouter);
  app.use("/api/user-feedback", userFeedbackRouter);
  app.use("/api/admin/user-documents", userDocumentsAdminRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/admin/content", adminPublicContentRouter);
  app.use("/api/departments", departmentsRouter);
  app.use("/api/community", communityRouter);
  app.use("/api/admin/community", adminCommunityModerationRouter);
  app.use("/api/access-key-requests", accessKeyRequestsRouter);
  app.use("/api/visitors", visitorsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/_debug", debugRouter);
  app.use("/api/admin/communications", communicationsRouter);
  app.use("/api/announcements", announcementsPublicRouter);
  app.use("/api/fx", fxRouter);
  app.use("/api/client-errors", clientErrorsRouter);
  app.use("/api/withdrawal-requests", withdrawalRequestsRouter);

  registerCaseSubmissionRoutes(casesRouter);
  registerCaseDepositRoutes(casesRouter);
  registerCaseMessageRoutes(casesRouter);
  registerCaseScheduledMessageRoutes(casesRouter);
  registerCaseSessionRoutes(casesRouter);
  registerCaseDocumentRoutes(casesRouter);
  registerCaseFeedbackRoutes(casesRouter);
  registerCaseUserDocumentRoutes(casesRouter);
  registerCaseWithdrawalRoutes(casesRouter);
  registerCaseLedgerRoutes(casesRouter);
  registerCaseWithdrawalActivationRoutes(casesRouter);

  app.use("/api/admin", withdrawalActivationSettingsRouter);
  app.use("/api/admin-users", adminUsersRouter);

  return httpServer;
}
