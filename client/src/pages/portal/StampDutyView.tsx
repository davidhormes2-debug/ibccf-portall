import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Stamp,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Upload,
  Hourglass,
} from "lucide-react";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { getPortalToken } from "@/lib/portalSession";
import { useTranslation } from "react-i18next";

interface StampDutyWallet {
  id: string;
  label: string | null;
  address: string;
  asset: string;
  network: string | null;
  memo: string | null;
}

interface StampDutyConfig {
  enabled: boolean;
  status: "awaiting_upload" | "awaiting_admin_approval" | "approved" | "rejected";
  amountUsdt: string;
  amountSource: "case" | "global" | "fallback";
  paymentAddress: string | null;
  paymentAsset: string | null;
  paymentNetwork: string | null;
  paymentMemo: string | null;
  wallets?: StampDutyWallet[];
  approvedAt?: string | null;
  rejectionReason?: string | null;
}

interface StampDutyReceiptListItem {
  id: number;
  amountUsdt: string;
  status: string;
  adminNotes?: string | null;
  reviewedAt?: string | null;
  uploadedAt: string;
  fileName?: string | null;
  notes?: string | null;
}

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

interface StampDutyViewProps {
  /**
   * When mounted as the SealedView intercept this is `true`, which
   * hides the "Back to dashboard" link and tightens the page heading.
   */
  embedded?: boolean;
}

/**
 * Stamp Duty Deposit upload + status sub-view. Rendered by SealedView
 * whenever `stampDutyEnabled !== false && stampDutyStatus !== 'approved'`
 * so the user can't reach the NDA-signing form until compliance has
 * cleared the deposit. Server-side, POST /:id/nda/sign also enforces
 * this gate (returns 409 with `code: 'stamp_duty_required'`).
 */
