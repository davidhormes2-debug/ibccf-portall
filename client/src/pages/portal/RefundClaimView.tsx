import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Plus, Trash2, Upload, CheckCircle2, Clock, XCircle,
  Award, Download, FileText, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { usePortal } from "./PortalContext";
import { getPortalToken } from "@/lib/portalSession";
import { useToast } from "@/hooks/use-toast";

interface RefundClaimEntry {
  amount: string;
  chargedFor: string;
  date: string;
  txId: string;
  network: string;
  notes: string;
  receiptUploaded?: boolean;
  receiptName?: string;
}

interface RefundClaimData {
  id: number;
  status: string;
  entries: RefundClaimEntry[];
  refundableAmount?: string | null;
  documentaryRecommendations?: string | null;
  adminNotes?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
}

const EMPTY_ENTRY = (): RefundClaimEntry => ({
  amount: "",
  chargedFor: "",
  date: "",
  txId: "",
  network: "",
  notes: "",
});

function StatusBanner({ status, t }: { status: string; t: (k: string) => string }) {
  const cfg: Record<string, { icon: React.ReactNode; bg: string; border: string; text: string; label: string }> = {
    pending_submission: {
      icon: <Clock className="h-5 w-5" />,
      bg: "rgba(251,191,36,0.12)",
      border: "rgba(251,191,36,0.3)",
      text: "#fbbf24",
      label: t("refundClaim.statusPendingSubmission"),
    },
    submitted: {
      icon: <Clock className="h-5 w-5" />,
      bg: "rgba(59,130,246,0.12)",
      border: "rgba(59,130,246,0.3)",
      text: "#60a5fa",
      label: t("refundClaim.statusSubmitted"),
    },
    approved: {
      icon: <CheckCircle2 className="h-5 w-5" />,
      bg: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.3)",
      text: "#4ade80",
      label: t("refundClaim.statusApproved"),
    },
    rejected: {
      icon: <XCircle className="h-5 w-5" />,
      bg: "rgba(239,68,68,0.12)",
      border: "rgba(239,68,68,0.3)",
      text: "#f87171",
      label: t("refundClaim.statusRejected"),
    },
  };
  const c = cfg[status] ?? cfg.pending_submission;
  return (
    <div
      data-testid="refund-claim-status-banner"
      className="flex items-center gap-3 rounded-2xl px-5 py-3.5 mb-6"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      {c.icon}
      <span className="font-semibold text-sm">{c.label}</span>
    </div>
  );
}

