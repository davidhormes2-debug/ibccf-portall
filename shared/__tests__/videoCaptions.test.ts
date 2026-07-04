// @vitest-environment node
//
// Regression guard: every locale in VIDEO_CAPTIONS must have the same
// structural shape as English.
//
// The withdrawal tutorial video is a live React animation driven entirely by
// the locale-keyed caption table in shared/videoCaptions.ts.  The table is
// hand-maintained, so a translator can add a new scene line in English but
// forget to mirror it in one or more locales.  When that happens the video
// silently renders English (or undefined) for that locale — this guard catches
// the drift at unit-test time before it ships.
//
// Assertions per non-English locale:
//  1. All six locale codes are present in VIDEO_CAPTIONS.
//  2. intro.titleLines  length  matches en.
//  3. intro.subtitleLines length matches en.
//  4. All four phases (phase1-phase4) are present.
//  5. Each phase's stages array length matches en.
//  6. Every leaf string field (badge, label, description, each stage,
//     every title/subtitle line, every role label) is a non-empty string.
//
// Additionally the two re-export stubs
//   client/src/components/portal/withdrawal-video/captions.ts
//   video/src/components/video/captions.ts
// must stay byte-for-byte identical — both should be thin re-exports of
// @shared/videoCaptions and must never diverge.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIDEO_CAPTIONS,
  type VideoLocaleCode,
  type VideoCaptions,
  type PhaseCaptions,
} from "../videoCaptions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runtime guard: a value has the PhaseCaptions shape when it owns a `stages` array. */
function isPhaseCaptionsValue(value: unknown): value is PhaseCaptions {
  return (
    typeof value === "object" &&
    value !== null &&
    "stages" in value &&
    Array.isArray((value as { stages: unknown }).stages)
  );
}

/**
 * Derive phase keys at runtime from the English captions object so that any
 * new phaseN added to the `VideoCaptions` interface and the `en` locale is
 * automatically included in every assertion without touching this file.
 */
const en = VIDEO_CAPTIONS["en"];
const PHASES: string[] = Object.keys(en).filter((key) =>
  isPhaseCaptionsValue((en as Record<string, unknown>)[key]),
);

const ALL_LOCALES = Object.keys(VIDEO_CAPTIONS) as VideoLocaleCode[];
const NON_EN_LOCALES = ALL_LOCALES.filter((l) => l !== "en");

// ---------------------------------------------------------------------------
// 1. Locale presence
// ---------------------------------------------------------------------------

