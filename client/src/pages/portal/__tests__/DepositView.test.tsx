// @vitest-environment jsdom
//
// Task #951 — Cover the merge-fee contextual banner that appears when the user
// arrives from the Withdrawal Batches confirmation flow.
//
// Task #165 — Cover the Task #163 unified-upload category dropdown's
// gating contract in the portal. The dropdown MUST hide options that
// don't apply to the current case state:
//   - 'reissue'    only when there is an active reissue round in
//                  `awaiting_deposit`.
//   - 'certificate' only when certificateEnabled && certificateFeeStatus
//                  !== 'approved'.
//   - 'stamp_duty' only when stampDutyEnabled && stampDutyStatus
//                  !== 'approved'.
// 'activation' and 'other' are always present.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";

// ---- Mocks (must precede the DepositView import) -------------------------

// Replace Radix Select with a plain native <select> so JSDOM can read
// the option list without fighting the pointer-capture APIs.
vi.mock("@/components/ui/select", () => {
  const collectItems = (children: React.ReactNode): React.ReactElement[] => {
    const out: React.ReactElement[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const c = child as React.ReactElement<any>;
      if ((c.type as any)?.displayName === "SelectItem") {
        out.push(c);
      } else if (c.props && (c.props as any).children) {
        out.push(...collectItems((c.props as any).children));
      }
    });
    return out;
  };
  // Extract data-testid from the SelectTrigger child so each Select gets
  // a unique testid instead of the same hardcoded string.
  const getTriggerTestId = (children: React.ReactNode): string => {
    let found = "select-unknown";
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = (child as React.ReactElement<any>).props as any;
      if (props && props["data-testid"]) found = `${props["data-testid"]}-native`;
    });
    return found;
  };
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => {
    const items = collectItems(children);
    const testid = getTriggerTestId(children);
    return (
      <select
        data-testid={testid}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {items.map((it) => (
          <option
            key={(it.props as any).value}
            value={(it.props as any).value}
            data-testid={(it.props as any)["data-testid"]}
          >
            {(it.props as any).children}
          </option>
        ))}
      </select>
    );
  };
  const SelectTrigger = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const SelectValue = () => null;
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  const SelectItem: React.FC<{
    value: string;
    children?: React.ReactNode;
    "data-testid"?: string;
  }> = ({ children }) => <>{children}</>;
  (SelectItem as any).displayName = "SelectItem";
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

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

// Lifted so individual tests can spy on the calls made by the component.
let toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: any[]) => toastSpy(...args), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/lib/portalSession", () => ({
  getPortalToken: () => "test-portal-token",
}));

// descText extracts a plain-text representation of a toast description that may
// be either a raw string (single-file path) or a React element produced by
// <ExpandableFailureList failures={...} />.  Uses the same truncation logic as
// the component (3 visible, "…and N more" suffix) so assertions stay
// meaningful regardless of whether the component wraps the failures in JSX.
function descText(description: unknown): string {
  if (typeof description === "string") return description;
  const el = description as any;
  const failures: Array<{ name: string; error: string }> =
    el?.props?.failures ?? [];
  const INITIAL_VISIBLE = 3;
  const visible = failures.slice(0, INITIAL_VISIBLE);
  const extra = failures.length - INITIAL_VISIBLE;
  const lines = visible.map(
    (f: { name: string; error: string }) => `${f.name}: ${f.error}`,
  );
  if (extra > 0) lines.push(`…and ${extra} more`);
  return lines.join("\n");
}

const DEPOSIT_VIEW_I18N: Record<string, string> = {
  "deposit.toast.uploadFailedTitle": "Upload failed",
  "deposit.toast.partialUploadTitle": "Uploaded {{succeeded}} of {{total}}",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      const template =
        opts && typeof opts === "object" && "defaultValue" in opts
          ? (opts.defaultValue as string)
          : (DEPOSIT_VIEW_I18N[key] ?? key);
      if (opts && typeof opts === "object") {
        return template.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) =>
          k in opts ? String((opts as Record<string, unknown>)[k]) : `{{${k}}}`,
        );
      }
      return template;
    },
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

