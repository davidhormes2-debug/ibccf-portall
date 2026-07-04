import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStorageMock } from "./helpers/storageMock";

// Task #129 — verify the periodic sweep in server/community-cleanup.ts writes a
// single audit row per non-empty batch, carrying the row count, retention
// window, and a capped sample of affected case IDs. This is what gives ops a
// trail when the participant table shrinks unexpectedly.

const pruneMock = vi.fn();
const createAuditLogMock = vi.fn(async (_entry?: any) => undefined);
const getAppSettingMock = vi.fn(async () => undefined);

vi.mock("../storage", () => ({
  storage: createStorageMock({
    pruneCommunityParticipantsForInactiveCases: pruneMock,
    createAuditLog: createAuditLogMock,
    getAppSetting: getAppSettingMock,
  }),
}));

beforeEach(() => {
  pruneMock.mockReset();
  createAuditLogMock.mockClear();
  getAppSettingMock.mockReset();
  getAppSettingMock.mockResolvedValue(undefined);
  delete process.env.COMMUNITY_PARTICIPANT_RETENTION_DAYS;
  vi.resetModules();
});

describe("runCommunityParticipantCleanup", () => {
  it("writes a single community_participant_cleanup audit row with the row count and sample case IDs when the prune is non-empty", async () => {
    pruneMock.mockResolvedValue({
      removed: 3,
      caseIds: ["case-1", "case-2", "case-3"],
    });

    const mod = await import("../community-cleanup");
    // runCommunityParticipantCleanup now returns a result object
    // ({ removed, retentionDays, cutoff, skipped }) so callers can
    // distinguish a no-op from a skipped re-entrant tick. The pruned
    // row count moved from the bare return value to `result.removed`.
    const result = await mod.runCommunityParticipantCleanup();

    expect(result.removed).toBe(3);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    const entry = createAuditLogMock.mock.calls[0][0];
    expect(entry.action).toBe(mod.COMMUNITY_PARTICIPANT_CLEANUP_AUDIT_ACTION);
    expect(entry.adminUsername).toBe("system");
    expect(entry.targetType).toBe("community_participants");
    expect(entry.targetId).toBeNull();

    const payload = JSON.parse(entry.newValue as string);
    expect(payload.removed).toBe(3);
    expect(payload.retentionDays).toBe(
      mod.COMMUNITY_PARTICIPANT_RETENTION_DEFAULT_DAYS,
    );
    expect(payload.sampleCaseIds).toEqual(["case-1", "case-2", "case-3"]);
    expect(payload.sampleTruncated).toBe(false);
    expect(typeof payload.cutoff).toBe("string");
    expect(Number.isFinite(Date.parse(payload.cutoff))).toBe(true);
  });

  it("caps the audit payload's sampleCaseIds at 50 and marks sampleTruncated", async () => {
    const many = Array.from({ length: 75 }, (_, i) => `case-${i + 1}`);
    pruneMock.mockResolvedValue({ removed: many.length, caseIds: many });

    const mod = await import("../community-cleanup");
    await mod.runCommunityParticipantCleanup();

    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      createAuditLogMock.mock.calls[0][0].newValue as string,
    );
    expect(payload.removed).toBe(75);
    expect(payload.sampleCaseIds).toHaveLength(50);
    expect(payload.sampleCaseIds[0]).toBe("case-1");
    expect(payload.sampleCaseIds[49]).toBe("case-50");
    expect(payload.sampleTruncated).toBe(true);
  });

  it("does not write any audit row when the prune is a no-op", async () => {
    pruneMock.mockResolvedValue({ removed: 0, caseIds: [] });

    const mod = await import("../community-cleanup");
    const result = await mod.runCommunityParticipantCleanup();

    expect(result.removed).toBe(0);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });
});
