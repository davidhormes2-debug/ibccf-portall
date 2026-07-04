import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  AlertCircle,
  Image as ImageIcon,
  FolderLock,
  FileUp,
  Mail,
  Wallet,
  Undo2,
  ShieldAlert,
  KeyRound,
} from "lucide-react";

type MinimalCase = {
  id: string;
  status: string;
  withdrawalStage?: number | string | null;
  sealedAt?: Date | string | null;
  stampDutyEnabled?: boolean | null;
  stampDutyStatus?: string | null;
};

export type KpiFilterKey =
  | "open"
  | "awaiting_admin"
  | "pending_receipts"
  | "pending_reactivation"
  | "pending_documents"
  | "pending_uploads"
  | "pending_withdrawals"
  | "pending_refund_claims"
  | "failed_emails"
  | "legacy_access_codes";

type Props = {
  cases: MinimalCase[];
  documentRequestsPending: number;
  userDocPendingTotal: number;
  withdrawalPendingTotal: number;
  refundClaimPendingCount?: number;
  legacyAccessCodeCount?: number;
  authToken: string | null;
  onFilter?: (key: KpiFilterKey) => void;
};

type Kpi = {
  label: string;
  key: KpiFilterKey;
  value: number | string;
  description: string;
  icon: typeof Briefcase;
  accent: string;
};

export function CasesKpiStrip({ cases, documentRequestsPending, userDocPendingTotal, withdrawalPendingTotal, refundClaimPendingCount = 0, legacyAccessCodeCount = 0, authToken, onFilter }: Props) {
  const [pendingReceipts, setPendingReceipts] = useState<number | null>(null);
  const [pendingReactivation, setPendingReactivation] = useState<number | null>(null);
  const [failedEmails24h, setFailedEmails24h] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/deposits/all-receipts?status=pending&limit=200", {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        setPendingReceipts(items.length);
      } catch {
        /* swallow — KPI is best-effort */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/deposits/all-receipts?category=reactivation&status=pending", {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items = Array.isArray(data) ? data : [];
        setPendingReactivation(items.length);
      } catch {
        /* swallow — KPI is best-effort */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/email-delivery-alerts?windowHours=24", {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setFailedEmails24h(Number(data?.total ?? 0));
      } catch {
        /* swallow */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authToken]);

  const counts = useMemo(() => {
    const open = cases.filter((c) => c.status !== "completed").length;
    const awaitingAdmin = cases.filter(
      (c) =>
        c.status === "syncing" ||
        c.status === "registered" ||
        (c.stampDutyEnabled !== false && c.stampDutyStatus === "awaiting_admin_approval"),
    ).length;
    return { open, awaitingAdmin };
  }, [cases]);

  const kpis: Kpi[] = [
    {
      key: "open",
      label: "Open Cases",
      value: counts.open,
      description: "Total active cases in the system.",
      icon: Briefcase,
      accent: "#1a5f8a",
    },
    {
      key: "awaiting_admin",
      label: "Awaiting Admin",
      value: counts.awaitingAdmin,
      description: "Cases that need your attention.",
      icon: AlertCircle,
      accent: "#b45309",
    },
    {
      key: "pending_receipts",
      label: "Pending Receipts",
      value: pendingReceipts ?? "…",
      description: "Total pending receipt reviews.",
      icon: ImageIcon,
      accent: "#6d28d9",
    },
    ...(( pendingReactivation ?? 0) > 0
      ? [
          {
            key: "pending_reactivation" as KpiFilterKey,
            label: "Pending Reactivations",
            value: pendingReactivation as number,
            description: "Reactivation receipts from suspended accounts.",
            icon: ShieldAlert,
            accent: "#b91c1c",
          },
        ]
      : []),
    {
      key: "pending_documents",
      label: "Pending Documents",
      value: documentRequestsPending,
      description: "Total pending document submissions.",
      icon: FolderLock,
      accent: "#065f46",
    },
    {
      key: "pending_uploads",
      label: "Pending Uploads",
      value: userDocPendingTotal,
      description: "User-initiated supporting uploads awaiting review.",
      icon: FileUp,
      accent: "#0e7490",
    },
    {
      key: "pending_withdrawals",
      label: "Pending Withdrawals",
      value: withdrawalPendingTotal,
      description: "Withdrawal applications awaiting approval.",
      icon: Wallet,
      accent: withdrawalPendingTotal > 0 ? "#059669" : "#1e3a5f",
    },
    ...(refundClaimPendingCount > 0
      ? [
          {
            key: "pending_refund_claims" as KpiFilterKey,
            label: "Pending Refund Claims",
            value: refundClaimPendingCount,
            description: "Submitted refund claims awaiting review.",
            icon: Undo2,
            accent: "#b45309",
          },
        ]
      : []),
    {
      key: "failed_emails",
      label: "Failed Emails (24h)",
      value: failedEmails24h ?? "…",
      description: "Email delivery failures in the last 24 hours.",
      icon: Mail,
      accent: (failedEmails24h ?? 0) > 0 ? "#991b1b" : "#1e3a5f",
    },
    ...(legacyAccessCodeCount > 0
      ? [
          {
            key: "legacy_access_codes" as KpiFilterKey,
            label: "Legacy Access Codes",
            value: legacyAccessCodeCount,
            description: "Cases still using an alphanumeric (pre-digits-only) access code.",
            icon: KeyRound,
            accent: "#7c2d12",
          },
        ]
      : []),
  ];

  const extraTiles =
    (refundClaimPendingCount > 0 ? 1 : 0) +
    ((pendingReactivation ?? 0) > 0 ? 1 : 0) +
    (legacyAccessCodeCount > 0 ? 1 : 0);
  const colCount = 7 + extraTiles;

  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-3 ${colCount >= 8 ? "lg:grid-cols-4 xl:grid-cols-8" : "lg:grid-cols-7"} gap-4 mb-6`}
      data-testid="cases-kpi-strip"
    >
      {kpis.map((k) => {
        const Icon = k.icon;
        const clickable = !!onFilter;
        return (
          <button
            key={k.label}
            type="button"
            onClick={() => clickable && onFilter?.(k.key)}
            disabled={!clickable}
            className={`rounded-lg overflow-hidden flex flex-col text-left transition-transform border ${
              clickable ? "hover:scale-[1.02] cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/20" : "cursor-default"
            } ${
              k.key === "failed_emails"
                ? (failedEmails24h ?? 0) > 0
                  ? "border-rose-500/30"
                  : "border-blue-500/30"
                : "border-white/5"
            }`}
            style={{ background: "#0d3050" }}
            data-testid={`kpi-${k.key}`}
            aria-label={`Filter cases: ${k.label}`}
          >
            {/* Top section — icon + number + label */}
            <div className="p-4 flex-1 flex flex-col gap-1">
              <div className="flex items-start justify-between mb-1">
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: k.accent }}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="text-3xl font-bold text-white leading-none">
                {k.value}
              </div>
              <div
                className="text-sm font-semibold"
                style={{ color: "rgba(255,255,255,0.75)" }}
              >
                {k.label}
              </div>
            </div>

            {/* Bottom description bar */}
            <div
              className="px-4 py-2"
              style={{ background: "rgba(0,0,0,0.28)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div
                className="text-xs truncate"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                {k.description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
