import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// checkAi probe strategies — unit tests
//
// These tests exercise the actual checkAi() implementation (not a mock) so
// they can validate the two probe strategies and the 404-fallback behaviour.
//
// Tests assert:
//   1. "models" strategy (default) — models.list() ok  → ProbeResult ok.
//   2. "models" strategy — models.list() 404           → falls back to completion → ok.
//   3. "models" strategy — models.list() non-404 error → degraded (no fallback).
//   4. "completion" strategy                           → completion ok → ok.
//   5. "completion" strategy — completion fails        → degraded.
//   6. No API key configured                           → unconfigured.
//   7. Cache: second call returns cached result.
//   8. Cache: expired cache triggers fresh probe.
// ============================================================================

// ── vi.hoisted: share mock fns between the factory (hoisted) and tests ───────

const { mockModelsList, mockChatCreate } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
  mockChatCreate: vi.fn(),
}));

// ── OpenAI mock ──────────────────────────────────────────────────────────────

vi.mock("openai", () => {
  class MockAPIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }

  class MockOpenAI {
    models = { list: mockModelsList };
    chat = { completions: { create: mockChatCreate } };
    static APIError = MockAPIError;
  }

  return { default: MockOpenAI };
});

// ── DB mock (prevent real DB connections) ────────────────────────────────────

vi.mock("../db", () => ({
  db: { execute: vi.fn().mockResolvedValue([]) },
}));

// ── Import AFTER mocks are registered ────────────────────────────────────────

import { checkAi, _resetAiProbeCache } from "../services/healthCheck";
import OpenAI from "openai";

// ── Helpers ──────────────────────────────────────────────────────────────────

function make404Error() {
  return new (OpenAI.APIError as unknown as new (
    msg: string,
    status: number,
  ) => { status: number; message: string })("Not Found", 404);
}

function makeGenericError(message = "Internal Server Error") {
  return new Error(message);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("checkAi probe strategies", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: "test-key",
      HEALTH_AI_PROBE: "models",
    };
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    _resetAiProbeCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetAiProbeCache();
  });

  // ── Unconfigured ──────────────────────────────────────────────────────────

  it("returns unconfigured when no API key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const result = await checkAi();
    expect(result).toEqual({ status: "unconfigured" });
    expect(mockModelsList).not.toHaveBeenCalled();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  // ── "models" strategy ─────────────────────────────────────────────────────

  it("models strategy: models.list() succeeds → ok", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockResolvedValueOnce({ data: [] });

    const result = await checkAi();

    expect(result.status).toBe("ok");
    expect(mockModelsList).toHaveBeenCalledOnce();
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("models strategy: models.list() 404 → falls back to completion → ok", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockRejectedValueOnce(make404Error());
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "pong" } }] });

    const result = await checkAi();

    expect(result.status).toBe("ok");
    expect(mockModelsList).toHaveBeenCalledOnce();
    expect(mockChatCreate).toHaveBeenCalledOnce();
    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 1 }),
    );
  });

  it("models strategy: models.list() non-404 error → degraded, no completion fallback", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockRejectedValueOnce(makeGenericError("connection refused"));

    const result = await checkAi();

    expect(result.status).toBe("degraded");
    expect(result.error).toBe("connection refused");
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it("models strategy: models.list() 404 and completion also fails → degraded", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockRejectedValueOnce(make404Error());
    mockChatCreate.mockRejectedValueOnce(makeGenericError("completion failed"));

    const result = await checkAi();

    expect(result.status).toBe("degraded");
    expect(result.error).toBe("completion failed");
  });

  // ── "completion" strategy ─────────────────────────────────────────────────

  it("completion strategy: completion succeeds → ok, skips models.list()", async () => {
    process.env.HEALTH_AI_PROBE = "completion";
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "pong" } }] });

    const result = await checkAi();

    expect(result.status).toBe("ok");
    expect(mockModelsList).not.toHaveBeenCalled();
    expect(mockChatCreate).toHaveBeenCalledOnce();
  });

  it("completion strategy: completion fails → degraded", async () => {
    process.env.HEALTH_AI_PROBE = "completion";
    mockChatCreate.mockRejectedValueOnce(makeGenericError("rate limited"));

    const result = await checkAi();

    expect(result.status).toBe("degraded");
    expect(result.error).toBe("rate limited");
  });

  it("completion strategy: uses OPENAI_MODEL env var for the probe model", async () => {
    process.env.HEALTH_AI_PROBE = "completion";
    process.env.OPENAI_MODEL = "gpt-4o";
    mockChatCreate.mockResolvedValueOnce({ choices: [] });

    await checkAi();

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
    );
  });

  it("completion strategy: defaults to gpt-4o-mini when OPENAI_MODEL is unset", async () => {
    process.env.HEALTH_AI_PROBE = "completion";
    delete process.env.OPENAI_MODEL;
    mockChatCreate.mockResolvedValueOnce({ choices: [] });

    await checkAi();

    expect(mockChatCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  // ── Cache behaviour ───────────────────────────────────────────────────────

  it("caches the result and skips the probe on a second call within TTL", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockResolvedValue({ data: [] });

    const first = await checkAi();
    const second = await checkAi();

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(mockModelsList).toHaveBeenCalledOnce();
  });

  it("re-probes after the cache TTL expires", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockResolvedValue({ data: [] });

    await checkAi();

    _resetAiProbeCache();

    await checkAi();

    expect(mockModelsList).toHaveBeenCalledTimes(2);
  });

  it("caches a degraded result the same as an ok result", async () => {
    process.env.HEALTH_AI_PROBE = "models";
    mockModelsList.mockRejectedValue(makeGenericError("bad gateway"));

    const first = await checkAi();
    const second = await checkAi();

    expect(first.status).toBe("degraded");
    expect(second.status).toBe("degraded");
    expect(mockModelsList).toHaveBeenCalledOnce();
  });
});
