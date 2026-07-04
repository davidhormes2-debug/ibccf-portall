// @vitest-environment node
//
// Unit tests for scripts/check-narration-path-filters.ts.
//
// The script is top-level code that calls process.exit() directly, so it
// cannot be imported statically. Each test:
//   1. Stubs node:fs so the script reads a controlled workflow YAML string
//      rather than the real .github/workflows/narration-fresh.yml.
//   2. Stubs narrationFingerprint so listNarrationSourceFiles() returns a
//      controlled set of fake absolute paths.
//   3. Dynamically imports the script (after vi.resetModules()) so the
//      top-level code re-runs.
//   4. Catches the Error thrown by the process.exit spy, then asserts on
//      the exit code and console output.
//
// Key invariant: when listNarrationSourceFiles() returns a new file that is
// absent from the workflow PATTERN, the check must exit 1 automatically —
// without any manual edit to a hardcoded canonical list.

import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest — must appear before any dynamic imports).
//
// mockNarrationSources is a module-level variable so the factory closure
// picks up the current value even after vi.resetModules() forces the mock
// factory to re-run on the next import.
// ---------------------------------------------------------------------------

const FAKE_REPO_ROOT = "/fake/repo";
const FAKE_NARRATION_SOURCE = "/fake/repo/shared/videoCaptions.ts";
const FAKE_FINGERPRINT_FILE =
  "/fake/repo/client/src/components/portal/withdrawal-video/narrationFingerprint.ts";

let mockNarrationSources: string[] = [
  FAKE_NARRATION_SOURCE,
  FAKE_FINGERPRINT_FILE,
];

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock(
  "../../client/src/components/portal/withdrawal-video/narrationFingerprint",
  () => ({
    REPO_ROOT: FAKE_REPO_ROOT,
    listNarrationSourceFiles: vi.fn(() => mockNarrationSources),
  }),
);

// ---------------------------------------------------------------------------
// Workflow YAML builders
// ---------------------------------------------------------------------------

