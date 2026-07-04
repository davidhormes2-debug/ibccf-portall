// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { CaseFilterPresets } from "../components/admin/CaseFilterPresets";

// ---------------------------------------------------------------------------
// CaseFilterPresets — pin-limit tooltip regression guard
//
// WHY THIS TEST EXISTS
// The "3 pins maximum — unpin one first" tooltip and the `aria-disabled` flag
// on the pin star had no automated coverage. A refactor could silently remove
// the tooltip, drop the conditional `TooltipContent`, or stop setting
// `aria-disabled` — with nothing to catch the regression.
//
// TOOLTIP MOCK RATIONALE
// Radix Tooltip's Presence/Portal layer uses a useEffect-driven state machine
// to mount portal content only when open. In jsdom there is no real paint
// cycle, so the portal never reaches document.body regardless of which pointer
// or focus events are fired. We replace the four Radix primitives with a
// thin, stateful mock that mirrors the behaviorally-relevant contract:
//   • TooltipContent renders only while the tooltip is open.
//   • The tooltip opens when its trigger receives focus or mouseEnter.
//   • The tooltip closes on blur / mouseLeave.
// This lets the tests perform a real focus event on the star trigger, assert
// that the tooltip text appears after the interaction, and assert that it
// disappears again on blur — exactly the regression surface the task targets.
// ---------------------------------------------------------------------------

import { vi } from "vitest";
import React from "react";

