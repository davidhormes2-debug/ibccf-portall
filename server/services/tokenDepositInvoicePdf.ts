import PDFDocument from "pdfkit";
import type { Case } from "@shared/schema";
import {
  computeTokenDepositRequired,
  formatUsdt,
  parseRatePer100k,
} from "@shared/tokenDeposit";

/**
 * Build an in-memory PDF invoice for a token-deposit permit.
 *
 * Uses the same A4 / navy-gold / pdfkit pattern as
 * `financialSignatoryPdf.ts`.  The PDF is returned as a Buffer so the
 * caller can attach it to a nodemailer send.
 */
export async function buildTokenDepositInvoicePdf(opts: {
  caseRow: Case;
  paidAmount: string;
  permitCount: number;
  adminUser: string;
}): Promise<Buffer> {
  const { caseRow, paidAmount, permitCount, adminUser } = opts;
  const userName = (caseRow.userName ?? "").trim() || "—";
  const issuedAt = new Date().toUTCString();
  const required = computeTokenDepositRequired(
    caseRow.withdrawalAmount,
    caseRow.tokenDepositRatePer100k,
  );
  const ratePer100k = parseRatePer100k(caseRow.tokenDepositRatePer100k);
  const invoiceRef = `TDI-${caseRow.id}-${permitCount.toString().padStart(4, "0")}`;

  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: `IBCCF Token Deposit Invoice — ${caseRow.id}`,
      Author: "IBCCF Compliance",
      Subject: "Token Deposit Invoice",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Header ───────────────────────────────────────────────────────────
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("INTERNATIONAL BLOCKCHAIN COMMUNITY", { align: "center" })
    .moveDown(0.1)
    .text("COMPLAINTS FORUM", { align: "center" })
    .moveDown(0.3)
    .fillColor("#c8a951")
    .fontSize(13)
    .text("TOKEN DEPOSIT INVOICE", { align: "center" })
    .moveDown(1.2);

  // ── Reference card ───────────────────────────────────────────────────
  doc
    .strokeColor("#c8a951")
    .lineWidth(1)
    .rect(56, doc.y, doc.page.width - 112, 80)
    .stroke();
  const refTop = doc.y + 10;
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("INVOICE REFERENCE", 72, refTop)
    .text("CASE ID", 230, refTop)
    .text("ISSUED", 390, refTop);
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(invoiceRef, 72, refTop + 14)
    .text(caseRow.id, 230, refTop + 14)
    .text(new Date().toISOString().slice(0, 10), 390, refTop + 14);
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("CLIENT", 72, refTop + 36)
    .text("PERMIT #", 390, refTop + 36);
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(userName, 72, refTop + 50)
    .text(permitCount.toString(), 390, refTop + 50);
  doc.moveDown(4.2);

  // ── Line items table ─────────────────────────────────────────────────
  const tableTop = doc.y;
  const COL = { desc: 72, qty: 290, unit: 360, total: 450 };
  const PAGE_W = doc.page.width - 112;

  doc
    .fillColor("#0a1840")
    .rect(56, tableTop, PAGE_W, 22)
    .fill();
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("DESCRIPTION", COL.desc, tableTop + 7)
    .text("QTY", COL.qty, tableTop + 7)
    .text("UNIT PRICE (USDT)", COL.unit, tableTop + 7)
    .text("TOTAL (USDT)", COL.total, tableTop + 7);

  const row1Top = tableTop + 28;
  const rateFmt = formatUsdt(ratePer100k);
  doc
    .fillColor("#0a1840")
    .font("Helvetica")
    .fontSize(10)
    .text(`Withdrawal Token Deposit — Case ${caseRow.id}`, COL.desc, row1Top, { width: 200 })
    .text("1", COL.qty, row1Top)
    .text(rateFmt, COL.unit, row1Top)
    .text(formatUsdt(required), COL.total, row1Top);

  doc
    .strokeColor("#c8a951")
    .lineWidth(0.5)
    .moveTo(56, row1Top + 22)
    .lineTo(56 + PAGE_W, row1Top + 22)
    .stroke();

  // ── Totals block ─────────────────────────────────────────────────────
  const totTop = row1Top + 30;
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("Required deposit:", COL.unit, totTop)
    .text("Amount received:", COL.unit, totTop + 16);
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${formatUsdt(required)} USDT`, COL.total, totTop)
    .text(`${paidAmount} USDT`, COL.total, totTop + 16);

  // Total paid box
  const paidBoxTop = totTop + 36;
  doc
    .fillColor("#0a1840")
    .rect(56 + PAGE_W - 170, paidBoxTop, 170, 28)
    .fill();
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`PAID: ${paidAmount} USDT`, 56 + PAGE_W - 165, paidBoxTop + 8, { width: 160, align: "right" });
  doc.moveDown(5.5);

  // ── Payment details ───────────────────────────────────────────────────
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("PAYMENT DETAILS")
    .moveDown(0.4);
  doc
    .strokeColor("#0a1840")
    .lineWidth(0.5)
    .moveTo(56, doc.y)
    .lineTo(56 + PAGE_W, doc.y)
    .stroke()
    .moveDown(0.4);

  const details: Array<[string, string]> = [
    ["Withdrawal Amount (case)", caseRow.withdrawalAmount ?? "—"],
    ["Token Deposit Asset", "USDT"],
    ["Rate (per 100,000 USDT)", `${rateFmt} USDT`],
    ["Required Deposit", `${formatUsdt(required)} USDT`],
    ["Amount Deposited", `${paidAmount} USDT`],
    ["Permit Count (this case)", permitCount.toString()],
    ["Permit Reference", invoiceRef],
    ["Permitted By", adminUser],
    ["Date", issuedAt],
  ];

  for (const [label, value] of details) {
    const rowY = doc.y;
    doc
      .fillColor("#6b7385")
      .font("Helvetica")
      .fontSize(9)
      .text(label, 72, rowY, { width: 200 });
    doc
      .fillColor("#0a1840")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(value, 280, rowY, { width: 260 });
    doc.moveDown(0.55);
  }

  doc.moveDown(1.2);

  // ── Footer disclaimer ────────────────────────────────────────────────
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#6b7385")
    .text(
      "Issued by the IBCCF Compliance Desk. This invoice confirms receipt of the token deposit for the referenced withdrawal cycle. " +
        "IBCCF is a display-only platform and does not hold, route, or relay customer funds. " +
        "For queries, contact your case officer through the secure messaging panel in the IBCCF portal.",
      { align: "center" },
    );

  doc.end();
  return await done;
}
