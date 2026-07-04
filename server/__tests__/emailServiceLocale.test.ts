/**
 * End-to-end locale rendering test for EmailService.sendStageInstructionsEmail.
 *
 * This file calls EmailService directly — NOT through CaseService or any other
 * wrapper — so it exercises the full render path:
 *   locale input → tFor() lookup → i18n JSON → subject/body interpolation
 *
 * nodemailer's transport is mocked so no real SMTP connection is made.
 * We capture the mailOptions object passed to sendMail and assert on it.
 *
 * Covers:
 *   (a) locale="de"  → subject rendered in German  (contains "von 14")
 *   (b) locale="en"  → subject rendered in English  (contains "of 14")
 *   (c) locale=null  → falls back to English subject (contains "of 14")
 *   (d) locale="de"  → HTML body contains German section headings
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── nodemailer mock ───────────────────────────────────────────────────────────
// Must be declared before EmailService is imported so the vi.mock hoisting
// intercepts the import inside EmailService.ts.

const sentMessages: { subject: string; html: string; text: string }[] = [];

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: { subject: string; html: string; text: string }) => {
        sentMessages.push(msg);
        return { messageId: "stub-id" };
      },
    }),
  },
}));

// ── SMTP env stub — EmailService requires SMTP_PASSWORD to build transport ───

process.env.SMTP_PASSWORD ||= "test-smtp-password";

// ── Import after mocks are hoisted ───────────────────────────────────────────

const { emailService } = await import("../services/EmailService");

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  sentMessages.length = 0;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EmailService.sendStageInstructionsEmail — locale rendering", () => {
  it("renders the subject in German when locale='de'", async () => {
    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-001",
      5,
      undefined,
      "de",
    );

    expect(sentMessages).toHaveLength(1);

    // German template: "Phase {{stage}} von 14: {{title}} — Fall {{case}}"
    expect(sentMessages[0].subject).toContain("von 14");
    expect(sentMessages[0].subject).toContain("IBCCF-TEST-001");

    // Must NOT be the English template
    expect(sentMessages[0].subject).not.toContain("of 14");
    expect(sentMessages[0].subject).not.toContain("Stage");
    expect(sentMessages[0].subject).not.toContain("Case");
  });

  it("renders the subject in English when locale='en'", async () => {
    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-002",
      3,
      undefined,
      "en",
    );

    expect(sentMessages).toHaveLength(1);

    // English template: "Stage {{stage}} of 14: {{title}} — Case {{case}}"
    expect(sentMessages[0].subject).toContain("of 14");
    expect(sentMessages[0].subject).toContain("IBCCF-TEST-002");

    // Must NOT be German
    expect(sentMessages[0].subject).not.toContain("von 14");
    expect(sentMessages[0].subject).not.toContain("Phase");
    expect(sentMessages[0].subject).not.toContain("Fall");
  });

  it("falls back to English subject when locale is null", async () => {
    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-003",
      1,
      undefined,
      null,
    );

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].subject).toContain("of 14");
    expect(sentMessages[0].subject).not.toContain("von 14");
  });

  it("renders German section headings in the HTML body when locale='de'", async () => {
    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-004",
      2,
      undefined,
      "de",
    );

    expect(sentMessages).toHaveLength(1);

    const html = sentMessages[0].html;

    // German section labels from client/src/i18n/locales/de/emails.json
    expect(html).toContain("Phasenzusammenfassung");       // common.sectionStageSummary
    expect(html).toContain("Was Sie tun m\u00fcssen");     // common.sectionWhatToDo
    expect(html).toContain("Was als N\u00e4chstes");       // common.sectionWhatToExpect (partial)
    expect(html).toContain("Hallo Test User");             // common.greeting

    // Ensure we didn't accidentally serve English section labels
    expect(html).not.toContain("Stage Summary");
    expect(html).not.toContain("What You Need To Do");
  });

  it("renders CTA label, preheader, sign-off, and copy-link prefix in German when locale='de'", async () => {
    // This test covers the rendering paths that the section-headings test above
    // does NOT exercise: common.openSecurePortalCta (CTA button),
    // stageInstructions.preheader (hidden preheader div),
    // stageInstructions.signoff (sign-off paragraph), and
    // common.copyLinkPrefix (secondary copy-link line below the CTA button).
    // A silent fallback on any of these keys would still pass the earlier tests.

    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-005",
      7,
      undefined,
      "de",
    );

    expect(sentMessages).toHaveLength(1);

    const { html } = sentMessages[0];

    // CTA button — common.openSecurePortalCta
    // de: "Sicheres Portal \u00f6ffnen"
    expect(html).toContain("Sicheres Portal \u00f6ffnen");
    expect(html).not.toContain("Open Secure Portal");

    // Preheader (hidden div at top of body) — stageInstructions.preheader
    // de: "Phase {{stage}} von 14: ... — Anweisungen zum Fall {{case}}."
    // "Anweisungen zum Fall" is unique to the German template.
    expect(html).toContain("Anweisungen zum Fall IBCCF-TEST-005");
    expect(html).not.toContain("Instructions for case IBCCF-TEST-005");

    // Sign-off paragraph — stageInstructions.signoff
    // de: "...die sichere Nachrichtenfunktion in Ihrem Portal..."
    expect(html).toContain("sichere Nachrichtenfunktion");
    expect(html).not.toContain("secure messaging panel");

    // Secondary copy-link line below the CTA — common.copyLinkPrefix
    // de: "Oder kopieren Sie diesen Link:"
    expect(html).toContain("Oder kopieren Sie diesen Link:");
    expect(html).not.toContain("Or copy this link:");
  });

  it("renders subject and HTML body in Spanish when locale='es'", async () => {
    // Parallel assertion for a second non-English locale (es) to confirm
    // the i18n lookup path works for any locale, not just German.

    await emailService.sendStageInstructionsEmail(
      "user@example.com",
      "Test User",
      "IBCCF-TEST-006",
      3,
      undefined,
      "es",
    );

    expect(sentMessages).toHaveLength(1);

    const { subject, html } = sentMessages[0];

    // Subject — stageInstructions.subjectTemplate
    // es: "Etapa {{stage}} de 14: {{title}} — Caso {{case}}"
    expect(subject).toContain("Etapa");            // Spanish word for "Stage"
    expect(subject).toContain("de 14");            // Spanish ordinal phrase
    expect(subject).toContain("Caso");             // Spanish word for "Case"
    expect(subject).toContain("IBCCF-TEST-006");

    // Must NOT be English or German
    expect(subject).not.toContain("Stage");
    expect(subject).not.toContain("Phase");
    expect(subject).not.toContain("von 14");

    // CTA button — common.openSecurePortalCta
    // es: "Abrir el portal seguro"
    expect(html).toContain("Abrir el portal seguro");
    expect(html).not.toContain("Sicheres Portal");

    // Section heading — common.sectionStageSummary
    // es: "Resumen de la etapa"
    expect(html).toContain("Resumen de la etapa");
    expect(html).not.toContain("Stage Summary");
    expect(html).not.toContain("Phasenzusammenfassung");

    // Sign-off — stageInstructions.signoff
    // es: "...el panel de mensajer\u00eda segura..."
    expect(html).toContain("mensajer\u00eda segura");
    expect(html).not.toContain("sichere Nachrichtenfunktion");
    expect(html).not.toContain("secure messaging panel");

    // Greeting — common.greeting
    // es: "Hola {{name}},"
    expect(html).toContain("Hola Test User");
    expect(html).not.toContain("Hallo Test User");
    expect(html).not.toContain("Hello Test User");
  });
});

// ── sendAccountReactivationNotification ───────────────────────────────────────

describe("EmailService.sendAccountReactivationNotification — locale rendering", () => {
  it("renders CTA label, preheader, sign-off, and section heading in German when locale='de'", async () => {
    // Covers the four keys called out in the task:
    //   common.openSecurePortalCta, accountReactivation.preheader,
    //   accountReactivation.signoff, common.sectionHowToSignIn.
    // A silent fallback on any of them would pass without this test.

    await emailService.sendAccountReactivationNotification(
      "user@example.com",
      "Test Nutzer",
      "NEW-ACCESS-KEY-DE",
      "de",
    );

    expect(sentMessages).toHaveLength(1);

    const { subject, html } = sentMessages[0];

    // Subject — accountReactivation.subject
    // de: "IBCCF-Portalzugang wiederhergestellt — Ihr neuer Anmeldecode"
    expect(subject).toContain("Portalzugang wiederhergestellt");
    expect(subject).not.toContain("IBCCF portal access restored");

    // Preheader (hidden div at top of body) — accountReactivation.preheader
    // de: "Ihr IBCCF-Portalzugang wurde reaktiviert."
    expect(html).toContain("Ihr IBCCF-Portalzugang wurde reaktiviert");
    expect(html).not.toContain("Your IBCCF portal access has been reactivated");

    // CTA button — common.openSecurePortalCta
    // de: "Sicheres Portal \u00f6ffnen"
    expect(html).toContain("Sicheres Portal \u00f6ffnen");
    expect(html).not.toContain("Open Secure Portal");

    // Section heading — common.sectionHowToSignIn
    // de: "So melden Sie sich erneut an:"
    expect(html).toContain("So melden Sie sich erneut an:");
    expect(html).not.toContain("How to sign back in");

    // Sign-off paragraph — accountReactivation.signoff
    // de: "Falls Sie diese E-Mail nicht erwartet haben, kontaktieren Sie bitte
    //       umgehend unser Compliance-Team."
    expect(html).toContain("Falls Sie diese E-Mail nicht erwartet haben");
    expect(html).not.toContain("If you did not expect this email");

    // Greeting — common.greeting
    // de: "Hallo {{name}},"
    expect(html).toContain("Hallo Test Nutzer");
    expect(html).not.toContain("Hello Test Nutzer");
  });

  it("renders CTA label, preheader, sign-off, and section heading in Spanish when locale='es'", async () => {
    await emailService.sendAccountReactivationNotification(
      "user@example.com",
      "Test Usuario",
      "NEW-ACCESS-KEY-ES",
      "es",
    );

    expect(sentMessages).toHaveLength(1);

    const { subject, html } = sentMessages[0];

    // Subject — accountReactivation.subject
    // es: "Acceso al portal de IBCCF restablecido — su nuevo código de inicio de sesión"
    expect(subject).toContain("restablecido");
    expect(subject).not.toContain("wiederhergestellt");

    // Preheader — accountReactivation.preheader
    // es: "Su acceso al portal de IBCCF ha sido reactivado."
    expect(html).toContain("Su acceso al portal de IBCCF ha sido reactivado");
    expect(html).not.toContain("Ihr IBCCF-Portalzugang wurde reaktiviert");

    // CTA button — common.openSecurePortalCta
    // es: "Abrir el portal seguro"
    expect(html).toContain("Abrir el portal seguro");
    expect(html).not.toContain("Sicheres Portal");

    // Section heading — common.sectionHowToSignIn
    // es: "Cómo volver a iniciar sesión:"
    expect(html).toContain("Cómo volver a iniciar sesión:");
    expect(html).not.toContain("So melden Sie sich erneut an");

    // Sign-off — accountReactivation.signoff
    // es: "Si no esperaba este correo, contacte de inmediato a nuestro equipo de cumplimiento."
    expect(html).toContain("Si no esperaba este correo");
    expect(html).not.toContain("Falls Sie diese E-Mail nicht erwartet haben");

    // Greeting — common.greeting
    // es: "Hola {{name}},"
    expect(html).toContain("Hola Test Usuario");
    expect(html).not.toContain("Hallo Test Usuario");
  });

  it("falls back to English when locale is null", async () => {
    await emailService.sendAccountReactivationNotification(
      "user@example.com",
      "Test User",
      "NEW-ACCESS-KEY-NULL",
      undefined,
    );

    expect(sentMessages).toHaveLength(1);

    const { subject, html } = sentMessages[0];

    // Subject should be English
    expect(subject).toContain("restored");
    expect(subject).not.toContain("wiederhergestellt");
    expect(subject).not.toContain("restablecido");

    // CTA should be English
    expect(html).toContain("Open Secure Portal");
    expect(html).not.toContain("Sicheres Portal");
    expect(html).not.toContain("Abrir el portal seguro");
  });
});

// ── sendKeyApprovalNotification ───────────────────────────────────────────────

describe("EmailService.sendKeyApprovalNotification — locale rendering", () => {
  it("renders preheader, section heading, sign-off, and access-key label in German when locale='de'", async () => {
    // Covers keyApproval.preheader, common.sectionHowToAccess,
    // keyApproval.signoff, and keyApproval.accessKeyLabel.
    // These share the same tFor() / renderPremiumShell path as the
    // reactivation email, so a regression in that path would surface here too.

    await emailService.sendKeyApprovalNotification(
      "user@example.com",
      "Test Nutzer",
      "DEMO-KEY-DE-123",
      "de",
    );

    expect(sentMessages).toHaveLength(1);

    const { subject, html } = sentMessages[0];

    // Subject — keyApproval.subject
    // de: "IBCCF-Zugangsschlüssel ausgestellt — Anmeldedaten anbei"
    expect(subject).toContain("Zugangsschlüssel ausgestellt");
    expect(subject).not.toContain("IBCCF access key issued");

    // Preheader — keyApproval.preheader
    // de: "Ihr Zugangsschlüssel wurde genehmigt und ist einsatzbereit."
    expect(html).toContain("Ihr Zugangsschlüssel wurde genehmigt");
    expect(html).not.toContain("Your access key has been approved");

    // Section heading — common.sectionHowToAccess
    // de: "So gelangen Sie in Ihr Portal:"
    expect(html).toContain("So gelangen Sie in Ihr Portal:");
    expect(html).not.toContain("How to access your portal");

    // Access-key label inside the green card — keyApproval.accessKeyLabel
    // de: "Ihr Zugangsschlüssel"
    expect(html).toContain("Ihr Zugangsschlüssel");

    // The raw access key must still appear in the rendered output
    expect(html).toContain("DEMO-KEY-DE-123");

    // Sign-off — keyApproval.signoff
    // de: "Bei Fragen steht Ihnen unser Compliance-Team zur Verfügung."
    expect(html).toContain("Bei Fragen steht Ihnen unser Compliance-Team");
    expect(html).not.toContain("If you have any questions");

    // Greeting — common.greeting
    // de: "Hallo {{name}},"
    expect(html).toContain("Hallo Test Nutzer");
  });
});
