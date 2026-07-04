import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  NDA_TEMPLATE_VERSION,
  NDA_TRANSLATIONS_REVIEWED,
  renderNda,
  normalizeNdaLocale,
  type NdaLocale,
  type NdaTemplateVars,
  type NdaRendered,
} from "../../shared/ndaTemplate";
import type { Case } from "@shared/schema";

export interface NdaSignatureMeta {
  signedName: string;
  signedAt: Date;
  signedIp: string | null;
  signedUserAgent: string | null;
  // NOTE: the integrity hash is NEVER embedded inside the PDF. A self-
  // referential SHA-256 inside its own document body is a fixed-point
  // problem (the value you'd embed can only be known after the embed).
  // We instead derive `contentHash = sha256(pdfBytes)` AFTER render and
  // store it on the case_ndas row + in audit logs + the cover email
  // body, so any future re-render of the same signed snapshot must hash
  // identically to that stored value.
}

/**
 * Build the canonical template variables for a case. Centralised so the
 * same inputs feed the on-screen preview, the PDF, and the snapshot
 * persisted alongside the signature — guaranteeing the user sees, signs,
 * and downloads the same document.
 */
export function buildNdaVarsForCase(c: Case, localeOverride?: string | null): NdaTemplateVars {
  // Locale resolution: an explicit override (used by signed-case
  // re-renders that read the snapshot) wins; otherwise we honour the
  // recipient's persisted portal language so signing/preview matches
  // the rest of the portal chrome and the cover email.
  const locale: NdaLocale = normalizeNdaLocale(
    localeOverride ?? c.preferredLocale ?? null,
  );
  return {
    caseId: c.id,
    legalName: (c.userName ?? "").trim() || "Unnamed Recipient",
    jurisdiction: "England and Wales",
    effectiveDate: new Date().toISOString().slice(0, 10),
    settlementAmount:
      (c.withdrawalAmount ?? "").toString().trim() ||
      "As recorded in the case file",
    payoutWalletAddress: c.payoutWalletAddress ?? "",
    payoutWalletNetwork: c.payoutWalletNetwork ?? "",
    locale,
  };
}

/**
 * Same as buildNdaVarsForCase but pins the effective date and locale —
 * used for already-signed cases so the snapshot regenerates with the
 * exact date AND language the user saw at signing time (otherwise the
 * document would silently drift and the integrity hash would not match
 * after a later language switch on the case).
 */
export function buildNdaVarsForSignedCase(
  c: Case,
  effectiveDateIso: string,
  localeOverride?: string | null,
): NdaTemplateVars {
  return {
    ...buildNdaVarsForCase(c, localeOverride),
    effectiveDate: effectiveDateIso,
  };
}

export function renderNdaForCase(c: Case, localeOverride?: string | null): NdaRendered {
  return renderNda(buildNdaVarsForCase(c, localeOverride));
}

/**
 * Extract the locale a previously-signed snapshot was rendered in.
 * Older rows (pre-i18n) have no `locale` field on the snapshot JSON —
 * they were rendered in English, so we default to "en". Used by the
 * portal/admin re-render paths to keep PDF bytes (and therefore the
 * SHA-256 integrity hash) stable across later language switches.
 */
// Font selection.
//
// PDFKit's built-in Helvetica is WinAnsi-encoded and CANNOT render CJK
// glyphs — Chinese text would otherwise come out as missing-glyph
// boxes. We therefore load a CJK-capable embedded font (Noto Sans SC)
// and use it whenever the document is rendered in a CJK locale. The
// Latin locales continue to use Helvetica so existing sealed PDFs
// (and their stored SHA-256 hashes) remain byte-identical.
//
// Font bytes are loaded once at module init and reused; embedding the
// same bytes for the same draw operations is deterministic, so
// re-rendering a signed zh snapshot produces the same hash.
const __moduleUrl: string | undefined =
  typeof import.meta !== "undefined" ? (import.meta as { url?: string }).url : undefined;
const __dirname = __moduleUrl
  ? path.dirname(fileURLToPath(__moduleUrl))
  : path.join(process.cwd(), "server", "services");

const FONT_CANDIDATES = [
  path.resolve(__dirname, "..", "assets", "fonts"),
  path.resolve(process.cwd(), "server", "assets", "fonts"),
  path.resolve(process.cwd(), "dist", "assets", "fonts"),
];
const FONT_ROOT =
  FONT_CANDIDATES.find((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }) ?? FONT_CANDIDATES[0];

function readFontIfExists(filename: string): Buffer | null {
  try {
    const full = path.join(FONT_ROOT, filename);
    if (fs.existsSync(full)) return fs.readFileSync(full);
  } catch {}
  return null;
}

const CJK_REGULAR = readFontIfExists("NotoSansSC-Regular.otf");
const CJK_BOLD = readFontIfExists("NotoSansSC-Bold.otf") ?? CJK_REGULAR;

interface FontPair {
  regular: string;
  bold: string;
  // Bytes for embedded fonts (undefined for PDF built-ins).
  regularBytes?: Buffer;
  boldBytes?: Buffer;
}

const HELVETICA_PAIR: FontPair = { regular: "Helvetica", bold: "Helvetica-Bold" };

function fontPairFor(locale: NdaLocale): FontPair {
  if (locale === "zh" && CJK_REGULAR) {
    return {
      regular: "NdaCjkRegular",
      bold: "NdaCjkBold",
      regularBytes: CJK_REGULAR,
      boldBytes: CJK_BOLD ?? CJK_REGULAR,
    };
  }
  return HELVETICA_PAIR;
}

export function extractSnapshotLocale(renderedBody: string | null | undefined): NdaLocale {
  if (!renderedBody) return "en";
  try {
    const parsed = JSON.parse(renderedBody) as { locale?: string };
    return normalizeNdaLocale(parsed?.locale ?? "en");
  } catch {
    return "en";
  }
}

/**
 * Generate a PDF for the NDA, optionally including the signature block.
 * Output bytes are deterministic for the same inputs because:
 *   - PDFKit metadata (CreationDate / ModDate / Producer / Creator) is
 *     pinned from the signature metadata (or fixed placeholders).
 *   - Built-in Helvetica/Helvetica-Bold fonts are used (no embedded
 *     fonts → no timestamped font streams).
 *   - PDFKit emits the same byte sequence for the same draw operations
 *     when the metadata above is held constant.
 *
 * Determinism is what makes hash verification meaningful: a re-render of
 * the same signed case produces a byte-identical PDF whose SHA-256 must
 * match the stored `contentHash`.
 */
// Generate the NDA PDF.
//
// Version dispatch: the layout is keyed to `rendered.templateVersion`
// so a previously-signed snapshot (e.g. v1.2026.05) re-renders under
// the exact layout it was signed against, while fresh signings use
// the latest premium layout. This is a defence-in-depth guarantee —
// in practice the signed PDF bytes are served verbatim from
// `case_ndas.signedPdfBase64`, so `buildNdaPdf` is never invoked for
// stored snapshots — but if any future code path does re-render from
// a stored snapshot, the bytes will still hash to the stored value.
export function buildNdaPdf(
  rendered: NdaRendered,
  signature?: NdaSignatureMeta,
): Promise<Buffer> {
  // Each superseded template version is pinned to the exact renderer
  // it was sealed under so re-renders remain byte-identical to the
  // stored snapshot. New signings (and unsigned previews) flow into
  // the latest premium renderer.
  const v = rendered.templateVersion;
  if (v === "v1.2026.05") return buildNdaPdfV1_2026_05(rendered, signature);
  if (v === "v1.2026.06") return buildNdaPdfV1_2026_06(rendered, signature);
  if (v === "v1.2026.07") return buildNdaPdfV1_2026_07(rendered, signature);
  return buildNdaPdfV1_2026_08(rendered, signature);
}

// All template versions that were ever sealed under a now-superseded
// layout. Add to this set when bumping NDA_TEMPLATE_VERSION; never
// remove an entry, or stored snapshots from that version will start
// re-rendering under a different layout and their integrity hashes
// will no longer match the stored bytes.
const _LEGACY_TEMPLATE_VERSIONS: ReadonlySet<string> = new Set([
  "v1.2026.05",
  "v1.2026.06",
  "v1.2026.07",
]);

