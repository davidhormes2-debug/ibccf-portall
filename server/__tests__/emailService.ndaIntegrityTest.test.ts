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

describe("EmailService.sendNdaIntegrityFailureAlert (testMode)", () => {
  beforeEach(() => {
    sentMail.length = 0;
  });

  it("subject is prefixed with [TEST] and logTag is nda-integrity-test", async () => {
    const { emailService } = await import("../services/EmailService");
    const result = await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 0,
      failedRows: 0,
      failedCaseIds: [],
      dashboardUrl: "https://example.com/admin",
      testMode: true,
    });
    expect(result.success).toBe(true);
    expect(sentMail).toHaveLength(1);
    const mail = sentMail[0];
    expect(mail.subject).toMatch(/^\[TEST\]/);
    expect(mail.subject).toContain("deliverability check");
    expect(mail.headers["X-Entity-Ref-ID"]).toBe("nda-integrity-test");
  });

  it("body never includes the failed-case block, even if caller passes case ids", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 42,
      failedRows: 3,
      failedCaseIds: ["CASE-AAA", "CASE-BBB", "CASE-CCC"],
      dashboardUrl: "https://example.com/admin",
      testMode: true,
    });
    expect(sentMail).toHaveLength(1);
    const html = sentMail[0].html as string;
    expect(html).not.toContain("CASE-AAA");
    expect(html).not.toContain("CASE-BBB");
    expect(html).not.toContain("CASE-CCC");
    expect(html).not.toContain("Affected case IDs");
    expect(html).toContain("Test email");
  });

  it("omits case deep-link anchors from the rendered HTML even when caseDeepLinks is non-empty", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 42,
      failedRows: 3,
      failedCaseIds: ["CASE-AAA", "CASE-BBB", "CASE-CCC"],
      dashboardUrl: "https://example.com/admin",
      caseDeepLinks: [
        { caseId: "CASE-AAA", url: "https://example.com/admin?tab=cases&caseId=CASE-AAA" },
        { caseId: "CASE-BBB", url: "https://example.com/admin?tab=cases&caseId=CASE-BBB" },
        { caseId: "CASE-CCC", url: "https://example.com/admin?tab=cases&caseId=CASE-CCC" },
      ],
      testMode: true,
    });
    expect(sentMail).toHaveLength(1);
    const html = sentMail[0].html as string;
    expect(html).not.toContain("caseId=CASE-AAA");
    expect(html).not.toContain("caseId=CASE-BBB");
    expect(html).not.toContain("caseId=CASE-CCC");
    expect(html).not.toContain("CASE-AAA");
    expect(html).not.toContain("CASE-BBB");
    expect(html).not.toContain("CASE-CCC");
    expect(html).not.toContain("Affected case IDs");
    const anchors = html.match(/<a\s+[^>]*href="[^"]*"/gi) ?? [];
    for (const anchor of anchors) {
      expect(anchor).not.toMatch(/tab=cases&amp;caseId=/);
    }
    expect(html).toContain("Test email");
  });

  it("non-test mode uses nda-integrity-failed logTag and includes the failed-case block", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 42,
      failedRows: 1,
      failedCaseIds: ["CASE-REAL"],
      dashboardUrl: "https://example.com/admin",
    });
    expect(sentMail).toHaveLength(1);
    const mail = sentMail[0];
    expect(mail.subject).not.toMatch(/^\[TEST\]/);
    expect(mail.headers["X-Entity-Ref-ID"]).toBe("nda-integrity-failed");
    expect((mail.html as string)).toContain("CASE-REAL");
    expect((mail.html as string)).toContain("Affected case IDs");
  });

  it("renders each case ID as a clickable deep-link anchor when caseDeepLinks is provided", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 10,
      failedRows: 2,
      failedCaseIds: ["CASE-111", "CASE-222"],
      dashboardUrl: "https://example.com/admin",
      caseDeepLinks: [
        { caseId: "CASE-111", url: "https://example.com/admin?tab=cases&caseId=CASE-111" },
        { caseId: "CASE-222", url: "https://example.com/admin?tab=cases&caseId=CASE-222" },
      ],
    });
    expect(sentMail).toHaveLength(1);
    const html = sentMail[0].html as string;
    expect(html).toContain("Affected case IDs");
    expect(html).toContain('href="https://example.com/admin?tab=cases&amp;caseId=CASE-111"');
    expect(html).toContain('href="https://example.com/admin?tab=cases&amp;caseId=CASE-222"');
    expect(html).toContain(">CASE-111<");
    expect(html).toContain(">CASE-222<");
  });

  it("falls back to plain-text case IDs when caseDeepLinks is omitted", async () => {
    const { emailService } = await import("../services/EmailService");
    await emailService.sendNdaIntegrityFailureAlert({
      to: "ops@example.com",
      sweepFinishedAt: "2026-05-18T10:00:00.000Z",
      totalChecked: 5,
      failedRows: 1,
      failedCaseIds: ["CASE-NO-LINK"],
      dashboardUrl: "https://example.com/admin",
    });
    expect(sentMail).toHaveLength(1);
    const html = sentMail[0].html as string;
    expect(html).toContain("CASE-NO-LINK");
    expect(html).not.toContain('href="https://example.com/admin?tab=cases');
  });
});
