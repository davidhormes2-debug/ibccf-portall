/**
 * Regression test for Section 7 of scripts/check-protection-sync.sh
 *
 * Section 7 detects stale entries in ci-job-allowlist.txt — entries that
 * reference a "Workflow Name / Job Name" pair that no longer exists in any
 * .github/workflows/*.yml file.  Without a test, a future refactor could
 * break that detection and silently allow stale allowlist entries to persist.
 *
 * This test:
 *   1. Copies the real ci-job-allowlist.txt into a temp file.
 *   2. Appends one fake stale entry ("Ghost Workflow / Ghost Job") that does
 *      not exist in any workflow file.
 *   3. Runs check-protection-sync.sh with CI_JOB_ALLOWLIST_FILE pointed at
 *      the temp file.
 *   4. Asserts the script exits with code 1.
 *   5. Asserts stderr mentions the stale entry so the failure is actionable.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-protection-sync.sh");
const REAL_ALLOWLIST = path.join(REPO_ROOT, "scripts", "ci-job-allowlist.txt");

const STALE_WORKFLOW = "Ghost Workflow";
const STALE_JOB = "Ghost Job";
const STALE_ENTRY = `${STALE_WORKFLOW} / ${STALE_JOB}`;

let tmpFile: string | null = null;

function buildTempAllowlist(): string {
  const realContent = fs.readFileSync(REAL_ALLOWLIST, "utf8");
  const tmp = path.join(os.tmpdir(), `ci-job-allowlist-test-${process.pid}.txt`);
  fs.writeFileSync(tmp, realContent + `\n${STALE_ENTRY}   [stale-test-entry]\n`);
  return tmp;
}

function runScript(allowlistPath: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, CI_JOB_ALLOWLIST_FILE: allowlistPath },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

afterAll(() => {
  if (tmpFile) {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
});

const TEST_TIMEOUT_MS = 120_000;

describe("check-protection-sync.sh — Section 7 allowlist staleness detection", () => {
  let result: ReturnType<typeof runScript>;

  it("exits with code 1 when ci-job-allowlist.txt contains a stale entry", () => {
    tmpFile = buildTempAllowlist();
    result = runScript(tmpFile);
    if (result.exitCode === 0) {
      console.error("Script stdout:\n", result.stdout);
      console.error("Script stderr:\n", result.stderr);
    }
    expect(result.exitCode).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("reports the stale workflow name in stderr", () => {
    result ??= runScript((tmpFile ??= buildTempAllowlist()));
    expect(result.stderr).toContain(STALE_WORKFLOW);
  }, TEST_TIMEOUT_MS);

  it("reports the stale entry context string in stderr", () => {
    result ??= runScript((tmpFile ??= buildTempAllowlist()));
    expect(result.stderr).toContain(STALE_ENTRY);
  }, TEST_TIMEOUT_MS);
});
