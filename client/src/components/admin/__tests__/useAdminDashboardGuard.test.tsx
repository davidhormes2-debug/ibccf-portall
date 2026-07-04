// @vitest-environment jsdom
//
// Task #783 — Protect document review surfaces from missing-context crashes.
//
// Contract under test:
//   useAdminDashboard() must throw when invoked outside an
//   AdminDashboardContext.Provider (so the bug is never silently swallowed),
//   AND in DEV it must first emit a console.warn that NAMES the offending
//   component. This turns "the case-detail dialog silently closed" into an
//   actionable message pointing at the component that should receive its
//   values via props instead of context.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  AdminDashboardContext,
  useAdminDashboard,
  type AdminDashboardContextValue,
} from "../AdminDashboardContext";

// A named component so the stack-trace parser has something to surface.
function OffendingDialogChild() {
  useAdminDashboard();
  return <div>should never render</div>;
}

function ConsumerInsideProvider() {
  const ctx = useAdminDashboard();
  return <div data-testid="token">{String(ctx.authToken)}</div>;
}

describe("useAdminDashboard() out-of-provider guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the thrown error to console.error during render; silence it
    // so the test output stays readable.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    cleanup();
  });

  it("throws when rendered outside the Provider", () => {
    expect(() => render(<OffendingDialogChild />)).toThrow(
      /must be used within an AdminDashboardContext\.Provider/,
    );
  });

  it("warns with the offending component name in DEV", () => {
    // import.meta.env.DEV is true under Vitest's default mode.
    try {
      render(<OffendingDialogChild />);
    } catch {
      // expected — we only care about the warning side-effect here.
    }
    expect(warnSpy).toHaveBeenCalled();
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("useAdminDashboard()");
    expect(message).toContain("OffendingDialogChild");
    expect(message).toContain("via props");
  });

  it("returns the context value when rendered inside the Provider", () => {
    const value = {
      authToken: "tok-123",
    } as unknown as AdminDashboardContextValue;
    render(
      <AdminDashboardContext.Provider value={value}>
        <ConsumerInsideProvider />
      </AdminDashboardContext.Provider>,
    );
    expect(screen.getByTestId("token").textContent).toBe("tok-123");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