describe("VIDEO_CAPTIONS locale presence", () => {
  const EXPECTED: VideoLocaleCode[] = ["en", "es", "fr", "de", "pt", "zh"];

  it("contains exactly the six expected locale codes", () => {
    expect(ALL_LOCALES.sort()).toEqual(EXPECTED.sort());
  });

  for (const locale of EXPECTED) {
    it(`locale "${locale}" is present`, () => {
      expect(
        VIDEO_CAPTIONS[locale],
        `VIDEO_CAPTIONS is missing locale "${locale}". ` +
          `Add it to shared/videoCaptions.ts.`,
      ).toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// 2. intro shape parity with en
// ---------------------------------------------------------------------------

describe("VIDEO_CAPTIONS intro shape parity with en", () => {
  for (const locale of NON_EN_LOCALES) {
    const captions: VideoCaptions = VIDEO_CAPTIONS[locale];

    it(`${locale}: intro.titleLines has the same length as en (${en.intro.titleLines.length})`, () => {
      expect(
        captions.intro.titleLines.length,
        `VIDEO_CAPTIONS["${locale}"].intro.titleLines has ` +
          `${captions.intro.titleLines.length} item(s) but en has ` +
          `${en.intro.titleLines.length}. ` +
          `Update shared/videoCaptions.ts to match.`,
      ).toBe(en.intro.titleLines.length);
    });

    it(`${locale}: intro.subtitleLines has the same length as en (${en.intro.subtitleLines.length})`, () => {
      expect(
        captions.intro.subtitleLines.length,
        `VIDEO_CAPTIONS["${locale}"].intro.subtitleLines has ` +
          `${captions.intro.subtitleLines.length} item(s) but en has ` +
          `${en.intro.subtitleLines.length}. ` +
          `Update shared/videoCaptions.ts to match.`,
      ).toBe(en.intro.subtitleLines.length);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Phase presence
// ---------------------------------------------------------------------------

describe("VIDEO_CAPTIONS phase presence", () => {
  for (const locale of ALL_LOCALES) {
    const captions = VIDEO_CAPTIONS[locale] as Record<string, unknown>;

    for (const phase of PHASES) {
      it(`${locale}: "${phase}" is present`, () => {
        expect(
          captions[phase],
          `VIDEO_CAPTIONS["${locale}"] is missing phase "${phase}". ` +
            `Update shared/videoCaptions.ts to add this phase for locale "${locale}".`,
        ).toBeTruthy();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3b. Phase key set exhaustiveness — every locale must have exactly the same
//     phase keys as en (no more, no fewer). This catches a new phaseN added
//     to en but forgotten in a translated locale.
// ---------------------------------------------------------------------------

describe("VIDEO_CAPTIONS phase key set parity with en", () => {
  const enPhaseKeys = PHASES.slice().sort();

  for (const locale of NON_EN_LOCALES) {
    it(`${locale}: phase key set exactly matches en ([${enPhaseKeys.join(", ")}])`, () => {
      const localePhaseKeys = Object.keys(VIDEO_CAPTIONS[locale])
        .filter((key) =>
          isPhaseCaptionsValue(
            (VIDEO_CAPTIONS[locale] as Record<string, unknown>)[key],
          ),
        )
        .sort();
      expect(
        localePhaseKeys,
        `VIDEO_CAPTIONS["${locale}"] has phase keys [${localePhaseKeys.join(", ")}] ` +
          `but en has [${enPhaseKeys.join(", ")}]. ` +
          `Add any missing phases to shared/videoCaptions.ts for locale "${locale}".`,
      ).toEqual(enPhaseKeys);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Phase stages and titleLines array length parity with en
// ---------------------------------------------------------------------------

describe("VIDEO_CAPTIONS phase stages array length parity with en", () => {
  for (const locale of NON_EN_LOCALES) {
    const captions = VIDEO_CAPTIONS[locale] as Record<string, PhaseCaptions>;

    for (const phase of PHASES) {
      const enStagesLen = (en as Record<string, PhaseCaptions>)[phase].stages.length;
      const localeStagesLen = captions[phase].stages.length;

      it(`${locale}/${phase}: stages has the same length as en (${enStagesLen})`, () => {
        expect(
          localeStagesLen,
          `VIDEO_CAPTIONS["${locale}"]["${phase}"].stages has ${localeStagesLen} ` +
            `item(s) but en has ${enStagesLen}. ` +
            `Update shared/videoCaptions.ts to add the missing stage strings ` +
            `for locale "${locale}" in "${phase}".`,
        ).toBe(enStagesLen);
      });
    }
  }
});

describe("VIDEO_CAPTIONS phase titleLines array length parity with en", () => {
  for (const locale of NON_EN_LOCALES) {
    const captions = VIDEO_CAPTIONS[locale] as Record<string, PhaseCaptions>;

    for (const phase of PHASES) {
      const enLen = (en as Record<string, PhaseCaptions>)[phase].titleLines.length;
      const localeLen = captions[phase].titleLines.length;

      it(`${locale}/${phase}: titleLines has the same length as en (${enLen})`, () => {
        expect(
          localeLen,
          `VIDEO_CAPTIONS["${locale}"]["${phase}"].titleLines has ${localeLen} ` +
            `item(s) but en has ${enLen}. ` +
            `Update shared/videoCaptions.ts to match the English titleLines count ` +
            `for locale "${locale}" in "${phase}".`,
        ).toBe(enLen);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Non-empty leaf strings
// ---------------------------------------------------------------------------

function assertNonEmpty(value: unknown, path: string): void {
  expect(
    typeof value,
    `${path} should be a string (got ${typeof value})`,
  ).toBe("string");
  expect(
    (value as string).trim().length,
    `${path} is an empty or blank string. ` +
      `Fill in the translation for this field in shared/videoCaptions.ts.`,
  ).toBeGreaterThan(0);
}

describe("VIDEO_CAPTIONS non-empty leaf strings", () => {
  for (const locale of ALL_LOCALES) {
    const captions: VideoCaptions = VIDEO_CAPTIONS[locale];
    const p = (field: string) => `VIDEO_CAPTIONS["${locale}"].${field}`;

    it(`${locale}: intro fields are non-empty`, () => {
      assertNonEmpty(captions.intro.badge, p("intro.badge"));
      for (let i = 0; i < captions.intro.titleLines.length; i++) {
        assertNonEmpty(captions.intro.titleLines[i], p(`intro.titleLines[${i}]`));
      }
      for (let i = 0; i < captions.intro.subtitleLines.length; i++) {
        assertNonEmpty(
          captions.intro.subtitleLines[i],
          p(`intro.subtitleLines[${i}]`),
        );
      }
    });

    it(`${locale}: roles fields are non-empty`, () => {
      for (const role of ["user", "admin", "system", "complete"] as const) {
        assertNonEmpty(captions.roles[role], p(`roles.${role}`));
      }
    });

    for (const phase of PHASES) {
      const phaseData: PhaseCaptions = (captions as Record<string, PhaseCaptions>)[phase];

      it(`${locale}/${phase}: phase fields are non-empty`, () => {
        assertNonEmpty(phaseData.label, p(`${phase}.label`));
        assertNonEmpty(phaseData.description, p(`${phase}.description`));
        for (let i = 0; i < phaseData.titleLines.length; i++) {
          assertNonEmpty(phaseData.titleLines[i], p(`${phase}.titleLines[${i}]`));
        }
        for (let i = 0; i < phaseData.stages.length; i++) {
          assertNonEmpty(phaseData.stages[i], p(`${phase}.stages[${i}]`));
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Re-export stubs stay byte-for-byte identical
//
// Both files should contain only `export * from "@shared/videoCaptions"` and
// must never diverge.  If one is edited to hardcode values while the other
// keeps the re-export, the animation will silently use stale copy.
// ---------------------------------------------------------------------------

describe("captions.ts re-export stubs are identical", () => {
  const portalStub = readFileSync(
    join(
      REPO_ROOT,
      "client",
      "src",
      "components",
      "portal",
      "withdrawal-video",
      "captions.ts",
    ),
    "utf8",
  );

  const videoStub = readFileSync(
    join(REPO_ROOT, "video", "src", "components", "video", "captions.ts"),
    "utf8",
  );

  it("client and video captions.ts stubs have the same content", () => {
    expect(
      videoStub,
      "video/src/components/video/captions.ts differs from " +
        "client/src/components/portal/withdrawal-video/captions.ts. " +
        "Both files must be identical thin re-exports of @shared/videoCaptions. " +
        "Update the diverged file to match.",
    ).toBe(portalStub);
  });
});
