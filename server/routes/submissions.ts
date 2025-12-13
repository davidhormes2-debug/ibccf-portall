import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";

export const submissionsRouter = Router();

submissionsRouter.get("/", async (req, res) => {
  try {
    const submissions = await storage.getAllSubmissions();
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

submissionsRouter.delete("/:id", async (req, res) => {
  try {
    await storage.deleteSubmission(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete submission" });
  }
});

export function registerCaseSubmissionRoutes(router: Router) {
  router.get("/:id/submissions", async (req, res) => {
    try {
      const submissions = await storage.getSubmissionsByCaseId(req.params.id);
      res.json(submissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  router.post("/:id/submissions", async (req, res) => {
    try {
      const submissionInput = z.object({
        selectedOption: z.enum(['A', 'B']),
        notes: z.string().optional().nullable()
      }).parse(req.body);

      const caseData = await storage.getCaseById(req.params.id);
      if (!caseData) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const submissionData = {
        caseId: req.params.id,
        selectedOption: submissionInput.selectedOption,
        notes: submissionInput.notes || null,
        userName: caseData.userName,
        userEmail: caseData.userEmail,
        withdrawalAmount: caseData.withdrawalAmount,
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
      
      res.json(submission);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create submission" });
      }
    }
  });
}
