/**
 * Behavioral tests for CaseService stage-sequence enforcement (Task #1951).
 *
 * These tests mock the repository layer and directly execute
 * CaseService.updateCase to assert real runtime pass/fail behavior:
 *   - Sequential forward transition is allowed.
 *   - Skip-forward transition is rejected with 400.
 *   - Backward transition is rejected with 400.
 *   - Initial assignment (null → any) is always allowed.
 *   - No-op (same stage) is always allowed.
 *   - overrideStageSequence from non-super_admin is rejected with 403
 *     immediately, regardless of whether the transition is sequential.
 *   - super_admin with override + reason is allowed for non-sequential transitions.
 *   - super_admin with override but empty reason is rejected with 400.
 *   - Error messages are informative and mention stage numbers / role names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories", () => ({
  caseRepository: {
    findById: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findAll: vi.fn(),
    findByAccessCode: vi.fn(),
    getLetter: vi.fn(),
    createOrUpdateLetter: vi.fn(),
    delete: vi.fn(),
  },
  messageRepository: {
    createAdminMessage: vi.fn(),
  },
  depositRepository: {
    findById: vi.fn(),
  },
}));

import { caseService, StageTransitionError } from "../services/CaseService";
import { caseRepository, messageRepository } from "../repositories";

function makeCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "case-1",
    withdrawalStage: "3",
    maxStageReached: null,
    phraseKeyCertificateSent: false,
    userEmail: null,
    userName: null,
    preferredLocale: null,
    phraseKeyDepositAmount: null,
    phraseKeyMergeDeposit: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(messageRepository.createAdminMessage).mockResolvedValue(undefined as never);
  vi.mocked(caseRepository.update).mockImplementation(async (_id, data) =>
    ({ ...makeCase(), ...data }) as never,
  );
});

describe("CaseService.updateCase — sequential transition enforcement", () => {
  it("allows a sequential forward transition (stage 3 → 4)", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "4" });
    expect(result).toBeDefined();
  });

  it("allows stage 1 → 2 (first real transition)", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "1" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "2" });
    expect(result).toBeDefined();
  });

  it("rejects a skip-forward transition (stage 3 → 5) with statusCode 400", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "5" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 400);
  });

  it("rejects a backward transition (stage 5 → 3) with statusCode 400", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "5" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "3" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 400);
  });

  it("allows initial assignment (null → stage 7) unconditionally", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: null }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "7" });
    expect(result).toBeDefined();
  });

  it("allows a no-op update (stage 5 → 5) unconditionally", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "5" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "5" });
    expect(result).toBeDefined();
  });

  it("allows an update that does not touch withdrawalStage at all", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "5" }) as never);
    const result = await caseService.updateCase("case-1", { userName: "Alice" } as never);
    expect(result).toBeDefined();
  });

  it("skip-forward error message mentions current and requested stage numbers", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "2" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "5" }),
    ).rejects.toThrow(/current stage:? 2.*requested:? 5/i);
  });
});

describe("CaseService.updateCase — non-super_admin override rejection", () => {
  it("rejects overrideStageSequence=true from role 'admin' with statusCode 403", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "5" }, undefined, {
        adminRole: "admin",
        overrideStageSequence: true,
        overrideReason: "some reason",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 403);
  });

  it("rejects overrideStageSequence=true from role 'agent' with statusCode 403", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "4" }, undefined, {
        adminRole: "agent",
        overrideStageSequence: true,
        overrideReason: "some reason",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 403);
  });

  it("rejects overrideStageSequence=true from role 'viewer' even for a sequential transition", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "4" }, undefined, {
        adminRole: "viewer",
        overrideStageSequence: true,
        overrideReason: "reason",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 403);
  });

  it("403 error message mentions super_admin as the required role", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "5" }, undefined, {
        adminRole: "agent",
        overrideStageSequence: true,
        overrideReason: "reason",
      }),
    ).rejects.toThrow(/super_admin/i);
  });
});

describe("CaseService.updateCase — super_admin override", () => {
  it("allows super_admin to skip forward (stage 3 → 7) with a non-empty reason", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "7" }, undefined, {
      adminRole: "super_admin",
      overrideStageSequence: true,
      overrideReason: "Emergency compliance bypass approved by legal team",
    });
    expect(result).toBeDefined();
  });

  it("allows super_admin to move backward (stage 10 → 5) with a non-empty reason", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "10" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "5" }, undefined, {
      adminRole: "super_admin",
      overrideStageSequence: true,
      overrideReason: "Correction required per compliance review",
    });
    expect(result).toBeDefined();
  });

  it("rejects super_admin override with empty reason string with statusCode 400", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "7" }, undefined, {
        adminRole: "super_admin",
        overrideStageSequence: true,
        overrideReason: "",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 400);
  });

  it("rejects super_admin override with whitespace-only reason with statusCode 400", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "7" }, undefined, {
        adminRole: "super_admin",
        overrideStageSequence: true,
        overrideReason: "   ",
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 400);
  });

  it("rejects super_admin override with undefined reason with statusCode 400", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "3" }) as never);
    await expect(
      caseService.updateCase("case-1", { withdrawalStage: "7" }, undefined, {
        adminRole: "super_admin",
        overrideStageSequence: true,
        overrideReason: undefined,
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof StageTransitionError && e.statusCode === 400);
  });

  it("allows super_admin sequential transition without override flag (normal path)", async () => {
    vi.mocked(caseRepository.findById).mockResolvedValue(makeCase({ withdrawalStage: "6" }) as never);
    const result = await caseService.updateCase("case-1", { withdrawalStage: "7" }, undefined, {
      adminRole: "super_admin",
    });
    expect(result).toBeDefined();
  });
});

describe("StageTransitionError — class shape", () => {
  it("has statusCode 400 for out-of-sequence errors", () => {
    const e = new StageTransitionError("out of sequence", 400);
    expect(e.statusCode).toBe(400);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(StageTransitionError);
    expect(e.name).toBe("StageTransitionError");
  });

  it("has statusCode 403 for role-forbidden errors", () => {
    const e = new StageTransitionError("forbidden override", 403);
    expect(e.statusCode).toBe(403);
  });

  it("message is the string passed to the constructor", () => {
    const e = new StageTransitionError("test message", 400);
    expect(e.message).toBe("test message");
  });
});