// Premium PDF renderer for the Sealed Settlement & NDA.
//
// Visual goals (v1.2026.06):
//   - A cover page with an inline vector crest, gold accent rules, the
//     document title, and a framed Parties & Particulars panel.
//   - Branded letterhead (subtle wordmark + page-of) and footer
//     (effective date + confidentiality line + page number) on every
//     body page.
//   - Restrained gold (#c8a951) accent rules under each section heading.
//   - A diagonal "IBCCF · CONFIDENTIAL" watermark at low opacity behind
//     body text on every body page (cover excluded).
//   - A framed signature panel with typed-name / date / IP /
//     jurisdiction / SHA-256 integrity rows.
//
// Determinism guarantees:
//   - All drawing operations are derived purely from the rendered body
//     and the signature metadata — no Date.now(), no Math.random(), no
//     environment lookups.
//   - PDF metadata (CreationDate / ModDate) is pinned to signedAt (or
//     a fixed epoch for unsigned previews).
//   - Built-in Helvetica is used for Latin locales and the embedded
//     NotoSansSC bytes for zh — the same input bytes always produce
//     the same on-disk font streams.
//   - Two consecutive renders of the same inputs produce byte-identical
//     output, which is what the integrity sweep relies on.
function buildNdaPdfV1_2026_06(
  rendered: NdaRendered,
  signature?: NdaSignatureMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pinnedDate = signature?.signedAt ?? new Date(0);
      const doc = new PDFDocument({
        size: "A4",
        margin: 56,
        bufferPages: true,
        info: {
          Title: rendered.title,
          Author: "IBCCF International Enforcement Division",
          Subject: `Settlement Acknowledgement — ${rendered.templateVersion}`,
          Producer: "IBCCF NDA Generator",
          Creator: "IBCCF NDA Generator",
          CreationDate: pinnedDate,
          ModDate: pinnedDate,
        },
      });

      const pair = fontPairFor(rendered.locale);
      if (pair.regularBytes) doc.registerFont(pair.regular, pair.regularBytes);
      if (pair.boldBytes) doc.registerFont(pair.bold, pair.boldBytes);

      const labelsByLocale: Record<NdaLocale, { particulars: string; acknowledgement: string; signature: string; previewNote: string; cover: string; confidential: string; translationNoticeTitle: string; translationNoticeBody: string }> = {
        en: { particulars: "Parties & Particulars", acknowledgement: "Acknowledgement", signature: "Signature", previewNote: "PREVIEW ONLY — not yet signed. Submit the typed-name signature inside your portal to seal this acknowledgement.", cover: "Cover · Strictly confidential", confidential: "Strictly confidential", translationNoticeTitle: "Translation notice", translationNoticeBody: "This translation is provided as a courtesy. The English version of this document is the legally controlling text." },
        es: { particulars: "Partes y datos", acknowledgement: "Reconocimiento", signature: "Firma", previewNote: "SÓLO VISTA PREVIA — aún no firmado. Envíe la firma con su nombre escrito en el portal para sellar este reconocimiento.", cover: "Portada · Estrictamente confidencial", confidential: "Estrictamente confidencial", translationNoticeTitle: "Aviso de traducción", translationNoticeBody: "Esta traducción se proporciona por cortesía. La versión en inglés de este documento es el texto jurídicamente vinculante." },
        fr: { particulars: "Parties et informations", acknowledgement: "Reconnaissance", signature: "Signature", previewNote: "APERÇU UNIQUEMENT — non encore signé. Soumettez la signature dactylographiée dans votre portail pour sceller cette reconnaissance.", cover: "Couverture · Strictement confidentiel", confidential: "Strictement confidentiel", translationNoticeTitle: "Avis de traduction", translationNoticeBody: "Cette traduction est fournie à titre de courtoisie. La version anglaise de ce document est le texte juridiquement contraignant." },
        de: { particulars: "Parteien und Angaben", acknowledgement: "Bestätigung", signature: "Unterschrift", previewNote: "NUR VORSCHAU — noch nicht unterzeichnet. Reichen Sie die getippte Namensunterschrift im Portal ein, um diese Bestätigung zu versiegeln.", cover: "Deckblatt · Streng vertraulich", confidential: "Streng vertraulich", translationNoticeTitle: "Übersetzungshinweis", translationNoticeBody: "Diese Übersetzung wird aus Gefälligkeit bereitgestellt. Die englische Fassung dieses Dokuments ist der rechtlich maßgebliche Text." },
        pt: { particulars: "Partes e dados", acknowledgement: "Reconhecimento", signature: "Assinatura", previewNote: "APENAS PRÉ-VISUALIZAÇÃO — ainda não assinado. Submeta a assinatura escrita no portal para selar este reconhecimento.", cover: "Capa · Estritamente confidencial", confidential: "Estritamente confidencial", translationNoticeTitle: "Aviso de tradução", translationNoticeBody: "Esta tradução é fornecida por cortesia. A versão em inglês deste documento é o texto juridicamente vinculativo." },
        zh: { particulars: "当事人与基本信息", acknowledgement: "确认", signature: "签署", previewNote: "仅供预览 — 尚未签署。请在门户中提交输入式姓名签名以封存本承诺。", cover: "封面 · 严格保密", confidential: "严格保密", translationNoticeTitle: "翻译说明", translationNoticeBody: "本翻译仅供参考。本文件的英文版本为具有法律效力的正式文本。" },
      };
      const localLabels = labelsByLocale[rendered.locale] ?? labelsByLocale.en;

      // Courtesy-translation disclaimer (Task #60): mirrors the screen
      // banner from SealedView so the warning travels with the document
      // if the user prints or shares the preview. Gated on
      // `!signature` so signed PDF bytes (and their SHA-256 hashes)
      // stay byte-identical to what was sealed. Auto-disappears once
      // `NDA_TRANSLATIONS_REVIEWED` flips to true.
      const showTranslationDisclaimer =
        !signature &&
        rendered.locale !== "en" &&
        !NDA_TRANSLATIONS_REVIEWED;

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Brand palette + page geometry.
      const GOLD = "#c8a951";
      const NAVY = "#0a1840";
      const BODY = "#1a2233";
      const MUTED = "#6b7385";
      const PANEL_BG = "#f6f4ec";
      const PANEL_BORDER = "#e6dfc4";
      const PAGE_W = doc.page.width;
      const PAGE_H = doc.page.height;
      const M = 56;
      const CONTENT_W = PAGE_W - 2 * M;

      // Watermark — drawn on each new BODY page by the pageAdded
      // handler below. Low opacity keeps body text fully legible.
      const drawWatermark = () => {
        const sx = doc.x;
        const sy = doc.y;
        doc.save();
        doc.fillOpacity(0.05);
        doc.fillColor(NAVY);
        doc.font(pair.bold).fontSize(52);
        doc.translate(PAGE_W / 2, PAGE_H / 2);
        doc.rotate(-30);
        const wm = "IBCCF · CONFIDENTIAL";
        const tw = doc.widthOfString(wm);
        doc.text(wm, -tw / 2, -26, { lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
        doc.x = sx;
        doc.y = sy;
      };

      // The cover page is the first page and must NOT receive the
      // watermark / header / footer treatment. We flip this flag on
      // before adding the first body page.
      let isBodyPhase = false;
      doc.on("pageAdded", () => {
        if (!isBodyPhase) return;
        drawWatermark();
        // Reserve space below the letterhead strip for content.
        doc.x = M;
        doc.y = M + 16;
      });

      // ============================================================
      // COVER PAGE
      // ============================================================

      // Top + bottom gold edge rules.
      doc.save();
      doc.rect(0, 0, PAGE_W, 8).fill(GOLD);
      doc.rect(0, PAGE_H - 8, PAGE_W, 8).fill(GOLD);
      doc.restore();

      // Courtesy-translation disclaimer banner (preview only,
      // non-English, pre-counsel-review). Placed at the very top of
      // the cover page so the warning is the first thing a reader
      // sees if they print or share the preview PDF.
      if (showTranslationDisclaimer) {
        const bannerX = M;
        const bannerY = 22;
        const bannerW = CONTENT_W;
        const bannerH = 54;
        doc.save();
        doc
          .lineWidth(0.8)
          .strokeColor("#b8860b")
          .rect(bannerX, bannerY, bannerW, bannerH)
          .fillAndStroke("#fff8e1", "#b8860b");
        doc.rect(bannerX, bannerY, 3, bannerH).fill("#b8860b");
        doc.restore();
        doc.fillColor("#7a5a00").font(pair.bold).fontSize(9);
        doc.text(localLabels.translationNoticeTitle, bannerX + 12, bannerY + 8, {
          width: bannerW - 24,
          lineBreak: false,
          characterSpacing: 0.4,
        });
        doc.fillColor("#5a4400").font(pair.regular).fontSize(8.5);
        doc.text(localLabels.translationNoticeBody, bannerX + 12, bannerY + 22, {
          width: bannerW - 24,
          lineGap: 1.5,
        });
      }

      // Vector crest — a navy orb with gold meridians and equator. Pure
      // geometry so no external asset is required and bytes stay
      // reproducible across deployments.
      const crestCx = PAGE_W / 2;
      const crestCy = 150;
      const crestR = 34;
      doc.save();
      doc.lineWidth(1.6).strokeColor(GOLD).fillColor(NAVY);
      doc.circle(crestCx, crestCy, crestR).fillAndStroke();
      doc.strokeColor(GOLD).lineWidth(0.8);
      doc.moveTo(crestCx - crestR + 2, crestCy).lineTo(crestCx + crestR - 2, crestCy).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.45, crestR * 0.95).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.85, crestR * 0.55).stroke();
      doc.restore();

      // Wordmark.
      doc.fillColor(GOLD).font(pair.bold).fontSize(30);
      doc.text("IBCCF", M, crestCy + crestR + 22, {
        width: CONTENT_W,
        align: "center",
        lineBreak: false,
        characterSpacing: 4,
      });

      // Subtitle.
      doc.fillColor(MUTED).font(pair.regular).fontSize(9.5);
      doc.text(rendered.subtitle, M, crestCy + crestR + 64, {
        width: CONTENT_W,
        align: "center",
      });

      // Short centered gold rule.
      const ruleY1 = crestCy + crestR + 100;
      doc.save();
      doc.rect(PAGE_W / 2 - 50, ruleY1, 100, 1.2).fill(GOLD);
      doc.restore();

      // Title.
      doc.fillColor(NAVY).font(pair.bold).fontSize(22);
      doc.text(rendered.title, M, ruleY1 + 24, {
        width: CONTENT_W,
        align: "center",
      });

      // Template + effective date metadata strip.
      doc.fillColor(MUTED).font(pair.regular).fontSize(10);
      doc.text(
        `Template ${rendered.templateVersion}   ·   ${rendered.effectiveDateLabel}`,
        M,
        doc.y + 10,
        { width: CONTENT_W, align: "center" },
      );

      // Parties & Particulars panel — framed with a gold left rule.
      const panelY = doc.y + 40;
      const rowH = 22;
      const panelH = 28 + rendered.partyBlock.length * rowH + 16;
      doc.save();
      doc.rect(M + 3, panelY, CONTENT_W - 3, panelH).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.rect(M, panelY, 3, panelH).fill(GOLD);
      doc.restore();

      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.particulars, M + 18, panelY + 12, {
        width: CONTENT_W - 36,
        lineBreak: false,
      });

      let ry = panelY + 36;
      for (const row of rendered.partyBlock) {
        doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
        doc.text(row.label.toUpperCase(), M + 18, ry, {
          width: 160,
          lineBreak: false,
          characterSpacing: 0.8,
        });
        doc.fillColor(BODY).font(pair.bold).fontSize(10);
        doc.text(row.value, M + 180, ry - 1, {
          width: CONTENT_W - 198,
          lineBreak: false,
          ellipsis: true,
        });
        ry += rowH;
      }

      // Cover footer line.
      doc.fillColor(MUTED).font(pair.regular).fontSize(8);
      doc.text(localLabels.cover, M, PAGE_H - 30, {
        width: CONTENT_W,
        align: "center",
      });

      // ============================================================
      // BODY PAGES
      // ============================================================

      isBodyPhase = true;
      doc.addPage(); // fires pageAdded → draws watermark, sets cursor

      // Recitals.
      for (const r of rendered.recitals) {
        doc.fillColor(BODY).font(pair.regular).fontSize(10);
        doc.text(r, M, doc.y, {
          width: CONTENT_W,
          align: "justify",
          lineGap: 2.5,
        });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.3);

      // Sections.
      for (const section of rendered.sections) {
        if (doc.y > PAGE_H - M - 80) {
          doc.addPage();
        }
        doc.fillColor(NAVY).font(pair.bold).fontSize(12);
        doc.text(section.heading, M, doc.y, { width: CONTENT_W });
        const ruleY = doc.y + 2;
        doc.save();
        doc.rect(M, ruleY, 36, 1.5).fill(GOLD);
        doc.restore();
        doc.y = ruleY + 10;
        for (const p of section.paragraphs) {
          doc.fillColor(BODY).font(pair.regular).fontSize(10);
          doc.text(p, M, doc.y, {
            width: CONTENT_W,
            align: "justify",
            lineGap: 2.5,
          });
          doc.moveDown(0.4);
        }
        doc.moveDown(0.4);
      }

      // Acknowledgement.
      if (doc.y > PAGE_H - M - 100) {
        doc.addPage();
      }
      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.acknowledgement, M, doc.y, { width: CONTENT_W });
      const ackRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, ackRuleY, 36, 1.5).fill(GOLD);
      doc.restore();
      doc.y = ackRuleY + 10;
      doc.fillColor(BODY).font(pair.regular).fontSize(10);
      doc.text(rendered.acknowledgement, M, doc.y, {
        width: CONTENT_W,
        align: "justify",
        lineGap: 2.5,
      });
      doc.moveDown(1);

      // Framed signature panel. Signed renders carry five labelled rows
      // (typed name, date, IP, jurisdiction, SHA-256 integrity) plus a
      // wrapping evidentiary note; previews carry blanks + a guidance
      // note. Height is sized accordingly.
      const sigPanelH = signature ? 178 : 116;
      if (doc.y > PAGE_H - M - sigPanelH - 30) {
        doc.addPage();
      }
      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.signature, M, doc.y, { width: CONTENT_W });
      const sigHeadRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, sigHeadRuleY, 36, 1.5).fill(GOLD);
      doc.restore();
      doc.y = sigHeadRuleY + 14;

      const sigBoxY = doc.y;
      doc.save();
      doc.lineWidth(1).strokeColor(PANEL_BORDER);
      doc.rect(M + 3, sigBoxY, CONTENT_W - 3, sigPanelH).fillAndStroke("#ffffff", PANEL_BORDER);
      doc.rect(M, sigBoxY, 3, sigPanelH).fill(GOLD);
      doc.restore();

      const labels = rendered.signatureBlockLabels;
      // Jurisdiction is at a fixed slot in renderNda's partyBlock
      // (caseRef, recipient, jurisdiction, settlementAmount, wallet).
      // Surfacing it inside the signature panel anchors the governing-law
      // section back to the act of signing.
      const jurisdictionRow = rendered.partyBlock[2] ?? {
        label: "Jurisdiction",
        value: "—",
      };
      const sx = M + 20;
      let sy = sigBoxY + 16;
      if (signature) {
        const rows: Array<[string, string]> = [
          [labels.typedName, signature.signedName],
          [labels.date, signature.signedAt.toISOString()],
          [labels.ip, signature.signedIp ?? "Not recorded"],
          [jurisdictionRow.label, jurisdictionRow.value],
          // Self-referential SHA-256 is a fixed-point problem (the value
          // you'd embed can only be known AFTER the embed). We show the
          // labelled row as a visual anchor for the integrity note below;
          // the actual hash is recorded on the case_ndas row + audit log
          // and surfaced in the cover email and admin Sealed banner.
          [labels.integrityHash, "—"],
        ];
        for (const [k, v] of rows) {
          doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
          doc.text(k.toUpperCase(), sx, sy, {
            width: 150,
            lineBreak: false,
            characterSpacing: 0.8,
          });
          doc.fillColor(BODY).font(pair.bold).fontSize(10);
          doc.text(v, sx + 160, sy - 1, {
            width: CONTENT_W - 200,
            lineBreak: false,
            ellipsis: true,
          });
          sy += 22;
        }
        sy += 6;
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(labels.note, sx, sy, { width: CONTENT_W - 40, lineGap: 1.5 });
      } else {
        doc.fillColor(BODY).font(pair.regular).fontSize(10);
        doc.text(`${labels.typedName}: ____________________________________`, sx, sy, { width: CONTENT_W - 40, lineBreak: false });
        sy += 24;
        doc.text(`${labels.date}: ____________________________________`, sx, sy, { width: CONTENT_W - 40, lineBreak: false });
        sy += 24;
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(localLabels.previewNote, sx, sy + 4, { width: CONTENT_W - 40, lineGap: 1.5 });
      }

      // ============================================================
      // LETTERHEAD HEADER + FOOTER on every body page
      // ============================================================

      const range = doc.bufferedPageRange();
      const total = range.count;
      const bodyTotal = total - 1; // exclude cover from Page X of Y
      for (let i = 1; i < total; i++) {
        doc.switchToPage(i);
        const pageNum = i;

        // Header: thin gold rule + wordmark left + meta right.
        doc.save();
        doc.rect(M, M - 16, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();
        doc.fillColor(NAVY).font(pair.bold).fontSize(8.5);
        doc.text("IBCCF", M, M - 28, {
          width: CONTENT_W / 2,
          lineBreak: false,
          characterSpacing: 1.6,
        });
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Template ${rendered.templateVersion}  ·  Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W / 2,
          M - 27,
          { width: CONTENT_W / 2, align: "right", lineBreak: false },
        );

        // Footer: thin gold rule + effective date / confidentiality / page-of.
        doc.save();
        doc.rect(M, PAGE_H - M + 10, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `${rendered.effectiveDateLabel}  ·  ${localLabels.confidential}`,
          M,
          PAGE_H - M + 18,
          { width: CONTENT_W * 0.72, lineBreak: false },
        );
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W * 0.72,
          PAGE_H - M + 18,
          { width: CONTENT_W * 0.28, align: "right", lineBreak: false },
        );
      }

      doc.flushPages();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Premium PDF renderer for v1.2026.07 — design upgrade over v06.
