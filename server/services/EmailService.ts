import nodemailer from 'nodemailer';
import { getStageInstruction } from '../../shared/stageInstructions';
import { tFor, type ServerLocale } from './i18n';
import { getPublicBaseUrl } from '../lib/publicBaseUrl';

// Locale-input alias accepted by every public EmailService method.
// Callers may pass `req.userLocale` (a normalized ServerLocale), a raw
// BCP-47 string from a header, undefined, or null. `tFor()` normalizes
// the value internally, so the type stays loose at the boundary.
type LocaleInput = ServerLocale | string | null | undefined;

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.zoho.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || 'info@ibccf.site';
const SMTP_FROM_NAME =
  process.env.SMTP_FROM_NAME || 'IBCCF International Enforcement Division';
const SMTP_FROM_ADDRESS = process.env.SMTP_FROM_ADDRESS || SMTP_USER;
const SMTP_REPLY_TO = process.env.SMTP_REPLY_TO || SMTP_USER;

const BRAND_NAME = 'IBCCF';
const BRAND_TAGLINE = 'International Enforcement Division';
const BRAND_FULL_NAME = 'International Blockchain Community Complaints Forum';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getBaseUrl(): string {
  // See server/lib/publicBaseUrl.ts for the full precedence chain
  // (PUBLIC_BASE_URL > APP_BASE_URL > REPLIT_DOMAINS > REPLIT_DEV_DOMAIN >
  // canonical fallback). Kept as a thin wrapper here so existing call sites
  // in this file don't need to change.
  return getPublicBaseUrl();
}

/* ------------------------------------------------------------------ */
/*  Premium branded shell                                              */
/* ------------------------------------------------------------------ */

interface ShellOptions {
  preheader: string;
  greeting: string;
  intro: string;
  bodyHtml?: string;
  cta?: { label: string; href: string };
  ctaSecondaryHtml?: string;
  signoff?: string;
  footerNote?: string;
}