/** Build a minimal workflow YAML with the given PATTERN in the narration-fresh job. */
function buildWorkflowYaml(pattern: string): string {
  return [
    "jobs:",
    "  narration-fresh:",
    "    name: Narration Freshness Check",
    "    steps:",
    "      - name: Detect relevant changes",
    "        run: |",
    `          PATTERN='${pattern}'`,
    "          echo done",
    "  recordings-fresh:",
    "    name: Tutorial Recording Clips",
    "    steps:",
    "      - name: Detect relevant changes",
    "        run: |",
    "          PATTERN='(^unrelated/pattern)'",
    "          echo done",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A PATTERN that covers all files that the fake listNarrationSourceFiles()
 * returns, plus the fixed files the script always appends (checker + manifest).
 */
const FULL_PATTERN =
  "(^shared/|^client/src/components/portal/withdrawal-video/|^scripts/check-narration-fresh\\.ts|^client/public/withdrawal-video/narration/)";

/** Stub node:fs with a workflow YAML containing the given PATTERN. */
function mockFsWithPattern(pattern: string) {
  const yaml = buildWorkflowYaml(pattern);
  vi.mocked(existsSync).mockImplementation(() => true);
  vi.mocked(readFileSync).mockImplementation((p) => {
    const s = String(p);
    if (s.endsWith("narration-fresh.yml")) return yaml;
    throw new Error(`readFileSync: unexpected path ${s}`);
  });
}

/**
 * Run the script via dynamic import after a module reset so the top-level
 * code re-runs fresh for each test.
 *
 * Returns { exitCode, stdout, stderr }:
 * - exitCode === null  → script completed normally without calling process.exit
 * - exitCode === 0     → script called process.exit(0) (explicit success signal,
 *                        used by self-test mode)
 * - exitCode === 1     → script called process.exit(1) (failure)
 */
async function runScript(
  argv: string[] = [],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  vi.resetModules();

  const originalArgv = process.argv;
  process.argv = ["node", "check-narration-path-filters.ts", ...argv];

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      stdoutLines.push(args.map(String).join(" "));
    });
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });

  let exitCode: number | null = null;
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null) => {
      exitCode = typeof code === "number" ? code : 1;
      throw new Error(`process.exit(${exitCode})`);
    });

  try {
    await import("../check-narration-path-filters");
  } catch {
    // Expected when process.exit throws.
  } finally {
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    exitCode,
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("check-narration-path-filters.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to the default two-file list before each test.
    mockNarrationSources = [FAKE_NARRATION_SOURCE, FAKE_FINGERPRINT_FILE];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path — normal mode
  // -------------------------------------------------------------------------

  it("exits without error when the PATTERN covers all canonical files", async () => {
    mockFsWithPattern(FULL_PATTERN);

    const { exitCode } = await runScript();

    // Normal success: script runs to completion without calling process.exit.
    expect(exitCode).toBeNull();
  });

  it("prints OK for each covered file when the pattern is sufficient", async () => {
    mockFsWithPattern(FULL_PATTERN);

    const { stdout } = await runScript();

    expect(stdout).toMatch(/OK\s+shared\/videoCaptions\.ts/);
  });

  // -------------------------------------------------------------------------
  // Missing file in PATTERN → exit 1
  // -------------------------------------------------------------------------

  it("exits 1 when a source file from listNarrationSourceFiles() is not covered by PATTERN", async () => {
    // Narrow pattern: only covers the checker script, not any source files.
    mockFsWithPattern("^scripts/check-narration-fresh\\.ts$");

    const { exitCode } = await runScript();

    expect(exitCode).toBe(1);
  });

  it("reports the uncovered file path in stderr", async () => {
    mockFsWithPattern("^scripts/check-narration-fresh\\.ts$");

    const { stderr } = await runScript();

    expect(stderr).toMatch(/FAIL/i);
    expect(stderr).toMatch(/shared\/videoCaptions\.ts/);
  });

  it("reports every uncovered file when the PATTERN covers nothing", async () => {
    mockFsWithPattern("^scripts/does-not-exist\\.ts$");

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    // Both fake source files should appear in error output.
    expect(stderr).toMatch(/shared\/videoCaptions\.ts/);
    expect(stderr).toMatch(/narrationFingerprint\.ts/);
  });

  // -------------------------------------------------------------------------
  // Workflow file missing
  // -------------------------------------------------------------------------

  it("exits 1 when narration-fresh.yml does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/narration-fresh\.yml|does not exist/i);
  });

  // -------------------------------------------------------------------------
  // PATTERN extraction failure
  // -------------------------------------------------------------------------

  it("exits 1 when no PATTERN= line is present inside the narration-fresh job", async () => {
    const yamlNoPattern = [
      "jobs:",
      "  narration-fresh:",
      "    name: Narration Freshness",
      "    steps:",
      "      - run: echo no pattern here",
    ].join("\n");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(yamlNoPattern);

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Could not extract PATTERN|PATTERN/i);
  });

  it("uses only the PATTERN from the narration-fresh job, ignoring other jobs", async () => {
    // Only the recordings-fresh job has a broad pattern; narration-fresh is narrow.
    const yamlOtherJobBroad = [
      "jobs:",
      "  narration-fresh:",
      "    name: Narration Freshness",
      "    steps:",
      "      - run: |",
      "          PATTERN='^scripts/check-narration-fresh\\.ts$'",
      "          echo done",
      "  recordings-fresh:",
      "    name: Tutorial Recording Clips",
      "    steps:",
      "      - run: |",
      "          PATTERN='(^shared/|^client/|^scripts/)'",
      "          echo done",
    ].join("\n");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(yamlOtherJobBroad);

    const { exitCode } = await runScript();

    // The broad pattern in recordings-fresh must not be used;
    // only the narrow narration-fresh PATTERN applies, so the check fails.
    expect(exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Self-test mode (--self-test)
  //
  // Self-test uses a deliberately narrow pattern (covers only
  // check-narration-fresh.ts). All other canonical files should be flagged as
  // uncovered, proving the check can detect a missing filter entry.
  // In self-test mode the script always calls process.exit(0) on success, so
  // exitCode will be 0 (not null).
  // -------------------------------------------------------------------------

  it("exits 0 (not null) in self-test mode when the narrow pattern leaves files uncovered", async () => {
    mockFsWithPattern(FULL_PATTERN);

    const { exitCode } = await runScript(["--self-test"]);

    // Self-test calls process.exit(0) explicitly on success.
    expect(exitCode).toBe(0);
  });

  it("reports uncovered files in self-test mode stdout", async () => {
    mockFsWithPattern(FULL_PATTERN);

    const { stdout } = await runScript(["--self-test"]);

    expect(stdout).toMatch(/Self-test OK/i);
    expect(stdout).toMatch(/shared\/videoCaptions\.ts|narrationFingerprint\.ts/);
  });

  // -------------------------------------------------------------------------
  // Dynamic derivation: a new source file automatically triggers a failure
  //
  // This is the core guarantee of the task: listNarrationSourceFiles() is the
  // canonical source, so adding a file there without updating the CI PATTERN
  // must surface as a drift failure without any manual edit to this script.
  // -------------------------------------------------------------------------

  it("automatically exits 1 when a new file is added to listNarrationSourceFiles() but absent from PATTERN", async () => {
    // Simulate a developer adding a new file to the narration pipeline.
    mockNarrationSources = [
      FAKE_NARRATION_SOURCE,
      FAKE_FINGERPRINT_FILE,
      "/fake/repo/shared/newNarrationHelper.ts",
    ];

    // The existing FULL_PATTERN covers the original two files and fixed files.
    // It does NOT cover newNarrationHelper.ts (it matches shared/ prefix, so
    // let's use a narrower pattern that won't cover it).
    const narrowPattern =
      "(^client/src/components/portal/withdrawal-video/|^scripts/check-narration-fresh\\.ts|^client/public/withdrawal-video/narration/|^shared/videoCaptions\\.ts$)";
    mockFsWithPattern(narrowPattern);

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/shared\/newNarrationHelper\.ts/);
  });

  it("exits without error when a newly added source file is also covered by PATTERN", async () => {
    mockNarrationSources = [
      FAKE_NARRATION_SOURCE,
      FAKE_FINGERPRINT_FILE,
      "/fake/repo/shared/newNarrationHelper.ts",
    ];

    // Updated pattern that also covers the new file via the shared/ prefix.
    mockFsWithPattern(FULL_PATTERN);

    const { exitCode } = await runScript();

    expect(exitCode).toBeNull();
  });
});