//
// Improvements over v1.2026.06:
//   - Cover: classification chips (top-left case-ref, top-right
//     CONFIDENTIAL), refined crest with inner gold dot, hairline
//     dividers between particulars rows, cleaner typography hierarchy.
//   - Body: header and footer now sit INSIDE the printable margin
//     (v06 used negative Y offsets that read as cropped on some
//     viewers). Lighter, smaller watermark so body copy stays primary.
//     Section headings carry a numbered gold badge.
//   - Recitals: italic (Helvetica-Oblique on Latin locales, regular on
//     CJK) with a thin gold left rule so the WHEREAS clauses read as
//     a distinct preamble.
//   - Signature: vector wax-seal stamp anchors the panel; integrity
//     note pulled out of the panel for breathing room.
//
// Determinism guarantees (identical to v06):
//   - All drawing operations are derived purely from rendered + signature.
//   - PDF metadata pinned to signedAt (or epoch for previews).
//   - Built-in Helvetica / Helvetica-Oblique / Helvetica-Bold for Latin;
//     embedded NotoSansSC bytes for zh. No timestamped streams.
function buildNdaPdfV1_2026_07(
  rendered: NdaRendered,
  signature?: NdaSignatureMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pinnedDate = signature?.signedAt ?? new Date(0);
      const M = 56;
      const TOP_MARGIN = 84;
      // PDFKit's bottom margin governs AUTO-pagination. We keep it
      // tight (20pt) so absolutely-positioned header/footer/watermark
      // writes that land in the reserved bottom strip do NOT spawn
      // spurious overflow pages. Body-content placement uses our own
      // BODY_BOTTOM threshold below, which reserves room for the
      // footer band.
      const DOC_BOTTOM_MARGIN = 20;
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: TOP_MARGIN, bottom: DOC_BOTTOM_MARGIN, left: M, right: M },
        bufferPages: true,
        info: {
          Title: rendered.title,
          Author: "IBCCF International Enforcement Division",
          Subject: `Settlement Acknowledgement — ${rendered.templateVersion}`,
          Producer: "IBCCF NDA Generator",
          Creator: "IBCCF NDA Generator",
          CreationDate: pinnedDate,
          ModDate: pinnedDate,
        },
      });

      const pair = fontPairFor(rendered.locale);
      if (pair.regularBytes) doc.registerFont(pair.regular, pair.regularBytes);
      if (pair.boldBytes) doc.registerFont(pair.bold, pair.boldBytes);
      // Italic only available for Latin locales (PDFKit built-in).
      // CJK falls back to regular — Noto Sans SC does not ship italic
      // weights here and synthetic obliquing would break determinism.
      const italicFont = pair.regularBytes ? pair.regular : "Helvetica-Oblique";

      const labelsByLocale: Record<NdaLocale, { particulars: string; acknowledgement: string; signature: string; previewNote: string; cover: string; confidential: string; translationNoticeTitle: string; translationNoticeBody: string; sealedMark: string }> = {
        en: { particulars: "Parties & Particulars", acknowledgement: "Acknowledgement", signature: "Signature", previewNote: "PREVIEW ONLY — not yet signed. Submit the typed-name signature inside your portal to seal this acknowledgement.", cover: "Cover · Strictly confidential — do not distribute", confidential: "Strictly confidential", translationNoticeTitle: "Translation notice", translationNoticeBody: "This translation is provided as a courtesy. The English version of this document is the legally controlling text.", sealedMark: "SEALED" },
        es: { particulars: "Partes y datos", acknowledgement: "Reconocimiento", signature: "Firma", previewNote: "SÓLO VISTA PREVIA — aún no firmado. Envíe la firma con su nombre escrito en el portal para sellar este reconocimiento.", cover: "Portada · Estrictamente confidencial — no distribuir", confidential: "Estrictamente confidencial", translationNoticeTitle: "Aviso de traducción", translationNoticeBody: "Esta traducción se proporciona por cortesía. La versión en inglés de este documento es el texto jurídicamente vinculante.", sealedMark: "SELLADO" },
        fr: { particulars: "Parties et informations", acknowledgement: "Reconnaissance", signature: "Signature", previewNote: "APERÇU UNIQUEMENT — non encore signé. Soumettez la signature dactylographiée dans votre portail pour sceller cette reconnaissance.", cover: "Couverture · Strictement confidentiel — ne pas diffuser", confidential: "Strictement confidentiel", translationNoticeTitle: "Avis de traduction", translationNoticeBody: "Cette traduction est fournie à titre de courtoisie. La version anglaise de ce document est le texte juridiquement contraignant.", sealedMark: "SCELLÉ" },
        de: { particulars: "Parteien und Angaben", acknowledgement: "Bestätigung", signature: "Unterschrift", previewNote: "NUR VORSCHAU — noch nicht unterzeichnet. Reichen Sie die getippte Namensunterschrift im Portal ein, um diese Bestätigung zu versiegeln.", cover: "Deckblatt · Streng vertraulich — nicht weitergeben", confidential: "Streng vertraulich", translationNoticeTitle: "Übersetzungshinweis", translationNoticeBody: "Diese Übersetzung wird aus Gefälligkeit bereitgestellt. Die englische Fassung dieses Dokuments ist der rechtlich maßgebliche Text.", sealedMark: "VERSIEGELT" },
        pt: { particulars: "Partes e dados", acknowledgement: "Reconhecimento", signature: "Assinatura", previewNote: "APENAS PRÉ-VISUALIZAÇÃO — ainda não assinado. Submeta a assinatura escrita no portal para selar este reconhecimento.", cover: "Capa · Estritamente confidencial — não distribuir", confidential: "Estritamente confidencial", translationNoticeTitle: "Aviso de tradução", translationNoticeBody: "Esta tradução é fornecida por cortesia. A versão em inglês deste documento é o texto juridicamente vinculativo.", sealedMark: "SELADO" },
        zh: { particulars: "当事人与基本信息", acknowledgement: "确认", signature: "签署", previewNote: "仅供预览 — 尚未签署。请在门户中提交输入式姓名签名以封存本承诺。", cover: "封面 · 严格保密 — 请勿分发", confidential: "严格保密", translationNoticeTitle: "翻译说明", translationNoticeBody: "本翻译仅供参考。本文件的英文版本为具有法律效力的正式文本。", sealedMark: "已封存" },
      };
      const localLabels = labelsByLocale[rendered.locale] ?? labelsByLocale.en;

      const showTranslationDisclaimer =
        !signature &&
        rendered.locale !== "en" &&
        !NDA_TRANSLATIONS_REVIEWED;

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Brand palette + page geometry.
      const GOLD = "#c8a951";
      const GOLD_DEEP = "#a8862e";
      const NAVY = "#0a1840";
      const BODY = "#1a2233";
      const MUTED = "#6b7385";
      const HAIRLINE = "#d8d2bc";
      const PANEL_BG = "#faf7eb";
      const PANEL_BORDER = "#e6dfc4";
      const PAGE_W = doc.page.width;
      const PAGE_H = doc.page.height;
      const CONTENT_W = PAGE_W - 2 * M;

      // Lighter, smaller watermark than v06 — body copy stays primary.
      const drawWatermark = () => {
        const sx = doc.x, sy = doc.y;
        doc.save();
        doc.fillOpacity(0.04);
        doc.fillColor(NAVY);
        doc.font(pair.bold).fontSize(40);
        doc.translate(PAGE_W / 2, PAGE_H / 2);
        doc.rotate(-30);
        const wm = "IBCCF · CONFIDENTIAL";
        const tw = doc.widthOfString(wm);
        doc.text(wm, -tw / 2, -20, { lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
        doc.x = sx; doc.y = sy;
      };

      let isBodyPhase = false;
      doc.on("pageAdded", () => {
        if (!isBodyPhase) return;
        drawWatermark();
        doc.x = M;
        doc.y = TOP_MARGIN;
      });

      // ============================================================
      // COVER PAGE
      // ============================================================

      // Top + bottom gold edge bands with deep-gold hairline accents.
      doc.save();
      doc.rect(0, 0, PAGE_W, 10).fill(GOLD);
      doc.rect(0, 10, PAGE_W, 0.6).fill(GOLD_DEEP);
      doc.rect(0, PAGE_H - 10, PAGE_W, 10).fill(GOLD);
      doc.rect(0, PAGE_H - 10.6, PAGE_W, 0.6).fill(GOLD_DEEP);
      doc.restore();

      // Classification chip — top right (navy fill, gold text).
      const chipH = 18;
      const chipY = 26;
      const chipText = localLabels.confidential.toUpperCase();
      doc.font(pair.bold).fontSize(8);
      const chipTextW = doc.widthOfString(chipText, { characterSpacing: 1.4 });
      const chipW = chipTextW + 22;
      const chipX = PAGE_W - M - chipW;
      doc.save();
      doc.rect(chipX, chipY, chipW, chipH).fill(NAVY);
      doc.restore();
      doc.fillColor(GOLD).font(pair.bold).fontSize(8);
      doc.text(chipText, chipX, chipY + 5, {
        width: chipW, align: "center", lineBreak: false, characterSpacing: 1.4,
      });

      // Case-ref chip — top left (white with navy border).
      const caseShort = (rendered.partyBlock[0]?.value ?? "").slice(0, 8).toUpperCase();
      const refText = `REF · ${caseShort}`;
      doc.font(pair.bold).fontSize(8);
      const refTextW = doc.widthOfString(refText, { characterSpacing: 1.4 });
      const refW = refTextW + 22;
      doc.save();
      doc.lineWidth(0.8).strokeColor(NAVY).fillColor("#ffffff");
      doc.rect(M, chipY, refW, chipH).fillAndStroke("#ffffff", NAVY);
      doc.restore();
      doc.fillColor(NAVY).font(pair.bold).fontSize(8);
      doc.text(refText, M, chipY + 5, {
        width: refW, align: "center", lineBreak: false, characterSpacing: 1.4,
      });

      // Translation disclaimer banner (pre-counsel-review, non-English
      // preview only). Positioned just below the chip row.
      let topY = chipY + chipH + 14;
      if (showTranslationDisclaimer) {
        const bannerX = M;
        const bannerY = topY;
        const bannerW = CONTENT_W;
        const bannerH = 54;
        doc.save();
        doc
          .lineWidth(0.8)
          .strokeColor("#b8860b")
          .rect(bannerX, bannerY, bannerW, bannerH)
          .fillAndStroke("#fff8e1", "#b8860b");
        doc.rect(bannerX, bannerY, 3, bannerH).fill("#b8860b");
        doc.restore();
        doc.fillColor("#7a5a00").font(pair.bold).fontSize(9);
        doc.text(localLabels.translationNoticeTitle, bannerX + 12, bannerY + 8, {
          width: bannerW - 24, lineBreak: false, characterSpacing: 0.4,
        });
        doc.fillColor("#5a4400").font(pair.regular).fontSize(8.5);
        doc.text(localLabels.translationNoticeBody, bannerX + 12, bannerY + 22, {
          width: bannerW - 24, lineGap: 1.5,
        });
        topY = bannerY + bannerH + 18;
      }

      // Vector crest — navy orb, gold meridians, inner gold dot.
      const crestCx = PAGE_W / 2;
      const crestCy = topY + 56;
      const crestR = 38;
      doc.save();
      doc.lineWidth(1.6).strokeColor(GOLD).fillColor(NAVY);
      doc.circle(crestCx, crestCy, crestR).fillAndStroke();
      doc.strokeColor(GOLD).lineWidth(0.8);
      doc.moveTo(crestCx - crestR + 3, crestCy).lineTo(crestCx + crestR - 3, crestCy).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.45, crestR * 0.95).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.85, crestR * 0.55).stroke();
      doc.fillColor(GOLD).circle(crestCx, crestCy, 2.6).fill();
      doc.restore();

      // Wordmark.
      doc.fillColor(GOLD).font(pair.bold).fontSize(34);
      doc.text("IBCCF", M, crestCy + crestR + 22, {
        width: CONTENT_W, align: "center", lineBreak: false, characterSpacing: 6,
      });

      // Subtitle.
      doc.fillColor(MUTED).font(pair.regular).fontSize(9.5);
      doc.text(rendered.subtitle, M, crestCy + crestR + 70, {
        width: CONTENT_W, align: "center",
      });

      // Short centered gold rule.
      const ruleY1 = crestCy + crestR + 110;
      doc.save();
      doc.rect(PAGE_W / 2 - 60, ruleY1, 120, 1.4).fill(GOLD);
      doc.restore();

      // Title.
      doc.fillColor(NAVY).font(pair.bold).fontSize(22);
      doc.text(rendered.title, M, ruleY1 + 22, {
        width: CONTENT_W, align: "center", lineGap: 4,
      });

      // Template + effective date strip.
      doc.fillColor(MUTED).font(pair.regular).fontSize(9.5);
      doc.text(
        `Template ${rendered.templateVersion}   ·   ${rendered.effectiveDateLabel}`,
        M, doc.y + 12,
        { width: CONTENT_W, align: "center", characterSpacing: 0.5 },
      );

      // Parties & Particulars panel — gold rail, hairline-divided rows.
      const panelY = doc.y + 34;
      const rowH = 26;
      const panelH = 46 + rendered.partyBlock.length * rowH + 8;
      doc.save();
      doc.rect(M + 4, panelY, CONTENT_W - 4, panelH).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.rect(M, panelY, 4, panelH).fill(GOLD);
      doc.restore();

      doc.fillColor(NAVY).font(pair.bold).fontSize(10);
      doc.text(localLabels.particulars.toUpperCase(), M + 20, panelY + 14, {
        width: CONTENT_W - 40, lineBreak: false, characterSpacing: 1.2,
      });
      doc.save();
      doc.rect(M + 20, panelY + 30, 30, 1).fill(GOLD);
      doc.restore();

      let ry = panelY + 44;
      for (let i = 0; i < rendered.partyBlock.length; i++) {
        const row = rendered.partyBlock[i];
        doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
        doc.text(row.label.toUpperCase(), M + 20, ry, {
          width: 160, lineBreak: false, characterSpacing: 1,
        });
        doc.fillColor(BODY).font(pair.bold).fontSize(10);
        doc.text(row.value, M + 180, ry - 1, {
          width: CONTENT_W - 200, lineBreak: false, ellipsis: true,
        });
        if (i < rendered.partyBlock.length - 1) {
          doc.save();
          doc.rect(M + 20, ry + 16, CONTENT_W - 40, 0.4).fill(HAIRLINE);
          doc.restore();
        }
        ry += rowH;
      }

      // Cover footer classification line.
      doc.fillColor(MUTED).font(pair.regular).fontSize(8);
      doc.text(localLabels.cover, M, PAGE_H - 34, {
        width: CONTENT_W, align: "center", characterSpacing: 0.6,
      });

      // ============================================================
      // BODY PAGES
      // ============================================================

      isBodyPhase = true;
      doc.addPage();

      // Recitals — italic + thin gold left rule, set apart as preamble.
      const recitalsStartY = doc.y;
      for (const r of rendered.recitals) {
        doc.fillColor(BODY).font(italicFont).fontSize(10);
        doc.text(r, M + 14, doc.y, {
          width: CONTENT_W - 14, align: "justify", lineGap: 2.5,
        });
        doc.moveDown(0.4);
      }
      const recitalsEndY = doc.y;
      doc.save();
      doc.rect(M, recitalsStartY, 2, recitalsEndY - recitalsStartY - 4).fill(GOLD);
      doc.restore();
      doc.moveDown(0.5);

      // Sections — numbered gold badge + heading + accent rule.
      let sectionNum = 0;
      for (const section of rendered.sections) {
        sectionNum++;
        if (doc.y > PAGE_H - 110 - 90) {
          doc.addPage();
        }
        const headY = doc.y;
        // Gold badge with white numeral.
        const badgeSize = 18;
        doc.save();
        doc.rect(M, headY - 2, badgeSize, badgeSize).fill(GOLD);
        doc.restore();
        doc.fillColor("#ffffff").font(pair.bold).fontSize(10);
        doc.text(String(sectionNum), M, headY + 2, {
          width: badgeSize, align: "center", lineBreak: false,
        });
        // Heading text — strip the leading "N." from the source so the
        // badge provides the numbering without duplication.
        const headingText = section.heading.replace(/^\s*\d+\.\s*/, "");
        doc.fillColor(NAVY).font(pair.bold).fontSize(12);
        doc.text(headingText, M + badgeSize + 10, headY, {
          width: CONTENT_W - badgeSize - 10, lineBreak: false, ellipsis: true,
        });
        const ruleY = headY + badgeSize + 4;
        doc.save();
        doc.rect(M, ruleY, 40, 1.2).fill(GOLD);
        doc.restore();
        doc.y = ruleY + 12;
        for (const p of section.paragraphs) {
          doc.fillColor(BODY).font(pair.regular).fontSize(10);
          doc.text(p, M, doc.y, {
            width: CONTENT_W, align: "justify", lineGap: 2.5,
          });
          doc.moveDown(0.4);
        }
        doc.moveDown(0.5);
      }

      // Acknowledgement.
      if (doc.y > PAGE_H - 110 - 100) {
        doc.addPage();
      }
      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.acknowledgement.toUpperCase(), M, doc.y, {
        width: CONTENT_W, characterSpacing: 1.2,
      });
      const ackRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, ackRuleY, 40, 1.2).fill(GOLD);
      doc.restore();
      doc.y = ackRuleY + 12;
      doc.fillColor(BODY).font(pair.regular).fontSize(10);
      doc.text(rendered.acknowledgement, M, doc.y, {
        width: CONTENT_W, align: "justify", lineGap: 2.5,
      });
      doc.moveDown(1);

      // Signature panel.
      const sigPanelH = signature ? 170 : 110;
      if (doc.y > PAGE_H - 110 - sigPanelH - 30) {
        doc.addPage();
      }
      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.signature.toUpperCase(), M, doc.y, {
        width: CONTENT_W, characterSpacing: 1.2,
      });
      const sigHeadRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, sigHeadRuleY, 40, 1.2).fill(GOLD);
      doc.restore();
      doc.y = sigHeadRuleY + 14;

      const sigBoxY = doc.y;
      doc.save();
      doc.lineWidth(1).strokeColor(PANEL_BORDER);
      doc.rect(M + 4, sigBoxY, CONTENT_W - 4, sigPanelH).fillAndStroke("#ffffff", PANEL_BORDER);
      doc.rect(M, sigBoxY, 4, sigPanelH).fill(GOLD);
      doc.restore();

      // Vector wax-seal stamp in the panel's right gutter.
      const sealCx = M + CONTENT_W - 50;
      const sealCy = sigBoxY + sigPanelH / 2;
      const sealR = 28;
      doc.save();
      doc.lineWidth(1).strokeColor(GOLD_DEEP).fillOpacity(signature ? 0.12 : 0.06).fillColor(GOLD);
      doc.circle(sealCx, sealCy, sealR).fillAndStroke();
      doc.fillOpacity(1);
      doc.lineWidth(0.6).strokeColor(GOLD_DEEP);
      doc.circle(sealCx, sealCy, sealR - 4).stroke();
      doc.restore();
      doc.fillColor(GOLD_DEEP).font(pair.bold).fontSize(8);
      const sealText = signature ? localLabels.sealedMark : "PREVIEW";
      doc.text(sealText, sealCx - sealR, sealCy - 4, {
        width: sealR * 2, align: "center", lineBreak: false, characterSpacing: 1.2,
      });

      const labels = rendered.signatureBlockLabels;
      const jurisdictionRow = rendered.partyBlock[2] ?? { label: "Jurisdiction", value: "—" };
      const sx = M + 20;
      let sy = sigBoxY + 16;
      const fieldW = CONTENT_W - 40 - 70; // leave room for seal
      if (signature) {
        const rows: Array<[string, string]> = [
          [labels.typedName, signature.signedName],
          [labels.date, signature.signedAt.toISOString()],
          [labels.ip, signature.signedIp ?? "Not recorded"],
          [jurisdictionRow.label, jurisdictionRow.value],
          [labels.integrityHash, "—"],
        ];
        for (const [k, v] of rows) {
          doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
          doc.text(k.toUpperCase(), sx, sy, {
            width: 150, lineBreak: false, characterSpacing: 1,
          });
          doc.fillColor(BODY).font(pair.bold).fontSize(10);
          doc.text(v, sx + 160, sy - 1, {
            width: fieldW - 160, lineBreak: false, ellipsis: true,
          });
          sy += 22;
        }
      } else {
        doc.fillColor(BODY).font(pair.regular).fontSize(10);
        doc.text(`${labels.typedName}: ____________________________________`, sx, sy, { width: fieldW, lineBreak: false });
        sy += 24;
        doc.text(`${labels.date}: ____________________________________`, sx, sy, { width: fieldW, lineBreak: false });
        sy += 24;
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(localLabels.previewNote, sx, sy + 4, { width: fieldW, lineGap: 1.5 });
      }

      // Evidentiary note pulled out of the panel for breathing room.
      if (signature) {
        const noteY = sigBoxY + sigPanelH + 8;
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(labels.note, M + 4, noteY, { width: CONTENT_W - 8, lineGap: 1.5 });
      }

      // ============================================================
      // LETTERHEAD HEADER + FOOTER on every body page
      // ============================================================

      const range = doc.bufferedPageRange();
      const total = range.count;
      const bodyTotal = total - 1;
      for (let i = 1; i < total; i++) {
        doc.switchToPage(i);
        const pageNum = i;

        // Header: wordmark left, meta right, hairline rule below.
        const headerY = 32;
        doc.fillColor(NAVY).font(pair.bold).fontSize(8.5);
        doc.text("IBCCF", M, headerY, {
          width: CONTENT_W / 2, lineBreak: false, characterSpacing: 1.6,
        });
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Template ${rendered.templateVersion}  ·  Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W / 2, headerY + 1,
          { width: CONTENT_W / 2, align: "right", lineBreak: false },
        );
        doc.save();
        doc.rect(M, headerY + 14, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();

        // Footer: hairline rule above + classification + page-of.
        // Placed inside the reserved bottom strip (PDFKit margin is
        // only DOC_BOTTOM_MARGIN=20, so these writes do not trigger
        // overflow pagination).
        const footerLineY = PAGE_H - 44;
        const footerTextY = footerLineY + 8;
        doc.save();
        doc.rect(M, footerLineY, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `${rendered.effectiveDateLabel}  ·  ${localLabels.confidential}`,
          M, footerTextY,
          { width: CONTENT_W * 0.72, lineBreak: false },
        );
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W * 0.72, footerTextY,
          { width: CONTENT_W * 0.28, align: "right", lineBreak: false },
        );
      }

      doc.flushPages();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================
