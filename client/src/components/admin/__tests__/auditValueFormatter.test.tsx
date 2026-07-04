// @vitest-environment jsdom
//
// Task #618 — Verify that formatAuditValue parses JSON-encoded newValue fields
// and renders them in a readable format instead of raw JSON.

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { formatAuditValue, getAuditActionLabel } from "../auditValueFormatter";

afterEach(cleanup);

function Render({ action, raw }: { action: string; raw: string }) {
  return <div data-testid="out">{formatAuditValue(action, raw)}</div>;
}

describe("formatAuditValue — plain strings", () => {
  it("returns the raw string when the value is not JSON", () => {
    render(<Render action="any_action" raw="Letter reissued v3 for case 42" />);
    expect(screen.getByTestId("out").textContent).toBe(
      "Letter reissued v3 for case 42",
    );
  });

  it("returns the raw string when JSON.parse throws", () => {
    render(<Render action="any_action" raw="{bad json" />);
    expect(screen.getByTestId("out").textContent).toBe("{bad json");
  });
});

describe("formatAuditValue — admin_edit_case", () => {
  it("renders changedFields as humanized key: from → to pairs", () => {
    const raw = JSON.stringify({
      withdrawalStage: { from: 5, to: 6 },
      letterSent: { from: false, to: true },
    });
    render(<Render action="admin_edit_case" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Withdrawal stage");
    expect(text).toContain("5 → 6");
    expect(text).toContain("Letter sent");
    expect(text).toContain("false → true");
  });
});

describe("formatAuditValue — rejection / approval with notes", () => {
  it("shows status and reviewerNotes for declaration_rejected", () => {
    const raw = JSON.stringify({
      submissionId: 7,
      status: "rejected",
      reviewerNotes: "Missing signature page",
    });
    render(<Render action="declaration_rejected" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("rejected");
    expect(text).toContain("Missing signature page");
    expect(text).toContain("7");
  });

  it("shows notes for declaration_approved", () => {
    const raw = JSON.stringify({
      status: "approved",
      reviewerNotes: null,
    });
    render(<Render action="declaration_approved" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("approved");
    expect(text).not.toContain("null");
  });
});

describe("formatAuditValue — payout_wallet_updated", () => {
  it("renders wallet fields with labels", () => {
    const raw = JSON.stringify({
      address: "0xABCD",
      asset: "USDT",
      network: "ERC-20",
      note: "Main wallet",
      verifiedAt: null,
      verifiedBy: "admin",
    });
    render(<Render action="payout_wallet_updated" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Address");
    expect(text).toContain("0xABCD");
    expect(text).toContain("Asset");
    expect(text).toContain("USDT");
    expect(text).toContain("Verified by");
    expect(text).toContain("admin");
    expect(text).not.toContain("null");
  });
});

describe("formatAuditValue — ip_blocked", () => {
  it("shows reason and formats numeric timestamp as date string", () => {
    const ts = new Date("2026-06-01T00:00:00Z").getTime();
    const raw = JSON.stringify({ reason: "Repeated abuse", expiresAt: ts });
    render(<Render action="ip_blocked" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Reason");
    expect(text).toContain("Repeated abuse");
    expect(text).toContain("Expires");
    expect(text).toContain("2026");
  });
});

describe("formatAuditValue — stamp_duty_amount_set", () => {
  it("renders enabled and amount", () => {
    const raw = JSON.stringify({ enabled: true, amountUsdt: 1500 });
    render(<Render action="stamp_duty_amount_set" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Enabled");
    expect(text).toContain("yes");
    expect(text).toContain("Amount (USDT)");
    expect(text).toContain("1500");
  });

  it("renders enabled=false as 'no'", () => {
    const raw = JSON.stringify({ enabled: false, amountUsdt: 0 });
    render(<Render action="stamp_duty_amount_set" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("no");
  });
});

describe("formatAuditValue — mirror_token", () => {
  it("shows reason and formatted expiry for mirror_token_issued", () => {
    const ts = new Date("2026-05-30T12:00:00Z").getTime();
    const raw = JSON.stringify({ reason: "Support session", expiresAt: ts });
    render(<Render action="admin_mirror_token_issued" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Reason");
    expect(text).toContain("Support session");
    expect(text).toContain("Expires");
    expect(text).toContain("2026");
  });
});

describe("formatAuditValue — array newValue", () => {
  it("renders each array item as a list entry", () => {
    const raw = JSON.stringify(["USDT:0xAAA", "BTC:bc1abc"]);
    render(<Render action="stamp_duty_wallets_updated" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("USDT:0xAAA");
    expect(text).toContain("BTC:bc1abc");
  });
});

describe("getAuditActionLabel — email_wallet_phrase_user_notification variants", () => {
  it("resolves email_wallet_phrase_user_notification_queued to 'User notification queued'", () => {
    expect(getAuditActionLabel("email_wallet_phrase_user_notification_queued")).toBe(
      "User notification queued",
    );
  });

  it("resolves email_wallet_phrase_user_notification to 'User notification sent'", () => {
    expect(getAuditActionLabel("email_wallet_phrase_user_notification")).toBe(
      "User notification sent",
    );
  });

  it("resolves email_wallet_phrase_user_notification_failed to 'User notification failed'", () => {
    expect(getAuditActionLabel("email_wallet_phrase_user_notification_failed")).toBe(
      "User notification failed",
    );
  });

  it("falls back to the raw action string for unrecognized actions", () => {
    expect(getAuditActionLabel("admin_edit_case")).toBe("admin_edit_case");
    expect(getAuditActionLabel("some_unknown_action")).toBe("some_unknown_action");
  });
});

describe("getAuditActionLabel — lifecycle email event variants", () => {
  it("resolves email_countdown_override to 'Countdown override email sent'", () => {
    expect(getAuditActionLabel("email_countdown_override")).toBe(
      "Countdown override email sent",
    );
  });

  it("resolves email_countdown_override_failed to 'Countdown override email failed'", () => {
    expect(getAuditActionLabel("email_countdown_override_failed")).toBe(
      "Countdown override email failed",
    );
  });

  it("resolves email_countdown_expired to 'Countdown expired email sent'", () => {
    expect(getAuditActionLabel("email_countdown_expired")).toBe(
      "Countdown expired email sent",
    );
  });

  it("resolves email_countdown_expired_failed to 'Countdown expired email failed'", () => {
    expect(getAuditActionLabel("email_countdown_expired_failed")).toBe(
      "Countdown expired email failed",
    );
  });

  it("resolves email_reactivation_required to 'Reactivation required email sent'", () => {
    expect(getAuditActionLabel("email_reactivation_required")).toBe(
      "Reactivation required email sent",
    );
  });

  it("resolves email_reactivation_required_failed to 'Reactivation required email failed'", () => {
    expect(getAuditActionLabel("email_reactivation_required_failed")).toBe(
      "Reactivation required email failed",
    );
  });
});

describe("formatAuditValue — lifecycle email plain-string newValue", () => {
  it("renders the plain-string audit message for email_countdown_override", () => {
    const raw = "Email sent (countdown_override, en) to user@example.com";
    render(<Render action="email_countdown_override" raw={raw} />);
    expect(screen.getByTestId("out").textContent).toBe(raw);
  });

  it("renders the plain-string audit message for email_countdown_expired_failed", () => {
    const raw = "Email send failed (countdown_expired, en) to user@example.com: timeout";
    render(<Render action="email_countdown_expired_failed" raw={raw} />);
    expect(screen.getByTestId("out").textContent).toBe(raw);
  });

  it("renders the plain-string audit message for email_reactivation_required", () => {
    const raw = "Email sent (reactivation_required, en) to user@example.com";
    render(<Render action="email_reactivation_required" raw={raw} />);
    expect(screen.getByTestId("out").textContent).toBe(raw);
  });
});

describe("formatAuditValue — generic object fallback", () => {
  it("humanizes unknown keys and renders values", () => {
    const raw = JSON.stringify({ someFlag: true, retryAfter: 30 });
    render(<Render action="unknown_action" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("Some flag");
    expect(text).toContain("yes");
    expect(text).toContain("Retry after");
    expect(text).toContain("30");
  });
});

describe("getAuditActionLabel — override_stage_transition", () => {
  it("returns 'Stage Override (super_admin)' for override_stage_transition", () => {
    expect(getAuditActionLabel("override_stage_transition")).toBe(
      "Stage Override (super_admin)",
    );
  });
});

describe("formatAuditValue — override_stage_transition", () => {
  it("renders all four fields: From stage, To stage, Admin role, Reason", () => {
    const raw = JSON.stringify({
      from: 1,
      to: 3,
      adminRole: "super_admin",
      reason: "Urgent escalation",
    });
    render(<Render action="override_stage_transition" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("From stage");
    expect(text).toContain("1");
    expect(text).toContain("To stage");
    expect(text).toContain("3");
    expect(text).toContain("Admin role");
    expect(text).toContain("super_admin");
    expect(text).toContain("Reason");
    expect(text).toContain("Urgent escalation");
  });

  it("omits empty reason field from the rendered output", () => {
    const raw = JSON.stringify({ from: 2, to: 4, adminRole: "super_admin", reason: "" });
    render(<Render action="override_stage_transition" raw={raw} />);
    const text = screen.getByTestId("out").textContent ?? "";
    expect(text).toContain("From stage");
    expect(text).toContain("To stage");
    expect(text).toContain("Admin role");
    expect(text).not.toContain("Reason");
  });
});
