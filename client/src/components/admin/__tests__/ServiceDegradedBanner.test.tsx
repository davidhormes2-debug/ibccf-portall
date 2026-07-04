// @vitest-environment jsdom
//
// Unit tests for the ServiceDegradedBanner component.
//
// The banner polls /health on mount and every 60 s, shows a sticky alert when
// any service (db / smtp / ai) is degraded, and is dismissible per-session
// per-set-of-degraded-services via sessionStorage.
//
// Contracted behaviours under test:
//   (a) Hidden when all services report "ok".
//   (b) Visible with correct human-readable service names when one or more
//       services are degraded.
//   (c) "View Health" button invokes the onViewHealth callback.
//   (d) Dismiss button hides the banner and writes the dismiss key to
//       sessionStorage.
//   (e) Re-appears when the set of degraded services changes after a previous
//       dismiss (different sessionStorage key).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ServiceDegradedBanner } from "../ServiceDegradedBanner";

// ── helpers ───────────────────────────────────────────────────────────────────

type ProbeStatus = "ok" | "degraded" | "unconfigured";

function makeHealthResponse(overrides: Partial<Record<"db" | "smtp" | "ai", ProbeStatus>> = {}) {
  return {
    db: { status: overrides.db ?? "ok" },
    smtp: { status: overrides.smtp ?? "ok" },
    ai: { status: overrides.ai ?? "ok" },
  };
}

function mockFetch(body: object, status = 200) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  } as Response);
}

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ServiceDegradedBanner", () => {

  // ── (a) hidden when all services are ok ──────────────────────────────────

  it("does not render the banner when all services report ok", async () => {
    mockFetch(makeHealthResponse());

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    // Wait long enough for the async fetch to resolve and React to re-render.
    await waitFor(() => {
      expect(
        screen.queryByTestId("banner-service-degraded"),
      ).toBeNull();
    });
  });

  it("does not render the banner when the fetch fails (best-effort)", async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn().mockRejectedValue(
      new Error("network error"),
    );

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("banner-service-degraded"),
      ).toBeNull();
    });
  });

  // ── (b) visible with correct service names when degraded ─────────────────

  it("renders the banner when the database is degraded", async () => {
    mockFetch(makeHealthResponse({ db: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    const services = screen.getByTestId("banner-service-degraded-services");
    expect(services.textContent).toContain("Database");
    expect(services.textContent).not.toContain("SMTP");
    expect(services.textContent).not.toContain("AI");
  });

  it("renders the banner when SMTP is degraded with the human-readable label", async () => {
    mockFetch(makeHealthResponse({ smtp: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    const services = screen.getByTestId("banner-service-degraded-services");
    expect(services.textContent).toContain("SMTP (Email)");
    expect(services.textContent).not.toContain("Database");
    expect(services.textContent).not.toContain("AI");
  });

  it("renders the banner when AI is degraded with the human-readable label", async () => {
    mockFetch(makeHealthResponse({ ai: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    const services = screen.getByTestId("banner-service-degraded-services");
    expect(services.textContent).toContain("AI (OpenAI)");
    expect(services.textContent).not.toContain("Database");
    expect(services.textContent).not.toContain("SMTP");
  });

  it("renders all three degraded service names when all are degraded", async () => {
    mockFetch(makeHealthResponse({ db: "degraded", smtp: "degraded", ai: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    const services = screen.getByTestId("banner-service-degraded-services");
    expect(services.textContent).toContain("Database");
    expect(services.textContent).toContain("SMTP (Email)");
    expect(services.textContent).toContain("AI (OpenAI)");
  });

  it("renders the banner when the /health response has a 503 status", async () => {
    mockFetch(makeHealthResponse({ db: "degraded" }), 503);

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });
  });

  // ── (c) "View Health" button calls onViewHealth ───────────────────────────

  it("calls onViewHealth when the View Health button is clicked", async () => {
    mockFetch(makeHealthResponse({ db: "degraded" }));

    const onViewHealth = vi.fn();
    render(<ServiceDegradedBanner onViewHealth={onViewHealth} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("button-service-degraded-view-health"));

    expect(onViewHealth).toHaveBeenCalledTimes(1);
  });

  // ── (d) dismiss button hides the banner and writes to sessionStorage ──────

  it("hides the banner when the dismiss button is clicked", async () => {
    mockFetch(makeHealthResponse({ smtp: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("button-service-degraded-dismiss"));

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).toBeNull();
    });
  });

  it("writes the dismiss key to sessionStorage when dismissed", async () => {
    mockFetch(makeHealthResponse({ smtp: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    expect(sessionStorage.length).toBe(0);

    fireEvent.click(screen.getByTestId("button-service-degraded-dismiss"));

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).toBeNull();
    });

    // The dismiss key encodes the sorted service list.
    const expectedKey = "svc-degraded-dismissed:smtp";
    expect(sessionStorage.getItem(expectedKey)).toBe("1");
  });

  it("does not render on remount when the same set of services are still degraded (session dismissed)", async () => {
    // Pre-seed the dismiss key that the component would have written.
    sessionStorage.setItem("svc-degraded-dismissed:db", "1");

    mockFetch(makeHealthResponse({ db: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      // The component should detect the pre-existing dismiss and stay hidden.
      expect(screen.queryByTestId("banner-service-degraded")).toBeNull();
    });
  });

  // ── (e) re-appears when the set of degraded services changes ─────────────

  it("re-appears when a new service degrades after the previous set was dismissed", async () => {
    // User previously dismissed the banner for just "db".
    sessionStorage.setItem("svc-degraded-dismissed:db", "1");

    // Now both db AND smtp are degraded — a different dismiss key.
    mockFetch(makeHealthResponse({ db: "degraded", smtp: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      // "db,smtp" key has NOT been dismissed, so the banner must show.
      expect(screen.queryByTestId("banner-service-degraded")).not.toBeNull();
    });

    const services = screen.getByTestId("banner-service-degraded-services");
    expect(services.textContent).toContain("Database");
    expect(services.textContent).toContain("SMTP (Email)");
  });

  it("dismiss key is sorted so order of degraded services does not matter", async () => {
    // Pre-seed with sorted key: db,smtp
    sessionStorage.setItem("svc-degraded-dismissed:db,smtp", "1");

    // Response lists smtp first, then db — should still match the sorted key.
    mockFetch(makeHealthResponse({ smtp: "degraded", db: "degraded" }));

    render(<ServiceDegradedBanner onViewHealth={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-service-degraded")).toBeNull();
    });
  });
});
