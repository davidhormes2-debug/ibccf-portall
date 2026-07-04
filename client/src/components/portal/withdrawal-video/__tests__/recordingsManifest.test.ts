import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeNarrationFingerprint,
  computeSourceFingerprint,
  recordedLocalesFromResults,
  recordingFileName,
  updateManifest,
} from "../../../../../../video/scripts/recordingFingerprint.mjs";

// Unit coverage for the manifest read-modify-write that the freshness guard
// (recordingsFreshness.test.ts) trusts. If a future refactor of the recorder
// silently stopped stamping locales, the freshness guard would quietly go stale
// itself — these tests pin the stamping contract so that can't happen unnoticed.

let dir: string;
let manifestPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "recordings-manifest-"));
  manifestPath = join(dir, "recordings.manifest.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readManifest(): {
  locales: Record<
    string,
    {
      file?: string;
      sourceFingerprint?: string;
      narrationFingerprint?: string;
      recordedAt?: string;
    }
  >;
} {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

describe("recordedLocalesFromResults", () => {
  it("keeps successfully recorded locales", () => {
    const results = [
      { locale: "en", timedOut: false },
      { locale: "es", timedOut: false },
    ];
    expect(recordedLocalesFromResults(results)).toEqual(["en", "es"]);
  });

  it("skips locales whose capture hit the timeout ceiling", () => {
    const results = [
      { locale: "en", timedOut: false },
      { locale: "es", timedOut: true },
      { locale: "fr", timedOut: false },
    ];
    expect(recordedLocalesFromResults(results)).toEqual(["en", "fr"]);
  });

  it("returns nothing when every capture timed out", () => {
    const results = [
      { locale: "en", timedOut: true },
      { locale: "es", timedOut: true },
    ];
    expect(recordedLocalesFromResults(results)).toEqual([]);
  });
});

describe("updateManifest", () => {
  it("stamps a locale with the injected fingerprint, file name, and timestamp", async () => {
    const recordedAt = "2026-05-31T00:00:00.000Z";
    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "fp-en",
      recordedAt,
    });

    const manifest = readManifest();
    expect(manifest.locales.en).toMatchObject({
      file: recordingFileName("en"),
      sourceFingerprint: "fp-en",
      recordedAt,
    });
    // narrationFingerprint is always present (computed from mp3 files when not injected).
    expect(typeof manifest.locales.en.narrationFingerprint).toBe("string");
  });

  it("stamps an injected narrationFingerprint per locale", async () => {
    const recordedAt = "2026-05-31T00:00:00.000Z";
    await updateManifest(["en", "es"], {
      manifestPath,
      fingerprint: "fp",
      narrationFingerprints: { en: "narr-en", es: "narr-es" },
      recordedAt,
    });

    const manifest = readManifest();
    expect(manifest.locales.en.narrationFingerprint).toBe("narr-en");
    expect(manifest.locales.es.narrationFingerprint).toBe("narr-es");
  });

  it("defaults narrationFingerprint to the computed mp3 hash when none is injected", async () => {
    await updateManifest(["en"], { manifestPath });

    const manifest = readManifest();
    expect(manifest.locales.en.narrationFingerprint).toBe(
      computeNarrationFingerprint("en"),
    );
  });

  it("defaults to the current source fingerprint when none is injected", async () => {
    await updateManifest(["en"], { manifestPath });

    const manifest = readManifest();
    expect(manifest.locales.en.sourceFingerprint).toBe(
      computeSourceFingerprint(),
    );
  });

  it("merges new locales without clobbering existing ones", async () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({
        locales: {
          en: {
            file: recordingFileName("en"),
            sourceFingerprint: "old-fp",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    await updateManifest(["es"], {
      manifestPath,
      fingerprint: "new-fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    // Pre-existing locale is left untouched.
    expect(manifest.locales.en.sourceFingerprint).toBe("old-fp");
    // Newly recorded locale is stamped with the fresh fingerprint.
    expect(manifest.locales.es.sourceFingerprint).toBe("new-fp");
  });

  it("re-recording refreshes the stamp for an already-present locale", async () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({
        locales: {
          en: {
            file: recordingFileName("en"),
            sourceFingerprint: "stale-fp",
            recordedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "fresh-fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    expect(manifest.locales.en.sourceFingerprint).toBe("fresh-fp");
    expect(manifest.locales.en.recordedAt).toBe("2026-05-31T00:00:00.000Z");
  });

  it("creates a fresh manifest when none exists yet", async () => {
    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    expect(Object.keys(manifest.locales)).toEqual(["en"]);
  });

  it("recovers from a corrupt manifest by starting fresh", async () => {
    writeFileSync(manifestPath, "{ this is not valid json");

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    expect(manifest.locales.en.sourceFingerprint).toBe("fp");
  });

  it("recovers from a manifest missing its `locales` key", async () => {
    writeFileSync(manifestPath, JSON.stringify({ somethingElse: true }));

    await updateManifest(["en"], {
      manifestPath,
      fingerprint: "fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    expect(manifest.locales.en.sourceFingerprint).toBe("fp");
  });

  it("does not stamp a timed-out locale end-to-end", async () => {
    const results = [
      { locale: "en", timedOut: false },
      { locale: "es", timedOut: true },
    ];
    const recorded = recordedLocalesFromResults(results);

    await updateManifest(recorded, {
      manifestPath,
      fingerprint: "fp",
      recordedAt: "2026-05-31T00:00:00.000Z",
    });

    const manifest = readManifest();
    expect(manifest.locales.en).toBeTruthy();
    expect(manifest.locales.es).toBeUndefined();
  });
});