// v1.2026.08 — SA-inspired layout
//
// New features over v1.2026.07:
//   1. "Contents" panel on cover page (table-of-contents strip
//      listing all nine sections by number and short title).
//   2. Dual-party signature block:  IBCCF (pre-authorized, left)
//      alongside the Recipient's digital signature (right), mirroring
//      the bilateral format used in formal commercial NDAs.
//   3. Numbered acknowledgement items rendered with distinct visual
//      treatment — each "(N)" item gets its own hanging-indent line.
// ============================================================
function buildNdaPdfV1_2026_08(
  rendered: NdaRendered,
  signature?: NdaSignatureMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const M = 56;
      const TOP_MARGIN = 84;
      const DOC_BOTTOM_MARGIN = 20;

      const pinnedDate = signature?.signedAt ?? new Date(0);
      const doc = new PDFDocument({
        size: "A4",
        margin: M,
        bufferPages: true,
        info: {
          Title: rendered.title,
          Author: "IBCCF International Enforcement Division",
          Subject: "Sealed Settlement & Non-Disclosure Agreement",
          Keywords: "NDA, settlement, confidential, IBCCF",
          CreationDate: pinnedDate,
          ModDate: pinnedDate,
        },
        margins: { top: TOP_MARGIN, bottom: DOC_BOTTOM_MARGIN, left: M, right: M },
      });

      const pair = fontPairFor(rendered.locale);
      if (pair.regularBytes) doc.registerFont(pair.regular, pair.regularBytes);
      if (pair.boldBytes) doc.registerFont(pair.bold, pair.boldBytes);
      const italicFont = pair.regularBytes ? pair.regular : "Helvetica-Oblique";

      const labelsByLocale: Record<NdaLocale, {
        particulars: string; acknowledgement: string; signature: string;
        previewNote: string; cover: string; confidential: string;
        translationNoticeTitle: string; translationNoticeBody: string;
        sealedMark: string; contentsLabel: string;
        ibccfAuthority: string; ibccfRole: string;
      }> = {
        en: {
          particulars: "Parties & Particulars", acknowledgement: "Acknowledgement",
          signature: "Signatures", previewNote: "PREVIEW ONLY — not yet signed. Submit the typed-name signature inside your portal to seal this acknowledgement.",
          cover: "Cover · Strictly confidential — do not distribute", confidential: "Strictly confidential",
          translationNoticeTitle: "Translation notice",
          translationNoticeBody: "This translation is provided as a courtesy. The English version of this document is the legally controlling text.",
          sealedMark: "SEALED", contentsLabel: "Contents",
          ibccfAuthority: "Authorized Issuing Party", ibccfRole: "International Enforcement Division",
        },
        es: {
          particulars: "Partes y datos", acknowledgement: "Reconocimiento",
          signature: "Firmas", previewNote: "SÓLO VISTA PREVIA — aún no firmado. Envíe la firma con su nombre escrito en el portal para sellar este reconocimiento.",
          cover: "Portada · Estrictamente confidencial — no distribuir", confidential: "Estrictamente confidencial",
          translationNoticeTitle: "Aviso de traducción",
          translationNoticeBody: "Esta traducción se proporciona por cortesía. La versión en inglés de este documento es el texto jurídicamente vinculante.",
          sealedMark: "SELLADO", contentsLabel: "Contenido",
          ibccfAuthority: "Parte Emisora Autorizada", ibccfRole: "División Internacional de Cumplimiento",
        },
        fr: {
          particulars: "Parties et informations", acknowledgement: "Reconnaissance",
          signature: "Signatures", previewNote: "APERÇU UNIQUEMENT — non encore signé. Soumettez la signature dactylographiée dans votre portail pour sceller cette reconnaissance.",
          cover: "Couverture · Strictement confidentiel — ne pas diffuser", confidential: "Strictement confidentiel",
          translationNoticeTitle: "Avis de traduction",
          translationNoticeBody: "Cette traduction est fournie à titre de courtoisie. La version anglaise de ce document est le texte juridiquement contraignant.",
          sealedMark: "SCELLÉ", contentsLabel: "Sommaire",
          ibccfAuthority: "Partie Émettrice Autorisée", ibccfRole: "Division Internationale d'Application",
        },
        de: {
          particulars: "Parteien und Angaben", acknowledgement: "Bestätigung",
          signature: "Unterschriften", previewNote: "NUR VORSCHAU — noch nicht unterzeichnet. Reichen Sie die getippte Namensunterschrift im Portal ein, um diese Bestätigung zu versiegeln.",
          cover: "Deckblatt · Streng vertraulich — nicht weitergeben", confidential: "Streng vertraulich",
          translationNoticeTitle: "Übersetzungshinweis",
          translationNoticeBody: "Diese Übersetzung wird aus Gefälligkeit bereitgestellt. Die englische Fassung dieses Dokuments ist der rechtlich maßgebliche Text.",
          sealedMark: "VERSIEGELT", contentsLabel: "Inhalt",
          ibccfAuthority: "Autorisierte Ausstellende Partei", ibccfRole: "Internationale Vollzugsabteilung",
        },
        pt: {
          particulars: "Partes e dados", acknowledgement: "Reconhecimento",
          signature: "Assinaturas", previewNote: "APENAS PRÉ-VISUALIZAÇÃO — ainda não assinado. Submeta a assinatura escrita no portal para selar este reconhecimento.",
          cover: "Capa · Estritamente confidencial — não distribuir", confidential: "Estritamente confidencial",
          translationNoticeTitle: "Aviso de tradução",
          translationNoticeBody: "Esta tradução é fornecida por cortesia. A versão em inglês deste documento é o texto juridicamente vinculativo.",
          sealedMark: "SELADO", contentsLabel: "Conteúdo",
          ibccfAuthority: "Parte Emissora Autorizada", ibccfRole: "Divisão Internacional de Aplicação",
        },
        zh: {
          particulars: "当事人与基本信息", acknowledgement: "确认",
          signature: "签署方", previewNote: "仅供预览 — 尚未签署。请在门户中提交输入式姓名签名以封存本承诺。",
          cover: "封面 · 严格保密 — 请勿分发", confidential: "严格保密",
          translationNoticeTitle: "翻译说明",
          translationNoticeBody: "本翻译仅供参考。本文件的英文版本为具有法律效力的正式文本。",
          sealedMark: "已封存", contentsLabel: "目录",
          ibccfAuthority: "授权签发方", ibccfRole: "国际执法部",
        },
      };
      const localLabels = labelsByLocale[rendered.locale] ?? labelsByLocale.en;

      const showTranslationDisclaimer =
        !signature && rendered.locale !== "en" && !NDA_TRANSLATIONS_REVIEWED;

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const GOLD = "#c8a951";
      const GOLD_DEEP = "#a8862e";
      const NAVY = "#0a1840";
      const BODY = "#1a2233";
      const MUTED = "#6b7385";
      const HAIRLINE = "#d8d2bc";
      const PANEL_BG = "#faf7eb";
      const PANEL_BORDER = "#e6dfc4";
      const PAGE_W = doc.page.width;
      const PAGE_H = doc.page.height;
      const CONTENT_W = PAGE_W - 2 * M;

      const drawWatermark = () => {
        const sx = doc.x, sy = doc.y;
        doc.save();
        doc.fillOpacity(0.04);
        doc.fillColor(NAVY);
        doc.font(pair.bold).fontSize(40);
        doc.translate(PAGE_W / 2, PAGE_H / 2);
        doc.rotate(-30);
        const wm = "IBCCF · CONFIDENTIAL";
        const tw = doc.widthOfString(wm);
        doc.text(wm, -tw / 2, -20, { lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
        doc.x = sx; doc.y = sy;
      };

      let isBodyPhase = false;
      doc.on("pageAdded", () => {
        if (!isBodyPhase) return;
        drawWatermark();
        doc.x = M;
        doc.y = TOP_MARGIN;
      });

      // ============================================================
      // COVER PAGE
      // ============================================================

      doc.save();
      doc.rect(0, 0, PAGE_W, 10).fill(GOLD);
      doc.rect(0, 10, PAGE_W, 0.6).fill(GOLD_DEEP);
      doc.rect(0, PAGE_H - 10, PAGE_W, 10).fill(GOLD);
      doc.rect(0, PAGE_H - 10.6, PAGE_W, 0.6).fill(GOLD_DEEP);
      doc.restore();

      // Classification chip (top right).
      const chipH = 18;
      const chipY = 26;
      const chipText = localLabels.confidential.toUpperCase();
      doc.font(pair.bold).fontSize(8);
      const chipTextW = doc.widthOfString(chipText, { characterSpacing: 1.4 });
      const chipW = chipTextW + 22;
      const chipX = PAGE_W - M - chipW;
      doc.save();
      doc.rect(chipX, chipY, chipW, chipH).fill(NAVY);
      doc.restore();
      doc.fillColor(GOLD).font(pair.bold).fontSize(8);
      doc.text(chipText, chipX, chipY + 5, {
        width: chipW, align: "center", lineBreak: false, characterSpacing: 1.4,
      });

      // Case-ref chip (top left).
      const caseShort = (rendered.partyBlock[0]?.value ?? "").slice(0, 8).toUpperCase();
      const refText = `REF · ${caseShort}`;
      doc.font(pair.bold).fontSize(8);
      const refTextW = doc.widthOfString(refText, { characterSpacing: 1.4 });
      const refW = refTextW + 22;
      doc.save();
      doc.lineWidth(0.8).strokeColor(NAVY).fillColor("#ffffff");
      doc.rect(M, chipY, refW, chipH).fillAndStroke("#ffffff", NAVY);
      doc.restore();
      doc.fillColor(NAVY).font(pair.bold).fontSize(8);
      doc.text(refText, M, chipY + 5, {
        width: refW, align: "center", lineBreak: false, characterSpacing: 1.4,
      });

      // Template version strip (top center, small).
      const verText = `Template ${rendered.templateVersion}`;
      doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
      doc.text(verText, M, chipY + 5, {
        width: CONTENT_W, align: "center", lineBreak: false, characterSpacing: 0.5,
      });

      let topY = chipY + chipH + 14;
      if (showTranslationDisclaimer) {
        const bannerX = M, bannerY = topY, bannerW = CONTENT_W, bannerH = 54;
        doc.save();
        doc.lineWidth(0.8).strokeColor("#b8860b")
          .rect(bannerX, bannerY, bannerW, bannerH).fillAndStroke("#fff8e1", "#b8860b");
        doc.rect(bannerX, bannerY, 3, bannerH).fill("#b8860b");
        doc.restore();
        doc.fillColor("#7a5a00").font(pair.bold).fontSize(9);
        doc.text(localLabels.translationNoticeTitle, bannerX + 12, bannerY + 8, {
          width: bannerW - 24, lineBreak: false, characterSpacing: 0.4,
        });
        doc.fillColor("#5a4400").font(pair.regular).fontSize(8.5);
        doc.text(localLabels.translationNoticeBody, bannerX + 12, bannerY + 22, {
          width: bannerW - 24, lineGap: 1.5,
        });
        topY = bannerY + bannerH + 18;
      }

      // Vector crest.
      const crestCx = PAGE_W / 2;
      const crestCy = topY + 52;
      const crestR = 34;
      doc.save();
      doc.lineWidth(1.6).strokeColor(GOLD).fillColor(NAVY);
      doc.circle(crestCx, crestCy, crestR).fillAndStroke();
      doc.strokeColor(GOLD).lineWidth(0.8);
      doc.moveTo(crestCx - crestR + 3, crestCy).lineTo(crestCx + crestR - 3, crestCy).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.45, crestR * 0.95).stroke();
      doc.ellipse(crestCx, crestCy, crestR * 0.85, crestR * 0.55).stroke();
      doc.fillColor(GOLD).circle(crestCx, crestCy, 2.4).fill();
      doc.restore();

      // Wordmark.
      doc.fillColor(GOLD).font(pair.bold).fontSize(30);
      doc.text("IBCCF", M, crestCy + crestR + 18, {
        width: CONTENT_W, align: "center", lineBreak: false, characterSpacing: 6,
      });

      // Subtitle.
      doc.fillColor(MUTED).font(pair.regular).fontSize(9);
      doc.text(rendered.subtitle, M, crestCy + crestR + 62, {
        width: CONTENT_W, align: "center",
      });

      // Gold rule.
      const ruleY1 = crestCy + crestR + 98;
      doc.save();
      doc.rect(PAGE_W / 2 - 60, ruleY1, 120, 1.4).fill(GOLD);
      doc.restore();

      // Title.
      doc.fillColor(NAVY).font(pair.bold).fontSize(18);
      doc.text(rendered.title, M, ruleY1 + 18, {
        width: CONTENT_W, align: "center", lineGap: 3,
      });

      // Effective date.
      doc.fillColor(MUTED).font(pair.regular).fontSize(9);
      doc.text(rendered.effectiveDateLabel, M, doc.y + 10, {
        width: CONTENT_W, align: "center", characterSpacing: 0.5,
      });

      // ── Parties & Particulars panel ──
      const panelY = doc.y + 22;
      const rowH = 24;
      const panelH = 42 + rendered.partyBlock.length * rowH + 6;
      doc.save();
      doc.rect(M + 4, panelY, CONTENT_W - 4, panelH).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.rect(M, panelY, 4, panelH).fill(GOLD);
      doc.restore();
      doc.fillColor(NAVY).font(pair.bold).fontSize(9);
      doc.text(localLabels.particulars.toUpperCase(), M + 18, panelY + 12, {
        width: CONTENT_W - 36, lineBreak: false, characterSpacing: 1.2,
      });
      doc.save();
      doc.rect(M + 18, panelY + 26, 28, 1).fill(GOLD);
      doc.restore();
      let ry = panelY + 38;
      for (let i = 0; i < rendered.partyBlock.length; i++) {
        const row = rendered.partyBlock[i];
        doc.fillColor(MUTED).font(pair.regular).fontSize(7);
        doc.text(row.label.toUpperCase(), M + 18, ry, {
          width: 154, lineBreak: false, characterSpacing: 1,
        });
        doc.fillColor(BODY).font(pair.bold).fontSize(9.5);
        doc.text(row.value, M + 175, ry - 1, {
          width: CONTENT_W - 193, lineBreak: false, ellipsis: true,
        });
        if (i < rendered.partyBlock.length - 1) {
          doc.save();
          doc.rect(M + 18, ry + 14, CONTENT_W - 36, 0.4).fill(HAIRLINE);
          doc.restore();
        }
        ry += rowH;
      }

      // ── Contents panel (SA-style TOC) ──
      const contentsTopY = panelY + panelH + 14;
      const sectionHeadings = rendered.sections.map((s) => s.heading.replace(/^\s*\d+\.\s*/, "").trim());
      const half = Math.ceil(sectionHeadings.length / 2);
      const leftCol = sectionHeadings.slice(0, half);
      const rightCol = sectionHeadings.slice(half);
      const tocRowH = 16;
      const tocPanelH = 36 + Math.max(leftCol.length, rightCol.length) * tocRowH + 6;
      doc.save();
      doc.rect(M + 4, contentsTopY, CONTENT_W - 4, tocPanelH).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.rect(M, contentsTopY, 4, tocPanelH).fill(GOLD);
      doc.restore();
      doc.fillColor(NAVY).font(pair.bold).fontSize(9);
      doc.text(localLabels.contentsLabel.toUpperCase(), M + 18, contentsTopY + 12, {
        width: CONTENT_W - 36, lineBreak: false, characterSpacing: 1.2,
      });
      doc.save();
      doc.rect(M + 18, contentsTopY + 26, 28, 1).fill(GOLD);
      doc.restore();
      const colW = (CONTENT_W - 36) / 2;
      let tocRowY = contentsTopY + 34;
      for (let i = 0; i < Math.max(leftCol.length, rightCol.length); i++) {
        if (leftCol[i]) {
          const num = String(i + 1);
          doc.fillColor(GOLD).font(pair.bold).fontSize(8);
          doc.text(num, M + 18, tocRowY, { width: 14, lineBreak: false });
          doc.fillColor(MUTED).font(pair.regular).fontSize(8);
          doc.text(leftCol[i], M + 34, tocRowY, { width: colW - 18, lineBreak: false, ellipsis: true });
        }
        if (rightCol[i]) {
          const num = String(half + i + 1);
          doc.fillColor(GOLD).font(pair.bold).fontSize(8);
          doc.text(num, M + 18 + colW, tocRowY, { width: 14, lineBreak: false });
          doc.fillColor(MUTED).font(pair.regular).fontSize(8);
          doc.text(rightCol[i], M + 34 + colW, tocRowY, { width: colW - 18, lineBreak: false, ellipsis: true });
        }
        tocRowY += tocRowH;
      }

      // Cover footer.
      doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
      doc.text(localLabels.cover, M, PAGE_H - 34, {
        width: CONTENT_W, align: "center", characterSpacing: 0.6,
      });

      // ============================================================
      // BODY PAGES
      // ============================================================

      isBodyPhase = true;
      doc.addPage();

      // Recitals with gold left rule.
      const recitalsStartY = doc.y;
      for (const r of rendered.recitals) {
        doc.fillColor(BODY).font(italicFont).fontSize(10);
        doc.text(r, M + 14, doc.y, {
          width: CONTENT_W - 14, align: "justify", lineGap: 2.5,
        });
        doc.moveDown(0.4);
      }
      const recitalsEndY = doc.y;
      doc.save();
      doc.rect(M, recitalsStartY, 2, recitalsEndY - recitalsStartY - 4).fill(GOLD);
      doc.restore();
      doc.moveDown(0.5);

      // Numbered sections with gold badge + heading.
      let sectionNum = 0;
      for (const section of rendered.sections) {
        sectionNum++;
        if (doc.y > PAGE_H - 110 - 90) doc.addPage();
        const headY = doc.y;
        const badgeSize = 18;
        doc.save();
        doc.rect(M, headY - 2, badgeSize, badgeSize).fill(GOLD);
        doc.restore();
        doc.fillColor("#ffffff").font(pair.bold).fontSize(10);
        doc.text(String(sectionNum), M, headY + 2, {
          width: badgeSize, align: "center", lineBreak: false,
        });
        const headingText = section.heading.replace(/^\s*\d+\.\s*/, "");
        doc.fillColor(NAVY).font(pair.bold).fontSize(12);
        doc.text(headingText, M + badgeSize + 10, headY, {
          width: CONTENT_W - badgeSize - 10, lineBreak: false, ellipsis: true,
        });
        const ruleY = headY + badgeSize + 4;
        doc.save();
        doc.rect(M, ruleY, 40, 1.2).fill(GOLD);
        doc.restore();
        doc.y = ruleY + 12;
        for (const p of section.paragraphs) {
          doc.fillColor(BODY).font(pair.regular).fontSize(10);
          doc.text(p, M, doc.y, {
            width: CONTENT_W, align: "justify", lineGap: 2.5,
          });
          doc.moveDown(0.4);
        }
        doc.moveDown(0.5);
      }

      // ── Acknowledgement ──
      if (doc.y > PAGE_H - 110 - 100) doc.addPage();
      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.acknowledgement.toUpperCase(), M, doc.y, {
        width: CONTENT_W, characterSpacing: 1.2,
      });
      const ackRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, ackRuleY, 40, 1.2).fill(GOLD);
      doc.restore();
      doc.y = ackRuleY + 12;

      // Render the acknowledgement: split on \n\n so numbered items
      // (1)…(4) each get their own hanging-indent paragraph.
      const ackParts = rendered.acknowledgement.split(/\n\n+/);
      for (const part of ackParts) {
        const isNumbered = /^\s*[(（][1-9][)）]/.test(part);
        if (isNumbered) {
          doc.fillColor(BODY).font(pair.bold).fontSize(10);
          doc.text(part, M + 14, doc.y, {
            width: CONTENT_W - 14, align: "justify", lineGap: 2.5,
          });
        } else {
          doc.fillColor(BODY).font(pair.regular).fontSize(10);
          doc.text(part, M, doc.y, {
            width: CONTENT_W, align: "justify", lineGap: 2.5,
          });
        }
        doc.moveDown(0.5);
      }
      doc.moveDown(0.5);

      // ── Dual-party Signature Block ──
      const sigPanelH = signature ? 190 : 130;
      if (doc.y > PAGE_H - 110 - sigPanelH - 40) doc.addPage();

      doc.fillColor(NAVY).font(pair.bold).fontSize(11);
      doc.text(localLabels.signature.toUpperCase(), M, doc.y, {
        width: CONTENT_W, characterSpacing: 1.2,
      });
      const sigHeadRuleY = doc.y + 2;
      doc.save();
      doc.rect(M, sigHeadRuleY, 40, 1.2).fill(GOLD);
      doc.restore();
      doc.y = sigHeadRuleY + 14;

      const sigBoxY = doc.y;
      const halfW = (CONTENT_W - 4) / 2;

      // Left panel (IBCCF).
      doc.save();
      doc.lineWidth(1).strokeColor(PANEL_BORDER);
      doc.rect(M + 4, sigBoxY, halfW - 4, sigPanelH).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.rect(M, sigBoxY, 4, sigPanelH).fill(GOLD);
      doc.restore();

      // Right panel (Recipient).
      doc.save();
      doc.lineWidth(1).strokeColor(PANEL_BORDER);
      doc.rect(M + 4 + halfW, sigBoxY, halfW - 4, sigPanelH).fillAndStroke("#ffffff", PANEL_BORDER);
      doc.rect(M + halfW, sigBoxY, 4, sigPanelH).fill(GOLD);
      doc.restore();

      // Divider line between panels.
      doc.save();
      doc.lineWidth(0.6).strokeColor(HAIRLINE);
      doc.moveTo(M + halfW + 2, sigBoxY + 10).lineTo(M + halfW + 2, sigBoxY + sigPanelH - 10).stroke();
      doc.restore();

      const labels = rendered.signatureBlockLabels;

      // Left column — IBCCF pre-authorized header.
      const leftX = M + 20;
      let leftY = sigBoxY + 14;
      const colFieldW = halfW - 42;

      doc.fillColor(MUTED).font(pair.regular).fontSize(7);
      doc.text(labels.ibccfParty.toUpperCase(), leftX, leftY, {
        width: colFieldW, lineBreak: false, characterSpacing: 0.8,
      });
      leftY += 14;
      doc.fillColor(NAVY).font(pair.bold).fontSize(10);
      doc.text(localLabels.ibccfAuthority, leftX, leftY, { width: colFieldW });
      leftY = doc.y + 6;
      doc.fillColor(MUTED).font(pair.regular).fontSize(8);
      doc.text(localLabels.ibccfRole, leftX, leftY, { width: colFieldW });
      leftY = doc.y + 10;

      // Pre-authorized signature line.
      doc.save();
      doc.rect(leftX, leftY, colFieldW, 0.8).fill(GOLD_DEEP);
      doc.restore();
      leftY += 6;
      doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
      doc.text("Authorized for Issue — IBCCF IED", leftX, leftY, {
        width: colFieldW, lineBreak: false,
      });

      if (signature) {
        leftY += 18;
        doc.fillColor(MUTED).font(pair.regular).fontSize(7);
        doc.text("DATE (UTC)".toUpperCase(), leftX, leftY, {
          width: 60, lineBreak: false, characterSpacing: 0.8,
        });
        doc.fillColor(BODY).font(pair.bold).fontSize(9);
        doc.text(signature.signedAt.toISOString().slice(0, 10), leftX + 68, leftY - 1, {
          width: colFieldW - 68, lineBreak: false,
        });
      }

      // Wax-seal stamp on the right gutter of the left panel.
      const sealCx = M + halfW - 30;
      const sealCy = sigBoxY + sigPanelH / 2;
      const sealR = 22;
      doc.save();
      doc.lineWidth(1).strokeColor(GOLD_DEEP)
        .fillOpacity(signature ? 0.14 : 0.07).fillColor(GOLD);
      doc.circle(sealCx, sealCy, sealR).fillAndStroke();
      doc.fillOpacity(1);
      doc.lineWidth(0.5).strokeColor(GOLD_DEEP);
      doc.circle(sealCx, sealCy, sealR - 3).stroke();
      doc.restore();
      doc.fillColor(GOLD_DEEP).font(pair.bold).fontSize(7);
      const sealText = signature ? localLabels.sealedMark : "PREVIEW";
      doc.text(sealText, sealCx - sealR, sealCy - 4, {
        width: sealR * 2, align: "center", lineBreak: false, characterSpacing: 1.2,
      });

      // Right column — Recipient digital signature.
      const rightX = M + halfW + 20;
      let rightY = sigBoxY + 14;

      doc.fillColor(MUTED).font(pair.regular).fontSize(7);
      doc.text(labels.recipientParty.toUpperCase(), rightX, rightY, {
        width: colFieldW, lineBreak: false, characterSpacing: 0.8,
      });
      rightY += 14;

      if (signature) {
        const rows: Array<[string, string]> = [
          [labels.typedName, signature.signedName],
          [labels.date, signature.signedAt.toISOString()],
          [labels.ip, signature.signedIp ?? "Not recorded"],
          [labels.integrityHash, "—"],
        ];
        for (const [k, v] of rows) {
          doc.fillColor(MUTED).font(pair.regular).fontSize(7);
          doc.text(k.toUpperCase(), rightX, rightY, {
            width: 100, lineBreak: false, characterSpacing: 0.8,
          });
          doc.fillColor(BODY).font(pair.bold).fontSize(9);
          doc.text(v, rightX + 106, rightY - 1, {
            width: colFieldW - 106, lineBreak: false, ellipsis: true,
          });
          rightY += 22;
        }
      } else {
        doc.fillColor(BODY).font(pair.regular).fontSize(9.5);
        doc.text(`${labels.typedName}: ________________________`, rightX, rightY, {
          width: colFieldW, lineBreak: false,
        });
        rightY += 24;
        doc.text(`${labels.date}: ________________________`, rightX, rightY, {
          width: colFieldW, lineBreak: false,
        });
        rightY += 22;
        doc.fillColor(MUTED).font(pair.regular).fontSize(7.5);
        doc.text(localLabels.previewNote, rightX, rightY, {
          width: colFieldW, lineGap: 1.5,
        });
      }

      // Evidentiary note below both panels.
      if (signature) {
        const noteY = sigBoxY + sigPanelH + 8;
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(labels.note, M + 4, noteY, { width: CONTENT_W - 8, lineGap: 1.5 });
      }

      // ============================================================
      // LETTERHEAD HEADER + FOOTER on every body page
      // ============================================================

      const range = doc.bufferedPageRange();
      const total = range.count;
      const bodyTotal = total - 1;
      for (let i = 1; i < total; i++) {
        doc.switchToPage(i);
        const pageNum = i;

        const headerY = 32;
        doc.fillColor(NAVY).font(pair.bold).fontSize(8.5);
        doc.text("IBCCF", M, headerY, {
          width: CONTENT_W / 2, lineBreak: false, characterSpacing: 1.6,
        });
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Template ${rendered.templateVersion}  ·  Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W / 2, headerY + 1,
          { width: CONTENT_W / 2, align: "right", lineBreak: false },
        );
        doc.save();
        doc.rect(M, headerY + 14, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();

        const footerLineY = PAGE_H - 44;
        const footerTextY = footerLineY + 8;
        doc.save();
        doc.rect(M, footerLineY, CONTENT_W, 0.6).fill(GOLD);
        doc.restore();
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `${rendered.effectiveDateLabel}  ·  ${localLabels.confidential}`,
          M, footerTextY,
          { width: CONTENT_W * 0.72, lineBreak: false },
        );
        doc.fillColor(MUTED).font(pair.regular).fontSize(8);
        doc.text(
          `Page ${pageNum} of ${bodyTotal}`,
          M + CONTENT_W * 0.72, footerTextY,
          { width: CONTENT_W * 0.28, align: "right", lineBreak: false },
        );
      }

      doc.flushPages();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Legacy single-page renderer for snapshots sealed under v1.2026.05.
