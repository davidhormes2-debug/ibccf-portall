/**
 * Higher-fidelity locale tests for CaseService.updateCase stage-change emails.
 *
 * Unlike caseServiceStageEmail.test.ts, this file does NOT mock EmailService
 * or emailNotify. It mocks only nodemailer's transport so we can capture and
 * inspect the actual rendered subject/body that would go out over SMTP.
 *
 * Covers:
 *   (a) Case with preferredLocale="de" → subject rendered in German.
 *   (b) Case with preferredLocale=null  → subject rendered in English (fallback).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// ── nodemailer mock — capture outbound messages ───────────────────────────────

const sentMessages: { subject: string; html: string; text: string }[] = [];

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: { subject: string; html: string; text: string }) => {
        sentMessages.push(msg);
        return { messageId: "stub" };
      },
    }),
  },
}));

// ── Repository mocks (needed for CaseService.updateCase) ─────────────────────

let mockFindById: ReturnType<typeof vi.fn>;
let mockUpdate: ReturnType<typeof vi.fn>;
let mockCreateAdminMessage: ReturnType<typeof vi.fn>;

vi.mock("../repositories", () => {
  mockFindById = vi.fn();
  mockUpdate = vi.fn();
  mockCreateAdminMessage = vi.fn(async () => ({}));

  return {
    caseRepository: {
      findById: (...args: unknown[]) => (mockFindById as (...a: unknown[]) => unknown)(...args),
      update: (...args: unknown[]) => (mockUpdate as (...a: unknown[]) => unknown)(...args),
    },
    messageRepository: {
      createAdminMessage: (...args: unknown[]) => (mockCreateAdminMessage as (...a: unknown[]) => unknown)(...args),
    },
  };
});

// ── Storage mock (needed for resolveRecipientLocale + audit log) ──────────────

let currentCase: Record<string, unknown> | null = null;

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async () => currentCase),
    createAuditLog: vi.fn(async () => ({ id: 1 })),
  }),
}));

// ── Ensure SMTP_PASSWORD is set so EmailService can build the transporter ─────

process.env.SMTP_PASSWORD ||= "test-smtp-password";

// ── Import after all mocks are hoisted ───────────────────────────────────────

const { caseService } = await import("../services/CaseService");

// ── Flush helper ──────────────────────────────────────────────────────────────
//
// CaseService fires the email inside a setImmediate IIFE that chains several
// awaits (dynamic imports, locale DB lookup, SMTP send, audit log).  A single
// setImmediate flush only *starts* the IIFE; all the async hops inside it
// settle via microtasks / subsequent event-loop turns.  We use vi.waitFor to
// poll until the assertion passes so we don't need to hard-code a delay.

function waitFor(condition: () => void, timeoutMs = 2000): Promise<void> {
  return vi.waitFor(condition, { timeout: timeoutMs });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-locale-test",
    userEmail: "user@example.com",
    userName: "Test User",
    withdrawalStage: "5",
    maxStageReached: 5,
    preferredLocale: "en",
    phraseKeyCertificateSent: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  sentMessages.length = 0;
  currentCase = null;

  mockFindById.mockResolvedValue(makeCase());
  mockUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) =>
    makeCase({ ...data }),
  );
});

describe("CaseService.updateCase — stage-change email rendered locale", () => {
  it("renders the subject in German when case preferredLocale is 'de'", async () => {
    const deCase = makeCase({
      withdrawalStage: "7",
      maxStageReached: 7,
      preferredLocale: "de",
    });

    // Storage lookup used by resolveRecipientLocale inside sendCaseEmailWithAudit
    currentCase = deCase;

    mockFindById.mockResolvedValue(makeCase({ preferredLocale: "de" }));
    mockUpdate.mockResolvedValue(deCase);

    await caseService.updateCase("case-locale-test", { withdrawalStage: "7" });

    // Poll until the async IIFE inside setImmediate finishes and the message lands.
    await waitFor(() => expect(sentMessages).toHaveLength(1));

    // German subject template: "Phase {{stage}} von 14: {{title}} — Fall {{case}}"
    expect(sentMessages[0].subject).toContain("von 14");
    // Must NOT be the English template text
    expect(sentMessages[0].subject).not.toContain("Stage");
    expect(sentMessages[0].subject).not.toContain("of 14");
  });

  it("renders the subject in English when case preferredLocale is null", async () => {
    const enCase = makeCase({
      withdrawalStage: "3",
      maxStageReached: 3,
      preferredLocale: null,
    });

    currentCase = enCase;

    mockFindById.mockResolvedValue(makeCase({ preferredLocale: null }));
    mockUpdate.mockResolvedValue(enCase);

    await caseService.updateCase("case-locale-test", { withdrawalStage: "3" });

    await waitFor(() => expect(sentMessages).toHaveLength(1));

    // English subject template: "Stage {{stage}} of 14: {{title}} — Case {{case}}"
    expect(sentMessages[0].subject).toContain("of 14");
    // Must NOT be German
    expect(sentMessages[0].subject).not.toContain("von 14");
  });
});
