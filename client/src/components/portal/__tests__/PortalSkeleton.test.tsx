// @vitest-environment jsdom
//
// Unit tests for the PortalSkeleton component.
// Verifies that all three variants (card, list, stat) render the correct
// number of skeleton items and carry the right ARIA attributes.

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PortalSkeleton } from "../PortalSkeleton";

afterEach(() => {
  cleanup();
});

// ── card variant (default) ──────────────────────────────────────────────────

describe("PortalSkeleton — card variant", () => {
  it("renders the status wrapper with role='status' and aria-label='Loading'", () => {
    render(<PortalSkeleton variant="card" />);
    const wrapper = screen.getByRole("status");
    expect(wrapper).toBeTruthy();
    expect(wrapper.getAttribute("aria-label")).toBe("Loading");
  });

  it("renders 2 card skeleton items by default", () => {
    render(<PortalSkeleton variant="card" />);
    const items = screen.getAllByTestId("portal-skeleton-card");
    expect(items).toHaveLength(2);
  });

  it("renders the requested number of card items when count is specified", () => {
    render(<PortalSkeleton variant="card" count={5} />);
    const items = screen.getAllByTestId("portal-skeleton-card");
    expect(items).toHaveLength(5);
  });

  it("renders 1 card item when count=1", () => {
    render(<PortalSkeleton variant="card" count={1} />);
    const items = screen.getAllByTestId("portal-skeleton-card");
    expect(items).toHaveLength(1);
  });

  it("every card item carries aria-hidden='true'", () => {
    render(<PortalSkeleton variant="card" count={3} />);
    const items = screen.getAllByTestId("portal-skeleton-card");
    items.forEach((item) => {
      expect(item.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("is the default variant when variant prop is omitted", () => {
    render(<PortalSkeleton />);
    expect(screen.getAllByTestId("portal-skeleton-card")).toHaveLength(2);
  });
});

// ── list variant ────────────────────────────────────────────────────────────

describe("PortalSkeleton — list variant", () => {
  it("renders the status wrapper with role='status' and aria-label='Loading'", () => {
    render(<PortalSkeleton variant="list" />);
    const wrapper = screen.getByRole("status");
    expect(wrapper).toBeTruthy();
    expect(wrapper.getAttribute("aria-label")).toBe("Loading");
  });

  it("renders 2 list skeleton items by default", () => {
    render(<PortalSkeleton variant="list" />);
    const items = screen.getAllByTestId("portal-skeleton-list");
    expect(items).toHaveLength(2);
  });

  it("renders the requested number of list items when count is specified", () => {
    render(<PortalSkeleton variant="list" count={4} />);
    const items = screen.getAllByTestId("portal-skeleton-list");
    expect(items).toHaveLength(4);
  });

  it("every list item carries aria-hidden='true'", () => {
    render(<PortalSkeleton variant="list" count={3} />);
    const items = screen.getAllByTestId("portal-skeleton-list");
    items.forEach((item) => {
      expect(item.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("does not render any card or stat items", () => {
    render(<PortalSkeleton variant="list" count={3} />);
    expect(screen.queryAllByTestId("portal-skeleton-card")).toHaveLength(0);
    expect(screen.queryAllByTestId("portal-skeleton-stat")).toHaveLength(0);
  });
});

// ── stat variant ────────────────────────────────────────────────────────────

describe("PortalSkeleton — stat variant", () => {
  it("renders the status wrapper with role='status' and aria-label='Loading'", () => {
    render(<PortalSkeleton variant="stat" />);
    const wrapper = screen.getByRole("status");
    expect(wrapper).toBeTruthy();
    expect(wrapper.getAttribute("aria-label")).toBe("Loading");
  });

  it("renders 2 stat skeleton items by default", () => {
    render(<PortalSkeleton variant="stat" />);
    const items = screen.getAllByTestId("portal-skeleton-stat");
    expect(items).toHaveLength(2);
  });

  it("renders the requested number of stat items when count is specified", () => {
    render(<PortalSkeleton variant="stat" count={3} />);
    const items = screen.getAllByTestId("portal-skeleton-stat");
    expect(items).toHaveLength(3);
  });

  it("every stat item carries aria-hidden='true'", () => {
    render(<PortalSkeleton variant="stat" count={3} />);
    const items = screen.getAllByTestId("portal-skeleton-stat");
    items.forEach((item) => {
      expect(item.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("does not render any card or list items", () => {
    render(<PortalSkeleton variant="stat" count={3} />);
    expect(screen.queryAllByTestId("portal-skeleton-card")).toHaveLength(0);
    expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
  });
});

// ── cross-variant isolation ─────────────────────────────────────────────────

describe("PortalSkeleton — variant isolation", () => {
  it("card variant does not bleed list or stat testids", () => {
    render(<PortalSkeleton variant="card" count={2} />);
    expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    expect(screen.queryAllByTestId("portal-skeleton-stat")).toHaveLength(0);
  });

  it("exactly one role=status element per mounted component", () => {
    render(<PortalSkeleton variant="card" count={4} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
