import { describe, it, expect } from "vitest";
import { vi } from "vitest";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn(async () => ({ messageId: "mocked" })),
    }),
  },
}));

process.env.SMTP_PASSWORD = process.env.SMTP_PASSWORD ?? "test-password";

describe("EmailService.buildTokenWalletSetupGuideEmailHtml", () => {
  it("returns the correct subject line including the case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    const { subject } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Alice Smith",
      "CASE-001",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(subject).toBe(
      "Your Token Wallet Setup Guide Is Ready — Case CASE-001",
    );
  });

  it("returns the expected preheader text", async () => {
    const { emailService } = await import("../services/EmailService");
    const { preheader } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Alice Smith",
      "CASE-001",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(preheader).toBe(
      "Your compliance officer has shared your token wallet setup guide.",
    );
  });

  it("html includes the user name in the greeting", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Bob Jones",
      "CASE-002",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(html).toContain("Bob Jones");
  });

  it("html includes the setup link", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Carol White",
      "CASE-003",
      { setupLink: "https://setup.example.com/unique-path" },
    );
    expect(html).toContain("https://setup.example.com/unique-path");
  });

  it("html includes the 'What To Do Next' section when no note is provided", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Dave Brown",
      "CASE-004",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(html).toContain("What To Do Next");
  });

  it("html includes a portal CTA link", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Eve Green",
      "CASE-005",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(html).toContain("Open Portal");
    expect(html).toContain("/portal?view=dashboard");
  });

  it("html does NOT include an officer note block when note is omitted", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Frank Black",
      "CASE-006",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(html).not.toContain("Officer Note");
  });

  it("html does NOT include an officer note block when note is null", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Grace Hall",
      "CASE-007",
      { setupLink: "https://setup.example.com/guide", note: null },
    );
    expect(html).not.toContain("Officer Note");
  });

  it("html does NOT include an officer note block when note is whitespace only", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Henry Lee",
      "CASE-008",
      { setupLink: "https://setup.example.com/guide", note: "   " },
    );
    expect(html).not.toContain("Officer Note");
  });

  it("html includes the officer note section heading when a note is provided", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Ivy Chen",
      "CASE-009",
      {
        setupLink: "https://setup.example.com/guide",
        note: "Please complete within 48 hours.",
      },
    );
    expect(html).toContain("Officer Note");
  });

  it("html includes the note content when a note is provided", async () => {
    const { emailService } = await import("../services/EmailService");
    const note = "Please complete within 48 hours.";
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Jack Kim",
      "CASE-010",
      { setupLink: "https://setup.example.com/guide", note },
    );
    expect(html).toContain("Please complete within 48 hours.");
  });

  it("html escapes special characters in the user name to prevent XSS", async () => {
    const { emailService } = await import("../services/EmailService");
    const { html } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "<script>alert('xss')</script>",
      "CASE-011",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("subject adapts to a different case reference", async () => {
    const { emailService } = await import("../services/EmailService");
    const { subject } = emailService.buildTokenWalletSetupGuideEmailHtml(
      "Karen Wu",
      "REF-77777",
      { setupLink: "https://setup.example.com/guide" },
    );
    expect(subject).toContain("REF-77777");
  });
});
