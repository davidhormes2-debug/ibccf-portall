import { describe, it, expect, beforeEach, vi } from "vitest";

const sentMail: any[] = [];

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn(async (opts: any) => {
        sentMail.push(opts);
        return { messageId: "mocked" };
      }),
    }),
  },
}));

process.env.SMTP_PASSWORD = process.env.SMTP_PASSWORD || "test-password";

const TEST_TO = "admin@example.com";
const TEST_CASE_ID = "IBCCF-2024-001";
const TEST_DOCUMENT_TYPE = "Proof of Income";
const TEST_FILE_NAME = "proof-of-income.pdf";
const TEST_DASHBOARD_URL = "https://example.com/admin/dashboard";

describe("EmailService.sendUserDocumentUploadedAlert — normal mode", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=true and sends exactly one email", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("subject contains the document type and case ID (interpolated)", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const { subject } = sentMail[0];
    expect(subject).toContain(TEST_DOCUMENT_TYPE);
    expect(subject).toContain(TEST_CASE_ID);
    expect(subject).not.toMatch(/^\[TEST\]/);
  });

  it("subject does NOT carry a [TEST] prefix in normal mode", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(sentMail[0].subject).not.toMatch(/^\[TEST\]/);
  });

  it("logTag is user-document-upload-alert in normal mode", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(sentMail[0].headers["X-Entity-Ref-ID"]).toBe(
      "user-document-upload-alert",
    );
  });

  it("HTML body contains the preheader with interpolated document type and case ID", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain(TEST_DOCUMENT_TYPE);
    expect(html).toContain(TEST_CASE_ID);
  });

  it("HTML body contains the greeting text", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Admin alert: user document uploaded");
  });

  it("HTML body contains the intro referencing the case ID", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("portal user has uploaded a document");
    expect(html).toContain(TEST_CASE_ID);
  });

  it("HTML body contains the document type label from i18n", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Document type");
    expect(html).toContain(TEST_DOCUMENT_TYPE);
  });

  it("HTML body contains the file name label and the actual file name", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("File name");
    expect(html).toContain(TEST_FILE_NAME);
  });

  it("HTML body contains the case label and the case ID value", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Case");
    expect(html).toContain(TEST_CASE_ID);
  });

  it("HTML body contains the CTA label linking to the dashboard URL", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Review in admin dashboard");
    expect(html).toContain(TEST_DASHBOARD_URL);
  });

  it("HTML body contains the signoff text", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("IBCCF document monitor");
  });

  it("HTML body contains the footer note text", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("DOCUMENT_UPLOAD_ALERT_EMAIL");
  });

  it("sends to the correct recipient", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(sentMail[0].to).toBe(TEST_TO);
  });

  it("accepts an array of recipients and joins them as a comma-separated To header", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: ["admin@example.com", "ops@example.com"],
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(result.success).toBe(true);
    expect(sentMail[0].to).toBe("admin@example.com, ops@example.com");
  });
});

describe("EmailService.sendUserDocumentUploadedAlert — testMode=true", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=true in testMode", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("subject is prefixed with [TEST] in testMode", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    expect(sentMail[0].subject).toMatch(/^\[TEST\]/);
  });

  it("subject contains the fixed testMode case ID (CASE-0000) not the real one", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const { subject } = sentMail[0];
    expect(subject).toContain("CASE-0000");
    expect(subject).not.toContain(TEST_CASE_ID);
  });

  it("logTag is user-document-upload-alert-test in testMode", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    expect(sentMail[0].headers["X-Entity-Ref-ID"]).toBe(
      "user-document-upload-alert-test",
    );
  });

  it("greeting contains [TEST] prefix in testMode", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("[TEST]");
    expect(html).toContain("Admin alert: user document uploaded");
  });

  it("intro contains the testMode copy (operator-initiated test alert)", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("operator-initiated test alert");
    expect(html).toContain("No real document has been uploaded");
  });

  it("table shows fixed testMode values (KYC / example-document.pdf / CASE-0000)", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Identity Verification (KYC)");
    expect(html).toContain("example-document.pdf");
    expect(html).toContain("CASE-0000");
    expect(html).not.toContain(TEST_CASE_ID);
  });

  it("real document type is NOT present in the testMode body", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const html: string = sentMail[0].html;
    expect(html).not.toContain(TEST_DOCUMENT_TYPE);
  });

  it("preheader contains the testMode copy", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
      testMode: true,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Document upload alert delivery verification");
  });
});

describe("EmailService.sendUserDocumentUploadedAlert — fileName fallback", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("renders (unnamed) when fileName is an empty string", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: "",
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(result.success).toBe(true);
    const html: string = sentMail[0].html;
    expect(html).toContain("(unnamed)");
  });

  it("does NOT render (unnamed) when a real fileName is supplied", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: "kyc-passport.jpg",
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("kyc-passport.jpg");
    expect(html).not.toContain("(unnamed)");
  });
});

/**
 * Locale-coverage suite
 *
 * `sendUserDocumentUploadedAlert` accepts an optional `locale` parameter
 * (like `sendWalletConnectAlert`) and renders in that locale when supplied.
 * When no locale is provided it falls back to English, preserving backward
 * compatibility with all existing call sites.
 *
 * Covered locales: en, es, fr, de, pt, zh  (all six supported by the app).
 */
