/**
 * Tests for scripts/setup-github-protection.sh
 *
 * The setup script reads required checks from scripts/required-checks.txt,
 * builds a JSON payload, and calls:
 *   gh api --method PUT ... /repos/$REPO/branches/main/protection --input -
 *
 * To run completely offline we shadow `gh` on PATH with a stub bash script
 * that captures every invocation (CLI args + stdin payload) to per-call files
 * in a temp directory. The repository is always passed as a positional
 * OWNER/REPO argument so the stub never needs to handle `gh repo view`.
 *
 * STUB_CALLS_DIR: directory where the stub writes per-call data:
 *   <STUB_CALLS_DIR>/<n>.args  — one argument per line
 *   <STUB_CALLS_DIR>/<n>.stdin — raw stdin payload (JSON)
 *   <STUB_CALLS_DIR>/count     — current call count (incremented on each call)
 */

import { execFileSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "..", "setup-github-protection.sh");
const CHECKS_FILE = path.resolve(__dirname, "..", "required-checks.txt");

const REQUIRED_CHECKS = fs
  .readFileSync(CHECKS_FILE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

interface GhCall {
  args: string[];
  payload: Record<string, unknown> | null;
  rawStdin: string;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  ghCalls: GhCall[];
}

let tmpDir: string;
let binDir: string;
let callsDir: string;

/**
 * A PATH-shadowing `gh` stub that records every invocation.
 *
 * On each call it:
 *   1. Reads the counter from $STUB_CALLS_DIR/count (defaults to 0).
 *   2. Writes CLI args (one per line) to $STUB_CALLS_DIR/<n>.args.
 *   3. If --input is present in args, reads stdin and writes it to
 *      $STUB_CALLS_DIR/<n>.stdin.
 *   4. Increments the counter.
 *   5. Prints a minimal success JSON and exits 0.
 */
const GH_STUB = `#!/usr/bin/env bash
set -uo pipefail

CALLS_DIR="\${STUB_CALLS_DIR}"

# Read current call index
COUNT_FILE="\${CALLS_DIR}/count"
n=0
if [ -f "\${COUNT_FILE}" ]; then
  n=$(cat "\${COUNT_FILE}")
fi

# Write args (one per line) so TypeScript can split on \\n
printf '%s\\n' "$@" > "\${CALLS_DIR}/\${n}.args"

# Read stdin when --input is among the arguments
has_input=0
for a in "$@"; do
  if [ "$a" = "--input" ]; then
    has_input=1
    break
  fi
done

if [ "$has_input" = "1" ]; then
  cat > "\${CALLS_DIR}/\${n}.stdin"
else
  touch "\${CALLS_DIR}/\${n}.stdin"
fi

# Increment counter
echo $((n + 1)) > "\${COUNT_FILE}"

echo '{"url":"https://api.github.com/repos/test/repo/branches/main/protection"}'
exit 0
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-protection-test-"));
  binDir = path.join(tmpDir, "bin");
  callsDir = path.join(tmpDir, "calls");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(callsDir, { recursive: true });

  const ghPath = path.join(binDir, "gh");
  fs.writeFileSync(ghPath, GH_STUB, { mode: 0o755 });
  fs.chmodSync(ghPath, 0o755);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readGhCalls(): GhCall[] {
  const countFile = path.join(callsDir, "count");
  if (!fs.existsSync(countFile)) return [];
  const total = parseInt(fs.readFileSync(countFile, "utf8").trim(), 10);
  const calls: GhCall[] = [];
  for (let i = 0; i < total; i++) {
    const argsRaw = fs.readFileSync(path.join(callsDir, `${i}.args`), "utf8");
    const args = argsRaw.split("\n").filter(Boolean);
    const stdinRaw = fs.readFileSync(
      path.join(callsDir, `${i}.stdin`),
      "utf8"
    );
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(stdinRaw);
    } catch {
      payload = null;
    }
    calls.push({ args, payload, rawStdin: stdinRaw });
  }
  return calls;
}

function run(args: string[]): RunResult {
  const env: Record<string, string> = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    STUB_CALLS_DIR: callsDir,
  };

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
    ghCalls: readGhCalls(),
  };
}

const REPO = "acme/ibccf";

describe("setup-github-protection.sh", () => {
  describe("API call shape", () => {
    it("exits 0 and makes exactly one gh api call", () => {
      const { exitCode, ghCalls } = run([REPO]);
      expect(exitCode).toBe(0);
      expect(ghCalls).toHaveLength(1);
    });

    it("uses --method PUT", () => {
      const { ghCalls } = run([REPO]);
      const args = ghCalls[0].args;
      const methodIdx = args.indexOf("--method");
      expect(methodIdx).toBeGreaterThan(-1);
      expect(args[methodIdx + 1]).toBe("PUT");
    });

    it("targets the correct branch protection endpoint", () => {
      const { ghCalls } = run([REPO]);
      expect(ghCalls[0].args).toContain(
        `/repos/${REPO}/branches/main/protection`
      );
    });

    it("sends the Accept: application/vnd.github+json header", () => {
      const { ghCalls } = run([REPO]);
      const args = ghCalls[0].args;
      const headerIdx = args.indexOf("--header");
      expect(headerIdx).toBeGreaterThan(-1);
      expect(args[headerIdx + 1]).toBe("Accept: application/vnd.github+json");
    });

    it("passes payload via --input (reads from stdin)", () => {
      const { ghCalls } = run([REPO]);
      expect(ghCalls[0].args).toContain("--input");
    });

    it("sends valid JSON as the payload", () => {
      const { ghCalls } = run([REPO]);
      expect(ghCalls[0].payload).not.toBeNull();
    });

    it("uses a different OWNER/REPO when supplied as argument", () => {
      const customRepo = "myorg/myrepo";
      const { exitCode, ghCalls } = run([customRepo]);
      expect(exitCode).toBe(0);
      expect(ghCalls[0].args).toContain(
        `/repos/${customRepo}/branches/main/protection`
      );
    });
  });

  describe("required_status_checks payload", () => {
    it("includes all checks from required-checks.txt", () => {
      const { ghCalls } = run([REPO]);
      const payload = ghCalls[0].payload!;
      const rsc = payload.required_status_checks as {
        checks: Array<{ context: string }>;
      };
      const contexts = rsc.checks.map((c) => c.context);
      for (const check of REQUIRED_CHECKS) {
        expect(contexts).toContain(check);
      }
    });

    it("contains no extra checks beyond required-checks.txt", () => {
      const { ghCalls } = run([REPO]);
      const payload = ghCalls[0].payload!;
      const rsc = payload.required_status_checks as {
        checks: Array<{ context: string }>;
      };
      expect(rsc.checks).toHaveLength(REQUIRED_CHECKS.length);
    });

    it("sets strict: true", () => {
      const { ghCalls } = run([REPO]);
      const payload = ghCalls[0].payload!;
      const rsc = payload.required_status_checks as { strict: boolean };
      expect(rsc.strict).toBe(true);
    });

    it("sets required_pull_request_reviews to null", () => {
      const { ghCalls } = run([REPO]);
      const payload = ghCalls[0].payload!;
      expect(payload.required_pull_request_reviews).toBeNull();
    });

    it("sets restrictions to null", () => {
      const { ghCalls } = run([REPO]);
      const payload = ghCalls[0].payload!;
      expect(payload.restrictions).toBeNull();
    });
  });

  describe("enforce_admins", () => {
    it("sets enforce_admins: false without --enforce-admins flag", () => {
      const { exitCode, ghCalls } = run([REPO]);
      expect(exitCode).toBe(0);
      expect(ghCalls[0].payload!.enforce_admins).toBe(false);
    });

    it("sets enforce_admins: true with --enforce-admins flag", () => {
      const { exitCode, ghCalls } = run(["--enforce-admins", REPO]);
      expect(exitCode).toBe(0);
      expect(ghCalls[0].payload!.enforce_admins).toBe(true);
    });

    it("still targets the same endpoint when --enforce-admins is supplied", () => {
      const { ghCalls } = run(["--enforce-admins", REPO]);
      expect(ghCalls[0].args).toContain(
        `/repos/${REPO}/branches/main/protection`
      );
    });

    it("still includes all required checks when --enforce-admins is supplied", () => {
      const { ghCalls } = run(["--enforce-admins", REPO]);
      const payload = ghCalls[0].payload!;
      const rsc = payload.required_status_checks as {
        checks: Array<{ context: string }>;
      };
      const contexts = rsc.checks.map((c) => c.context);
      for (const check of REQUIRED_CHECKS) {
        expect(contexts).toContain(check);
      }
    });
  });

  describe("idempotency", () => {
    it("succeeds when called twice in succession (PUT is idempotent)", () => {
      const first = run([REPO]);
      expect(first.exitCode).toBe(0);
      expect(first.ghCalls).toHaveLength(1);

      const second = run([REPO]);
      expect(second.exitCode).toBe(0);
    });
  });
});
