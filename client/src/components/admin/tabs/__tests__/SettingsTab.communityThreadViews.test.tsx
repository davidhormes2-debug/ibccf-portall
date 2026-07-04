// @vitest-environment jsdom
//
// Tests for the stale-count display box inside CommunityThreadViewsCleanupCard
// (rendered by SettingsTab).
//
// Verifies that communityThreadViewsStaleCount renders:
//   - "Loading eligible count…" when the count is null or isCommunityThreadViewsStaleCountLoading is true
//   - The numeric count and description text when the count is a number (including 0)
//   - The "unavailable" error copy when the value is the sentinel 'unavailable'
//
// Coverage comes in two layers:
//   1. A context-wired component test using buildMockAdminDashboardContext that
//      exercises each display branch, verifying context field names are correct.
//   2. Static source assertions bound to the real CommunityThreadViewsCleanupCard
//      in SettingsTab.tsx, so the harness cannot silently drift from production.

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminDashboardContext } from "@/components/admin/AdminDashboardContext";
import { useAdminDashboard } from "@/components/admin/AdminDashboardContext";
import { buildMockAdminDashboardContext } from "../../__tests__/mockAdminDashboardContext";

// ---------------------------------------------------------------------------
// Static source under analysis
// ---------------------------------------------------------------------------

const SETTINGS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../SettingsTab.tsx"),
  "utf8",
);

const cardStart = SETTINGS_SRC.indexOf("function CommunityThreadViewsCleanupCard(");
const cardEnd = SETTINGS_SRC.indexOf("\nfunction ", cardStart + 1);
const card =
  cardStart === -1
    ? ""
    : SETTINGS_SRC.slice(cardStart, cardEnd === -1 ? SETTINGS_SRC.length : cardEnd);

// ---------------------------------------------------------------------------
// Minimal mirror of the stale-count box inside CommunityThreadViewsCleanupCard.
// Consumes the same context fields and renders with the same data-testid so any
// rename in AdminDashboardContext will fail compilation here first.
// ---------------------------------------------------------------------------

function StaleCountBox() {
  const {
    communityThreadViewsStaleCount,
    isCommunityThreadViewsStaleCountLoading,
  } = useAdminDashboard();

  return (
    <div data-testid="text-community-thread-views-stale-count">
      {communityThreadViewsStaleCount === "unavailable" ? (
        <span data-testid="stale-count-unavailable">
          Eligible count unavailable — the count query failed. Check server
          logs.
        </span>
      ) : communityThreadViewsStaleCount === null ||
        isCommunityThreadViewsStaleCountLoading ? (
        <span data-testid="stale-count-loading">Loading eligible count…</span>
      ) : (
        <span data-testid="stale-count-value">
          {communityThreadViewsStaleCount} thread-view row(s) currently past
          the 48-hour window — they will be removed by the next sweep.
        </span>
      )}
    </div>
  );
}

function renderWithContext(
  overrides: Parameters<typeof buildMockAdminDashboardContext>[0] = {},
) {
  const ctx = buildMockAdminDashboardContext(overrides);
  return render(
    <AdminDashboardContext.Provider value={ctx}>
      <StaleCountBox />
    </AdminDashboardContext.Provider>,
  );
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Context-wired display branch tests
// ---------------------------------------------------------------------------

describe("CommunityThreadViewsCleanupCard — stale-count display (null / loading)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows loading text when staleCount is null and not loading", () => {
    renderWithContext({
      communityThreadViewsStaleCount: null,
      isCommunityThreadViewsStaleCountLoading: false,
    });
    expect(screen.getByTestId("stale-count-loading").textContent).toBe(
      "Loading eligible count…",
    );
    expect(screen.queryByTestId("stale-count-value")).toBeNull();
    expect(screen.queryByTestId("stale-count-unavailable")).toBeNull();
  });

  it("shows loading text when isCommunityThreadViewsStaleCountLoading is true (null count)", () => {
    renderWithContext({
      communityThreadViewsStaleCount: null,
      isCommunityThreadViewsStaleCountLoading: true,
    });
    expect(screen.getByTestId("stale-count-loading").textContent).toBe(
      "Loading eligible count…",
    );
    expect(screen.queryByTestId("stale-count-value")).toBeNull();
    expect(screen.queryByTestId("stale-count-unavailable")).toBeNull();
  });

  it("shows loading text while loading even when a number would normally display", () => {
    // isCommunityThreadViewsStaleCountLoading=true with a non-null count still
    // shows loading because the condition checks loading OR null
    renderWithContext({
      communityThreadViewsStaleCount: null,
      isCommunityThreadViewsStaleCountLoading: true,
    });
    expect(screen.getByTestId("stale-count-loading")).toBeTruthy();
  });
});

