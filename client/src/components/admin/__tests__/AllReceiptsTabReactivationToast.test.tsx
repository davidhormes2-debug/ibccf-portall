// @vitest-environment jsdom
//
// Regression guard: the reviewReceipt function in AllReceiptsTab parses the
// PATCH/POST response for `accountReactivated: true` and fires a rich "Account
// Reactivated" toast instead of the generic "Receipt updated" one.
//
// Contracts verified for each source (deposit, certificate, stamp_duty):
//   1. `accountReactivated: true` + `hasEmail: true`  → toast with access code
//      and email-delivery wording.
//   2. `accountReactivated: true` + `hasEmail: false` → toast with manual-share
//      wording (no email on file).  [deposit path only — shared branch]
//   3. `accountReactivated` absent (undefined/false)  → generic "Receipt updated"
//      toast fires instead.
//
// The certificate and stamp_duty paths both POST to different URLs but share the
// same response-parsing branch.  

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const mockToast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("../AdminDashboardContext", () => ({
  useAdminDashboard: () => ({
    adminRole: "super_admin",
    loadReactivationPendingCounts: vi.fn(),
  }),
}));

import { AllReceiptsTab } from "../AllReceiptsTab";

const PENDING_REACTIVATION_ROW = {
  source: "deposit" as const,
  id: 77,
  caseId: "case-reactivation",
  accessCode: "OLD123",
  category: "reissue" as const,
  status: "pending" as const,
  fileName: "reactivation-receipt.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "500",
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-06-01T10:00:00.000Z",
};

const CERT_REACTIVATION_ROW = {
  source: "certificate" as const,
  id: 101,
  caseId: "case-reactivation",
  accessCode: "OLD123",
  category: "reissue" as const,
  status: "pending" as const,
  fileName: "cert-receipt.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "300",
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-06-01T10:00:00.000Z",
};

const STAMP_REACTIVATION_ROW = {
  source: "stamp_duty" as const,
  id: 202,
  caseId: "case-reactivation",
  accessCode: "OLD123",
  category: "reissue" as const,
  status: "pending" as const,
  fileName: "stamp-receipt.pdf",
  notes: null,
  adminNotes: null,
  amountUsdt: "200",
  reissueId: null,
  reviewedAt: null,
  reviewedBy: null,
  uploadedAt: "2026-06-01T10:00:00.000Z",
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockToast.mockReset();
  (globalThis as any).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this._ as Map<string, string>).get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this._ as Map<string, string>).set(k, String(v));
    },
    removeItem(k: string) {
      (this._ as Map<string, string>).delete(k);
    },
    clear() {
      (this._ as Map<string, string>).clear();
    },
  };
  sessionStorage.setItem("adminToken", "test-token");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AllReceiptsTab — reactivation approval toast", () => {
  it("shows 'Account Reactivated' toast with access code and email wording when hasEmail=true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_REACTIVATION_ROW]))
      .mockResolvedValueOnce(
        jsonOk({ accountReactivated: true, newAccessCode: "ABC123", hasEmail: true }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-deposit-77");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string; duration?: number };
    expect(arg.title).toBe("Account Reactivated");
    expect(arg.description).toContain("ABC123");
    expect(arg.description).toContain("being emailed");
    expect(arg.duration).toBe(12000);
  });

  it("shows 'Account Reactivated' toast with manual-share wording when hasEmail=false", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([PENDING_REACTIVATION_ROW]))
      .mockResolvedValueOnce(
        jsonOk({ accountReactivated: true, newAccessCode: "XYZ789", hasEmail: false }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-deposit-77");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string; duration?: number };
    expect(arg.title).toBe("Account Reactivated");
    expect(arg.description).toContain("XYZ789");
    expect(arg.description).toContain("manually");
    expect(arg.duration).toBe(12000);
  });

  it("shows generic 'Receipt updated' toast when accountReactivated is absent", async () => {
    const NON_REACTIVATION_ROW = {
      ...PENDING_REACTIVATION_ROW,
      id: 88,
      category: "activation" as const,
      reissueId: null,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([NON_REACTIVATION_ROW]))
      .mockResolvedValueOnce(jsonOk({ success: true }));
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-deposit-88");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string };
    expect(arg.title).toBe("Receipt updated");
    expect(arg.description).toContain("approved");
  });
});

describe("AllReceiptsTab — reactivation approval toast (certificate source)", () => {
  it("shows 'Account Reactivated' toast when certificate POST returns accountReactivated=true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([CERT_REACTIVATION_ROW]))
      .mockResolvedValueOnce(
        jsonOk({ accountReactivated: true, newAccessCode: "CERT01", hasEmail: true }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-certificate-101");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string; duration?: number };
    expect(arg.title).toBe("Account Reactivated");
    expect(arg.description).toContain("CERT01");
    expect(arg.description).toContain("being emailed");
    expect(arg.duration).toBe(12000);
  });

  it("shows generic 'Receipt updated' toast for a non-reactivation certificate approval", async () => {
    const NON_REACT_CERT = {
      ...CERT_REACTIVATION_ROW,
      id: 102,
      category: "activation" as const,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([NON_REACT_CERT]))
      .mockResolvedValueOnce(jsonOk({ success: true }));
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-certificate-102");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string };
    expect(arg.title).toBe("Receipt updated");
    expect(arg.description).toContain("approved");
  });
});

describe("AllReceiptsTab — reactivation approval toast (stamp_duty source)", () => {
  it("shows 'Account Reactivated' toast when stamp-duty POST returns accountReactivated=true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([STAMP_REACTIVATION_ROW]))
      .mockResolvedValueOnce(
        jsonOk({ accountReactivated: true, newAccessCode: "STAMP99", hasEmail: true }),
      );
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-stamp_duty-202");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string; duration?: number };
    expect(arg.title).toBe("Account Reactivated");
    expect(arg.description).toContain("STAMP99");
    expect(arg.description).toContain("being emailed");
    expect(arg.duration).toBe(12000);
  });

  it("shows generic 'Receipt updated' toast for a non-reactivation stamp-duty approval", async () => {
    const NON_REACT_STAMP = {
      ...STAMP_REACTIVATION_ROW,
      id: 203,
      category: "activation" as const,
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonOk([NON_REACT_STAMP]))
      .mockResolvedValueOnce(jsonOk({ success: true }));
    (globalThis as any).fetch = fetchMock;

    render(<AllReceiptsTab />);

    const approveBtn = await screen.findByTestId("btn-all-receipts-approve-stamp_duty-203");
    fireEvent.click(approveBtn);

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const [call] = mockToast.mock.calls;
    const arg = call[0] as { title: string; description: string };
    expect(arg.title).toBe("Receipt updated");
    expect(arg.description).toContain("approved");
  });
});
