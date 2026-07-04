// @vitest-environment jsdom
//
// Regression tests for WithdrawalGuidePage — debounced error state and
// play-overlay aria-label.
//
// Acceptance criteria:
//   1. Firing onError on the <video> element does NOT immediately show the
//      error UI (before the 200 ms debounce fires).
//   2. After advancing fake timers by 200 ms the error UI is visible.
//   3. The click-to-play overlay button always carries aria-label="Play video".

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

// ---------------------------------------------------------------------------
// Module mocks — must all precede any import of WithdrawalGuidePage
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/withdrawal-guide", vi.fn()],
}));

vi.mock("@/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: { code: "en", label: "English" },
    setLocale: vi.fn(),
  }),
}));

vi.mock("@/components/BuildStampLine", () => ({
  BuildStampLine: (props: any) => <span {...props} />,
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button aria-label="Toggle theme" />,
}));

vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

// ---------------------------------------------------------------------------
// Import the component under test — AFTER all vi.mock calls.
// ---------------------------------------------------------------------------
import WithdrawalGuidePage from "../WithdrawalGuidePage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return render(<WithdrawalGuidePage />);
}

const ERROR_TEXT = "Tutorial video is not available at this time.";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe("WithdrawalGuidePage — debounced error state", () => {
  it("does NOT show the error UI synchronously when onError fires on the video", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // Fire the error event — the 200 ms debounce has NOT elapsed yet.
    act(() => {
      fireEvent.error(video!);
    });

    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it("shows the error UI after 200 ms have elapsed", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    act(() => {
      fireEvent.error(video!);
    });

    // Advance timers by exactly 200 ms inside act so React flushes state.
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
  });

  it("does not show error UI after only 199 ms", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    act(() => {
      fireEvent.error(video!);
    });

    act(() => {
      vi.advanceTimersByTime(199);
    });

    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it("cancels the pending error timer when onCanPlay fires before 200 ms", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    act(() => {
      fireEvent.error(video!);
    });

    // Simulate successful load before the debounce fires.
    act(() => {
      fireEvent(video!, new Event("canplay"));
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});

describe("WithdrawalGuidePage — loading skeleton", () => {
  it("shows 'Loading…' text immediately after render before canplay fires", () => {
    renderPage();

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("removes 'Loading…' text after canplay fires on the video element", () => {
    renderPage();

    expect(screen.getByText("Loading…")).toBeTruthy();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    act(() => {
      fireEvent(video!, new Event("canplay"));
    });

    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("hides 'Loading…' when a play event fires before canplay (overlay collapses once playing)", () => {
    renderPage();

    // Initially: not playing, not loaded — Loading… must be visible.
    expect(screen.getByText("Loading…")).toBeTruthy();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // Fire play before canplay — setPlaying(true) collapses the overlay.
    act(() => {
      fireEvent(video!, new Event("play"));
    });

    // The overlay (and therefore "Loading…") must be gone even though
    // canplay has not fired yet.
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("re-shows 'Loading…' when pause fires after play but before canplay", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // play collapses the overlay — "Loading…" disappears.
    act(() => {
      fireEvent(video!, new Event("play"));
    });
    expect(screen.queryByText("Loading…")).toBeNull();

    // pause before canplay — setPlaying(false) restores the overlay;
    // loaded is still false so "Loading…" must re-appear.
    act(() => {
      fireEvent(video!, new Event("pause"));
    });

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("re-shows 'Loading…' when ended fires after play but before canplay", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // play collapses the overlay — "Loading…" disappears.
    act(() => {
      fireEvent(video!, new Event("play"));
    });
    expect(screen.queryByText("Loading…")).toBeNull();

    // ended before canplay — setPlaying(false) restores the overlay;
    // loaded is still false so "Loading…" must re-appear.
    act(() => {
      fireEvent(video!, new Event("ended"));
    });

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("removes 'Loading…' when canplay fires after a play → pause cycle", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // play → pause before canplay — overlay is back and Loading… is visible.
    act(() => {
      fireEvent(video!, new Event("play"));
    });
    act(() => {
      fireEvent(video!, new Event("pause"));
    });
    expect(screen.getByText("Loading…")).toBeTruthy();

    // canplay fires late — loaded becomes true, overlay remains (playing=false)
    // but "Loading…" must disappear.
    act(() => {
      fireEvent(video!, new Event("canplay"));
    });

    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });

  it("removes 'Loading…' when canplay fires after a play → ended cycle", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // play → ended before canplay — overlay is back and Loading… is visible.
    act(() => {
      fireEvent(video!, new Event("play"));
    });
    act(() => {
      fireEvent(video!, new Event("ended"));
    });
    expect(screen.getByText("Loading…")).toBeTruthy();

    // canplay fires late — loaded becomes true, overlay remains (playing=false)
    // but "Loading…" must disappear.
    act(() => {
      fireEvent(video!, new Event("canplay"));
    });

    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });
});

describe("WithdrawalGuidePage — play overlay aria-label", () => {
  it("has aria-label='Play video' on the overlay button in the initial state", () => {
    renderPage();

    const playButton = screen.getByRole("button", { name: "Play video" });
    expect(playButton).toBeTruthy();
    expect(playButton.getAttribute("aria-label")).toBe("Play video");
  });

  it("still has aria-label='Play video' after the error UI appears (overlay hidden, no regression)", () => {
    renderPage();

    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // Confirm the overlay button exists before the error.
    const playButton = screen.getByRole("button", { name: "Play video" });
    expect(playButton.getAttribute("aria-label")).toBe("Play video");

    act(() => {
      fireEvent.error(video!);
      vi.advanceTimersByTime(200);
    });

    // After error the overlay is replaced by the error panel; query should
    // return null (no stale aria-label "Play" button lingering in the DOM).
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
  });
});