vi.mock("@/components/portal/LocalizedAmount", () => ({
  LocalizedAmount: () => null,
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => null,
  QRCodeCanvas: React.forwardRef(() => null),
}));

// PortalContext — overridden per test via `currentCaseStub` /
// `activeReissueStub` / `uploadReceiptStub` closures.
let currentCaseStub: any = null;
let activeReissueStub: any = null;
// Default stub resolves successfully; override per-test to simulate failures.
let uploadReceiptStub: (...args: any[]) => Promise<any> = vi.fn(async () => undefined);
vi.mock("../PortalContext", () => ({
  usePortal: () => ({
    currentCase: currentCaseStub,
    depositReceipts: [],
    uploadReceipt: (...args: any[]) => uploadReceiptStub(...args),
    setIsChatOpen: vi.fn(),
    setViewState: vi.fn(),
    activeReissue: activeReissueStub,
  }),
}));

// Stub the unified-receipts fetch so the list call is harmless.
beforeEach(() => {
  global.fetch = vi.fn(async () =>
    ({
      ok: true,
      status: 200,
      json: async () => [],
    }) as unknown as Response,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  currentCaseStub = null;
  activeReissueStub = null;
  uploadReceiptStub = vi.fn(async () => undefined);
  toastSpy = vi.fn();
  sessionStorage.clear();
});

// ---- Helpers ---------------------------------------------------------------

let DepositView: typeof import("../DepositView").DepositView;

async function loadComponent() {
  vi.resetModules();
  ({ DepositView } = await import("../DepositView"));
}

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

function optionValues(): string[] {
  const select = screen.getByTestId<HTMLSelectElement>(
    "select-upload-category-native",
  );
  return Array.from(select.options).map((o) => o.value);
}
// The Select mock derives testids from the SelectTrigger's data-testid prop.
// The upload-category SelectTrigger carries data-testid="select-upload-category",
// so the mocked native <select> gets data-testid="select-upload-category-native".

// ---- Tests -----------------------------------------------------------------

describe("DepositView — unified-upload category dropdown gating", () => {
  it("hides certificate, stamp_duty, and reissue when none are available", async () => {
    currentCaseStub = caseFixture();
    activeReissueStub = null;
    await loadComponent();

    render(<DepositView />);

    const values = optionValues();
    expect(values).toEqual(["activation", "other"]);
    expect(values).not.toContain("reissue");
    expect(values).not.toContain("certificate");
    expect(values).not.toContain("stamp_duty");
  });

  it("shows the reissue option only when there is an awaiting_deposit reissue round", async () => {
    currentCaseStub = caseFixture();
    activeReissueStub = {
      id: 7,
      caseId: "case-1",
      version: 2,
      reissueFee: "1500 USDT",
      status: "awaiting_deposit",
    };
    await loadComponent();

    render(<DepositView />);

    const values = optionValues();
    expect(values).toContain("reissue");
    expect(values).not.toContain("certificate");
    expect(values).not.toContain("stamp_duty");
  });

  it("hides the reissue option when the round is past awaiting_deposit (e.g. awaiting_review)", async () => {
    currentCaseStub = caseFixture();
    activeReissueStub = {
      id: 7,
      caseId: "case-1",
      version: 2,
      reissueFee: "1500 USDT",
      status: "awaiting_review",
    };
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).not.toContain("reissue");
  });

  it("shows certificate only when certificateEnabled && certificateFeeStatus !== 'approved'", async () => {
    currentCaseStub = caseFixture({
      certificateEnabled: true,
      certificateFeeStatus: "awaiting_admin_approval",
    });
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).toContain("certificate");
  });

  it("hides certificate once certificateFeeStatus === 'approved'", async () => {
    currentCaseStub = caseFixture({
      certificateEnabled: true,
      certificateFeeStatus: "approved",
    });
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).not.toContain("certificate");
  });

  it("hides certificate when certificateEnabled is false (even with no status)", async () => {
    currentCaseStub = caseFixture({
      certificateEnabled: false,
      certificateFeeStatus: "awaiting_admin_approval",
    });
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).not.toContain("certificate");
  });

  it("shows stamp_duty only when stampDutyEnabled && stampDutyStatus !== 'approved'", async () => {
    currentCaseStub = caseFixture({
      stampDutyEnabled: true,
      stampDutyStatus: "awaiting_admin_approval",
    });
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).toContain("stamp_duty");
  });

  it("hides stamp_duty once stampDutyStatus === 'approved'", async () => {
    currentCaseStub = caseFixture({
      stampDutyEnabled: true,
      stampDutyStatus: "approved",
    });
    await loadComponent();

    render(<DepositView />);

    expect(optionValues()).not.toContain("stamp_duty");
  });

  it("shows every option when reissue, certificate and stamp_duty are all available", async () => {
    currentCaseStub = caseFixture({
      certificateEnabled: true,
      certificateFeeStatus: "awaiting_admin_approval",
      stampDutyEnabled: true,
      stampDutyStatus: "awaiting_upload",
    });
    activeReissueStub = {
      id: 7,
      caseId: "case-1",
      version: 2,
      reissueFee: "1500 USDT",
      status: "awaiting_deposit",
    };
    await loadComponent();

    render(<DepositView />);

    const values = optionValues();
    expect(new Set(values)).toEqual(
      new Set(["activation", "reissue", "certificate", "stamp_duty", "other"]),
    );
  });
});