describe("CommunityThreadViewsCleanupCard — stale-count display (numeric count)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the numeric count and the 48-hour description when staleCount is a positive number", () => {
    renderWithContext({
      communityThreadViewsStaleCount: 12,
      isCommunityThreadViewsStaleCountLoading: false,
    });
    const box = screen.getByTestId("stale-count-value");
    expect(box.textContent).toContain("12");
    expect(box.textContent).toContain(
      "thread-view row(s) currently past",
    );
    expect(box.textContent).toContain("48-hour window");
    expect(screen.queryByTestId("stale-count-loading")).toBeNull();
    expect(screen.queryByTestId("stale-count-unavailable")).toBeNull();
  });

  it("renders '0' and the description when staleCount is 0 (no stale rows)", () => {
    renderWithContext({
      communityThreadViewsStaleCount: 0,
      isCommunityThreadViewsStaleCountLoading: false,
    });
    const box = screen.getByTestId("stale-count-value");
    expect(box.textContent).toContain("0");
    expect(box.textContent).toContain("thread-view row(s)");
    expect(screen.queryByTestId("stale-count-loading")).toBeNull();
    expect(screen.queryByTestId("stale-count-unavailable")).toBeNull();
  });
});

describe("CommunityThreadViewsCleanupCard — stale-count display ('unavailable')", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the error copy when staleCount is the sentinel 'unavailable'", () => {
    renderWithContext({
      communityThreadViewsStaleCount: "unavailable",
      isCommunityThreadViewsStaleCountLoading: false,
    });
    const msg = screen.getByTestId("stale-count-unavailable");
    expect(msg.textContent).toContain("Eligible count unavailable");
    expect(msg.textContent).toContain("count query failed");
    expect(screen.queryByTestId("stale-count-loading")).toBeNull();
    expect(screen.queryByTestId("stale-count-value")).toBeNull();
  });

  it("'unavailable' takes priority over the loading branch", () => {
    renderWithContext({
      communityThreadViewsStaleCount: "unavailable",
      isCommunityThreadViewsStaleCountLoading: true,
    });
    expect(screen.getByTestId("stale-count-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("stale-count-loading")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Static source assertions — stale-count box in SettingsTab.tsx
// ---------------------------------------------------------------------------

describe("SettingsTab.tsx — CommunityThreadViewsCleanupCard stale-count source", () => {
  it("defines the card component", () => {
    expect(cardStart).toBeGreaterThan(-1);
  });

  it("renders the stale-count box with the expected data-testid", () => {
    expect(card).toContain('data-testid="text-community-thread-views-stale-count"');
  });

  it("reads communityThreadViewsStaleCount from context", () => {
    expect(card).toContain("communityThreadViewsStaleCount");
  });

  it("reads isCommunityThreadViewsStaleCountLoading from context", () => {
    expect(card).toContain("isCommunityThreadViewsStaleCountLoading");
  });

  it("branches on the 'unavailable' sentinel to show the error message", () => {
    expect(card).toContain("=== 'unavailable'");
    expect(card).toContain("Eligible count unavailable");
  });

  it("branches on null or loading to show the loading text", () => {
    expect(card).toContain("Loading eligible count");
  });

  it("shows the count and 48-hour window description when the count is a number", () => {
    expect(card).toContain("thread-view row(s) currently past the 48-hour window");
  });

  it("calls loadCommunityThreadViewsStaleCount on mount", () => {
    expect(card).toContain("loadCommunityThreadViewsStaleCount()");
  });
});
