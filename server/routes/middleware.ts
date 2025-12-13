import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export const ADMIN_TOKEN = "ibc-admin-session-2025";

export function checkAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    if (req.method === 'DELETE' && req.path.startsWith('/api/cases/')) {
      const caseId = req.path.split('/').pop();
      storage.createAuditLog({
        action: 'delete_case_unauthorized',
        newValue: `Unauthorized deletion attempt for case: ${caseId}`,
        adminUsername: 'Unknown',
        targetType: 'case',
        targetId: caseId || undefined
      }).catch(() => {});
    }
    res.status(401).json({ error: "Unauthorized" });
  }
}
