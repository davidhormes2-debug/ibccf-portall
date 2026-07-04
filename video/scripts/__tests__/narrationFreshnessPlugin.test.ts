// @vitest-environment node
//
// Unit tests for video/plugins/narration-freshness.ts.
//
// The plugin runs `scripts/check-narration-fresh.ts` via spawnSync at Vite dev
// server startup and on every captions.ts change.  If spawnSync breaks (wrong
// path, missing tsx, etc.) the check silently never runs, so developers lose
// the staleness warning with no indication anything is wrong.
//
// These tests mock spawnSync and a minimal Vite server to verify:
//   • exit 0  → green ✓ line printed to console.log
//   • exit ≠ 0 → amber ⚠ box printed to console.warn
//   • watcher registers captions.ts and re-runs the check on change

import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// --------------------------------------------------------------------------
// Mock node:child_process BEFORE importing the plugin so the plugin picks up
// the mock when it calls spawnSync at module resolution time.
// --------------------------------------------------------------------------
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { narrationFreshnessPlugin } from "../../plugins/narration-freshness";

// --------------------------------------------------------------------------
// Derive the expected CAPTIONS_FILE path the same way the plugin does, but
// from the test file's own __dirname (3 levels up reaches the repo root).
// --------------------------------------------------------------------------
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CAPTIONS_FILE = path.resolve(
  REPO_ROOT,
  "client/src/components/portal/withdrawal-video/captions.ts",
);

// --------------------------------------------------------------------------
// Minimal Vite dev-server stub
// --------------------------------------------------------------------------
type ChangeListener = (file: string) => void;

function makeMockServer() {
  const changeListeners: ChangeListener[] = [];
  const watchedFiles: string[] = [];

  const watcher = {
    add(file: string) {
      watchedFiles.push(file);
    },
    on(event: string, cb: ChangeListener) {
      if (event === "change") changeListeners.push(cb);
    },
    simulateChange(file: string) {
      for (const cb of changeListeners) cb(file);
    },
  };

  return { watcher, watchedFiles };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
const spawnSyncMock = spawnSync as ReturnType<typeof vi.fn>;

function mockSuccess() {
  spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
}

function mockFailure(stderr = "captions hash mismatch") {
  spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------
describe("narrationFreshnessPlugin – configureServer", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("prints a green ✓ line when spawnSync exits 0", () => {
    mockSuccess();

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    const allLog = logSpy.mock.calls.map((args: unknown[]) => (args as string[]).join(" ")).join("\n");
    expect(allLog).toContain("✓");
    expect(allLog).toContain("narration audio is up to date");
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("⚠"));
  });

  it("prints an amber ⚠ warning box when spawnSync exits non-zero", () => {
    mockFailure("some staleness reason");

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    const allWarn = warnSpy.mock.calls.map((args: unknown[]) => (args as string[]).join(" ")).join("\n");
    expect(allWarn).toContain("NARRATION OUT OF DATE");
    expect(allWarn).toContain("narration:generate");
    expect(logSpy.mock.calls.map((a: unknown[]) => (a as string[]).join(" ")).join("\n")).not.toContain(
      "up to date",
    );
  });

  it("includes the check script's stderr output in the warning", () => {
    mockFailure("scene-01: hash abc≠xyz");

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    const allWarn = warnSpy.mock.calls.map((args: unknown[]) => (args as string[]).join(" ")).join("\n");
    expect(allWarn).toContain("scene-01: hash abc≠xyz");
  });

  it("registers captions.ts with the watcher", () => {
    mockSuccess();

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    expect(server.watchedFiles).toContain(CAPTIONS_FILE);
  });

  it("re-runs the check when captions.ts changes and check exits 0", () => {
    mockSuccess();

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    const callsAfterStartup = spawnSyncMock.mock.calls.length;
    server.watcher.simulateChange(CAPTIONS_FILE);

    expect(spawnSyncMock.mock.calls.length).toBe(callsAfterStartup + 1);
    const allLog = logSpy.mock.calls.map((a: unknown[]) => (a as string[]).join(" ")).join("\n");
    expect(allLog).toContain("captions.ts changed");
  });

  it("re-runs the check and warns when captions.ts changes and check exits non-zero", () => {
    // First call (startup) succeeds; second call (watcher) fails.
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "now stale" });

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    warnSpy.mockClear();
    server.watcher.simulateChange(CAPTIONS_FILE);

    const allWarn = warnSpy.mock.calls.map((a: unknown[]) => (a as string[]).join(" ")).join("\n");
    expect(allWarn).toContain("NARRATION OUT OF DATE");
    expect(allWarn).toContain("now stale");
  });

  it("does NOT re-run the check when an unrelated file changes", () => {
    mockSuccess();

    const plugin = narrationFreshnessPlugin();
    const server = makeMockServer();
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);

    const callsAfterStartup = spawnSyncMock.mock.calls.length;
    server.watcher.simulateChange("/some/other/file.ts");

    expect(spawnSyncMock.mock.calls.length).toBe(callsAfterStartup);
  });
});
