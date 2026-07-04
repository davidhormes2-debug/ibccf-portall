// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ExpandableFailureList } from "../components/portal/ExpandableFailureList";

// ---------------------------------------------------------------------------
// ExpandableFailureList — expandable "…and N more" upload-failure component
//
// WHY THIS TEST EXISTS
// The "…and N more" expand toggle in upload-failure toasts had no automated
// coverage. These tests guard against regressions where:
//   – the expand button disappears
//   – hidden entries are accidentally rendered before expansion
//   – clicking the button fails to reveal all entries
//   – expanded state resets when the parent toast re-renders (e.g. UPDATE_TOAST)
//
// RE-RENDER STABILITY NOTE
// ExpandableFailureList lives in its own module so its function reference is
// stable across calls. React reconciles (same type → same DOM node, state
// preserved) instead of unmounting/remounting when the Toaster re-renders the
// description after an UPDATE_TOAST dispatch.  The test below confirms this.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

function makeFailures(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `file${i + 1}.pdf`,
    error: `error ${i + 1}`,
  }));
}

function normalizeText(s: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

describe("ExpandableFailureList", () => {
  it("renders all entries when there are 3 or fewer (no expand button)", () => {
    const failures = makeFailures(3);
    render(<ExpandableFailureList failures={failures} />);

    for (const f of failures) {
      expect(screen.getByText(`${f.name}: ${f.error}`)).toBeTruthy();
    }
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows only the first 3 entries and hides the rest behind the expand button", () => {
    const failures = makeFailures(5);
    render(<ExpandableFailureList failures={failures} />);

    expect(screen.getByText("file1.pdf: error 1")).toBeTruthy();
    expect(screen.getByText("file2.pdf: error 2")).toBeTruthy();
    expect(screen.getByText("file3.pdf: error 3")).toBeTruthy();

    expect(screen.queryByText("file4.pdf: error 4")).toBeNull();
    expect(screen.queryByText("file5.pdf: error 5")).toBeNull();

    const btn = screen.getByRole("button");
    expect(normalizeText(btn.textContent)).toBe("…and 2 more");
  });

  it("reveals all hidden entries after clicking the expand button", () => {
    const failures = makeFailures(5);
    render(<ExpandableFailureList failures={failures} />);

    fireEvent.click(screen.getByRole("button"));

    for (const f of failures) {
      expect(screen.getByText(`${f.name}: ${f.error}`)).toBeTruthy();
    }
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("works correctly with exactly 4 failures (1 hidden)", () => {
    const failures = makeFailures(4);
    render(<ExpandableFailureList failures={failures} />);

    expect(screen.queryByText("file4.pdf: error 4")).toBeNull();
    const btn = screen.getByRole("button");
    expect(normalizeText(btn.textContent)).toBe("…and 1 more");

    fireEvent.click(btn);

    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing extra when given an empty failure list", () => {
    render(<ExpandableFailureList failures={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("resets to collapsed when re-mounted with a fresh failures list (simulates ADD_TOAST / TOAST_LIMIT=1 replacement)", () => {
    // First toast: render, expand, confirm all visible
    const firstFailures = makeFailures(5);
    const { unmount } = render(<ExpandableFailureList failures={firstFailures} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    // TOAST_LIMIT=1 evicts the old toast and mounts a brand-new component
    unmount();

    // Second toast: fresh failures list — button must start collapsed
    const secondFailures = Array.from({ length: 5 }, (_, i) => ({
      name: `batch${i + 1}.png`,
      error: `fail ${i + 1}`,
    }));
    render(<ExpandableFailureList failures={secondFailures} />);

    const btn = screen.getByRole("button");
    expect(normalizeText(btn.textContent)).toBe("…and 2 more");
    expect(screen.queryByText("batch4.png: fail 4")).toBeNull();
    expect(screen.queryByText("batch5.png: fail 5")).toBeNull();
  });

  it("resets to collapsed when two ADD_TOAST calls fire in the same event-loop tick (rapid back-to-back / debounce scenario)", () => {
    // Simulate the debounce scenario: the second ADD_TOAST fires before the first
    // toast has visually rendered.  With TOAST_LIMIT=1 the reducer immediately
    // evicts the first entry, so the Toaster unmounts the old component and mounts
    // a brand-new one — all synchronously, within the same event-loop tick.
    //
    // Both unmount+remount steps happen without any async gap so this exercises
    // exactly the "rapid back-to-back" path described in the task.

    // --- first "toast" ---
    const first = makeFailures(5);
    const { unmount: unmount1 } = render(<ExpandableFailureList failures={first} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    // Second ADD_TOAST fires synchronously (same tick) — evicts the first
    unmount1();

    // --- second "toast" (rapid, no async gap) ---
    const second = Array.from({ length: 5 }, (_, i) => ({
      name: `rapid${i + 1}.jpg`,
      error: `err ${i + 1}`,
    }));
    const { unmount: unmount2 } = render(<ExpandableFailureList failures={second} />);

    // Must start collapsed, not inherit the expanded state from the first mount
    const btn2 = screen.getByRole("button");
    expect(normalizeText(btn2.textContent)).toBe("…and 2 more");
    expect(screen.queryByText("rapid4.jpg: err 4")).toBeNull();
    expect(screen.queryByText("rapid5.jpg: err 5")).toBeNull();

    // Expand works normally on the second mount too
    fireEvent.click(btn2);
    expect(screen.getByText("rapid4.jpg: err 4")).toBeTruthy();
    expect(screen.getByText("rapid5.jpg: err 5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    // Third rapid ADD_TOAST (second eviction) — again synchronously
    unmount2();

    const third = Array.from({ length: 5 }, (_, i) => ({
      name: `wave${i + 1}.png`,
      error: `fault ${i + 1}`,
    }));
    render(<ExpandableFailureList failures={third} />);

    const btn3 = screen.getByRole("button");
    expect(normalizeText(btn3.textContent)).toBe("…and 2 more");
    expect(screen.queryByText("wave4.png: fault 4")).toBeNull();
    expect(screen.queryByText("wave5.png: fault 5")).toBeNull();
  });

  it("resets to collapsed when ADD_TOAST eviction interrupts an in-progress UPDATE_TOAST batch", () => {
    // Scenario: a first upload batch is still accumulating failures via UPDATE_TOAST
    // (the component has already been expanded by the user) when a second upload batch
    // starts and its ADD_TOAST evicts the first toast (TOAST_LIMIT=1 replacement).
    // The brand-new component for the second batch must start fully collapsed even
    // though the first component was in an expanded, mid-update state.

    // --- First batch: render with initial failures, user expands the list ---
    const firstInitial = makeFailures(5);
    const { rerender, unmount } = render(
      <ExpandableFailureList failures={firstInitial} />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.getByText("file5.pdf: error 5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    // --- UPDATE_TOAST mid-flight: more failures arrive while list is still expanded ---
    const firstUpdated = [
      ...firstInitial,
      { name: "file6.pdf", error: "error 6" },
      { name: "file7.pdf", error: "error 7" },
    ];
    rerender(<ExpandableFailureList failures={firstUpdated} />);

    // Still expanded after the UPDATE_TOAST rerender
    expect(screen.getByText("file6.pdf: error 6")).toBeTruthy();
    expect(screen.getByText("file7.pdf: error 7")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    // --- ADD_TOAST eviction: second batch starts, TOAST_LIMIT=1 unmounts first component ---
    unmount();

    // --- Second batch: fresh component — must start collapsed, not inherit expanded state ---
    const secondFailures = Array.from({ length: 5 }, (_, i) => ({
      name: `batch2-${i + 1}.png`,
      error: `fail ${i + 1}`,
    }));
    render(<ExpandableFailureList failures={secondFailures} />);

    const btn = screen.getByRole("button");
    expect(normalizeText(btn.textContent)).toBe("…and 2 more");
    expect(screen.queryByText("batch2-4.png: fail 4")).toBeNull();
    expect(screen.queryByText("batch2-5.png: fail 5")).toBeNull();
  });

  it("preserves expanded state when the component re-renders (simulates toast UPDATE_TOAST)", () => {
    const failures = makeFailures(5);
    const { rerender } = render(<ExpandableFailureList failures={failures} />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.getByText("file5.pdf: error 5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<ExpandableFailureList failures={failures} />);

    expect(screen.getByText("file4.pdf: error 4")).toBeTruthy();
    expect(screen.getByText("file5.pdf: error 5")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
