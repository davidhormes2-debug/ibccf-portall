// @vitest-environment node
//
// Integration tests for scripts/check-narration-fresh.ts.
//
// The script is top-level code that calls process.exit() directly, so we
// cannot import it statically.  Instead, each test:
//   1. Sets up mock return values for node:fs and narrationFingerprint.
//   2. Dynamically imports the script (after vi.resetModules() so the top-
//      level code re-runs).
//   3. Catches the Error thrown by our process.exit spy, then asserts on
//      the exit code and console output.
//
// The narrationFingerprint mock pins locales to ["en"] and scenes to
// ["scene-01"] so every test is hermetic — no real MP3 files or the real
// narration.manifest.json are ever read.

import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest — must appear before any dynamic imports).
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock(
  "../../client/src/components/portal/withdrawal-video/narrationFingerprint",
  () => ({
    ALL_LOCALES: ["en"],
    NARRATION_MANIFEST_PATH: "/fake/narration.manifest.json",
    NARRATION_SCENE_KEYS: ["scene-01"],
    computeScriptFingerprint: vi.fn(() => "abc123deadbeef"),
    narrationPath: vi.fn(
      (locale: string, scene: string) =>
        `/fake/narration/${locale}/${scene}.mp3`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FRESH_MANIFEST = JSON.stringify({
  locales: {
    en: {
      scenes: {
        "scene-01": {
          scriptFingerprint: "abc123deadbeef",
          generatedAt: "2025-01-01T00:00:00Z",
        },
      },
    },
  },
});

const STALE_MANIFEST = JSON.stringify({
  locales: {
    en: {
      scenes: {
        "scene-01": {
          scriptFingerprint: "000000stalevalue",
          generatedAt: "2024-01-01T00:00:00Z",
        },
      },
    },
  },
});

function mockFs({
  manifestExists = true,
  manifestContent = FRESH_MANIFEST,
  mp3Exists = true,
}: {
  manifestExists?: boolean;
  manifestContent?: string;
  mp3Exists?: boolean;
} = {}) {
  vi.mocked(existsSync).mockImplementation((p) => {
    if (String(p) === "/fake/narration.manifest.json") return manifestExists;
    if (String(p).endsWith(".mp3")) return mp3Exists;
    return false;
  });
  vi.mocked(readFileSync).mockImplementation((p) => {
    if (String(p) === "/fake/narration.manifest.json") return manifestContent;
    throw new Error(`readFileSync: unexpected path ${String(p)}`);
  });
}

/**
 * Run the script by dynamically importing it after a module reset.
 * Returns { exitCode, stderr } — exitCode is null if the script completes
 * without calling process.exit (i.e. the fresh path succeeds cleanly).
 */
async function runScript(): Promise<{ exitCode: number | null; stderr: string }> {
  vi.resetModules();

  const stderrLines: string[] = [];
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  let exitCode: number | null = null;
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: number | string | null) => {
      exitCode = typeof code === "number" ? code : 1;
      throw new Error(`process.exit(${exitCode})`);
    });

  try {
    await import("../check-narration-fresh");
  } catch {
    // Expected when process.exit throws.
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { exitCode, stderr: stderrLines.join("\n") };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("check-narration-fresh.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 0 when the manifest fingerprint matches the current caption script", async () => {
    mockFs({ manifestExists: true, manifestContent: FRESH_MANIFEST, mp3Exists: true });

    const { exitCode } = await runScript();

    expect(exitCode).toBeNull();
  });

  it("exits 1 with a descriptive message when the fingerprint is stale", async () => {
    mockFs({ manifestExists: true, manifestContent: STALE_MANIFEST, mp3Exists: true });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/[Ss]tale|caption script changed/);
    expect(stderr).toContain("en/scene-01");
  });

  it("exits 1 with a descriptive message when the manifest is missing", async () => {
    mockFs({ manifestExists: false, mp3Exists: true });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/[Mm]issing narration manifest/);
  });

  it("exits 1 when the MP3 file is absent (not yet generated)", async () => {
    mockFs({ manifestExists: true, manifestContent: FRESH_MANIFEST, mp3Exists: false });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Missing/i);
    expect(stderr).toContain("en/scene-01");
  });

  it("exits 1 when the scene entry is absent from the manifest", async () => {
    const emptyLocale = JSON.stringify({ locales: { en: { scenes: {} } } });
    mockFs({ manifestExists: true, manifestContent: emptyLocale, mp3Exists: true });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/never stamped|not in manifest/i);
  });

  it("includes the affected locale/scene and regeneration hint in the stale error output", async () => {
    mockFs({ manifestExists: true, manifestContent: STALE_MANIFEST, mp3Exists: true });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toContain("en/scene-01");
    expect(stderr).toContain("generate-narration.ts");
  });

  it("treats a corrupt manifest JSON as all-stale and exits 1", async () => {
    mockFs({
      manifestExists: true,
      manifestContent: "{ not valid json ::::",
      mp3Exists: true,
    });

    const { exitCode, stderr } = await runScript();

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/[Ss]tale|[Pp]arse|[Ff]ailed/);
  });
});
