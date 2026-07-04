import PDFDocument from "pdfkit";
import type { RefundClaim, RefundClaimEntry } from "@shared/schema";

const NAVY   = "#0a1840";
const GOLD   = "#c8a951";
const GREEN  = "#1a5c3a";
const SLATE  = "#6b7385";
const LIGHT  = "#f0f4fa";
const WHITE  = "#ffffff";
const MARGIN = 56;
const PAGE_W = 595.28; // A4
const CONTENT_W = PAGE_W - MARGIN * 2;

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function shortId(id: number): string {
  return `IBCCF-RC-${String(id).padStart(6, "0")}`;
}

function hr(doc: PDFKit.PDFDocument, y: number, color = GOLD, width = 1) {
  doc.save().strokeColor(color).lineWidth(width)
    .moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).stroke().restore();
}

function badge(doc: PDFKit.PDFDocument, x: number, y: number, label: string, bg: string, fg: string) {
  const pad = 8;
  doc.font("Helvetica-Bold").fontSize(8);
  const tw = doc.widthOfString(label);
  const bw = tw + pad * 2;
  const bh = 16;
  doc.save().roundedRect(x, y - 11, bw, bh, 3).fill(bg).restore();
  doc.save().fillColor(fg).text(label, x + pad, y - 8, { lineBreak: false }).restore();
}

