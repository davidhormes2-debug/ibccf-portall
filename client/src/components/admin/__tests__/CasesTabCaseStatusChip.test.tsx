// @vitest-environment jsdom
//
// Case-status chip — exhaustiveness guard tests for CasesTab.
//
// Contracts verified:
//   1. CASE_STATUS_CLASSES (exported from CasesTab) has an entry for every
//      member of Case["status"] so TypeScript's Record<CaseStatusActive, string>
//      constraint is enforced at runtime too.
//   2. The badge ternary chain in CasesTab.tsx has an explicit branch for
//      every Case["status"] value so a new union member cannot silently fall
//      through to the assertNeverCaseStatus guard without being noticed at
//      code-review time.
//   3. Every known case status renders a badge with data-testid
//      "badge-case-status-<id>" and the expected CSS class.

import React from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { CASE_STATUS_CLASSES } from "../tabs/CasesTab";
import { buildMockAdminDashboardContext } from "./mockAdminDashboardContext";
import type { AdminDashboardContextValue } from "@/components/admin/AdminDashboardContext";
import type { Case } from "@/components/admin/shared";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

let mockContextFactory: () => AdminDashboardContextValue;

vi.mock("@/components/admin/AdminDashboardContext", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/AdminDashboardContext")
  >();
  return {
    ...actual,
    useAdminDashboard: () => mockContextFactory(),
  };
});

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

// ---------------------------------------------------------------------------
// Canonical list of all known case statuses.
// When a new status is added to Case["status"] in shared.tsx, TypeScript
// will require CASE_STATUS_CLASSES to be updated (compile error), AND this
// array must also be updated (test failure) — two independent signals.
// ---------------------------------------------------------------------------
const ALL_CASE_STATUSES: Case["status"][] = [
  "created",
  "registered",
  "syncing",
  "active",
  "completed",
  "sealed",
];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
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
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }) as unknown as Response,
      ),
    );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

import { CasesTab } from "../tabs/CasesTab";

async function waitForTabMount() {
  await waitFor(() =>
    expect(screen.getByTestId("button-new-case")).toBeTruthy(),
  );
}

function makeCase(status: Case["status"]): Case {
  return {
    id: "test-case-1",
    accessCode: "TESTCODE",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function buildContext(status: Case["status"]): AdminDashboardContextValue {
  const c = makeCase(status);
  return buildMockAdminDashboardContext({
    cases: [c],
    filteredCases: [c],
  });
}

// ---------------------------------------------------------------------------
// Static structure tests — no rendering needed
// ---------------------------------------------------------------------------
describe("CASE_STATUS_CLASSES — exhaustiveness guard", () => {
  it("has a non-empty CSS class string for every Case['status'] member", () => {
    for (const status of ALL_CASE_STATUSES) {
      const cls = CASE_STATUS_CLASSES[status];
      expect(
        cls,
        `CASE_STATUS_CLASSES is missing an entry for status "${status}"`,
      ).toBeTruthy();
      expect(typeof cls).toBe("string");
    }
  });

  it("has no extra keys beyond ALL_CASE_STATUSES", () => {
    const recordKeys = Object.keys(CASE_STATUS_CLASSES).sort();
    expect(recordKeys).toEqual([...ALL_CASE_STATUSES].sort());
  });
});

// ---------------------------------------------------------------------------
// Source-code guard — verifies the ternary chain in CasesTab covers every
// case status and includes the assertNeverCaseStatus final-else guard.
// ---------------------------------------------------------------------------
describe("CasesTab case-status chip ternary chain — source completeness", () => {
  it("has an explicit branch for every Case['status'] in the badge ternary", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../tabs/CasesTab.tsx"),
      "utf8",
    );

    const anchorIdx = src.indexOf('data-testid={`badge-case-status-');
    expect(
      anchorIdx,
      'data-testid={`badge-case-status-…`} not found in CasesTab.tsx',
    ).toBeGreaterThan(-1);

    const badgeOpen = src.lastIndexOf("<Badge", anchorIdx);
    expect(
      badgeOpen,
      "<Badge not found before badge-case-status testid",
    ).toBeGreaterThan(-1);

    const badgeClose = src.indexOf("</Badge>", badgeOpen);
    expect(
      badgeClose,
      "</Badge> not found after <Badge for case-status chip",
    ).toBeGreaterThan(-1);

    const chipBlock = src.slice(badgeOpen, badgeClose);

    for (const status of ALL_CASE_STATUSES) {
      expect(
        chipBlock.includes(`c.status === '${status}'`),
        `Badge ternary chain is missing a branch for status "${status}"`,
      ).toBe(true);
    }

    expect(
      chipBlock.includes("assertNeverCaseStatus"),
      "assertNeverCaseStatus guard missing from badge ternary chain",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime rendering — each known status renders a badge with the correct
// data-testid and a CSS class from CASE_STATUS_CLASSES.
// ---------------------------------------------------------------------------
describe("CasesTab case-status badge — renders correct class per status", () => {
  for (const status of ALL_CASE_STATUSES) {
    it(`renders badge with expected class for status "${status}"`, async () => {
      mockContextFactory = () => buildContext(status);

      render(<CasesTab />);
      await waitForTabMount();

      const badge = await waitFor(() => {
        const el = screen.getByTestId("badge-case-status-test-case-1");
        expect(el).toBeTruthy();
        return el;
      });

      const expectedClass = CASE_STATUS_CLASSES[status];
      expect(badge.className).toContain(
        expectedClass.split(" ")[0],
        `Badge for status "${status}" did not receive expected CSS class`,
      );
    });
  }
});
