import React from "react";

function humanKey(k: string): string {
  return k
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

function formatLeaf(_key: string, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" && v > 978_307_200_000) {
    return new Date(v).toLocaleString();
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString();
  }
  if (typeof v === "object") {
    const nested = v as Record<string, unknown>;
    if ("from" in nested && "to" in nested) {
      const from =
        nested.from === null || nested.from === undefined
          ? "—"
          : String(nested.from);
      const to =
        nested.to === null || nested.to === undefined
          ? "—"
          : String(nested.to);
      return `${from} → ${to}`;
    }
    return JSON.stringify(v);
  }
  return String(v);
}

function KVList({
  pairs,
}: {
  pairs: Array<[string, unknown]>;
}): React.ReactElement {
  const visible = pairs.filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (visible.length === 0) {
    return <span className="italic text-slate-500">no details</span>;
  }
  return (
    <dl className="space-y-0.5">
      {visible.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="flex gap-1.5 flex-wrap">
          <dt className="text-slate-400 shrink-0 select-none">{k}:</dt>
          <dd className="text-slate-200 break-all">{formatLeaf(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // wallet-phrase notification (walletConnectAlert.ts)
  email_wallet_phrase_user_notification: "User notification sent",
  email_wallet_phrase_user_notification_queued: "User notification queued",
  email_wallet_phrase_user_notification_failed: "User notification failed",
  // misc
  override_stage_transition: "Stage Override (super_admin)",
  // emergency admin credential recovery ("Locked out?" flow)
  admin_emergency_reset_requested: "Emergency reset requested",
  admin_emergency_reset_used: "Emergency reset completed",
  // countdown / reactivation lifecycle emails (cases.ts, portal-warning-expiry-sweep.ts)
  email_countdown_override: "Countdown override email sent",
  email_countdown_override_failed: "Countdown override email failed",
  email_countdown_expired: "Countdown expired email sent",
  email_countdown_expired_failed: "Countdown expired email failed",
  email_reactivation_required: "Reactivation required email sent",
  email_reactivation_required_failed: "Reactivation required email failed",
  // direct action strings from cases.ts
  email_admin_new_case: "Admin new-case notification sent",
  email_admin_new_case_failed: "Admin new-case notification failed",
  email_account_reactivation: "Account reactivation email sent",
  email_account_reactivation_failed: "Account reactivation email failed",
  email_portal_warning: "Portal warning email sent",
  email_portal_warning_failed: "Portal warning email failed",
  email_custom: "Custom email sent",
  email_custom_failed: "Custom email failed",
  email_stage_instructions: "Stage instructions email sent",
  email_stage_instructions_failed: "Stage instructions email failed",
  email_access_code: "Access code email sent",
  email_access_code_failed: "Access code email failed",
  // sendCaseEmailWithAudit tags from cases.ts
  "email_declaration-scan-alert": "Declaration scan alert sent",
  "email_declaration-scan-alert_failed": "Declaration scan alert failed",
  email_case_created: "Case created email sent",
  email_case_created_failed: "Case created email failed",
  "email_letter-ready": "Letter ready email sent",
  "email_letter-ready_failed": "Letter ready email failed",
  email_token_wallet_setup_link_sent: "Token wallet setup link sent",
  email_token_wallet_setup_link_sent_failed: "Token wallet setup link failed",
  "email_wallet-exchange-selected": "Wallet exchange selected email sent",
  "email_wallet-exchange-selected_failed": "Wallet exchange selected email failed",
  email_phrase_code_notice: "Phrase code notice sent",
  email_phrase_code_notice_failed: "Phrase code notice failed",
  email_settlement_sealed: "Settlement sealed email sent",
  email_settlement_sealed_failed: "Settlement sealed email failed",
  email_certificate_fee_received: "Certificate fee received email sent",
  email_certificate_fee_received_failed: "Certificate fee received email failed",
  email_certificate_unlocked: "Certificate unlocked email sent",
  email_certificate_unlocked_failed: "Certificate unlocked email failed",
  email_certificate_fee_rejected: "Certificate fee rejected email sent",
  email_certificate_fee_rejected_failed: "Certificate fee rejected email failed",
  email_stamp_duty_received: "Stamp duty received email sent",
  email_stamp_duty_received_failed: "Stamp duty received email failed",
  email_stamp_duty_approved: "Stamp duty approved email sent",
  email_stamp_duty_approved_failed: "Stamp duty approved email failed",
  email_stamp_duty_rejected: "Stamp duty rejected email sent",
  email_stamp_duty_rejected_failed: "Stamp duty rejected email failed",
};

export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function formatAuditValue(
  action: string,
  raw: string,
): React.ReactNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return String(parsed);
  }

  if (Array.isArray(parsed)) {
    return (
      <ul className="list-disc list-inside space-y-0.5">
        {(parsed as unknown[]).map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (action === "admin_edit_case") {
    return (
      <KVList
        pairs={Object.entries(obj).map(([k, v]) => [humanKey(k), v])}
      />
    );
  }

  if (action === "payout_wallet_set" || action === "payout_wallet_updated") {
    return (
      <KVList
        pairs={[
          ["Address", obj.address],
          ["Asset", obj.asset],
          ["Network", obj.network],
          ["Note", obj.note],
          ["Verified at", obj.verifiedAt],
          ["Verified by", obj.verifiedBy],
        ]}
      />
    );
  }

  if (action.includes("rejected") || action.includes("approved")) {
    const pairs: Array<[string, unknown]> = [];
    if (obj.status !== undefined) pairs.push(["Status", obj.status]);
    if (obj.reason !== undefined) pairs.push(["Reason", obj.reason]);
    if (obj.reviewerNotes !== undefined)
      pairs.push(["Notes", obj.reviewerNotes]);
    if (obj.adminNotes !== undefined) pairs.push(["Notes", obj.adminNotes]);
    if (obj.submissionId !== undefined)
      pairs.push(["Submission ID", obj.submissionId]);
    if (pairs.length > 0) return <KVList pairs={pairs} />;
  }

  if (action.includes("mirror_token")) {
    return (
      <KVList
        pairs={[
          ["Reason", obj.reason],
          ["Expires", obj.expiresAt],
          ["Issuer IP", obj.issuerIp],
          ["Expired", obj.expired],
        ]}
      />
    );
  }

  if (action === "ip_blocked") {
    return (
      <KVList
        pairs={[
          ["Reason", obj.reason],
          ["Expires", obj.expiresAt],
        ]}
      />
    );
  }

  if (action === "stamp_duty_amount_set") {
    return (
      <KVList
        pairs={[
          ["Enabled", obj.enabled],
          ["Amount (USDT)", obj.amountUsdt],
        ]}
      />
    );
  }

  if (action === "override_stage_transition") {
    return (
      <KVList
        pairs={[
          ["From stage", obj.from],
          ["To stage", obj.to],
          ["Admin role", obj.adminRole],
          ["Reason", obj.reason],
        ]}
      />
    );
  }

  return (
    <KVList pairs={Object.entries(obj).map(([k, v]) => [humanKey(k), v])} />
  );
}
