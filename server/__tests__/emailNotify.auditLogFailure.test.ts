import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Stub out the fire-and-forget failure-alert so it never interferes with these
// narrow unit assertions.
vi.mock("../services/emailFailureAlert", () => ({
  maybeAlertOnEmailFailure: vi.fn(async () => {}),
  recordEmailFailure: vi.fn(),
}));

let auditLogShouldThrow: Error | null = null;
const auditLogs: any[] = [];

vi.mock("../storage", () => ({
  storage: createStorageMock({
    getCaseById: vi.fn(async () => ({
      id: "case-1",
      userEmail: "user@example.com",
      preferredLocale: "en",
    })),
    createAuditLog: vi.fn(async (entry: any) => {
      if (auditLogShouldThrow) throw auditLogShouldThrow;
      auditLogs.push(entry);
      return { id: auditLogs.length, ...entry };
    }),
  }),
}));

const { sendCaseEmailWithAudit } = await import("../services/emailNotify");
const { __resetWarnDedupForTests } = await import("../lib/warnOnce");

beforeEach(() => {
  auditLogShouldThrow = null;
  auditLogs.length = 0;
  __resetWarnDedupForTests();
  vi.clearAllMocks();
});

describe("sendCaseEmailWithAudit — audit log write failure", () => {
  it("returns sent:true and auditFailed:true when the email succeeds but audit log throws", async () => {
    auditLogShouldThrow = new Error("DB connection lost");

    const result = await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    expect(result.sent).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.auditFailed).toBe(true);
  });

  it("returns sent:false, preserves the SMTP error, and sets auditFailed:true when both email send and audit log fail", async () => {
    auditLogShouldThrow = new Error("DB connection lost");

    const result = await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "activation",
      send: async () => ({ success: false, error: "smtp timeout" }),
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe("smtp timeout");
    expect(result.auditFailed).toBe(true);
  });

  it("calls warnOnce with a key containing the tag when audit log throws", async () => {
    auditLogShouldThrow = new Error("write failed");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "stage-instructions",
      send: async () => ({ success: true }),
    });

    // warnOnce calls console.warn with the message string as the first arg.
    const matched = warnSpy.mock.calls.filter(
      ([msg]) =>
        typeof msg === "string" && msg.includes("stage-instructions"),
    );
    expect(matched.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });

  it("warnOnce key includes the tag so different tags have independent dedup windows", async () => {
    auditLogShouldThrow = new Error("DB gone");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First tag.
    await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    // Second tag — different key, so dedup does NOT suppress it.
    await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "activation",
      send: async () => ({ success: true }),
    });

    const letterReadyWarns = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("letter-ready"),
    );
    const activationWarns = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("activation"),
    );
    expect(letterReadyWarns.length).toBe(1);
    expect(activationWarns.length).toBe(1);

    warnSpy.mockRestore();
  });

  it("deduplicates the audit-log warning for the same tag within the dedup window", async () => {
    auditLogShouldThrow = new Error("DB gone");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    // Second call with the same tag — warnOnce should suppress the repeat.
    await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    const letterReadyWarns = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("letter-ready"),
    );
    expect(letterReadyWarns.length).toBe(1);

    warnSpy.mockRestore();
  });

  it("does NOT set auditFailed when the audit log write succeeds", async () => {
    const result = await sendCaseEmailWithAudit({
      to: "user@example.com",
      caseId: "case-1",
      tag: "letter-ready",
      send: async () => ({ success: true }),
    });

    expect(result.sent).toBe(true);
    expect(result.auditFailed).toBeUndefined();
  });
});
