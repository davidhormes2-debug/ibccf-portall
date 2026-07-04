// @vitest-environment node
//
// Task #877 — Stop the admin dashboard file from silently growing too large again.
//
// `client/src/pages/AdminDashboard.tsx` repeatedly creeps over Babel's
// 500,000-byte source-length threshold. Above that hard limit the Vite
// React/Babel transform logs "the code generator has deoptimised the styling …
// as it exceeds the max of 500KB" and generates code more slowly on every dev
// compile and the production build. Nothing catches this today until someone
// happens to notice the slow-compile warning.
//
// This guard fails fast when the file approaches the limit, prompting the next
// extraction (carve self-contained pieces into `client/src/components/admin/`)
// before it becomes a problem. See `.agents/memory/admin-dashboard-size-budget.md`.
//
// The budget is measured in raw bytes (`wc -c` semantics) because Babel compares
// the raw source string byte length to its hard 500_000 constant.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SRC_PATH = path.resolve(__dirname, "../../../pages/AdminDashboard.tsx");

// Hard limit Babel deoptimises above. Do NOT raise this.
const BABEL_HARD_LIMIT_BYTES = 500_000;

// Our budget, with ~10KB headroom under the hard limit. When this fails, do
// not bump the budget — extract a self-contained piece (a leaf dialog or a
// module-scope helper component) into `client/src/components/admin/` instead.
const BUDGET_BYTES = 490_000;

// Soft early-warning band, ~30KB below the hard-fail budget. Crossing this does
// NOT fail the build — it logs an advisory so maintainers can plan the next
// extraction with lead time, before the file approaches the hard budget. When
// you see the warning, carve a self-contained piece out into
// `client/src/components/admin/` rather than waiting for the hard test to break.
const SOFT_BUDGET_BYTES = 460_000;

describe("AdminDashboard.tsx size budget (Task #877)", () => {
  it("stays under the byte budget so it never trips Babel's slow-compile deopt", () => {
    const byteLength = fs.statSync(SRC_PATH).size;
    expect(BUDGET_BYTES).toBeLessThan(BABEL_HARD_LIMIT_BYTES);
    expect(
      byteLength,
      `client/src/pages/AdminDashboard.tsx is ${byteLength} bytes, which exceeds ` +
        `the ${BUDGET_BYTES}-byte budget (hard Babel limit is ${BABEL_HARD_LIMIT_BYTES}). ` +
        `Do NOT raise the budget — extract a self-contained piece (a leaf dialog or a ` +
        `module-scope helper component) into client/src/components/admin/ instead. ` +
        `See .agents/memory/admin-dashboard-size-budget.md.`,
    ).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  // Non-failing early warning: gives maintainers lead time before the hard
  // budget above starts breaking the build. This assertion is intentionally
  // trivial so the test always passes; the signal is the console warning.
  it("logs an advisory when the file passes the soft early-warning threshold", () => {
    const byteLength = fs.statSync(SRC_PATH).size;
    expect(SOFT_BUDGET_BYTES).toBeLessThan(BUDGET_BYTES);
    if (byteLength > SOFT_BUDGET_BYTES) {
      const remaining = BUDGET_BYTES - byteLength;
      console.warn(
        `[AdminDashboard size budget] client/src/pages/AdminDashboard.tsx is ` +
          `${byteLength} bytes, past the ${SOFT_BUDGET_BYTES}-byte soft threshold ` +
          `(${remaining} bytes left before the ${BUDGET_BYTES}-byte hard budget). ` +
          `Plan an extraction now — carve a self-contained piece (a leaf dialog or a ` +
          `module-scope helper component) into client/src/components/admin/ before the ` +
          `hard budget test fails. See .agents/memory/admin-dashboard-size-budget.md.`,
      );
    }
    expect(byteLength).toBeGreaterThan(0);
  });
});