function EntryRow({
  entry, index, readonly, onChange, onRemove, onReceiptUpload,
}: {
  entry: RefundClaimEntry;
  index: number;
  readonly: boolean;
  onChange: (i: number, field: keyof RefundClaimEntry, val: string) => void;
  onRemove: (i: number) => void;
  onReceiptUpload: (i: number, file: File) => Promise<void>;
}) {
  const { t } = useTranslation("portal");
  const [expanded, setExpanded] = useState(true);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try { await onReceiptUpload(index, f); } finally { setUploading(false); }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none"
        style={{ background: "rgba(255,255,255,0.03)" }}
        onClick={() => setExpanded((x) => !x)}
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-blue-600/30 flex items-center justify-center text-blue-300 font-bold text-xs">
            {index + 1}
          </div>
          <div>
            <p className="text-white font-semibold text-sm">
              {entry.chargedFor || t("refundClaim.chargedForPlaceholder").split("…")[0] + "…"}
            </p>
            {entry.amount && (
              <p className="text-blue-300 text-xs font-mono">{entry.amount} USDT</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {entry.receiptUploaded && (
            <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Receipt
            </Badge>
          )}
          {!readonly && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(index); }}
              className="text-red-400/60 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-blue-400/60" /> : <ChevronDown className="h-4 w-4 text-blue-400/60" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.amountLabel")} *</Label>
                <Input
                  value={entry.amount}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "amount", e.target.value)}
                  placeholder={t("refundClaim.amountPlaceholder")}
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus-visible:ring-blue-500 disabled:opacity-60"
                />
              </div>
              <div>
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.chargedForLabel")} *</Label>
                <Input
                  value={entry.chargedFor}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "chargedFor", e.target.value)}
                  placeholder={t("refundClaim.chargedForPlaceholder")}
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus-visible:ring-blue-500 disabled:opacity-60"
                />
              </div>
              <div>
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.dateLabel")} *</Label>
                <Input
                  type="date"
                  value={entry.date}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "date", e.target.value)}
                  className="bg-white/5 border-white/10 text-white focus-visible:ring-blue-500 disabled:opacity-60 [color-scheme:dark]"
                />
              </div>
              <div>
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.networkLabel")}</Label>
                <Input
                  value={entry.network}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "network", e.target.value)}
                  placeholder={t("refundClaim.networkPlaceholder")}
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus-visible:ring-blue-500 disabled:opacity-60"
                />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.txIdLabel")}</Label>
                <Input
                  value={entry.txId}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "txId", e.target.value)}
                  placeholder={t("refundClaim.txIdPlaceholder")}
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus-visible:ring-blue-500 font-mono text-xs disabled:opacity-60"
                />
              </div>
              <div className="col-span-1 sm:col-span-2">
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.entryNotesLabel")}</Label>
                <Textarea
                  value={entry.notes}
                  disabled={readonly}
                  onChange={(e) => onChange(index, "notes", e.target.value)}
                  placeholder={t("refundClaim.entryNotesPlaceholder")}
                  rows={2}
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/40 focus-visible:ring-blue-500 resize-none disabled:opacity-60"
                />
              </div>

              {/* Receipt Upload */}
              <div className="col-span-1 sm:col-span-2">
                <Label className="text-blue-300/80 text-xs mb-1.5 block">{t("refundClaim.receiptLabel")}</Label>
                {entry.receiptUploaded ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-300 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{entry.receiptName || t("refundClaim.receiptAttached")}</span>
                  </div>
                ) : !readonly ? (
                  <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer transition-all text-blue-300 text-sm font-medium hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/40"
                    style={{ background: "rgba(59,130,246,0.08)" }}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{uploading ? "Uploading…" : t("refundClaim.attachReceipt")}</span>
                    <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFile} disabled={uploading} />
                  </label>
                ) : (
                  <p className="text-blue-400/50 text-xs italic">No receipt attached.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function RefundClaimView() {
  const { currentCase, refetch } = usePortal() as ReturnType<typeof usePortal> & { refetch?: () => void };
  const { t } = useTranslation("portal");
  const { toast } = useToast();
  const [claim, setClaim] = useState<RefundClaimData | null>(null);
  const [entries, setEntries] = useState<RefundClaimEntry[]>([EMPTY_ENTRY()]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [additionalUploading, setAdditionalUploading] = useState(false);

  const caseId = currentCase?.id ?? "";

  const fetchClaim = useCallback(async () => {
    const token = getPortalToken();
    if (!token || !caseId) return;
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim`, {
        headers: { "x-portal-session-token": token },
      });
      if (res.ok) {
        const data = (await res.json()) as RefundClaimData;
        setClaim(data);
        if (data.entries && data.entries.length > 0) {
          setEntries(data.entries.map((e) => ({
            amount: e.amount ?? "",
            chargedFor: e.chargedFor ?? "",
            date: e.date ?? "",
            txId: e.txId ?? "",
            network: e.network ?? "",
            notes: e.notes ?? "",
            receiptUploaded: false,
          })));
        }
      }
    } catch { /* best-effort */ } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { fetchClaim(); }, [fetchClaim]);

  const handleEntryChange = (i: number, field: keyof RefundClaimEntry, val: string) => {
    setEntries((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  };

  const handleReceiptUpload = async (entryIndex: number, file: File) => {
    const token = getPortalToken();
    if (!token || !caseId) return;
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((res, rej) => {
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    const resp = await fetch(`/api/cases/${caseId}/deposit-receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-portal-session-token": token },
      body: JSON.stringify({
        imageData: dataUrl,
        fileName: file.name,
        category: "refund_claim",
        entryIndex,
      }),
    });
    if (resp.ok) {
      setEntries((prev) =>
        prev.map((e, i) => i === entryIndex ? { ...e, receiptUploaded: true, receiptName: file.name } : e)
      );
      toast({ title: "Receipt uploaded", description: file.name });
    } else {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  const handleAdditionalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = getPortalToken();
    if (!token || !caseId) return;
    setAdditionalUploading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const resp = await fetch(`/api/cases/${caseId}/deposit-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-portal-session-token": token },
        body: JSON.stringify({ imageData: dataUrl, fileName: file.name, category: "refund_claim_doc" }),
      });
      if (resp.ok) {
        toast({ title: "Document uploaded", description: file.name });
      } else {
        toast({ title: "Upload failed", variant: "destructive" });
      }
    } finally {
      setAdditionalUploading(false);
    }
  };

  const handleSubmit = async () => {
    const filled = entries.filter((e) => e.amount.trim() && e.chargedFor.trim() && e.date.trim());
    if (filled.length === 0) {
      toast({ title: t("refundClaim.emptyEntriesError"), variant: "destructive" });
      return;
    }
    const token = getPortalToken();
    if (!token || !caseId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-portal-session-token": token },
        body: JSON.stringify({ entries: filled, submit: true }),
      });
      if (res.ok) {
        await fetchClaim();
        refetch?.();
        toast({ title: t("refundClaim.submittedBannerTitle"), description: t("refundClaim.submittedBannerBody") });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: (d as { error?: string }).error || "Submission failed", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadCert = async () => {
    const token = getPortalToken();
    if (!token || !caseId) return;
    setDownloadingCert(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim/certificate`, {
        headers: { "x-portal-session-token": token },
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IBCCF-RefundCertificate-${caseId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setDownloadingCert(false);
    }
  };

  const readonly = claim ? claim.status !== "pending_submission" : false;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/30 to-amber-700/30 border border-amber-500/20 flex items-center justify-center">
            <Award className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-xl">{t("refundClaim.pageTitle")}</h1>
            <p className="text-blue-300/70 text-sm">{t("refundClaim.pageSubtitle")}</p>
          </div>
        </div>

        {/* Refundable balance chip */}
        {claim?.refundableAmount && (
          <div
            className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-2xl"
            style={{ background: "rgba(200,169,81,0.08)", border: "1px solid rgba(200,169,81,0.2)" }}
          >
            <span className="text-amber-300/70 text-xs">{t("refundClaim.refundableBalanceLabel")}:</span>
            <span className="text-amber-300 font-bold text-sm font-mono">{claim.refundableAmount} USDT</span>
          </div>
        )}
      </div>

      {/* Status banner */}
      {claim && <StatusBanner status={claim.status} t={t as (k: string) => string} />}

      {/* Approved certificate download */}
      {claim?.status === "approved" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl overflow-hidden"
          data-testid="refund-claim-approved-cert-card"
          style={{
            background: "linear-gradient(160deg, rgba(10,24,64,0.92) 0%, rgba(16,44,28,0.88) 100%)",
            border: "1px solid rgba(200,169,81,0.35)",
            boxShadow: "0 8px 40px rgba(200,169,81,0.08), inset 0 1px 0 rgba(200,169,81,0.15)",
          }}
        >
          {/* Certificate header band */}
          <div
            className="px-6 py-3 flex items-center justify-between"
            style={{ background: "rgba(200,169,81,0.12)", borderBottom: "1px solid rgba(200,169,81,0.2)" }}
          >
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-400" />
              <span className="text-amber-300/80 text-[11px] font-bold tracking-widest uppercase">IBCCF International Enforcement Division</span>
            </div>
            <span className="text-amber-400/50 text-[10px] font-mono">RC-{String(claim.id).padStart(6, "0")}</span>
          </div>

          {/* Certificate body */}
          <div className="px-6 py-6 flex flex-col sm:flex-row items-center gap-6">
            {/* Seal */}
            <div className="shrink-0 flex items-center justify-center" style={{ width: 96, height: 96 }}>
              <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
                <circle cx="48" cy="48" r="45" fill="none" stroke="#c8a951" strokeWidth="2" />
                <circle cx="48" cy="48" r="36" fill="none" stroke="#c8a951" strokeWidth="0.8" />
                <circle cx="48" cy="48" r="28" fill="rgba(200,169,81,0.07)" />
                <text x="48" y="42" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold" fontSize="11" fill="#c8a951">IBCCF</text>
                <text x="48" y="53" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold" fontSize="7" fill="#4ade80">APPROVED</text>
                <text x="48" y="63" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontSize="5.5" fill="#6b7385">ENFORCEMENT</text>
                <text x="48" y="73" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontSize="8" fill="#c8a951">★ ★ ★</text>
              </svg>
            </div>

            {/* Text */}
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-white font-bold text-lg mb-1">{t("refundClaim.approvedBannerTitle")}</h2>
              <p className="text-green-300/70 text-sm mb-4 leading-relaxed">{t("refundClaim.approvedBannerBody")}</p>
              <Button
                onClick={handleDownloadCert}
                disabled={downloadingCert}
                className="font-semibold px-6 py-2 rounded-xl shadow-lg"
                style={{
                  background: downloadingCert
                    ? "rgba(200,169,81,0.3)"
                    : "linear-gradient(135deg, #c8a951 0%, #a8862e 100%)",
                  color: "#0a1840",
                  boxShadow: "0 4px 16px rgba(200,169,81,0.25)",
                }}
              >
                {downloadingCert
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t("refundClaim.downloadingCertificate")}</>
                  : <><Download className="h-4 w-4 mr-2" />{t("refundClaim.downloadCertificate")}</>
                }
              </Button>
              <p className="text-amber-400/30 text-xs mt-3">{t("refundClaim.certSubtitle")}</p>
            </div>
          </div>

          {/* Certificate footer */}
          <div
            className="px-6 py-2.5 flex items-center justify-between"
            style={{ background: "rgba(10,24,64,0.5)", borderTop: "1px solid rgba(200,169,81,0.12)" }}
          >
            <span className="text-slate-500 text-[10px]">Official certificate — IBCCF Compliance Portal</span>
            <span className="text-amber-400/40 text-[10px] font-mono">
              {claim.reviewedAt ? new Date(claim.reviewedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""}
            </span>
          </div>
        </motion.div>
      )}

      {/* Rejected */}
      {claim?.status === "rejected" && (
        <div
          className="rounded-2xl p-5"
          data-testid="refund-claim-rejection-details"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <p className="text-red-300 font-semibold mb-1">{t("refundClaim.rejectedBannerTitle")}</p>
          <p className="text-red-300/70 text-sm">{t("refundClaim.rejectedBannerBody")}</p>
          {claim.adminNotes && (
            <div className="mt-4 pt-4 border-t border-red-500/20">
              <p className="text-red-300/60 text-xs uppercase tracking-wide mb-1.5">{t("refundClaim.adminNotesLabel")}</p>
              <p className="text-red-100/80 text-sm whitespace-pre-line" data-testid="refund-claim-rejection-admin-notes">{claim.adminNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Documentary recommendations */}
      {claim?.documentaryRecommendations && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgba(200,169,81,0.07)", border: "1px solid rgba(200,169,81,0.2)" }}
        >
          <p className="text-amber-300/80 text-xs uppercase tracking-widest font-semibold mb-2">
            {t("refundClaim.recommendationsTitle")}
          </p>
          <p className="text-blue-100/70 text-xs mb-3">{t("refundClaim.recommendationsHint")}</p>
          <p className="text-amber-100 text-sm whitespace-pre-line leading-relaxed">
            {claim.documentaryRecommendations}
          </p>
        </div>
      )}

      {/* Submitted read-only notice */}
      {claim?.status === "submitted" && (
        <div
          className="rounded-2xl px-5 py-3.5 text-sm text-blue-300/80"
          style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}
        >
          {t("refundClaim.submittedReadonlyNotice")}
        </div>
      )}

      {/* Entries section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-white font-semibold text-base">{t("refundClaim.entriesTitle")}</h2>
            <p className="text-blue-300/60 text-xs mt-0.5">{t("refundClaim.entriesHint")}</p>
          </div>
          {!readonly && (
            <Button
              size="sm"
              onClick={() => setEntries((prev) => [...prev, EMPTY_ENTRY()])}
              className="bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/30 rounded-xl text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("refundClaim.addEntry")}
            </Button>
          )}
        </div>

        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <EntryRow
                key={i}
                entry={entry}
                index={i}
                readonly={readonly}
                onChange={handleEntryChange}
                onRemove={(idx) => setEntries((prev) => prev.filter((_, ii) => ii !== idx))}
                onReceiptUpload={handleReceiptUpload}
              />
            ))}
          </div>
        </AnimatePresence>

        {entries.length === 0 && !readonly && (
          <div
            className="flex flex-col items-center justify-center py-10 rounded-2xl text-center"
            style={{ border: "1.5px dashed rgba(255,255,255,0.1)" }}
          >
            <FileText className="h-8 w-8 text-blue-400/30 mb-3" />
            <p className="text-blue-300/50 text-sm">{t("refundClaim.entriesHint")}</p>
            <Button
              size="sm"
              className="mt-4 bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/30 rounded-xl text-xs"
              onClick={() => setEntries([EMPTY_ENTRY()])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("refundClaim.addEntry")}
            </Button>
          </div>
        )}
      </div>

      {/* Additional documents */}
      {!readonly && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <h3 className="text-white font-semibold text-sm mb-1">{t("refundClaim.globalDocsTitle")}</h3>
          <p className="text-blue-300/50 text-xs mb-4">{t("refundClaim.globalDocsHint")}</p>
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer transition-all text-blue-300 text-sm font-medium hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/40 w-fit"
            style={{ background: "rgba(59,130,246,0.06)" }}
          >
            {additionalUploading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Upload className="h-4 w-4" />
            }
            <span>{additionalUploading ? "Uploading…" : t("refundClaim.attachReceipt")}</span>
            <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleAdditionalUpload} disabled={additionalUploading} />
          </label>
        </div>
      )}

      {/* Submit button */}
      {!readonly && (
        <div className="pt-2 pb-8">
          <Button
            onClick={handleSubmit}
            disabled={submitting || entries.filter((e) => e.amount && e.chargedFor && e.date).length === 0}
            className="w-full py-6 text-base font-bold rounded-2xl shadow-xl shadow-blue-900/30 disabled:opacity-50"
            style={{
              background: submitting
                ? "rgba(37,99,235,0.5)"
                : "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)",
            }}
          >
            {submitting
              ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />{t("refundClaim.submitting")}</>
              : t("refundClaim.submitCta")
            }
          </Button>
        </div>
      )}
    </div>
  );
}