vi.mock("../components/ui/tooltip", () => {
  const React = require("react") as typeof import("react");

  const OpenCtx = React.createContext<boolean>(false);
  const SetOpenCtx = React.createContext<(v: boolean) => void>(() => {});

  function TooltipProvider({ children }: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, children);
  }

  function Tooltip({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = React.useState(false);
    return React.createElement(
      SetOpenCtx.Provider,
      { value: setOpen },
      React.createElement(OpenCtx.Provider, { value: open }, children),
    );
  }

  // Clones its single child and attaches focus/blur/mouse handlers that
  // open and close the tooltip, reproducing the Radix trigger contract.
  function TooltipTrigger({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) {
    const setOpen = React.useContext(SetOpenCtx);
    const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>;
    return React.cloneElement(child, {
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
    });
  }

  // Renders its children only while the tooltip is open.
  function TooltipContent({ children }: { children: React.ReactNode }) {
    const open = React.useContext(OpenCtx);
    return open
      ? React.createElement("div", { role: "tooltip" }, children)
      : null;
  }

  return { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
});

const PINNED_KEY = "ibccf.admin.casesFilterPresets.pinned";

const DEFAULT_STATE = {
  searchQuery: "",
  statusFilter: "all",
  localeFilter: "all",
  sealedFilter: "all",
  stampDutyPendingOnly: false as const,
  refundClaimStatusFilter: "all",
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CaseFilterPresets – pin-limit tooltip", () => {
  it("unpinned star carries aria-disabled='true' when all 3 pin slots are full", () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // "Reissue pending" is not in the pinned set — its star must be disabled.
    const star = screen.getByLabelText("Pin preset Reissue pending");
    expect(star.getAttribute("aria-disabled")).toBe("true");
  });

  it("focusing the pin-limit star reveals '3 pins maximum — unpin one first' tooltip", async () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // No tooltip is visible before any interaction.
    expect(screen.queryByRole("tooltip")).toBeNull();

    // The TooltipTrigger mock clones the inner <span> (asChild child) and
    // attaches onFocus/onBlur to it, so focusing that span opens the tooltip.
    const star = screen.getByLabelText("Pin preset Reissue pending");
    expect(star.getAttribute("aria-disabled")).toBe("true");

    const triggerSpan = star.closest("span") as HTMLElement;

    await act(async () => {
      fireEvent.focus(triggerSpan);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("3 pins maximum — unpin one first");
  });

  it("tooltip disappears when the star loses focus", async () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    const star = screen.getByLabelText("Pin preset Reissue pending");
    const triggerSpan = star.closest("span") as HTMLElement;

    await act(async () => {
      fireEvent.focus(triggerSpan);
    });

    expect(screen.getByRole("tooltip")).toBeTruthy();

    await act(async () => {
      fireEvent.blur(triggerSpan);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("no tooltip appears when the pin limit is not reached (fewer than 3 pins)", async () => {
    localStorage.setItem(PINNED_KEY, JSON.stringify(["all", "sealed"]));

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // Even after focusing an unpinned star, no tooltip should appear because
    // atPinLimit is false and TooltipContent is not in the React tree at all.
    const star = screen.getByLabelText("Pin preset Reissue pending");
    const triggerSpan = star.closest("span") as HTMLElement;

    await act(async () => {
      fireEvent.focus(triggerSpan);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a pinned preset's star does not carry aria-disabled when slots are full", () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // "all" is pinned — its star is for unpinning, not disabled.
    const star = screen.getByLabelText("Unpin preset All");
    expect(star.getAttribute("aria-disabled")).toBeNull();
  });

  it("clicking Undo reset restores aria-disabled on unpinned stars and rewires the pin-limit tooltip", async () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // Confirm we start with slots full — unpinned star is disabled.
    const starBefore = screen.getByLabelText("Pin preset Reissue pending");
    expect(starBefore.getAttribute("aria-disabled")).toBe("true");

    // Click Reset order — clears all pins.
    const resetBtn = screen.getByTestId("preset-reset-layout");
    await act(async () => {
      fireEvent.click(resetBtn);
    });

    // After reset: aria-disabled must be gone on every star.
    const starAfterReset = screen.getByLabelText("Pin preset Reissue pending");
    expect(starAfterReset.getAttribute("aria-disabled")).toBeNull();

    // Click Undo reset — restores the previous 3-pin state.
    const undoBtn = screen.getByTestId("preset-undo-reset");
    await act(async () => {
      fireEvent.click(undoBtn);
    });

    // After undo: "Reissue pending" is still not in the pinned set, so its
    // star must be aria-disabled again (pin limit is restored).
    const starAfterUndo = screen.getByLabelText("Pin preset Reissue pending");
    expect(starAfterUndo.getAttribute("aria-disabled")).toBe("true");

    // Focusing the disabled star must show the pin-limit tooltip.
    const triggerSpan = starAfterUndo.closest("span") as HTMLElement;
    await act(async () => {
      fireEvent.focus(triggerSpan);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe("3 pins maximum — unpin one first");
  });

  it("undo button disappears after the 5-second window expires without clicking Undo", async () => {
    // The reset layout button is only visible when at least one pin is set.
    localStorage.setItem(PINNED_KEY, JSON.stringify(["all"]));

    vi.useFakeTimers();
    try {
      render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

      const resetBtn = screen.getByTestId("preset-reset-layout");
      await act(async () => {
        fireEvent.click(resetBtn);
      });

      // Undo button must be visible immediately after reset.
      expect(screen.getByTestId("preset-undo-reset")).toBeTruthy();

      // Advance time past the 5-second undo window without clicking Undo.
      await act(async () => {
        vi.advanceTimersByTime(5001);
      });

      // The timer fired setUndoSnapshot(null) — undo button must be gone.
      expect(screen.queryByTestId("preset-undo-reset")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("undo button is still visible at 4999 ms (just before the 5-second window closes)", async () => {
    localStorage.setItem(PINNED_KEY, JSON.stringify(["all"]));

    vi.useFakeTimers();
    try {
      render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

      const resetBtn = screen.getByTestId("preset-reset-layout");
      await act(async () => {
        fireEvent.click(resetBtn);
      });

      // Undo button must be visible immediately after reset.
      expect(screen.getByTestId("preset-undo-reset")).toBeTruthy();

      // Advance to 1 ms before the 5-second window closes — button must still be present.
      await act(async () => {
        vi.advanceTimersByTime(4999);
      });

      expect(screen.getByTestId("preset-undo-reset")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking Reset order removes aria-disabled and clears the pin-limit tooltip", async () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    render(<CaseFilterPresets current={DEFAULT_STATE} apply={() => {}} />);

    // Slots full — unpinned star is disabled and tooltip text is wired up.
    const star = screen.getByLabelText("Pin preset Reissue pending");
    expect(star.getAttribute("aria-disabled")).toBe("true");

    // Focus the disabled star to confirm the limit tooltip is present.
    const triggerSpan = star.closest("span") as HTMLElement;
    await act(async () => {
      fireEvent.focus(triggerSpan);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      "3 pins maximum — unpin one first",
    );
    await act(async () => {
      fireEvent.blur(triggerSpan);
    });

    // Click Reset order — clears all pins.
    const resetBtn = screen.getByTestId("preset-reset-layout");
    await act(async () => {
      fireEvent.click(resetBtn);
    });

    // After reset: aria-disabled must be gone on every star.
    const starAfter = screen.getByLabelText("Pin preset Reissue pending");
    expect(starAfter.getAttribute("aria-disabled")).toBeNull();

    // The pin-limit tooltip text must not appear anywhere in the document.
    expect(
      screen.queryByText("3 pins maximum — unpin one first"),
    ).toBeNull();
  });
});
