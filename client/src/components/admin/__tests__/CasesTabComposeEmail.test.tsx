// @vitest-environment jsdom
//
// Covers the "Send Email…" DropdownMenuItem added to CasesTab's Manage dropdown
// (Communication group).  Three contracts are verified:
//
//   1. The item is present for a case that has a userEmail address.
//   2. Clicking the item calls openSendEmailDialog with ONLY the case object
//      — no pre-filled subject or body — so the compose dialog opens blank.
//   3. The item is absent for a case that has no email address.
//
// Radix DropdownMenu requires pointer-event sequences that jsdom does not
// support, so we stub the Radix primitives to render their children
// unconditionally (as if the menu is always open).  This keeps the test
// focused on CasesTab's own conditional rendering + handler wiring.

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

// ── mock use-toast so shadcn toasts don't throw ──────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── stub shadcn DropdownMenu so content is always rendered (jsdom has no ──────
// pointer-capture / pointer-event APIs required to open real Radix menus).
// We mock the shadcn UI wrapper (the import path CasesTab actually uses) so
// the underlying Radix context chain is never entered.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  DropdownMenuPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-dropdown-content="">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    [key: string]: unknown;
  }) => (
    <div role="menuitem" onClick={onClick} {...rest}>
      {children}
    </div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({
    children,
    ...rest
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <div {...rest}>{children}</div>,
  DropdownMenuSubContent: ({
    children,
    ...rest
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <div {...rest}>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuCheckboxItem: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
    [key: string]: unknown;
  }) => <div role="menuitem" onClick={onClick} {...rest}>{children}</div>,
  DropdownMenuRadioItem: ({
    children,
    ...rest
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <div role="menuitem" {...rest}>{children}</div>,
  DropdownMenuShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// ── track calls to openSendEmailDialog ────────────────────────────────────────
const openSendEmailDialogMock = vi.fn();

// ── mock AdminDashboardContext ────────────────────────────────────────────────
vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => buildMockContext(),
  };
});

// ── stub SupportingDocsQuickPopover (avoids Radix Popover / fetch side effects)
vi.mock("@/components/admin/SupportingDocsQuickPopover", () => ({
  SupportingDocsQuickPopover: ({
    caseId,
    count,
  }: {
    caseId: string;
    count: number;
    authToken: string | null;
    onActioned?: () => void;
  }) => (
    <span data-testid={`badge-user-doc-pending-${caseId}`}>
      {count} NEW UPLOADS
    </span>
  ),
}));

// ── case fixtures ──────────────────────────────────────────────────────────────
const CASE_WITH_EMAIL = {
  id: "case-with-email",
  accessCode: "MAIL0001",
  status: "active" as const,
  userEmail: "user@example.com",
  userName: "Alice",
};

const CASE_WITHOUT_EMAIL = {
  id: "case-no-email",
  accessCode: "NOML0001",
  status: "active" as const,
  userEmail: undefined,
  userName: "Bob",
};

// ── mock context builder ───────────────────────────────────────────────────────
function buildMockContext(): AdminDashboardContextValue {
  return buildMockAdminDashboardContext({
    cases: [CASE_WITH_EMAIL, CASE_WITHOUT_EMAIL] as unknown as Case[],
    filteredCases: [CASE_WITH_EMAIL, CASE_WITHOUT_EMAIL] as unknown as Case[],
    openSendEmailDialog: openSendEmailDialogMock,
  });
}

// ── fetch stub — silences on-mount effects that call admin APIs ───────────────
function notFoundResponse() {
  return Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response,
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  if (
    !(Element.prototype as unknown as { hasPointerCapture?: unknown })
      .hasPointerCapture
  ) {
    (
      Element.prototype as unknown as { hasPointerCapture: () => boolean }
    ).hasPointerCapture = () => false;
  }

  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    _: new Map<string, string>(),
    getItem(k: string) {
      return (this as { _: Map<string, string> })._.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      (this as { _: Map<string, string> })._.set(k, String(v));
    },
    removeItem(k: string) {
      (this as { _: Map<string, string> })._.delete(k);
    },
    clear() {
      (this as { _: Map<string, string> })._.clear();
    },
  };
  (
    globalThis as unknown as {
      sessionStorage: { setItem: (k: string, v: string) => void };
    }
  ).sessionStorage.setItem("adminToken", "test-token");

  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
    .fn()
    .mockImplementation(notFoundResponse);

  openSendEmailDialogMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── import under test (after all mocks are declared) ─────────────────────────
import { CasesTab } from "../tabs/CasesTab";

// ─────────────────────────────────────────────────────────────────────────────
describe("CasesTab – Send Email… menu item", () => {
  it("shows the Send Email… item when the case has a userEmail", async () => {
    render(<CasesTab />);

    await waitFor(() =>
      expect(
        screen.getByTestId(`menu-compose-email-${CASE_WITH_EMAIL.id}`),
      ).toBeTruthy(),
    );
  });

  it("calls openSendEmailDialog with only the case object when clicked (blank compose form)", async () => {
    render(<CasesTab />);

    const composeItem = await screen.findByTestId(
      `menu-compose-email-${CASE_WITH_EMAIL.id}`,
    );
    fireEvent.click(composeItem);

    // Must be called exactly once with only the case argument — no subject, no body.
    expect(openSendEmailDialogMock).toHaveBeenCalledTimes(1);
    const [caseArg, subjectArg, bodyArg] =
      openSendEmailDialogMock.mock.calls[0];
    expect(caseArg).toMatchObject({ id: CASE_WITH_EMAIL.id });
    expect(subjectArg).toBeUndefined();
    expect(bodyArg).toBeUndefined();
  });

  it("does NOT show the Send Email… item when the case has no email address", async () => {
    render(<CasesTab />);

    // Wait until the case row is mounted (the "Send Notification" item is
    // always rendered for every case regardless of email, so it serves as a
    // reliable anchor that the row is present in the DOM).
    await waitFor(() =>
      expect(
        screen.getByTestId(`menu-manage-${CASE_WITHOUT_EMAIL.id}`),
      ).toBeTruthy(),
    );

    expect(
      screen.queryByTestId(`menu-compose-email-${CASE_WITHOUT_EMAIL.id}`),
    ).toBeNull();
  });
});