export function StampDutyView({ embedded }: StampDutyViewProps = {}) {
  const { currentCase, loadAllData } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const [config, setConfig] = useState<StampDutyConfig | null>(null);
  const [receipts, setReceipts] = useState<StampDutyReceiptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");

  const caseId = currentCase?.id;
  const authHeaders = useMemo(() => {
    const tok = getPortalToken();
    return tok
      ? ({ "x-portal-session-token": tok } as Record<string, string>)
      : ({} as Record<string, string>);
  }, []);

  const refresh = useCallback(async () => {
    if (!caseId) return;
    try {
      const [cfgRes, listRes] = await Promise.all([
        fetch(`/api/cases/${caseId}/stamp-duty`, { headers: authHeaders }),
        fetch(`/api/cases/${caseId}/stamp-duty/receipts`, { headers: authHeaders }),
      ]);
      if (cfgRes.ok) setConfig(await cfgRes.json());
      if (listRes.ok) setReceipts(await listRes.json());
    } catch (e) {
      console.error("stamp-duty load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [caseId, authHeaders]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while a receipt is awaiting compliance review so the user
  // sees admin approval/rejection without manually reloading. Refreshes
  // both the local view AND the shared case (so SealedView's gate —
  // which keys off currentCase.stampDutyStatus — falls away the moment
  // the admin clicks approve).
  useEffect(() => {
    if (!config || config.status !== "awaiting_admin_approval") return;
    const interval = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [config, refresh]);

  // Whenever the stamp-duty status flips to a terminal state, ask the
  // PortalContext to reload the case so SealedView (and any other view
  // that reads `currentCase.stampDutyStatus`) updates in lock-step. We
  // only fire this on the transition into approved/rejected to avoid a
  // refresh loop while the user is still uploading.
  const lastSyncedStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!config) return;
    if (lastSyncedStatus.current === config.status) return;
    lastSyncedStatus.current = config.status;
    if (config.status === "approved" || config.status === "rejected") {
      void loadAllData();
    }
  }, [config, loadAllData]);

  const handleUpload = async () => {
    if (!caseId || !file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      toast({
        title: t("stampDuty.toasts.invalidTypeTitle"),
        description: t("stampDuty.toasts.invalidTypeDesc"),
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: t("stampDuty.toasts.tooLargeTitle"),
        description: t("stampDuty.toasts.tooLargeDesc"),
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch(`/api/cases/${caseId}/stamp-duty/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          fileData: dataUrl,
          fileName: file.name,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast({
        title: t("stampDuty.toasts.uploadedTitle"),
        description: t("stampDuty.toasts.uploadedDesc"),
      });
      setFile(null);
      setNotes("");
      await refresh();
    } catch (e) {
      toast({
        title: t("stampDuty.toasts.failedTitle"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={embedded ? "" : "mx-auto max-w-3xl"}>
        <PortalSkeleton variant="card" count={2} />
      </div>
    );
  }

  if (!config) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-6">
          <p className="text-sm text-slate-300">
            {t("stampDuty.unavailable")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!config.enabled) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="p-6">
          <p className="text-sm text-emerald-100">
            {t("stampDuty.disabled")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const isApproved = config.status === "approved";
  const isAwaitingReview = config.status === "awaiting_admin_approval";
  const isRejected = config.status === "rejected";

  return (
    <div className={embedded ? "space-y-6" : "mx-auto max-w-3xl space-y-6"}>
      <Card className="overflow-hidden border-amber-500/40 bg-gradient-to-br from-slate-900 to-slate-950">
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Stamp className="h-5 w-5 text-amber-300" />
              <div>
                <h1 className="text-base font-semibold text-white">
                  {t("stampDuty.title")}
                </h1>
                <p className="text-xs text-slate-400">
                  {t("stampDuty.subtitle")}
                </p>
              </div>
            </div>
            <Badge
              variant={
                isApproved ? "default" : isRejected ? "destructive" : "secondary"
              }
              className="font-mono text-[10px]"
              data-testid="badge-stamp-duty-status"
            >
              {config.status}
            </Badge>
          </div>
        </div>

        <CardContent className="space-y-5 px-6 py-6 text-sm text-slate-200">
          <div className="rounded-lg border border-amber-500/30 bg-black/30 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
              {t("stampDuty.amountLabel")}
            </div>
            <div className="mt-1 font-mono text-2xl text-amber-200" data-testid="text-stamp-duty-amount">
              {config.amountUsdt} USDT
            </div>
            {config.amountSource !== "case" && (
              <p className="mt-2 text-xs text-slate-400">
                {t("stampDuty.defaultNote")}
              </p>
            )}
          </div>

          {/* Payment rails — required to make the upload step actionable.
              Renders every configured wallet so the user can pay in
              whichever asset they prefer (BTC / USDT-TRC20 / ERC20, etc).
              When the admin hasn't configured any wallet we say so plainly
              rather than show a blank field. */}
          {!isApproved && (() => {
            const wallets: StampDutyWallet[] =
              config.wallets && config.wallets.length > 0
                ? config.wallets
                : config.paymentAddress && config.paymentAsset
                  ? [
                      {
                        id: "legacy",
                        label: null,
                        address: config.paymentAddress,
                        asset: config.paymentAsset,
                        network: config.paymentNetwork,
                        memo: config.paymentMemo,
                      },
                    ]
                  : [];
            return (
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/60 p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-300/90">
                  {t("stampDuty.payToLabel")}
                </div>
                {wallets.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {wallets.length > 1 && (
                      <p className="text-xs text-slate-400">
                        {t("stampDuty.payToChooseAsset")}
                      </p>
                    )}
                    {wallets.map((w, idx) => (
                      <div
                        key={w.id || `${w.asset}-${idx}`}
                        className="rounded-md border border-slate-700/60 bg-slate-950/40 p-3 space-y-2"
                        data-testid={`stamp-duty-wallet-${w.asset.toLowerCase()}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px]"
                          >
                            {w.asset}
                          </Badge>
                          {w.network && (
                            <span className="text-[10px] uppercase tracking-widest text-slate-400">
                              {w.network}
                            </span>
                          )}
                          {w.label && (
                            <span className="text-xs text-slate-300">{w.label}</span>
                          )}
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-slate-400">
                            {t("stampDuty.addressLabel")}
                          </div>
                          <div
                            className="mt-1 break-all rounded bg-slate-900/80 px-3 py-2 font-mono text-xs text-slate-100"
                            data-testid={`text-stamp-duty-address-${idx}`}
                          >
                            {w.address}
                          </div>
                        </div>
                        {w.memo && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-400">
                              {t("stampDuty.memoLabel")}
                            </div>
                            <div className="mt-1 break-all rounded bg-slate-900/80 px-3 py-2 font-mono text-xs text-slate-100">
                              {w.memo}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-slate-400">
                      {t("stampDuty.payToHint")}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-amber-200">
                    {t("stampDuty.payToMissing")}
                  </p>
                )}
              </div>
            );
          })()}

          {isApproved && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <p className="font-semibold text-emerald-200">
                  {t("stampDuty.approvedTitle")}
                </p>
                <p className="mt-1 text-xs text-emerald-100/80">
                  {t("stampDuty.approvedBody")}
                </p>
              </div>
            </motion.div>
          )}

          {isAwaitingReview && (
            <div className="flex items-start gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 p-4">
              <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
              <div>
                <p className="font-semibold text-blue-200">
                  {t("stampDuty.pendingTitle")}
                </p>
                <p className="mt-1 text-xs text-blue-100/80">
                  {t("stampDuty.pendingBody")}
                </p>
              </div>
            </div>
          )}

          {isRejected && (
            <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
              <div>
                <p className="font-semibold text-rose-200">
                  {t("stampDuty.rejectedTitle")}
                </p>
                <p className="mt-1 text-xs text-rose-100/80">
                  {config.rejectionReason
                    ? t("stampDuty.rejectedReason", {
                        reason: config.rejectionReason,
                      })
                    : t("stampDuty.rejectedBody")}
                </p>
              </div>
            </div>
          )}

          {!isApproved && (
            <div className="space-y-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-4">
              <div className="space-y-2">
                <Label htmlFor="stamp-duty-file">
                  {t("stampDuty.fileLabel")}
                </Label>
                <Input
                  id="stamp-duty-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={submitting}
                  data-testid="input-stamp-duty-file"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stamp-duty-notes">
                  {t("stampDuty.notesLabel")}
                </Label>
                <Textarea
                  id="stamp-duty-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  placeholder={t("stampDuty.notesPlaceholder")}
                  disabled={submitting}
                  data-testid="textarea-stamp-duty-notes"
                />
              </div>
              <Button
                onClick={handleUpload}
                disabled={submitting || !file}
                className="bg-amber-500 text-slate-950 hover:bg-amber-400"
                data-testid="button-upload-stamp-duty"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("stampDuty.uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {t("stampDuty.uploadCta")}
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {receipts.length > 0 && (
        <Card className="border-slate-700/60 bg-slate-900/40">
          <CardContent className="p-6">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-300">
              {t("stampDuty.historyTitle")}
            </h3>
            <ul className="space-y-2">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3"
                  data-testid={`row-stamp-duty-receipt-${r.id}`}
                >
                  <div className="text-xs text-slate-300">
                    <div className="font-mono">{r.amountUsdt} USDT</div>
                    <div className="text-slate-500">
                      {new Date(r.uploadedAt).toLocaleString()} · {r.fileName ?? "—"}
                    </div>
                  </div>
                  <Badge
                    variant={
                      r.status === "approved"
                        ? "default"
                        : r.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