// ---- Merge-fee banner tests (Tasks #951, #953) -----------------------------

describe("DepositView — merge-fee contextual banner", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("does not show the banner when the user arrives normally (no sessionStorage signal)", async () => {
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
  });

  it("shows the banner when ibccf.pending_upload_category is 'merge_fee'", async () => {
    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();
  });

  it("clears the sessionStorage signal on mount so a refresh does not re-show the banner", async () => {
    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    expect(sessionStorage.getItem("ibccf.pending_upload_category")).toBeNull();
  });

  it("hides the banner after the user clicks the dismiss button", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    const dismissBtn = screen.getByTestId("button-dismiss-merge-fee-banner");
    await user.click(dismissBtn);

    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
  });

  it("does not show the banner for other pending categories", async () => {
    sessionStorage.setItem("ibccf.pending_upload_category", "activation");
    currentCaseStub = caseFixture();
    await loadComponent();

    render(<DepositView />);

    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
  });

  it("reappears when the user switches back to merge_fee without having dismissed", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    // Banner is visible on arrival
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    // Switch away to a different category
    const select = screen.getByTestId("select-upload-category-native") as HTMLSelectElement;
    await user.selectOptions(select, "activation");
    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();

    // Switch back to merge_fee — banner must reappear (mergeFeeBannerDismissed is still false)
    const selectFresh = screen.getByTestId("select-upload-category-native") as HTMLSelectElement;
    await user.selectOptions(selectFresh, "merge_fee");
    expect(selectFresh.value).toBe("merge_fee");
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();
  });

  it("does not reappear after the user explicitly dismisses and switches back", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    // Dismiss the banner — sets mergeFeeBannerDismissed, not showMergeFeeBanner
    const dismissBtn = screen.getByTestId("button-dismiss-merge-fee-banner");
    await user.click(dismissBtn);
    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();

    // Switch away then back — banner must remain hidden even with uploadCategory='merge_fee'
    const select = screen.getByTestId("select-upload-category-native") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "activation" } });
    fireEvent.change(select, { target: { value: "merge_fee" } });
    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
  });

  it("hides the banner after a successful file upload", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });

    // uploadReceipt mock resolves successfully (default stub returns undefined)
    await loadComponent();

    render(<DepositView />);

    // Banner is initially visible
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    // Simulate choosing a file via the hidden file input
    const file = new File(["receipt"], "receipt.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    // Use waitFor so the assertion waits for the async handleFileUpload to settle
    await waitFor(() => {
      expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
    });
  });

  it("hides the banner when at least one file succeeds even if others fail (partial-success path)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });

    // First call succeeds, second call throws — exercises the partial-success
    // branch in handleFileUpload (succeeded > 0 && failures.length > 0) which
    // also calls setShowMergeFeeBanner(false).
    let callCount = 0;
    uploadReceiptStub = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) throw new Error("network error");
    });

    await loadComponent();

    render(<DepositView />);

    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    const file1 = new File(["r1"], "r1.png", { type: "image/png" });
    const file2 = new File(["r2"], "r2.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2]);

    await waitFor(() => {
      expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
    });
  });

  it("keeps the banner visible when every file in the batch fails (all-failure path)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });

    // uploadReceipt always throws — exercises the all-failure branch
    // (succeeded === 0) which must NOT call setShowMergeFeeBanner(false).
    uploadReceiptStub = vi.fn(async () => {
      throw new Error("network error");
    });

    await loadComponent();

    render(<DepositView />);

    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    const file1 = new File(["r1"], "r1.png", { type: "image/png" });
    const file2 = new File(["r2"], "r2.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2]);

    // After both uploads fail, the banner must still be in the DOM.
    await waitFor(() => {
      expect(uploadReceiptStub).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();
  });

  it("shows the banner for a second batch even after the first batch was dismissed (multi-batch within same session)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    // --- Batch 1: user arrives from WithdrawalView with batch ID "1000" ---
    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    sessionStorage.setItem("ibccf.pending_merge_batch_id", "1000");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    // Banner visible for batch 1
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    // User dismisses — writes ibccf.merge_fee_banner_dismissed_1000=true
    const dismissBtn = screen.getByTestId("button-dismiss-merge-fee-banner");
    await user.click(dismissBtn);
    expect(screen.queryByTestId("banner-merge-fee-notice")).toBeNull();
    expect(sessionStorage.getItem("ibccf.merge_fee_banner_dismissed_1000")).toBe("true");

    // Tear down batch 1 mount
    cleanup();

    // --- Batch 2: user triggers a new merge from WithdrawalView with batch ID "2000" ---
    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    sessionStorage.setItem("ibccf.pending_merge_batch_id", "2000");
    await loadComponent();

    render(<DepositView />);

    // Banner must reappear because batch 2 has its own fresh key
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();
  });
});