describe("EmailService.sendUserDocumentUploadedAlert — locale rendering", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  type LocaleRow = {
    locale: string;
    greeting: string;
    documentTypeLabel: string;
    fileNameLabel: string;
    caseLabel: string;
    cta: string;
  };

  const LOCALE_ROWS: LocaleRow[] = [
    {
      locale: "en",
      greeting: "Admin alert: user document uploaded",
      documentTypeLabel: "Document type",
      fileNameLabel: "File name",
      caseLabel: "Case",
      cta: "Review in admin dashboard",
    },
    {
      locale: "es",
      greeting: "Alerta de administrador: documento de usuario subido",
      documentTypeLabel: "Tipo de documento",
      fileNameLabel: "Nombre del archivo",
      caseLabel: "Caso",
      cta: "Revisar en el panel de administración",
    },
    {
      locale: "fr",
      greeting: "Alerte admin : document utilisateur téléversé",
      documentTypeLabel: "Type de document",
      fileNameLabel: "Nom du fichier",
      caseLabel: "Dossier",
      cta: "Examiner dans le tableau de bord admin",
    },
    {
      locale: "de",
      greeting: "Admin-Benachrichtigung: Benutzerdokument hochgeladen",
      documentTypeLabel: "Dokumenttyp",
      fileNameLabel: "Dateiname",
      caseLabel: "Fall",
      cta: "Im Admin-Dashboard prüfen",
    },
    {
      locale: "pt",
      greeting: "Alerta de administrador: documento do usuário enviado",
      documentTypeLabel: "Tipo de documento",
      fileNameLabel: "Nome do arquivo",
      caseLabel: "Caso",
      cta: "Revisar no painel de administração",
    },
    {
      locale: "zh",
      greeting: "管理员提醒：用户已上传文件",
      documentTypeLabel: "文件类型",
      fileNameLabel: "文件名",
      caseLabel: "案件",
      cta: "在管理员控制台中审查",
    },
  ];

  it.each(LOCALE_ROWS)(
    "renders the greeting in $locale when locale=$locale is supplied",
    async ({ locale, greeting }) => {
      const { emailService } = await import("../services/EmailService");
      await emailService.sendUserDocumentUploadedAlert({
        to: TEST_TO,
        caseId: TEST_CASE_ID,
        documentType: TEST_DOCUMENT_TYPE,
        fileName: TEST_FILE_NAME,
        dashboardUrl: TEST_DASHBOARD_URL,
        locale,
      });

      const html: string = sentMail[0].html;
      expect(html).toContain(greeting);
    },
  );

  it.each(LOCALE_ROWS)(
    "renders field labels in $locale when locale=$locale is supplied",
    async ({ locale, documentTypeLabel, fileNameLabel, caseLabel, cta }) => {
      const { emailService } = await import("../services/EmailService");
      await emailService.sendUserDocumentUploadedAlert({
        to: TEST_TO,
        caseId: TEST_CASE_ID,
        documentType: TEST_DOCUMENT_TYPE,
        fileName: TEST_FILE_NAME,
        dashboardUrl: TEST_DASHBOARD_URL,
        locale,
      });

      const html: string = sentMail[0].html;
      expect(html).toContain(documentTypeLabel);
      expect(html).toContain(fileNameLabel);
      expect(html).toContain(caseLabel);
      expect(html).toContain(cta);
    },
  );

  it.each(
    LOCALE_ROWS.filter((r) => r.locale !== "en"),
  )(
    "does NOT render the English greeting when locale=$locale is supplied",
    async ({ locale }) => {
      const { emailService } = await import("../services/EmailService");
      await emailService.sendUserDocumentUploadedAlert({
        to: TEST_TO,
        caseId: TEST_CASE_ID,
        documentType: TEST_DOCUMENT_TYPE,
        fileName: TEST_FILE_NAME,
        dashboardUrl: TEST_DASHBOARD_URL,
        locale,
      });

      const html: string = sentMail[0].html;
      expect(html).not.toContain("Admin alert: user document uploaded");
    },
  );

  it("defaults to English when no locale is supplied (backward compat)", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendUserDocumentUploadedAlert({
      to: TEST_TO,
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    const html: string = sentMail[0].html;
    expect(html).toContain("Admin alert: user document uploaded");
    expect(html).toContain("Document type");
    expect(html).toContain("File name");
    expect(html).toContain("Review in admin dashboard");
  });
});

describe("EmailService.sendUserDocumentUploadedAlert — no recipient guard", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=false with error message when to is an empty string", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: "",
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No recipient");
    expect(sentMail).toHaveLength(0);
  });

  it("returns success=false when to is an empty array", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendUserDocumentUploadedAlert({
      to: [],
      caseId: TEST_CASE_ID,
      documentType: TEST_DOCUMENT_TYPE,
      fileName: TEST_FILE_NAME,
      dashboardUrl: TEST_DASHBOARD_URL,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No recipient");
    expect(sentMail).toHaveLength(0);
  });
});
