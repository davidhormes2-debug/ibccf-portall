import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn(async () => ({ messageId: "mocked" })),
    }),
  },
}));

process.env.SMTP_PASSWORD = process.env.SMTP_PASSWORD ?? "test-password";

describe("EmailService.buildTokenWalletConfirmedEmailHtml", () => {
  it("returns the correct subject line including the case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    const { subject } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Alice Smith",
      "CASE-001",
    );
    expect(subject).toBe("Token Wallet Setup Confirmed — Case CASE-001");
  });

  it("returns the expected preheader text", async () => {
    const { emailService } = await import("../services/EmailService");
    const { preheader } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Alice Smith",
      "CASE-001",
    );
    expect(preheader).toBe(
      "Your token wallet setup has been verified by your compliance officer.",
    );
  });

  it("html includes the user name in the greeting", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Bob Jones",
      "CASE-002",
    );
    expect(html).toContain("Bob Jones");
  });

  it("html includes the case reference in the reference card", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Carol White",
      "CASE-XYZ",
    );
    expect(html).toContain("CASE-XYZ");
  });

  it("html includes the 'What This Means' section heading", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Dave Brown",
      "CASE-003",
    );
    expect(html).toContain("What This Means");
  });

  it("html includes the 'Case Reference' label in the card", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Eve Green",
      "CASE-004",
    );
    expect(html).toContain("Case Reference");
  });

  it("html includes a View Portal CTA link", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Frank Black",
      "CASE-005",
    );
    expect(html).toContain("View Portal");
    expect(html).toContain("/portal?view=dashboard");
  });

  it("html escapes special characters in the user name to prevent XSS", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "<script>alert('xss')</script>",
      "CASE-006",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("html escapes special characters in the case reference to prevent XSS", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Normal User",
      "<img src=x onerror=alert(1)>",
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("subject adapts to a different case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    const { subject } = emailService.buildTokenWalletConfirmedEmailHtml(
      "Grace",
      "REF-99999",
    );
    expect(subject).toContain("REF-99999");
  });
});