// ---- Batch-dismissed key cleanup after successful upload (Task #967) --------

describe("DepositView — sessionStorage cleanup after successful merge-fee upload", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("removes the batch-scoped dismissed key from sessionStorage after a successful upload (even if it was previously set by a manual dismiss)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    // --- Step 1: arrive from merge flow with batch 999 ---
    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    sessionStorage.setItem("ibccf.pending_merge_batch_id", "batch-999");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    // Banner is visible
    expect(screen.queryByTestId("banner-merge-fee-notice")).not.toBeNull();

    // --- Step 2: user manually dismisses the banner → key is written ---
    const dismissBtn = screen.getByTestId("button-dismiss-merge-fee-banner");
    await user.click(dismissBtn);

    // After dismiss the key must exist in sessionStorage
    await waitFor(() => {
      expect(sessionStorage.getItem("ibccf.merge_fee_banner_dismissed_batch-999")).toBe("true");
    });

    // --- Step 3: user uploads a file (banner is already gone) ---
    const file = new File(["receipt"], "merge-fee.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // After the successful upload the stale dismissed key must be removed
    await waitFor(() => {
      expect(sessionStorage.getItem("ibccf.merge_fee_banner_dismissed_batch-999")).toBeNull();
    });
  });

  it("does NOT remove the batch-scoped dismissed key when the user dismisses manually (no upload)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    sessionStorage.setItem("ibccf.pending_upload_category", "merge_fee");
    sessionStorage.setItem("ibccf.pending_merge_batch_id", "batch-888");
    currentCaseStub = caseFixture({ withdrawalWindowEnabled: true });
    await loadComponent();

    render(<DepositView />);

    const dismissBtn = screen.getByTestId("button-dismiss-merge-fee-banner");
    await user.click(dismissBtn);

    // Manual dismiss must write the key so the banner stays gone on remount
    await waitFor(() => {
      expect(sessionStorage.getItem("ibccf.merge_fee_banner_dismissed_batch-888")).toBe("true");
    });
  });
});

