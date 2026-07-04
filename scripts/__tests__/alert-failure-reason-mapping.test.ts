/**
 * Tests for the "Prepare notification context" step in
 * .github/workflows/branch-protection.yml (the `notify` job).
 *
 * That step contains a `case` statement that maps structured `failure_reason`
 * tokens emitted by check-github-protection.sh into the human-readable
 * short/detail/fix strings that appear in Slack/email alerts.  A wrong glob
 * (e.g. the combined enforce_admins + required_checks_missing branch) could
 * send a misleading alert even when the detection script emits correct tokens.
 *
 * Strategy: scripts/map-alert-reason.sh is the canonical source of the
 * failure_reason → message mapping.  The "Prepare notification context" step
 * in the workflow delegates to that script, so editing the script is the only
 * place a developer needs to touch when alert text changes.  Each test calls
 * the script via execFileSync, parses the key=value output, and asserts the
 * expected short/detail/fix values.
 */

import { execFileSync, SpawnSyncReturns } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "..", "map-alert-reason.sh");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface MappingResult {
  short: string;
  detail: string;
  fix: string;
}

function mapReason(reason: string): MappingResult {
  let stdout = "";
  try {
    stdout = execFileSync("bash", [SCRIPT, reason], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
  } catch (err: unknown) {
    const e = err as SpawnSyncReturns<string> & { stdout?: string };
    stdout = e.stdout ?? "";
    throw new Error(
      `map-alert-reason.sh failed for reason="${reason}": ${String(err)}\nstdout: ${stdout}`,
    );
  }

  const lines = stdout.split("\n");
  const get = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  };

  return {
    short: get("short"),
    detail: get("detail"),
    fix: get("fix"),
  };
}

describe("branch-protection notify — failure_reason → message mapping", () => {
  describe("no_protection_rule token", () => {
    it("maps to the 'missing or does not exist' short message", () => {
      const result = mapReason("no_protection_rule");
      expect(result.short).toBe(
        "Required status checks are missing or the protection rule does not exist.",
      );
    });

    it("includes required status checks and main in the detail string", () => {
      const result = mapReason("no_protection_rule");
      expect(result.detail).toContain("`main`");
      expect(result.detail).toContain("required status checks");
    });

    it("sets fix to setup without --enforce-admins", () => {
      const result = mapReason("no_protection_rule");
      expect(result.fix).toBe("bash scripts/setup-github-protection.sh");
    });
  });

  describe("required_checks_missing token", () => {
    it("maps to the 'missing or does not exist' short message", () => {
      const result = mapReason("required_checks_missing");
      expect(result.short).toBe(
        "Required status checks are missing or the protection rule does not exist.",
      );
    });

    it("includes required status checks and main in the detail string", () => {
      const result = mapReason("required_checks_missing");
      expect(result.detail).toContain("required status checks");
      expect(result.detail).toContain("`main`");
    });

    it("sets fix to setup without --enforce-admins", () => {
      const result = mapReason("required_checks_missing");
      expect(result.fix).toBe("bash scripts/setup-github-protection.sh");
    });
  });

  describe("enforce_admins_disabled token (alone)", () => {
    it("maps to the enforce_admins short message", () => {
      const result = mapReason("enforce_admins_disabled");
      expect(result.short).toBe(
        "enforce_admins is disabled — admins can bypass required checks.",
      );
    });

    it("mentions enforce_admins and admins in the detail string", () => {
      const result = mapReason("enforce_admins_disabled");
      expect(result.detail).toContain("enforce_admins");
      expect(result.detail).toContain("admins");
    });

    it("sets fix to setup --enforce-admins", () => {
      const result = mapReason("enforce_admins_disabled");
      expect(result.fix).toBe(
        "bash scripts/setup-github-protection.sh --enforce-admins",
      );
    });
  });

  describe("combined: enforce_admins_disabled + required_checks_missing (canonical order)", () => {
    it("maps to the combined 'AND' short message", () => {
      const result = mapReason(
        "enforce_admins_disabled required_checks_missing",
      );
      expect(result.short).toBe(
        "Required status checks are missing AND enforce_admins is disabled.",
      );
    });

    it("includes 'Both issues must be fixed' in the detail string", () => {
      const result = mapReason(
        "enforce_admins_disabled required_checks_missing",
      );
      expect(result.detail).toContain("Both issues must be fixed");
    });

    it("includes the CHECKS_LIST in the detail string", () => {
      const result = mapReason(
        "enforce_admins_disabled required_checks_missing",
      );
      expect(result.detail).toContain("required status checks");
    });

    it("sets fix to setup --enforce-admins", () => {
      const result = mapReason(
        "enforce_admins_disabled required_checks_missing",
      );
      expect(result.fix).toBe(
        "bash scripts/setup-github-protection.sh --enforce-admins",
      );
    });
  });

  describe("combined: required_checks_missing + enforce_admins_disabled (reversed order)", () => {
    it("maps to the combined 'AND' short message regardless of token order", () => {
      const result = mapReason(
        "required_checks_missing enforce_admins_disabled",
      );
      expect(result.short).toBe(
        "Required status checks are missing AND enforce_admins is disabled.",
      );
    });

    it("includes 'Both issues must be fixed' in the detail string", () => {
      const result = mapReason(
        "required_checks_missing enforce_admins_disabled",
      );
      expect(result.detail).toContain("Both issues must be fixed");
    });

    it("sets fix to setup --enforce-admins", () => {
      const result = mapReason(
        "required_checks_missing enforce_admins_disabled",
      );
      expect(result.fix).toBe(
        "bash scripts/setup-github-protection.sh --enforce-admins",
      );
    });
  });

  describe("unknown / unrecognised token", () => {
    it("maps to the generic fallback short message", () => {
      const result = mapReason("some_unexpected_token");
      expect(result.short).toBe(
        "The branch protection rule for `main` is missing, incomplete, or has enforce_admins disabled.",
      );
    });

    it("tells the reader to check the run log in the detail string", () => {
      const result = mapReason("some_unexpected_token");
      expect(result.detail).toBe(
        "Check the failing run log for the exact cause.",
      );
    });

    it("sets fix to setup --enforce-admins", () => {
      const result = mapReason("some_unexpected_token");
      expect(result.fix).toBe(
        "bash scripts/setup-github-protection.sh --enforce-admins",
      );
    });

    it("also uses the fallback for an empty reason string", () => {
      const result = mapReason("");
      expect(result.short).toContain("missing, incomplete");
    });
  });

  describe("glob boundary correctness (each token alone must not match combined branch)", () => {
    it("enforce_admins_disabled alone does NOT produce the combined 'AND' message", () => {
      const result = mapReason("enforce_admins_disabled");
      expect(result.short).not.toContain("AND enforce_admins is disabled");
    });

    it("required_checks_missing alone does NOT produce the combined 'AND' message", () => {
      const result = mapReason("required_checks_missing");
      expect(result.short).not.toContain("AND enforce_admins is disabled");
    });
  });

  describe("CHECKS_LIST content (detail strings that embed it)", () => {
    it("no_protection_rule detail embeds at least one check name from required-checks.txt", () => {
      const result = mapReason("no_protection_rule");
      expect(result.detail).toMatch(/Smoke Test|Unit Tests|i18n Key/);
    });

    it("combined-both detail embeds at least one check name from required-checks.txt", () => {
      const result = mapReason(
        "enforce_admins_disabled required_checks_missing",
      );
      expect(result.detail).toMatch(/Smoke Test|Unit Tests|i18n Key/);
    });
  });
});
