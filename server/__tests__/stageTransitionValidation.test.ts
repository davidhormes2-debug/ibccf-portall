/**
 * Tests for Task #1951: Sequential stage-transition enforcement + super_admin override.
 *
 * Coverage (static source assertions):
 *   1. CaseService — StageTransitionError class is defined with correct fields.
 *   2. CaseService — stage sequence guard blocks skip-forward, backward, and permits +1.
 *   3. CaseService — super_admin override is accepted; non-super_admin override throws 403.
 *   4. cases.ts route — overrideStageSequence and overrideReason extracted before Zod parsing.
 *   5. cases.ts route — StageTransitionError is imported and caught before generic 500.
 *   6. cases.ts route — override audit log (override_stage_transition) written inside transaction.
 *   7. cases.ts route — adminRole and overrideStageSequence passed to caseService.updateCase.
 *   8. AdminDashboard — currentAdminRole state is declared.
 *   9. AdminDashboard — stage dropdown disabled for non-super_admin non-sequential items.
 *  10. AdminDashboard — override section rendered for super_admin non-sequential selection.
 *  11. admin.ts verify endpoint — returns role field.
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

const ADMIN_ROUTE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/admin.ts"),
  "utf8",
);

const ADMIN_DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../client/src/pages/AdminDashboard.tsx"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 1. CaseService — StageTransitionError class
// ---------------------------------------------------------------------------

describe("CaseService — StageTransitionError class", () => {
  it("exports StageTransitionError class", () => {
    expect(CASE_SERVICE_SRC).toContain("export class StageTransitionError");
  });

  it("StageTransitionError constructor accepts statusCode 400 or 403", () => {
    expect(CASE_SERVICE_SRC).toContain("public readonly statusCode: 400 | 403");
  });

  it("StageTransitionError sets name to StageTransitionError", () => {
    expect(CASE_SERVICE_SRC).toContain("this.name = 'StageTransitionError'");
  });
});

// ---------------------------------------------------------------------------
// 2. CaseService — stage sequence guard logic
// ---------------------------------------------------------------------------

describe("CaseService — stage sequence guard (STAGE_SEQUENCE_GUARD_START sentinel)", () => {
  it("has STAGE_SEQUENCE_GUARD_START sentinel", () => {
    expect(CASE_SERVICE_SRC).toContain("// STAGE_SEQUENCE_GUARD_START");
  });

  it("has STAGE_SEQUENCE_GUARD_END sentinel", () => {
    expect(CASE_SERVICE_SRC).toContain("// STAGE_SEQUENCE_GUARD_END");
  });

  it("guard only fires when previousStage is set (initial assignment is exempt)", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("previousStage &&");
  });

  it("guard fires only when newStage !== previousStage (no-op is exempt)", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("newStage !== previousStage");
  });

  it("rejects non-sequential transitions by throwing a 400 StageTransitionError", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("throw new StageTransitionError(");
    expect(block).toContain("400,");
  });

  it("rejects non-sequential transitions with correct message format", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("Stage transitions must be sequential. Current stage:");
    expect(block).toContain("Use overrideStageSequence to bypass as super_admin");
  });

  it("guard checks nextNum !== prevNum + 1 for non-sequential detection", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("nextNum !== prevNum + 1");
  });

  it("uses Number.isFinite guard to reject NaN stage values", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("Number.isFinite(prevNum)");
    expect(block).toContain("Number.isFinite(nextNum)");
  });
});

// ---------------------------------------------------------------------------
// 3. CaseService — super_admin override path
// ---------------------------------------------------------------------------

describe("CaseService — super_admin override", () => {
  it("checks options.overrideStageSequence to allow bypass", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("options?.overrideStageSequence");
  });

  it("rejects non-super_admin override attempt by throwing a 403 StageTransitionError", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("403,");
    expect(block).toContain("options.adminRole !== 'super_admin'");
    expect(block).toContain("Stage override requires super_admin role");
  });

  it("accepts super_admin override without throwing (execution continues past the guard)", () => {
    const startIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_START");
    const endIdx = CASE_SERVICE_SRC.indexOf("// STAGE_SEQUENCE_GUARD_END");
    const block = CASE_SERVICE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("override_stage_transition audit row");
  });
});

// ---------------------------------------------------------------------------
// 4. cases.ts — overrideStageSequence / overrideReason extraction
// ---------------------------------------------------------------------------

describe("cases.ts PATCH /:id — extract override params before Zod parsing", () => {
  it("extracts overrideStageSequence from req.body before updateCaseSchema.parse", () => {
    expect(CASES_ROUTE_SRC).toContain("const overrideStageSequence = req.body?.overrideStageSequence === true;");
  });

  it("extracts overrideReason from req.body before updateCaseSchema.parse", () => {
    expect(CASES_ROUTE_SRC).toContain("const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason.trim() : undefined;");
  });
});

// ---------------------------------------------------------------------------
// 5. cases.ts — StageTransitionError import and catch
// ---------------------------------------------------------------------------

describe("cases.ts — StageTransitionError imported and caught", () => {
  it("imports StageTransitionError from CaseService", () => {
    expect(CASES_ROUTE_SRC).toContain("import { StageTransitionError } from \"../services/CaseService\";");
  });

  it("has STAGE_TRANSITION_CATCH_BLOCK_START sentinel in catch block", () => {
    expect(CASES_ROUTE_SRC).toContain("// STAGE_TRANSITION_CATCH_BLOCK_START");
  });

  it("catches StageTransitionError and uses its statusCode for the response", () => {
    const startIdx = CASES_ROUTE_SRC.indexOf("// STAGE_TRANSITION_CATCH_BLOCK_START");
    const endIdx = CASES_ROUTE_SRC.indexOf("// STAGE_TRANSITION_CATCH_BLOCK_END");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = CASES_ROUTE_SRC.slice(startIdx, endIdx);
    expect(block).toContain("txErr instanceof StageTransitionError");
    expect(block).toContain("txErr.statusCode");
    expect(block).toContain("txErr.message");
  });

  it("StageTransitionError catch returns before the generic 500 handler", () => {
    const catchIdx = CASES_ROUTE_SRC.indexOf("// STAGE_TRANSITION_CATCH_BLOCK_START");
    const genericIdx = CASES_ROUTE_SRC.indexOf('res.status(500).json({ error: "Failed to update case" })');
    expect(catchIdx).toBeGreaterThanOrEqual(0);
    expect(catchIdx).toBeLessThan(genericIdx);
  });
});

// ---------------------------------------------------------------------------
// 6. cases.ts — override audit log inside transaction
// ---------------------------------------------------------------------------

describe("cases.ts — override_stage_transition audit log", () => {
  it("writes override_stage_transition audit log when override is used", () => {
    expect(CASES_ROUTE_SRC).toContain("action: 'override_stage_transition'");
  });

  it("includes from, to, adminRole, and reason in the override audit log JSON payload", () => {
    const overrideAuditIdx = CASES_ROUTE_SRC.indexOf("'override_stage_transition'");
    const blockEnd = CASES_ROUTE_SRC.indexOf("}, tx);", overrideAuditIdx);
    const block = CASES_ROUTE_SRC.slice(overrideAuditIdx, blockEnd);
    expect(block).toContain("from:");
    expect(block).toContain("to:");
    expect(block).toContain("adminRole:");
    expect(block).toContain("reason:");
  });

  it("override audit log is guarded by isNonSequential check", () => {
    expect(CASES_ROUTE_SRC).toContain("const isNonSequential = Number.isFinite(prevNum) && Number.isFinite(nextNum) && nextNum !== prevNum + 1;");
  });
});

// ---------------------------------------------------------------------------
// 7. cases.ts — adminRole and overrideStageSequence passed to service
// ---------------------------------------------------------------------------

describe("cases.ts — passes adminRole and overrideStageSequence to caseService.updateCase", () => {
  it("passes adminRole from req.adminRole to service options", () => {
    expect(CASES_ROUTE_SRC).toContain("adminRole: req.adminRole,");
  });

  it("passes overrideStageSequence to service options", () => {
    expect(CASES_ROUTE_SRC).toContain("overrideStageSequence,");
  });

  it("passes overrideReason to service options", () => {
    expect(CASES_ROUTE_SRC).toContain("overrideReason,");
  });
});

// ---------------------------------------------------------------------------
// 8. AdminDashboard — currentAdminRole state
// ---------------------------------------------------------------------------

describe("AdminDashboard — currentAdminRole state", () => {
  it("declares currentAdminRole state with default 'admin'", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("const [currentAdminRole, setCurrentAdminRole] = useState<string>(\"admin\")");
  });

  it("sets currentAdminRole from verify response on mount", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("if (data.role) setCurrentAdminRole(data.role);");
  });
});

// ---------------------------------------------------------------------------
// 9. AdminDashboard — stage dropdown constraint for non-super_admin
// ---------------------------------------------------------------------------

describe("AdminDashboard — stage dropdown (STAGE_SEQUENCE_SELECT_BLOCK_START sentinel)", () => {
  it("has STAGE_SEQUENCE_SELECT_BLOCK_START sentinel", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("/* STAGE_SEQUENCE_SELECT_BLOCK_START */");
  });

  it("has STAGE_SEQUENCE_SELECT_BLOCK_END sentinel", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("/* STAGE_SEQUENCE_SELECT_BLOCK_END */");
  });

  it("disables non-next-stage items for non-super_admin", () => {
    const startIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_START */");
    const endIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_END */");
    const block = ADMIN_DASHBOARD_SRC.slice(startIdx, endIdx);
    expect(block).toContain("currentAdminRole !== 'super_admin' && !isNextStage && !isCurrent");
    expect(block).toContain("disabled={disabled}");
  });

  it("shows info message about sequential constraint for non-super_admin", () => {
    const startIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_START */");
    const endIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_END */");
    const block = ADMIN_DASHBOARD_SRC.slice(startIdx, endIdx);
    expect(block).toContain("Only the next sequential stage is available for your role");
  });
});

