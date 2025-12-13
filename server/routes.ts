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
  registerCaseSessionRoutes,
  twoFactorRouter,
  helpArticlesRouter,
  translationsRouter,
  documentRequestsRouter,
  registerCaseDocumentRoutes,
  userFeedbackRouter,
  registerCaseFeedbackRoutes
} from "./routes/index";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use("/api/cases", casesRouter);
  app.use("/api/submissions", submissionsRouter);
  app.use("/api/chat", messagesRouter);
  app.use("/api/chat-templates", chatTemplatesRouter);
  app.use("/api/message-templates", messageTemplatesRouter);
  app.use("/api/scheduled-messages", scheduledMessagesRouter);
  app.use("/api/deposits", depositsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/audit-logs", auditLogsRouter);
  app.use("/api/admin-sessions", adminSessionsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/user-sessions", userSessionsRouter);
  app.use("/api/two-factor", twoFactorRouter);
  app.use("/api/help-articles", helpArticlesRouter);
  app.use("/api/translations", translationsRouter);
  app.use("/api/document-requests", documentRequestsRouter);
  app.use("/api/user-feedback", userFeedbackRouter);

  registerCaseSubmissionRoutes(casesRouter);
  registerCaseDepositRoutes(casesRouter);
  registerCaseMessageRoutes(casesRouter);
  registerCaseScheduledMessageRoutes(casesRouter);
  registerCaseSessionRoutes(casesRouter);
  registerCaseDocumentRoutes(casesRouter);
  registerCaseFeedbackRoutes(casesRouter);

  return httpServer;
}
