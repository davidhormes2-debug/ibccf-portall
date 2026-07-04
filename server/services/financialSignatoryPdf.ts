import PDFDocument from "pdfkit";
import type { Case } from "@shared/schema";
import {
  DOCUMENT_CATEGORY_LABELS,
  FINANCIAL_SIGNATORY_CATEGORIES,
  type FinancialSignatoryCategory,
} from "../routes/content";

/**
 * Pre-filled, downloadable PDF templates for the seven post-NDA financial
 * signatory documents (Task #140). The admin requests the document
 * through the standard flow; the user downloads this template via
 * GET /api/cases/:id/document-templates/:category, signs it offline, and
 * uploads the signed copy back through the existing document-request
 * submission flow.
 *
 * Each template auto-fills the case reference, user name, current date,
 * and a signature/date block. Body copy is intentionally simple and
 * conservative — the form is the user's own attestation, not legal
 * advice from IBCCF.
 */

type CategorySpec = {
  title: string;
  intro: string;
  /** Labelled fields the user fills in by hand after printing/signing. */
  fields: string[];
  /** Numbered attestation clauses the user signs against. */
  clauses: string[];
};

const SPECS: Record<FinancialSignatoryCategory, CategorySpec> = {
  source_of_funds: {
    title: "SOURCE OF FUNDS DECLARATION",
    intro:
      "I declare the following with respect to the source of the funds associated with the above case. This declaration is made to satisfy the IBCCF compliance desk's anti-money-laundering review and may be relied upon by the reviewing officer.",
    fields: [
      "Primary source of funds (e.g. salary, business income, investment proceeds, inheritance):",
      "Approximate value of funds (USD or USDT equivalent):",
      "Originating institution / counterparty (bank, exchange, employer):",
      "Period during which the funds were accumulated (from – to):",
    ],
    clauses: [
      "The funds were obtained from lawful sources and are not the proceeds of any criminal activity.",
      "I am the beneficial owner of the funds and am not acting on behalf of an undisclosed third party.",
      "Supporting evidence (bank statements, payslips, sale agreements) is available on request.",
    ],
  },
  beneficial_ownership: {
    title: "BENEFICIAL OWNERSHIP / KYC ATTESTATION",
    intro:
      "I attest to the following regarding the beneficial ownership of the wallet, account, and funds associated with the above case.",
    fields: [
      "Full legal name of beneficial owner:",
      "Date of birth (DD / MM / YYYY):",
      "Country of residence:",
      "Government-issued ID type and number:",
      "If the beneficial owner is not the case holder, state the relationship:",
    ],
    clauses: [
      "I am the ultimate beneficial owner of the funds, wallet, and account associated with this case.",
      "No undisclosed third party holds an economic interest in, or controls, the funds.",
      "The personal information given above is true, current and complete to the best of my knowledge.",
    ],
  },
  fatca_crs: {
    title: "FATCA / CRS SELF-CERTIFICATION",
    intro:
      "This form collects information required under the United States Foreign Account Tax Compliance Act (FATCA) and the OECD Common Reporting Standard (CRS). Complete every field accurately — false statements may carry tax-reporting consequences in your jurisdiction.",
    fields: [
      "Full legal name:",
      "Country/countries of tax residence:",
      "Tax Identification Number(s) for each country listed:",
      "U.S. citizen or U.S. tax resident? (Yes / No):",
      "If yes, U.S. Taxpayer Identification Number (TIN):",
    ],
    clauses: [
      "I certify that the tax residency information given above is correct.",
      "I undertake to notify IBCCF within 30 days of any change in my tax residency.",
      "I understand that this self-certification may be shared with tax authorities under applicable FATCA and CRS reporting obligations.",
    ],
  },
  aml_screening: {
    title: "AML ACKNOWLEDGEMENT",
    intro:
      "I acknowledge the following with respect to the IBCCF anti-money-laundering and counter-terrorist-financing screening on the above case.",
    fields: [
      "Full legal name:",
      "Country of residence:",
      "Are you a Politically Exposed Person (PEP), or a close family member / known associate of one? (Yes / No):",
      "If yes, briefly describe the role and jurisdiction:",
    ],
    clauses: [
      "I am not subject to any active sanctions list (OFAC, EU, UN, UK HMT or equivalent).",
      "The funds connected to this case are not derived from, nor intended to fund, any criminal or terrorist activity.",
      "I consent to IBCCF performing AML / sanctions screening against my identity for the duration of this case.",
    ],
  },
  tax_residency_declaration: {
    title: "TAX RESIDENCY DECLARATION",
    intro:
      "I declare my tax residency status for the purposes of the IBCCF compliance review on the above case. This declaration is independent of any FATCA / CRS self-certification and is used by the desk to confirm the jurisdiction(s) in which the settlement may be reported.",
    fields: [
      "Full legal name:",
      "Primary country of tax residence:",
      "Tax Identification Number in primary country:",
      "Secondary country of tax residence (if any):",
      "Tax Identification Number in secondary country (if any):",
      "Date tax residency in the primary country was established (DD / MM / YYYY):",
    ],
    clauses: [
      "The tax residency information given above is true and correct as at the date of signature.",
      "I undertake to notify IBCCF in writing within 30 days of any change to my tax residency status.",
      "I understand IBCCF may rely on this declaration for the purposes of any tax-related reporting on the settlement.",
    ],
  },
  settlement_authorization: {
    title: "SETTLEMENT / DISBURSEMENT AUTHORIZATION",
    intro:
      "I authorise the IBCCF compliance desk to proceed with the final settlement of the above case to the verified payout wallet currently on file. IBCCF does not hold, route, or relay funds — this authorisation governs only the compliance-desk release decision.",
    fields: [
      "Verified payout wallet address on file (re-write exactly):",
      "Asset / Network:",
      "Settlement amount in USDT (numeric, as agreed with the case officer):",
      "Settlement amount in words (e.g. one hundred thousand USDT):",
    ],
    clauses: [
      "I confirm the verified payout wallet address above matches the address held in my IBCCF portal.",
      "I authorise the IBCCF compliance desk to release the settlement amount to that address once all gating conditions are satisfied.",
      "I understand that IBCCF will not, under any circumstances, redirect the settlement to a wallet address other than the one verified above without a fresh signed authorisation.",
    ],
  },
  power_of_attorney: {
    title: "POWER OF ATTORNEY FOR DISBURSEMENT",
    intro:
      "I grant the IBCCF compliance desk a limited power of attorney solely for the purpose of executing the administrative steps required to release the settlement on the above case. This power of attorney is strictly limited in scope and duration and does NOT authorise IBCCF to take custody of, transfer, or otherwise move any funds.",
    fields: [
      "Full legal name of grantor (case holder):",
      "Date of birth (DD / MM / YYYY):",
      "Country of residence:",
      "Government-issued ID type and number:",
      "Effective date of this power of attorney (DD / MM / YYYY):",
      "Expiry date — if blank, expires automatically on case closure:",
    ],
    clauses: [
      "I grant the IBCCF compliance desk authority to perform the administrative release steps required to settle this case to my verified payout wallet.",
      "This power of attorney is strictly limited to the above case and does not extend to any other account, wallet, or matter.",
      "This power of attorney is revocable in writing at any time and expires automatically on closure of the above case.",
    ],
  },
};

