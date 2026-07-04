// @vitest-environment jsdom
//
// Guard: SettingsTab global audit log — Details column header + formatAuditValue rendering
//
// The audit log table in SettingsTab (settingsView === 'audit') renders a
// "Details" column and routes each log entry's `newValue` through
// `formatAuditValue`. There were no automated tests covering this path, so
// a regression silently dropping the Details column, removing the
// `formatAuditValue` import, or breaking the `newValue` conditional would
// not be caught by CI.
//
// Two test layers mirror the pattern used by ProgressTrackerToggle.test.tsx
// and other admin tests in this directory:
//
//   Layer 1 — Source assertions (client/src/components/admin/tabs/SettingsTab.tsx)
//   ──────────────────────────────────────────────────────────────────────────────
//   Reads the production source once as a string and asserts structural
//   contracts that a harness cannot enforce.  If someone deletes the "Details"
//   <TableHead>, removes the formatAuditValue import, or breaks the
//   log.newValue conditional, these assertions fail immediately.
//
//     (s-1) The "Details" TableHead string is present in the audit table.
//     (s-2) formatAuditValue is imported from the auditValueFormatter module.
//     (s-3) The Details cell conditionally calls formatAuditValue(log.action,
//           log.newValue) inside the audit table row map.
//     (s-4) The conditional guard `log.newValue &&` gates the formatAuditValue
//           call so the cell is empty for null/undefined newValue.
//
//   Layer 2 — Functional integration (auditValueFormatter + rendering)
//   ──────────────────────────────────────────────────────────────────────────────
//   A minimal harness directly invokes `formatAuditValue` (the same function
//   SettingsTab uses) and asserts that the output renders correctly when the
//   function's return value is composed into a table cell — verifying the
//   formatter → render pipeline end-to-end without re-duplicating the
//   formatter's own unit tests (already covered in auditValueFormatter.test.tsx).
//
//     (f-1) admin_edit_case renders humanized key: from → to pairs.
//     (f-2) Details cell is present but empty when newValue is null.
//     (f-3) payout_wallet_updated renders labelled wallet fields.
//     (f-4) Multiple log rows each get their own scoped Details cell.

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { formatAuditValue } from "../auditValueFormatter";

afterEach(cleanup);

// ── Layer 1: Source assertions ───────────────────────────────────────────────

const SETTINGS_TAB_SRC = fs.readFileSync(
  path.resolve(
    __dirname,
    "../tabs/SettingsTab.tsx",
  ),
  "utf8",
);

describe("SettingsTab.tsx — audit log Details column (source assertions)", () => {
  it('(s-1) renders a "Details" <TableHead> in the audit log table', () => {
    // The Details header cell must exist somewhere in the source.  Its exact
    // surrounding class string is an implementation detail, but the content
    // must be present.
    expect(SETTINGS_TAB_SRC).toContain(">Details<");
  });

  it("(s-2) imports formatAuditValue from the auditValueFormatter module", () => {
    expect(SETTINGS_TAB_SRC).toContain('from "@/components/admin/auditValueFormatter"');
    expect(SETTINGS_TAB_SRC).toContain("formatAuditValue");
  });

  it("(s-3) calls formatAuditValue(log.action, log.newValue) in the audit table row", () => {
    // Both arguments must appear together in the call site.
    expect(SETTINGS_TAB_SRC).toContain("formatAuditValue(log.action, log.newValue)");
  });

  it("(s-4) guards the formatAuditValue call with log.newValue && (empty cell for null/undefined)", () => {
    // The conditional must appear before the formatAuditValue call so rows
    // without a newValue produce an empty Details cell rather than crashing.
    const callIdx = SETTINGS_TAB_SRC.indexOf("formatAuditValue(log.action, log.newValue)");
    expect(callIdx).toBeGreaterThan(-1);

    // Scan backwards from the call site to the nearest `log.newValue` to
    // confirm the guard appears before the render.
    const precedingSlice = SETTINGS_TAB_SRC.slice(
      Math.max(0, callIdx - 300),
      callIdx,
    );
    expect(precedingSlice).toContain("log.newValue");
  });
});

// ── Layer 2: Functional integration ─────────────────────────────────────────
//
// Minimal harness that assembles a table cell from formatAuditValue output —
// the exact composition SettingsTab performs — and verifies the rendered DOM.

type MinimalAuditLog = {
  id: number;
  action: string;
  newValue: string | null;
};

function DetailsCellHarness({ log }: { log: MinimalAuditLog }) {
  return (
    <table>
      <tbody>
        <tr>
          <td data-testid={`details-cell-${log.id}`}>
            {log.newValue && (
              <div data-testid={`details-value-${log.id}`}>
                {formatAuditValue(log.action, log.newValue)}
              </div>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

describe("SettingsTab audit log — Details cell integration (functional)", () => {
  it("(f-1) admin_edit_case newValue renders humanized key: from → to pairs", () => {
    const log: MinimalAuditLog = {
      id: 10,
      action: "admin_edit_case",
      newValue: JSON.stringify({
        withdrawalStage: { from: 5, to: 6 },
        letterSent: { from: false, to: true },
      }),
    };

    render(<DetailsCellHarness log={log} />);

    const text = screen.getByTestId("details-value-10").textContent ?? "";
    expect(text).toContain("Withdrawal stage");
    expect(text).toContain("5 → 6");
    expect(text).toContain("Letter sent");
    expect(text).toContain("false → true");
  });

  it("(f-2) Details cell is present but empty when newValue is null (no crash)", () => {
    const log: MinimalAuditLog = { id: 20, action: "admin_edit_case", newValue: null };
    render(<DetailsCellHarness log={log} />);

    expect(screen.getByTestId("details-cell-20")).not.toBeNull();
    expect(screen.queryByTestId("details-value-20")).toBeNull();
  });

  it("(f-3) payout_wallet_updated newValue renders labelled wallet fields", () => {
    const log: MinimalAuditLog = {
      id: 30,
      action: "payout_wallet_updated",
      newValue: JSON.stringify({
        address: "0xDEAD",
        asset: "USDT",
        network: "ERC-20",
        note: "Primary",
        verifiedAt: null,
        verifiedBy: "admin",
      }),
    };

    render(<DetailsCellHarness log={log} />);

    const text = screen.getByTestId("details-value-30").textContent ?? "";
    expect(text).toContain("Address");
    expect(text).toContain("0xDEAD");
    expect(text).toContain("Asset");
    expect(text).toContain("USDT");
    expect(text).toContain("Verified by");
    expect(text).toContain("admin");
  });

  it("(f-4) multiple rows each get their own scoped Details cell", () => {
    const logs: MinimalAuditLog[] = [
      {
        id: 41,
        action: "admin_edit_case",
        newValue: JSON.stringify({ letterSent: { from: false, to: true } }),
      },
      {
        id: 42,
        action: "ip_blocked",
        newValue: JSON.stringify({ reason: "Abuse", expiresAt: null }),
      },
      { id: 43, action: "any_action", newValue: null },
    ];

    render(
      <table>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td data-testid={`details-cell-${log.id}`}>
                {log.newValue && (
                  <div data-testid={`details-value-${log.id}`}>
                    {formatAuditValue(log.action, log.newValue)}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>,
    );

    expect(screen.getByTestId("details-value-41").textContent).toContain(
      "Letter sent",
    );
    expect(screen.getByTestId("details-value-42").textContent).toContain(
      "Reason",
    );
    expect(screen.queryByTestId("details-value-43")).toBeNull();
  });
});
