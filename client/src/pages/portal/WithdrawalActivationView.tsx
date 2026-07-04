import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  PartyPopper,
  Wallet,
  ShieldCheck,
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Send,
  MailCheck,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";
import { getPortalToken } from "@/lib/portalSession";

// Verbatim copy required by Task #66 — do NOT translate or rephrase.
const BLOCK_MESSAGE =
  "You need to deposit the minimum amount into your token wallet before withdrawal processing can run.";

// Common asset / network options for the withdrawal-wallet selectors.
// "__custom__" lets users fall back to a free-text input for anything
// not in the curated list so we don't accidentally lock out exotic
// chains. Server still accepts any string; this is purely a UX aid.
const ASSET_OPTIONS = [
  "USDT",
  "USDC",
  "BTC",
  "ETH",
  "MATIC",
  "BNB",
  "SOL",
  "XRP",
  "TRX",
  "DAI",
  "BUSD",
] as const;
const NETWORK_OPTIONS = [
  "Bitcoin",
  "TRC20",
  "ERC20",
  "Polygon",
  "BSC",
  "Solana",
  "Arbitrum",
  "Optimism",
  "Avalanche",
  "XRP Ledger",
] as const;
const CUSTOM_VALUE = "__custom__";

type ActivationStatus =
  | 'pending_address'
  | 'awaiting_token'
  | 'awaiting_deposit'
  | 'awaiting_admin_approval'
  | 'approved'
  | 'rejected';

interface ActivationState {
  status: ActivationStatus;
  withdrawalAddressSubmitted?: string | null;
  withdrawalDetailsAsset?: string | null;
  withdrawalDetailsNetwork?: string | null;
  withdrawalDetailsAmount?: string | null;
  withdrawalDetailsMemo?: string | null;
  minUsdt: string;
  securityTokenRequired: boolean;
  receiptId?: number | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  addressSubmittedAt?: string | null;
  tokenVerifiedAt?: string | null;
  tokenLive: boolean;
  tokenIssuedAt?: string | null;
  tokenExpiresAt?: string | null;
  tokenAttempts: number;
  tokenMaxAttempts: number;
  depositAddress?: string | null;
  depositAsset?: string | null;
  depositNetwork?: string | null;
}

async function authedJson(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; body: any }> {
  const portalToken = getPortalToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (portalToken) headers['x-portal-session-token'] = portalToken;
  const res = await fetch(url, { ...init, headers });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* may be empty */
  }
  return { res, body };
}

