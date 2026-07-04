import PDFDocument from "pdfkit";
import type { Case, DeclarationSubmission } from "@shared/schema";

/**
 * Generate a Declaration of Compliance PDF for a submitted declaration.
 * Mirrors the A4 / 56pt-margin / gold+navy palette used in
 * financialSignatoryPdf.ts and payoutInstructionsPdf.ts.
 */
export async function buildDeclarationPdf(opts: {
  caseRow: Case;
  submission: DeclarationSubmission;
}): Promise<Buffer> {
  const { caseRow, submission: s } = opts;
  const userName = (caseRow.userName ?? s.fullName ?? "").trim() || "—";
  const submittedAt = new Date(s.submittedAt).toISOString().slice(0, 10);

  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: `IBCCF Declaration of Compliance — ${caseRow.id}`,
      Author: "IBCCF Compliance Desk",
      Subject: "Declaration of Compliance",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width;
  const margin = 56;
  const contentW = W - margin * 2;

  // ─── Header ────────────────────────────────────────────────────────────────
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("INTERNATIONAL BLOCKCHAIN COMMUNITY", { align: "center" })
    .moveDown(0.1)
    .text("COMPLAINTS FORUM", { align: "center" })
    .moveDown(0.3)
    .fillColor("#c8a951")
    .fontSize(13)
    .text("DECLARATION OF COMPLIANCE", { align: "center" })
    .moveDown(1.2);

  // ─── Reference card ────────────────────────────────────────────────────────
  const cardY = doc.y;
  doc
    .strokeColor("#c8a951")
    .lineWidth(1)
    .rect(margin, cardY, contentW, 72)
    .stroke();

  const refTop = cardY + 12;
  doc
    .fillColor("#6b7385").font("Helvetica").fontSize(9).text("CASE ID",          margin + 12, refTop)
    .fillColor("#0a1840").font("Helvetica-Bold").fontSize(11).text(caseRow.id,   margin + 12, refTop + 14);
  doc
    .fillColor("#6b7385").font("Helvetica").fontSize(9).text("ACCOUNT HOLDER",   margin + 170, refTop)
    .fillColor("#0a1840").font("Helvetica-Bold").fontSize(11)
    .text(userName, margin + 170, refTop + 14, { width: 160, ellipsis: true });
  doc
    .fillColor("#6b7385").font("Helvetica").fontSize(9).text("SUBMITTED",        margin + 370, refTop)
    .fillColor("#0a1840").font("Helvetica-Bold").fontSize(11).text(submittedAt,  margin + 370, refTop + 14);
  doc.moveDown(4.5);

  // Status badge
  const statusColor =
    s.status === "approved" ? "#16a34a" :
    s.status === "rejected" ? "#dc2626" : "#1d4ed8";
  doc
    .fillColor(statusColor)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`STATUS: ${s.status.toUpperCase()}`, { align: "right" })
    .moveDown(0.8);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function sectionHeader(title: string) {
    doc
      .fillColor("#c8a951")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(title)
      .moveDown(0.25);
    doc
      .strokeColor("#c8a951")
      .lineWidth(0.5)
      .moveTo(margin, doc.y)
      .lineTo(W - margin, doc.y)
      .stroke();
    doc.moveDown(0.4);
  }

  function field(label: string, value: string | null | undefined | boolean) {
    let display: string;
    if (typeof value === "boolean") {
      display = value ? "✓  Yes" : "✗  No";
    } else {
      display = (value ?? "").toString().trim() || "—";
    }
    const labelW = 170;
    const valueX = margin + labelW + 8;
    const valueW = contentW - labelW - 8;
    const startY = doc.y;
    doc
      .fillColor("#6b7385")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(label, margin, startY, { width: labelW, lineBreak: false });
    doc
      .fillColor("#1a2233")
      .font("Helvetica")
      .fontSize(9)
      .text(display, valueX, startY, { width: valueW });
    doc
      .strokeColor("#e2e8f0")
      .lineWidth(0.4)
      .moveTo(margin, doc.y)
      .lineTo(W - margin, doc.y)
      .stroke();
    doc.moveDown(0.35);
  }

  // ─── Section 1 — Personal Identification ───────────────────────────────────
  sectionHeader("1.  PERSONAL IDENTIFICATION");
  field("Full Name",              s.fullName);
  field("Email",                  s.email);
  field("Registered Username",    s.registeredUsername);
  field("Account ID",             s.accountId);
  field("Country of Residence",   s.countryOfResidence);
  field("Date of Birth",          s.dateOfBirth);
  doc.moveDown(0.7);

  // ─── Section 2 — Sanctions Compliance ──────────────────────────────────────
  sectionHeader("2.  SANCTIONS COMPLIANCE DECLARATIONS");
  field("Not resident in a sanctioned jurisdiction",    s.notSanctionedJurisdictions);
  field("No sanctioned transactions",                   s.noSanctionedTransactions);
  field("Acknowledged: USDT not directly supported",    s.acknowledgeUsdtNotSupported);
  field("Understands consequences of false information", s.understandFalseInfoConsequences);
  doc.moveDown(0.7);

  // ─── Section 3 — Asset & Income ────────────────────────────────────────────
  sectionHeader("3.  APPROVED ASSET & INCOME");
  field("Preferred Withdrawal Asset",   s.preferredAsset);
  field("Other Supported Asset",        s.otherSupportedAsset);
  field("Source of Income",             s.sourceOfIncome);
  if (s.sourceOfIncome === "Other (please specify)") {
    field("Other (specify)",            s.sourceOfIncomeOther);
  }
  field("Monthly Income Band",          s.monthlyIncome);
  doc.moveDown(0.7);

  // ─── Section 4 — International Terms & Processing Fee ──────────────────────
  sectionHeader("4.  INTERNATIONAL TERMS & PROCESSING FEE");
  field("International Terms Accepted",  s.internationalTermsAcknowledged ?? false);
  field("Processing Fee Amount",         s.processingFeeAmount ?? "1500 USDT");
  field("Network",                       s.processingFeeNetwork ?? "TRC20");
  field("Transaction Hash",              s.processingFeeTxHash);
  doc.moveDown(0.7);

  // ─── Section 5 — Regulatory Acknowledgment ─────────────────────────────────
  sectionHeader("5.  REGULATORY ACKNOWLEDGMENT");
  field("Regulatory Acknowledgment",    s.regulatoryAcknowledgment);
  doc.moveDown(0.7);

  // ─── Section 6 — Signature & Authorization ─────────────────────────────────
  sectionHeader("6.  SIGNATURE & AUTHORIZATION");
  field("Signed By (Full Name)",   s.signatureFullName);
  field("Signature Date",          s.signatureDate);
  doc.moveDown(1.2);

  // Signature line
  const sigY = doc.y;
  doc
    .strokeColor("#0a1840")
    .lineWidth(0.8)
    .moveTo(margin, sigY)
    .lineTo(margin + 220, sigY)
    .stroke()
    .moveTo(margin + 280, sigY)
    .lineTo(margin + 440, sigY)
    .stroke();
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(8)
    .text("Signature of Declarant", margin, sigY + 6)
    .text("Date (DD / MM / YYYY)", margin + 280, sigY + 6);
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`Printed name: ${s.signatureFullName}`, margin, sigY + 26);
  doc.moveDown(3);

  // ─── Reviewer Notes (if any) ───────────────────────────────────────────────
  if (s.reviewerNotes || s.reviewedBy) {
    sectionHeader("COMPLIANCE REVIEW");
    if (s.reviewedBy) {
      field("Reviewed By",   s.reviewedBy);
      field("Reviewed At",   s.reviewedAt ? new Date(s.reviewedAt).toISOString().slice(0, 10) : "—");
    }
    if (s.reviewerNotes) {
      field("Reviewer Notes", s.reviewerNotes);
    }
    doc.moveDown(0.7);
  }

  // ─── Forensic Metadata ─────────────────────────────────────────────────────
  doc
    .fillColor("#94a3b8")
    .font("Helvetica")
    .fontSize(7)
    .text(`Submission ID: ${s.id}  ·  Submitted: ${new Date(s.submittedAt).toISOString()}  ·  IP: ${s.ipAddress ?? "—"}`, {
      align: "center",
    })
    .moveDown(0.4);

  // ─── Footer ────────────────────────────────────────────────────────────────
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#6b7385")
    .text(
      "This document is a machine-generated record of the Declaration of Compliance submitted through the IBCCF portal. " +
        "It is issued by the IBCCF Compliance Desk for internal regulatory review only. " +
        "IBCCF does not hold, route, or relay customer funds.",
      { align: "center" },
    );

  doc.end();
  return await done;
}
