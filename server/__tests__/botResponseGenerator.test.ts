import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ============================================================================
// bot-response-generator — OpenAI parameter shape guard
//
// `gpt-4o-mini` / `gpt-5-mini` no longer accept `max_tokens`.  Every call
// that uses `max_tokens` is rejected by the API with:
//   "max_tokens is not supported with this model. Use max_completion_tokens instead."
// The bot then silently falls back to static templates without logging a
// user-visible error, so the regression is invisible in normal operation.
//
// These assertions verify that the `chat.completions.create` call in
// `generateAIResponse` (server/services/bot-response-generator.ts) uses
// `max_completion_tokens` and does NOT use the legacy `max_tokens` parameter.
// They will fail immediately if a future refactor reverts the parameter name.
// ============================================================================

const BOT_GENERATOR_PATH = resolve(
  __dirname,
  "../services/bot-response-generator.ts",
);

function readSource(): string {
  return readFileSync(BOT_GENERATOR_PATH, "utf-8");
}

describe("bot-response-generator — OpenAI parameter shape", () => {
  it("uses max_completion_tokens in the chat.completions.create call", () => {
    const src = readSource();

    // The create() options block must contain max_completion_tokens.
    expect(
      src,
      "bot-response-generator.ts must pass max_completion_tokens to " +
        "openai.chat.completions.create — gpt-4o-mini rejects max_tokens",
    ).toContain("max_completion_tokens");
  });

  it("does NOT use the legacy max_tokens parameter", () => {
    const src = readSource();

    // Strip comments so an inline note like "// was: max_tokens" does not
    // produce a false positive.
    const noComments = src
      .replace(/\/\/[^\n]*/g, "")   // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments

    // Use a regex with a word-boundary so `max_completion_tokens` does not
    // match — we want to catch the standalone `max_tokens` key only.
    expect(
      /\bmax_tokens\b/.test(noComments),
      "bot-response-generator.ts must not pass max_tokens to " +
        "openai.chat.completions.create — use max_completion_tokens instead " +
        "(gpt-4o-mini/gpt-5-mini reject the legacy parameter)",
    ).toBe(false);
  });

  it("passes max_completion_tokens inside the same create() call block that sets the model", () => {
    const src = readSource();

    // Find the chat.completions.create call and verify both `model` and
    // `max_completion_tokens` appear within a small window of each other,
    // confirming the parameter is in the right call and not just mentioned
    // elsewhere in the file.
    const createIdx = src.indexOf("openai.chat.completions.create");
    expect(createIdx, "openai.chat.completions.create not found in source").toBeGreaterThan(-1);

    // Grab the 500 characters after the `create(` opening — enough to cover
    // the full options object without spanning an unrelated call.
    const callSlice = src.slice(createIdx, createIdx + 500);

    expect(
      callSlice,
      "max_completion_tokens must appear in the openai.chat.completions.create " +
        "options object (within 500 chars of the call site)",
    ).toContain("max_completion_tokens");

    expect(
      callSlice,
      "model field must appear in the openai.chat.completions.create options " +
        "object — confirms we are looking at the right call",
    ).toContain("model");
  });
});

// ============================================================================
// generateFreshTopic — response_format shape guard
//
// `generateFreshTopic` asks the model to return raw JSON and relies on
// `response_format: { type: "json_object" }` to guarantee that. If a future
// default model stops supporting this option, the `create()` call throws,
// the surrounding try/catch swallows it, and the bot silently falls back to
// static templates — the same invisible-failure pattern as the max_tokens
// issue, just for a different parameter.
//
// These assertions bound their search to the `generateFreshTopic` function
// body (from its declaration to the start of the next function) rather than
// a fixed character window, so the test stays correct even if the function
// grows or shrinks.
// ============================================================================

describe("generateFreshTopic — response_format shape", () => {
  function getFreshTopicBody(): string {
    const src = readSource();
    const startMarker = "async function generateFreshTopic(";
    const startIdx = src.indexOf(startMarker);
    expect(startIdx, "generateFreshTopic function not found in source").toBeGreaterThan(-1);

    const nextFnIdx = src.indexOf("\nasync function ", startIdx + startMarker.length);
    expect(nextFnIdx, "could not find the end of generateFreshTopic (next function declaration)").toBeGreaterThan(-1);

    return src.slice(startIdx, nextFnIdx);
  }

  it("includes response_format: { type: \"json_object\" } in the generateFreshTopic create() call", () => {
    const body = getFreshTopicBody();

    expect(
      body,
      "generateFreshTopic must pass response_format: { type: \"json_object\" } to " +
        "openai.chat.completions.create so the model reliably returns parseable JSON",
    ).toContain('response_format: { type: "json_object" }');
  });

  it("keeps response_format within the same create() call that sets max_completion_tokens", () => {
    const body = getFreshTopicBody();

    const createIdx = body.indexOf("openai.chat.completions.create");
    expect(createIdx, "openai.chat.completions.create not found within generateFreshTopic").toBeGreaterThan(-1);

    const closeParenIdx = body.indexOf("});", createIdx);
    expect(closeParenIdx, "could not find the end of the create() call in generateFreshTopic").toBeGreaterThan(-1);

    const callSlice = body.slice(createIdx, closeParenIdx);

    expect(
      callSlice,
      "response_format must appear inside the generateFreshTopic create() options object",
    ).toContain("response_format");

    expect(
      callSlice,
      "max_completion_tokens must also appear in the same create() call — confirms " +
        "we are looking at the right options object",
    ).toContain("max_completion_tokens");
  });
});