export function WithdrawalActivationView() {
  const { currentCase, setViewState } = usePortal();
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const [state, setState] = useState<ActivationState | null>(null);
  const [loading, setLoading] = useState(true);

  // Address form
  const [address, setAddress] = useState("");
  const [asset, setAsset] = useState("USDT");
  const [network, setNetwork] = useState("TRC20");
  const [assetCustom, setAssetCustom] = useState(false);
  const [networkCustom, setNetworkCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [submittingAddress, setSubmittingAddress] = useState(false);
  const hydratedRef = useRef(false);

  // OTP
  const [otp, setOtp] = useState("");
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Receipt
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const caseId = currentCase?.id;

  const loadState = useMemo(
    () => async () => {
      if (!caseId) return;
      try {
        const { res, body } = await authedJson(
          `/api/cases/${caseId}/withdrawal-activation`,
        );
        if (res.ok && body) {
          setState(body as ActivationState);
          if (!hydratedRef.current) {
            hydratedRef.current = true;
            if (body.withdrawalAddressSubmitted) setAddress(body.withdrawalAddressSubmitted);
            if (body.withdrawalDetailsAsset) {
              setAsset(body.withdrawalDetailsAsset);
              if (!ASSET_OPTIONS.includes(body.withdrawalDetailsAsset as typeof ASSET_OPTIONS[number])) {
                setAssetCustom(true);
              }
            }
            if (body.withdrawalDetailsNetwork) {
              setNetwork(body.withdrawalDetailsNetwork);
              if (!NETWORK_OPTIONS.includes(body.withdrawalDetailsNetwork as typeof NETWORK_OPTIONS[number])) {
                setNetworkCustom(true);
              }
            }
            if (body.withdrawalDetailsAmount) setAmount(body.withdrawalDetailsAmount);
            if (body.withdrawalDetailsMemo) setMemo(body.withdrawalDetailsMemo);
          }
        }
      } catch {
        /* network errors — leave existing state */
      } finally {
        setLoading(false);
      }
    },
    // We only want this to depend on caseId — the form fields are
    // intentionally not in the dep list (they're hydrated once).
    [caseId],
  );

  useEffect(() => {
    loadState();
    const t = setInterval(loadState, 15000);
    return () => clearInterval(t);
  }, [loadState]);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  if (!currentCase) {
    return null;
  }

  const stage = parseInt(currentCase.withdrawalStage || '0', 10);
  if (!Number.isFinite(stage) || stage < 14) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-blue-200">
        <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-60" />
        <h2 className="text-2xl font-semibold text-white mb-2">{t("withdrawalActivation.notYetTitle")}</h2>
        <p className="text-sm opacity-80">
          {t("withdrawalActivation.notYetDesc")}
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => setViewState('dashboard')}
        >
          {t("withdrawalActivation.backToDashboard")}
        </Button>
      </div>
    );
  }

  const status: ActivationStatus = state?.status ?? 'pending_address';
  const minUsdt = state?.minUsdt ?? '0';
  const tokenRequired = state?.securityTokenRequired ?? true;

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  async function handleSubmitAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) return;
    if (!address.trim() || !asset.trim() || !network.trim() || !amount.trim()) {
      toast({
        variant: "destructive",
        title: t("withdrawalActivation.toasts.missingTitle"),
        description: t("withdrawalActivation.toasts.missingDesc"),
      });
      return;
    }
    setSubmittingAddress(true);
    try {
      const { res, body } = await authedJson(
        `/api/cases/${caseId}/withdrawal-activation/address`,
        {
          method: 'POST',
          body: JSON.stringify({
            withdrawalAddressSubmitted: address.trim(),
            withdrawalDetailsAsset: asset.trim(),
            withdrawalDetailsNetwork: network.trim(),
            withdrawalDetailsAmount: amount.trim(),
            withdrawalDetailsMemo: memo.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: t("withdrawalActivation.toasts.addressFailedTitle"),
          description: body?.error || t("withdrawalActivation.toasts.addressFailedDesc"),
        });
        return;
      }
      toast({
        title: t("withdrawalActivation.toasts.addressSavedTitle"),
        description: t("withdrawalActivation.toasts.addressSavedDesc"),
      });
      await loadState();
    } finally {
      setSubmittingAddress(false);
    }
  }

  async function handleRequestOtp() {
    if (!caseId) return;
    setRequestingOtp(true);
    try {
      const { res, body } = await authedJson(
        `/api/cases/${caseId}/withdrawal-activation/token/request`,
        { method: 'POST' },
      );
      if (!res.ok) {
        if (res.status === 429 && typeof body?.retryAfter === 'number') {
          setResendCooldown(body.retryAfter);
        }
        toast({
          variant: "destructive",
          title: t("withdrawalActivation.toasts.codeNotSentTitle"),
          description: body?.error || t("withdrawalActivation.toasts.codeNotSentDesc"),
        });
        return;
      }
      setResendCooldown(60);
      toast({
        title: t("withdrawalActivation.toasts.codeSentTitle"),
        description: t("withdrawalActivation.toasts.codeSentDesc", { caseId }),
      });
      await loadState();
    } finally {
      setRequestingOtp(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId) return;
    if (!/^\d{6}$/.test(otp)) {
      toast({
        variant: "destructive",
        title: t("withdrawalActivation.toasts.invalidCodeTitle"),
        description: t("withdrawalActivation.toasts.invalidCodeDesc"),
      });
      return;
    }
    setVerifyingOtp(true);
    try {
      const { res, body } = await authedJson(
        `/api/cases/${caseId}/withdrawal-activation/token/verify`,
        { method: 'POST', body: JSON.stringify({ code: otp }) },
      );
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: t("withdrawalActivation.toasts.verifyFailedTitle"),
          description: body?.error || t("withdrawalActivation.toasts.verifyFailedDesc"),
        });
        return;
      }
      toast({ title: t("withdrawalActivation.toasts.verifiedTitle"), description: t("withdrawalActivation.toasts.verifiedDesc") });
      setOtp("");
      await loadState();
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function handleReceiptUpload(file: File) {
    if (!caseId) return;
    const MAX = 10 * 1024 * 1024; // 10MB — parity with the standard deposit-receipts uploader.
    const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (file.size === 0 || file.size > MAX) {
      toast({
        variant: "destructive",
        title: t("withdrawalActivation.toasts.fileRejectedTitle"),
        description: file.size === 0 ? t("withdrawalActivation.toasts.fileEmpty") : t("withdrawalActivation.toasts.fileTooLarge"),
      });
      return;
    }
    if (file.type && !ALLOWED_MIME.includes(file.type)) {
      toast({
        variant: "destructive",
        title: t("withdrawalActivation.toasts.unsupportedTitle"),
        description: t("withdrawalActivation.toasts.unsupportedDesc"),
      });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('read failed'));
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(file);
      });
      // Sealed-safe activation receipt endpoint — bypasses the requireUnsealed
      // guard on /:id/deposit-receipts so stage-14 sealed cases can still
      // complete activation.
      const { res: linkRes, body: linkBody } = await authedJson(
        `/api/cases/${caseId}/withdrawal-activation/receipt-upload`,
        {
          method: 'POST',
          body: JSON.stringify({
            imageData: dataUrl,
            fileName: file.name,
            notes: receiptNotes || 'Withdrawal activation deposit',
          }),
        },
      );
      if (!linkRes.ok) {
        toast({
          variant: "destructive",
          title: t("withdrawalActivation.toasts.receiptAttachedTitle"),
          description: linkBody?.error || t("withdrawalActivation.toasts.receiptAttachedDesc"),
        });
      } else {
        toast({
          title: t("withdrawalActivation.toasts.receiptSubmittedTitle"),
          description: t("withdrawalActivation.toasts.receiptSubmittedDesc"),
        });
        setReceiptNotes("");
      }
      await loadState();
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("withdrawalActivation.toasts.uploadFailedTitle"),
        description: err instanceof Error ? err.message : t("withdrawalActivation.toasts.uploadFailedDesc"),
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const showAddressStep = true;
  const addressLocked =
    status !== 'pending_address' || Boolean(state?.withdrawalAddressSubmitted);
  const showTokenStep =
    tokenRequired &&
    (status === 'awaiting_token' || status === 'awaiting_deposit' ||
     status === 'awaiting_admin_approval' || status === 'approved' || status === 'rejected');
  const tokenComplete = Boolean(state?.tokenVerifiedAt) || status === 'awaiting_deposit' ||
    status === 'awaiting_admin_approval' || status === 'approved';
  const showDepositStep = status === 'awaiting_deposit' || status === 'awaiting_admin_approval' ||
    status === 'rejected' || status === 'approved';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-blue-500/10 to-purple-500/10 p-6"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-emerald-500/20 p-3 ring-1 ring-emerald-400/40">
            <PartyPopper className="w-7 h-7 text-emerald-300" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-semibold text-white">
              {t("withdrawalActivation.hero.title")}
            </h2>
            <p className="text-sm text-blue-100/85 mt-2 leading-relaxed">
              {t("withdrawalActivation.hero.body")}
            </p>
          </div>
        </div>
      </motion.div>

      {status === 'approved' ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 p-5 flex items-start gap-3"
        >
          <CheckCircle className="w-6 h-6 text-emerald-300 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-emerald-200">
              {t("withdrawalActivation.approved.title")}
            </div>
            <p className="text-sm text-emerald-100/85 mt-1">
              {t("withdrawalActivation.approved.body")}
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/15 p-5 flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-amber-300 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-200">{t("withdrawalActivation.actionRequired")}</div>
            <p className="text-sm text-amber-100/90 mt-1" data-testid="text-activation-block-message">
              {BLOCK_MESSAGE}
            </p>
          </div>
        </div>
      )}

      {status === 'rejected' && state?.rejectionReason ? (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-5 flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-rose-300 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-rose-200">
              {t("withdrawalActivation.rejected.title")}
            </div>
            <p className="text-sm text-rose-100/85 mt-1">
              {t("withdrawalActivation.rejected.noteLabel")}: {state.rejectionReason}
            </p>
          </div>
        </div>
      ) : null}

      {/* Step 1: Wallet address */}
      {showAddressStep ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-blue-300" />
              <h3 className="text-lg font-semibold text-white">
                {t("withdrawalActivation.step1.title")}
              </h3>
            </div>
            {addressLocked ? (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/40">
                {t("withdrawalActivation.badges.submitted")}
              </Badge>
            ) : (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-400/40">
                {t("withdrawalActivation.badges.required")}
              </Badge>
            )}
          </header>
          <p className="text-sm text-blue-100/80">
            {t("withdrawalActivation.step1.description")}
          </p>
          <div
            className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            data-testid="notice-bind-same-wallet"
          >
            <strong className="font-semibold text-amber-200">
              {t("withdrawalActivation.step1.sameWalletNoticeTitle")}
            </strong>{" "}
            {t("withdrawalActivation.step1.sameWalletNoticeBody")}
          </div>
          <form onSubmit={handleSubmitAddress} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-blue-300 mb-1 block">{t("withdrawalActivation.step1.walletAddress")}</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("withdrawalActivation.step1.walletAddressPlaceholder")}
                disabled={addressLocked || submittingAddress || loading}
                data-testid="input-withdrawal-address"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-blue-300 mb-1 block">{t("withdrawalActivation.step1.asset")}</label>
              <Select
                value={assetCustom ? CUSTOM_VALUE : (asset || "")}
                onValueChange={(v) => {
                  if (v === CUSTOM_VALUE) {
                    setAssetCustom(true);
                    setAsset("");
                  } else {
                    setAssetCustom(false);
                    setAsset(v);
                  }
                }}
                disabled={addressLocked || submittingAddress || loading}
              >
                <SelectTrigger data-testid="select-withdrawal-asset">
                  <SelectValue placeholder="USDT" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>{t("withdrawalActivation.step1.otherOption")}</SelectItem>
                </SelectContent>
              </Select>
              {assetCustom && (
                <Input
                  value={asset}
                  onChange={(e) => setAsset(e.target.value.toUpperCase())}
                  placeholder={t("withdrawalActivation.step1.assetCustomPlaceholder")}
                  disabled={addressLocked || submittingAddress || loading}
                  className="mt-2"
                  data-testid="input-withdrawal-asset"
                />
              )}
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-blue-300 mb-1 block">{t("withdrawalActivation.step1.network")}</label>
              <Select
                value={networkCustom ? CUSTOM_VALUE : (network || "")}
                onValueChange={(v) => {
                  if (v === CUSTOM_VALUE) {
                    setNetworkCustom(true);
                    setNetwork("");
                  } else {
                    setNetworkCustom(false);
                    setNetwork(v);
                  }
                }}
                disabled={addressLocked || submittingAddress || loading}
              >
                <SelectTrigger data-testid="select-withdrawal-network">
                  <SelectValue placeholder="TRC20" />
                </SelectTrigger>
                <SelectContent>
                  {NETWORK_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>{t("withdrawalActivation.step1.otherOption")}</SelectItem>
                </SelectContent>
              </Select>
              {networkCustom && (
                <Input
                  value={network}
                  onChange={(e) => setNetwork(e.target.value.toUpperCase())}
                  placeholder={t("withdrawalActivation.step1.networkCustomPlaceholder")}
                  disabled={addressLocked || submittingAddress || loading}
                  className="mt-2"
                  data-testid="input-withdrawal-network"
                />
              )}
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-blue-300 mb-1 block">{t("withdrawalActivation.step1.amount")}</label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("withdrawalActivation.step1.amountPlaceholder")}
                disabled={addressLocked || submittingAddress || loading}
                data-testid="input-withdrawal-amount"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase tracking-wide text-blue-300 mb-1 block">{t("withdrawalActivation.step1.memo")}</label>
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={t("withdrawalActivation.step1.memoPlaceholder")}
                disabled={addressLocked || submittingAddress || loading}
                data-testid="input-withdrawal-memo"
              />
            </div>
            {!addressLocked ? (
              <div className="md:col-span-2 flex justify-end">
                <Button
                  type="submit"
                  disabled={submittingAddress || loading}
                  data-testid="button-submit-withdrawal-address"
                >
                  {submittingAddress ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("withdrawalActivation.step1.saving")}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" /> {t("withdrawalActivation.step1.submit")}
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {/* Step 2: OTP */}
      {showTokenStep ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MailCheck className="w-5 h-5 text-blue-300" />
              <h3 className="text-lg font-semibold text-white">
                {t("withdrawalActivation.step2.title")}
              </h3>
            </div>
            {tokenComplete ? (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/40">
                {t("withdrawalActivation.badges.verified")}
              </Badge>
            ) : (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-400/40">
                {t("withdrawalActivation.badges.required")}
              </Badge>
            )}
          </header>
          <p className="text-sm text-blue-100/80">
            {t("withdrawalActivation.step2.description")}
          </p>
          {!tokenComplete ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleRequestOtp}
                  disabled={requestingOtp || resendCooldown > 0}
                  data-testid="button-request-activation-otp"
                >
                  {requestingOtp ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("withdrawalActivation.step2.sending")}
                    </>
                  ) : resendCooldown > 0 ? (
                    <>
                      <Clock className="w-4 h-4 mr-2" /> {t("withdrawalActivation.step2.resendIn", { seconds: resendCooldown })}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />{' '}
                      {state?.tokenLive ? t("withdrawalActivation.step2.resend") : t("withdrawalActivation.step2.send")}
                    </>
                  )}
                </Button>
                {state?.tokenAttempts ? (
                  <span className="text-xs text-blue-200/70 self-center">
                    {t("withdrawalActivation.step2.attempts", { used: state.tokenAttempts, max: state.tokenMaxAttempts })}
                  </span>
                ) : null}
              </div>
              <form onSubmit={handleVerifyOtp} className="flex gap-2 items-center">
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t("withdrawalActivation.step2.codePlaceholder")}
                  inputMode="numeric"
                  maxLength={6}
                  className="max-w-[200px] tracking-[0.4em] text-center font-mono"
                  data-testid="input-activation-otp"
                />
                <Button
                  type="submit"
                  disabled={verifyingOtp || otp.length !== 6}
                  data-testid="button-verify-activation-otp"
                >
                  {verifyingOtp ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("withdrawalActivation.step2.verifying")}
                    </>
                  ) : (
                    t("withdrawalActivation.step2.verify")
                  )}
                </Button>
              </form>
            </>
          ) : (
            <div className="text-sm text-emerald-200 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> {t("withdrawalActivation.badges.verified")}
            </div>
          )}
        </section>
      ) : null}

      {/* Step 3: Activation deposit */}
      {showDepositStep ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Upload className="w-5 h-5 text-blue-300" />
              <h3 className="text-lg font-semibold text-white">
                {t("withdrawalActivation.step3.title")}
              </h3>
            </div>
            {status === 'approved' ? (
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/40">
                {t("withdrawalActivation.badges.approved")}
              </Badge>
            ) : status === 'awaiting_admin_approval' ? (
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/40">
                {t("withdrawalActivation.badges.awaitingReview")}
              </Badge>
            ) : status === 'rejected' ? (
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-400/40">
                {t("withdrawalActivation.badges.resubmit")}
              </Badge>
            ) : (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-400/40">
                {t("withdrawalActivation.badges.required")}
              </Badge>
            )}
          </header>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-blue-300">{t("withdrawalActivation.step3.minLabel")}</div>
              <div className="text-white font-mono text-lg mt-1" data-testid="text-activation-min-usdt">
                {minUsdt} USDT
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-blue-300">{t("withdrawalActivation.step3.sendTo")}</div>
              <div className="text-white font-mono text-xs mt-1 break-all">
                {state?.depositAddress || t("withdrawalActivation.step3.addressFallback")}
              </div>
              <div className="text-blue-200/70 text-xs mt-1">
                {state?.depositAsset || 'USDT'} · {state?.depositNetwork || 'TRC20'}
              </div>
            </div>
          </div>
          <p className="text-sm text-blue-100/80">
            {t("withdrawalActivation.step3.intro")}
          </p>
          <Textarea
            value={receiptNotes}
            onChange={(e) => setReceiptNotes(e.target.value)}
            placeholder={t("withdrawalActivation.step3.notesPlaceholder")}
            rows={3}
            data-testid="textarea-activation-receipt-notes"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleReceiptUpload(f);
            }}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || status === 'approved'}
              data-testid="button-upload-activation-receipt"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("withdrawalActivation.step3.uploading")}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" /> {t("withdrawalActivation.step3.upload")}
                </>
              )}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