// ---- All-failure toast content (Task #959) ---------------------------------

describe("DepositView — all-failure upload toast", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("calls toast with variant='destructive' and the failure message when every upload fails (single file)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();
    uploadReceiptStub = vi.fn(async () => {
      throw new Error("server rejected the file");
    });

    await loadComponent();
    render(<DepositView />);

    const file = new File(["data"], "receipt.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };
    expect(arg.variant).toBe("destructive");
    expect(arg.title).toBe("Upload failed");
    // Single-file path: description is the raw error message.
    expect(arg.description).toBe("server rejected the file");
  });

  it("calls toast with variant='destructive' and per-file errors when multiple files all fail", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();
    uploadReceiptStub = vi.fn(async () => {
      throw new Error("network timeout");
    });

    await loadComponent();
    render(<DepositView />);

    const file1 = new File(["d1"], "first.png", { type: "image/png" });
    const file2 = new File(["d2"], "second.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2]);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };
    expect(arg.variant).toBe("destructive");
    expect(arg.title).toBe("Upload failed");
    // Multi-file path: description lists each file name with its error.
    expect(descText(arg.description)).toContain("first.png");
    expect(descText(arg.description)).toContain("second.png");
    expect(descText(arg.description)).toContain("network timeout");
  });

  it("truncates error names to the first 3 when 5 files all fail", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();
    uploadReceiptStub = vi.fn(async () => {
      throw new Error("server error");
    });

    await loadComponent();
    render(<DepositView />);

    const files = [
      new File(["d1"], "alpha.png", { type: "image/png" }),
      new File(["d2"], "beta.png", { type: "image/png" }),
      new File(["d3"], "gamma.png", { type: "image/png" }),
      new File(["d4"], "delta.png", { type: "image/png" }),
      new File(["d5"], "epsilon.png", { type: "image/png" }),
    ];
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, files);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };
    expect(arg.variant).toBe("destructive");
    expect(arg.title).toBe("Upload failed");
    // First three file names must appear.
    expect(descText(arg.description)).toContain("alpha.png");
    expect(descText(arg.description)).toContain("beta.png");
    expect(descText(arg.description)).toContain("gamma.png");
    // Fourth file name must be truncated.
    expect(descText(arg.description)).not.toContain("delta.png");
    // "…and 2 more" suffix must appear (5 failures, 3 visible → 2 hidden).
    expect(descText(arg.description)).toContain("…and 2 more");
  });
});

// ---- Partial-success toast content (Task #960) -----------------------------