// ============================================================================
// JSON-safety-net inventory guard
//
// As of this writing, `generateFreshTopic` is the ONLY `chat.completions.create`
// call site in this file that depends on `response_format: { type: "json_object" }`
// (it JSON.parses the raw response). `generateAIResponse` and `generateBotThread`
// both return the model's plain-text content directly and have no JSON
// safety-net dependency, so they don't need equivalent coverage.
//
// This test counts `response_format` occurrences in the source. If a future
// change adds a new JSON-dependent call site (a new `response_format:` usage)
// without also adding a matching source-assertion test above, this count
// assertion breaks — signalling that the new call site needs its own
// "response_format shape guard" test, following the `generateFreshTopic`
// pattern, instead of silently shipping with no regression coverage.
// ============================================================================

describe("bot-response-generator — response_format inventory", () => {
  it("has exactly one response_format usage (generateFreshTopic) — add a matching guard test if this changes", () => {
    const src = readSource();
    const noComments = src
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const matches = noComments.match(/response_format\s*:/g) || [];

    expect(
      matches.length,
      "A new `response_format:` usage was found in bot-response-generator.ts. " +
        "If this is a new OpenAI call site that depends on structured/JSON output, " +
        "add a source-assertion test guarding it (see the 'generateFreshTopic — " +
        "response_format shape' describe block above for the pattern) before " +
        "updating this expected count — otherwise a future model change could " +
        "silently break it via the try/catch fallback with no test signal.",
    ).toBe(1);
  });

  it("confirms generateAIResponse and generateBotThread do not rely on response_format (plain-text calls)", () => {
    const src = readSource();

    const aiResponseStart = src.indexOf("async function generateAIResponse(");
    const aiResponseEnd = src.indexOf("\nasync function ", aiResponseStart + 1);
    expect(aiResponseStart, "generateAIResponse function not found in source").toBeGreaterThan(-1);
    expect(aiResponseEnd, "could not find the end of generateAIResponse").toBeGreaterThan(-1);
    const aiResponseBody = src.slice(aiResponseStart, aiResponseEnd);
    expect(
      aiResponseBody,
      "generateAIResponse now uses response_format — it needs its own JSON " +
        "shape guard test since it would be exposed to the same invisible " +
        "failure pattern as generateFreshTopic",
    ).not.toContain("response_format");

    const botThreadStart = src.indexOf("async function generateBotThread(");
    expect(botThreadStart, "generateBotThread function not found in source").toBeGreaterThan(-1);
    const botThreadEnd = src.indexOf("\nexport async function ", botThreadStart + 1);
    expect(botThreadEnd, "could not find the end of generateBotThread").toBeGreaterThan(-1);
    const botThreadBody = src.slice(botThreadStart, botThreadEnd);
    expect(
      botThreadBody,
      "generateBotThread now uses response_format — it needs its own JSON " +
        "shape guard test since it would be exposed to the same invisible " +
        "failure pattern as generateFreshTopic",
    ).not.toContain("response_format");
  });
});

// ============================================================================
// generateBotThread — max_completion_tokens shape guard
//
// `generateBotThread` (the auto-thread-opener generator) has its own
// `openai.chat.completions.create()` call site, separate from the one
// covered by the "OpenAI parameter shape" describe block above (which only
// anchors to the FIRST occurrence of `openai.chat.completions.create` in the
// file, i.e. the one inside `generateAIResponse`). If this call site ever
// regresses back to the legacy `max_tokens` parameter, the surrounding
// try/catch swallows the resulting API error and silently falls back to a
// static template — the same invisible-failure pattern already guarded for
// the other two call sites.
//
// These assertions bound their search to the `generateBotThread` function
// body (from its declaration to the start of the next function) rather than
// a fixed character window, so the test stays correct even if the function
// grows or shrinks.
// ============================================================================

describe("generateBotThread — max_completion_tokens shape", () => {
  function getBotThreadBody(): string {
    const src = readSource();
    const startMarker = "async function generateBotThread(";
    const startIdx = src.indexOf(startMarker);
    expect(startIdx, "generateBotThread function not found in source").toBeGreaterThan(-1);

    const nextFnIdx = src.indexOf("\nexport async function ", startIdx + startMarker.length);
    expect(nextFnIdx, "could not find the end of generateBotThread (next function declaration)").toBeGreaterThan(-1);

    return src.slice(startIdx, nextFnIdx);
  }

  it("includes max_completion_tokens in the generateBotThread create() call", () => {
    const body = getBotThreadBody();

    const createIdx = body.indexOf("openai.chat.completions.create");
    expect(createIdx, "openai.chat.completions.create not found within generateBotThread").toBeGreaterThan(-1);

    const closeParenIdx = body.indexOf("});", createIdx);
    expect(closeParenIdx, "could not find the end of the create() call in generateBotThread").toBeGreaterThan(-1);

    const callSlice = body.slice(createIdx, closeParenIdx);

    expect(
      callSlice,
      "generateBotThread must pass max_completion_tokens to " +
        "openai.chat.completions.create — gpt-4o-mini rejects max_tokens",
    ).toContain("max_completion_tokens");
  });

  it("does NOT use the legacy max_tokens parameter in the generateBotThread create() call", () => {
    const body = getBotThreadBody();
    const noComments = body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    expect(
      /\bmax_tokens\b/.test(noComments),
      "generateBotThread must not pass max_tokens to " +
        "openai.chat.completions.create — use max_completion_tokens instead " +
        "or the call will be rejected by the API and silently fall back to a " +
        "static template via the surrounding try/catch",
    ).toBe(false);
  });
});
