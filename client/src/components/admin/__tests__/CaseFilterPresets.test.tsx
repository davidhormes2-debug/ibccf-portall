// @vitest-environment jsdom
//
// Task #175 — Cover the saved filter presets row added in Task #166:
//   - Clicking a built-in preset applies its state.
//   - Saving a custom preset persists it to localStorage.
//   - The last-used preset is restored on remount.
//
// Extended: pin/star and drag-to-reorder behaviour.

import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CaseFilterPresets,
  MAX_PINS,
  type FilterPresetState,
} from "../CaseFilterPresets";
import { TooltipProvider } from "@/components/ui/tooltip";

const INITIAL: FilterPresetState = {
  searchQuery: "",
  statusFilter: "all",
  localeFilter: "all",
  sealedFilter: "all",
  stampDutyPendingOnly: false,
  reactivationPendingOnly: false,
  refundClaimStatusFilter: "all",
  legacyAccessCodeOnly: false,
};

function Harness({
  initial = INITIAL,
  onChange,
}: {
  initial?: FilterPresetState;
  onChange?: (s: FilterPresetState) => void;
}) {
  const [state, setState] = useState<FilterPresetState>(initial);
  return (
    <TooltipProvider>
      <CaseFilterPresets
        current={state}
        apply={(s) => {
          setState(s);
          onChange?.(s);
        }}
      />
      <div data-testid="state">{JSON.stringify(state)}</div>
    </TooltipProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CaseFilterPresets", () => {
  it("applies a built-in preset's state when clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("preset-sealed"));
    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.sealedFilter).toBe("sealed");

    await user.click(screen.getByTestId("preset-stamp-duty-pending"));
    const parsed2 = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed2.stampDutyPendingOnly).toBe(true);
    expect(parsed2.sealedFilter).toBe("all");
  });

  it("applies the reactivation-pending preset and resets when All is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("preset-reactivation-pending"));
    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.reactivationPendingOnly).toBe(true);
    expect(parsed.searchQuery).toBe("");
    expect(parsed.statusFilter).toBe("all");
    expect(parsed.stampDutyPendingOnly).toBe(false);
    expect(parsed.refundClaimStatusFilter).toBe("all");

    await user.click(screen.getByTestId("preset-all"));
    const parsed2 = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed2.reactivationPendingOnly).toBe(false);
  });

  it("applies the submitted-claims preset and resets refundClaimStatusFilter to 'all' when All is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("preset-submitted-claims"));
    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.refundClaimStatusFilter).toBe("submitted");
    expect(parsed.sealedFilter).toBe("all");
    expect(parsed.stampDutyPendingOnly).toBe(false);

    await user.click(screen.getByTestId("preset-all"));
    const parsed2 = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed2.refundClaimStatusFilter).toBe("all");
  });

  it("saves a custom preset to localStorage", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...INITIAL,
          searchQuery: "alice",
          statusFilter: "active",
        }}
      />,
    );

    await user.click(screen.getByTestId("preset-save"));
    await user.type(screen.getByPlaceholderText("Preset name"), "My filter");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const raw = localStorage.getItem("ibccf.admin.casesFilterPresets");
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("My filter");
    expect(stored[0].state.searchQuery).toBe("alice");
    expect(stored[0].state.statusFilter).toBe("active");

    // It's now visible as a chip.
    expect(screen.getByText("My filter")).toBeTruthy();
  });

  it("restores the last-used preset on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(screen.getByTestId("preset-sealed"));
    expect(localStorage.getItem("ibccf.admin.casesFilterPresets.lastUsed")).toBe(
      "sealed",
    );

    unmount();
    cleanup();

    // Mount fresh; the harness starts at default state, but the preset
    // component should re-apply "sealed" on first mount.
    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });
    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.sealedFilter).toBe("sealed");
  });

  it("applies pending-claims, approved-claims, and rejected-claims presets", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("preset-pending-claims"));
    const pending = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(pending.refundClaimStatusFilter).toBe("pending_submission");
    expect(pending.statusFilter).toBe("all");
    expect(pending.stampDutyPendingOnly).toBe(false);

    await user.click(screen.getByTestId("preset-approved-claims"));
    const approved = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(approved.refundClaimStatusFilter).toBe("approved");

    await user.click(screen.getByTestId("preset-rejected-claims"));
    const rejected = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(rejected.refundClaimStatusFilter).toBe("rejected");

    await user.click(screen.getByTestId("preset-all"));
    const all = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(all.refundClaimStatusFilter).toBe("all");
  });

  it("normalizes a legacy custom preset missing refundClaimStatusFilter on apply", async () => {
    const legacyPreset = [
      {
        id: "c-legacy",
        name: "Legacy filter",
        state: { searchQuery: "alice", statusFilter: "active", localeFilter: "all", sealedFilter: "all", stampDutyPendingOnly: false },
      },
    ];
    localStorage.setItem("ibccf.admin.casesFilterPresets", JSON.stringify(legacyPreset));
    localStorage.setItem("ibccf.admin.casesFilterPresets.lastUsed", "c-legacy");

    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });

    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.refundClaimStatusFilter).toBe("all");
    expect(parsed.searchQuery).toBe("alice");
  });

  it("normalizes a legacy last-used built-in preset missing refundClaimStatusFilter on restore", async () => {
    localStorage.setItem("ibccf.admin.casesFilterPresets.lastUsed", "sealed");

    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });

    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.refundClaimStatusFilter).toBe("all");
    expect(parsed.sealedFilter).toBe("sealed");
  });

  it("restores a previously-saved custom preset on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Harness
        initial={{
          ...INITIAL,
          searchQuery: "bob",
        }}
      />,
    );

    await user.click(screen.getByTestId("preset-save"));
    await user.type(screen.getByPlaceholderText("Preset name"), "Bob view");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const stored = JSON.parse(
      localStorage.getItem("ibccf.admin.casesFilterPresets") as string,
    );
    const customId = stored[0].id;
    expect(localStorage.getItem("ibccf.admin.casesFilterPresets.lastUsed")).toBe(
      customId,
    );

    unmount();
    cleanup();

    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });
    const parsed = JSON.parse(screen.getByTestId("state").textContent || "{}");
    expect(parsed.searchQuery).toBe("bob");
  });

  // ── Pin / star ──────────────────────────────────────────────────────────────

  it("clicking the star icon pins a preset and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const starBtn = screen.getByRole("button", { name: "Pin preset Sealed" });
    await user.click(starBtn);

    const raw = localStorage.getItem("ibccf.admin.casesFilterPresets.pinned");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved).toContain("sealed");
  });

  it("clicking the star icon again unpins the preset and removes it from localStorage", async () => {
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["sealed"]),
    );

    const user = userEvent.setup();
    render(<Harness />);

    await act(async () => { await Promise.resolve(); });

    // Star label should now say "Unpin"
    const starBtn = screen.getByRole("button", { name: "Unpin preset Sealed" });
    await user.click(starBtn);

    const saved = JSON.parse(
      localStorage.getItem("ibccf.admin.casesFilterPresets.pinned") || "[]",
    );
    expect(saved).not.toContain("sealed");
  });

  it("pinned presets appear before unpinned ones in the bar", async () => {
    // Pin "sealed" which is normally at position 5 (after all, awaiting, reissue, stamp-duty).
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["sealed"]),
    );

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid"));

    // "preset-sealed" must appear before "preset-all"
    expect(ids.indexOf("preset-sealed")).toBeLessThan(ids.indexOf("preset-all"));
  });

  it("two pinned presets both appear before every unpinned chip", async () => {
    // Pin "sealed" (normally position 5) and "stamp-duty-pending" (normally position 4).
    // Both should float to the very front; every remaining chip must follow them.
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["sealed", "stamp-duty-pending"]),
    );

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid") as string);

    const pinnedIds = new Set(["preset-sealed", "preset-stamp-duty-pending"]);
    const pinnedPositions = ids
      .map((id, i) => (pinnedIds.has(id) ? i : -1))
      .filter((i) => i !== -1);
    const unpinnedPositions = ids
      .map((id, i) => (!pinnedIds.has(id) ? i : -1))
      .filter((i) => i !== -1);

    // Every pinned chip index must be strictly less than every unpinned chip index.
    expect(pinnedPositions).toHaveLength(2);
    expect(unpinnedPositions.length).toBeGreaterThan(0);
    const lastPinnedPos = Math.max(...pinnedPositions);
    const firstUnpinnedPos = Math.min(...unpinnedPositions);
    expect(lastPinnedPos).toBeLessThan(firstUnpinnedPos);
  });

  it("pinned presets float to the front even when a saved drag order exists", async () => {
    // Simulate a user who dragged presets into a custom order (no pins at the time),
    // then later pinned two of them. The pin priority must override the drag order.
    const customOrder = [
      "submitted-claims",
      "sealed",
      "all",
      "stamp-duty-pending",
      "awaiting-my-action",
      "reissue-pending",
      "pending-claims",
      "approved-claims",
      "rejected-claims",
    ];
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.order",
      JSON.stringify(customOrder),
    );
    // Now pin "all" (sits at index 2 in the drag order) and "awaiting-my-action"
    // (index 4). Both must jump to the front regardless of drag-order position.
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["all", "awaiting-my-action"]),
    );

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid") as string);

    const pinnedIds = new Set(["preset-all", "preset-awaiting-my-action"]);
    const pinnedPositions = ids
      .map((id, i) => (pinnedIds.has(id) ? i : -1))
      .filter((i) => i !== -1);
    const unpinnedPositions = ids
      .map((id, i) => (!pinnedIds.has(id) ? i : -1))
      .filter((i) => i !== -1);

    expect(pinnedPositions).toHaveLength(2);
    expect(unpinnedPositions.length).toBeGreaterThan(0);
    const lastPinnedPos = Math.max(...pinnedPositions);
    const firstUnpinnedPos = Math.min(...unpinnedPositions);
    expect(lastPinnedPos).toBeLessThan(firstUnpinnedPos);
  });

  it("a pinned custom preset appears before all unpinned built-in chips", async () => {
    // Pre-seed one saved custom preset and pin it.
    const customId = "c-custom-1";
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets",
      JSON.stringify([
        { id: customId, name: "Pinned custom", state: { ...INITIAL, searchQuery: "custom" } },
      ]),
    );
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify([customId]),
    );

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid") as string);

    const pinnedTestId = `preset-${customId}`;
    const pinnedPos = ids.indexOf(pinnedTestId);
    expect(pinnedPos).toBeGreaterThanOrEqual(0); // chip is rendered

    const unpinnedPositions = ids
      .map((id, i) => (id !== pinnedTestId ? i : -1))
      .filter((i) => i !== -1);

    expect(unpinnedPositions.length).toBeGreaterThan(0);
    const firstUnpinnedPos = Math.min(...unpinnedPositions);
    expect(pinnedPos).toBeLessThan(firstUnpinnedPos);
  });

  it("enforces the MAX_PINS limit (3): a 4th pin attempt is ignored", async () => {
    // Pre-pin 3 presets
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["all", "awaiting-my-action", "sealed"]),
    );

    const user = userEvent.setup();
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    // Verify sealed is already pinned (star label says "Unpin")
    expect(
      screen.getByRole("button", { name: "Unpin preset Sealed" }),
    ).toBeTruthy();

    // Try to pin a 4th preset (stamp-duty-pending is not yet pinned)
    const stampStar = screen.getByRole("button", { name: "Pin preset Stamp-duty pending" });
    await user.click(stampStar);

    const saved = JSON.parse(
      localStorage.getItem("ibccf.admin.casesFilterPresets.pinned") || "[]",
    );
    // Still only 3 pins; stamp-duty-pending was NOT added
    expect(saved).toHaveLength(3);
    expect(saved).not.toContain("stamp-duty-pending");
  });

  it("pinned state is restored on remount", async () => {
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["sealed"]),
    );

    const { unmount } = render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    unmount();
    cleanup();

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    // After remount "sealed" is still pinned → its star says "Unpin"
    expect(
      screen.getByRole("button", { name: "Unpin preset Sealed" }),
    ).toBeTruthy();
  });

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────

  it("drag-to-reorder persists the new order to localStorage", () => {
    render(<Harness />);

    const sealed = screen.getByTestId("preset-sealed");
    const allBtn = screen.getByTestId("preset-all");

    // Simulate a full drag cycle: start on "sealed", drag over "all", drop on "all".
    fireEvent.dragStart(sealed, { dataTransfer: { effectAllowed: "move" } });
    fireEvent.dragOver(allBtn, { dataTransfer: { dropEffect: "move" } });
    fireEvent.drop(allBtn, {});
    fireEvent.dragEnd(sealed);

    const raw = localStorage.getItem("ibccf.admin.casesFilterPresets.order");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    // "sealed" must now appear before "all" in the saved order
    expect(saved.indexOf("sealed")).toBeLessThan(saved.indexOf("all"));
  });

  it("dragging a preset to itself does not change the order", () => {
    render(<Harness />);

    const allBtn = screen.getByTestId("preset-all");

    fireEvent.dragStart(allBtn, { dataTransfer: { effectAllowed: "move" } });
    fireEvent.dragOver(allBtn, { dataTransfer: { dropEffect: "move" } });
    fireEvent.drop(allBtn, {});
    fireEvent.dragEnd(allBtn);

    // No order key should be written (no change happened)
    expect(localStorage.getItem("ibccf.admin.casesFilterPresets.order")).toBeNull();
  });

  it("saved order is restored on remount and chips render in that order", async () => {
    // Save an order that puts "sealed" first
    const defaultIds = [
      "all",
      "awaiting-my-action",
      "reissue-pending",
      "stamp-duty-pending",
      "sealed",
      "submitted-claims",
      "pending-claims",
      "approved-claims",
      "rejected-claims",
    ];
    const reordered = ["sealed", ...defaultIds.filter((id) => id !== "sealed")];
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.order",
      JSON.stringify(reordered),
    );

    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid"));

    expect(ids[0]).toBe("preset-sealed");
  });

  // ── Reset layout ─────────────────────────────────────────────────────────────

  it("reset button clears order and pinned from localStorage and re-renders in default order", async () => {
    // Start with a custom order and a pin already set
    const defaultIds = [
      "all",
      "awaiting-my-action",
      "reissue-pending",
      "stamp-duty-pending",
      "sealed",
      "submitted-claims",
      "pending-claims",
      "approved-claims",
      "rejected-claims",
    ];
    const reordered = ["sealed", ...defaultIds.filter((id) => id !== "sealed")];
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.order",
      JSON.stringify(reordered),
    );
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify(["sealed"]),
    );

    const user = userEvent.setup();
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    // Reset button should be visible because there's a custom order + pin
    const resetBtn = screen.getByTestId("preset-reset-layout");
    expect(resetBtn).toBeTruthy();

    await user.click(resetBtn);

    // localStorage keys should be cleared
    expect(localStorage.getItem("ibccf.admin.casesFilterPresets.order")).toBeNull();
    expect(localStorage.getItem("ibccf.admin.casesFilterPresets.pinned")).toBeNull();

    // Reset button should be gone (no order/pins active)
    expect(screen.queryByTestId("preset-reset-layout")).toBeNull();

    // Chips should now be back in default order — "preset-all" first
    const container = screen.getByTestId("case-filter-presets");
    const chips = container.querySelectorAll("[data-testid^='preset-']");
    const ids = Array.from(chips).map((el) => el.getAttribute("data-testid"));
    expect(ids[0]).toBe("preset-all");
  });

  it("reset button is hidden when there is no custom order or pin", async () => {
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId("preset-reset-layout")).toBeNull();
  });

  // ── Parametric pin-ordering invariant ────────────────────────────────────────
  //
  // Verify that the full-partition invariant holds regardless of how many presets
  // are pinned: all pinned chips must appear before every unpinned chip.
  // The test cases use N = 1, 2, and MAX_PINS so that any future bump to
  // MAX_PINS is automatically covered without updating these tests.
  //
  // We deliberately pin presets that sit at the *end* of the default order so
  // the invariant is non-trivial (they must float to the front).
  {
    const ALL_BUILT_IN_IDS = [
      "all",
      "awaiting-my-action",
      "reissue-pending",
      "stamp-duty-pending",
      "reactivation-pending",
      "sealed",
      "submitted-claims",
      "pending-claims",
      "approved-claims",
      "rejected-claims",
    ];

    const pinCounts = Array.from(new Set([1, 2, MAX_PINS]));

    it.each(pinCounts)(
      "pin-ordering invariant holds for %i pinned preset(s)",
      async (n) => {
        // Pick the last N built-in presets as the pinned set — they are
        // naturally at the end, so pinning them is a meaningful ordering test.
        const pinnedIds = ALL_BUILT_IN_IDS.slice(-n);
        localStorage.setItem(
          "ibccf.admin.casesFilterPresets.pinned",
          JSON.stringify(pinnedIds),
        );

        render(<Harness />);
        await act(async () => { await Promise.resolve(); });

        const container = screen.getByTestId("case-filter-presets");
        const chips = container.querySelectorAll("[data-testid^='preset-']");
        const ids = Array.from(chips).map(
          (el) => el.getAttribute("data-testid") as string,
        );

        const pinnedTestIds = new Set(pinnedIds.map((id) => `preset-${id}`));
        const pinnedPositions = ids
          .map((id, i) => (pinnedTestIds.has(id) ? i : -1))
          .filter((i) => i !== -1);
        const unpinnedPositions = ids
          .map((id, i) => (!pinnedTestIds.has(id) ? i : -1))
          .filter((i) => i !== -1);

        // All N pinned chips must be present.
        expect(pinnedPositions).toHaveLength(n);
        // There must be at least one unpinned chip.
        expect(unpinnedPositions.length).toBeGreaterThan(0);
        // The last pinned index must be strictly less than the first unpinned index.
        const lastPinnedPos = Math.max(...pinnedPositions);
        const firstUnpinnedPos = Math.min(...unpinnedPositions);
        expect(lastPinnedPos).toBeLessThan(firstUnpinnedPos);

        cleanup();
        localStorage.clear();
      },
    );
  }

  it("deleting a custom preset also removes it from the pinned list", async () => {
    // Set up a custom preset that is pinned
    const customId = "c-12345";
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets",
      JSON.stringify([{ id: customId, name: "My view", state: INITIAL }]),
    );
    localStorage.setItem(
      "ibccf.admin.casesFilterPresets.pinned",
      JSON.stringify([customId]),
    );

    const user = userEvent.setup();
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });

    // Delete the custom preset via its trash icon
    const trashBtn = screen.getByRole("button", { name: "Delete preset My view" });
    await user.click(trashBtn);

    const savedPinned = JSON.parse(
      localStorage.getItem("ibccf.admin.casesFilterPresets.pinned") || "[]",
    );
    expect(savedPinned).not.toContain(customId);
  });
});
