import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Award, Download, Upload, Clock, CheckCircle, AlertTriangle, Loader2, Wallet } from "lucide-react";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { getIsWithdrawalMode } from "@/lib/withdrawalMode";
import { getPortalToken } from "@/lib/portalSession";

interface FeeInfo {
  percent: string;
  amountUsdt: string;
  baseAmountUsed: string;
  status: 'not_required' | 'awaiting_admin_approval' | 'approved' | 'rejected';
  approvedAt: string | null;
  depositAddress: string | null;
  depositAsset: string | null;
  depositNetwork: string | null;
  error?: string;
}

interface FeePayment {
  id: number;
  amountUsdt: string;
  percentUsed: string;
  status: string;
  adminNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
  fileName: string | null;
  notes: string | null;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = /^application\/pdf$|^image\/(png|jpe?g|webp)$/i;

export function CertificateView() {
  const { currentCase } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const [fee, setFee] = useState<FeeInfo | null>(null);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [feeLoading, setFeeLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notes, setNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loading = feeLoading || paymentsLoading;

  const caseId = currentCase?.id;

  const reload = async () => {
    if (!caseId) return;
    setFeeLoading(true);
    setPaymentsLoading(true);
    const token = getPortalToken();
    const headers: HeadersInit = token ? { "x-portal-session-token": token } : {};

    const feePromise = fetch(`/api/cases/${caseId}/certificate/fee`, { headers })
      .then(async (feeRes) => {
        if (feeRes.ok) {
          setFee(await feeRes.json());
        } else {
          const body = await feeRes.json().catch(() => ({}));
          setFee({
            percent: "0", amountUsdt: "0", baseAmountUsed: "0",
            status: 'not_required', approvedAt: null,
            depositAddress: null, depositAsset: null, depositNetwork: null,
            error: typeof body?.error === 'string' ? body.error : `Status ${feeRes.status}`,
          });
        }
      })
      .finally(() => setFeeLoading(false));

    const paymentsPromise = fetch(`/api/cases/${caseId}/certificate/fee-payments`, { headers })
      .then(async (paymentsRes) => {
        if (paymentsRes.ok) setPayments(await paymentsRes.json());
      })
      .finally(() => setPaymentsLoading(false));

    await Promise.all([feePromise, paymentsPromise]);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [caseId]);

  const onPickFile = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    if (!caseId) return;
    if (file.size === 0 || file.size > MAX_BYTES) {
      toast({ variant: "destructive", title: t("certificate.toasts.tooLargeTitle"), description: t("certificate.toasts.tooLargeDesc") });
      return;
    }
    if (file.type && !ACCEPTED.test(file.type)) {
      toast({ variant: "destructive", title: t("certificate.toasts.unsupportedTitle"), description: t("certificate.toasts.unsupportedDesc") });
      return;
    }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(file);
      });
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${caseId}/certificate/fee-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "x-portal-session-token": token } : {}) },
        body: JSON.stringify({ fileData: dataUrl, fileName: file.name, notes: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === 'string' ? body.error : `Upload failed (${res.status})`);
      }
      toast({ title: t("certificate.toasts.uploadedTitle"), description: t("certificate.toasts.uploadedDesc") });
      setNotes("");
      await reload();
    } catch (err) {
      toast({ variant: "destructive", title: t("certificate.toasts.uploadFailedTitle"), description: err instanceof Error ? err.message : t("certificate.toasts.uploadFailedDesc") });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadPdf = async () => {
    if (!caseId) return;
    setDownloading(true);
    try {
      const token = getPortalToken();
      const headers: HeadersInit = token ? { "x-portal-session-token": token } : {};
      const res = await fetch(`/api/cases/${caseId}/certificate/pdf`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === 'string' ? body.error : `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IBCCF-Certificate-${caseId}${fee?.status === 'approved' ? '' : '-PREVIEW'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: "destructive", title: t("certificate.toasts.downloadFailedTitle"), description: err instanceof Error ? err.message : t("certificate.toasts.downloadFailedDesc") });
    } finally {
      setDownloading(false);
    }
  };

  if (!currentCase) return null;
  const isWithdrawalMode = getIsWithdrawalMode(currentCase);
  if (!currentCase.certificateEnabled && !isWithdrawalMode) {
    return (
      <div data-testid="certificate-not-enabled" className="p-6 max-w-3xl mx-auto text-blue-100">
        <p>{t("certificate.notEnabled")}</p>
      </div>
    );
  }

  const status = fee?.status ?? currentCase.certificateFeeStatus ?? 'not_required';
  const approved = status === 'approved';
  const pending = status === 'awaiting_admin_approval';
  const rejected = status === 'rejected';
  const latestRejection = rejected ? payments.find((p) => p.status === 'rejected') : null;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5 sm:p-6 border border-amber-500/30 bg-gradient-to-br from-amber-900/30 via-blue-950/60 to-indigo-950/60 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-lg shrink-0">
            <Award className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-white">{t("certificate.title")}</h1>
              {approved && <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">{t("certificate.badges.unlocked")}</Badge>}
              {pending && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">{t("certificate.badges.awaiting")}</Badge>}
              {rejected && <Badge className="bg-red-500/20 text-red-300 border-red-500/40">{t("certificate.badges.resubmit")}</Badge>}
              {!approved && !pending && !rejected && <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">{t("certificate.badges.feeRequired")}</Badge>}
            </div>
            <p className="text-sm text-blue-200/80 mt-1">
              {t("certificate.subtitle")}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Preview / download card */}
      <div className="rounded-2xl p-5 border border-white/10 bg-white/5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm uppercase tracking-widest text-blue-300/70 font-semibold">{t("certificate.pdfSection.label")}</p>
            <p className="text-white text-base font-semibold mt-1">
              {approved ? t("certificate.pdfSection.readyTitle") : t("certificate.pdfSection.previewTitle")}
            </p>
            <p className="text-xs text-blue-200/70 mt-1">
              {approved
                ? t("certificate.pdfSection.readyHint")
                : t("certificate.pdfSection.previewHint")}
            </p>
          </div>
          <Button
            onClick={downloadPdf}
            disabled={downloading || loading}
            className="bg-gradient-to-r from-amber-500 to-yellow-600 text-white hover:from-amber-400 hover:to-yellow-500"
            data-testid="button-certificate-download"
          >
            {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {approved ? t("certificate.pdfSection.downloadCertificate") : t("certificate.pdfSection.downloadPreview")}
          </Button>
        </div>
      </div>

      {/* Fee panel */}
      {!approved && (
        <div className="rounded-2xl p-5 border border-white/10 bg-white/5 backdrop-blur-xl space-y-4">
          <div>
            <p className="text-sm uppercase tracking-widest text-blue-300/70 font-semibold">{t("certificate.fee.label")}</p>
            {feeLoading && !fee ? (
              <div data-testid="certificate-fee-skeleton">
                <PortalSkeleton variant="list" count={2} className="mt-2" />
              </div>
            ) : fee?.error ? (
              <div data-testid="certificate-fee-error" className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>{fee.error}</div>
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-[10px] uppercase tracking-widest text-blue-300/70 font-semibold">{t("certificate.fee.amount")}</p>
                  <p className="text-white text-xl font-bold font-mono mt-1">{fee?.amountUsdt} USDT</p>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-[10px] uppercase tracking-widest text-blue-300/70 font-semibold">{t("certificate.fee.rate")}</p>
                  <p className="text-white text-xl font-bold mt-1">{fee?.percent}%</p>
                  <p className="text-[11px] text-blue-200/60">{t("certificate.fee.rateOf", { base: fee?.baseAmountUsed })}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-[10px] uppercase tracking-widest text-blue-300/70 font-semibold">{t("certificate.fee.payTo")}</p>
                  <p className="text-white text-sm font-mono break-all mt-1">{fee?.depositAddress ?? t("certificate.fee.payToFallback")}</p>
                  <p className="text-[11px] text-blue-200/60 mt-1 flex items-center gap-1">
                    <Wallet className="w-3 h-3" /> {fee?.depositAsset ?? "USDT"} · {fee?.depositNetwork ?? "TRC20"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {rejected && latestRejection?.adminNotes && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm">
              <p className="text-red-300 font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t("certificate.fee.reviewerNotes")}</p>
              <p className="text-red-100/90 mt-1 whitespace-pre-wrap">{latestRejection.adminNotes}</p>
            </div>
          )}

          {pending ? (
            <div data-testid="certificate-fee-pending-notice" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 text-amber-300" />
              <div className="text-amber-100">
                {t("certificate.fee.pending")}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                placeholder={t("certificate.fee.notesPlaceholder")}
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
                className="bg-white/5 border-white/10 text-white"
                data-testid="textarea-certificate-fee-notes"
              />
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <Button
                  onClick={onPickFile}
                  disabled={uploading || !!fee?.error}
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white"
                  data-testid="button-certificate-upload"
                >
                  {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {rejected ? t("certificate.fee.uploadCorrected") : t("certificate.fee.uploadReceipt")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment history skeleton */}
      {paymentsLoading && payments.length === 0 && (
        <div data-testid="certificate-payment-history-skeleton">
          <PortalSkeleton variant="list" count={2} />
        </div>
      )}

      {/* Payment history */}
      {payments.length > 0 && (
        <div data-testid="certificate-payment-history" className="rounded-2xl p-5 border border-white/10 bg-white/5 backdrop-blur-xl">
          <p className="text-sm uppercase tracking-widest text-blue-300/70 font-semibold mb-3">{t("certificate.history.title")}</p>
          <ul className="space-y-2">
            {payments.map((p) => (
              <li key={p.id} data-testid={`certificate-payment-${p.id}`} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                  {p.status === 'approved' ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" /> :
                   p.status === 'rejected' ? <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" /> :
                   <Clock className="w-4 h-4 text-amber-400 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold">{p.amountUsdt} USDT <span className="text-blue-300/70 font-normal">@ {p.percentUsed}%</span></p>
                    <p className="text-[11px] text-blue-200/60">{new Date(p.uploadedAt).toLocaleString()} · {p.fileName ?? t("certificate.history.receiptLabel")}</p>
                  </div>
                </div>
                <Badge data-testid={`certificate-payment-${p.id}-status`} className={
                  p.status === 'approved' ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" :
                  p.status === 'rejected' ? "bg-red-500/20 text-red-300 border-red-500/40" :
                  "bg-amber-500/20 text-amber-300 border-amber-500/40"
                }>{
                  p.status === 'approved' ? t("certificate.history.statusApproved") :
                  p.status === 'rejected' ? t("certificate.history.statusRejected") :
                  t("certificate.history.statusPending")
                }</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
