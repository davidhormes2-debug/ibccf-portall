import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Capture every outbound nodemailer message so we can assert that the
// recipient's persisted `preferred_locale` is what drives the rendered
// language — even when the trigger is admin-side and would otherwise
// carry the admin's locale.
const sentMessages: any[] = [];

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: any) => {
        sentMessages.push(msg);
        return { messageId: "stub" };
      },
    }),
  },
}));

const auditLogs: any[] = [];
let currentCase: any = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async () => currentCase),
    createAuditLog: vi.fn(async (entry: any) => {
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

process.env.SMTP_PASSWORD ||= "test-smtp-password";

const { emailService } = await import("../services/EmailService");
const { sendCaseEmailWithAudit, resolveRecipientLocale } = await import(
  "../services/emailNotify"
);

beforeEach(() => {
  sentMessages.length = 0;
  auditLogs.length = 0;
  currentCase = null;
});

describe("sendCaseEmailWithAudit honours cases.preferred_locale", () => {
  it("renders the email in the locale persisted on the case row", async () => {
    currentCase = {
      id: "case-de-1",
      userEmail: "kunde@example.com",
      userName: "Klaus",
      preferredLocale: "de",
    };

    const result = await sendCaseEmailWithAudit({
      to: currentCase.userEmail,
      caseId: currentCase.id,
      tag: "letter-ready",
      adminUser: "admin",
      send: (locale) =>
        emailService.sendLocalizedCaseEmail({
          to: currentCase.userEmail,
          userName: currentCase.userName,
          caseRef: currentCase.id,
          locale,
          templateKey: "letterReady",
          ctaPath: "/portal?view=letter",
          logTag: "letter-ready",
        }),
    });

    expect(result.sent).toBe(true);
    expect(sentMessages).toHaveLength(1);

    const msg = sentMessages[0];
    expect(msg.subject).toContain("Ihr Auszahlungsschreiben ist bereit");
    // No leftover English copy from the template.
    expect(msg.html).not.toContain("Your withdrawal letter is ready");
    expect(msg.html).toContain("Ihr Auszahlungsschreiben ist bereit");

    // Audit row records the resolved locale so admins can see which
    // language the message went out in.
    const audit = auditLogs.find((a) => a.action === "email_letter-ready");
    expect(audit).toBeTruthy();
    expect(audit.newValue).toContain("(letter-ready, de)");
    expect(audit.targetId).toBe("case-de-1");
  });

  it("falls back to English when the case has no preferred_locale set", async () => {
    currentCase = {
      id: "case-en-1",
      userEmail: "user@example.com",
      userName: "Pat",
      preferredLocale: null,
    };

    await sendCaseEmailWithAudit({
      to: currentCase.userEmail,
      caseId: currentCase.id,
      tag: "letter-ready",
      send: (locale) =>
        emailService.sendLocalizedCaseEmail({
          to: currentCase.userEmail,
          userName: currentCase.userName,
          caseRef: currentCase.id,
          locale,
          templateKey: "letterReady",
          logTag: "letter-ready",
        }),
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].subject).toContain("Your Withdrawal Letter Is Ready");
    expect(auditLogs[0].newValue).toContain("(letter-ready, en)");
  });

  it("localeOverride beats the persisted case locale", async () => {
    currentCase = {
      id: "case-zh-1",
      userEmail: "user@example.com",
      userName: "李明",
      preferredLocale: "zh",
    };

    await sendCaseEmailWithAudit({
      to: currentCase.userEmail,
      caseId: currentCase.id,
      tag: "letter-ready",
      localeOverride: "fr",
      send: (locale) =>
        emailService.sendLocalizedCaseEmail({
          to: currentCase.userEmail,
          userName: currentCase.userName,
          caseRef: currentCase.id,
          locale,
          templateKey: "letterReady",
          logTag: "letter-ready",
        }),
    });

    expect(sentMessages).toHaveLength(1);
    // French marker, not Chinese.
    expect(sentMessages[0].subject.toLowerCase()).toContain("lettre");
    expect(sentMessages[0].html).not.toContain("提款函");
  });

  it("normalises BCP-47 region tags stored on the case", async () => {
    currentCase = {
      id: "case-ptbr",
      userEmail: "x@example.com",
      preferredLocale: "pt-BR",
    };
    expect(await resolveRecipientLocale(currentCase.id)).toBe("pt");
  });

  it("skips send + audit silently when no email is on file", async () => {
    currentCase = { id: "case-noemail", userEmail: null, preferredLocale: "es" };

    const result = await sendCaseEmailWithAudit({
      to: null,
      caseId: currentCase.id,
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    expect(result.sent).toBe(false);
    expect(sentMessages).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
  });
});
