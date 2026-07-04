import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// checkAi() — probe-label change detection
//
// Verifies that a structured console.warn is emitted when the probe label
// changes between two consecutive successful probes so operators can track
// strategy switches (e.g. "models" → "models→completion-fallback") rather
// than seeing only the most-recent cached snapshot.
//
// Key insight: the cache stores the previous label even after TTL expiry
// (only `expiresAt` is past, _aiCache itself is not null).  Tests therefore
// use fake timers to advance past AI_PROBE_CACHE_TTL_MS instead of calling
// _resetAiProbeCache(), which would wipe the label and prevent detection.
// ============================================================================

// ── Mock OpenAI so no real network calls are made ───────────────────────────

const mockModelsList = vi.fn();
const mockCompletionsCreate = vi.fn();

class MockAPIError extends Error {
  status: number;
  constructor(message: string, init: { status: number }) {
    super(message);
    this.status = init.status;
  }
}

vi.mock("openai", () => {
  class MockOpenAI {
    models = { list: mockModelsList };
    chat = { completions: { create: mockCompletionsCreate } };
    static APIError = MockAPIError;
  }
  return {
    default: MockOpenAI,
    APIError: MockAPIError,
  };
});

// ── Import after mocking ─────────────────────────────────────────────────────

const { checkAi, _resetAiProbeCache } = await import(
  "../services/healthCheck"
);

// TTL must exceed 60 s to expire the 60-second probe cache.
const CACHE_TTL_PLUS_ONE_MS = 61_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("checkAi() probe-label change detection", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Start with a clean cache and real timers for each test.
    _resetAiProbeCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setEnv("OPENAI_API_KEY", "test-key");
    setEnv("HEALTH_AI_PROBE", "models");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("HEALTH_AI_PROBE", undefined);
  });

  it("does NOT warn on the very first successful probe (no previous label)", async () => {
    mockModelsList.mockResolvedValue({});
    await checkAi();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when the label is the same across two consecutive probes", async () => {
    mockModelsList.mockResolvedValue({});

    // First probe — seeds the cache.
    await checkAi();

    // Expire the TTL so the second call runs a fresh probe (cache is stale,
    // but _aiCache is NOT null — the old label is still accessible).
    vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);
    await checkAi();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits a structured console.warn when the label changes between probes", async () => {
    // ── First probe: "models" succeeds ──────────────────────────────────────
    mockModelsList.mockResolvedValueOnce({});
    const first = await checkAi();
    expect(first.probe).toBe("models");
    expect(warnSpy).not.toHaveBeenCalled();

    // Expire the TTL — _aiCache still holds the previous "models" label.
    vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);

    // ── Second probe: /v1/models returns 404, falls back to completion ───────
    mockModelsList.mockRejectedValueOnce(
      new MockAPIError("Not found", { status: 404 }),
    );
    mockCompletionsCreate.mockResolvedValueOnce({});

    const second = await checkAi();
    expect(second.probe).toBe("models→completion-fallback");

    // A structured warning must have been emitted for the strategy switch.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload).toEqual({
      event: "ai_probe_strategy_changed",
      previous: "models",
      current: "models→completion-fallback",
    });
  });

  it("emits a structured warn when recovering from fallback back to models", async () => {
    // ── First probe: fallback ────────────────────────────────────────────────
    mockModelsList.mockRejectedValueOnce(
      new MockAPIError("Not found", { status: 404 }),
    );
    mockCompletionsCreate.mockResolvedValueOnce({});
    const first = await checkAi();
    expect(first.probe).toBe("models→completion-fallback");

    vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);
    warnSpy.mockClear();

    // ── Second probe: models succeeds again ──────────────────────────────────
    mockModelsList.mockResolvedValueOnce({});
    const second = await checkAi();
    expect(second.probe).toBe("models");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload).toEqual({
      event: "ai_probe_strategy_changed",
      previous: "models→completion-fallback",
      current: "models",
    });
  });

  it("does NOT warn when the second probe is degraded (no label change to report)", async () => {
    mockModelsList.mockResolvedValueOnce({});
    await checkAi();

    vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);
    warnSpy.mockClear();

    // Second probe fails entirely — no label, so no strategy-switch event.
    mockModelsList.mockRejectedValueOnce(new Error("network error"));
    const result = await checkAi();
    expect(result.status).toBe("degraded");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
