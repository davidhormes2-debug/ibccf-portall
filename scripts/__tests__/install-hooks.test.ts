/**
 * Tests for scripts/install-hooks.sh
 *
 * Verifies two things end-to-end:
 *
 *   1. install-hooks.sh copies .husky/pre-push into .git/hooks/pre-push and
 *      marks it executable (the "install" contract).
 *
 *   2. The installed hook runs successfully when PATH is restricted to
 *      /usr/bin:/bin — the same constraint nvm, fnm, and mise setups impose
 *      when Git invokes hooks without inheriting the shell's full PATH.
 *      The hook must exit 0 in this environment because it invokes the bash
 *      scripts directly (bash "$REPO_ROOT/scripts/...") rather than via npm.
 *
 * Fixture layout (all within a mkdtempSync directory):
 *
 *   <tmpDir>/
 *     .git/                           ← created by `git init`
 *     .husky/
 *       pre-push                      ← symlink → real .husky/pre-push
 *     scripts/
 *       install-hooks.sh              ← symlink → real scripts/install-hooks.sh
 *       check-e2e-skip-guards.sh      ← symlink → real script
 *       check-skip-guard-coverage.sh  ← symlink → real script
 *     e2e/                            ← empty; no spec files → no skip-guard
 *                                        vars to verify → check exits 0
 *     .github/
 *       workflows/                    ← empty; no e2e workflows found →
 *                                        coverage check exits 0
 *
 * The scripts derive REPO_ROOT as the parent of their own `scripts/` directory,
 * so they operate entirely within tmpDir and never touch the real project.
 *
 * Cases covered:
 *   1. install-hooks.sh exits 0 and prints a confirmation message.
 *   2. The installed hook exists at .git/hooks/pre-push and is executable.
 *   3. The installed hook content matches the source .husky/pre-push.
 *   4. The installed hook runs to completion (exit 0) with PATH=/usr/bin:/bin.
 *   5. install-hooks.sh exits 0 with a notice when .git/hooks/ is absent
 *      (CI / non-git environment guard).
 *   6. install-hooks.sh exits 1 when the source .husky/pre-push is missing.
 *   7. (negative) The installed hook exits non-zero when check-e2e-skip-guards.sh
 *      fails — verifies the hook propagates guard-script failures rather than
 *      swallowing them (e.g. catches a missing `set -euo pipefail`).
 */

import { execFileSync, spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");

const REAL_INSTALL_SCRIPT = path.join(REPO_ROOT, "scripts", "install-hooks.sh");
const REAL_PRE_PUSH = path.join(REPO_ROOT, ".husky", "pre-push");
const REAL_SKIP_GUARDS = path.join(REPO_ROOT, "scripts", "check-e2e-skip-guards.sh");
const REAL_COVERAGE = path.join(REPO_ROOT, "scripts", "check-skip-guard-coverage.sh");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

let tmpDir: string;

function run(
  scriptPath: string,
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): RunResult {
  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    ...(cwd !== undefined ? { cwd } : {}),
  });

  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { exitCode, stdout, stderr, output: stdout + stderr };
}

/**
 * Build a minimal repo skeleton in tmpDir.
 *
 * @param withHusky - whether to create the .husky/pre-push symlink (default true)
 * @param withGitHooks - whether to create the .git/hooks/ directory via git init
 *                       (default true); set false to test the CI-skip branch
 */
