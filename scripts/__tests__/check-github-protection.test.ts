/**
 * Tests for scripts/check-github-protection.sh
 *
 * These tests verify the structured failure-reason tokens the script writes to
 * $GITHUB_OUTPUT for each failure path:
 *   no_protection_rule | required_checks_missing | enforce_admins_disabled
 *
 * The real script shells out to the GitHub CLI (`gh`).  To run completely
 * offline in CI we shadow `gh` on PATH with a stub bash script whose behavior
 * is driven by STUB_* environment variables (see ghStub()).  The repository is
 * always passed as a positional OWNER/REPO argument so the script never invokes
 * `gh repo view`.
 */

import { execFileSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "..", "check-github-protection.sh");
const CHECKS_FILE = path.resolve(__dirname, "..", "required-checks.txt");

const REQUIRED_CHECKS = fs
  .readFileSync(CHECKS_FILE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  /** The last `failure_reason=` value written to $GITHUB_OUTPUT, or null. */
  failureReason: string | null;
}

let tmpDir: string;
let binDir: string;
let githubOutput: string;

/**
 * A PATH-shadowing `gh` stub.  It inspects the `--jq` expression to decide
 * which API query is being answered and responds based on STUB_* env vars:
 *   - STUB_NO_PROTECTION  : checks query exits 1 with a "Branch not protected
 *                           (HTTP 404)" stderr message (simulates no rule).
 *   - STUB_CHECKS         : newline-separated required-check contexts to print
 *                           for the checks query (empty/unset => no checks).
 *   - STUB_ENFORCE_ADMINS : "true"/"false" printed for the enforce_admins query.
 */
const GH_STUB = `#!/usr/bin/env bash
set -uo pipefail

jq_expr=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--jq" ]; then
    jq_expr="$a"
    break
  fi
  prev="$a"
done

case "$jq_expr" in
  *required_status_checks*)
    if [ -n "\${STUB_NO_PROTECTION:-}" ]; then
      echo "gh: Branch not protected (HTTP 404)" >&2
      exit 1
    fi
    if [ -n "\${STUB_CHECKS:-}" ]; then
      printf '%s\\n' "\${STUB_CHECKS}"
    fi
    exit 0
    ;;
  *enforce_admins*)
    echo "\${STUB_ENFORCE_ADMINS:-false}"
    exit 0
    ;;
esac

echo "gh stub: unhandled invocation: $*" >&2
exit 1
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "protection-test-"));
  binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  fs.writeFileSync(ghPath, GH_STUB, { mode: 0o755 });
  fs.chmodSync(ghPath, 0o755);
  githubOutput = path.join(tmpDir, "github_output");
  fs.writeFileSync(githubOutput, "");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readFailureReason(): string | null {
  const content = fs.readFileSync(githubOutput, "utf8");
  const matches = content
    .split("\n")
    .filter((line) => line.startsWith("failure_reason="))
    .map((line) => line.slice("failure_reason=".length));
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

interface StubOpts {
  noProtection?: boolean;
  checks?: string[];
  enforceAdmins?: boolean;
}

function run(args: string[], stub: StubOpts): RunResult {
  const env: Record<string, string> = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    GITHUB_OUTPUT: githubOutput,
  };
  if (stub.noProtection) env.STUB_NO_PROTECTION = "1";
  if (stub.checks && stub.checks.length > 0) {
    env.STUB_CHECKS = stub.checks.join("\n");
  }
  env.STUB_ENFORCE_ADMINS = stub.enforceAdmins ? "true" : "false";

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync("bash", [SCRIPT, ...args], {
      env,
      encoding: "utf8",
    });
  } catch (err: unknown) {
    const e = err as SpawnSyncReturns<string> & {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    exitCode = typeof e.status === "number" ? e.status : 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  return {
    exitCode,
    stdout,
    stderr,
    output: stdout + stderr,
    failureReason: readFailureReason(),
  };
}

const REPO = "acme/ibccf";

describe("check-github-protection.sh failure_reason output", () => {
  it("emits no_protection_rule when the branch has no protection rule", () => {
    const result = run([REPO], { noProtection: true });
    expect(result.exitCode).toBe(1);
    expect(result.failureReason).toBe("no_protection_rule");
  });

  it("emits required_checks_missing when no required checks are configured", () => {
    const result = run([REPO], { checks: [] });
    expect(result.exitCode).toBe(1);
    expect(result.failureReason).toBe("required_checks_missing");
  });

  it("emits required_checks_missing when a specific required check is absent", () => {
    // Three of the required checks present — the rest missing.
    const result = run([REPO], {
      checks: [REQUIRED_CHECKS[0], REQUIRED_CHECKS[1], REQUIRED_CHECKS[2]],
    });
    expect(result.exitCode).toBe(1);
    expect(result.failureReason).toBe("required_checks_missing");
  });

  it("emits enforce_admins_disabled when checks pass but enforce_admins is off (--enforce-admins)", () => {
    const result = run(["--enforce-admins", REPO], {
      checks: REQUIRED_CHECKS,
      enforceAdmins: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.failureReason).toBe("enforce_admins_disabled");
  });

  it("emits both tokens when required checks are missing AND enforce_admins is disabled", () => {
    const result = run(["--enforce-admins", REPO], {
      checks: [REQUIRED_CHECKS[0]], // two checks missing
      enforceAdmins: false,
    });
    expect(result.exitCode).toBe(1);
    const reason = result.failureReason ?? "";
    expect(reason).toContain("enforce_admins_disabled");
    expect(reason).toContain("required_checks_missing");
  });

  it("writes no failure_reason when everything passes (with --enforce-admins)", () => {
    const result = run(["--enforce-admins", REPO], {
      checks: REQUIRED_CHECKS,
      enforceAdmins: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.failureReason).toBeNull();
  });

  it("writes no failure_reason when checks pass and enforce_admins is not requested", () => {
    // enforce_admins is false, but without the flag it must not be checked.
    const result = run([REPO], {
      checks: REQUIRED_CHECKS,
      enforceAdmins: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.failureReason).toBeNull();
  });
});
