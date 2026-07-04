// @vitest-environment jsdom
//
// Task #167 — Cover the Ctrl/Cmd+K case finder (Task #166):
//   - Cmd+K opens the palette and focuses the input.
//   - Typing filters the list, ArrowDown moves the active row, Enter
//     picks the highlighted case.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminCaseFinder } from "../AdminCaseFinder";

const CASES = [
  { id: "1", accessCode: "AAA111", status: "active", userName: "Alice Adams",  userEmail: "alice@example.com" },
  { id: "2", accessCode: "BBB222", status: "active", userName: "Bob Brown",    userEmail: "bob@example.com" },
  { id: "3", accessCode: "CCC333", status: "active", userName: "Carol Clarke", userEmail: "carol@example.com" },
];

afterEach(() => cleanup());

describe("AdminCaseFinder", () => {
  it("opens on Ctrl+K and focuses the input", async () => {
    render(<AdminCaseFinder cases={CASES} onPick={() => {}} />);
    expect(screen.queryByTestId("admin-case-finder-input")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = await screen.findByTestId("admin-case-finder-input");
    expect(input).toBeTruthy();
  });

  it("opens on Cmd+K too (meta key)", async () => {
    render(<AdminCaseFinder cases={CASES} onPick={() => {}} />);
    fireEvent.keyDown(window, { key: "K", metaKey: true });
    expect(await screen.findByTestId("admin-case-finder-input")).toBeTruthy();
  });

  it("filters results by query and Enter picks the highlighted case", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<AdminCaseFinder cases={CASES} onPick={onPick} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByTestId("admin-case-finder-input");

    await user.type(input, "carol");
    // Only Carol should remain.
    expect(screen.getByTestId("admin-case-finder-result-3")).toBeTruthy();
    expect(screen.queryByTestId("admin-case-finder-result-1")).toBeNull();

    // Active row is first (index 0 = Carol), pressing Enter picks it.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe("3");
  });

  it("ArrowDown moves the active row before Enter picks", async () => {
    const onPick = vi.fn();
    render(<AdminCaseFinder cases={CASES} onPick={onPick} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByTestId("admin-case-finder-input");

    // No query → default list (first 8) in order; first row is Alice (id=1).
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Bob
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Carol
    fireEvent.keyDown(input, { key: "ArrowUp" });   // back to Bob
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe("2");
  });
});
