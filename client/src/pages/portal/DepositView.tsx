import { Component, useRef, useState, useEffect } from "react";
import { BATCH_FEE_NOTES_PREFIX } from "../../../../shared/constants";
import type { ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { Wallet, Upload, ImageIcon, MessageCircle, Copy, CheckCircle, AlertCircle, Download, QrCode, Clipboard, Share2, Coins, RefreshCw, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { clearPortalToken, getPortalToken } from "@/lib/portalSession";
import { LocalizedAmount } from "@/components/portal/LocalizedAmount";
import { useFormat } from "@/i18n/format";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";
import { PortalEmptyState } from "@/components/portal/PortalEmptyState";
import { ExpandableFailureList } from "@/components/portal/ExpandableFailureList";

class QRErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// Build the QR payload for the on-screen QR code. Different chains use
// different URI schemes; using the wrong one (e.g. `tron:` for an ETH
// address) confuses wallet apps. When we don't recognise the network we
// fall back to a plain address — every modern wallet handles that.
function buildQrPayload(asset: string, network: string, address: string, amount?: string | null): string {
  const family = network.toLowerCase();
  const amt = amount ? `?amount=${encodeURIComponent(amount)}` : "";
  if (family.includes("trc20") || family.includes("tron")) {
    // tron: scheme accepts an optional token tag so wallets can prefill
    // both amount and asset (USDT/USDC) on the same page.
    const tokenTag = asset && amount ? `&token=${encodeURIComponent(asset)}` : "";
    return amount ? `tron:${address}${amt}${tokenTag}` : address;
  }
  if (family === "bitcoin" || family === "btc") return `bitcoin:${address}${amt}`;
  if (family === "litecoin" || family === "ltc") return `litecoin:${address}${amt}`;
  if (family === "solana" || family === "sol") return `solana:${address}`;
  // For ERC20-family chains, EIP-681 with token contracts is too brittle
  // to encode reliably from free-text — wallets parse the plain address fine.
  return address;
}

type UnifiedReceiptRow = {
  source: "deposit" | "certificate" | "stamp_duty";
  id: number;
  category: "activation" | "reissue" | "other" | "certificate" | "stamp_duty" | "merge_fee" | "token_deposit";
  status: string;
  fileName: string | null;
  notes: string | null;
  uploadedAt: string;
};

const UNIFIED_CAT_LABEL: Record<UnifiedReceiptRow["category"], string> = {
  activation: "Activation",
  reissue: "Reissue",
  other: "Other",
  certificate: "Certificate fee",
  stamp_duty: "Stamp duty",
  merge_fee: "Merge fee",
  token_deposit: "Token deposit",
};

/**
 * Task #163 — Single unified receipts list for the portal Uploads view.
 * Renders rows from deposit_receipts, certificate_fee_payments, and
 * stamp_duty_receipts side-by-side with a category badge, so the user
 * sees every upload they've made in one place (no more hunting across
 * Certificate / Stamp Duty / Deposit screens).
 */
function UnifiedReceiptsList({ caseId, uploadingReceipt }: { caseId: string | undefined; uploadingReceipt: boolean }) {
  const { t } = useTranslation("portal");
  const { formatDateTime } = useFormat();
  const { toast } = useToast();
  const [rows, setRows] = useState<UnifiedReceiptRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const token = getPortalToken() || "";
      const res = await fetch(`/api/cases/${caseId}/all-receipts`, {
        headers: token ? { "x-portal-session-token": token } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as UnifiedReceiptRow[]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not load uploads",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, uploadingReceipt]);

  return (
    <>
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        {t("deposit.receipts.title")}
      </h3>
      {loading ? (
        <PortalSkeleton variant="list" count={3} />
      ) : rows.length === 0 ? (
        <PortalEmptyState
          icon={ImageIcon}
          title={t("deposit.receipts.empty")}
          data-testid="unified-receipts-empty"
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r, idx) => (
            <motion.div
              key={`${r.source}-${r.id}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className="flex items-center justify-between gap-4 p-4 rounded-2xl glass-dark-premium card-depth"
              data-testid={`unified-receipt-${r.source}-${r.id}`}
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] border-white/20 text-slate-200">
                      {UNIFIED_CAT_LABEL[r.category] ?? r.category}
                    </Badge>
                  </div>
                  <p className="font-semibold text-white text-sm truncate">{r.fileName || t("deposit.receipts.defaultFileName")}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(r.uploadedAt)}</p>
                  {r.notes && <p className="text-xs text-slate-400 mt-1 truncate">{r.notes}</p>}
                </div>
              </div>
              <Badge
                className={`shrink-0 text-xs ${
                  r.status === "approved" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                  r.status === "rejected" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                  "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                }`}
              >
                {t(`deposit.receipts.status.${r.status}`, { defaultValue: t('deposit.receipts.status.unknown') })}
              </Badge>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}

export function DepositView() {
  const { currentCase, uploadReceipt, setViewState, activeReissue } = usePortal();
  const { t } = useTranslation("portal");
  // Admin-selected crypto + network for this case. Defaults preserve the
  // original behaviour ("USDT on TRC20") for legacy cases that haven't been
  // re-saved through the new admin UI yet.
  const depositAsset = currentCase?.depositAsset?.trim() || "USDT";
  const depositNetwork = currentCase?.depositNetwork?.trim() || "TRC20";
  const [receiptNotes, setReceiptNotes] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  // Task #163 — Unified uploader category. The dropdown defaults to the
  // most contextually-relevant choice; gating below hides options that
  // don't apply to the current case state.
  // Stage-aware default: at stage 9+ the activation deposit has already been
  // approved (moving past stage 8 requires admin sign-off on activation), so
  // default to 'other' instead of 'activation' to avoid landing on a hidden
  // option. The snap-to useEffect further down also corrects this, but starting
  // with the right default avoids a brief state correction on first render.
  const [uploadCategory, setUploadCategory] = useState<'activation' | 'reissue' | 'certificate' | 'stamp_duty' | 'other' | 'merge_fee' | 'token_deposit'>(() => {
    const initStage = Number(currentCase?.withdrawalStage) || 0;
    const initWithdrawal = !!currentCase?.withdrawalWindowEnabled || initStage >= 12;
    return (!initWithdrawal && initStage >= 9) ? 'other' : 'activation';
  });
  // Task #938 — true when the user arrived via the Withdrawal Batches merge
  // confirmation flow; shows 'merge_fee' as a selectable upload category.
  const [showMergeFeeOption, setShowMergeFeeOption] = useState(false);
  // Task #951 — true when the user arrived from the merge flow and hasn't yet
  // uploaded a file or dismissed the contextual banner.
  const [showMergeFeeBanner, setShowMergeFeeBanner] = useState(false);
  // Task #953 — tracks an explicit user dismiss or a completed upload so the
  // banner can be permanently hidden without coupling to uploadCategory state.
  // Using a separate flag (rather than clearing showMergeFeeBanner) means the
  // banner reappears if the user switches away and back to 'merge_fee' without
  // having dismissed or uploaded.
  // Task #966 — capture the batch ID written by WithdrawalView so the
  // dismissed flag can be scoped per batch rather than globally per session.
  // We peek at the key here (the mount effect removes it later).
  const [mergeBatchId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('ibccf.pending_merge_batch_id');
    } catch {
      return null;
    }
  });

  // When the user clicks "Upload proof" on a specific pending history row in
  // WithdrawalView, that row's receipt ID is stored in sessionStorage so we
  // can forward it to the server and PATCH the placeholder receipt (created by
  // the admin without imageData) rather than creating a duplicate new receipt.
  // We peek at the key here; the mount effect clears it from sessionStorage.
  const [pendingMergeReceiptId] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem('ibccf.pending_merge_receipt_id');
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  });

  // Task #965 — initialise from sessionStorage so the dismissed decision
  // survives unmount/remount cycles (e.g. navigating away and back).  This
  // also blocks a re-injected `ibccf.pending_upload_category` signal from
  // reactivating the banner once the user has already dismissed it.
  // Task #966 — use a batch-scoped key when a batch ID is present so that
  // dismissing the banner for one merge-fee batch does not suppress it for
  // any subsequent merge-fee batch in the same browser session.
  const [mergeFeeBannerDismissed, setMergeFeeBannerDismissed] = useState(() => {
    try {
      const batchId = sessionStorage.getItem('ibccf.pending_merge_batch_id');
      const key = batchId
        ? `ibccf.merge_fee_banner_dismissed_${batchId}`
        : 'ibccf.merge_fee_banner_dismissed';
      return sessionStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  });

  // Task #938 — Withdrawal mode detection. When the withdrawal window is open
  // or the case is in stage ≥ 12, the upload category dropdown is narrowed to
  // withdrawal-relevant categories only. Use Number() to safely coerce
  // withdrawalStage whether it arrives as a number or a numeric string.
  const isWithdrawalMode =
    !!currentCase?.withdrawalWindowEnabled ||
    Number(currentCase?.withdrawalStage) >= 12;

  // Task #938 — Coin / Currency Preference selector state (mirrors WithdrawalView).
  // Reads from the case's persisted preference and allows saving via PATCH.
  const [prefAsset, setPrefAsset] = useState(currentCase?.preferredDepositAsset?.trim() || 'USDT');
  const [prefNetwork, setPrefNetwork] = useState(currentCase?.preferredDepositNetwork?.trim() || 'TRC20');
  const [savingPref, setSavingPref] = useState(false);

  const saveDepositPref = async () => {
    if (!currentCase) return;
    setSavingPref(true);
    try {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/preferred-deposit`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-portal-session-token': token } : {}),
        },
        body: JSON.stringify({ asset: prefAsset, network: prefNetwork }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: t("deposit.pref.savedTitle", "Preference saved"), description: t("deposit.pref.savedDesc", "Your preferred coin and network have been updated.") });
    } catch {
      toast({ variant: 'destructive', title: t("deposit.pref.failedTitle", "Save failed"), description: t("deposit.pref.failedDesc", "Could not save preference. Please try again.") });
    } finally {
      setSavingPref(false);
    }
  };
  const [copied, setCopied] = useState(false);
  const [copiedQR, setCopiedQR] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  // Task #967 — tracks when mergeFeeBannerDismissed was set by a successful
  // upload (vs. an explicit user dismiss). The sessionStorage persist-effect
  // reads this ref to decide whether to setItem (dismiss) or removeItem
  // (upload succeeded — batch key is now stale and should be cleaned up).
  const dismissedByUploadRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    setQrError(false);
  }, [currentCase?.depositAddress, currentCase?.phraseKeyDepositAmount, currentCase?.activityDepositAmount]);

  useEffect(() => {
    if (typeof navigator.share !== "function") return;
    const testFile = new File([""], "test.png", { type: "image/png" });
    setCanShare(navigator.canShare?.({ files: [testFile] }) ?? false);
  }, []);

  const downloadQR = () => {
    try {
      const canvas = qrCanvasRef.current;
      if (!canvas) return;
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = "deposit-address-qr.png";
      link.click();
    } catch {
      toast({ variant: "destructive", title: t("deposit.toast.downloadFailedTitle"), description: t("deposit.toast.downloadFailedDesc") });
    }
  };

  const shareQR = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast({ variant: "destructive", title: t("deposit.toast.shareFailedTitle"), description: t("deposit.toast.shareFailedNoImage") });
        return;
      }
      const file = new File([blob], "deposit-address-qr.png", { type: "image/png" });
      try {
        await navigator.share({ files: [file], title: t("deposit.toast.shareTitle") });
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          toast({ variant: "destructive", title: t("deposit.toast.shareFailedTitle"), description: t("deposit.toast.shareFailedSheet") });
        }
      }
    }, "image/png");
  };

  const copyQR = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    if (!navigator.clipboard?.write) {
      toast({ variant: "destructive", title: t("deposit.toast.copyNotSupportedTitle"), description: t("deposit.toast.copyNotSupportedDesc") });
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toast({ variant: "destructive", title: t("deposit.toast.copyFailedTitle"), description: t("deposit.toast.copyFailedNoImage") });
        return;
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopiedQR(true);
        setTimeout(() => setCopiedQR(false), 2500);
        toast({ title: t("deposit.toast.qrCopiedTitle"), description: t("deposit.toast.qrCopiedDesc") });
      } catch {
        toast({ variant: "destructive", title: t("deposit.toast.copyFailedTitle"), description: t("deposit.toast.copyFailedNotSupported") });
      }
    }, "image/png");
  };

  // Read a File as a base64 data URL. Used for cert/stamp-duty uploads
  // which post a `fileData` string rather than going through the legacy
  // uploadReceipt path.
  const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });

  // Upload a single file via the category-appropriate endpoint. Pulled
  // out of handleFileUpload so the multi-select path can reuse it and
  // surface per-file success/failure counts without short-circuiting on
  // the first error.
  const uploadOneFile = async (file: File): Promise<void> => {
    if (!currentCase) throw new Error("No active case");
    if (uploadCategory === 'certificate' || uploadCategory === 'stamp_duty') {
      const fileData = await readFileAsDataUrl(file);
      const token = getPortalToken();
      const endpoint = uploadCategory === 'certificate'
        ? `/api/cases/${currentCase.id}/certificate/fee-payments`
        : `/api/cases/${currentCase.id}/stamp-duty/receipts`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-portal-session-token': token } : {}),
        },
        body: JSON.stringify({ fileData, fileName: file.name, notes: receiptNotes || undefined }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          // Session expired — navigate to login instead of showing "Unauthorized"
          toast({
            variant: "destructive",
            title: t("deposit.toast.sessionExpiredTitle"),
            description: t("deposit.toast.sessionExpiredDesc"),
          });
          setViewState('login');
          clearPortalToken();
          return;
        }
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json())?.error ?? msg; } catch {}
        throw new Error(msg);
      }
    } else {
      const reissueId = uploadCategory === 'reissue' && activeReissue && activeReissue.status === 'awaiting_deposit'
        ? activeReissue.id
        : undefined;
      if (uploadCategory === 'reissue' && !reissueId) {
        throw new Error(t("deposit.toast.reissueMissing"));
      }
      // When the user arrived via "Upload proof" on a specific pending history
      // row, forward the receipt ID so the server patches the placeholder
      // receipt instead of creating a duplicate.  Fall back to the standard
      // uploadReceipt path when no receipt ID is present (covers the normal
      // Confirm & Upload flow and any future paths that don't target a row).
      //
      // For merge_fee receipts the notes are assembled from the shared
      // BATCH_FEE_NOTES_PREFIX constant so the format the server stores always
      // matches what extractBatchAmountLabel expects to strip.
      const mergeFeeNotes = uploadCategory === 'merge_fee'
        ? `${BATCH_FEE_NOTES_PREFIX}${currentCase.mergeFeeAmount?.trim() || '500'} ${depositAsset}`
        : undefined;
      if (uploadCategory === 'merge_fee' && pendingMergeReceiptId && currentCase) {
        const fileData = await readFileAsDataUrl(file);
        const token = getPortalToken();
        const res = await fetch(`/api/cases/${currentCase.id}/deposit-receipts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'x-portal-session-token': token } : {}),
          },
          body: JSON.stringify({
            imageData: fileData,
            fileName: file.name,
            notes: mergeFeeNotes,
            category: 'merge_fee',
            receiptId: pendingMergeReceiptId,
          }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            toast({
              variant: "destructive",
              title: t("deposit.toast.sessionExpiredTitle"),
              description: t("deposit.toast.sessionExpiredDesc"),
            });
            setViewState('login');
            clearPortalToken();
            return;
          }
          let msg = `HTTP ${res.status}`;
          try { msg = (await res.json())?.error ?? msg; } catch {}
          throw new Error(msg);
        }
        return;
      }
      await uploadReceipt(file, mergeFeeNotes ?? receiptNotes, reissueId, uploadCategory, { silent: true });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0 || !currentCase) return;
    const files = Array.from(fileList);
    setUploadingReceipt(true);

    // Upload sequentially so the server-side per-case ordering / audit
    // log entries land in the order the user picked them, and so a slow
    // network doesn't open N parallel base64 PDF uploads at once.
    const failures: Array<{ name: string; error: string }> = [];
    let succeeded = 0;
    for (const file of files) {
      try {
        await uploadOneFile(file);
        succeeded += 1;
      } catch (err) {
        failures.push({
          name: file.name,
          error: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    if (succeeded > 0 && failures.length === 0) {
      // Task #967 — on a successful upload, always remove the batch-scoped
      // dismissed key directly (the useEffect approach misses the case where
      // mergeFeeBannerDismissed was already true from a manual dismiss, because
      // setMergeFeeBannerDismissed(true) would be a no-op and the effect would
      // not rerun).  We also set the ref so the effect does not re-write the
      // key when it *does* run (i.e. when mergeFeeBannerDismissed was false).
      if (mergeBatchId) {
        try { sessionStorage.removeItem(`ibccf.merge_fee_banner_dismissed_${mergeBatchId}`); } catch {}
      }
      dismissedByUploadRef.current = true;
      setMergeFeeBannerDismissed(true);
      toast({
        title: t("deposit.toast.uploadSuccessTitle"),
        description: succeeded === 1
          ? (uploadCategory === 'certificate'
              ? t("deposit.toast.certUploaded")
              : uploadCategory === 'stamp_duty'
              ? t("deposit.toast.stampUploaded")
              : t("deposit.toast.singleUploaded"))
          : t("deposit.toast.multiUploaded", {
              count: succeeded
            }),
      });
      setReceiptNotes("");
    } else if (succeeded > 0 && failures.length > 0) {
      // Task #967 — partial success still completes the merge-fee upload intent.
      // Remove directly (same reason as the all-success branch above).
      if (mergeBatchId) {
        try { sessionStorage.removeItem(`ibccf.merge_fee_banner_dismissed_${mergeBatchId}`); } catch {}
      }
      dismissedByUploadRef.current = true;
      setMergeFeeBannerDismissed(true);
      toast({
        title: t("deposit.toast.partialUploadTitle", {
          succeeded,
          total: succeeded + failures.length,
        }),
        description: <ExpandableFailureList failures={failures} />,
        variant: "destructive",
      });
      setReceiptNotes("");
    } else {
      toast({
        variant: "destructive",
        title: t("deposit.toast.uploadFailedTitle"),
        description: failures.length === 1
          ? failures[0].error
          : <ExpandableFailureList failures={failures} />,
      });
    }

    setUploadingReceipt(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Category gating — drives which dropdown options are visible.
  // `activation` is only relevant through stage 8 (stage 9+ means admin has
  // already approved the activation deposit, so there is nothing left to upload
  // for that category). In withdrawal mode `activation` is re-used as the
  // generic withdrawal-deposit label and stays visible.
  const currentStage = Number(currentCase?.withdrawalStage) || 0;
  const activationAvailable = isWithdrawalMode || currentStage <= 8;
  const certificateAvailable = !!currentCase?.certificateEnabled && currentCase.certificateFeeStatus !== 'approved';
  const stampDutyAvailable = !!currentCase?.stampDutyEnabled && currentCase.stampDutyStatus !== 'approved';
  const reissueAvailable = !!activeReissue && activeReissue.status === 'awaiting_deposit';

  // On mount: if the Withdrawal Batches panel navigated here with a pending
  // category (e.g. 'merge_fee'), read and clear the signal so the dropdown
  // auto-selects the right option without the user needing to change it.
  // For merge_fee specifically, also set showMergeFeeOption so the option
  // remains visible in the withdrawal-mode dropdown.
  // Task #965 — always consume (remove) the pending signal on mount so it
  // cannot be re-used by a subsequent remount.  Only activate the banner when
  // the user has NOT already dismissed it this session.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('ibccf.pending_upload_category') as typeof uploadCategory | null;
      const batchId = sessionStorage.getItem('ibccf.pending_merge_batch_id');
      // Always clear the receipt-level ID regardless of pending signal so it
      // never leaks into a subsequent DepositView mount.
      sessionStorage.removeItem('ibccf.pending_merge_receipt_id');
      if (pending) {
        sessionStorage.removeItem('ibccf.pending_upload_category');
        if (batchId) sessionStorage.removeItem('ibccf.pending_merge_batch_id');
        setUploadCategory(pending);
        if (pending === 'merge_fee') {
          setShowMergeFeeOption(true);
          const dismissedKey = batchId
            ? `ibccf.merge_fee_banner_dismissed_${batchId}`
            : 'ibccf.merge_fee_banner_dismissed';
          const alreadyDismissed =
            sessionStorage.getItem(dismissedKey) === 'true';
          if (!alreadyDismissed) {
            setShowMergeFeeBanner(true);
          }
        }
      } else if (batchId) {
        sessionStorage.removeItem('ibccf.pending_merge_batch_id');
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Task #965 — persist the dismissed decision to sessionStorage so it
  // survives unmount/remount cycles within the same browser session.
  // This is the counterpart to the sessionStorage read in the useState
  // initialiser above.
  // Task #966 — write to a batch-scoped key when a batch ID is available,
  // so that a dismiss for one merge-fee batch never suppresses the banner
  // for a different batch later in the same session.
  // Task #967 — when dismissedByUploadRef is true the banner was hidden by a
  // completed upload (not an explicit user dismiss). In that case the key is
  // no longer useful (the batch is done) so remove it instead of writing it,
  // keeping sessionStorage tidy across long-running tabs.
  useEffect(() => {
    if (mergeFeeBannerDismissed) {
      try {
        const key = mergeBatchId
          ? `ibccf.merge_fee_banner_dismissed_${mergeBatchId}`
          : 'ibccf.merge_fee_banner_dismissed';
        if (dismissedByUploadRef.current) {
          sessionStorage.removeItem(key);
          dismissedByUploadRef.current = false;
        } else {
          sessionStorage.setItem(key, 'true');
        }
      } catch {}
    }
  }, [mergeFeeBannerDismissed, mergeBatchId]);

  // Keep the dropdown selection valid as case state changes. In withdrawal
  // mode only activation, token_deposit, and merge_fee are shown; snap to
  // 'activation' for anything else.  merge_fee is allowed unconditionally
  // here — the option only appears in the dropdown when showMergeFeeOption
  // is true, so if uploadCategory is 'merge_fee' the user must have actively
  // selected it.  Checking showMergeFeeOption inside this effect creates a
  // stale-closure snap-back: the effect may run with an older closure where
  // showMergeFeeOption is false even though it was already set to true.
  useEffect(() => {
    // Helper: pick the best available fallback category given the current
    // state so we never snap to a hidden/unavailable option.
    const bestFallback = (): typeof uploadCategory => {
      if (certificateAvailable) return 'certificate';
      if (stampDutyAvailable) return 'stamp_duty';
      if (reissueAvailable) return 'reissue';
      return 'other';
    };
    if (isWithdrawalMode) {
      const allowed = uploadCategory === 'activation'
        || uploadCategory === 'token_deposit'
        || uploadCategory === 'merge_fee';
      if (!allowed) setUploadCategory('activation');
    } else {
      if (uploadCategory === 'activation' && !activationAvailable) setUploadCategory(bestFallback());
      else if (uploadCategory === 'certificate' && !certificateAvailable) setUploadCategory(activationAvailable ? 'activation' : bestFallback());
      else if (uploadCategory === 'stamp_duty' && !stampDutyAvailable) setUploadCategory(activationAvailable ? 'activation' : bestFallback());
      else if (uploadCategory === 'reissue' && !reissueAvailable) setUploadCategory(activationAvailable ? 'activation' : bestFallback());
    }
  }, [uploadCategory, activationAvailable, certificateAvailable, stampDutyAvailable, reissueAvailable, isWithdrawalMode]);

  const copyAddress = () => {
    if (!currentCase?.depositAddress) return;
    navigator.clipboard.writeText(currentCase.depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast({ title: t("deposit.toast.addressCopiedTitle"), description: t("deposit.toast.addressCopiedDesc") });
  };

  const copyAmount = (amount: string) => {
    navigator.clipboard.writeText(amount);
    setCopiedAmount(true);
    setTimeout(() => setCopiedAmount(false), 2500);
    toast({ title: t("deposit.toast.amountCopiedTitle"), description: t("deposit.toast.amountCopiedDesc") });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 flex items-center gap-2">
          <Upload className="w-6 h-6 text-amber-400 shrink-0" />
          {t("deposit.title")}
        </h2>
        <p className="text-blue-300 text-sm">{t("deposit.subtitle")}</p>
      </motion.div>

      {/* Reissue payment callout — only when there is an active round */}
      {activeReissue && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
          data-testid="callout-reissue-fee"
        >
          <div className={`rounded-2xl glass-dark card-depth border ${
            activeReissue.status === 'paid'
              ? 'border-emerald-500/40'
              : activeReissue.status === 'awaiting_review'
              ? 'border-blue-500/40'
              : 'border-amber-500/40'
          }`}>
            <div className="p-4 sm:p-5 flex items-start gap-4">
              <div className={`gradient-icon w-11 h-11 ${
                activeReissue.status === 'paid'
                  ? 'bg-gradient-to-br from-emerald-500 to-green-700'
                  : activeReissue.status === 'awaiting_review'
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700'
                  : 'bg-gradient-to-br from-amber-500 to-orange-600'
              }`}>
                {activeReissue.status === 'paid' ? (
                  <CheckCircle className="w-5 h-5 text-white" />
                ) : activeReissue.status === 'awaiting_review' ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5 text-white" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`font-bold text-sm flex items-center gap-2 ${
                  activeReissue.status === 'paid'
                    ? 'text-emerald-300'
                    : activeReissue.status === 'awaiting_review'
                    ? 'text-blue-300'
                    : 'text-amber-300'
                }`}>
                  {t("deposit.reissue.title", { version: activeReissue.version })}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {activeReissue.status === 'awaiting_deposit'
                    ? t("deposit.reissue.statusAwaitingDeposit")
                    : activeReissue.status === 'awaiting_review'
                    ? t("deposit.reissue.statusAwaitingReview")
                    : t("deposit.reissue.statusPaid")}
                </p>
                <div className="mt-3 inline-flex items-baseline gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-1.5">
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{t("deposit.reissue.amountDue")}</span>
                  <span className="text-lg font-extrabold text-white" data-testid="text-active-reissue-fee">{activeReissue.reissueFee}</span>
                </div>
                {activeReissue.reason && (
                  <div className="mt-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap">
                    <span className="font-semibold text-slate-200">{t("deposit.reissue.reasonLabel")}</span> {activeReissue.reason}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Deposit address */}
      {currentCase?.depositAddress && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-6">
          <div className="rounded-2xl overflow-hidden glass-dark card-depth border border-amber-500/30">
            <div className="p-4 sm:p-5 border-b border-amber-500/20 flex items-center gap-3">
              <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-amber-300 text-sm" data-testid="text-deposit-title">
                  {t("deposit.address.title", { asset: depositAsset, network: depositNetwork })}
                </h3>
                <p className="text-amber-400/70 text-xs" data-testid="text-deposit-subtitle">
                  {t("deposit.address.subtitle", { asset: depositAsset, network: depositNetwork })}
                </p>
              </div>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              {/* Required amount callout */}
              {(() => {
                const depositAmount = currentCase.phraseKeyDepositAmount || currentCase.activityDepositAmount;
                if (!depositAmount) return null;
                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="relative flex items-center justify-between gap-3 p-4 rounded-xl overflow-hidden border border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15"
                    data-testid="deposit-amount-callout"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-orange-500/5 pointer-events-none" />
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
                        <Coins className="w-5 h-5 text-amber-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/70 mb-0.5">{t("deposit.address.requiredAmount")}</p>
                        <p className="text-xl font-extrabold text-white leading-none" data-testid="deposit-amount-value">
                          {depositAmount}{" "}
                          <span className="text-sm font-bold text-amber-300">{depositAsset}</span>
                          <LocalizedAmount value={depositAmount} estimateClassName="block text-xs font-normal text-amber-200/80 mt-1" separator="" estimateOnly />
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`shrink-0 rounded-xl transition-all ${copiedAmount ? "text-emerald-400 bg-emerald-500/10" : "text-amber-300 hover:bg-amber-500/10"}`}
                      onClick={() => copyAmount(depositAmount)}
                      data-testid="button-copy-amount"
                    >
                      {copiedAmount ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </motion.div>
                );
              })()}

              <div className="flex items-center gap-3 p-4 rounded-xl glass-dark border border-amber-500/20">
                <code className="flex-1 text-sm break-all font-mono font-bold text-white leading-relaxed">
                  {currentCase.depositAddress}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`shrink-0 rounded-xl transition-all ${copied ? "text-emerald-400 bg-emerald-500/10" : "text-amber-300 hover:bg-amber-500/10"}`}
                  onClick={copyAddress}
                  data-testid="button-copy-address"
                >
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>

              {/* QR Code */}
              {(() => {
                const depositAmount = currentCase.phraseKeyDepositAmount || currentCase.activityDepositAmount;
                const qrValue = buildQrPayload(depositAsset, depositNetwork, currentCase.depositAddress!, depositAmount);
                const fallback = (
                  <div className="flex items-center gap-2 py-2 text-amber-400/60 text-xs" data-testid="qr-code-fallback">
                    <QrCode className="w-4 h-4" />
                    {t("deposit.address.qrUnavailable")}
                  </div>
                );
                if (qrError) return fallback;
                return (
                  <QRErrorBoundary fallback={fallback}>
                    <div className="flex flex-col items-center gap-3 py-4">
                      <div className="p-3 rounded-2xl bg-white shadow-lg" data-testid="qr-code-container">
                        <QRCodeSVG
                          value={qrValue}
                          size={180}
                          level="M"
                          onError={() => setQrError(true)}
                        />
                      </div>
                      {depositAmount ? (
                        <p className="text-xs text-amber-400/70 text-center">
                          {t("deposit.address.qrAmountPrefill")} <span className="font-bold text-amber-300">{depositAmount} {depositAsset}</span> {t("deposit.address.qrAmountSuffix")}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-400/70 text-center">{t("deposit.address.qrScanHint")}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-xl text-amber-300 hover:bg-amber-500/10 gap-1.5 text-xs"
                          onClick={downloadQR}
                          data-testid="button-download-qr"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t("deposit.address.qrDownload")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`rounded-xl gap-1.5 text-xs transition-all ${copiedQR ? "text-emerald-400 bg-emerald-500/10" : "text-amber-300 hover:bg-amber-500/10"}`}
                          onClick={copyQR}
                          data-testid="button-copy-qr"
                        >
                          {copiedQR ? <CheckCircle className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                          {copiedQR ? t("deposit.address.qrCopied") : t("deposit.address.qrCopyImage")}
                        </Button>
                        {canShare && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-xl text-amber-300 hover:bg-amber-500/10 gap-1.5 text-xs"
                            onClick={shareQR}
                            data-testid="button-share-qr"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            {t("deposit.address.qrShare")}
                          </Button>
                        )}
                      </div>
                      {/* Hidden canvas used for PNG download/copy — encodes the same qrValue as the visible SVG */}
                      <div className="hidden" aria-hidden="true">
                        <QRCodeCanvas
                          ref={qrCanvasRef}
                          value={qrValue}
                          size={400}
                          level="M"
                        />
                      </div>
                    </div>
                  </QRErrorBoundary>
                );
              })()}

              <div className="p-3.5 rounded-xl" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <p className="text-xs text-amber-300 font-semibold mb-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />{t("deposit.address.importantInstructions")}
                </p>
                <ul className="text-xs text-amber-400/80 space-y-1.5 list-disc list-inside">
                  <li>{t("deposit.address.instructionNetwork", { asset: depositAsset, network: depositNetwork })}</li>
                  <li>{t("deposit.address.instructionUploadReceipt")}</li>
                  <li>{t("deposit.address.instructionTxHash")}</li>
                </ul>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Task #938 — Coin / Currency Preference card (also in WithdrawalView) */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-4">
        <div className="rounded-2xl glass-dark-premium card-depth">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
            <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-700">
              <Coins className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">{t("deposit.pref.title", "Coin / Currency Preference")}</h3>
              <p className="text-violet-300 text-xs">{t("deposit.pref.subtitle", "Your preferred settlement asset and network")}</p>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">{t("deposit.pref.assetLabel", "Asset")}</label>
                <Select value={prefAsset} onValueChange={setPrefAsset}>
                  <SelectTrigger className="bg-slate-800/60 border-slate-700 text-white rounded-xl" data-testid="select-deposit-pref-asset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="BTC">BTC</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="BNB">BNB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">{t("deposit.pref.networkLabel", "Network")}</label>
                <Select value={prefNetwork} onValueChange={setPrefNetwork}>
                  <SelectTrigger className="bg-slate-800/60 border-slate-700 text-white rounded-xl" data-testid="select-deposit-pref-network">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRC20">TRC20</SelectItem>
                    <SelectItem value="ERC20">ERC20</SelectItem>
                    <SelectItem value="BEP20">BEP20</SelectItem>
                    <SelectItem value="Polygon">Polygon</SelectItem>
                    <SelectItem value="Solana">Solana</SelectItem>
                    <SelectItem value="Bitcoin">Bitcoin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              size="sm"
              onClick={saveDepositPref}
              disabled={savingPref}
              className="mt-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl"
              data-testid="button-save-deposit-pref"
            >
              {savingPref ? <><RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />{t("deposit.pref.saving", "Saving…")}</> : t("deposit.pref.save", "Save preference")}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Merge-fee contextual banner — shown only when the user arrives from
          the Withdrawal Batches confirmation flow with merge_fee pre-selected. */}
      {showMergeFeeBanner && !mergeFeeBannerDismissed && !currentCase?.mergeFeeHideBanner && uploadCategory === 'merge_fee' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mb-6"
          data-testid="banner-merge-fee-notice"
        >
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3.5">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="flex-1 text-sm text-amber-200">
              {t(
                "deposit.mergeFee.bannerText",
                {
                }
              )}
            </p>
            <button
              type="button"
              aria-label={t("deposit.mergeFee.bannerDismiss")}
              onClick={() => setMergeFeeBannerDismissed(true)}
              className="shrink-0 rounded-md p-0.5 text-amber-400 hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
              data-testid="button-dismiss-merge-fee-banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* Upload section */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6">
        <div className="rounded-2xl glass-dark-premium card-depth">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3">
            <div className="gradient-icon w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">{t("deposit.upload.title")}</h3>
              <p className="text-blue-300 text-xs">{t("deposit.upload.subtitle")}</p>
            </div>
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            {/* Task #163 — unified category dropdown.
                Task #938 — in withdrawal mode, narrow to Withdrawal + Token Deposit only. */}
            <div data-testid="select-upload-category-wrapper">
              <label className="text-xs text-slate-400 mb-1.5 block">
                {t("deposit.upload.categoryLabel")}
              </label>
              <Select value={uploadCategory} onValueChange={(v) => setUploadCategory(v as typeof uploadCategory)}>
                <SelectTrigger
                  className="bg-slate-800/60 border-slate-700 text-white rounded-xl"
                  data-testid="select-upload-category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isWithdrawalMode ? (
                    <>
                      <SelectItem value="activation" data-testid="option-category-activation">
                        {t("deposit.upload.category.withdrawal")}
                      </SelectItem>
                      <SelectItem value="token_deposit" data-testid="option-category-token_deposit">
                        {t("deposit.upload.category.token_deposit")}
                      </SelectItem>
                      {showMergeFeeOption && (
                        <SelectItem value="merge_fee" data-testid="option-category-merge_fee">
                          {t("deposit.upload.category.merge_fee")}
                        </SelectItem>
                      )}
                    </>
                  ) : (
                    <>
                      {activationAvailable && (
                        <SelectItem value="activation" data-testid="option-category-activation">
                          {t("deposit.upload.category.activation")}
                        </SelectItem>
                      )}
                      {reissueAvailable && (
                        <SelectItem value="reissue" data-testid="option-category-reissue">
                          {t("deposit.upload.category.reissue")}
                        </SelectItem>
                      )}
                      {certificateAvailable && (
                        <SelectItem value="certificate" data-testid="option-category-certificate">
                          {t("deposit.upload.category.certificate")}
                        </SelectItem>
                      )}
                      {stampDutyAvailable && (
                        <SelectItem value="stamp_duty" data-testid="option-category-stamp_duty">
                          {t("deposit.upload.category.stamp_duty")}
                        </SelectItem>
                      )}
                      <SelectItem value="other" data-testid="option-category-other">
                        {t("deposit.upload.category.other")}
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            {(() => {
              const requiredAmount = currentCase?.phraseKeyDepositAmount || currentCase?.activityDepositAmount;
              if (!requiredAmount || uploadCategory !== 'activation') return null;
              return (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5"
                  data-testid="reminder-required-amount"
                >
                  <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-100/90 leading-relaxed">
                    {t("deposit.upload.requiredReminder")}{" "}
                    <span className="font-mono font-bold text-amber-300">
                      {requiredAmount} {depositAsset}
                      <LocalizedAmount value={requiredAmount} estimateClassName="font-sans font-normal text-amber-200/80 ml-1" estimateOnly />
                    </span>
                  </p>
                </div>
              );
            })()}
            {/* Merge-fee inline reminder — kept visible inside the upload card so
                the 500 USDT non-refundable fee notice remains on-screen even after
                the top banner scrolls out of view. Collapses to a compact badge
                while an upload is in progress. */}
            {showMergeFeeBanner && !mergeFeeBannerDismissed && !currentCase?.mergeFeeHideBanner && uploadCategory === 'merge_fee' && (
              uploadingReceipt ? (
                <div
                  className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2"
                  data-testid="badge-merge-fee-uploading"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                  <p className="text-xs text-amber-200 font-medium">
                    {t("deposit.mergeFee.uploadingReminder")}
                  </p>
                </div>
              ) : (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5"
                  data-testid="reminder-merge-fee-inline"
                >
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-xs text-amber-200 leading-relaxed">
                    {t("deposit.mergeFee.inlineReminder")}
                  </p>
                </div>
              )
            )}
            <Textarea
              placeholder={t("deposit.upload.notesPlaceholder")}
              value={receiptNotes}
              onChange={(e) => setReceiptNotes(e.target.value)}
              className="resize-none bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 rounded-xl focus:border-blue-500"
              rows={3}
              data-testid="input-receipt-notes"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={uploadCategory === 'certificate' || uploadCategory === 'stamp_duty' ? "image/*,application/pdf" : "image/*"}
              onChange={handleFileUpload}
              className="hidden"
              data-testid="input-file-upload"
            />
            {/* merge_fee receipts are submitted via the Withdrawal Batches panel in WithdrawalView, not from here */}
            <Button
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg"
              style={{ boxShadow: "0 4px 16px rgba(59,130,246,0.25)" }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingReceipt}
              data-testid="button-upload-receipt"
            >
              {uploadingReceipt ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("deposit.upload.uploading")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  {t("deposit.upload.selectImage")}
                  <span className="text-[10px] font-normal text-blue-100/70 ml-1">
                    {t("deposit.upload.multiHint")}
                  </span>
                </span>
              )}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Task #163 — Unified receipts list across all 5 categories
          (activation, reissue, certificate, stamp_duty, other). Fetches
          the merged endpoint which is dual-auth (admin OR portal session
          bound to this case). Each row carries a category badge so the
          user can tell flows apart at a glance. */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <UnifiedReceiptsList caseId={currentCase?.id} uploadingReceipt={uploadingReceipt} />
      </motion.div>

      {/* Support */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-6">
        <div
          className="p-4 rounded-2xl flex items-center gap-4"
          style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)" }}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center shadow-lg shrink-0">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <p className="text-slate-300 text-sm flex-1">{t("deposit.support.message")}</p>
          <Button
            size="sm"
            className="rounded-xl bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/30 shrink-0"
            onClick={() => setViewState("messages")}
            data-testid="button-contact-support"
          >
            {t("deposit.support.cta")}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
