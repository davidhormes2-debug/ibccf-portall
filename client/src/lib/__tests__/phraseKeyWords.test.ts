// @vitest-environment node
//
// Task #834 — Lock down the admin "Phrase Key" generator so a regression
// (wrong word count, duplicate words, or words leaking in from outside the
// curated pool) can't ship unnoticed.
//
// generatePhraseKey() backs the one-click "Auto-generate" button in the
// admin case-detail "Phrase Key" tab. It must always return exactly the
// requested number of distinct, space-separated words drawn from
// PHRASE_KEY_WORDS.

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  PHRASE_KEY_WORDS,
  generatePhraseKey,
  countPhraseWords,
  phraseWordsFromCode,
  phraseLengthFromCode,
} from "../phraseKeyWords";

// Math.random is non-deterministic, so exercise each count many times to
// shake out any off-by-one / duplicate / pool-leak regressions.
const ITERATIONS = 200;

describe("generatePhraseKey", () => {
  it("PHRASE_KEY_WORDS is the full 2048-word BIP39 list with no duplicates", () => {
    // The generator draws WITHOUT replacement, so the pool must hold at least
    // the longest phrase (24) — and every word must be unique or distinctness
    // breaks. The canonical BIP39 English list is exactly 2048 words.
    expect(PHRASE_KEY_WORDS.length).toBe(2048);
    expect(new Set(PHRASE_KEY_WORDS).size).toBe(PHRASE_KEY_WORDS.length);
    // Spot-check the canonical first/last entries.
    expect(PHRASE_KEY_WORDS[0]).toBe("abandon");
    expect(PHRASE_KEY_WORDS[PHRASE_KEY_WORDS.length - 1]).toBe("zoo");
  });

  it("matches the canonical BIP39 English list byte-for-byte", () => {
    // Pin the exact wordlist (newline-joined, trailing newline) against the
    // official bitcoin/bips bip-0039/english.txt SHA-256 so a stray edit,
    // reorder, or typo in any of the 2048 entries is caught immediately.
    const digest = createHash("sha256")
      .update(PHRASE_KEY_WORDS.join("\n") + "\n")
      .digest("hex");
    expect(digest).toBe(
      "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda",
    );
  });

  for (const count of [6, 12, 24] as const) {
    describe(`count = ${count}`, () => {
      it(`returns exactly ${count} space-separated words`, () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const words = generatePhraseKey(count).split(" ");
          expect(words).toHaveLength(count);
          // No empty / whitespace-only tokens (would mean a stray double space).
          for (const w of words) expect(w).toMatch(/^\S+$/);
        }
      });

      it(`returns ${count} DISTINCT words (drawn without replacement)`, () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const words = generatePhraseKey(count).split(" ");
          expect(new Set(words).size).toBe(count);
        }
      });

      it(`only ever returns words from PHRASE_KEY_WORDS`, () => {
        const pool = new Set(PHRASE_KEY_WORDS);
        for (let i = 0; i < ITERATIONS; i++) {
          for (const w of generatePhraseKey(count).split(" ")) {
            expect(pool.has(w)).toBe(true);
          }
        }
      });
    });
  }

  it("does not mutate the shared PHRASE_KEY_WORDS pool", () => {
    const before = [...PHRASE_KEY_WORDS];
    generatePhraseKey(6);
    generatePhraseKey(12);
    generatePhraseKey(24);
    expect(PHRASE_KEY_WORDS).toEqual(before);
  });
});

// The tokenization helpers are the single source of truth shared by the admin
// word-count hint, the length-selector hydration, and the portal phrase reveal.
// These lock their equivalence so a change to one surface can't silently drift.
describe("phraseWordsFromCode", () => {
  it("splits on any run of whitespace and drops empty tokens", () => {
    expect(phraseWordsFromCode("alpha beta gamma")).toEqual(["alpha", "beta", "gamma"]);
    expect(phraseWordsFromCode("  alpha   beta \n gamma\t")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns an empty array for empty / whitespace-only input", () => {
    expect(phraseWordsFromCode("")).toEqual([]);
    expect(phraseWordsFromCode("   \n\t ")).toEqual([]);
  });
});

describe("countPhraseWords", () => {
  it("agrees with phraseWordsFromCode().length", () => {
    for (const s of ["", "  ", "one", "one two", "  a  b   c  "]) {
      expect(countPhraseWords(s)).toBe(phraseWordsFromCode(s).length);
    }
  });

  it("counts a generated phrase exactly", () => {
    expect(countPhraseWords(generatePhraseKey(6))).toBe(6);
    expect(countPhraseWords(generatePhraseKey(12))).toBe(12);
    expect(countPhraseWords(generatePhraseKey(24))).toBe(24);
  });
});

describe("phraseLengthFromCode", () => {
  it("returns 6 only for an exactly-6-word phrase", () => {
    expect(phraseLengthFromCode("a b c d e f")).toBe(6);
    expect(phraseLengthFromCode(generatePhraseKey(6))).toBe(6);
  });

  it("returns 24 only for an exactly-24-word phrase", () => {
    expect(phraseLengthFromCode(generatePhraseKey(24))).toBe(24);
  });

  it("defaults to 12 for empty, 12-word, or any non-6/24 count", () => {
    expect(phraseLengthFromCode("")).toBe(12);
    expect(phraseLengthFromCode("a b c")).toBe(12);
    expect(phraseLengthFromCode("a b c d e f g")).toBe(12);
    expect(phraseLengthFromCode(generatePhraseKey(12))).toBe(12);
  });
});