function renderPremiumShell(opts: ShellOptions): string {
  const year = new Date().getFullYear();
  const ctaBlock = opts.cta
    ? `
        <tr><td style="padding:8px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
            <tr><td align="center" bgcolor="#1e3a8a" style="background-color:#1e3a8a;background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);border-radius:10px;box-shadow:0 8px 20px rgba(30,58,138,0.32);">
              <a href="${escapeHtml(opts.cta.href)}" style="display:inline-block;padding:14px 38px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;letter-spacing:0.4px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(opts.cta.label)}</a>
            </td></tr>
          </table>
        </td></tr>
        ${opts.ctaSecondaryHtml ? `<tr><td style="padding:6px 36px 0;">${opts.ctaSecondaryHtml}</td></tr>` : ''}
        `
    : '';

  const signoffBlock = opts.signoff
    ? `<tr><td style="padding:24px 36px 0;font-size:14px;color:#3a4356;line-height:1.7;font-family:'Helvetica Neue',Arial,sans-serif;">${opts.signoff}</td></tr>`
    : '';

  const footerNoteBlock = opts.footerNote
    ? `<tr><td style="padding:18px 36px 0;font-size:12px;color:#6b7385;line-height:1.6;font-family:'Helvetica Neue',Arial,sans-serif;">${opts.footerNote}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(BRAND_NAME)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a2233;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#eef2f7;">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(10,24,64,0.10);border:1px solid rgba(10,24,64,0.06);">

        <tr><td style="height:4px;background:linear-gradient(90deg,#c8a951 0%,#e8d28a 50%,#c8a951 100%);line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="background:linear-gradient(135deg,#0a1840 0%,#15296b 100%);padding:36px 32px;text-align:center;">
          <div style="display:inline-block;width:58px;height:58px;border-radius:14px;background:linear-gradient(135deg,#1e3a8a,#2563eb);box-shadow:0 8px 22px rgba(0,0,0,0.28);margin-bottom:16px;text-align:center;">
            <div style="font-size:32px;line-height:58px;color:#ffffff;font-weight:700;">⚖</div>
          </div>
          <div style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:8px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(BRAND_NAME)}</div>
          <div style="color:#c8a951;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-top:10px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(BRAND_TAGLINE)}</div>
        </td></tr>

        <tr><td style="padding:36px 36px 8px 36px;">
          <h1 style="margin:0 0 16px;font-size:18px;color:#0a1840;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif;">${opts.greeting}</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#3a4356;font-family:'Helvetica Neue',Arial,sans-serif;">${opts.intro}</p>
          ${opts.bodyHtml || ''}
        </td></tr>

        ${ctaBlock}

        ${signoffBlock}

        ${footerNoteBlock}

        <tr><td style="padding:30px 36px 0;">
          <div style="height:1px;background:linear-gradient(90deg,rgba(200,169,81,0) 0%,rgba(200,169,81,0.5) 50%,rgba(200,169,81,0) 100%);"></div>
        </td></tr>

        <tr><td style="padding:18px 36px 30px;text-align:center;">
          <div style="font-size:11px;color:#6b7385;line-height:1.65;font-family:'Helvetica Neue',Arial,sans-serif;">
            This communication is issued by the ${escapeHtml(BRAND_NAME)} ${escapeHtml(BRAND_TAGLINE)} and is intended only for the named recipient. If you received this in error, please disregard.
          </div>
        </td></tr>

        <tr><td style="background:#0a1840;padding:22px 32px;text-align:center;">
          <div style="font-size:11px;color:#9ca8c2;letter-spacing:0.4px;font-family:'Helvetica Neue',Arial,sans-serif;">© ${year} ${escapeHtml(BRAND_NAME)} — ${escapeHtml(BRAND_FULL_NAME)}</div>
          <div style="font-size:10px;color:#7180a0;margin-top:6px;font-family:'Helvetica Neue',Arial,sans-serif;">Operating under international cooperation frameworks · ${escapeHtml(SMTP_FROM_ADDRESS)}</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Reusable content blocks                                            */
/* ------------------------------------------------------------------ */

function infoCard(label: string, value: string, mono = false): string {
  return `
    <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:18px 22px;margin:18px 0;text-align:center;">
      <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:8px;">${escapeHtml(label)}</div>
      <div style="font-size:${mono ? '24px' : '20px'};font-weight:700;color:#0a1840;${mono ? "font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:3px;" : ''}">${escapeHtml(value)}</div>
    </div>`;
}

function quoteBlock(content: string): string {
  return `
    <div style="background:#f8faff;border-left:4px solid #1e3a8a;border-radius:0 8px 8px 0;padding:14px 18px;margin:18px 0;">
      <p style="margin:0;color:#1a2233;font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(content)}</p>
    </div>`;
}

function copyLinkLine(href: string, locale?: LocaleInput): string {
  const prefix = tFor(locale ?? 'en')('emails', 'common.copyLinkPrefix');
  return `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(prefix)} <span style="color:#1e3a8a;">${escapeHtml(href)}</span></p>`;
}

/* ------------------------------------------------------------------ */
/*  EmailService                                                       */
/* ------------------------------------------------------------------ */

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const password =
        process.env.SMTP_PASSWORD || process.env.ZOHO_SMTP_PASSWORD;

      if (!password) {
        throw new Error(
          'SMTP_PASSWORD environment variable is not set. ' +
            'Configure your mailbox password as a secret to enable email sending.',
        );
      }

      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: password,
        },
      });
    }
    return this.transporter;
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
    logTag: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = this.getTransporter();

      // Derive the sending domain so Message-ID and List-Unsubscribe are
      // properly aligned with the From address — large mailbox providers
      // (Gmail, Outlook, Yahoo) downrank or spam-folder messages whose
      // Message-ID domain does not match the From domain.
      const fromDomain =
        (SMTP_FROM_ADDRESS.split('@')[1] || 'ibccf.site').toLowerCase();
      const messageId = `<${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 12)}.${opts.logTag}@${fromDomain}>`;

      // RFC 2369 + RFC 8058 unsubscribe headers. Even for transactional
      // mail these substantially help inbox placement; Gmail in particular
      // boosts senders that include them. mailto: is the universally
      // supported channel for our small volume.
      const unsubMailto = `mailto:${SMTP_REPLY_TO}?subject=Unsubscribe`;

      await transporter.sendMail({
        from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_ADDRESS}>`,
        sender: SMTP_FROM_ADDRESS,
        replyTo: SMTP_REPLY_TO,
        // Align the SMTP envelope (Return-Path) with the From address so
        // SPF and DMARC alignment checks pass at the receiving server.
        envelope: {
          from: SMTP_FROM_ADDRESS,
          to: opts.to,
        },
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: htmlToPlainText(opts.html),
        messageId,
        headers: {
          'List-Unsubscribe': `<${unsubMailto}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'X-Entity-Ref-ID': opts.logTag,
        },
        attachments: (opts.attachments ?? []).map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType ?? 'application/octet-stream',
        })),
      });
      console.log(`[email] ${opts.logTag} → ${opts.to}`);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[email] ${opts.logTag} failed → ${opts.to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Public wrapper around the private SMTP transport for callers that
   * need to send a one-off case-scoped email without owning a dedicated
   * template (Task #55 ledger entries). Keeps the same logTag plumbing
   * + same SPF/DMARC alignment as every other transactional send.
   */
  async sendCustomCaseEmail(opts: {
    to: string;
    subject: string;
    html: string;
    logTag: string;
  }): Promise<{ success: boolean; error?: string }> {
    return this.send(opts);
  }

  async sendKeyRequestConfirmation(
    toEmail: string,
    userName: string,
    requestId: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const vars = { requestId, name: userName };
    const statusLink = `${getBaseUrl()}/request-access?tab=check&requestId=${encodeURIComponent(
      requestId,
    )}`;

    const html = renderPremiumShell({
      preheader: t('emails', 'keyRequestConfirmation.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'keyRequestConfirmation.intro', vars),
      bodyHtml: `
        ${infoCard(t('emails', 'keyRequestConfirmation.requestIdLabel'), requestId, true)}
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#3a4356;">
          <strong style="color:#0a1840;">${escapeHtml(t('emails', 'common.importantLabel'))}:</strong> ${escapeHtml(t('emails', 'keyRequestConfirmation.importantBody'))}
        </p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3a4356;">
          ${escapeHtml(t('emails', 'keyRequestConfirmation.verificationNote'))}
        </p>
      `,
      cta: { label: t('emails', 'keyRequestConfirmation.cta'), href: statusLink },
      ctaSecondaryHtml: copyLinkLine(statusLink, locale),
      signoff: t('emails', 'keyRequestConfirmation.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'keyRequestConfirmation.subject', vars),
      html,
      logTag: 'request-confirmation',
    });
    return r.success;
  }

  async sendKeyApprovalNotification(
    toEmail: string,
    userName: string,
    accessKey: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const html = renderPremiumShell({
      preheader: t('emails', 'keyApproval.preheader'),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'keyApproval.intro'),
      bodyHtml: `
        <div style="background:linear-gradient(135deg,#15803d 0%,#16a34a 100%);border-radius:12px;padding:26px 22px;margin:20px 0;text-align:center;box-shadow:0 10px 24px rgba(22,163,74,0.22);">
          <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;margin-bottom:10px;">${escapeHtml(t('emails', 'keyApproval.accessKeyLabel'))}</div>
          <div style="color:#ffffff;font-size:30px;font-weight:700;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:6px;">${escapeHtml(
            accessKey,
          )}</div>
        </div>
        <p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;"><strong style="color:#0a1840;">${escapeHtml(t('emails', 'common.sectionHowToAccess'))}</strong></p>
        <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
          <li>${escapeHtml(t('emails', 'keyApproval.step1'))}</li>
          <li>${escapeHtml(t('emails', 'keyApproval.step2'))}</li>
          <li>${escapeHtml(t('emails', 'keyApproval.step3'))}</li>
          <li>${escapeHtml(t('emails', 'keyApproval.step4'))}</li>
        </ol>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(t('emails', 'common.securityNoticeLabel'))}</strong> ${escapeHtml(t('emails', 'keyApproval.securityBody'))}</p>
        </div>
      `,
      signoff: t('emails', 'keyApproval.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'keyApproval.subject'),
      html,
      logTag: 'approval',
    });
    return r.success;
  }

  async sendVerificationQuestionnaire(
    toEmail: string,
    userName: string,
    bodyText: string,
  ): Promise<boolean> {
    const html = renderPremiumShell({
      preheader: `Action required: document submission for your IBCCF case — ${userName}`,
      greeting: `Dear ${escapeHtml(userName)},`,
      intro: 'Please review the verification requirements below and submit all requested documentation through your secure case portal.',
      bodyHtml: quoteBlock(bodyText),
      signoff: 'IBCCF Compliance Team<br>International Blockchain Complaints Forum',
    });

    const r = await this.send({
      to: toEmail,
      subject: 'IBCCF — Verification Documentation Required',
      html,
      logTag: 'verification-questionnaire',
    });
    return r.success;
  }

  async sendAccountReactivationNotification(
    toEmail: string,
    userName: string,
    accessKey: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const portalLink = `${getBaseUrl()}/`;
    const html = renderPremiumShell({
      preheader: t('emails', 'accountReactivation.preheader'),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName || 'there') }),
      intro: t('emails', 'accountReactivation.intro'),
      bodyHtml: `
        <div style="background:linear-gradient(135deg,#15803d 0%,#16a34a 100%);border-radius:12px;padding:26px 22px;margin:20px 0;text-align:center;box-shadow:0 10px 24px rgba(22,163,74,0.22);">
          <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;margin-bottom:10px;">${escapeHtml(t('emails', 'accountReactivation.accessCodeLabel'))}</div>
          <div style="color:#ffffff;font-size:30px;font-weight:700;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:6px;">${escapeHtml(
            accessKey,
          )}</div>
        </div>
        <p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;"><strong style="color:#0a1840;">${escapeHtml(t('emails', 'common.sectionHowToSignIn'))}</strong></p>
        <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
          <li>${escapeHtml(t('emails', 'accountReactivation.step1'))}</li>
          <li>${escapeHtml(t('emails', 'accountReactivation.step2'))}</li>
          <li>${escapeHtml(t('emails', 'accountReactivation.step3'))}</li>
        </ol>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(t('emails', 'common.securityNoticeLabel'))}</strong> ${escapeHtml(t('emails', 'accountReactivation.securityBody'))}</p>
        </div>
      `,
      cta: { label: t('emails', 'common.openSecurePortalCta'), href: portalLink },
      ctaSecondaryHtml: copyLinkLine(portalLink, locale),
      signoff: t('emails', 'accountReactivation.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'accountReactivation.subject'),
      html,
      logTag: 'reactivation',
    });
    return r.success;
  }

  async sendNewDeclarationCodeNotification(
    toEmail: string,
    userName: string,
    declarationCode: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const portalLink = `${getBaseUrl()}/`;
    const html = renderPremiumShell({
      preheader: t('emails', 'newDeclarationCode.preheader'),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName || 'there') }),
      intro: t('emails', 'newDeclarationCode.intro'),
      bodyHtml: `
        <div style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%);border-radius:12px;padding:26px 22px;margin:20px 0;text-align:center;box-shadow:0 10px 24px rgba(37,99,235,0.22);">
          <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;margin-bottom:10px;">${escapeHtml(t('emails', 'newDeclarationCode.accessCodeLabel'))}</div>
          <div style="color:#ffffff;font-size:30px;font-weight:700;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:6px;">${escapeHtml(
            declarationCode,
          )}</div>
        </div>
        <p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;"><strong style="color:#0a1840;">${escapeHtml(t('emails', 'common.sectionNextSteps'))}</strong></p>
        <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
          <li>${escapeHtml(t('emails', 'newDeclarationCode.step1'))}</li>
          <li>${escapeHtml(t('emails', 'newDeclarationCode.step2'))}</li>
          <li>${escapeHtml(t('emails', 'newDeclarationCode.step3'))}</li>
        </ol>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(t('emails', 'common.securityNoticeLabel'))}</strong> ${escapeHtml(t('emails', 'newDeclarationCode.securityBody'))}</p>
        </div>
      `,
      cta: { label: t('emails', 'common.openSecurePortalCta'), href: portalLink },
      ctaSecondaryHtml: copyLinkLine(portalLink, locale),
      signoff: t('emails', 'newDeclarationCode.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'newDeclarationCode.subject'),
      html,
      logTag: 'declaration-code',
    });
    return r.success;
  }

  async sendAdminMessageNotification(
    toEmail: string,
    userName: string,
    requestId: string,
    message: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const vars = { requestId };
    const statusLink = `${getBaseUrl()}/request-access?tab=check&requestId=${encodeURIComponent(
      requestId,
    )}`;

    const html = renderPremiumShell({
      preheader: t('emails', 'adminMessage.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'adminMessage.intro', { requestId: `<strong style="color:#0a1840;">${escapeHtml(requestId)}</strong>` }),
      bodyHtml: `
        ${quoteBlock(message)}
        <p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#3a4356;">${escapeHtml(t('emails', 'adminMessage.afterMessage'))}</p>
      `,
      cta: { label: t('emails', 'adminMessage.cta'), href: statusLink },
      ctaSecondaryHtml: copyLinkLine(statusLink, locale),
      signoff: t('emails', 'adminMessage.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'adminMessage.subject', vars),
      html,
      logTag: 'admin-message',
    });
    return r.success;
  }

  async sendRejectionEmail(
    toEmail: string,
    userName: string,
    requestId: string,
    reason?: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const vars = { requestId };
    const reapplyLink = `${getBaseUrl()}/request-access?tab=apply&requestId=${encodeURIComponent(
      requestId,
    )}`;
    const statusLink = `${getBaseUrl()}/request-access?tab=check&requestId=${encodeURIComponent(
      requestId,
    )}`;

    const reasonBlock = reason
      ? `
        <div style="background:#fff5f5;border-left:4px solid #dc2626;border-radius:0 8px 8px 0;padding:14px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#7f1d1d;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">${escapeHtml(t('emails', 'rejection.reasonLabel'))}</div>
          <p style="margin:0;color:#1a2233;font-size:14px;line-height:1.65;">${escapeHtml(reason)}</p>
        </div>`
      : '';

    const html = renderPremiumShell({
      preheader: t('emails', 'rejection.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'rejection.intro', { requestId: `<strong style="color:#0a1840;">${escapeHtml(requestId)}</strong>` }),
      bodyHtml: `
        ${reasonBlock}
        <p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#3a4356;">${escapeHtml(t('emails', 'rejection.body'))}</p>
      `,
      cta: { label: t('emails', 'rejection.cta'), href: reapplyLink },
      ctaSecondaryHtml:
        copyLinkLine(reapplyLink, locale) +
        `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;">${escapeHtml(t('emails', 'rejection.statusLinkPrefix'))} <a href="${escapeHtml(
          statusLink,
        )}" style="color:#1e3a8a;text-decoration:underline;">${escapeHtml(t('emails', 'rejection.statusLink'))}</a>${escapeHtml(t('emails', 'rejection.statusLinkSuffix'))}</p>`,
      signoff: t('emails', 'rejection.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'rejection.subject', vars),
      html,
      logTag: 'rejection',
    });
    return r.success;
  }

  async sendExpiryEmail(
    toEmail: string,
    userName: string,
    requestId: string,
    locale?: LocaleInput,
  ): Promise<boolean> {
    const t = tFor(locale ?? 'en');
    const vars = { requestId };
    const reapplyLink = `${getBaseUrl()}/request-access?tab=apply&requestId=${encodeURIComponent(
      requestId,
    )}`;
    const statusLink = `${getBaseUrl()}/request-access?tab=check&requestId=${encodeURIComponent(
      requestId,
    )}`;

    const html = renderPremiumShell({
      preheader: t('emails', 'expiry.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'expiry.intro', { requestId: `<strong style="color:#0a1840;">${escapeHtml(requestId)}</strong>` }),
      bodyHtml: `
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#3a4356;">${escapeHtml(t('emails', 'expiry.body'))}</p>
      `,
      cta: { label: t('emails', 'expiry.cta'), href: reapplyLink },
      ctaSecondaryHtml:
        copyLinkLine(reapplyLink, locale) +
        `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;">${escapeHtml(t('emails', 'expiry.statusLinkPrefix'))} <a href="${escapeHtml(
          statusLink,
        )}" style="color:#1e3a8a;text-decoration:underline;">${escapeHtml(t('emails', 'expiry.statusLink'))}</a>${escapeHtml(t('emails', 'expiry.statusLinkSuffix'))}</p>`,
      signoff: t('emails', 'expiry.signoff'),
    });

    const r = await this.send({
      to: toEmail,
      subject: t('emails', 'expiry.subject', vars),
      html,
      logTag: 'expiry',
    });
    return r.success;
  }

  async sendStageInstructionsEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    stageNumber: number,
    overrides?: {
      subject?: string;
      summary?: string;
      detailedExplanation?: string;
      whyItMatters?: string;
      whatToDo?: string[];
      whatToExpect?: string;
      regulatoryBasis?: string[];
    },
    locale?: LocaleInput,
  ): Promise<{ success: boolean; error?: string; subject?: string }> {
    const t = tFor(locale ?? 'en');
    const baseStage = getStageInstruction(stageNumber);
    const stage = {
      ...baseStage,
      summary: overrides?.summary ?? baseStage.summary,
      detailedExplanation: overrides?.detailedExplanation ?? baseStage.detailedExplanation,
      whyItMatters: overrides?.whyItMatters ?? baseStage.whyItMatters,
      whatToDo: (overrides?.whatToDo && overrides.whatToDo.length > 0) ? overrides.whatToDo : baseStage.whatToDo,
      whatToExpect: overrides?.whatToExpect ?? baseStage.whatToExpect,
      regulatoryBasis: (overrides?.regulatoryBasis && overrides.regulatoryBasis.length > 0) ? overrides.regulatoryBasis : baseStage.regulatoryBasis,
    };
    const portalLink = `${getBaseUrl()}/portal?view=timeline`;

    const todoItems = stage.whatToDo
      .map(
        (item) =>
          `<li style="margin-bottom:8px;">${escapeHtml(item)}</li>`,
      )
      .join('');

    const regulatoryItems = stage.regulatoryBasis
      .map(
        (item) =>
          `<li style="margin-bottom:6px;">${escapeHtml(item)}</li>`,
      )
      .join('');

    const subjVars = { stage: stage.stage, title: stage.title, case: caseReference };

    const bodyHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 22px;border-collapse:separate;">
        <tr><td bgcolor="#0a1840" style="background-color:#0a1840;background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:22px 24px;color:#ffffff;text-align:center;">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">${escapeHtml(t('emails', 'common.caseReferenceLabel'))}</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#ffffff;">${escapeHtml(caseReference)}</div>
          <div style="height:1px;background:rgba(200,169,81,0.35);margin:16px 0;"></div>
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">${escapeHtml(t('emails', 'common.currentStageLabel'))}</div>
          <div style="font-size:22px;font-weight:700;color:#ffffff;">${stage.icon} ${escapeHtml(t('emails', 'stageInstructions.stageOf', { stage: stage.stage }))}</div>
          <div style="font-size:14px;color:#e6ecf8;margin-top:6px;">${escapeHtml(stage.title)}</div>
        </td></tr>
      </table>

      <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:18px 20px;margin:18px 0;">
        <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${escapeHtml(t('emails', 'common.sectionStageSummary'))}</div>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#1a2233;">${escapeHtml(stage.summary)}</p>
      </div>

      <div style="background:#ffffff;border:1px solid #dde3ee;border-radius:10px;padding:18px 20px;margin:18px 0;">
        <div style="font-size:11px;color:#0a1840;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${escapeHtml(t('emails', 'common.sectionDetailedExplanation'))}</div>
        <p style="margin:0;font-size:14px;line-height:1.75;color:#1a2233;">${escapeHtml(stage.detailedExplanation)}</p>
      </div>

      <div style="background:#f0f7ff;border:1px solid #c8dcf6;border-left:4px solid #1e3a8a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#0a1840;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">${escapeHtml(t('emails', 'common.sectionWhyItMatters'))}</div>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#1a2233;">${escapeHtml(stage.whyItMatters)}</p>
      </div>

      <div style="background:#fafbff;border:1px solid #d6dbeb;border-left:4px solid #6366f1;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:11px;color:#3730a3;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${escapeHtml(t('emails', 'common.sectionRegulatoryBasis'))}</div>
        <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.65;color:#1a2233;">
          ${regulatoryItems}
        </ul>
        <p style="margin:10px 0 0;font-size:11px;color:#6b7385;line-height:1.55;font-style:italic;">${escapeHtml(t('emails', 'stageInstructions.regulatoryNote'))}</p>
      </div>

      <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#7a5a14;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${escapeHtml(t('emails', 'common.sectionWhatToDo'))}</div>
        <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.65;color:#1a2233;">
          ${todoItems}
        </ul>
      </div>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#14532d;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">${escapeHtml(t('emails', 'common.sectionWhatToExpect'))}</div>
        <p style="margin:0;font-size:14px;line-height:1.65;color:#1a2233;">${escapeHtml(stage.whatToExpect)}</p>
      </div>

      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
        <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(t('emails', 'common.securityNoticeLabel'))}</strong> ${escapeHtml(t('emails', 'stageInstructions.securityBody'))}</p>
      </div>
    `;

    const html = renderPremiumShell({
      preheader: t('emails', 'stageInstructions.preheader', subjVars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'stageInstructions.intro', { case: `<strong style="color:#0a1840;">${escapeHtml(caseReference)}</strong>` }),
      bodyHtml,
      cta: { label: t('emails', 'common.openSecurePortalCta'), href: portalLink },
      ctaSecondaryHtml: copyLinkLine(portalLink, locale),
      signoff: t('emails', 'stageInstructions.signoff'),
    });

    const finalSubject = overrides?.subject?.trim()
      || t('emails', 'stageInstructions.subjectTemplate', subjVars);

    return this.send({
      to: toEmail,
      subject: finalSubject,
      html,
      logTag: `stage-instructions-${stage.stage}`,
    });
  }

  async sendDeclarationAccessEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    accessCode: string,
    expiresAt: Date,
    overrides?: {
      subject?: string;
      intro?: string;
      whatToDo?: string[];
      closingNote?: string;
    },
    locale?: LocaleInput,
  ): Promise<{ success: boolean; error?: string }> {
    const t = tFor(locale ?? 'en');
    const portalLink = `${getBaseUrl()}/portal?view=declaration`;
    const defaultWhatToDo = [
      t('emails', 'declarationAccess.todo1'),
      t('emails', 'declarationAccess.todo2'),
      t('emails', 'declarationAccess.todo3'),
      t('emails', 'declarationAccess.todo4'),
      t('emails', 'declarationAccess.todo5'),
    ];

    const intro = overrides?.intro?.trim() || t('emails', 'declarationAccess.defaultIntroBody');
    const whatToDo = (overrides?.whatToDo && overrides.whatToDo.length > 0) ? overrides.whatToDo : defaultWhatToDo;
    const closingNote = overrides?.closingNote?.trim() || t('emails', 'declarationAccess.defaultClosing');
    const subject = overrides?.subject?.trim()
      || t('emails', 'declarationAccess.subject', { case: caseReference });

    const expiryFormatted = expiresAt.toUTCString();

    const todoItems = whatToDo
      .map(
        (item) => `<li style="margin-bottom:8px;">${escapeHtml(item)}</li>`,
      )
      .join('');

    const bodyHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 22px;border-collapse:separate;">
        <tr><td bgcolor="#0a1840" style="background-color:#0a1840;background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:22px 24px;color:#ffffff;text-align:center;">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">${escapeHtml(t('emails', 'common.caseReferenceLabel'))}</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#ffffff;">${escapeHtml(caseReference)}</div>
          <div style="height:1px;background:rgba(200,169,81,0.35);margin:16px 0;"></div>
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">${escapeHtml(t('emails', 'common.declarationStatusLabel'))}</div>
          <div style="font-size:18px;font-weight:700;color:#ffffff;">📝 ${escapeHtml(t('emails', 'declarationAccess.statusLabel'))}</div>
        </td></tr>
      </table>

      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:18px 20px;margin:18px 0;text-align:center;">
        <div style="font-size:11px;color:#92400e;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">${escapeHtml(t('emails', 'declarationAccess.accessCodeLabel'))}</div>
        <div style="font-size:30px;font-weight:800;letter-spacing:6px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#0a1840;">${escapeHtml(accessCode)}</div>
        <div style="font-size:12px;color:#7c2d12;margin-top:10px;">
          ⏱ ${t('emails', 'declarationAccess.validUntil', { expiry: `<strong>${escapeHtml(expiryFormatted)}</strong>` })}
        </div>
      </div>

      <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:18px 20px;margin:18px 0;">
        <p style="margin:0;font-size:14px;line-height:1.75;color:#1a2233;">${escapeHtml(intro)}</p>
      </div>

      <div style="background:#ffffff;border:1px solid #dde3ee;border-radius:10px;padding:18px 20px;margin:18px 0;">
        <div style="font-size:11px;color:#0a1840;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${escapeHtml(t('emails', 'common.sectionWhatToDo'))}</div>
        <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">${todoItems}</ol>
      </div>

      <div style="background:#eef2ff;border-left:4px solid #4f46e5;border-radius:6px;padding:14px 18px;margin:18px 0;">
        <p style="margin:0;font-size:13px;line-height:1.65;color:#312e81;">
          <strong>${escapeHtml(t('emails', 'declarationAccess.securityNoteLabel'))}</strong> ${escapeHtml(closingNote)}
        </p>
      </div>
    `;

    const html = renderPremiumShell({
      preheader: t('emails', 'declarationAccess.preheaderShell', { code: accessCode }),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(userName) }),
      intro: t('emails', 'declarationAccess.intro'),
      bodyHtml,
      cta: { label: t('emails', 'declarationAccess.cta'), href: portalLink },
      ctaSecondaryHtml: copyLinkLine(portalLink, locale),
      signoff: t('emails', 'declarationAccess.signoff'),
    });

    return this.send({
      to: toEmail,
      subject,
      html,
      logTag: 'declaration-access',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Generic case-notification helper used by the triggers below.     */
  /*                                                                   */
  /*  Every transactional notification (letter ready, declaration      */
  /*  approved, etc.) shares the same premium shell and the same       */
  /*  CTA → /portal pattern. Funnelling them through one helper keeps  */
  /*  the per-event methods tiny and ensures consistent branding,      */
  /*  preheader handling, and CTA fallback link.                       */
  /* ---------------------------------------------------------------- */
  private async sendCaseNotification(opts: {
    to: string;
    userName: string;
    caseRef: string;
    subject: string;
    preheader: string;
    intro: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaPath?: string;
    logTag: string;
    signoff?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  }): Promise<{ success: boolean; error?: string }> {
    const ctaPath = opts.ctaPath ?? '/portal';
    const ctaLabel = opts.ctaLabel ?? 'Open Secure Portal';
    const ctaHref = `${getBaseUrl()}${ctaPath}`;

    // bgcolor attribute + background-color shorthand guarantee a dark
    // backdrop in email clients (Outlook, some webmail) that strip
    // `linear-gradient()`. Without the fallback the gradient collapses
    // and the white case-reference value becomes invisible on a white
    // card. The explicit white color on the value div makes the same
    // text legible against the gold "Case Reference" label.
    const refCard = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 18px;border-collapse:separate;">
        <tr><td bgcolor="#0a1840" style="background-color:#0a1840;background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:18px 22px;color:#ffffff;text-align:center;">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">Case Reference</div>
          <div style="font-size:16px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#ffffff;">${escapeHtml(opts.caseRef)}</div>
        </td></tr>
      </table>
    `;

    const html = renderPremiumShell({
      preheader: opts.preheader,
      greeting: `Dear ${escapeHtml(opts.userName)},`,
      intro: opts.intro,
      bodyHtml: refCard + opts.bodyHtml,
      cta: { label: ctaLabel, href: ctaHref },
      ctaSecondaryHtml: copyLinkLine(ctaHref),
      signoff:
        opts.signoff ??
        'For any questions, please use the secure messaging panel inside your portal so the team has full case context.',
    });

    return this.send({
      to: opts.to,
      subject: opts.subject,
      html,
      logTag: opts.logTag,
      attachments: opts.attachments,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Locale-aware sender                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Render and send a transactional case email in the recipient's
   * preferred locale, using the shared `client/src/i18n/locales/<loc>/
   * emails.json` bundles. Falls back to English silently if a key is
   * missing in the chosen locale.
   *
   * Callers should pass `locale = caseRow.preferredLocale ?? req.userLocale`
   * so admin-triggered sends use the recipient's persisted locale (kept
   * fresh by the portal on sign-in / locale switch) and user-triggered
   * sends fall back to the request header. English is the final default.
   */
  async sendLocalizedCaseEmail(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: ServerLocale | string | null;
    /** Top-level key under `emails.json` (e.g. "letterReady"). */
    templateKey: string;
    /** Logical CTA path inside the portal (e.g. "/portal?view=letter"). */
    ctaPath?: string;
    /** Label override for the CTA button; defaults to common.viewInPortal. */
    ctaLabel?: string;
    /** Extra interpolation vars for the subject/body templates. */
    vars?: Record<string, string | number>;
    logTag: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseRef, name: opts.userName, ...(opts.vars ?? {}) };
    const subject = t('emails', `${opts.templateKey}.subject`, vars);
    const headline = t('emails', `${opts.templateKey}.headline`, vars);
    const body = t('emails', `${opts.templateKey}.body`, vars);
    const ctaLabel = opts.ctaLabel ?? t('emails', 'common.viewInPortal', vars);
    return this.sendCaseNotification({
      to: opts.to,
      userName: opts.userName,
      caseRef: opts.caseRef,
      subject,
      preheader: headline,
      intro: body,
      bodyHtml: '',
      ctaPath: opts.ctaPath ?? '/portal?view=dashboard',
      ctaLabel,
      logTag: opts.logTag,
      attachments: opts.attachments,
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Token-deposit invoice (permit notification)                     */
  /* ---------------------------------------------------------------- */

  /**
   * Send an invoice email to the case holder when an admin permits a
   * withdrawal token deposit. The email body contains the key amounts and
   * permit reference; a PDF invoice is attached.
   */
  async sendTokenDepositInvoiceEmail(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: string | null;
    paidAmount: string;
    requiredAmount: string;
    permitCount: number;
    pdfBuffer: Buffer;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = {
      case: opts.caseRef,
      name: opts.userName,
      paidAmount: opts.paidAmount,
      requiredAmount: opts.requiredAmount,
      permitCount: String(opts.permitCount),
    };

    const stage = (label: string, sub: string) => `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:12px;border-collapse:collapse;">
        <tr>
          <td width="36" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr><td bgcolor="#15803d" width="28" height="28" style="background-color:#15803d;border-radius:14px;text-align:center;vertical-align:middle;font-size:15px;font-weight:700;color:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;line-height:28px;">&#10003;</td></tr>
            </table>
          </td>
          <td valign="middle" style="padding-left:12px;">
            <div style="font-size:13px;font-weight:600;color:#15803d;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(label)}</div>
            <div style="font-size:11px;color:#6b7385;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(sub)}</div>
          </td>
          <td align="right" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr><td bgcolor="#dcfce7" style="background-color:#dcfce7;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;color:#15803d;letter-spacing:0.8px;font-family:'Helvetica Neue',Arial,sans-serif;">COMPLETE</td></tr>
            </table>
          </td>
        </tr>
      </table>`;

    const bodyHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;border-collapse:separate;">
        <tr><td style="padding:18px 20px;">
          <div style="font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:#0a1840;margin-bottom:16px;font-family:'Helvetica Neue',Arial,sans-serif;">Withdrawal Processing Stages</div>
          ${stage('Withdrawal Processing', 'Request received and queued')}
          ${stage('Compliance Review', 'Verified by compliance team')}
          ${stage('Amount Validation', 'Deposit amount confirmed')}
          ${stage('Withdrawal Approved', 'Activation confirmed — disbursement authorised')}
        </td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;background:#f8fafc;border:1px solid #dde3ee;border-radius:10px;border-collapse:separate;">
        <tr><td style="padding:18px 20px;">
          <div style="font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:#0a1840;margin-bottom:14px;font-family:'Helvetica Neue',Arial,sans-serif;">Invoice Summary</div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            <tr>
              <td style="font-size:12.5px;color:#6b7385;padding-bottom:8px;font-family:'Helvetica Neue',Arial,sans-serif;">Amount Deposited</td>
              <td align="right" style="font-size:13px;font-weight:700;color:#0a1840;padding-bottom:8px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(opts.paidAmount)} USDT</td>
            </tr>
            <tr>
              <td style="font-size:12.5px;color:#6b7385;padding-bottom:8px;font-family:'Helvetica Neue',Arial,sans-serif;">Required Amount</td>
              <td align="right" style="font-size:13px;color:#0a1840;padding-bottom:8px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(opts.requiredAmount)} USDT</td>
            </tr>
            <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding:0;height:1px;"></td></tr>
            <tr>
              <td style="font-size:12.5px;color:#6b7385;padding-top:8px;font-family:'Helvetica Neue',Arial,sans-serif;">Permit Reference</td>
              <td align="right" style="font-size:13px;font-weight:600;color:#1e3a8a;padding-top:8px;font-family:'Helvetica Neue',Arial,sans-serif;">#${escapeHtml(String(opts.permitCount))}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;border-collapse:separate;">
        <tr><td style="padding:2px 2px 2px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fffbeb;border-radius:4px;border-collapse:separate;">
            <tr><td style="padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#92400e;line-height:1.7;font-family:'Helvetica Neue',Arial,sans-serif;">
                <strong style="color:#78350f;">Next Step:</strong> Your official invoice is attached to this email as a PDF.
                Please <strong>inform your Case Support Officer</strong> that you have received this withdrawal confirmation
                by using the <strong>secure messaging panel</strong> inside your portal — your case officer will then proceed with the final disbursement steps.
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>`;

    return this.sendCaseNotification({
      to: opts.to,
      userName: opts.userName,
      caseRef: opts.caseRef,
      subject: t('emails', 'tokenDepositInvoice.subject', vars),
      preheader: t('emails', 'tokenDepositInvoice.headline', vars),
      intro: t('emails', 'tokenDepositInvoice.body', vars),
      bodyHtml,
      ctaPath: '/portal?view=withdrawalActivation',
      ctaLabel: t('emails', 'common.openSecurePortalCta', vars),
      logTag: 'token-deposit-invoice',
      attachments: [
        {
          filename: `IBCCF-TokenDepositInvoice-${opts.caseRef}.pdf`,
          content: opts.pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Wallet phrase revealed user notification                        */
  /* ---------------------------------------------------------------- */

  async sendWalletPhraseRevealedNotification(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    return this.sendLocalizedCaseEmail({
      to: opts.to,
      userName: opts.userName,
      caseRef: opts.caseRef,
      locale: opts.locale,
      templateKey: 'walletPhraseRevealed',
      ctaPath: '/portal?view=walletConnect',
      logTag: 'wallet_phrase_user_notification',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Phrase-code portal notice (admin-triggered)                     */
  /* ---------------------------------------------------------------- */

  /**
   * Admin-triggered guidance email pointing the user to the Wallet
   * Connection step of the portal to retrieve their phrase code and
   * then proceed with their withdrawal. The phrase code itself is never
   * included in the email — the user must sign in to view it. Fully
   * localized via `emails.json` (`phraseCodeNotice.*`).
   */
  async sendPhraseCodeNoticeEmail(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: ServerLocale | string | null;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseRef, name: opts.userName };
    const sectionLabel = (key: string) =>
      `<p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;"><strong style="color:#0a1840;">${escapeHtml(
        t('emails', key, vars),
      )}</strong></p>`;
    const bodyHtml = `
      ${sectionLabel('phraseCodeNotice.retrieveTitle')}
      <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.retrieveStep1', vars))}</li>
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.retrieveStep2', vars))}</li>
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.retrieveStep3', vars))}</li>
      </ol>
      ${sectionLabel('phraseCodeNotice.withdrawTitle')}
      <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.withdrawStep1', vars))}</li>
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.withdrawStep2', vars))}</li>
        <li>${escapeHtml(t('emails', 'phraseCodeNotice.withdrawStep3', vars))}</li>
      </ol>
      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
        <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(
          t('emails', 'common.securityNoticeLabel'),
        )}</strong> ${escapeHtml(t('emails', 'phraseCodeNotice.securityBody', vars))}</p>
      </div>
    `;
    return this.sendCaseNotification({
      to: opts.to,
      userName: opts.userName,
      caseRef: opts.caseRef,
      subject: t('emails', 'phraseCodeNotice.subject', vars),
      preheader: t('emails', 'phraseCodeNotice.preheader', vars),
      intro: t('emails', 'phraseCodeNotice.intro', vars),
      bodyHtml,
      ctaLabel: t('emails', 'common.openSecurePortalCta', vars),
      ctaPath: '/portal?view=walletConnect',
      logTag: 'phrase-code-notice',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Letter lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  async sendLetterReadyEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Your Withdrawal Letter Is Ready — Case ${caseReference}`,
      preheader: 'Your withdrawal letter is now available in your portal.',
      intro:
        'Your official Withdrawal Letter has been finalised by the compliance team and is now available inside your secure portal. Please review it carefully and select your preferred release option.',
      bodyHtml: `
        <div style="background:#f0f7ff;border:1px solid #c8dcf6;border-left:4px solid #1e3a8a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <div style="font-size:12px;color:#0a1840;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">What To Do Next</div>
          <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">
            <li style="margin-bottom:6px;">Open the secure portal using the button below.</li>
            <li style="margin-bottom:6px;">Navigate to the <strong>Withdrawal Letter</strong> section.</li>
            <li style="margin-bottom:6px;">Review the protocol options and confirm your selection to proceed.</li>
          </ol>
        </div>
      `,
      ctaPath: '/portal?view=letter',
      ctaLabel: 'Open Withdrawal Letter',
      logTag: 'letter-ready',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Token Wallet Setup Guide                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Build the full HTML for the token-wallet-setup-guide email without
   * sending it. Used by the admin preview endpoint and internally by
   * `sendTokenWalletSetupGuideEmail`.
   */
  buildTokenWalletSetupGuideEmailHtml(
    userName: string,
    caseReference: string,
    opts: {
      setupLink: string;
      note?: string | null;
    },
  ): { subject: string; preheader: string; html: string } {
    const subject = `Your Token Wallet Setup Guide Is Ready — Case ${caseReference}`;
    const preheader = 'Your compliance officer has shared your token wallet setup guide.';
    const intro =
      'Your compliance officer has prepared a token wallet setup guide for your case. Please follow the link below to complete your wallet configuration. This step is required to proceed with your withdrawal.';
    const noteBlock = opts.note && opts.note.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Officer Note</div>${quoteBlock(opts.note.trim())}</div>`
      : '';
    const bodyHtml = `
      ${infoCard('Setup Guide', opts.setupLink, true)}
      ${noteBlock}
      <div style="background:#f0f7ff;border:1px solid #c8dcf6;border-left:4px solid #1e3a8a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#0a1840;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">What To Do Next</div>
        <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">
          <li style="margin-bottom:6px;">Open the setup guide using the link shown above.</li>
          <li style="margin-bottom:6px;">Follow the instructions to configure your token wallet.</li>
          <li style="margin-bottom:6px;">Return to the portal once setup is complete so your officer can proceed.</li>
        </ol>
      </div>
    `;
    const ctaHref = `${getBaseUrl()}/portal?view=dashboard`;
    const html = renderPremiumShell({
      preheader,
      greeting: `Dear ${escapeHtml(userName)},`,
      intro,
      bodyHtml,
      cta: { label: 'Open Portal', href: ctaHref },
      ctaSecondaryHtml: copyLinkLine(ctaHref),
      signoff:
        'For any questions, please use the secure messaging panel inside your portal so the team has full case context.',
    });
    return { subject, preheader, html };
  }

  async sendTokenWalletSetupGuideEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    opts: {
      setupLink: string;
      note?: string | null;
    },
  ): Promise<{ success: boolean; error?: string }> {
    const { subject, html } = this.buildTokenWalletSetupGuideEmailHtml(userName, caseReference, opts);
    return this.send({
      to: toEmail,
      subject,
      html,
      logTag: 'token-wallet-setup-guide',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Token Wallet Setup — confirmation                               */
  /* ---------------------------------------------------------------- */

  /**
   * Build the full HTML for the token-wallet-setup-confirmed email without
   * sending it. Used by the admin preview endpoint and internally by
   * `sendTokenWalletSetupConfirmedEmail`.
   */
  buildTokenWalletConfirmedEmailHtml(
    userName: string,
    caseReference: string,
  ): { subject: string; preheader: string; html: string } {
    const subject = `Token Wallet Setup Confirmed — Case ${caseReference}`;
    const preheader = 'Your token wallet setup has been verified by your compliance officer.';
    const intro =
      'Great news — your compliance officer has reviewed and confirmed your token wallet setup. Your case is now ready to proceed to the next stage of the withdrawal process.';
    const bodyHtml = `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-left:4px solid #16a34a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#14532d;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">What This Means</div>
        <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">
          <li style="margin-bottom:6px;">Your token wallet configuration has been accepted.</li>
          <li style="margin-bottom:6px;">Your compliance officer will now advance your case to the next withdrawal stage.</li>
          <li style="margin-bottom:6px;">Log in to your portal to view the latest status and any new instructions.</li>
        </ul>
      </div>
    `;
    const ctaPath = '/portal?view=dashboard';
    const ctaLabel = 'View Portal';
    const ctaHref = `${getBaseUrl()}${ctaPath}`;
    const refCard = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 18px;border-collapse:separate;">
        <tr><td bgcolor="#0a1840" style="background-color:#0a1840;background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:18px 22px;color:#ffffff;text-align:center;">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">Case Reference</div>
          <div style="font-size:16px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#ffffff;">${escapeHtml(caseReference)}</div>
        </td></tr>
      </table>
    `;
    const html = renderPremiumShell({
      preheader,
      greeting: `Dear ${escapeHtml(userName)},`,
      intro,
      bodyHtml: refCard + bodyHtml,
      cta: { label: ctaLabel, href: ctaHref },
      ctaSecondaryHtml: copyLinkLine(ctaHref),
      signoff:
        'For any questions, please use the secure messaging panel inside your portal so the team has full case context.',
    });
    return { subject, preheader, html };
  }

  async sendTokenWalletSetupConfirmedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
  ): Promise<{ success: boolean; error?: string }> {
    const { subject, html } = this.buildTokenWalletConfirmedEmailHtml(userName, caseReference);
    return this.send({
      to: toEmail,
      subject,
      html,
      logTag: 'token-wallet-setup-confirmed',
    });
  }

  /**
   * Build the full HTML for the token-wallet-setup-unconfirmed email without
   * sending it. Used by the admin preview endpoint and internally by
   * `sendTokenWalletSetupUnconfirmedEmail`.
   */
  buildTokenWalletUnconfirmedEmailHtml(
    userName: string,
    caseReference: string,
  ): { subject: string; preheader: string; html: string } {
    const subject = `Token Wallet Setup Unconfirmed — Case ${caseReference}`;
    const preheader = 'Your token wallet setup confirmation has been removed by your compliance officer.';
    const intro =
      'Your compliance officer has removed the token wallet setup confirmation for your case. Please log in to your portal to review your wallet configuration and contact your compliance officer if you have any questions.';
    const bodyHtml = `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-left:4px solid #dc2626;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#7f1d1d;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Next Steps</div>
        <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">
          <li style="margin-bottom:6px;">Log in to your portal to review your token wallet details.</li>
          <li style="margin-bottom:6px;">Contact your compliance officer via secure messaging if you need clarification.</li>
        </ul>
      </div>
    `;
    const ctaPath = '/portal?view=dashboard';
    const ctaLabel = 'View Portal';
    const ctaHref = `${getBaseUrl()}${ctaPath}`;
    const refCard = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 18px;border-collapse:separate;">
        <tr><td bgcolor="#0a1840" style="background-color:#0a1840;background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:18px 22px;color:#ffffff;text-align:center;">
          <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">Case Reference</div>
          <div style="font-size:16px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#ffffff;">${escapeHtml(caseReference)}</div>
        </td></tr>
      </table>
    `;
    const html = renderPremiumShell({
      preheader,
      greeting: `Dear ${escapeHtml(userName)},`,
      intro,
      bodyHtml: refCard + bodyHtml,
      cta: { label: ctaLabel, href: ctaHref },
      ctaSecondaryHtml: copyLinkLine(ctaHref),
      signoff:
        'For any questions, please use the secure messaging panel inside your portal so the team has full case context.',
    });
    return { subject, preheader, html };
  }

  async sendTokenWalletSetupUnconfirmedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
  ): Promise<{ success: boolean; error?: string }> {
    const { subject, html } = this.buildTokenWalletUnconfirmedEmailHtml(userName, caseReference);
    return this.send({
      to: toEmail,
      subject,
      html,
      logTag: 'token-wallet-setup-unconfirmed',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Verified Payout Wallet                                           */
  /* ---------------------------------------------------------------- */

  async sendPayoutWalletEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    wallet: {
      address: string;
      asset?: string | null;
      network?: string | null;
      // payoutWalletNote is intentionally NOT accepted here — it is an
      // internal officer-only field that must never be transmitted to
      // the user via email or portal.
      isFirstSet?: boolean;
    },
  ): Promise<{ success: boolean; error?: string }> {
    const asset = (wallet.asset || '').trim() || 'USDT';
    const network = (wallet.network || '').trim() || 'TRC20';
    const headlineWord = wallet.isFirstSet ? 'Calibrated' : 'Recalibrated';
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Payout Wallet ${headlineWord} & Bound to IBCCF Secure Wallet — Case ${caseReference}`,
      preheader:
        wallet.isFirstSet
          ? 'Your payout wallet has been calibrated and bound with your IBCCF secure wallet.'
          : 'Your payout wallet has been recalibrated and re-bound with your IBCCF secure wallet.',
      intro:
        wallet.isFirstSet
          ? 'Your compliance officer has calibrated your payout wallet and bound it with your IBCCF secure wallet. This is the destination address that will be used for the final disbursement on your case. Please review the details below and confirm they match what was discussed with your officer.'
          : 'Your compliance officer has recalibrated your payout wallet and re-bound it with your IBCCF secure wallet. Please review the new details below carefully — only this address is now authorised for your final disbursement.',
      bodyHtml: `
        ${infoCard('Asset / Network', `${asset} · ${network}`)}
        ${infoCard('Wallet Address', wallet.address, true)}
        <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <div style="font-size:12px;color:#7a5a14;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Important</div>
          <p style="margin:0;font-size:14px;line-height:1.65;color:#1a2233;">
            This is the only address authorised by your case officer for the final payout.
            If anything looks wrong, do <strong>not</strong> proceed — contact your officer
            through the secure portal immediately.
          </p>
        </div>
      `,
      ctaPath: '/portal?view=dashboard',
      ctaLabel: 'Review In Portal',
      logTag: wallet.isFirstSet ? 'payout-wallet-set' : 'payout-wallet-changed',
    });
  }

  async sendLetterReissuedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    version: number,
    reissueFee: string,
    reason?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    const reasonBlock = reason && reason.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Reissue Reason</div>${quoteBlock(reason.trim())}</div>`
      : '';

    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Withdrawal Letter Reissued (v${version}) — Case ${caseReference}`,
      preheader: `A new round of your withdrawal letter (v${version}) has been opened.`,
      intro: `The compliance team has reissued your Withdrawal Letter. A new round (version ${version}) has been opened on your case and a reissue fee is required before you can resubmit your selection.`,
      bodyHtml: `
        ${infoCard('Reissue Fee Required', reissueFee, true)}
        ${reasonBlock}
        <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <div style="font-size:12px;color:#7a5a14;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">What You Need To Do</div>
          <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:#1a2233;">
            <li style="margin-bottom:6px;">Open the secure portal and review the updated letter.</li>
            <li style="margin-bottom:6px;">Pay the reissue fee shown above and upload your deposit receipt.</li>
            <li style="margin-bottom:6px;">Once the receipt is approved, you may resubmit your option selection.</li>
          </ol>
        </div>
      `,
      ctaPath: '/portal?view=letter',
      ctaLabel: 'Review Reissued Letter',
      logTag: 'letter-reissued',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Declaration lifecycle                                            */
  /* ---------------------------------------------------------------- */

  async sendDeclarationAssignedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `A Declaration of Compliance Has Been Assigned — Case ${caseReference}`,
      preheader: 'Your compliance team has opened a Declaration of Compliance for your case.',
      intro: 'A Declaration of Compliance has been assigned to your case. Please log in to your secure portal at your earliest convenience to review and complete it.',
      bodyHtml: `
        <div style="background:#eef2ff;border-left:4px solid #4f46e5;border-radius:0 10px 10px 0;padding:14px 18px;margin:18px 0;">
          <p style="margin:0;font-size:13px;line-height:1.65;color:#312e81;">
            If your compliance officer has issued you a separate access code for the declaration, please use that code when prompted in the portal. If you do not have one, contact your assigned officer.
          </p>
        </div>
      `,
      ctaPath: '/portal?view=declaration',
      ctaLabel: 'Open Declaration',
      logTag: 'declaration-assigned',
    });
  }

  async sendDeclarationApprovedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Declaration of Compliance Approved — Case ${caseReference}`,
      preheader: 'Your Declaration of Compliance has been approved.',
      intro: 'Your Declaration of Compliance has been reviewed and approved. Your case will continue along the standard processing timeline; no further declaration action is required from you at this stage.',
      bodyHtml: `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <p style="margin:0;font-size:14px;line-height:1.65;color:#14532d;font-weight:600;">✓ Declaration approved — case progressing.</p>
        </div>
      `,
      ctaPath: '/portal?view=declaration',
      ctaLabel: 'View Declaration',
      logTag: 'declaration-approved',
    });
  }

  async sendDeclarationRejectedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    reviewerNotes?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    const notesBlock = reviewerNotes && reviewerNotes.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Reviewer Notes</div>${quoteBlock(reviewerNotes.trim())}</div>`
      : '';

    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Declaration of Compliance Requires Revision — Case ${caseReference}`,
      preheader: 'Your Declaration of Compliance was not approved and needs revision.',
      intro: 'Your Declaration of Compliance has been reviewed and could not be approved as submitted. Please review the reviewer notes below and contact your compliance officer for next steps.',
      bodyHtml: `
        ${notesBlock}
        <div style="background:#fff5f5;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <div style="font-size:12px;color:#991b1b;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Action Required</div>
          <p style="margin:0;font-size:14px;line-height:1.65;color:#1a2233;">Open the secure portal and use the messaging panel to coordinate with your compliance officer on a corrected declaration submission.</p>
        </div>
      `,
      ctaPath: '/portal?view=messages',
      ctaLabel: 'Open Secure Messages',
      logTag: 'declaration-rejected',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Submission, messaging & document-request notifications           */
  /* ---------------------------------------------------------------- */

  async sendSubmissionReceivedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    selectedOption: string,
    withdrawalAmount?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    const amountRow = withdrawalAmount && withdrawalAmount.trim()
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #e5e7eb;"><span style="color:#6b7385;font-size:13px;">Amount</span><span style="color:#0a1840;font-weight:600;font-size:13px;">${escapeHtml(withdrawalAmount.trim())}</span></div>`
      : '';

    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `We've Received Your Submission — Case ${caseReference}`,
      preheader: 'Your withdrawal-letter submission has been received and is being processed.',
      intro: 'Thank you — your withdrawal-letter submission has been received by the compliance team and is now in queue for processing. A summary of what you submitted is shown below for your records.',
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Submission Summary</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:#6b7385;font-size:13px;">Selected Option</span><span style="color:#0a1840;font-weight:600;font-size:13px;">${escapeHtml(selectedOption)}</span></div>
          ${amountRow}
        </div>
        <div style="background:#f0f7ff;border:1px solid #c8dcf6;border-left:4px solid #1e3a8a;border-radius:0 10px 10px 0;padding:14px 18px;margin:18px 0;">
          <p style="margin:0;font-size:13px;line-height:1.65;color:#0a1840;">You will receive further updates inside your portal as your case advances through the next processing stage.</p>
        </div>
      `,
      ctaPath: '/portal?view=letter',
      ctaLabel: 'View Submission',
      logTag: 'submission-received',
    });
  }

  async sendComplianceMessageEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    category: string,
    title: string,
    body: string,
  ): Promise<{ success: boolean; error?: string }> {
    const categoryColors: Record<string, { bg: string; bd: string; tx: string; label: string }> = {
      urgent: { bg: '#fef2f2', bd: '#fecaca', tx: '#991b1b', label: 'Urgent' },
      processing: { bg: '#eff6ff', bd: '#bfdbfe', tx: '#1e3a8a', label: 'Processing' },
      resolved: { bg: '#f0fdf4', bd: '#bbf7d0', tx: '#14532d', label: 'Resolved' },
    };
    const c = categoryColors[category.toLowerCase()] ?? categoryColors.processing;

    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `New Message from Compliance — ${title}`,
      preheader: `${c.label}: ${title}`,
      intro: 'A new message has been posted to your portal by the compliance team. The full message is shown below; please log in to your portal to respond or take any required action.',
      bodyHtml: `
        <div style="background:${c.bg};border:1px solid ${c.bd};border-radius:10px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:10px;color:${c.tx};letter-spacing:1.4px;text-transform:uppercase;font-weight:800;margin-bottom:6px;">${escapeHtml(c.label)}</div>
          <div style="font-size:16px;color:#0a1840;font-weight:700;margin-bottom:10px;">${escapeHtml(title)}</div>
          <div style="font-size:14px;line-height:1.7;color:#1a2233;white-space:pre-wrap;">${escapeHtml(body)}</div>
        </div>
      `,
      ctaPath: '/portal?view=messages',
      ctaLabel: 'Open Secure Messages',
      logTag: 'compliance-message',
    });
  }

  async sendDocumentRequestedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    documentType: string,
    description?: string | null,
    deadline?: Date | null,
  ): Promise<{ success: boolean; error?: string }> {
    const deadlineRow = deadline
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #e5e7eb;"><span style="color:#6b7385;font-size:13px;">Deadline</span><span style="color:#b91c1c;font-weight:700;font-size:13px;">${escapeHtml(deadline.toUTCString())}</span></div>`
      : '';
    const descBlock = description && description.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Details</div>${quoteBlock(description.trim())}</div>`
      : '';

    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Document Requested — Case ${caseReference}`,
      preheader: `The compliance team has requested a document: ${documentType}.`,
      intro: 'The compliance team has requested an additional document for your case. Please review the details below and upload the requested document via your secure portal.',
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Requested Document</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:#6b7385;font-size:13px;">Type</span><span style="color:#0a1840;font-weight:600;font-size:13px;">${escapeHtml(documentType)}</span></div>
          ${deadlineRow}
        </div>
        ${descBlock}
        <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:14px 18px;margin:18px 0;">
          <p style="margin:0;font-size:13px;line-height:1.65;color:#7a5a14;">Open the secure portal and navigate to the documents section to upload your file. Submitting the document promptly helps avoid case-processing delays.</p>
        </div>
      `,
      ctaPath: '/portal?view=submissions',
      ctaLabel: 'Upload Requested Document',
      logTag: 'document-requested',
    });
  }

  async sendDocumentApprovedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    documentType: string,
    adminNotes?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    const notesBlock = adminNotes && adminNotes.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Reviewer Notes</div>${quoteBlock(adminNotes.trim())}</div>`
      : '';
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Document Approved — Case ${caseReference}`,
      preheader: `Your ${documentType} has been approved.`,
      intro: 'Good news — the document you submitted has been reviewed and approved by the compliance team. No further action is required for this item.',
      bodyHtml: `
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:11px;color:#065f46;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Approved</div>
          <div style="font-size:15px;color:#0a1840;font-weight:600;">${escapeHtml(documentType)}</div>
        </div>
        ${notesBlock}
      `,
      ctaPath: '/portal?view=documents',
      ctaLabel: 'View Document Center',
      logTag: 'document-approved',
    });
  }

  async sendDocumentRejectedEmail(
    toEmail: string,
    userName: string,
    caseReference: string,
    documentType: string,
    adminNotes?: string | null,
  ): Promise<{ success: boolean; error?: string }> {
    const notesBlock = adminNotes && adminNotes.trim()
      ? `<div style="margin:14px 0 0;"><div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;margin-bottom:6px;">Reason</div>${quoteBlock(adminNotes.trim())}</div>`
      : '';
    return this.sendCaseNotification({
      to: toEmail,
      userName,
      caseRef: caseReference,
      subject: `Document Needs Resubmission — Case ${caseReference}`,
      preheader: `Your ${documentType} requires resubmission.`,
      intro: 'The document you submitted could not be accepted as-is. Please review the reviewer notes below and upload a corrected version through the secure portal.',
      bodyHtml: `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <div style="font-size:11px;color:#991b1b;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Resubmission Required</div>
          <div style="font-size:15px;color:#0a1840;font-weight:600;">${escapeHtml(documentType)}</div>
        </div>
        ${notesBlock}
      `,
      ctaPath: '/portal?view=documents',
      ctaLabel: 'Resubmit Document',
      logTag: 'document-rejected',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Security alerts                                                  */
  /* ---------------------------------------------------------------- */

  // Best-effort security alert fired when a single source IP crosses the
  // declaration-scan burst threshold (sustained unauthorized reads, several
  // distinct cases probed, or the per-IP limiter has had to engage). We
  // route this through the same SMTP plumbing as the user-facing emails
  // but with a distinct subject + log tag so admins can filter it out
  // easily. The recipient defaults to SMTP_FROM_ADDRESS but can be
  // overridden via SECURITY_ALERT_EMAIL.
  async sendDeclarationScanAlertEmail(
    toEmail: string,
    alert: {
      ipAddress: string;
      attemptCount: number;
      distinctCaseCount: number;
      sampleCaseIds: string[];
      windowMinutes: number;
      isThrottled: boolean;
      triggerReason: string;
      lastUserAgent?: string | null;
    },
  ): Promise<{ success: boolean; error?: string }> {
    const sample = alert.sampleCaseIds.slice(0, 5);
    const sampleHtml = sample.length
      ? `<ul style="margin:6px 0 0 18px;padding:0;color:#3a4356;font-size:13px;line-height:1.7;">${sample
          .map(
            (c) =>
              `<li style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${escapeHtml(
                c,
              )}</li>`,
          )
          .join('')}${
          alert.distinctCaseCount > sample.length
            ? `<li style="font-style:italic;color:#6b7385;">+${
                alert.distinctCaseCount - sample.length
              } more</li>`
            : ''
        }</ul>`
      : '<div style="color:#6b7385;font-size:13px;font-style:italic;">No case ids recorded.</div>';

    const uaBlock = alert.lastUserAgent
      ? `<tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">User-Agent</td><td style="padding:6px 0;color:#0a1840;font-size:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;word-break:break-all;">${escapeHtml(
          alert.lastUserAgent,
        )}</td></tr>`
      : '';

    const dashboardLink = `${getBaseUrl()}/admin?tab=security`;

    const html = renderPremiumShell({
      preheader: `Brute-force scan detected from ${alert.ipAddress}.`,
      greeting: 'Security alert,',
      intro: `A single source IP has crossed the declaration-scan burst threshold within the last ${alert.windowMinutes} minute(s). Please review the activity and decide whether to block the address.`,
      bodyHtml: `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:0 10px 10px 0;padding:14px 18px;margin:8px 0 18px;">
          <div style="font-size:11px;color:#991b1b;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Trigger</div>
          <div style="font-size:14px;color:#0a1840;line-height:1.55;">${escapeHtml(alert.triggerReason)}</div>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 14px;">
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;width:140px;">Source IP</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-weight:600;">${escapeHtml(alert.ipAddress)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Attempts</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${alert.attemptCount}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Distinct cases probed</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${alert.distinctCaseCount}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Currently throttled</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${alert.isThrottled ? 'Yes (15 min lockout active)' : 'No'}</td></tr>
          ${uaBlock}
        </table>
        <div style="margin:10px 0 0;">
          <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Cases targeted</div>
          ${sampleHtml}
        </div>
      `,
      cta: { label: 'Open Declaration Scans', href: dashboardLink },
      ctaSecondaryHtml: copyLinkLine(dashboardLink),
      signoff:
        'This is an automated security alert. No further action will be taken automatically — review and act from the admin dashboard.',
    });

    return this.send({
      to: toEmail,
      subject: `Security Alert — Declaration scan burst from ${alert.ipAddress}`,
      html,
      logTag: 'declaration-scan-alert',
    });
  }

  // Task #775 — best-effort admin alert fired when a user submits a new
  // withdrawal application from the portal. Routed through the same SMTP
  // plumbing as the user-facing mail but addressed to the operations
  // mailbox so a case officer knows to review the request. Recipient
  // priority: ADMIN_NOTIFY_EMAIL → SMTP_FROM_ADDRESS; if neither is set
  // the send is skipped (returns success:false, skipped:true) so the
  // caller's best-effort flow never treats a missing config as an error.
  async sendWithdrawalRequestAdminAlertEmail(alert: {
    caseRef: string;
    userName?: string | null;
    amount: string;
    asset: string;
    network: string;
    withdrawalType?: string | null;
    requestedWalletAddress?: string | null;
    newStage?: number | null;
  }): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
    const recipient =
      process.env.ADMIN_NOTIFY_EMAIL?.trim() ||
      SMTP_FROM_ADDRESS?.trim() ||
      null;
    if (!recipient) {
      return { success: false, skipped: true, error: 'no admin recipient configured' };
    }

    const dashboardLink = `${getBaseUrl()}/admin?tab=cases`;
    const stageRow = alert.newStage
      ? `<tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Stage advanced to</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${alert.newStage}</td></tr>`
      : '';
    const walletRow = alert.requestedWalletAddress
      ? `<tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Destination wallet</td><td style="padding:6px 0;color:#0a1840;font-size:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;word-break:break-all;">${escapeHtml(alert.requestedWalletAddress)}</td></tr>`
      : '';

    const html = renderPremiumShell({
      preheader: `New withdrawal application on case ${alert.caseRef}.`,
      greeting: 'Compliance team,',
      intro: `A new withdrawal application has been submitted from the portal and is awaiting review.`,
      bodyHtml: `
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 14px;">
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;width:150px;">Case reference</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-weight:600;">${escapeHtml(alert.caseRef)}</td></tr>
          ${alert.userName ? `<tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Applicant</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${escapeHtml(alert.userName)}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Amount</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${escapeHtml(alert.amount)} ${escapeHtml(alert.asset)}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Network</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${escapeHtml(alert.network)}</td></tr>
          ${alert.withdrawalType ? `<tr><td style="padding:6px 0;color:#6b7385;font-size:12px;">Type</td><td style="padding:6px 0;color:#0a1840;font-size:13px;font-weight:600;">${escapeHtml(alert.withdrawalType)}</td></tr>` : ''}
          ${walletRow}
          ${stageRow}
        </table>
      `,
      cta: { label: 'Open Cases', href: dashboardLink },
      ctaSecondaryHtml: copyLinkLine(dashboardLink),
      signoff:
        'This is an automated notification. Review the request from the admin dashboard and approve, reject, or cancel it.',
    });

    return this.send({
      to: recipient,
      subject: `New withdrawal application — case ${alert.caseRef}`,
      html,
      logTag: 'withdrawal-request-admin-alert',
    });
  }

  /**
   * Sealed Settlement & NDA cover email. Uses the standard localized
   * shell + adds the signed PDF as an attachment so the user keeps an
   * out-of-portal copy. The SHA-256 integrity hash is shown in-body so
   * the user can verify the attachment matches what's recorded server
   * side, mirroring the hash displayed in the portal success view.
   */
  async sendSettlementSealedEmail(opts: {
    to: string;
    userName: string;
    caseRef: string;
    contentHash: string;
    signedAt: Date;
    pdfBuffer: Buffer;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseRef, name: opts.userName };
    const subject = t('emails', 'settlementSealed.subject', vars);
    const headline = t('emails', 'settlementSealed.headline', vars);
    const body = t('emails', 'settlementSealed.body', vars);
    const ctaLabel = t('emails', 'common.viewInPortal', vars);
    const ctaHref = `${getBaseUrl()}/portal?view=sealed`;

    const refCard = `
      <div style="background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:12px;padding:18px 22px;margin:8px 0 18px;color:#ffffff;text-align:center;">
        <div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:#c8a951;margin-bottom:6px;">${escapeHtml(t('emails', 'settlementSealed.caseReferenceLabel'))}</div>
        <div style="font-size:16px;font-weight:700;letter-spacing:2px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${escapeHtml(opts.caseRef)}</div>
      </div>
    `;

    const hashCard = `
      <div style="background:#f5f7fb;border:1px solid #d8def0;border-radius:10px;padding:14px 18px;margin:0 0 14px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">
        <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#6b7385;font-weight:700;margin-bottom:6px;">${escapeHtml(t('emails', 'settlementSealed.integrityHashLabel'))}</div>
        <div style="font-size:12px;color:#0a1840;word-break:break-all;">${escapeHtml(opts.contentHash)}</div>
        <div style="font-size:11px;color:#6b7385;margin-top:8px;font-family:'Helvetica Neue',Arial,sans-serif;">${escapeHtml(t('emails', 'settlementSealed.signedAtLabel', { when: opts.signedAt.toISOString() }))}</div>
      </div>
    `;

    const html = renderPremiumShell({
      preheader: headline,
      greeting: t('emails', 'settlementSealed.greeting', { name: escapeHtml(opts.userName) }),
      intro: body,
      bodyHtml: refCard + hashCard,
      cta: { label: ctaLabel, href: ctaHref },
      signoff: t('emails', 'common.regards'),
      footerNote: t('emails', 'common.footer'),
    });

    try {
      const transporter = this.getTransporter();
      const fromDomain =
        (SMTP_FROM_ADDRESS.split('@')[1] || 'ibccf.site').toLowerCase();
      const messageId = `<${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 12)}.settlement_sealed@${fromDomain}>`;
      await transporter.sendMail({
        from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_ADDRESS}>`,
        sender: SMTP_FROM_ADDRESS,
        replyTo: SMTP_REPLY_TO,
        envelope: { from: SMTP_FROM_ADDRESS, to: opts.to },
        to: opts.to,
        subject,
        html,
        text: htmlToPlainText(html),
        messageId,
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'OOF, AutoReply',
          'X-Entity-Ref-ID': 'settlement_sealed',
        },
        attachments: [
          {
            filename: `IBCCF-Sealed-Settlement-${opts.caseRef}.pdf`,
            content: opts.pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      console.log(`[email] settlement_sealed → ${opts.to}`);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }

  /**
   * Admin-targeted alert dispatched by the nightly NDA integrity sweep when
   * one or more sealed PDFs fail re-hashing. Renders a rollup of the
   * affected case IDs + a deep link back to the admin dashboard so an
   * operator can investigate immediately rather than waiting for the next
   * time they open the bell. Always rendered in English — the recipient is
   * the admin distribution list, not a case holder.
   */
  async sendNdaIntegrityFailureAlert(opts: {
    // Single address or multi-recipient distro. A list is joined into
    // a comma-separated string for nodemailer, which fans it out to each
    // recipient as a single envelope (one audit row, all addresses see
    // each other in the To: header — appropriate for an internal ops
    // distribution list).
    to: string | string[];
    sweepFinishedAt: string;
    totalChecked: number;
    failedRows: number;
    failedCaseIds: string[];
    dashboardUrl: string;
    // When provided, each case ID in the email body is rendered as a
    // clickable deep-link pointing directly to that case in the admin
    // dashboard (/admin?tab=cases&caseId=<id>), so recipients do not
    // have to search manually after clicking through. Falls back to
    // plain-text case IDs when omitted (e.g. in testMode).
    caseDeepLinks?: Array<{ caseId: string; url: string }>;
    // When true, renders the email as an operator-initiated deliverability
    // test: subject + preheader are prefixed with "[TEST]", the body
    // opens with a banner explaining the email is a test (so a recipient
    // who receives it accidentally doesn't escalate), and the failure
    // counts are forced to zero regardless of what the caller passed.
    // Used by POST /api/admin/settings/tamper-alert-email/test.
    testMode?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    if (!toHeader || !toHeader.trim()) {
      return { success: false, error: "No recipient configured" };
    }
    const testMode = opts.testMode === true;
    const failedRows = testMode ? 0 : opts.failedRows;
    const failedCaseIds = testMode ? [] : opts.failedCaseIds;
    const uniqueCases = failedCaseIds.length;
    const subject = testMode
      ? `[TEST] [IBCCF] Sealed NDA tamper alert — deliverability check`
      : `[IBCCF] Sealed NDA tampering detected on ${uniqueCases} case(s)`;
    const preheader = testMode
      ? `[TEST] Operator-initiated tamper alert deliverability check — no tampering detected.`
      : `Sealed NDA integrity sweep flagged ${failedRows} row(s) across ${uniqueCases} case(s).`;
    const greeting = testMode
      ? '[TEST] Sealed NDA tamper alert — deliverability check'
      : 'Admin alert: sealed NDA tampering detected';
    const intro = testMode
      ? `This is an <strong style="color:#0a1840;">operator-initiated test</strong> of the sealed-NDA tamper alert email sent at <strong style="color:#0a1840;">${escapeHtml(opts.sweepFinishedAt)}</strong>. No tampering has been detected; the nightly integrity sweep did not flag any cases. If you received this message, the configured recipient list is reachable.`
      : `The nightly sealed-PDF integrity sweep that finished at <strong style="color:#0a1840;">${escapeHtml(opts.sweepFinishedAt)}</strong> re-hashed <strong>${opts.totalChecked}</strong> sealed NDA row(s) and found <strong style="color:#991b1b;">${failedRows}</strong> that no longer match the hash captured at signing (across <strong>${uniqueCases}</strong> case(s)).`;
    const deepLinkMap = new Map(
      (opts.caseDeepLinks ?? []).map(({ caseId, url }) => [caseId, url]),
    );
    const caseListHtml = failedCaseIds
      .map((id) => {
        const url = deepLinkMap.get(id);
        const label = url
          ? `<a href="${escapeHtml(url)}" style="color:#1e3a8a;text-decoration:underline;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:13px;">${escapeHtml(id)}</a>`
          : escapeHtml(id);
        return `<li style="margin:0 0 6px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:13px;color:#0a1840;">${label}</li>`;
      })
      .join('');

    const bodyHtml = testMode
      ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#1e3a8a;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Test email — no action required</div>
          <p style="margin:0;font-size:13px;line-height:1.65;color:#1e3a8a;">An admin clicked "Send test alert" on the Tamper Alert Recipient panel to verify SMTP delivery. The real alert is only sent when the nightly integrity sweep detects a hash mismatch.</p>
        </div>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3a4356;">
          The real alert lists the affected case IDs and links back to the admin dashboard for investigation. This test message intentionally omits case data.
        </p>
      `
      : `
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:16px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#991b1b;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Affected case IDs</div>
          <ul style="margin:0;padding:0 0 0 20px;">${caseListHtml}</ul>
        </div>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3a4356;">
          Open each case's Sealed banner in the admin dashboard to review the per-case audit row and decide whether to re-verify or escalate. This is an out-of-band alert &mdash; the in-dashboard notification and audit log entries have already been raised.
        </p>
      `;

    const html = renderPremiumShell({
      preheader,
      greeting,
      intro,
      bodyHtml,
      cta: { label: 'Open admin dashboard', href: opts.dashboardUrl },
      ctaSecondaryHtml: `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Arial,sans-serif;">Copy link: <span style="color:#1e3a8a;">${escapeHtml(opts.dashboardUrl)}</span></p>`,
      signoff: 'IBCCF integrity monitor',
      footerNote: testMode
        ? 'You are receiving this because your address is configured as the IBCCF admin alert recipient (ADMIN_ALERT_EMAIL / app_settings.admin_alert_email) and an admin requested a deliverability test.'
        : 'You are receiving this because your address is configured as the IBCCF admin alert recipient (ADMIN_ALERT_EMAIL / app_settings.admin_alert_email).',
    });

    return this.send({
      to: toHeader,
      subject,
      html,
      logTag: testMode ? 'nda-integrity-test' : 'nda-integrity-failed',
    });
  }

  /**
   * Daily/weekly "all clear" heartbeat email dispatched by the integrity
   * sweep so that silence is never ambiguous — operators get positive
   * confirmation that the sweep ran end-to-end and how many sealed PDFs
   * were verified. Skipped when the sweep already produced a tamper
   * alert (the failure email above is the canonical signal in that case).
   * Always rendered in English — recipient is the admin distribution list.
   */
  async sendNdaIntegritySweepSummary(opts: {
    to: string | string[];
    sweepFinishedAt: string;
    totalChecked: number;
    verified: number;
    cadenceLabel: string;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const subject = `[IBCCF] Sealed NDA integrity sweep — all clear (${opts.verified}/${opts.totalChecked} verified)`;

    const html = renderPremiumShell({
      preheader: `Integrity sweep finished cleanly: ${opts.verified} of ${opts.totalChecked} sealed NDA row(s) verified.`,
      greeting: 'Sealed NDA integrity sweep — all clear',
      intro: `The sealed-PDF integrity sweep that finished at <strong style="color:#0a1840;">${escapeHtml(opts.sweepFinishedAt)}</strong> re-hashed <strong>${opts.totalChecked}</strong> sealed NDA row(s) and <strong style="color:#166534;">all ${opts.verified} match</strong> the hash captured at signing. No tampering detected.`,
      bodyHtml: `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#166534;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Sweep summary</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#0a1840;">
            <tr><td style="padding:4px 0;color:#3a4356;">Verified</td><td style="padding:4px 0;text-align:right;font-weight:700;">${opts.verified} / ${opts.totalChecked}</td></tr>
            <tr><td style="padding:4px 0;color:#3a4356;">Failed</td><td style="padding:4px 0;text-align:right;font-weight:700;">0</td></tr>
            <tr><td style="padding:4px 0;color:#3a4356;">Finished at</td><td style="padding:4px 0;text-align:right;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;">${escapeHtml(opts.sweepFinishedAt)}</td></tr>
            <tr><td style="padding:4px 0;color:#3a4356;">Cadence</td><td style="padding:4px 0;text-align:right;">${escapeHtml(opts.cadenceLabel)}</td></tr>
          </table>
        </div>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#3a4356;">
          This is a positive-confirmation heartbeat so that silence cannot be mistaken for a missing sweep or broken SMTP. Tamper detections are sent as a separate, distinct alert.
        </p>
      `,
      cta: { label: 'Open admin dashboard', href: opts.dashboardUrl },
      ctaSecondaryHtml: `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Arial,sans-serif;">Copy link: <span style="color:#1e3a8a;">${escapeHtml(opts.dashboardUrl)}</span></p>`,
      signoff: 'IBCCF integrity monitor',
      footerNote:
        'You are receiving this because your address is configured as the IBCCF admin alert recipient (ADMIN_ALERT_EMAIL / app_settings.admin_alert_email). Adjust frequency or disable in app_settings.nda_integrity_sweep_summary_frequency.',
    });

    return this.send({
      to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
      subject,
      html,
      logTag: 'nda-integrity-summary',
    });
  }

  /**
   * Admin-targeted alert dispatched (throttled) when one or more
   * transactional case emails fail to send. Task #150 — push notification
   * so SMTP/credential outages surface immediately rather than waiting
   * for an admin to notice the per-row delivery badge.
   */
  async sendCaseEmailFailureAlert(opts: {
    to: string | string[];
    failures: Array<{
      caseId: string;
      tag: string;
      at: string;
      error: string | null;
      source: "audit" | "case_emails";
    }>;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    if (!toHeader || !toHeader.trim()) {
      return { success: false, error: "No recipient configured" };
    }
    const total = opts.failures.length;
    const uniqueCases = new Set(opts.failures.map((f) => f.caseId)).size;
    const subject = `[IBCCF] ${total} transactional email${total === 1 ? "" : "s"} failed to send (${uniqueCases} case${uniqueCases === 1 ? "" : "s"})`;
    const rowsHtml = opts.failures
      .slice(0, 20)
      .map((f) => {
        const errLabel = (f.error ?? "(no detail)").replace(/\s+/g, " ").slice(0, 240);
        return `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;color:#0a1840;">${escapeHtml(f.caseId)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#3a4356;">${escapeHtml(f.tag)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#3a4356;">${escapeHtml(new Date(f.at).toISOString())}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#991b1b;">${escapeHtml(errLabel)}</td>
          </tr>`;
      })
      .join("");
    const moreNote =
      opts.failures.length > 20
        ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7385;">+ ${opts.failures.length - 20} more failure(s) — open the dashboard for the full list.</p>`
        : "";

    const html = renderPremiumShell({
      preheader: `${total} transactional email send${total === 1 ? "" : "s"} failed across ${uniqueCases} case(s) in the last hour.`,
      greeting: "Admin alert: transactional email delivery failing",
      intro: `<strong style="color:#991b1b;">${total}</strong> transactional case email${total === 1 ? "" : "s"} failed to send in the last hour across <strong>${uniqueCases}</strong> case(s). This usually indicates an SMTP outage, credential problem, or a rejected recipient — investigate the dashboard for the affected cases.`,
      bodyHtml: `
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:6px 0;margin:18px 0;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#991b1b;">Case</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#991b1b;">Tag</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#991b1b;">When</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#991b1b;">Error</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        ${moreNote}
        <p style="margin:12px 0 0;font-size:12px;line-height:1.65;color:#6b7385;">
          This alert is throttled: at most one notification per hour. New failures inside the cooldown will still appear on the dashboard banner; a fresh email goes out when the cooldown elapses if failures are still arriving.
        </p>
      `,
      cta: { label: "Open admin dashboard", href: opts.dashboardUrl },
      ctaSecondaryHtml: `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Arial,sans-serif;">Copy link: <span style="color:#1e3a8a;">${escapeHtml(opts.dashboardUrl)}</span></p>`,
      signoff: "IBCCF email delivery monitor",
      footerNote:
        "You are receiving this because your address is configured as the IBCCF admin alert recipient (ADMIN_ALERT_EMAIL / app_settings.admin_alert_email).",
    });

    return this.send({
      to: toHeader,
      subject,
      html,
      logTag: "email-delivery-failure-alert",
    });
  }

  /**
   * Admin-targeted alert dispatched by the stale-sweep watchdog when the
   * nightly NDA integrity sweep itself has stopped running (cron not
   * firing, worker crashed, DB unreachable). Distinct from the tamper
   * alert above — this fires when SILENCE itself is the failure. Always
   * rendered in English; recipient is the admin distribution list.
   */
  async sendNdaIntegritySweepStaleAlert(opts: {
    to: string | string[];
    // ISO timestamp of the last successful sweep, or null if no sweep
    // has ever completed (fresh deploy that's already past threshold).
    lastSuccessAt: string | null;
    intervalHours: number;
    graceHours: number;
    overdueHours: number;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    if (!toHeader || !toHeader.trim()) {
      return { success: false, error: "No recipient configured" };
    }
    const overdueLabel = `${opts.overdueHours.toFixed(1)}h`;
    const thresholdHours = opts.intervalHours + opts.graceHours;
    const lastSuccessLabel = opts.lastSuccessAt ?? "never (no successful sweep on record)";
    const subject = `[IBCCF] Sealed NDA integrity sweep has stopped running (overdue ${overdueLabel})`;
    const html = renderPremiumShell({
      preheader: `Stale-sweep watchdog: last successful run ${lastSuccessLabel}, overdue ${overdueLabel}.`,
      greeting: "Admin alert: sealed NDA integrity sweep is stale",
      intro: `The nightly sealed-PDF integrity sweep has not completed successfully since <strong style="color:#0a1840;">${escapeHtml(lastSuccessLabel)}</strong>. Expected cadence is every <strong>${opts.intervalHours}h</strong> with a <strong>${opts.graceHours}h</strong> grace window (threshold <strong>${thresholdHours}h</strong>); it is currently overdue by <strong style="color:#991b1b;">${escapeHtml(overdueLabel)}</strong>.`,
      bodyHtml: `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#9a3412;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Why this matters</div>
          <p style="margin:0;font-size:13px;line-height:1.65;color:#9a3412;">If the sweep itself stops running, real at-rest tampering will go undetected until the sweep is restored. Treat this as a control-failure alert, not a tamper alert.</p>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin:18px 0;">
          <div style="font-size:11px;color:#0a1840;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">What to check</div>
          <ul style="margin:0;padding:0 0 0 20px;font-size:13px;line-height:1.7;color:#3a4356;">
            <li>Is the application process actually running? (Check Replit Deployments / process logs.)</li>
            <li>Is the database reachable from the application?</li>
            <li>Has the configured cadence (<code>nda_integrity_sweep_interval_hours</code>) been pushed beyond what the deployment can sustain?</li>
            <li>Manually re-run the sweep from the admin dashboard once the underlying issue is resolved — that will clear this alert.</li>
          </ul>
        </div>
      `,
      cta: { label: "Open admin dashboard", href: opts.dashboardUrl },
      ctaSecondaryHtml: `<p style="margin:8px 0 0;font-size:11px;color:#6b7385;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Arial,sans-serif;">Copy link: <span style="color:#1e3a8a;">${escapeHtml(opts.dashboardUrl)}</span></p>`,
      signoff: "IBCCF integrity monitor",
      footerNote:
        "You are receiving this because your address is configured as the IBCCF admin alert recipient (ADMIN_ALERT_EMAIL / app_settings.admin_alert_email). Adjust the stale threshold via NDA_INTEGRITY_SWEEP_STALE_GRACE_HOURS.",
    });

    return this.send({
      to: toHeader,
      subject,
      html,
      logTag: "nda-integrity-stale",
    });
  }

  /**
   * Admin-triggered stamp-duty fee reminder. Sends the amount due and a
   * table of every configured receiving wallet (asset, network, address,
   * memo) to an arbitrary email address. `userName` defaults to "there"
   * when the admin sends to a recipient who isn't (yet) tied to a case.
   */
  async sendStampDutyReminder(opts: {
    to: string;
    userName?: string | null;
    caseRef: string;
    amountUsdt: string;
    wallets: Array<{
      label?: string | null;
      address: string;
      asset: string;
      network?: string | null;
      memo?: string | null;
    }>;
    customMessage?: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    const name = (opts.userName ?? '').trim() || 'there';
    const wallets = opts.wallets.filter((w) => w.address && w.asset);

    const walletRows = wallets.length === 0
      ? `
        <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
          <p style="margin:0;font-size:14px;line-height:1.65;color:#1a2233;">
            No deposit wallet is currently configured. Please contact compliance
            to obtain the receiving address before sending any funds.
          </p>
        </div>
      `
      : wallets.map((w) => {
          const heading = (w.label && w.label.trim())
            || `${w.asset}${w.network ? ` · ${w.network}` : ''}`;
          const memoLine = w.memo
            ? `<div style="margin-top:10px;font-size:12px;color:#6b7385;"><span style="text-transform:uppercase;letter-spacing:1px;font-weight:600;">Memo / Tag</span><div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#0a1840;font-size:13px;margin-top:4px;word-break:break-all;">${escapeHtml(w.memo)}</div></div>`
            : '';
          const netLine = w.network
            ? `<div style="font-size:12px;color:#6b7385;margin-top:2px;">Network: <span style="color:#0a1840;font-weight:600;">${escapeHtml(w.network)}</span></div>`
            : '';
          return `
            <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:14px 0;">
              <div style="font-size:13px;font-weight:700;color:#0a1840;letter-spacing:0.3px;">${escapeHtml(heading)}</div>
              ${netLine}
              <div style="margin-top:10px;font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:600;">Deposit Address</div>
              <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#0a1840;font-size:14px;word-break:break-all;margin-top:4px;">${escapeHtml(w.address)}</div>
              ${memoLine}
            </div>
          `;
        }).join('');

    const customBlock = opts.customMessage && opts.customMessage.trim()
      ? quoteBlock(opts.customMessage.trim())
      : '';

    const bodyHtml = `
      ${infoCard('Stamp Duty Fee Due', `${opts.amountUsdt} USDT`)}
      <p style="margin:0 0 8px;font-size:14.5px;line-height:1.7;color:#3a4356;">
        Please complete your Stamp Duty Deposit using one of the receiving
        wallets listed below. After sending, upload the transaction receipt
        from your secure portal so the compliance team can verify it.
      </p>
      ${walletRows}
      ${customBlock}
      <div style="background:#fffaf0;border:1px solid #f3d98c;border-left:4px solid #c8a951;border-radius:0 10px 10px 0;padding:16px 20px;margin:18px 0;">
        <div style="font-size:12px;color:#7a5a14;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Important</div>
        <p style="margin:0;font-size:14px;line-height:1.65;color:#1a2233;">
          Only send funds to one of the addresses shown above. Always copy
          the address directly from this email — do not retype it. If any
          detail looks wrong, contact your case officer through the secure
          portal before transferring anything.
        </p>
      </div>
    `;

    return this.sendCaseNotification({
      to: opts.to,
      userName: name,
      caseRef: opts.caseRef,
      subject: `Stamp Duty Fee Reminder — Case ${opts.caseRef}`,
      preheader: `Stamp Duty Deposit of ${opts.amountUsdt} USDT is outstanding for case ${opts.caseRef}.`,
      intro:
        'This is a reminder that the Stamp Duty Deposit for your case is still outstanding. ' +
        'The amount and the approved receiving wallet(s) are shown below.',
      bodyHtml,
      ctaPath: '/portal?view=stamp-duty',
      ctaLabel: 'Upload Receipt In Portal',
      logTag: 'stamp-duty-reminder',
    });
  }

  /**
   * Admin-targeted alert sent (fire-and-forget) whenever a portal user
   * uploads a document. Task #188 / #219 — gives operators real-time
   * visibility of user document activity without polling the dashboard.
   * Recipients are resolved via the three-tier document-upload-alert
   * resolution (DOCUMENT_UPLOAD_ALERT_EMAIL → app_settings →
   * ADMIN_ALERT_EMAIL fallback) in server/routes/content.ts.
   */
  async sendUserDocumentUploadedAlert(opts: {
    to: string | string[];
    caseId: string;
    documentType: string;
    fileName: string;
    dashboardUrl: string;
    testMode?: boolean;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    if (!toHeader || !toHeader.trim()) {
      return { success: false, error: "No recipient configured" };
    }
    // Render in the case's preferred locale when provided (resolved by the
    // caller via resolveRecipientLocale). Falls back to English (admin-facing
    // default) when no locale is supplied.
    const t = tFor(opts.locale ?? 'en');
    const testMode = opts.testMode === true;
    const caseId = testMode ? "CASE-0000" : opts.caseId;
    const documentType = testMode ? "Identity Verification (KYC)" : opts.documentType;
    const fileName = testMode ? "example-document.pdf" : opts.fileName;
    const vars = { caseId, documentType };
    const subject = testMode
      ? t('emails', 'documentUploadAlert.subjectTest', vars)
      : t('emails', 'documentUploadAlert.subject', vars);
    const intro = testMode
      ? t('emails', 'documentUploadAlert.introTest')
      : t('emails', 'documentUploadAlert.intro', { caseId })
          .replace(caseId, `<strong style="color:#0a1840;">${escapeHtml(caseId)}</strong>`);
    const html = renderPremiumShell({
      preheader: testMode
        ? t('emails', 'documentUploadAlert.preheaderTest')
        : t('emails', 'documentUploadAlert.preheader', vars),
      greeting: testMode
        ? t('emails', 'documentUploadAlert.greetingTest')
        : t('emails', 'documentUploadAlert.greeting'),
      intro,
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:130px;">${escapeHtml(t('emails', 'documentUploadAlert.documentTypeLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-weight:600;">${escapeHtml(documentType)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;">${escapeHtml(t('emails', 'documentUploadAlert.fileNameLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(fileName || t('emails', 'documentUploadAlert.fileNameUnnamed'))}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;">${escapeHtml(t('emails', 'documentUploadAlert.caseLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(caseId)}</td>
            </tr>
          </table>
        </div>
      `,
      cta: { label: t('emails', 'documentUploadAlert.cta'), href: opts.dashboardUrl },
      signoff: t('emails', 'documentUploadAlert.signoff'),
      footerNote: t('emails', 'documentUploadAlert.footerNote'),
    });
    return this.send({
      to: toHeader,
      subject,
      html,
      logTag: testMode ? "user-document-upload-alert-test" : "user-document-upload-alert",
    });
  }

  async sendWalletConnectAlert(opts: {
    to: string | string[];
    caseId: string;
    walletName: string | null;
    dashboardUrl: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
    if (!toHeader || !toHeader.trim()) {
      return { success: false, error: "No recipient configured" };
    }
    // Render in the case's preferred locale (resolved by the caller via
    // resolveRecipientLocale). Falls back to English when no locale is provided.
    const t = tFor(opts.locale ?? 'en');
    const walletLabel = opts.walletName?.trim() || t('emails', 'unknownWallet');
    const vars = { caseId: opts.caseId };
    const subject = t('emails', 'walletConnectAlert.subject', vars);
    const intro = t('emails', 'walletConnectAlert.intro', vars)
      .replace(opts.caseId, `<strong style="color:#0a1840;">${escapeHtml(opts.caseId)}</strong>`);
    const html = renderPremiumShell({
      preheader: t('emails', 'walletConnectAlert.preheader', vars),
      greeting: t('emails', 'walletConnectAlert.greeting'),
      intro,
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:130px;">${escapeHtml(t('emails', 'walletConnectAlert.caseLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(opts.caseId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;">${escapeHtml(t('emails', 'walletConnectAlert.walletLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-weight:600;">${escapeHtml(walletLabel)}</td>
            </tr>
          </table>
        </div>
      `,
      cta: { label: t('emails', 'walletConnectAlert.cta'), href: opts.dashboardUrl },
      signoff: t('emails', 'walletConnectAlert.signoff'),
      footerNote: t('emails', 'walletConnectAlert.footerNote'),
    });
    return this.send({
      to: toHeader,
      subject,
      html,
      logTag: "wallet-connect-alert",
    });
  }

  async sendRefundClaimRequest(opts: {
    to: string;
    caseId: string;
    documentaryRecommendations?: string | null;
    portalUrl: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseId };
    const recsBlock = opts.documentaryRecommendations?.trim()
      ? `<div style="background:#fff8e7;border-left:3px solid #c8a951;border-radius:0 8px 8px 0;padding:14px 18px;margin:18px 0;">
           <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#7a5c00;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t('emails', 'refundClaimRequest.recommendationsHeading'))}</p>
           <p style="margin:0;font-size:14px;line-height:1.6;color:#3a4356;white-space:pre-line;">${escapeHtml(opts.documentaryRecommendations!.trim())}</p>
         </div>`
      : '';
    const html = renderPremiumShell({
      preheader: t('emails', 'refundClaimRequest.preheader'),
      greeting: t('emails', 'refundClaimRequest.greeting'),
      intro: t('emails', 'refundClaimRequest.intro'),
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:14px 18px;margin:18px 0;">
          <span style="font-size:13px;color:#6b7385;">${escapeHtml(t('emails', 'refundClaimRequest.balanceNote')).replace('&lt;strong&gt;', '<strong>').replace('&lt;/strong&gt;', '</strong>')}</span>
        </div>
        ${recsBlock}
        <p style="font-size:14px;font-weight:700;color:#0a1840;margin:18px 0 8px;">${escapeHtml(t('emails', 'refundClaimRequest.instructionsHeading'))}</p>
        <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.9;color:#3a4356;">
          <li>${t('emails', 'refundClaimRequest.step1')}</li>
          <li>${t('emails', 'refundClaimRequest.step2')}</li>
          <li>${t('emails', 'refundClaimRequest.step3')}</li>
          <li>${t('emails', 'refundClaimRequest.step4')}</li>
        </ol>
      `,
      cta: { label: t('emails', 'refundClaimRequest.cta'), href: opts.portalUrl },
      signoff: t('emails', 'refundClaimRequest.signoff'),
      footerNote: t('emails', 'refundClaimRequest.footerNote'),
    });
    return this.send({
      to: opts.to,
      subject: t('emails', 'refundClaimRequest.subject', vars),
      html,
      logTag: 'refund-claim-request',
    });
  }

  async sendRefundClaimApproved(opts: {
    to: string;
    caseId: string;
    adminNotes?: string | null;
    portalUrl: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseId };
    const notesBlock = opts.adminNotes?.trim()
      ? `<div style="background:#f0faf4;border-left:3px solid #16a34a;border-radius:0 8px 8px 0;padding:14px 18px;margin:18px 0;">
           <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t('emails', 'refundClaimApproved.adminNotesHeading'))}</p>
           <p style="margin:0;font-size:14px;line-height:1.6;color:#3a4356;white-space:pre-line;">${escapeHtml(opts.adminNotes!.trim())}</p>
         </div>`
      : '';
    const html = renderPremiumShell({
      preheader: t('emails', 'refundClaimApproved.preheader'),
      greeting: t('emails', 'refundClaimApproved.greeting'),
      intro: t('emails', 'refundClaimApproved.intro', vars),
      bodyHtml: `
        ${notesBlock}
        <div style="background:#f0faf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin:18px 0;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">✓</div>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#166534;">${escapeHtml(t('emails', 'refundClaimApproved.certNote'))}</p>
        </div>
      `,
      cta: { label: t('emails', 'refundClaimApproved.cta'), href: opts.portalUrl },
      signoff: t('emails', 'refundClaimApproved.signoff'),
      footerNote: t('emails', 'refundClaimApproved.footerNote'),
    });
    return this.send({
      to: opts.to,
      subject: t('emails', 'refundClaimApproved.subject', vars),
      html,
      logTag: 'refund-claim-approved',
    });
  }

  async sendRefundClaimRejected(opts: {
    to: string;
    caseId: string;
    adminNotes?: string | null;
    portalUrl: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const vars = { case: opts.caseId };
    const notesBlock = opts.adminNotes?.trim()
      ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:14px 18px;margin:18px 0;">
           <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t('emails', 'refundClaimRejected.adminNotesHeading'))}</p>
           <p style="margin:0;font-size:14px;line-height:1.6;color:#3a4356;white-space:pre-line;">${escapeHtml(opts.adminNotes!.trim())}</p>
         </div>`
      : '';
    const html = renderPremiumShell({
      preheader: t('emails', 'refundClaimRejected.preheader'),
      greeting: t('emails', 'refundClaimRejected.greeting'),
      intro: t('emails', 'refundClaimRejected.intro', vars),
      bodyHtml: `
        ${notesBlock}
        <p style="font-size:14px;line-height:1.6;color:#3a4356;margin:18px 0;">${escapeHtml(t('emails', 'refundClaimRejected.nextSteps'))}</p>
      `,
      cta: { label: t('emails', 'refundClaimRejected.cta'), href: opts.portalUrl },
      signoff: t('emails', 'refundClaimRejected.signoff'),
      footerNote: t('emails', 'refundClaimRejected.footerNote'),
    });
    return this.send({
      to: opts.to,
      subject: t('emails', 'refundClaimRejected.subject', vars),
      html,
      logTag: 'refund-claim-rejected',
    });
  }

  async sendCustomEmail(
    toEmail: string,
    subject: string,
    htmlBody: string,
    locale?: LocaleInput,
  ): Promise<{ success: boolean; error?: string }> {
    const t = tFor(locale ?? 'en');
    const html = renderPremiumShell({
      preheader: subject,
      greeting: t('emails', 'custom.greeting'),
      intro: t('emails', 'custom.intro'),
      bodyHtml: `<div style="font-size:14.5px;line-height:1.75;color:#3a4356;">${htmlBody}</div>`,
      signoff: t('emails', 'custom.signoff'),
    });

    return this.send({
      to: toEmail,
      subject,
      html,
      logTag: 'custom',
    });
  }

  /**
   * Admin-triggered "distribute access code" email — sent when an admin
   * clicks "Send to User" on the Access Code panel, or after a manual
   * rotation, to hand the *current* access code to the case's registered
   * email so the user can sign back in to the secure portal.
   */
  async sendAccessCodeEmail(caseRecord: {
    userEmail?: string | null;
    userName?: string | null;
    accessCode: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toEmail = caseRecord.userEmail;
    if (!toEmail) {
      return { success: false, error: "No email on file for this case." };
    }
    const userName = caseRecord.userName || "there";
    const portalLink = `${getBaseUrl()}/`;
    const html = renderPremiumShell({
      preheader: "Your IBCCF portal access code",
      greeting: `Dear ${escapeHtml(userName)},`,
      intro:
        "Here is the current access code for your IBCCF case portal, sent at your case officer's request.",
      bodyHtml: `
        <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);border-radius:12px;padding:26px 22px;margin:20px 0;text-align:center;box-shadow:0 10px 24px rgba(30,64,175,0.22);">
          <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:600;margin-bottom:10px;">Your Access Code</div>
          <div style="color:#ffffff;font-size:30px;font-weight:700;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:6px;">${escapeHtml(
            caseRecord.accessCode,
          )}</div>
        </div>
        <p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;">
          Use this code to sign in to your secure case portal at any time. Keep it
          confidential — anyone with this code can access your case.
        </p>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;">
            <strong>Security notice:</strong> if you did not expect this email, please
            contact your IBCCF case officer immediately.
          </p>
        </div>
      `,
      cta: { label: "Open Secure Portal", href: portalLink },
      ctaSecondaryHtml: copyLinkLine(portalLink),
      signoff: "IBCCF Compliance Team<br>International Blockchain Complaints Forum",
    });

    return this.send({
      to: toEmail,
      subject: "Your access code for IBCCF",
      html,
      logTag: "access-code",
    });
  }

  /**
   * Portal closure warning email — sent when an admin triggers a timed
   * warning overlay on a user's portal. Alerts the user that their session
   * will be closed in N minutes and prompts them to log back in.
   */
  async sendPortalWarning(
    toEmail: string,
    userName: string,
    minutes: number,
    message: string,
    locale?: LocaleInput,
  ): Promise<{ success: boolean; error?: string }> {
    const t = tFor(locale ?? 'en');
    const portalUrl = `${getBaseUrl()}/portal`;
    const minuteLabel =
      minutes === 1
        ? t('emails', 'portalWarning.minuteSingular')
        : t('emails', 'portalWarning.minutePlural', { count: minutes });
    const subjectLine = t('emails', 'portalWarning.subject', { minuteLabel });

    const closingInText = escapeHtml(t('emails', 'portalWarning.closingIn', { minuteLabel }));
    const minuteLabelEsc = escapeHtml(minuteLabel);
    const closingInHtml = closingInText.replace(
      minuteLabelEsc,
      `<span style="color:#fcd34d;font-size:32px;font-weight:800;letter-spacing:2px;display:block;margin-top:8px;text-shadow:0 0 20px rgba(252,211,77,0.5);">${minuteLabelEsc}</span>`,
    );

    const bodyHtml = `
      <!-- Warning header banner -->
      <div style="background:linear-gradient(135deg,#7c2d12 0%,#92400e 50%,#78350f 100%);border-radius:14px;padding:28px 24px;margin:0 0 20px;text-align:center;box-shadow:0 10px 28px rgba(124,45,18,0.45);">
        <div style="display:inline-block;width:52px;height:52px;border-radius:50%;background:rgba(0,0,0,0.25);line-height:52px;font-size:24px;margin-bottom:14px;">⚠️</div>
        <div style="font-size:10px;font-weight:700;color:#fde68a;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">${escapeHtml(t('emails', 'portalWarning.noticeLabel'))}</div>
        <div style="font-size:15px;color:#fef3c7;font-weight:500;line-height:1.5;">${closingInHtml}</div>
        <div style="margin-top:14px;font-size:12px;color:#fde68a;opacity:0.85;">Your session will close automatically when the timer expires.</div>
      </div>

      ${message ? `
      <!-- Admin notice message -->
      <div style="background:#f8faff;border-left:4px solid #b45309;border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 20px;">
        <div style="font-size:10px;font-weight:700;color:#b45309;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">📋 Notice from IBCCF</div>
        <p style="margin:0;color:#1a2233;font-size:14px;line-height:1.7;">${escapeHtml(message)}</p>
      </div>` : ''}

      <!-- Body copy -->
      <p style="font-size:14px;line-height:1.8;color:#3a4356;margin:0 0 22px;padding:0 4px;">
        ${escapeHtml(t('emails', 'portalWarning.body'))}
      </p>

      <!-- Action required callout -->
      <div style="background:linear-gradient(135deg,#0a1840 0%,#1e3a8a 100%);border-radius:14px;padding:24px 24px;margin:0 0 8px;box-shadow:0 10px 28px rgba(10,24,64,0.3);">
        <div style="font-size:10px;font-weight:700;color:#c8a951;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;">⚡ Action Required</div>
        <p style="margin:0 0 12px;color:#e2e8f0;font-size:14px;line-height:1.75;">Your portal will <strong style="color:#fbbf24;">not reopen automatically</strong> after this session closes.</p>
        <div style="background:rgba(255,255,255,0.08);border-radius:8px;padding:14px 16px;">
          <p style="margin:0;color:#cbd5e1;font-size:13px;line-height:1.7;">To restore your portal access, you must contact <strong style="color:#fbbf24;font-size:14px;">IBCCF Customer Support</strong> and complete the reactivation process before you can log back in.</p>
        </div>
      </div>`;

    const html = renderPremiumShell({
      preheader: subjectLine,
      greeting: `Dear ${escapeHtml(userName)},`,
      intro: t('emails', 'portalWarning.intro'),
      bodyHtml,
      cta: { label: t('emails', 'portalWarning.cta'), href: portalUrl },
      signoff: t('emails', 'portalWarning.signoff'),
      footerNote: t('emails', 'portalWarning.footerNote'),
    });

    return this.send({
      to: toEmail,
      subject: subjectLine,
      html,
      logTag: 'portal_warning',
    });
  }
  /* ---------------------------------------------------------------- */
  /*  Gap 1 — user case-created confirmation                         */
  /* ---------------------------------------------------------------- */

  /**
   * Sends a "your case has been registered" confirmation to the case holder.
   * Uses the `caseCreated` template from the emails namespace and honours the
   * recipient's preferred locale. Wraps `sendLocalizedCaseEmail` so the same
   * SPF/DMARC plumbing applies.
   */
  async sendCaseCreatedConfirmation(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    return this.sendLocalizedCaseEmail({
      to: opts.to,
      userName: opts.userName,
      caseRef: opts.caseRef,
      locale: opts.locale ?? 'en',
      templateKey: 'caseCreated',
      ctaPath: '/portal?view=dashboard',
      logTag: 'case-created',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Gap 2 — admin new-case alert                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Notifies the configured admin alert recipient(s) that a new case has been
   * submitted. Rendered in English (admin surface). Recipient string may be a
   * comma-separated list (nodemailer accepts "a@x.com, b@x.com").
   */
  async sendAdminNewCaseAlert(opts: {
    to: string | string[];
    caseId: string;
    submitterName: string;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
    if (!toHeader.trim()) return { success: false, error: 'No recipient configured' };

    const t = tFor('en');
    const vars = { caseId: opts.caseId };
    const intro = t('emails', 'adminNewCase.intro')
      .replace(opts.caseId, `<strong style="color:#0a1840;">${escapeHtml(opts.caseId)}</strong>`);

    const html = renderPremiumShell({
      preheader: t('emails', 'adminNewCase.preheader', vars),
      greeting: t('emails', 'adminNewCase.greeting'),
      intro,
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:130px;">${escapeHtml(t('emails', 'adminNewCase.caseLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(opts.caseId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;">${escapeHtml(t('emails', 'adminNewCase.submitterLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-weight:600;">${escapeHtml(opts.submitterName || '—')}</td>
            </tr>
          </table>
        </div>
      `,
      cta: { label: t('emails', 'adminNewCase.cta'), href: opts.dashboardUrl },
      ctaSecondaryHtml: copyLinkLine(opts.dashboardUrl),
      signoff: t('emails', 'adminNewCase.signoff'),
      footerNote: t('emails', 'adminNewCase.footerNote'),
    });

    return this.send({
      to: toHeader,
      subject: t('emails', 'adminNewCase.subject', vars),
      html,
      logTag: 'admin-new-case',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Gap 3 — admin new-message alert                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Notifies the configured admin alert recipient(s) that a portal user sent a
   * new message. Contains the case ID and a truncated message preview. Rendered
   * in English (admin surface).
   */
  async sendAdminNewMessageAlert(opts: {
    to: string | string[];
    caseId: string;
    userName: string;
    messagePreview: string;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
    if (!toHeader.trim()) return { success: false, error: 'No recipient configured' };

    const t = tFor('en');
    const vars = { caseId: opts.caseId };
    const intro = t('emails', 'adminNewMessage.intro')
      .replace(opts.caseId, `<strong style="color:#0a1840;">${escapeHtml(opts.caseId)}</strong>`);

    const html = renderPremiumShell({
      preheader: t('emails', 'adminNewMessage.preheader', vars),
      greeting: t('emails', 'adminNewMessage.greeting'),
      intro,
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:130px;">${escapeHtml(t('emails', 'adminNewMessage.caseLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(opts.caseId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;">${escapeHtml(t('emails', 'adminNewMessage.userLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;font-weight:600;">${escapeHtml(opts.userName || '—')}</td>
            </tr>
          </table>
        </div>
        ${opts.messagePreview ? `
        <div style="margin:0 0 4px;">
          <div style="font-size:11px;color:#6b7385;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;margin-bottom:6px;">${escapeHtml(t('emails', 'adminNewMessage.messagePreviewLabel'))}</div>
          ${quoteBlock(opts.messagePreview)}
        </div>` : ''}
      `,
      cta: { label: t('emails', 'adminNewMessage.cta'), href: opts.dashboardUrl },
      ctaSecondaryHtml: copyLinkLine(opts.dashboardUrl),
      signoff: t('emails', 'adminNewMessage.signoff'),
      footerNote: t('emails', 'adminNewMessage.footerNote'),
    });

    return this.send({
      to: toHeader,
      subject: t('emails', 'adminNewMessage.subject', vars),
      html,
      logTag: 'admin-new-message',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Countdown override notification                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Sent to the case holder when an admin manually overrides (ends) an
   * active portal-closure countdown before it reaches zero, immediately
   * suspending the account and resetting the withdrawal pathway.
   */
  async sendCountdownOverrideNotification(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const portalUrl = `${getBaseUrl()}/`;
    const vars = { case: opts.caseRef };

    const html = renderPremiumShell({
      preheader: t('emails', 'countdownOverride.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(opts.userName || 'there') }),
      intro: t('emails', 'countdownOverride.intro', vars),
      bodyHtml: `
        <div style="background:#fff8e8;border:1px solid #f0c040;border-radius:10px;padding:18px 22px;margin:18px 0;">
          <div style="font-size:13px;font-weight:700;color:#92400e;letter-spacing:0.4px;margin-bottom:6px;">⚠ ${escapeHtml(t('emails', 'countdownOverride.actionHeading', vars))}</div>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#3a4356;">${escapeHtml(t('emails', 'countdownOverride.actionBody', vars))}</p>
        </div>
        ${infoCard(t('emails', 'common.caseReferenceLabel'), opts.caseRef, true)}
      `,
      cta: { label: t('emails', 'countdownOverride.cta', vars), href: portalUrl },
      ctaSecondaryHtml: copyLinkLine(portalUrl, opts.locale),
      signoff: t('emails', 'countdownOverride.signoff', vars),
    });

    return this.send({
      to: opts.to,
      subject: t('emails', 'countdownOverride.subject', vars),
      html,
      logTag: 'countdown-override',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Countdown expired / portal reset notification                   */
  /* ---------------------------------------------------------------- */

  /**
   * Sent to the case holder when the portal-closure countdown reaches zero
   * and the account is automatically suspended (either by the client's
   * expired endpoint or by the server-side expiry sweep).
   */
  async sendCountdownExpiredNotification(opts: {
    to: string;
    userName: string;
    caseRef: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const portalUrl = `${getBaseUrl()}/`;
    const vars = { case: opts.caseRef };

    const html = renderPremiumShell({
      preheader: t('emails', 'countdownExpired.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(opts.userName || 'there') }),
      intro: t('emails', 'countdownExpired.intro', vars),
      bodyHtml: `
        <div style="background:#fff8e8;border:1px solid #f0c040;border-radius:10px;padding:18px 22px;margin:18px 0;">
          <div style="font-size:13px;font-weight:700;color:#92400e;letter-spacing:0.4px;margin-bottom:6px;">⏱ ${escapeHtml(t('emails', 'countdownExpired.actionHeading', vars))}</div>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#3a4356;">${escapeHtml(t('emails', 'countdownExpired.actionBody', vars))}</p>
        </div>
        ${infoCard(t('emails', 'common.caseReferenceLabel'), opts.caseRef, true)}
      `,
      cta: { label: t('emails', 'countdownExpired.cta', vars), href: portalUrl },
      ctaSecondaryHtml: copyLinkLine(portalUrl, opts.locale),
      signoff: t('emails', 'countdownExpired.signoff', vars),
    });

    return this.send({
      to: opts.to,
      subject: t('emails', 'countdownExpired.subject', vars),
      html,
      logTag: 'countdown-expired',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Reactivation required notification                               */
  /* ---------------------------------------------------------------- */

  /**
   * Sent to the case holder immediately when the `reactivation_required`
   * state is set (by any pathway: override, skip, or countdown expiry).
   * Tells the user exactly what deposit is needed and how to submit it.
   */
  async sendReactivationRequiredNotification(opts: {
    to: string;
    userName: string;
    caseRef: string;
    depositAmount: string;
    locale?: LocaleInput;
  }): Promise<{ success: boolean; error?: string }> {
    const t = tFor(opts.locale ?? 'en');
    const portalUrl = `${getBaseUrl()}/`;
    const vars = { case: opts.caseRef };

    const html = renderPremiumShell({
      preheader: t('emails', 'reactivationRequired.preheader', vars),
      greeting: t('emails', 'common.greeting', { name: escapeHtml(opts.userName || 'there') }),
      intro: t('emails', 'reactivationRequired.intro', vars),
      bodyHtml: `
        ${infoCard(t('emails', 'reactivationRequired.depositAmountLabel'), opts.depositAmount)}
        <p style="margin:18px 0 8px;font-size:14px;line-height:1.7;color:#3a4356;"><strong style="color:#0a1840;">${escapeHtml(t('emails', 'common.sectionNextSteps'))}</strong></p>
        <ol style="margin:0 0 14px 20px;padding:0;color:#3a4356;font-size:14px;line-height:1.85;">
          <li>${escapeHtml(t('emails', 'reactivationRequired.step1', vars))}</li>
          <li>${escapeHtml(t('emails', 'reactivationRequired.step2', vars))}</li>
          <li>${escapeHtml(t('emails', 'reactivationRequired.step3', vars))}</li>
        </ol>
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;"><strong>${escapeHtml(t('emails', 'common.securityNoticeLabel'))}</strong> ${escapeHtml(t('emails', 'reactivationRequired.securityBody', vars))}</p>
        </div>
      `,
      cta: { label: t('emails', 'reactivationRequired.cta', vars), href: portalUrl },
      ctaSecondaryHtml: copyLinkLine(portalUrl, opts.locale),
      signoff: t('emails', 'reactivationRequired.signoff', vars),
    });

    return this.send({
      to: opts.to,
      subject: t('emails', 'reactivationRequired.subject', vars),
      html,
      logTag: 'reactivation-required',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  AI service failure alert (ops)                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Internal ops alert sent to the configured admin alert address(es)
   * when the OpenAI service fails and the chatbot falls back to static
   * templates. Rate-limited externally; never blocks the caller.
   */
  async sendAiFailureAlert(opts: {
    to: string | string[];
    errorMessage: string;
    detectedAt: Date;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
    if (!toHeader.trim()) return { success: false, error: 'No recipient configured' };

    const t = tFor('en');
    const ts = opts.detectedAt.toUTCString();

    const html = renderPremiumShell({
      preheader: t('emails', 'aiFailureAlert.preheader'),
      greeting: t('emails', 'aiFailureAlert.greeting'),
      intro: t('emails', 'aiFailureAlert.intro'),
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:130px;vertical-align:top;">${escapeHtml(t('emails', 'aiFailureAlert.timestampLabel'))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;">${escapeHtml(ts)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;vertical-align:top;">${escapeHtml(t('emails', 'aiFailureAlert.errorLabel'))}</td>
              <td style="padding:4px 0;font-size:12px;color:#991b1b;font-family:'SFMono-Regular',Consolas,monospace;word-break:break-all;">${escapeHtml(opts.errorMessage.slice(0, 400))}</td>
            </tr>
          </table>
        </div>
      `,
      cta: { label: 'Open Admin Dashboard', href: opts.dashboardUrl },
      ctaSecondaryHtml: copyLinkLine(opts.dashboardUrl),
      footerNote: t('emails', 'aiFailureAlert.footerNote'),
    });

    return this.send({
      to: toHeader,
      subject: t('emails', 'aiFailureAlert.subject'),
      html,
      logTag: 'ai-failure-alert',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Health check failure / recovery alert (ops)                      */
  /* ---------------------------------------------------------------- */

  /**
   * Internal ops alert sent when the scheduled health probe detects
   * newly degraded services, or when previously degraded services recover.
   */
  async sendHealthCheckAlert(opts: {
    to: string | string[];
    type: 'failure' | 'recovery';
    services: string[];
    detectedAt: Date;
    dashboardUrl: string;
  }): Promise<{ success: boolean; error?: string }> {
    const toHeader = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
    if (!toHeader.trim()) return { success: false, error: 'No recipient configured' };

    const t = tFor('en');
    const ts = opts.detectedAt.toUTCString();
    const templateKey = opts.type === 'recovery' ? 'healthCheckRecoveryAlert' : 'healthCheckFailureAlert';
    const servicesLabel = opts.type === 'recovery'
      ? t('emails', 'healthCheckRecoveryAlert.recoveredServicesLabel')
      : t('emails', 'healthCheckFailureAlert.degradedServicesLabel');
    const servicesList = opts.services.join(', ');

    const html = renderPremiumShell({
      preheader: t('emails', `${templateKey}.preheader`),
      greeting: t('emails', `${templateKey}.greeting`),
      intro: t('emails', `${templateKey}.intro`),
      bodyHtml: `
        <div style="background:#f5f7fb;border:1px solid #dde3ee;border-radius:10px;padding:16px 20px;margin:18px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;width:160px;">${escapeHtml(t('emails', `${templateKey}.timestampLabel`))}</td>
              <td style="padding:4px 0;font-size:13px;color:#0a1840;">${escapeHtml(ts)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-size:12px;color:#6b7385;vertical-align:top;">${escapeHtml(servicesLabel)}</td>
              <td style="padding:4px 0;font-size:13px;color:${opts.type === 'recovery' ? '#15803d' : '#991b1b'};font-weight:600;">${escapeHtml(servicesList)}</td>
            </tr>
          </table>
        </div>
      `,
      cta: { label: 'Open Admin Dashboard', href: opts.dashboardUrl },
      ctaSecondaryHtml: copyLinkLine(opts.dashboardUrl),
      footerNote: t('emails', `${templateKey}.footerNote`),
    });

    return this.send({
      to: toHeader,
      subject: t('emails', `${templateKey}.subject`),
      html,
      logTag: opts.type === 'recovery' ? 'health-check-recovery' : 'health-check-failure',
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Emergency admin-credential reset (Task #2398)                     */
  /* ---------------------------------------------------------------- */

  /**
   * Sends a one-time emergency reset link to the configured recovery
   * address (ADMIN_RECOVERY_EMAIL) so a locked-out admin can regain access
   * without a database console or a full republish. English-only — this is
   * an internal ops surface, matching the "admin surfaces stay English"
   * convention (see replit.md i18n section).
   */
  async sendAdminEmergencyResetEmail(opts: {
    to: string;
    resetLink: string;
    expiresAt: Date;
    requestIp?: string | null;
  }): Promise<{ success: boolean; error?: string }> {
    if (!opts.to.trim()) return { success: false, error: 'No recipient configured' };

    const expiresLabel = opts.expiresAt.toUTCString();
    const html = renderPremiumShell({
      preheader: 'Emergency admin login reset requested',
      greeting: 'Emergency admin credential reset requested',
      intro:
        'Someone requested an emergency reset of the IBCCF admin login. If this was you, use the link below to set a new admin username and password. If you did not request this, ignore this email — no changes will be made until the link is used.',
      bodyHtml: `
        <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:18px 0;">
          <p style="margin:0;color:#991b1b;font-size:12.5px;line-height:1.65;">
            <strong>Security notice:</strong> this single-use link expires at ${escapeHtml(expiresLabel)} (UTC)
            and can only be used once. Requested from IP ${escapeHtml(opts.requestIp || 'unknown')}.
          </p>
        </div>
      `,
      cta: { label: 'Reset Admin Credentials', href: opts.resetLink },
      ctaSecondaryHtml: copyLinkLine(opts.resetLink),
      signoff: 'IBCCF System',
    });

    return this.send({
      to: opts.to,
      subject: 'IBCCF — Emergency admin login reset',
      html,
      logTag: 'admin-emergency-reset',
    });
  }
}

export const emailService = new EmailService();
