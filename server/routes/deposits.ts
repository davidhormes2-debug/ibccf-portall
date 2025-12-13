import { Router } from "express";
import { storage } from "../storage";
import { z } from "zod";

export const depositsRouter = Router();

depositsRouter.patch("/:id", async (req, res) => {
  try {
    const data = z.object({
      status: z.enum(['pending', 'reviewed', 'approved', 'rejected']).optional(),
      adminNotes: z.string().optional()
    }).parse(req.body);

    const updated = await storage.updateDepositReceipt(parseInt(req.params.id), data);
    if (!updated) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update receipt" });
    }
  }
});

depositsRouter.patch("/:id/status", async (req, res) => {
  try {
    const { status } = z.object({
      status: z.enum(['pending', 'reviewed', 'approved', 'rejected'])
    }).parse(req.body);

    const updated = await storage.updateDepositReceipt(parseInt(req.params.id), { status });
    if (!updated) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(500).json({ error: "Failed to update receipt status" });
    }
  }
});


export function registerCaseDepositRoutes(router: Router) {
  router.get("/:id/deposit-receipts", async (req, res) => {
    try {
      const receipts = await storage.getDepositReceiptsByCaseId(req.params.id);
      res.json(receipts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deposit receipts" });
    }
  });

  router.post("/:id/deposit-receipts", async (req, res) => {
    try {
      const receiptInput = z.object({
        imageData: z.string(),
        fileName: z.string().optional(),
        notes: z.string().optional()
      }).parse(req.body);

      const receipt = await storage.createDepositReceipt({
        caseId: req.params.id,
        imageData: receiptInput.imageData,
        fileName: receiptInput.fileName || null,
        notes: receiptInput.notes || null,
        status: 'pending'
      });
      
      res.json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to upload deposit receipt" });
      }
    }
  });
}
