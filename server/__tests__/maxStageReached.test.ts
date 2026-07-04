/**
 * Tests for Task #1035: maxStageReached auto-advance and portal exposure.
 *
 * Coverage:
 *   1. Static source assertions — CaseService.ts correctly:
 *        a. Sets maxStageReached when withdrawalStage advances forward.
 *        b. Does NOT decrement maxStageReached when stage rolls back.
 *        c. Does NOT touch maxStageReached when stage is unchanged.
 *        d. Fires a best-effort stage-change email via sendCaseEmailWithAudit.
 *   2. Static source assertions — GET /api/cases/access/:code response
 *        includes maxStageReached in the allowlisted user-facing payload.
 *   3. Static source assertions — PortalContext Case interface declares
 *        maxStageReached as an optional nullable number.
 *   4. Static source assertions — PortalShell nav gates use Math.max with
 *        maxStageReached for both Sealed Settlement and Withdrawal Activation.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const CASE_SERVICE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/CaseService.ts"),
  "utf8",
);

const CASES_ROUTE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/cases.ts"),
  "utf8",
);

const PORTAL_CONTEXT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../client/src/pages/portal/PortalContext.tsx"),
  "utf8",
);

const PORTAL_SHELL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../client/src/pages/portal/PortalShell.tsx"),
  "utf8",
);

const SCHEMA_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../shared/schema.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. CaseService — maxStageReached auto-advance logic
// ---------------------------------------------------------------------------

describe("CaseService.updateCase — maxStageReached auto-advance", () => {
  it("parses newStage as an integer before comparing", () => {
    expect(CASE_SERVICE_SRC).toContain("parseInt(newStage, 10)");
  });

  it("guards advance with Number.isFinite to reject NaN", () => {
    expect(CASE_SERVICE_SRC).toContain("Number.isFinite(newStageNum)");
  });

  it("only sets maxStageReached when newStageNum > prevMax (never decrements)", () => {
    expect(CASE_SERVICE_SRC).toContain("newStageNum > prevMax");
    expect(CASE_SERVICE_SRC).toContain("data.maxStageReached = newStageNum");
  });

  it("wraps the advance logic inside a newStage truthy guard", () => {
    const sentinelIdx = CASE_SERVICE_SRC.indexOf("// MAX_STAGE_ADVANCE_BLOCK_START");
    expect(sentinelIdx, "// MAX_STAGE_ADVANCE_BLOCK_START sentinel missing from CaseService.ts").toBeGreaterThanOrEqual(0);
    const block = CASE_SERVICE_SRC.slice(sentinelIdx);
    const firstClose = block.indexOf("}");
    expect(block.slice(0, firstClose)).toContain("if (newStage)");
  });

  it("treats NULL maxStageReached as withdrawalStage (not 0) to preserve existing high-water marks", () => {
    // The correct fallback must be the current withdrawalStage, not literal 0.
    // If we used ?? 0, an admin rollback from 14→10 on a NULL row would
    // incorrectly write maxStageReached=10 instead of preserving 14.
    expect(CASE_SERVICE_SRC).toContain(
      "currentCase?.maxStageReached ??\n        parseInt(currentCase?.withdrawalStage ?? '0', 10)",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. CaseService — auto stage-change email
// ---------------------------------------------------------------------------

describe("CaseService.updateCase — auto stage-change email", () => {
  it("fires email only when newStage differs from previousStage", () => {
    expect(CASE_SERVICE_SRC).toContain(
      "newStage && previousStage !== newStage && updated.userEmail",
    );
  });

  it("dispatches fire-and-forget via setImmediate", () => {
    expect(CASE_SERVICE_SRC).toContain("setImmediate(");
  });

  it("uses sendCaseEmailWithAudit for the audit trail", () => {
    expect(CASE_SERVICE_SRC).toContain("sendCaseEmailWithAudit");
  });

  it("uses tag email_stage_auto for the audit row", () => {
    expect(CASE_SERVICE_SRC).toContain("tag: 'email_stage_auto'");
  });

  it("calls sendStageInstructionsEmail with the new stage number", () => {
    expect(CASE_SERVICE_SRC).toContain("sendStageInstructionsEmail(");
    expect(CASE_SERVICE_SRC).toContain("stageNum,");
  });

  it("swallows errors so email failure never surfaces", () => {
    expect(CASE_SERVICE_SRC).toContain("} catch {");
    const sentinelIdx = CASE_SERVICE_SRC.indexOf("// STAGE_EMAIL_CATCH_BLOCK_START");
    expect(sentinelIdx, "// STAGE_EMAIL_CATCH_BLOCK_START sentinel missing from CaseService.ts").toBeGreaterThanOrEqual(0);
    const catchBlock = CASE_SERVICE_SRC.slice(sentinelIdx);
    const closingIdx = catchBlock.indexOf("}");
    expect(catchBlock.slice(0, closingIdx + 1)).toContain("Never let a background email error surface");
  });
});

// ---------------------------------------------------------------------------
// 3. Portal access endpoint — maxStageReached in allowlist
// ---------------------------------------------------------------------------

describe("GET /api/cases/access/:code — maxStageReached in user-facing payload", () => {
  it("includes maxStageReached in the userFacingData object", () => {
    expect(CASES_ROUTE_SRC).toContain("maxStageReached: caseData.maxStageReached");
  });

  it("annotates the field with a comment explaining its purpose", () => {
    expect(CASES_ROUTE_SRC).toContain("maxStageReached");
    expect(CASES_ROUTE_SRC).toContain("Highest stage ever reached");
  });
});

// ---------------------------------------------------------------------------
// 3b. withdrawalRequests.ts — maxStageReached kept in sync on auto-advance
// ---------------------------------------------------------------------------

const WITHDRAWAL_REQUESTS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/withdrawalRequests.ts"),
  "utf8",
);

describe("withdrawalRequests.ts — maxStageReached updated on auto-advance", () => {
  it("includes maxStageReached in the patch when nextStage > prevMax", () => {
    expect(WITHDRAWAL_REQUESTS_SRC).toContain("maxStageReached: nextStage");
  });

  it("treats NULL maxStageReached as withdrawalStage (not 0) in prevMax computation", () => {
    expect(WITHDRAWAL_REQUESTS_SRC).toContain(
      "caseRow.maxStageReached ??\n                parseInt(caseRow.withdrawalStage ?? '0', 10)",
    );
  });

  it("conditionally includes maxStageReached only when nextStage advances beyond prevMax", () => {
    expect(WITHDRAWAL_REQUESTS_SRC).toContain("nextStage > prevMax");
  });
});

// ---------------------------------------------------------------------------
// 3c. migrations/0023 — backfill SQL file exists
// ---------------------------------------------------------------------------

const MIGRATION_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../migrations/0023_max_stage_reached.sql"),
  "utf8",
);

describe("migrations/0023_max_stage_reached.sql — backfill", () => {
  it("adds max_stage_reached column with ADD COLUMN IF NOT EXISTS", () => {
    expect(MIGRATION_SRC).toContain("ADD COLUMN IF NOT EXISTS max_stage_reached INTEGER");
  });

  it("backfills existing rows by casting withdrawal_stage to integer", () => {
    expect(MIGRATION_SRC).toContain("SET max_stage_reached = withdrawal_stage::integer");
  });

  it("only backfills rows where max_stage_reached IS NULL (idempotent)", () => {
    expect(MIGRATION_SRC).toContain("max_stage_reached IS NULL");
  });

  it("guards backfill with numeric regex to skip non-integer withdrawal_stage values", () => {
    expect(MIGRATION_SRC).toMatch(/withdrawal_stage ~ '\^.*\[0-9\]/);
  });
});

// ---------------------------------------------------------------------------
// 4. shared/schema.ts — maxStageReached column definition
// ---------------------------------------------------------------------------

describe("shared/schema.ts — maxStageReached column", () => {
  it("declares maxStageReached as an integer column", () => {
    expect(SCHEMA_SRC).toContain('integer("max_stage_reached")');
  });

  it("is nullable (no .notNull() or .default())", () => {
    const idx = SCHEMA_SRC.indexOf('integer("max_stage_reached")');
    const nextNewline = SCHEMA_SRC.indexOf("\n", idx);
    const line = SCHEMA_SRC.slice(idx, nextNewline === -1 ? undefined : nextNewline);
    expect(line).not.toContain(".notNull()");
    expect(line).not.toContain(".default(");
  });
});

// ---------------------------------------------------------------------------
// 5. PortalContext — Case interface includes maxStageReached
// ---------------------------------------------------------------------------

describe("PortalContext — Case interface maxStageReached field", () => {
  it("declares maxStageReached as optional nullable number", () => {
    expect(PORTAL_CONTEXT_SRC).toContain("maxStageReached?: number | null");
  });
});

// ---------------------------------------------------------------------------
// 6. PortalShell — nav gates use Math.max with maxStageReached
// ---------------------------------------------------------------------------

describe("PortalShell — nav gate logic uses maxStageReached", () => {
  it("uses Math.max with maxStageReached for the Sealed Settlement gate", () => {
    const sealedSentinelIdx = PORTAL_SHELL_SRC.indexOf("// SEALED_SETTLEMENT_NAV_ENTRY_START");
    expect(sealedSentinelIdx, "// SEALED_SETTLEMENT_NAV_ENTRY_START sentinel missing from PortalShell.tsx").toBeGreaterThanOrEqual(0);
    const activationSentinelIdx = PORTAL_SHELL_SRC.indexOf("// WITHDRAWAL_ACTIVATION_NAV_ENTRY_START");
    expect(activationSentinelIdx, "// WITHDRAWAL_ACTIVATION_NAV_ENTRY_START sentinel missing from PortalShell.tsx").toBeGreaterThanOrEqual(0);
    const sealedBlock = PORTAL_SHELL_SRC.slice(sealedSentinelIdx, activationSentinelIdx);
    expect(sealedBlock).toContain("Math.max(");
    expect(sealedBlock).toContain("maxStageReached ?? 0");
    expect(sealedBlock).toContain("stage >= 14");
  });

  it("uses Math.max with maxStageReached for the Withdrawal Activation gate", () => {
    const activationSentinelIdx = PORTAL_SHELL_SRC.indexOf("// WITHDRAWAL_ACTIVATION_NAV_ENTRY_START");
    expect(activationSentinelIdx, "// WITHDRAWAL_ACTIVATION_NAV_ENTRY_START sentinel missing from PortalShell.tsx").toBeGreaterThanOrEqual(0);
    const activationBlock = PORTAL_SHELL_SRC.slice(activationSentinelIdx);
    const endAnchor = activationBlock.indexOf('{ id: "settings"');
    const nextBlock = activationBlock.slice(0, endAnchor === -1 ? undefined : endAnchor);
    expect(nextBlock).toContain("Math.max(");
    expect(nextBlock).toContain("maxStageReached ?? 0");
    expect(nextBlock).toContain("stage < 14");
  });

  it("uses withdrawalStage as the primary input to Math.max for both gates", () => {
    const count = (PORTAL_SHELL_SRC.match(/parseInt\(currentCase\?\.withdrawalStage/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