function buildFixture(
  { withHusky = true, withGitHooks = true } = {},
): void {
  const scriptsDir = path.join(tmpDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.symlinkSync(REAL_INSTALL_SCRIPT, path.join(scriptsDir, "install-hooks.sh"));
  fs.symlinkSync(REAL_SKIP_GUARDS, path.join(scriptsDir, "check-e2e-skip-guards.sh"));
  fs.symlinkSync(REAL_COVERAGE, path.join(scriptsDir, "check-skip-guard-coverage.sh"));

  if (withHusky) {
    const huskyDir = path.join(tmpDir, ".husky");
    fs.mkdirSync(huskyDir, { recursive: true });
    fs.symlinkSync(REAL_PRE_PUSH, path.join(huskyDir, "pre-push"));
  }

  if (withGitHooks) {
    execFileSync("git", ["init", "--quiet", tmpDir]);
  }

  fs.mkdirSync(path.join(tmpDir, "e2e"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "install-hooks-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("install-hooks.sh", () => {
  it("exits 0 and prints a confirmation message when .git/hooks/ exists", () => {
    buildFixture();
    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    const result = run(installScript);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/pre-push hook installed/i);
  });

  it("creates .git/hooks/pre-push and marks it executable", () => {
    buildFixture();
    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    run(installScript);

    const installedHook = path.join(tmpDir, ".git", "hooks", "pre-push");
    expect(fs.existsSync(installedHook)).toBe(true);

    const stat = fs.statSync(installedHook);
    // Check the executable bit for the owner (S_IXUSR = 0o100)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it("installed hook content matches the .husky/pre-push source", () => {
    buildFixture();
    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    run(installScript);

    const installedHook = path.join(tmpDir, ".git", "hooks", "pre-push");
    const installed = fs.readFileSync(installedHook, "utf8");
    const source = fs.readFileSync(REAL_PRE_PUSH, "utf8");
    expect(installed).toBe(source);
  });

  it("installed hook runs end-to-end with PATH restricted to /usr/bin:/bin (exit 0)", () => {
    buildFixture();

    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    run(installScript);

    const installedHook = path.join(tmpDir, ".git", "hooks", "pre-push");
    // Run the hook with cwd=tmpDir so `git rev-parse --show-toplevel` resolves
    // to the fixture root, keeping the guard scripts scoped to the fixture and
    // preventing them from scanning real project e2e specs and workflow files.
    const result = run(installedHook, { PATH: "/usr/bin:/bin" }, tmpDir);

    expect(
      result.exitCode,
      [
        "Installed hook exited with non-zero code when PATH=/usr/bin:/bin.",
        "This means the hook relies on a command (npm, node, npx, etc.) that is",
        "not available at /usr/bin or /bin — breaking it in nvm/fnm/mise setups.",
        "stdout: " + result.stdout.trim(),
        "stderr: " + result.stderr.trim(),
      ].join("\n"),
    ).toBe(0);
  });

  it("exits 0 with a skip notice when .git/hooks/ directory is absent (CI environment)", () => {
    buildFixture({ withGitHooks: false });
    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    const result = run(installScript);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/skipping hook installation/i);
  });

  it("exits 1 with an error when .husky/pre-push source is missing", () => {
    buildFixture({ withHusky: false });
    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    const result = run(installScript);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/ERROR/i);
  });

  it("hook source includes the test-suite type check (check:test)", () => {
    const source = fs.readFileSync(REAL_PRE_PUSH, "utf8");
    expect(source).toContain("npm run check:test");
  });

  it("installed hook exits non-zero when check-e2e-skip-guards.sh fails (negative path)", () => {
    buildFixture();

    // Replace the real check-e2e-skip-guards.sh symlink with a stub that always
    // exits 1, simulating a broken or failing guard script.  The hook must
    // propagate that failure — if it exits 0 here, `set -euo pipefail` or the
    // underlying error-propagation is broken.
    const stubPath = path.join(tmpDir, "scripts", "check-e2e-skip-guards.sh");
    fs.unlinkSync(stubPath);
    fs.writeFileSync(
      stubPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "echo 'stub: simulated skip-guard failure' >&2",
        "exit 1",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );

    const installScript = path.join(tmpDir, "scripts", "install-hooks.sh");
    run(installScript);

    const installedHook = path.join(tmpDir, ".git", "hooks", "pre-push");
    // Run the hook with cwd=tmpDir so `git rev-parse --show-toplevel` resolves
    // to the fixture repo and the hook picks up the stub script, not the real one.
    const result = run(installedHook, { PATH: "/usr/bin:/bin" }, tmpDir);

    expect(
      result.exitCode,
      [
        "Installed hook exited 0 even though check-e2e-skip-guards.sh exited 1.",
        "The hook must propagate failures from the guard script so a broken guard",
        "is caught locally before it reaches CI.  Check that the hook still has",
        "`set -euo pipefail` and does not swallow the non-zero exit.",
        "stdout: " + result.stdout.trim(),
        "stderr: " + result.stderr.trim(),
      ].join("\n"),
    ).not.toBe(0);
  });
});
