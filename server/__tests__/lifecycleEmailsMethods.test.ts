import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// EmailService lifecycle method tests
//
// Tests sendCountdownOverrideNotification, sendCountdownExpiredNotification,
// sendReactivationRequiredNotification, sendAiFailureAlert,
// and sendHealthCheckAlert using the real EmailService with a nodemailer mock.
// ============================================================================

// Capture every outgoing sendMail call.
const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
let sendShouldFail = false;

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn(async (opts: any) => {
        if (sendShouldFail) throw new Error("SMTP error");
        sentEmails.push({ to: opts.to ?? "", subject: opts.subject ?? "", html: opts.html ?? "" });
        return { messageId: "mock-id" };
      }),
      close: vi.fn(),
      verify: vi.fn(async () => true),
    }),
  },
}));

// Minimal stubs needed by the EmailService module at import time.
vi.mock("../instrument", () => ({ Sentry: { captureException: vi.fn() } }));
vi.mock("../db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [] })),
    insert: vi.fn(() => ({ values: vi.fn(async () => {}) })),
  },
}));

describe("EmailService — sendCountdownOverrideNotification", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendShouldFail = false;
  });

  it("sends an email with the correct subject and body content", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendCountdownOverrideNotification({
      to: "user@example.com",
      userName: "Alice",
      caseRef: "CASE-001",
      locale: "en",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent).toBeDefined();
    expect(sent.to).toBe("user@example.com");
    expect(sent.subject).toMatch(/CASE-001/);
    expect(sent.subject).toMatch(/Session Has Been Closed/i);
    expect(sent.html).toMatch(/CASE-001/);
    expect(sent.html).toMatch(/Alice/);
    expect(sent.html).toMatch(/Reactivation/i);
  });

  it("returns failure when SMTP send fails", async () => {
    sendShouldFail = true;
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendCountdownOverrideNotification({
      to: "user@example.com",
      userName: "Alice",
      caseRef: "CASE-001",
      locale: "en",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("EmailService — sendCountdownExpiredNotification", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendShouldFail = false;
  });

  it("sends an email with correct subject and body content", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendCountdownExpiredNotification({
      to: "bob@example.com",
      userName: "Bob",
      caseRef: "CASE-002",
      locale: "en",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent).toBeDefined();
    expect(sent.to).toBe("bob@example.com");
    expect(sent.subject).toMatch(/CASE-002/);
    expect(sent.subject).toMatch(/Session Has Expired/i);
    expect(sent.html).toMatch(/CASE-002/);
    expect(sent.html).toMatch(/Bob/);
    expect(sent.html).toMatch(/reactivation/i);
  });
});

describe("EmailService — sendReactivationRequiredNotification", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendShouldFail = false;
  });

  it("sends an email that includes the deposit amount and case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendReactivationRequiredNotification({
      to: "carol@example.com",
      userName: "Carol",
      caseRef: "CASE-003",
      depositAmount: "1,500 USDT",
      locale: "en",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent).toBeDefined();
    expect(sent.to).toBe("carol@example.com");
    expect(sent.subject).toMatch(/CASE-003/);
    expect(sent.subject).toMatch(/Reactivation Deposit Needed/i);
    expect(sent.html).toMatch(/CASE-003/);
    expect(sent.html).toMatch(/Carol/);
    expect(sent.html).toMatch(/1,500 USDT/);
    expect(sent.html).toMatch(/<ol/);
  });

  it("returns failure when SMTP send fails", async () => {
    sendShouldFail = true;
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendReactivationRequiredNotification({
      to: "carol@example.com",
      userName: "Carol",
      caseRef: "CASE-003",
      depositAmount: "1,500 USDT",
      locale: "en",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("EmailService — sendAiFailureAlert", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendShouldFail = false;
  });

  it("sends an ops alert with subject and error details", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAiFailureAlert({
      to: "ops@example.com",
      errorMessage: "Connection timeout to OpenAI",
      detectedAt: new Date("2025-01-15T10:00:00Z"),
      dashboardUrl: "https://app.example.com/admin",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent).toBeDefined();
    expect(sent.to).toBe("ops@example.com");
    expect(sent.subject).toMatch(/AI Service Degraded/i);
    expect(sent.html).toMatch(/Connection timeout to OpenAI/);
    expect(sent.html).toMatch(/2025/);
  });

  it("returns early with failure if recipient list is empty array", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAiFailureAlert({
      to: [],
      errorMessage: "some error",
      detectedAt: new Date(),
      dashboardUrl: "https://app.example.com/admin",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No recipient/);
  });

  it("accepts an array of recipient addresses", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendAiFailureAlert({
      to: ["a@example.com", "b@example.com"],
      errorMessage: "timeout",
      detectedAt: new Date(),
      dashboardUrl: "https://app.example.com/admin",
    });
    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent.to).toContain("a@example.com");
    expect(sent.to).toContain("b@example.com");
  });
});

describe("EmailService — sendHealthCheckAlert", () => {
  beforeEach(() => {
    sentEmails.length = 0;
    sendShouldFail = false;
  });

  it("sends a failure alert with degraded services listed", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendHealthCheckAlert({
      to: "ops@example.com",
      type: "failure",
      services: ["db", "smtp"],
      detectedAt: new Date("2025-06-01T09:00:00Z"),
      dashboardUrl: "https://app.example.com/admin",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent).toBeDefined();
    expect(sent.to).toBe("ops@example.com");
    expect(sent.subject).toMatch(/Health Check Alert/i);
    expect(sent.html).toMatch(/db.*smtp|smtp.*db/i);
  });

  it("sends a recovery alert with recovered services listed", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendHealthCheckAlert({
      to: "ops@example.com",
      type: "recovery",
      services: ["db"],
      detectedAt: new Date("2025-06-01T09:15:00Z"),
      dashboardUrl: "https://app.example.com/admin",
    });

    expect(result.success).toBe(true);
    const sent = sentEmails.at(-1)!;
    expect(sent.subject).toMatch(/Recovery/i);
    expect(sent.html).toMatch(/db/i);
  });

  it("returns early with failure if recipient list is empty string", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendHealthCheckAlert({
      to: "  ",
      type: "failure",
      services: ["ai"],
      detectedAt: new Date(),
      dashboardUrl: "https://app.example.com/admin",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No recipient/);
  });
});
