/**
 * Self-test for scripts/check-sentinel-comments.mjs
 *
 * The auto-discovery script relies on specific regex patterns to find sentinel
 * anchors in test files.  If a developer refactors a test file in a way that
 * breaks those patterns (non-const variable, different readFileSync call, split
 * assignment, etc.) the script silently discovers zero sentinels and the
 * bidirectional check passes vacuously.
 *
 * This test runs the script as a child process and asserts that:
 *   1. The script exits with code 0 (all discovered sentinels are present).
 *   2. Every currently-known sentinel name appears in the stdout, proving the
 *      auto-discovery regex actually found each one.
 *   3. The total discovered count meets the minimum floor encoded in the script.
 *
 * If a new sentinel is added to a test file, add its name here too.
 * If a sentinel is intentionally removed, delete its entry from this list AND
 * lower SENTINEL_MIN_COUNT in scripts/check-sentinel-comments.mjs.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT = path.resolve(__dirname, "../../scripts/check-sentinel-comments.mjs");

const KNOWN_SENTINELS = [
  // indexOf("// SENTINEL") style — server/env.ts
  "ESCAPE_HATCH_GUARD_START",
  // indexOf("// SENTINEL") style — server/services/CaseService.ts
  "MAX_STAGE_ADVANCE_BLOCK_START",
  "STAGE_EMAIL_CATCH_BLOCK_START",
  "STAGE_SEQUENCE_GUARD_START",
  "STAGE_SEQUENCE_GUARD_END",
  // indexOf("// SENTINEL") style — server/routes/cases.ts
  "STAGE_TRANSITION_CATCH_BLOCK_START",
  "STAGE_TRANSITION_CATCH_BLOCK_END",
  // indexOf("// SENTINEL") style — client/src/pages/portal/PortalShell.tsx
  "SEALED_SETTLEMENT_NAV_ENTRY_START",
  "WITHDRAWAL_ACTIVATION_NAV_ENTRY_START",
  // extractBlock() style — client/src/components/admin/CommunityManagement.tsx
  "FLAGGED_POST_SELECTION_PRUNING_EFFECT_START",
  "FLAGGED_THREAD_SELECTION_PRUNING_EFFECT_START",
  // extractBlock() style — client/src/components/admin/ContentManagement.tsx
  "NEWSLETTER_SELECT_ALL_CHECKBOX_START",
  "NEWSLETTER_ROW_CHECKBOX_START",
  "NEWSLETTER_EXPORT_CSV_BTN_START",
  "NEWSLETTER_PRUNING_EFFECT_START",
  // extractBlock() style — client/src/pages/AdminDashboard.tsx
  "WITHDRAWAL_GUIDE_BANNER_STATE_START",
];

function runScript(): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [SCRIPT], { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

describe("check-sentinel-comments.mjs — self-test", () => {
  let scriptResult: ReturnType<typeof runScript>;

  it("script exits with code 0 (all sentinels present in source + test files)", () => {
    scriptResult = runScript();
    if (scriptResult.exitCode !== 0) {
      console.error("Script stdout:\n", scriptResult.stdout);
      console.error("Script stderr:\n", scriptResult.stderr);
    }
    expect(scriptResult.exitCode).toBe(0);
  });

  it("discovers at least 16 sentinels (minimum floor from SENTINEL_MIN_COUNT)", () => {
    scriptResult ??= runScript();
    const match = scriptResult.stdout.match(/all (\d+) auto-discovered sentinels/);
    const discoveredCount = match ? parseInt(match[1], 10) : 0;
    expect(discoveredCount).toBeGreaterThanOrEqual(16);
  });

  for (const sentinel of KNOWN_SENTINELS) {
    it(`discovers sentinel: ${sentinel}`, () => {
      scriptResult ??= runScript();
      expect(scriptResult.stdout).toContain(sentinel);
    });
  }
});