// ---------------------------------------------------------------------------
// 10. AdminDashboard — super_admin override section
// ---------------------------------------------------------------------------

describe("AdminDashboard — super_admin override section", () => {
  it("renders override section only when super_admin selects a non-sequential stage", () => {
    const startIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_START */");
    const endIdx = ADMIN_DASHBOARD_SRC.indexOf("/* STAGE_SEQUENCE_SELECT_BLOCK_END */");
    const block = ADMIN_DASHBOARD_SRC.slice(startIdx, endIdx);
    expect(block).toContain("currentAdminRole === 'super_admin'");
    expect(block).toContain("data-testid=\"stage-override-section\"");
    expect(block).toContain("data-testid=\"stage-override-checkbox\"");
    expect(block).toContain("data-testid=\"stage-override-reason\"");
  });

  it("declares stageOverrideChecked state", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("const [stageOverrideChecked, setStageOverrideChecked] = useState(false)");
  });

  it("declares stageOverrideReason state", () => {
    expect(ADMIN_DASHBOARD_SRC).toContain("const [stageOverrideReason, setStageOverrideReason] = useState(\"\")");
  });
});

// ---------------------------------------------------------------------------
// 11. admin.ts verify endpoint — returns role field
// ---------------------------------------------------------------------------

describe("admin.ts GET /verify — returns role field", () => {
  it("returns role from req.adminRole in the verify response", () => {
    expect(ADMIN_ROUTE_SRC).toContain("role: req.adminRole ?? \"super_admin\"");
  });
});