// Kept verbatim so any future re-render of a v1.2026.05 snapshot
// produces the same bytes (and therefore the same SHA-256) it did at
// sign time. Do NOT modify — version-bump and add a new function if
// behaviour needs to change.
function buildNdaPdfV1_2026_05(
  rendered: NdaRendered,
  signature?: NdaSignatureMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pinnedDate = signature?.signedAt ?? new Date(0);
      const doc = new PDFDocument({
        size: "A4",
        margin: 56,
        info: {
          Title: rendered.title,
          Author: "IBCCF International Enforcement Division",
          Subject: `Settlement Acknowledgement — ${rendered.templateVersion}`,
          Producer: "IBCCF NDA Generator",
          Creator: "IBCCF NDA Generator",
          CreationDate: pinnedDate,
          ModDate: pinnedDate,
        },
      });

      const pair = fontPairFor(rendered.locale);
      if (pair.regularBytes) doc.registerFont(pair.regular, pair.regularBytes);
      if (pair.boldBytes) doc.registerFont(pair.bold, pair.boldBytes);
      const labelsByLocale: Record<NdaLocale, { particulars: string; acknowledgement: string; signature: string; previewNote: string }> = {
        en: { particulars: "Parties & Particulars", acknowledgement: "Acknowledgement", signature: "Signature", previewNote: "PREVIEW ONLY — not yet signed. Submit the typed-name signature inside your portal to seal this acknowledgement." },
        es: { particulars: "Partes y datos", acknowledgement: "Reconocimiento", signature: "Firma", previewNote: "SÓLO VISTA PREVIA — aún no firmado. Envíe la firma con su nombre escrito en el portal para sellar este reconocimiento." },
        fr: { particulars: "Parties et informations", acknowledgement: "Reconnaissance", signature: "Signature", previewNote: "APERÇU UNIQUEMENT — non encore signé. Soumettez la signature dactylographiée dans votre portail pour sceller cette reconnaissance." },
        de: { particulars: "Parteien und Angaben", acknowledgement: "Bestätigung", signature: "Unterschrift", previewNote: "NUR VORSCHAU — noch nicht unterzeichnet. Reichen Sie die getippte Namensunterschrift im Portal ein, um diese Bestätigung zu versiegeln." },
        pt: { particulars: "Partes e dados", acknowledgement: "Reconhecimento", signature: "Assinatura", previewNote: "APENAS PRÉ-VISUALIZAÇÃO — ainda não assinado. Submeta a assinatura escrita no portal para selar este reconhecimento." },
        zh: { particulars: "当事人与基本信息", acknowledgement: "确认", signature: "签署", previewNote: "仅供预览 — 尚未签署。请在门户中提交输入式姓名签名以封存本承诺。" },
      };
      const localLabels = labelsByLocale[rendered.locale] ?? labelsByLocale.en;

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc
        .font(pair.bold)
        .fontSize(16)
        .fillColor("#0a1840")
        .text(rendered.title, { align: "center" });
      doc.moveDown(0.3);
      doc
        .font(pair.regular)
        .fontSize(10)
        .fillColor("#3a4356")
        .text(rendered.subtitle, { align: "center" });
      doc.moveDown(0.2);
      doc
        .fontSize(9)
        .fillColor("#6b7385")
        .text(`Template ${rendered.templateVersion} · ${rendered.effectiveDateLabel}`, {
          align: "center",
        });
      doc.moveDown(1);

      doc.fillColor("#0a1840").fontSize(11).font(pair.bold).text(localLabels.particulars);
      doc.moveDown(0.3);
      doc.font(pair.regular).fontSize(10).fillColor("#1a2233");
      for (const row of rendered.partyBlock) {
        doc.font(pair.bold).text(`${row.label}: `, { continued: true });
        doc.font(pair.regular).text(row.value);
      }
      doc.moveDown(0.8);

      for (const r of rendered.recitals) {
        doc.font(pair.regular).fontSize(10).fillColor("#1a2233").text(r, { align: "justify" });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);

      for (const section of rendered.sections) {
        doc
          .font(pair.bold)
          .fontSize(11)
          .fillColor("#0a1840")
          .text(section.heading);
        doc.moveDown(0.2);
        for (const p of section.paragraphs) {
          doc
            .font(pair.regular)
            .fontSize(10)
            .fillColor("#1a2233")
            .text(p, { align: "justify" });
          doc.moveDown(0.3);
        }
        doc.moveDown(0.3);
      }

      doc.moveDown(0.5);
      doc
        .font(pair.bold)
        .fontSize(10)
        .fillColor("#0a1840")
        .text(localLabels.acknowledgement);
      doc.moveDown(0.2);
      doc
        .font(pair.regular)
        .fontSize(10)
        .fillColor("#1a2233")
        .text(rendered.acknowledgement, { align: "justify" });
      doc.moveDown(0.6);

      doc
        .font(pair.bold)
        .fontSize(10)
        .fillColor("#0a1840")
        .text(localLabels.signature);
      doc.moveDown(0.2);
      const labels = rendered.signatureBlockLabels;
      doc.font(pair.regular).fontSize(10).fillColor("#1a2233");

      if (signature) {
        const sigLines: Array<[string, string]> = [
          [labels.typedName, signature.signedName],
          [labels.date, signature.signedAt.toISOString()],
          [labels.ip, signature.signedIp ?? "Not recorded"],
        ];
        for (const [k, v] of sigLines) {
          doc.font("Helvetica-Bold").text(`${k}: `, { continued: true });
          doc.font("Helvetica").text(v);
        }
        doc.moveDown(0.4);
        doc
          .fontSize(8)
          .fillColor("#6b7385")
          .text(labels.note, { align: "left" });
      } else {
        doc.text(`${labels.typedName}: ___________________________________`);
        doc.text(`${labels.date}: ___________________________________`);
        doc.moveDown(0.3);
        doc
          .fontSize(8)
          .fillColor("#6b7385")
          .text(localLabels.previewNote);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export { NDA_TEMPLATE_VERSION };
