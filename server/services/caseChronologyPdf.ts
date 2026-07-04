import PDFDocument from "pdfkit";
import type { Case, AuditLog, ChatMessage, AdminMessage, DepositReceipt, DocumentRequest } from "@shared/schema";

const NAVY = "#0a1840";
const GOLD = "#c8a951";
const SLATE = "#6b7385";
const LIGHT = "#e8ecf4";
const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

type ChronoEvent = {
  at: Date;
  kind: "audit" | "chat" | "admin_msg" | "receipt" | "document";
  label: string;
  detail: string;
  actor?: string;
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toUTCString().replace(" GMT", " UTC");
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function actionLabel(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildEvents(
  chatMsgs: ChatMessage[],
  adminMsgs: AdminMessage[],
  receipts: DepositReceipt[],
  docs: DocumentRequest[],
  auditEntries: AuditLog[],
): ChronoEvent[] {
  const events: ChronoEvent[] = [];

  for (const m of chatMsgs) {
    events.push({
      at: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
      kind: "chat",
      label: m.sender === "admin" ? "Admin → User (Chat)" : "User → Admin (Chat)",
      detail: truncate(m.message, 320),
      actor: m.sender,
    });
  }

  for (const m of adminMsgs) {
    events.push({
      at: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
      kind: "admin_msg",
      label: `Notification [${(m.category ?? "").toUpperCase()}]: ${truncate(m.title, 80)}`,
      detail: truncate(m.body, 320),
    });
  }

  for (const r of receipts) {
    const cat = r.category ?? "activation";
    events.push({
      at: r.uploadedAt instanceof Date ? r.uploadedAt : new Date(r.uploadedAt),
      kind: "receipt",
      label: `Receipt Uploaded — ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
      detail: [
        `Status: ${r.status ?? "pending"}`,
        r.fileName ? `File: ${r.fileName}` : "",
        r.notes ? `Notes: ${truncate(r.notes, 160)}` : "",
        r.adminNotes ? `Admin notes: ${truncate(r.adminNotes, 160)}` : "",
      ].filter(Boolean).join(" | "),
    });
  }

  for (const d of docs) {
    events.push({
      at: d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt),
      kind: "document",
      label: `Document Requested — ${(d.documentType ?? "").replace(/_/g, " ")}`,
      detail: [
        d.description ? truncate(d.description, 160) : "",
        `Status: ${d.status ?? "pending"}`,
        d.deadline ? `Deadline: ${fmtDate(d.deadline)}` : "",
      ].filter(Boolean).join(" | "),
    });
    if (d.submittedAt) {
      events.push({
        at: d.submittedAt instanceof Date ? d.submittedAt : new Date(d.submittedAt),
        kind: "document",
        label: `Document Submitted — ${(d.documentType ?? "").replace(/_/g, " ")}`,
        detail: [
          `Status: ${d.status ?? "pending"}`,
          d.submittedFileName ? `File: ${d.submittedFileName}` : "",
          d.adminNotes ? `Admin notes: ${truncate(d.adminNotes, 160)}` : "",
        ].filter(Boolean).join(" | "),
      });
    }
    if (d.approvedAt) {
      events.push({
        at: d.approvedAt instanceof Date ? d.approvedAt : new Date(d.approvedAt),
        kind: "document",
        label: `Document ${d.status === "rejected" ? "Rejected" : "Approved"} — ${(d.documentType ?? "").replace(/_/g, " ")}`,
        detail: d.adminNotes ? truncate(d.adminNotes, 240) : "",
      });
    }
  }

  for (const a of auditEntries) {
    events.push({
      at: a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt),
      kind: "audit",
      label: actionLabel(a.action),
      detail: [
        a.newValue ? `→ ${truncate(String(a.newValue), 240)}` : "",
      ].filter(Boolean).join(""),
      actor: a.adminUsername ?? undefined,
    });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

const KIND_COLORS: Record<ChronoEvent["kind"], string> = {
  audit:     "#334155",
  chat:      "#1e3a5f",
  admin_msg: "#3b1f60",
  receipt:   "#1a3a2a",
  document:  "#3a2a10",
};

const KIND_BADGE: Record<ChronoEvent["kind"], string> = {
  audit:     "AUDIT",
  chat:      "CHAT",
  admin_msg: "NOTIFICATION",
  receipt:   "RECEIPT",
  document:  "DOCUMENT",
};

const KIND_BADGE_COLOR: Record<ChronoEvent["kind"], string> = {
  audit:     "#64748b",
  chat:      "#3b82f6",
  admin_msg: "#a855f7",
  receipt:   "#22c55e",
  document:  "#f59e0b",
};

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc
    .moveDown(0.8)
    .fillColor(GOLD)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title.toUpperCase(), { characterSpacing: 1 })
    .moveDown(0.2)
    .strokeColor(GOLD)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke()
    .moveDown(0.4);
}

function drawKvRow(doc: PDFKit.PDFDocument, key: string, value: string) {
  const keyW = 150;
  const valX = MARGIN + keyW + 8;
  const valW = CONTENT_WIDTH - keyW - 8;
  const startY = doc.y;
  doc.fillColor(SLATE).font("Helvetica").fontSize(9).text(key, MARGIN, startY, { width: keyW });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(value || "—", valX, startY, { width: valW });
  doc.moveDown(0.35);
}

export async function buildCaseChronologyPdf(opts: {
  caseRow: Case;
  chatMessages: ChatMessage[];
  adminMessages: AdminMessage[];
  depositReceipts: DepositReceipt[];
  documentRequests: DocumentRequest[];
  auditLogs: AuditLog[];
}): Promise<Buffer> {
  const { caseRow, chatMessages, adminMessages, depositReceipts, documentRequests, auditLogs } = opts;

  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `IBCCF Case Chronology — ${caseRow.id}`,
      Author: "IBCCF Administration",
      Subject: "Case and Accounts Chronology Report",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const generatedAt = new Date();
  const userName = (caseRow.userName ?? "").trim() || "—";

  // ── Page 1: Cover header ─────────────────────────────────────────────────
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("INTERNATIONAL BLOCKCHAIN COMMUNITY", { align: "center" })
    .moveDown(0.1)
    .text("COMPLAINTS FORUM", { align: "center" })
    .moveDown(0.4)
    .fillColor(GOLD)
    .fontSize(13)
    .text("CASE & ACCOUNTS CHRONOLOGY REPORT", { align: "center" })
    .moveDown(0.2)
    .fillColor(SLATE)
    .font("Helvetica")
    .fontSize(9)
    .text(`Generated: ${fmtDate(generatedAt)}   ·   Confidential — For authorised admin use only`, { align: "center" })
    .moveDown(1.2);

  // Reference card
  doc
    .strokeColor(GOLD)
    .lineWidth(1)
    .rect(MARGIN, doc.y, CONTENT_WIDTH, 56)
    .stroke();
  const refTop = doc.y + 10;
  doc.fillColor(SLATE).font("Helvetica").fontSize(8).text("CASE ID", MARGIN + 12, refTop);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(caseRow.id, MARGIN + 12, refTop + 12);
  doc.fillColor(SLATE).font("Helvetica").fontSize(8).text("ACCOUNT HOLDER", MARGIN + 200, refTop);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(truncate(userName, 36), MARGIN + 200, refTop + 12, { width: 160, ellipsis: true });
  doc.fillColor(SLATE).font("Helvetica").fontSize(8).text("STATUS", MARGIN + 400, refTop);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text((caseRow.status ?? "—").toUpperCase(), MARGIN + 400, refTop + 12);
  doc.moveDown(0.3);
  doc.y = refTop + 56 + 16;

  // ── Case overview ─────────────────────────────────────────────────────────
  drawSectionHeader(doc, "Case Overview");
  drawKvRow(doc, "Case ID", caseRow.id);
  drawKvRow(doc, "Account Holder", userName);
  drawKvRow(doc, "Email", caseRow.userEmail ?? "—");
  drawKvRow(doc, "Status", caseRow.status ?? "—");
  drawKvRow(doc, "Withdrawal Stage", caseRow.withdrawalStage ? `Stage ${caseRow.withdrawalStage}` : "—");
  drawKvRow(doc, "Withdrawal Amount", caseRow.withdrawalAmount ?? "—");
  drawKvRow(doc, "VIP Status", caseRow.vipStatus ?? "—");
  drawKvRow(doc, "Created", fmtDate(caseRow.createdAt));
  drawKvRow(doc, "Sealed (NDA)", caseRow.sealedAt ? fmtDate(caseRow.sealedAt) : "Not sealed");
  if (caseRow.payoutWalletAddress) {
    drawKvRow(doc, "Payout Wallet", `${caseRow.payoutWalletAddress} (${caseRow.payoutWalletAsset ?? "—"} / ${caseRow.payoutWalletNetwork ?? "—"})`);
  }

  // ── Summary counts ────────────────────────────────────────────────────────
  drawSectionHeader(doc, "Activity Summary");
  drawKvRow(doc, "Audit Log Entries", String(auditLogs.length));
  drawKvRow(doc, "Chat Messages", String(chatMessages.length));
  drawKvRow(doc, "Notifications Sent", String(adminMessages.length));
  drawKvRow(doc, "Deposit Receipts", String(depositReceipts.length));
  drawKvRow(doc, "Document Requests", String(documentRequests.length));

  // ── Chronological timeline ────────────────────────────────────────────────
  const events = buildEvents(chatMessages, adminMessages, depositReceipts, documentRequests, auditLogs);

  doc.addPage();
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("CHRONOLOGICAL TIMELINE", { align: "center" })
    .moveDown(0.25)
    .fillColor(SLATE)
    .font("Helvetica")
    .fontSize(9)
    .text(`${events.length} event${events.length === 1 ? "" : "s"} — oldest first`, { align: "center" })
    .moveDown(0.8);

  if (events.length === 0) {
    doc.fillColor(SLATE).font("Helvetica").fontSize(10)
      .text("No events recorded for this case.", { align: "center" });
  }

  for (const ev of events) {
    // Estimate height needed — add page break if close to bottom
    if (doc.y > doc.page.height - 140) {
      doc.addPage();
    }

    const blockX = MARGIN;
    const blockY = doc.y;
    const badgeColor = KIND_BADGE_COLOR[ev.kind];
    const bgColor = KIND_COLORS[ev.kind];

    // Background strip
    doc
      .fillColor(bgColor)
      .roundedRect(blockX, blockY, CONTENT_WIDTH, 14, 2)
      .fill();

    // Badge pill
    doc
      .fillColor(badgeColor)
      .roundedRect(blockX + 4, blockY + 2, 72, 10, 2)
      .fill();
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text(KIND_BADGE[ev.kind], blockX + 6, blockY + 3.5, { width: 68, align: "center" });

    // Timestamp
    doc
      .fillColor(LIGHT)
      .font("Helvetica")
      .fontSize(7.5)
      .text(fmtDate(ev.at), blockX + 80, blockY + 3.5, { width: CONTENT_WIDTH - 90 });

    doc.y = blockY + 16;

    // Label row
    doc
      .fillColor(NAVY)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(truncate(ev.label, 110), blockX + 4, doc.y, { width: CONTENT_WIDTH - 4 });

    if (ev.actor) {
      const actorText = `by ${ev.actor}`;
      doc
        .fillColor(SLATE)
        .font("Helvetica")
        .fontSize(8)
        .text(actorText, blockX + 4, doc.y, { width: CONTENT_WIDTH - 4 });
    }

    if (ev.detail) {
      doc
        .fillColor("#374151")
        .font("Helvetica")
        .fontSize(8.5)
        .text(ev.detail, blockX + 4, doc.y, { width: CONTENT_WIDTH - 8 });
    }

    doc.moveDown(0.6);

    // Thin divider
    doc
      .strokeColor("#1e2940")
      .lineWidth(0.3)
      .moveTo(MARGIN, doc.y)
      .lineTo(PAGE_WIDTH - MARGIN, doc.y)
      .stroke()
      .moveDown(0.3);
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  const totalPages = (doc as unknown as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1;
  const footerY = doc.page.height - 36;
  doc
    .fillColor(SLATE)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      `IBCCF Confidential — Case ${caseRow.id} — Generated ${generatedAt.toISOString()} UTC — Page 1 of ${totalPages}`,
      MARGIN,
      footerY,
      { width: CONTENT_WIDTH, align: "center" },
    );

  doc.end();
  return done;
}
