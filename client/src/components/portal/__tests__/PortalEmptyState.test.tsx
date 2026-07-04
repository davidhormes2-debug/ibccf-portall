// @vitest-environment jsdom
//
// Unit tests for the PortalEmptyState component.
// Verifies that icon, title, description, hint, and action props are all
// rendered when provided, and omitted when not.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// framer-motion: render motion.div as a plain div so jsdom doesn't choke on
// animation APIs.
vi.mock("framer-motion", () => {
  const passthrough = (tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: React.ComponentPropsWithoutRef<typeof tag>) =>
      React.createElement(tag as string, rest as any, children);
    C.displayName = `motion.${String(tag)}`;
    return C;
  };
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) =>
        passthrough(prop as keyof React.JSX.IntrinsicElements),
    }),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    useReducedMotion: () => false,
  };
});

import { PortalEmptyState } from "../PortalEmptyState";
import { FileText, Lock, AlertTriangle } from "lucide-react";

afterEach(() => {
  cleanup();
});

// ── default testid ──────────────────────────────────────────────────────────

describe("PortalEmptyState — default testid", () => {
  it("renders with data-testid='portal-empty-state' when no testid prop is given", () => {
    render(<PortalEmptyState icon={FileText} title="Nothing here" />);
    expect(screen.getByTestId("portal-empty-state")).toBeTruthy();
  });

  it("uses a custom data-testid when provided", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Nothing here"
        data-testid="my-custom-empty"
      />,
    );
    expect(screen.getByTestId("my-custom-empty")).toBeTruthy();
    expect(screen.queryByTestId("portal-empty-state")).toBeNull();
  });
});

// ── title ───────────────────────────────────────────────────────────────────

describe("PortalEmptyState — title", () => {
  it("renders the title text inside an h3", () => {
    render(<PortalEmptyState icon={FileText} title="No records found" />);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("No records found");
  });

  it("renders different titles correctly", () => {
    render(<PortalEmptyState icon={Lock} title="No messages yet" />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toContain(
      "No messages yet",
    );
  });
});

// ── icon ────────────────────────────────────────────────────────────────────

describe("PortalEmptyState — icon", () => {
  it("renders the icon element with aria-hidden='true'", () => {
    render(<PortalEmptyState icon={FileText} title="Empty" />);
    const svgElements: Element[] = [];
    // Lucide renders an <svg>. We verify aria-hidden on it.
    const svgs = document.querySelectorAll("svg[aria-hidden='true']");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it("applies the default iconClassName (text-slate-500) when none given", () => {
    render(<PortalEmptyState icon={FileText} title="Empty" />);
    const svg = document.querySelector("svg");
    expect(svg?.className.baseVal ?? svg?.getAttribute("class") ?? "").toContain(
      "text-slate-500",
    );
  });

  it("applies a custom iconClassName when given", () => {
    render(
      <PortalEmptyState
        icon={AlertTriangle}
        title="Error"
        iconClassName="text-red-400"
      />,
    );
    const svg = document.querySelector("svg");
    const cls = svg?.className.baseVal ?? svg?.getAttribute("class") ?? "";
    expect(cls).toContain("text-red-400");
  });
});

// ── description ─────────────────────────────────────────────────────────────

describe("PortalEmptyState — description", () => {
  it("renders the description paragraph when provided", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        description="No data available."
      />,
    );
    expect(screen.getByText("No data available.")).toBeTruthy();
  });

  it("does not render any description when prop is omitted", () => {
    render(<PortalEmptyState icon={FileText} title="Empty" />);
    expect(screen.queryByText("No data available.")).toBeNull();
  });

  it("description is absent when explicitly undefined", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        description={undefined}
      />,
    );
    const container = screen.getByTestId("portal-empty-state");
    // Only the heading and icon should be in the tree; no extra p tags for description
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(0);
  });
});

// ── hint ────────────────────────────────────────────────────────────────────

describe("PortalEmptyState — hint", () => {
  it("renders the hint paragraph when provided", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        hint="Check back later."
      />,
    );
    expect(screen.getByText("Check back later.")).toBeTruthy();
  });

  it("does not render a hint when prop is omitted", () => {
    render(<PortalEmptyState icon={FileText} title="Empty" />);
    expect(screen.queryByText("Check back later.")).toBeNull();
  });

  it("renders both description and hint when both are provided", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        description="No data yet."
        hint="Try again later."
      />,
    );
    expect(screen.getByText("No data yet.")).toBeTruthy();
    expect(screen.getByText("Try again later.")).toBeTruthy();
  });

  it("hint is absent when only description is given", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        description="Some description."
      />,
    );
    const container = screen.getByTestId("portal-empty-state");
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toContain("Some description.");
  });
});

// ── action ───────────────────────────────────────────────────────────────────

describe("PortalEmptyState — action", () => {
  it("renders the action node when provided", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        action={<button data-testid="action-btn">Go back</button>}
      />,
    );
    expect(screen.getByTestId("action-btn")).toBeTruthy();
    expect(screen.getByText("Go back")).toBeTruthy();
  });

  it("does not render an action wrapper when action prop is omitted", () => {
    render(<PortalEmptyState icon={FileText} title="Empty" />);
    expect(screen.queryByTestId("action-btn")).toBeNull();
  });

  it("action wraps the node inside a div container", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="Empty"
        action={<span data-testid="action-content">Click me</span>}
      />,
    );
    const content = screen.getByTestId("action-content");
    // The parent of the action content must be a div (the mt-6 wrapper)
    expect(content.parentElement?.tagName.toLowerCase()).toBe("div");
  });

  it("renders a complex action node correctly", () => {
    render(
      <PortalEmptyState
        icon={Lock}
        title="Locked"
        action={
          <div>
            <button data-testid="primary-action">Primary</button>
            <button data-testid="secondary-action">Secondary</button>
          </div>
        }
      />,
    );
    expect(screen.getByTestId("primary-action")).toBeTruthy();
    expect(screen.getByTestId("secondary-action")).toBeTruthy();
  });
});

// ── combined props ───────────────────────────────────────────────────────────

describe("PortalEmptyState — full prop combination", () => {
  it("renders all optional sections together", () => {
    render(
      <PortalEmptyState
        icon={FileText}
        title="All props"
        description="A description."
        hint="A hint."
        action={<button data-testid="full-action">Act</button>}
        data-testid="full-empty-state"
      />,
    );

    expect(screen.getByTestId("full-empty-state")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toContain(
      "All props",
    );
    expect(screen.getByText("A description.")).toBeTruthy();
    expect(screen.getByText("A hint.")).toBeTruthy();
    expect(screen.getByTestId("full-action")).toBeTruthy();
  });

  it("renders only title and icon when all optional props are absent", () => {
    render(<PortalEmptyState icon={FileText} title="Minimal" />);
    const container = screen.getByTestId("portal-empty-state");
    expect(
      screen.getByRole("heading", { level: 3 }).textContent,
    ).toContain("Minimal");
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
