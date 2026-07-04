// @vitest-environment jsdom
//
// Regression tests: CertificateView must render each certificate fee-payment
// entry with the correct data-testid attributes so that automated tests can
// locate and inspect entries without relying on text content.
//
// Specifically guarded:
//   data-testid="certificate-payment-{id}"        — the <li> row for each payment
//   data-testid="certificate-payment-{id}-status" — the status <Badge> for each payment
//
// Status-badge assertions use CSS class names (the same ones used to pick the
// badge colour) rather than translatable text content, so they remain green
// even when the displayed label is localised or changed.

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// ── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock("framer-motion", () => {
  const passthrough = (Tag: keyof React.JSX.IntrinsicElements) => {
    const C = ({ children, ...rest }: any) =>
      React.createElement(Tag, rest, children);
    C.displayName = `motion.${String(Tag)}`;
    return C;
  };
  return {
    motion: new Proxy(
      {},
      { get: (_t, prop: string) => passthrough(prop as any) },
    ),
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      (opts && typeof opts === "object" && "defaultValue" in opts
        ? opts.defaultValue
        : key) as string,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

vi.mock("@/lib/withdrawalMode", () => ({
  getIsWithdrawalMode: () => false,
}));

vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: {
      id: "case-cert-1",
      accessCode: "CERT-0001",
      certificateEnabled: true,
      certificateFeeStatus: "awaiting_admin_approval",
    },
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const feeFixture = {
  percent: "2.0",
  amountUsdt: "1000",
  baseAmountUsed: "50000",
  status: "awaiting_admin_approval" as const,
  approvedAt: null,
  depositAddress: "TCERT123ADDR",
  depositAsset: "USDT",
  depositNetwork: "TRC20",
};

function makePayment(overrides: Partial<{
  id: number;
  amountUsdt: string;
  percentUsed: string;
  status: "pending" | "approved" | "rejected";
  adminNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  fileName: string | null;
  notes: string | null;
}> = {}) {
  return {
    id: 1,
    amountUsdt: "1000",
    percentUsed: "2.0",
    status: "pending" as const,
    adminNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    uploadedAt: new Date("2025-01-15T10:00:00Z").toISOString(),
    fileName: "receipt.pdf",
    notes: null,
    ...overrides,
  };
}

function makeFetch(paymentsBody: any[]) {
  return vi.fn(async (url: string) => {
    const isFeePayments = String(url).includes("/fee-payments");
    return {
      ok: true,
      status: 200,
      json: async () => (isFeePayments ? paymentsBody : feeFixture),
    };
  });
}

let CertificateView: typeof import("../CertificateView").CertificateView;

async function loadComponent() {
  vi.resetModules();
  ({ CertificateView } = await import("../CertificateView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Row testids ───────────────────────────────────────────────────────────────

describe("CertificateView — payment-history row testids", () => {
  it("renders a list item with data-testid='certificate-payment-{id}' for each payment", async () => {
    const payments = [
      makePayment({ id: 7, status: "pending" }),
      makePayment({ id: 42, status: "approved" }),
      makePayment({ id: 99, status: "rejected" }),
    ];
    (global as any).fetch = makeFetch(payments);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(screen.getByTestId("certificate-payment-7")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-42")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-99")).toBeTruthy();
    });
  });

  it("renders exactly one row per payment with no extra or missing entries", async () => {
    const payments = [
      makePayment({ id: 10 }),
      makePayment({ id: 20 }),
    ];
    (global as any).fetch = makeFetch(payments);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      // Both expected rows are present.
      expect(screen.getByTestId("certificate-payment-10")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-20")).toBeTruthy();
      // A row for a non-existent id must not exist.
      expect(screen.queryByTestId("certificate-payment-999")).toBeNull();
    });
  });
});

// ── Status badge testids ──────────────────────────────────────────────────────

describe("CertificateView — payment-history status badge testids", () => {
  it("renders a status badge with data-testid='certificate-payment-{id}-status' for each payment", async () => {
    const payments = [
      makePayment({ id: 5, status: "pending" }),
      makePayment({ id: 6, status: "approved" }),
      makePayment({ id: 7, status: "rejected" }),
    ];
    (global as any).fetch = makeFetch(payments);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      expect(screen.getByTestId("certificate-payment-5-status")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-6-status")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-7-status")).toBeTruthy();
    });
  });

  it("applies the amber (pending) badge class for a payment with status='pending'", async () => {
    (global as any).fetch = makeFetch([makePayment({ id: 11, status: "pending" })]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      const badge = screen.getByTestId("certificate-payment-11-status");
      expect(badge.className).toContain("bg-amber-500/20");
      expect(badge.className).toContain("text-amber-300");
    });
  });

  it("applies the emerald (approved) badge class for a payment with status='approved'", async () => {
    (global as any).fetch = makeFetch([makePayment({ id: 12, status: "approved" })]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      const badge = screen.getByTestId("certificate-payment-12-status");
      expect(badge.className).toContain("bg-emerald-500/20");
      expect(badge.className).toContain("text-emerald-300");
    });
  });

  it("applies the red (rejected) badge class for a payment with status='rejected'", async () => {
    (global as any).fetch = makeFetch([makePayment({ id: 13, status: "rejected" })]);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      const badge = screen.getByTestId("certificate-payment-13-status");
      expect(badge.className).toContain("bg-red-500/20");
      expect(badge.className).toContain("text-red-300");
    });
  });
});

// ── Multiple payments with mixed statuses ────────────────────────────────────

describe("CertificateView — mixed-status payment history", () => {
  it("correctly renders three payments with distinct statuses and independent badge styles", async () => {
    const payments = [
      makePayment({ id: 101, status: "approved",  reviewedAt: new Date().toISOString(), reviewedBy: "admin" }),
      makePayment({ id: 102, status: "rejected",  adminNotes: "Bad image quality", reviewedAt: new Date().toISOString(), reviewedBy: "admin" }),
      makePayment({ id: 103, status: "pending" }),
    ];
    (global as any).fetch = makeFetch(payments);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      // All three row testids present.
      expect(screen.getByTestId("certificate-payment-101")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-102")).toBeTruthy();
      expect(screen.getByTestId("certificate-payment-103")).toBeTruthy();

      // Badge testids present for all three.
      const approved = screen.getByTestId("certificate-payment-101-status");
      const rejected = screen.getByTestId("certificate-payment-102-status");
      const pending  = screen.getByTestId("certificate-payment-103-status");

      // Approved → emerald classes.
      expect(approved.className).toContain("bg-emerald-500/20");
      expect(approved.className).toContain("text-emerald-300");

      // Rejected → red classes.
      expect(rejected.className).toContain("bg-red-500/20");
      expect(rejected.className).toContain("text-red-300");

      // Pending → amber classes.
      expect(pending.className).toContain("bg-amber-500/20");
      expect(pending.className).toContain("text-amber-300");
    });
  });

  it("renders each row inside the payment-history container", async () => {
    const payments = [
      makePayment({ id: 201, status: "approved" }),
      makePayment({ id: 202, status: "pending" }),
    ];
    (global as any).fetch = makeFetch(payments);

    await loadComponent();
    render(<CertificateView />);

    await waitFor(() => {
      const history = screen.getByTestId("certificate-payment-history");
      expect(history).toBeTruthy();

      // Both row elements are descendants of the history container.
      const row201 = screen.getByTestId("certificate-payment-201");
      const row202 = screen.getByTestId("certificate-payment-202");
      expect(history.contains(row201)).toBe(true);
      expect(history.contains(row202)).toBe(true);
    });
  });
});