export function isFinancialSignatoryCategory(
  value: string,
): value is FinancialSignatoryCategory {
  return (FINANCIAL_SIGNATORY_CATEGORIES as readonly string[]).includes(value);
}

export function financialSignatoryLabel(
  category: FinancialSignatoryCategory,
): string {
  return DOCUMENT_CATEGORY_LABELS[category];
}

/**
 * Build a pre-filled PDF template for one of the seven financial
 * signatory documents. Mirrors the pdfkit pattern used in
 * payoutInstructionsPdf.ts (A4, 56pt margin, gold/navy palette,
 * in-memory buffer).
 */
export async function buildFinancialSignatoryTemplate(opts: {
  caseRow: Case;
  category: FinancialSignatoryCategory;
}): Promise<Buffer> {
  const { caseRow, category } = opts;
  const spec = SPECS[category];
  const userName = (caseRow.userName ?? "").trim() || "—";
  const issuedAt = new Date().toISOString().slice(0, 10);

  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: `IBCCF ${spec.title} — ${caseRow.id}`,
      Author: "IBCCF Compliance",
      Subject: spec.title,
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
    .fontSize(20)
    .text("INTERNATIONAL BLOCKCHAIN COMMUNITY", { align: "center" })
    .moveDown(0.1)
    .text("COMPLAINTS FORUM", { align: "center" })
    .moveDown(0.3)
    .fillColor("#c8a951")
    .fontSize(13)
    .text(spec.title, { align: "center" })
    .moveDown(1.2);

  // Reference card (case id + user + issued date)
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
    .fontSize(12)
    .text(caseRow.id, 72, refTop + 14);
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("ACCOUNT HOLDER", 260, refTop)
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(userName, 260, refTop + 14, { width: 180, ellipsis: true });
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("ISSUED", 460, refTop)
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(issuedAt, 460, refTop + 14);
  doc.moveDown(3.5);

  // Intro paragraph
  doc
    .fillColor("#1a2233")
    .font("Helvetica")
    .fontSize(11)
    .text(spec.intro, { align: "justify" })
    .moveDown(0.9);

  // Fillable fields
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("DETAILS TO COMPLETE")
    .moveDown(0.3);
  for (const field of spec.fields) {
    doc
      .fillColor("#1a2233")
      .font("Helvetica")
      .fontSize(10)
      .text(field, { align: "left" })
      .moveDown(0.15);
    const y = doc.y;
    doc
      .strokeColor("#c8c8c8")
      .lineWidth(0.6)
      .moveTo(56, y + 4)
      .lineTo(doc.page.width - 56, y + 4)
      .stroke();
    doc.moveDown(0.9);
  }

  doc.moveDown(0.4);

  // Attestation clauses
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("DECLARATION")
    .moveDown(0.3);
  spec.clauses.forEach((clause, idx) => {
    doc
      .fillColor("#1a2233")
      .font("Helvetica")
      .fontSize(10)
      .text(`${idx + 1}. ${clause}`, { align: "justify" })
      .moveDown(0.3);
  });

  doc.moveDown(0.6);

  // Signature & date block
  doc
    .fillColor("#c8a951")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("SIGNATURE")
    .moveDown(0.6);

  const sigY = doc.y;
  doc
    .strokeColor("#0a1840")
    .lineWidth(0.8)
    .moveTo(72, sigY + 30)
    .lineTo(300, sigY + 30)
    .stroke()
    .moveTo(360, sigY + 30)
    .lineTo(520, sigY + 30)
    .stroke();
  doc
    .fillColor("#6b7385")
    .font("Helvetica")
    .fontSize(9)
    .text("Signature", 72, sigY + 36)
    .text("Date (DD / MM / YYYY)", 360, sigY + 36);
  doc
    .fillColor("#0a1840")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`Printed name: ${userName}`, 72, sigY + 60);

  doc.moveDown(5.5);

  // Footer disclaimer
  doc
    .font("Helvetica-Oblique")
    .fontSize(9)
    .fillColor("#6b7385")
    .text(
      "Issued by the IBCCF Compliance Desk as a pre-filled template for the case shown above. Sign offline and upload the completed document through your IBCCF portal. IBCCF does not hold, route, or relay customer funds.",
      { align: "center" },
    );

  doc.end();
  return await done;
}
