import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture every outbound nodemailer message so we can assert on the
// translated subject / html / plaintext that EmailService produced.
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

// EmailService.getTransporter() throws if SMTP_PASSWORD is missing.
process.env.SMTP_PASSWORD ||= "test-smtp-password";

const { emailService } = await import("../services/EmailService");
const { t, normalizeLocale } = await import("../services/i18n");

beforeEach(() => {
  sentMessages.length = 0;
});

describe("transactional emails honour the recipient's preferred locale", () => {
  it("renders Spanish subject and body when locale is 'es'", async () => {
    const result = await emailService.sendLocalizedCaseEmail({
      to: "user@example.com",
      userName: "Carlos",
      caseRef: "CASE-ES-1",
      locale: "es",
      templateKey: "letterReady",
      ctaPath: "/portal?view=letter",
      logTag: "letter-ready",
    });

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);

    const msg = sentMessages[0];
    const expectedSubject = t("es", "emails", "letterReady.subject", {
      case: "CASE-ES-1",
    });
    const expectedHeadline = t("es", "emails", "letterReady.headline");
    const expectedBody = t("es", "emails", "letterReady.body");
    const expectedCta = t("es", "emails", "common.viewInPortal");

    expect(msg.subject).toBe(expectedSubject);
    expect(msg.subject.toLowerCase()).toContain("su carta de retiro");
    expect(msg.html).toContain(expectedHeadline);
    expect(msg.html).toContain(expectedBody);
    expect(msg.html).toContain(expectedCta);
    // No leftover English strings from the template body.
    expect(msg.html).not.toContain("Your withdrawal letter is ready");
  });

  it("renders Simplified Chinese for locale 'zh' and interpolates vars", async () => {
    await emailService.sendLocalizedCaseEmail({
      to: "user@example.com",
      userName: "李明",
      caseRef: "CASE-ZH-9",
      locale: "zh",
      templateKey: "letterReissued",
      vars: { version: 3 },
      logTag: "letter-reissued",
    });

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0];

    expect(msg.subject).toContain("案件 CASE-ZH-9");
    expect(msg.subject).toContain("v3");
    expect(msg.html).toContain("您的提款函");
    // Plaintext alternative is also localized.
    expect(msg.text).toContain("您的提款函");
  });

  it("falls back to English when locale is unknown or omitted", async () => {
    await emailService.sendLocalizedCaseEmail({
      to: "user@example.com",
      userName: "Pat",
      caseRef: "CASE-EN-1",
      locale: "xx-not-a-real-locale",
      templateKey: "documentApproved",
      logTag: "document-approved",
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].subject).toBe(
      t("en", "emails", "documentApproved.subject", { case: "CASE-EN-1" }),
    );
    expect(sentMessages[0].subject).toContain("Document Approved");
  });

  it("normalizes BCP-47 region tags down to the base language", () => {
    expect(normalizeLocale("es-MX")).toBe("es");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh");
    expect(normalizeLocale("pt-BR")).toBe("pt");
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale("klingon")).toBe("en");
  });

  it("renders the reissue-approved template in French", async () => {
    await emailService.sendLocalizedCaseEmail({
      to: "user@example.com",
      userName: "Marie",
      caseRef: "CASE-FR-7",
      locale: "fr",
      templateKey: "reissueApproved",
      ctaPath: "/portal?view=letter",
      logTag: "reissue-receipt-approved",
      vars: { version: 2, reissueFee: "1500 USDT" },
    });

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0];
    const expectedSubject = t("fr", "emails", "reissueApproved.subject", {
      case: "CASE-FR-7",
    });
    expect(msg.subject).toBe(expectedSubject);
    expect(msg.subject.toLowerCase()).toContain("réémission");
    expect(msg.html).toContain(t("fr", "emails", "reissueApproved.body"));
    expect(msg.html).not.toContain("Your reissue payment has been approved");
  });

  it("renders the reissue-rejected template in German", async () => {
    await emailService.sendLocalizedCaseEmail({
      to: "user@example.com",
      userName: "Hans",
      caseRef: "CASE-DE-3",
      locale: "de",
      templateKey: "reissueRejected",
      ctaPath: "/portal?view=deposit",
      logTag: "reissue-receipt-rejected",
      vars: { notes: "Beleg unscharf." },
    });

    expect(sentMessages).toHaveLength(1);
    const msg = sentMessages[0];
    expect(msg.subject).toBe(
      t("de", "emails", "reissueRejected.subject", { case: "CASE-DE-3" }),
    );
    expect(msg.subject.toLowerCase()).toContain("neuausstellung");
    expect(msg.html).toContain(t("de", "emails", "reissueRejected.body"));
    expect(msg.text).toContain(t("de", "emails", "reissueRejected.headline"));
    expect(msg.html).not.toContain(
      "Your reissue payment could not be approved",
    );
  });

  it("renders the document-under-review template with the documentType in every supported locale", async () => {
    const locales: Array<[string, string]> = [
      ["en", "under review"],
      ["es", "revisión"],
      ["fr", "examen"],
      ["de", "prüfung"],
      ["pt", "análise"],
      ["zh", "审核"],
    ];

    for (const [locale, marker] of locales) {
      sentMessages.length = 0;
      const result = await emailService.sendLocalizedCaseEmail({
        to: `${locale}-doc@example.com`,
        userName: "Tester",
        caseRef: `CASE-${locale.toUpperCase()}-DOC`,
        locale,
        templateKey: "documentUnderReview",
        ctaPath: "/portal?view=documents",
        logTag: "document-under-review",
        vars: { documentType: "Proof of Income" },
      });

      expect(result.success, `locale ${locale} sent`).toBe(true);
      expect(sentMessages, `locale ${locale} sent`).toHaveLength(1);
      const msg = sentMessages[0];
      const expectedSubject = t(locale, "emails", "documentUnderReview.subject", {
        case: `CASE-${locale.toUpperCase()}-DOC`,
      });
      expect(msg.subject).toBe(expectedSubject);
      const haystack = `${msg.subject}\n${msg.html}\n${msg.text}`.toLowerCase();
      expect(
        haystack.includes(marker.toLowerCase()),
        `expected ${locale} email to contain "${marker}"`,
      ).toBe(true);
      // documentType var is interpolated into the body in every locale.
      expect(msg.html).toContain("Proof of Income");
    }
  });

  it("renders the matching locale across every supported language", async () => {
    const cases: Array<[string, string]> = [
      ["es", "Su carta de retiro"],
      ["fr", "lettre"],
      ["de", "Auszahlungsschreiben"],
      ["pt", "carta"],
      ["zh", "提款函"],
    ];

    for (const [locale, marker] of cases) {
      sentMessages.length = 0;
      await emailService.sendLocalizedCaseEmail({
        to: `${locale}@example.com`,
        userName: "Tester",
        caseRef: `CASE-${locale.toUpperCase()}`,
        locale,
        templateKey: "letterReady",
        logTag: "letter-ready",
      });
      expect(sentMessages, `locale ${locale} sent`).toHaveLength(1);
      const haystack = `${sentMessages[0].subject}\n${sentMessages[0].html}`;
      expect(
        haystack.toLowerCase().includes(marker.toLowerCase()),
        `expected ${locale} email to contain "${marker}"`,
      ).toBe(true);
    }
  });
});