export async function buildRefundClaimCertificate(opts: {
  claim: RefundClaim;
  caseId: string;
  holderName: string;
  holderEmail: string;
}): Promise<Buffer> {
  const { claim, caseId, holderName, holderEmail } = opts;

  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: {
        Title:    `Refund Approval Certificate — ${caseId}`,
        Author:   "IBCCF International Enforcement Division",
        Subject:  "Refund Claim Approval Certificate",
        Creator:  "IBCCF Portal",
      },
    });

    doc.on("data", (c: Buffer) => buffers.push(c));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // ── Watermark ─────────────────────────────────────────────────────────
    doc.save()
      .fillColor("#1a5c3a").opacity(0.06)
      .font("Helvetica-Bold").fontSize(90)
      .rotate(-40, { origin: [PAGE_W / 2, 420] })
      .text("APPROVED", MARGIN, 300, { align: "center", lineBreak: false })
      .restore();

    // ── Header band ───────────────────────────────────────────────────────
    doc.save()
      .rect(0, 0, PAGE_W, 88)
      .fill(NAVY)
      .restore();

    doc.save()
      .fillColor(GOLD).font("Helvetica-Bold").fontSize(20)
      .text("IBCCF", MARGIN, 22, { lineBreak: false })
      .fillColor(WHITE).font("Helvetica").fontSize(9)
      .text("International Blockchain Community Complaints Forum", MARGIN, 44)
      .text("International Enforcement Division", MARGIN, 56)
      .restore();

    // Cert number top-right
    doc.save()
      .fillColor(GOLD).font("Helvetica-Bold").fontSize(9)
      .text(shortId(claim.id), PAGE_W - MARGIN - 120, 28, { align: "right", width: 120, lineBreak: false })
      .fillColor(WHITE).font("Helvetica").fontSize(7)
      .text("Certificate Reference", PAGE_W - MARGIN - 120, 40, { align: "right", width: 120, lineBreak: false })
      .restore();

    let y = 108;

    // ── Title ──────────────────────────────────────────────────────────────
    doc.save()
      .fillColor(NAVY).font("Helvetica-Bold").fontSize(17)
      .text("REFUND APPROVAL CERTIFICATE", MARGIN, y, { align: "center", width: CONTENT_W })
      .restore();
    y += 26;

    hr(doc, y, GOLD, 1.5);
    y += 10;

    doc.save()
      .fillColor(SLATE).font("Helvetica").fontSize(9)
      .text(
        `This certificate confirms that the refund claim submitted by the registered case holder ` +
        `has been reviewed and approved by the IBCCF International Enforcement Division. ` +
        `The amounts listed below are authorised for disbursement in accordance with the ` +
        `applicable platform terms.`,
        MARGIN, y, { width: CONTENT_W, align: "justify" }
      )
      .restore();
    y += 46;

    // ── Case details ──────────────────────────────────────────────────────
    const detailBg = LIGHT;
    doc.save().roundedRect(MARGIN, y, CONTENT_W, 78, 6).fill(detailBg).restore();

    const kvCol = (label: string, value: string, cx: number, cy: number, w: number) => {
      doc.save()
        .fillColor(SLATE).font("Helvetica").fontSize(8)
        .text(label.toUpperCase(), cx, cy, { lineBreak: false })
        .fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
        .text(value || "—", cx, cy + 12, { width: w - 6, lineBreak: false })
        .restore();
    };

    const half = CONTENT_W / 2;
    kvCol("Account Holder", holderName, MARGIN + 14, y + 10, half - 10);
    kvCol("Case ID",         caseId,     MARGIN + 14 + half, y + 10, half - 18);
    kvCol("Email Address",   holderEmail, MARGIN + 14, y + 44, half - 10);
    kvCol("Approval Date",   fmtDate(claim.reviewedAt), MARGIN + 14 + half, y + 44, half - 18);
    y += 96;

    // ── Status badge ──────────────────────────────────────────────────────
    badge(doc, MARGIN, y, " ✓  CLAIM APPROVED", GREEN, WHITE);
    doc.save()
      .fillColor(SLATE).font("Helvetica").fontSize(8)
      .text("Approved by: IBCCF Administrator", MARGIN + 148, y - 4, { lineBreak: false })
      .restore();
    y += 22;

    // ── Entries table ─────────────────────────────────────────────────────
    doc.save()
      .fillColor(NAVY).font("Helvetica-Bold").fontSize(11)
      .text("Approved Refund Entries", MARGIN, y)
      .restore();
    y += 18;

    // Table header
    const cols = { desc: MARGIN, amount: MARGIN + 240, date: MARGIN + 320, network: MARGIN + 400 };
    const colW  = { desc: 230,    amount: 74,           date: 74,          network: 83 };
    const rowH  = 20;
    const hdrH  = 22;

    doc.save().rect(MARGIN, y, CONTENT_W, hdrH).fill(NAVY).restore();
    doc.save().fillColor(WHITE).font("Helvetica-Bold").fontSize(8)
      .text("Description / Charged For", cols.desc + 6,  y + 7, { width: colW.desc,    lineBreak: false })
      .text("Amount (USDT)",             cols.amount + 4, y + 7, { width: colW.amount,  lineBreak: false })
      .text("Date",                       cols.date + 4,   y + 7, { width: colW.date,    lineBreak: false })
      .text("Network / Chain",            cols.network + 4, y + 7, { width: colW.network, lineBreak: false })
      .restore();
    y += hdrH;

    const entries: RefundClaimEntry[] = Array.isArray(claim.entries) ? claim.entries : [];
    let totalUsdt = 0;

    entries.forEach((entry, i) => {
      const rowBg = i % 2 === 0 ? WHITE : LIGHT;
      doc.save().rect(MARGIN, y, CONTENT_W, rowH).fill(rowBg).restore();

      doc.save().fillColor(NAVY).font("Helvetica").fontSize(8.5)
        .text(entry.chargedFor || "—",  cols.desc + 6,   y + 6, { width: colW.desc - 8,   lineBreak: false })
        .text(entry.amount || "—",      cols.amount + 4, y + 6, { width: colW.amount - 4,  lineBreak: false })
        .text(entry.date || "—",        cols.date + 4,   y + 6, { width: colW.date - 4,    lineBreak: false })
        .text(entry.network || "—",     cols.network + 4, y + 6, { width: colW.network - 6, lineBreak: false })
        .restore();

      // Tx ID sub-row if present
      if (entry.txId) {
        y += rowH;
        doc.save().rect(MARGIN, y, CONTENT_W, 14).fill(rowBg).restore();
        doc.save().fillColor(SLATE).font("Helvetica").fontSize(7)
          .text(`Tx / Ref: ${entry.txId}`, cols.desc + 6, y + 3, { width: CONTENT_W - 12, lineBreak: false })
          .restore();
      }

      const amt = parseFloat(entry.amount ?? "0");
      if (!isNaN(amt)) totalUsdt += amt;
      y += rowH;
    });

    if (entries.length === 0) {
      doc.save().rect(MARGIN, y, CONTENT_W, rowH).fill(LIGHT).restore();
      doc.save().fillColor(SLATE).font("Helvetica").fontSize(8.5)
        .text("No itemised entries on record.", MARGIN + 6, y + 6, { lineBreak: false })
        .restore();
      y += rowH;
    }

    // Total row
    doc.save().rect(MARGIN, y, CONTENT_W, 24).fill(NAVY).restore();
    doc.save().fillColor(WHITE).font("Helvetica-Bold").fontSize(9.5)
      .text("Total Approved Amount", cols.desc + 6,   y + 7, { width: colW.desc - 8, lineBreak: false })
      .text(`${totalUsdt.toFixed(2)} USDT`,             cols.amount + 4, y + 7, { width: 120, lineBreak: false })
      .restore();
    y += 36;

    // ── Admin notes ───────────────────────────────────────────────────────
    if (claim.adminNotes?.trim()) {
      doc.save()
        .fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
        .text("Officer Notes", MARGIN, y)
        .restore();
      y += 14;
      doc.save()
        .roundedRect(MARGIN, y, CONTENT_W, 40, 4)
        .fill("#f5f9ee").restore();
      doc.save().fillColor(NAVY).font("Helvetica").fontSize(8.5)
        .text(claim.adminNotes, MARGIN + 10, y + 8, { width: CONTENT_W - 20 })
        .restore();
      y += 52;
    }

    // ── Official seal ─────────────────────────────────────────────────────
    const sealX = PAGE_W - MARGIN - 54;
    const sealY = y + 10;
    const sealR = 44;
    const sealInnerR = 34;

    doc.save()
      .strokeColor(GOLD).lineWidth(2)
      .circle(sealX, sealY, sealR).stroke()
      .restore();

    doc.save()
      .strokeColor(GOLD).lineWidth(0.8)
      .circle(sealX, sealY, sealInnerR).stroke()
      .restore();

    doc.save()
      .fillColor(GOLD).font("Helvetica-Bold").fontSize(12)
      .text("IBCCF", sealX - 18, sealY - 19, { width: 36, align: "center", lineBreak: false })
      .restore();

    doc.save()
      .fillColor(GREEN).font("Helvetica-Bold").fontSize(7.5)
      .text("APPROVED", sealX - 20, sealY - 6, { width: 40, align: "center", lineBreak: false })
      .restore();

    doc.save()
      .fillColor(SLATE).font("Helvetica").fontSize(6)
      .text("ENFORCEMENT", sealX - 20, sealY + 4, { width: 40, align: "center", lineBreak: false })
      .restore();

    doc.save()
      .fillColor(GOLD).font("Helvetica").fontSize(8)
      .text("★  ★  ★", sealX - 18, sealY + 14, { width: 36, align: "center", lineBreak: false })
      .restore();

    // Issuer line beside seal
    if (y < 700) {
      doc.save()
        .fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
        .text("IBCCF International Enforcement Division", MARGIN, y + 6, {
          width: CONTENT_W - 110, lineBreak: false,
        })
        .restore();
      doc.save()
        .fillColor(SLATE).font("Helvetica").fontSize(8)
        .text("Authorised signatory — compliance desk", MARGIN, y + 20, {
          width: CONTENT_W - 110, lineBreak: false,
        })
        .restore();
      doc.save()
        .strokeColor(NAVY).lineWidth(0.6)
        .moveTo(MARGIN, y + 32).lineTo(MARGIN + CONTENT_W - 120, y + 32).stroke()
        .restore();
    }

    // ── Footer rule ───────────────────────────────────────────────────────
    const footY = 780;
    hr(doc, footY, GOLD, 0.8);
    doc.save()
      .fillColor(SLATE).font("Helvetica").fontSize(7.5)
      .text(
        `This document is machine-generated by the IBCCF Enforcement Portal and constitutes an ` +
        `official record of the approved refund claim. Certificate ${shortId(claim.id)} — ` +
        `Issued ${fmtDate(new Date())}. ` +
        `IBCCF International Enforcement Division — ibccf.site`,
        MARGIN, footY + 8, { width: CONTENT_W, align: "center" }
      )
      .restore();

    doc.end();
  });
}
