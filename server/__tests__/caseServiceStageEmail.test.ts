/**
 * Integration tests for the auto stage-change email in CaseService.updateCase.
 *
 * Covers:
 *   (a) Stage changes → sendCaseEmailWithAudit fires once with the correct stage number.
 *   (b) Same stage (no change) → no email dispatched.
 *   (c) Stage changes but case has no userEmail → no email dispatched.
 *
 * The setImmediate fire-and-forget is flushed with a zero-delay await so no
 * real timers or DB/SMTP connections are needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Repository mocks ────────────────────────────────────────────────────────

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

// ── emailNotify mock ─────────────────────────────────────────────────────────

const sendCaseEmailWithAuditMock = vi.fn(async (_arg?: unknown) => ({ sent: true }));

vi.mock("../services/emailNotify", () => ({
  sendCaseEmailWithAudit: (...args: Parameters<typeof sendCaseEmailWithAuditMock>) =>
    sendCaseEmailWithAuditMock(...args),
  resolveRecipientLocale: vi.fn(async () => "en"),
}));

// ── EmailService mock ────────────────────────────────────────────────────────

const sendStageInstructionsEmailMock = vi.fn(async (_arg?: unknown) => ({ success: true }));

import { createEmailServiceMock } from "./helpers/emailServiceMock";
vi.mock("../services/EmailService", () => ({
  emailService: createEmailServiceMock({
    sendStageInstructionsEmail: (...args: Parameters<typeof sendStageInstructionsEmailMock>) =>
      sendStageInstructionsEmailMock(...args),
  }),
}));

// ── Import CaseService after mocks are in place ──────────────────────────────

const { caseService } = await import("../services/CaseService");

// ── Helper: flush the setImmediate queue ─────────────────────────────────────

function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-123",
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

  // Default: findById returns a case at stage 5; update echoes the merged result.
  mockFindById.mockResolvedValue(makeCase());
  mockUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) =>
    makeCase({ ...data }),
  );
});

describe("CaseService.updateCase — stage-change email", () => {
  it("fires sendCaseEmailWithAudit once when withdrawalStage advances", async () => {
    // Current stage = 5, new stage = 6 (sequential)
    mockUpdate.mockResolvedValue(
      makeCase({ withdrawalStage: "6", maxStageReached: 6 }),
    );

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).toHaveBeenCalledTimes(1);

    const callArgs = sendCaseEmailWithAuditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.caseId).toBe("case-123");
    expect(callArgs.tag).toBe("email_stage_auto");
    expect(callArgs.to).toBe("user@example.com");
  });

  it("passes the correct stage number to sendStageInstructionsEmail via the send callback", async () => {
    mockUpdate.mockResolvedValue(
      makeCase({ withdrawalStage: "6", maxStageReached: 6 }),
    );

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).toHaveBeenCalledTimes(1);

    // Invoke the send callback captured in the mock call to verify it reaches
    // sendStageInstructionsEmail with the expected stage number (6).
    const { send } = sendCaseEmailWithAuditMock.mock.calls[0][0] as {
      send: (locale: string) => Promise<unknown>;
    };
    await send("en");

    expect(sendStageInstructionsEmailMock).toHaveBeenCalledTimes(1);
    const [_to, _name, _caseId, stageNum] =
      sendStageInstructionsEmailMock.mock.calls[0] as unknown[];
    expect(stageNum).toBe(6);
  });

  it("does NOT fire an email when withdrawalStage is unchanged", async () => {
    // Current stage = 5, update also sets stage = 5 (same value).
    mockUpdate.mockResolvedValue(makeCase({ withdrawalStage: "5" }));

    await caseService.updateCase("case-123", { withdrawalStage: "5" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).not.toHaveBeenCalled();
  });

  it("does NOT fire an email when the update does not include a stage change", async () => {
    mockUpdate.mockResolvedValue(makeCase({ userName: "Updated Name" }));

    await caseService.updateCase("case-123", { userName: "Updated Name" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).not.toHaveBeenCalled();
  });

  it("does NOT fire an email when the case has no userEmail", async () => {
    mockFindById.mockResolvedValue(makeCase({ userEmail: null, withdrawalStage: "5" }));
    mockUpdate.mockResolvedValue(
      makeCase({ userEmail: null, withdrawalStage: "6", maxStageReached: 6 }),
    );

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).not.toHaveBeenCalled();
  });

  it("fires a single email even if updateCase is called twice in succession with the same new stage", async () => {
    mockUpdate
      .mockResolvedValueOnce(makeCase({ withdrawalStage: "6", maxStageReached: 6 }))
      .mockResolvedValueOnce(makeCase({ withdrawalStage: "6", maxStageReached: 6 }));

    // First call: stage 5 → 6  (fires)
    await caseService.updateCase("case-123", { withdrawalStage: "6" });

    // Second call: findById now returns stage 6, same new stage → no fire.
    mockFindById.mockResolvedValue(makeCase({ withdrawalStage: "6", maxStageReached: 6 }));
    await caseService.updateCase("case-123", { withdrawalStage: "6" });

    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire an email when updateCase returns undefined (case not found)", async () => {
    mockUpdate.mockResolvedValue(undefined);

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).not.toHaveBeenCalled();
  });
});

describe("CaseService.updateCase — stage-change email locale wiring", () => {
  it("passes preferredLocale='de' through the send callback to sendStageInstructionsEmail", async () => {
    // Case stored with German locale preference
    mockFindById.mockResolvedValue(makeCase({ preferredLocale: "de" }));
    mockUpdate.mockResolvedValue(
      makeCase({ withdrawalStage: "6", maxStageReached: 6, preferredLocale: "de" }),
    );

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).toHaveBeenCalledTimes(1);

    // Extract the send callback that CaseService registered.
    const { send } = sendCaseEmailWithAuditMock.mock.calls[0][0] as {
      send: (locale: string) => Promise<unknown>;
    };

    // sendCaseEmailWithAudit resolves the DB-stored locale ("de") and passes it
    // to the callback.  The callback must forward it to sendStageInstructionsEmail.
    await send("de");

    expect(sendStageInstructionsEmailMock).toHaveBeenCalledTimes(1);
    const callArgs = sendStageInstructionsEmailMock.mock.calls[0] as unknown[];
    // 6th argument (index 5) is the locale
    expect(callArgs[5]).toBe("de");
  });

  it("passes undefined locale when preferredLocale is null, triggering the English fallback in EmailService", async () => {
    // Case with no locale preference stored
    mockFindById.mockResolvedValue(makeCase({ preferredLocale: null }));
    mockUpdate.mockResolvedValue(
      makeCase({ withdrawalStage: "6", maxStageReached: 6, preferredLocale: null }),
    );

    await caseService.updateCase("case-123", { withdrawalStage: "6" });
    await flushSetImmediate();

    expect(sendCaseEmailWithAuditMock).toHaveBeenCalledTimes(1);

    const { send } = sendCaseEmailWithAuditMock.mock.calls[0][0] as {
      send: (locale: string | undefined) => Promise<unknown>;
    };

    // When there is no saved locale, sendCaseEmailWithAudit resolves undefined.
    // The send callback must propagate undefined so EmailService uses its own
    // English default.
    await send(undefined);

    expect(sendStageInstructionsEmailMock).toHaveBeenCalledTimes(1);
    const callArgs = sendStageInstructionsEmailMock.mock.calls[0] as unknown[];
    // 6th argument (index 5) is the locale — must be undefined (not "de" or any
    // other non-English locale).
    expect(callArgs[5]).toBeUndefined();
  });
});