describe("DepositView — partial-success upload toast", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("calls toast with variant='destructive', 'Uploaded 1 of 2' title, and failing filename+error in description", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();

    // First call succeeds, second throws — exercises the partial-success branch
    // (succeeded > 0 && failures.length > 0).
    let callCount = 0;
    uploadReceiptStub = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) throw new Error("server rejected bad file");
    });

    await loadComponent();
    render(<DepositView />);

    const file1 = new File(["d1"], "good.png", { type: "image/png" });
    const file2 = new File(["d2"], "bad.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2]);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };

    // Must use the destructive variant just like the all-failure branch.
    expect(arg.variant).toBe("destructive");

    // Title: "Uploaded <succeeded> of <total>" — defaultValue template with
    // succeeded=1, total=2.
    expect(arg.title).toBe("Uploaded 1 of 2");

    // Description: "<failedFilename>: <errorMessage>" for each failure.
    expect(descText(arg.description)).toContain("bad.png");
    expect(descText(arg.description)).toContain("server rejected bad file");

    // The succeeded file must NOT appear in the description.
    expect(descText(arg.description)).not.toContain("good.png");
  });

  it("truncates the error list to 3 names when 4 files fail (3+ file partial-success batch)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();

    // File 1 succeeds; files 2, 3, and 4 all throw distinct errors so we can
    // assert each name independently.
    let callCount = 0;
    uploadReceiptStub = vi.fn(async (_caseId: string, file: File) => {
      callCount += 1;
      if (callCount >= 2) throw new Error(`err-${file.name}`);
    });

    await loadComponent();
    render(<DepositView />);

    const file1 = new File(["d1"], "succeed.png", { type: "image/png" });
    const file2 = new File(["d2"], "fail2.png", { type: "image/png" });
    const file3 = new File(["d3"], "fail3.png", { type: "image/png" });
    const file4 = new File(["d4"], "fail4.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2, file3, file4]);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };

    expect(arg.variant).toBe("destructive");

    // Title reflects 1 success out of 4 total.
    expect(arg.title).toBe("Uploaded 1 of 4");

    // The first three failure names must appear in the description.
    expect(descText(arg.description)).toContain("fail2.png");
    expect(descText(arg.description)).toContain("fail3.png");
    expect(descText(arg.description)).toContain("fail4.png");

    // The fourth failure (which would be index 3) is already included above;
    // what must NOT appear is the succeeded file.
    expect(descText(arg.description)).not.toContain("succeed.png");
  });

  it("omits the 4th failure name from description when exactly 4 files fail (slice boundary)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();

    // File 1 succeeds; files 2–5 throw, giving 4 failures.  Only the first 3
    // should appear in the toast description (.slice(0, 3)).
    let callCount = 0;
    uploadReceiptStub = vi.fn(async (_caseId: string, file: File) => {
      callCount += 1;
      if (callCount >= 2) throw new Error(`err-${file.name}`);
    });

    await loadComponent();
    render(<DepositView />);

    const file1 = new File(["d1"], "ok.png", { type: "image/png" });
    const file2 = new File(["d2"], "bad-a.png", { type: "image/png" });
    const file3 = new File(["d3"], "bad-b.png", { type: "image/png" });
    const file4 = new File(["d4"], "bad-c.png", { type: "image/png" });
    const file5 = new File(["d5"], "bad-d.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [file1, file2, file3, file4, file5]);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };

    expect(arg.variant).toBe("destructive");
    expect(arg.title).toBe("Uploaded 1 of 5");

    // First three failures must appear.
    expect(descText(arg.description)).toContain("bad-a.png");
    expect(descText(arg.description)).toContain("bad-b.png");
    expect(descText(arg.description)).toContain("bad-c.png");

    // Fourth failure name must be absent — truncated by .slice(0, 3).
    expect(descText(arg.description)).not.toContain("bad-d.png");

    // Succeeded file must also be absent.
    expect(descText(arg.description)).not.toContain("ok.png");
  });

  it("appends '…and 1 more' suffix when a 5-file batch has 4 failures (1 success + 4 failures)", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    currentCaseStub = caseFixture();

    let callCount = 0;
    uploadReceiptStub = vi.fn(async (_caseId: string, file: File) => {
      callCount += 1;
      if (callCount >= 2) throw new Error(`err-${file.name}`);
    });

    await loadComponent();
    render(<DepositView />);

    const files = [
      new File(["d1"], "pass.png", { type: "image/png" }),
      new File(["d2"], "fail-1.png", { type: "image/png" }),
      new File(["d3"], "fail-2.png", { type: "image/png" }),
      new File(["d4"], "fail-3.png", { type: "image/png" }),
      new File(["d5"], "fail-4.png", { type: "image/png" }),
    ];
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, files);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });

    const [call] = toastSpy.mock.calls;
    const arg = call[0] as { variant: string; title: string; description: string };

    expect(arg.variant).toBe("destructive");
    expect(arg.title).toBe("Uploaded 1 of 5");

    // First three failure names must appear.
    expect(descText(arg.description)).toContain("fail-1.png");
    expect(descText(arg.description)).toContain("fail-2.png");
    expect(descText(arg.description)).toContain("fail-3.png");

    // Fourth failure must be hidden, replaced by the trailing count.
    expect(descText(arg.description)).not.toContain("fail-4.png");

    // Trailing "…and 1 more" must appear (4 failures, 3 visible → 1 hidden).
    expect(descText(arg.description)).toContain("…and 1 more");

    // Succeeded file must be absent.
    expect(descText(arg.description)).not.toContain("pass.png");
  });
});
