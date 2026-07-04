// @vitest-environment jsdom
//
// Regression tests: UnifiedReceiptsList inside DepositView must render
// data-testid="portal-skeleton-list" items while the fetch is pending
// and data-testid="unified-receipts-empty" when the data array is empty.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/i18n/format", () => ({
  useFormat: () => ({
    formatDateTime: (d: any) => String(d),
    formatDate: (d: any) => String(d),
    formatNumber: (n: any) => String(n),
    formatCurrency: (n: any) => String(n),
    formatRelative: (d: any) => String(d),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/components/portal/LocalizedAmount", () => ({
  LocalizedAmount: () => null,
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => null,
  QRCodeCanvas: React.forwardRef(() => null),
}));

vi.mock("@/components/ui/select", () => {
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => <div data-testid="select-stub">{children}</div>;
  const SelectTrigger = ({ children }: any) => <div>{children}</div>;
  const SelectValue = () => null;
  const SelectContent = ({ children }: any) => <>{children}</>;
  const SelectItem: React.FC<{
    value: string;
    children?: React.ReactNode;
    "data-testid"?: string;
  }> = ({ value, children }) => <option value={value}>{children}</option>;
  (SelectItem as any).displayName = "SelectItem";
  const SelectGroup = ({ children }: any) => <>{children}</>;
  const SelectLabel = ({ children }: any) => <>{children}</>;
  const SelectSeparator = () => null;
  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
  };
});

let currentCaseStub: any = null;
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    depositReceipts: [],
    uploadReceipt: vi.fn(async () => undefined),
    setIsChatOpen: vi.fn(),
    setViewState: vi.fn(),
    activeReissue: null,
  }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
  clearPortalToken: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function caseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    accessCode: "ABCD-1234",
    depositAddress: "TX-deposit-address-xyz",
    depositAsset: "USDT",
    depositNetwork: "TRC20",
    certificateEnabled: false,
    certificateFeeStatus: null,
    stampDutyEnabled: false,
    stampDutyStatus: null,
    ...overrides,
  };
}

let DepositView: typeof import("../DepositView").DepositView;

async function loadComponent() {
  vi.resetModules();
  ({ DepositView } = await import("../DepositView"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = null;
  sessionStorage.clear();
});

// ── UnifiedReceiptsList — loading skeleton ────────────────────────────────────

describe("DepositView / UnifiedReceiptsList — loading skeleton", () => {
  it("renders portal-skeleton-list items while the all-receipts fetch is pending", async () => {
    // Never resolve — keeps component in loading state for the assertion.
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    // Skeleton items must appear before the fetch settles.
    const skeletons = screen.getAllByTestId("portal-skeleton-list");
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the role=status loading wrapper while fetching", async () => {
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeTruthy();
    expect(statusEl.getAttribute("aria-label")).toBe("Loading");
  });

  it("removes the skeleton after the fetch resolves with an empty array", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });

  it("removes the skeleton after the fetch resolves with rows", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          source: "deposit",
          id: 1,
          category: "activation",
          status: "pending",
          fileName: "receipt.png",
          notes: null,
          uploadedAt: new Date().toISOString(),
        },
      ],
    }));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    await waitFor(() => {
      expect(screen.queryAllByTestId("portal-skeleton-list")).toHaveLength(0);
    });
  });
});

// ── UnifiedReceiptsList — empty state ─────────────────────────────────────────

describe("DepositView / UnifiedReceiptsList — empty state", () => {
  beforeEach(() => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
  });

  it("renders data-testid='unified-receipts-empty' when the receipts array is empty", async () => {
    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    await waitFor(() => {
      expect(screen.getByTestId("unified-receipts-empty")).toBeTruthy();
    });
  });

  it("does not render the empty state while loading is still in progress", async () => {
    // Replace with a never-resolving fetch so loading stays true.
    (global as any).fetch = vi.fn(() => new Promise(() => {}));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    // Loading is still true — empty state must not be present yet.
    expect(screen.queryByTestId("unified-receipts-empty")).toBeNull();
  });

  it("does not render the empty state when there are rows", async () => {
    (global as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          source: "deposit",
          id: 2,
          category: "other",
          status: "approved",
          fileName: "proof.pdf",
          notes: null,
          uploadedAt: new Date().toISOString(),
        },
      ],
    }));

    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    await waitFor(() => {
      expect(screen.queryByTestId("unified-receipts-empty")).toBeNull();
    });
  });
});
