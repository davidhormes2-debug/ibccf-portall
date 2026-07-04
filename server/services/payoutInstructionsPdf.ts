import PDFDocument from "pdfkit";
import type { Case } from "@shared/schema";

/**
 * Build the Payout Instructions PDF — a single-page reference an admin can
 * download (and optionally share) summarising the verified payout wallet,
 * the agreed withdrawal amount, and the post-stamp-duty release procedure.
 *
 * Mirrors the pdfkit pattern in certificatePdf.ts: A4, 56pt margin, gold/navy
 * palette, in-memory buffer. The document is display-only and does not in
 * itself authorise any transfer of funds (the platform never holds, routes,
 * or relays funds — same constraint as the Verified Payout Wallet).
 */
export async function buildPayoutInstructionsPdf(opts: {
  caseRow: Case;
}): Promise<Buffer> {
  const { caseRow } = opts;
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: `IBCCF Payout Instructions — ${caseRow.id}`,
      Author: "IBCCF Compliance",
      Subject: "Payout Instructions",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Header block
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("INTERNATIONAL BLOCKCHAIN COMMUNITY", { align: "center" })
    .moveDown(0.1)
    .text("COMPLAINTS FORUM", { align: "center" })
    .moveDown(0.3)
    .fillColor("#c8a951")
    .fontSize(14)
    .text("PAYOUT INSTRUCTIONS", { align: "center" })
    .moveDown(1.2);

  // Reference card
  doc
    .strokeColor("#c8a951")
    .lineWidth(1)
    .rect(56, doc.y, doc.page.width - 112, 70)
    .stroke();
  const refTop = doc.y + 12;
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("CASE REFERENCE", 72, refTop)
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(caseRow.id, 72, refTop + 14);
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("ACCOUNT HOLDER", 320, refTop)
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(caseRow.userName ?? "—", 320, refTop + 14, {
      width: 200,
      ellipsis: true,
    });
  doc.moveDown(3.5);

  // Intro paragraph
  doc
    .fillColor("#1a2233")
    .font("Helvetica")
    .fontSize(11)
    .text(
      "This document summarises the payout instructions on file for the above case. It is provided as a reference for compliance review and is not, in itself, an instruction to transfer funds. Settlement is released through the IBCCF compliance desk once all gating conditions have been met.",
      { align: "justify" },
    )
    .moveDown(1.2);

  // Verified Payout Wallet section
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("VERIFIED PAYOUT WALLET")
    .moveDown(0.4);

  const walletRows: Array<[string, string]> = [
    ["Asset", caseRow.payoutWalletAsset ?? "—"],
    ["Network", caseRow.payoutWalletNetwork ?? "—"],
    ["Address", caseRow.payoutWalletAddress ?? "—"],
    [
      "Verified At",
      caseRow.payoutWalletVerifiedAt
        ? new Date(caseRow.payoutWalletVerifiedAt).toISOString()
        : "—",
    ],
    ["Verified By", caseRow.payoutWalletVerifiedBy ?? "—"],
  ];
  for (const [label, value] of walletRows) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#0a1840")
      .fontSize(10)
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .fillColor("#1a2233")
      .text(value);
  }
  doc.moveDown(1.0);

  // Withdrawal Summary section
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("WITHDRAWAL SUMMARY")
    .moveDown(0.4);

  const summaryRows: Array<[string, string]> = [
    [
      "Withdrawal Amount",
      caseRow.withdrawalAmount ? `${caseRow.withdrawalAmount} USDT` : "—",
    ],
    ["Current Stage", caseRow.withdrawalStage ?? "—"],
    [
      "Stamp Duty Status",
      caseRow.stampDutyStatus ?? "not applicable",
    ],
    [
      "Sealed At",
      caseRow.sealedAt ? new Date(caseRow.sealedAt).toISOString() : "—",
    ],
    ["Issued At", new Date().toISOString()],
  ];
  for (const [label, value] of summaryRows) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#0a1840")
      .fontSize(10)
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .fillColor("#1a2233")
      .text(value);
  }
  doc.moveDown(1.0);

  // Release procedure
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("RELEASE PROCEDURE")
    .moveDown(0.4);
  const steps = [
    "1. Confirm the verified payout wallet above matches the address held in the user's portal.",
    "2. Confirm the Sealed Settlement & NDA is signed and the stamp duty receipt is approved.",
    "3. Confirm the Time-Stamp Deposit has cleared on-chain.",
    "4. The IBCCF compliance desk authorises the release inside the reserved settlement window.",
    "5. A final case-closure email is sent and the case is moved to the resolved archive.",
  ];
  for (const step of steps) {
    doc
      .font("Helvetica")
      .fillColor("#1a2233")
      .fontSize(10)
      .text(step, { align: "left" });
  }
  doc.moveDown(1.5);

  // Footer disclaimer
  doc
    .font("Helvetica-Oblique")
    .fontSize(10)
    .fillColor("#6b7385")
    .text(
      "Issued by the IBCCF Compliance Desk. This document is display-only and does not in itself authorise any transfer of funds. IBCCF does not hold, route, or relay customer funds.",
      { align: "center" },
    );

  doc.end();
  return await done;
}
