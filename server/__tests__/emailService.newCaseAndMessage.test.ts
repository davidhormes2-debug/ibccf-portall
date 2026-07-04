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

const TEST_ADMIN_EMAIL = "admin@example.com";
const TEST_USER_EMAIL = "user@example.com";
const TEST_CASE_ID = "IBCCF-2024-TEST-001";
const TEST_DASHBOARD_URL = "https://example.com/admin";

describe("EmailService.sendCaseCreatedConfirmation (Gap 1)", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=true and sends exactly one email", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Alice Smith",
      caseRef: TEST_CASE_ID,
    });
    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("sends to the correct recipient", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Alice Smith",
      caseRef: TEST_CASE_ID,
    });
    expect(sentMail[0].to).toBe(TEST_USER_EMAIL);
  });

  it("subject contains the case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Alice Smith",
      caseRef: TEST_CASE_ID,
    });
    expect(sentMail[0].subject).toContain(TEST_CASE_ID);
  });

  it("HTML body contains 'registered'", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Bob Jones",
      caseRef: TEST_CASE_ID,
    });
    expect(sentMail[0].html).toMatch(/registered/i);
  });

  it("respects the locale parameter (falls back to English when locale is missing)", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Alice",
      caseRef: TEST_CASE_ID,
      locale: undefined,
    });
    expect(result.success).toBe(true);
    expect(sentMail[0].html).toContain("registered");
  });

  it("audit tag is case-created (log tag in logTag field)", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendCaseCreatedConfirmation({
      to: TEST_USER_EMAIL,
      userName: "Charlie",
      caseRef: TEST_CASE_ID,
    });
    expect(sentMail[0].headers?.["X-Entity-Ref-ID"]).toBe("case-created");
  });
});

describe("EmailService.sendAdminNewCaseAlert (Gap 2)", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=true and sends exactly one email", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("sends to the configured admin email", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].to).toBe(TEST_ADMIN_EMAIL);
  });

  it("subject contains the case ID", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].subject).toContain(TEST_CASE_ID);
  });

  it("subject carries the [IBCCF] prefix", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].subject).toMatch(/^\[IBCCF\]/);
  });

  it("HTML body contains the submitter name", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].html).toContain("Alice Smith");
  });

  it("HTML body contains the dashboard CTA link", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice Smith",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].html).toContain(TEST_DASHBOARD_URL);
  });

  it("accepts an array of recipients (joined as comma-separated To header)", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewCaseAlert({
      to: ["admin1@example.com", "admin2@example.com"],
      caseId: TEST_CASE_ID,
      submitterName: "Bob",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(true);
    expect(sentMail[0].to).toContain("admin1@example.com");
    expect(sentMail[0].to).toContain("admin2@example.com");
  });

  it("returns success:false when recipient list is empty", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewCaseAlert({
      to: [],
      caseId: TEST_CASE_ID,
      submitterName: "Alice",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(false);
    expect(sentMail).toHaveLength(0);
  });

  it("audit log tag is admin-new-case", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewCaseAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      submitterName: "Alice",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].headers?.["X-Entity-Ref-ID"]).toBe("admin-new-case");
  });
});

describe("EmailService.sendAdminNewMessageAlert (Gap 3)", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("returns success=true and sends exactly one email", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice Smith",
      messagePreview: "Hello, I need help with my case.",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("sends to the configured admin email", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice Smith",
      messagePreview: "Hello!",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].to).toBe(TEST_ADMIN_EMAIL);
  });

  it("subject contains the case ID", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Hello!",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].subject).toContain(TEST_CASE_ID);
  });

  it("subject carries the [IBCCF] prefix", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Hello!",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].subject).toMatch(/^\[IBCCF\]/);
  });

  it("HTML body contains the message preview", async () => {
    const { emailService } = await import("../services/EmailService");
    const preview = "I need assistance with my withdrawal.";
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: preview,
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].html).toContain(preview);
  });

  it("HTML body contains the user name", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Charlie Brown",
      messagePreview: "Hello!",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].html).toContain("Charlie Brown");
  });

  it("HTML body contains the dashboard CTA link", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Test message",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].html).toContain(TEST_DASHBOARD_URL);
  });

  it("accepts an array of recipients", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewMessageAlert({
      to: ["admin1@example.com", "admin2@example.com"],
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Test",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(true);
    expect(sentMail[0].to).toContain("admin1@example.com");
    expect(sentMail[0].to).toContain("admin2@example.com");
  });

  it("returns success:false when recipient list is empty", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewMessageAlert({
      to: [],
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Hello",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(false);
    expect(sentMail).toHaveLength(0);
  });

  it("audit log tag is admin-new-message", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "Hello!",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(sentMail[0].headers?.["X-Entity-Ref-ID"]).toBe("admin-new-message");
  });

  it("renders gracefully when messagePreview is empty", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAdminNewMessageAlert({
      to: TEST_ADMIN_EMAIL,
      caseId: TEST_CASE_ID,
      userName: "Alice",
      messagePreview: "",
      dashboardUrl: TEST_DASHBOARD_URL,
    });
    expect(result.success).toBe(true);
    expect(sentMail[0].html).toBeTruthy();
  });
});
