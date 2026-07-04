import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePortal } from "./PortalContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPortalToken } from "@/lib/portalSession";
import { extractBatchAmountLabel } from "@/lib/batchAmountLabel";
import { WithdrawalRequestForm } from "./WithdrawalRequestForm";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet, ShieldAlert, Clock, KeyRound, ArrowRight, CheckCircle2,
  Lock, Sparkles, Flag, ShieldCheck, Coins, GitMerge, AlertCircle, Loader2, History, Upload, FileCheck2,
} from "lucide-react";
import { PortalSkeleton } from "@/components/portal/PortalSkeleton";

/**
 * Withdrawal landing hub — the final stage of the case journey.
 *
 * Frames withdrawal as the last step, surfaces a high-level journey stepper
 * (Connect wallet → Reveal & import phrase code → Submit application) whose
 * statuses are derived from case state, and keeps the actual application form
 * (the same `WithdrawalRequestForm` used by the dashboard dialog) inline as the
 * final step. The wallet-connection sub-steps live in `WalletConnectView`; the
 * CTAs here route there via `setViewState('walletConnect')`.
 */

type JourneyStatus = "done" | "active" | "pending" | "locked";

export function WithdrawalView() {
  const { currentCase, setViewState } = usePortal();
  const { t } = useTranslation("portal");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLDivElement | null>(null);

  // Task #938 — Coin preference state. Reads from case, allows saving.
  const [prefAsset, setPrefAsset] = useState<string>(
    currentCase?.preferredDepositAsset?.trim() || 'USDT',
  );
  const [prefNetwork, setPrefNetwork] = useState<string>(
    currentCase?.preferredDepositNetwork?.trim() || 'TRC20',
  );
  const [savingPref, setSavingPref] = useState(false);

  const saveCoinPreference = async (asset: string, network: string) => {
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
        body: JSON.stringify({ asset, network }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast({
        title: t("withdrawalView.coinPref.savedTitle", "Preference saved"),
        description: t("withdrawalView.coinPref.savedDesc", "Your coin and network preference has been updated."),
      });
    } catch {
      toast({
        variant: 'destructive',
        title: t("withdrawalView.coinPref.saveFailedTitle", "Could not save preference"),
        description: t("withdrawalView.coinPref.saveFailedDesc", "Please try again."),
      });
    } finally {
      setSavingPref(false);
    }
  };

  // Task #938 — Withdrawal Batches / Merge state.
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  type PortalWithdrawalRequest = {
    id: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    amount: string;
    asset: string;
    createdAt: string;
  };

  const windowEnabled = !!currentCase?.withdrawalWindowEnabled;
  const phraseEnabled = !!currentCase?.walletPhraseEnabled;
  const hasWallet = !!currentCase?.walletExchangeName;

  type MergeFeeEntry = {
    id: number;
    category: string;
    status: string;
    notes: string | null;
    uploadedAt: string;
    fileName: string | null;
  };

  const { data: mergeFeeHistory = [], isLoading: isMergeFeeLoading } = useQuery<MergeFeeEntry[]>({
    queryKey: ["/api/cases", currentCase?.id, "all-receipts", "merge_fee"],
    queryFn: async () => {
      if (!currentCase) return [];
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/all-receipts`, {
        headers: { "x-portal-session-token": token },
      });
      if (!res.ok) return [];
      const all: MergeFeeEntry[] = await res.json();
      return all.filter((r) => r.category === "merge_fee");
    },
    enabled: !!currentCase,
    refetchInterval: 30_000,
  });

  const { data: requests = [] } = useQuery<PortalWithdrawalRequest[]>({
    queryKey: ["/api/cases", currentCase?.id, "withdrawal-requests"],
    queryFn: async () => {
      if (!currentCase) return [];
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/withdrawal-requests`, {
        headers: { "x-portal-session-token": token },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentCase,
    refetchInterval: 30_000,
  });

  const pending = requests.find((r) => r.status === "pending");
  const approved = requests.find((r) => r.status === "approved");

  const submitMergeFee = () => {
    if (!currentCase) return;
    // Signal DepositView to pre-select the merge_fee upload category so the
    // user uploads their actual payment proof in one step, without a separate
    // server-side placeholder record being created first.
    try {
      sessionStorage.setItem('ibccf.pending_upload_category', 'merge_fee');
      sessionStorage.setItem('ibccf.pending_merge_batch_id', Date.now().toString());
    } catch {}
    setShowMergeConfirm(false);
    setViewState('deposit');
  };

  // Called when the user clicks "Upload proof" on a specific pending history
  // row.  Stores the row's receipt ID so DepositView can PATCH the placeholder
  // receipt (created by admin without imageData) rather than creating a new one.
  const handleUploadProof = (receiptId: number) => {
    if (!currentCase) return;
    try {
      sessionStorage.setItem('ibccf.pending_upload_category', 'merge_fee');
      sessionStorage.setItem('ibccf.pending_merge_batch_id', String(receiptId));
      sessionStorage.setItem('ibccf.pending_merge_receipt_id', String(receiptId));
    } catch {}
    setViewState('deposit');
  };

  if (!currentCase) return null;

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---- Build the high-level journey ----------------------------------------
  type Step = {
    key: string;
    icon: typeof Wallet;
    title: string;
    body: string;
    status: JourneyStatus;
    cta?: { label: string; onClick: () => void };
  };

  const steps: Step[] = [];

  if (phraseEnabled) {
    steps.push({
      key: "connect",
      icon: Wallet,
      title: t("withdrawalView.steps.connect.title", "Connect your receiving wallet"),
      body: t(
        "withdrawalView.steps.connect.body",
        "Choose the self-custody wallet you want to receive your funds with.",
      ),
      status: hasWallet ? "done" : "active",
      cta: {
        label: hasWallet
          ? t("withdrawalView.steps.connect.ctaDone", "Review wallet")
          : t("withdrawalView.steps.connect.cta", "Open Wallet Connection"),
        onClick: () => setViewState("walletConnect"),
      },
    });
    // Phrase step unlocks only after a wallet is connected. Once connected we
    // treat connect+phrase as complete (the guide stays reachable via the CTA)
    // so the journey advances to a single next active step.
    steps.push({
      key: "phrase",
      icon: KeyRound,
      title: t("withdrawalView.steps.phrase.title", "Reveal & import your phrase code"),
      body: t(
        "withdrawalView.steps.phrase.body",
        "Reveal the connection phrase generated for your case and import it into your wallet app, guided step by step.",
      ),
      status: hasWallet ? "done" : "locked",
      cta: hasWallet
        ? {
            label: t("withdrawalView.steps.phrase.cta", "Review phrase guide"),
            onClick: () => setViewState("walletConnect"),
          }
        : undefined,
    });
  }

  // Apply is gated behind the wallet/phrase prerequisites when the phrase flow
  // is enabled, so only one forward step is ever active at a time.
  const applyPrereqMet = !phraseEnabled || hasWallet;
  const applyStatus: JourneyStatus = approved
    ? "done"
    : pending
      ? "pending"
      : windowEnabled && applyPrereqMet
        ? "active"
        : "locked";

  steps.push({
    key: "apply",
    icon: Flag,
    title: t("withdrawalView.steps.apply.title", "Submit your withdrawal request"),
    body: t(
      "withdrawalView.steps.apply.body",
      "Confirm the destination wallet and amount. Your case officer reviews the request and notifies you of the outcome.",
    ),
    status: applyStatus,
    cta: applyStatus === "active"
      ? { label: t("withdrawalView.steps.apply.cta", "Go to application"), onClick: scrollToForm }
      : undefined,
  });

  const statusMeta: Record<JourneyStatus, { label: string; dot: string; ring: string; text: string }> = {
    done: {
      label: t("withdrawalView.status.done", "Done"),
      dot: "bg-emerald-500",
      ring: "border-emerald-500/40 bg-emerald-500/5",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    active: {
      label: t("withdrawalView.status.active", "Your turn"),
      dot: "bg-amber-500",
      ring: "border-amber-500/50 bg-amber-500/5",
      text: "text-amber-600 dark:text-amber-400",
    },
    pending: {
      label: t("withdrawalView.status.pending", "Under review"),
      dot: "bg-blue-500",
      ring: "border-blue-500/40 bg-blue-500/5",
      text: "text-blue-600 dark:text-blue-400",
    },
    locked: {
      label: t("withdrawalView.status.locked", "Locked"),
      dot: "bg-slate-400",
      ring: "border-slate-300/40 dark:border-slate-700/60 bg-slate-500/5",
      text: "text-slate-500",
    },
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="max-w-3xl mx-auto"
      data-testid="view-withdrawal"
    >
      {/* Hero — framed as the final stage */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <Badge
          variant="outline"
          className="mb-3 border-amber-400/50 text-amber-600 dark:text-amber-300 bg-amber-500/10"
        >
          <Flag className="h-3 w-3 mr-1" />
          {t("withdrawalView.finalStageBadge", "Final stage")}
        </Badge>
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {t("withdrawalView.landingTitle", "Withdrawal")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t(
                "withdrawalView.landingSubtitle",
                "This is the last stage of your case. Connect a receiving wallet, import the connection phrase generated for you, then submit your withdrawal request for compliance review. This platform is display only — submitting does not itself move funds.",
              )}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Journey stepper */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="space-y-3 mb-8"
      >
        {steps.map((step, i) => {
          const meta = statusMeta[step.status];
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`relative rounded-xl border p-4 ${meta.ring}`}
              data-testid={`withdrawal-step-${step.key}`}
            >
              <div className="flex items-start gap-3">
                <div className="relative flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-sm">
                    {step.status === "done" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : step.status === "locked" ? (
                      <Lock className="h-4 w-4 text-slate-400" />
                    ) : (
                      <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <span className="absolute top-9 h-[calc(100%-0.25rem)] w-px bg-slate-200 dark:bg-slate-700" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-400">
                      {t("withdrawalView.stepLabel", "Step {{n}}", { n: i + 1 })}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${meta.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {step.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">{step.body}</p>
                  {step.cta && (
                    <Button
                      size="sm"
                      variant={step.status === "active" ? "default" : "outline"}
                      className="mt-3 h-8"
                      onClick={step.cta.onClick}
                      data-testid={`withdrawal-step-cta-${step.key}`}
                    >
                      {step.cta.label}
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* Task #938 — Coin / Currency Preference card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08 }}
        className="mb-6"
        data-testid="card-coin-preference"
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">
                {t("withdrawalView.coinPref.title", "Coin / Currency Preference")}
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              {t("withdrawalView.coinPref.desc", "Select your preferred settlement coin and network. This is used to pre-fill the batch merge fee and upload forms.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  {t("withdrawalView.coinPref.assetLabel", "Coin")}
                </label>
                <Select
                  value={prefAsset}
                  onValueChange={(v) => {
                    setPrefAsset(v);
                    const net = v === 'USDT' || v === 'USDC' ? 'TRC20'
                      : v === 'BTC' ? 'Bitcoin'
                      : v === 'ETH' ? 'ERC20'
                      : v === 'BNB' ? 'BEP20'
                      : prefNetwork;
                    setPrefNetwork(net);
                  }}
                >
                  <SelectTrigger className="rounded-lg" data-testid="select-pref-asset">
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
                <label className="text-xs text-muted-foreground block mb-1">
                  {t("withdrawalView.coinPref.networkLabel", "Network")}
                </label>
                <Select value={prefNetwork} onValueChange={setPrefNetwork}>
                  <SelectTrigger className="rounded-lg" data-testid="select-pref-network">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRC20">TRC20 (Tron)</SelectItem>
                    <SelectItem value="ERC20">ERC20 (Ethereum)</SelectItem>
                    <SelectItem value="BEP20">BEP20 (BSC)</SelectItem>
                    <SelectItem value="Polygon">Polygon</SelectItem>
                    <SelectItem value="Solana">Solana</SelectItem>
                    <SelectItem value="Bitcoin">Bitcoin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={savingPref}
              onClick={() => saveCoinPreference(prefAsset, prefNetwork)}
              data-testid="button-save-coin-pref"
            >
              {savingPref ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("withdrawalView.coinPref.saving", "Saving…")}</>
              ) : (
                t("withdrawalView.coinPref.save", "Save preference")
              )}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Task #938 — Withdrawal Batches panel (visible when window is open) */}
      {windowEnabled && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="mb-6"
          data-testid="card-withdrawal-batches"
        >
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-sm">
                  {t("withdrawalView.batches.title", "Withdrawal Batches")}
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                {t("withdrawalView.batches.desc", "Combine multiple withdrawal batches into a single settlement. A processing fee applies to each merge.")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showMergeConfirm ? (
                <Button
                  variant="outline"
                  className="w-full border-blue-500/40 text-blue-600 dark:text-blue-300 hover:bg-blue-500/10"
                  onClick={() => setShowMergeConfirm(true)}
                  data-testid="button-merge-withdrawal"
                >
                  <GitMerge className="h-4 w-4 mr-2" />
                  {t("withdrawalView.batches.mergeCta", "Merge Withdrawal")}
                </Button>
              ) : (
                <div
                  className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3"
                  data-testid="card-merge-confirm"
                  onKeyDown={(e) => { if (e.key === "Escape") setShowMergeConfirm(false); }}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-200">
                      {t("withdrawalView.batches.mergeConfirm", `A ${currentCase?.mergeFeeAmount?.trim() || '500'} ${prefAsset} processing fee applies to each batch merge. Confirming will take you directly to the Uploads section where you can attach your payment proof.`)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowMergeConfirm(false)}
                      data-testid="button-merge-cancel"
                    >
                      {t("withdrawalView.batches.mergeCancel", "Cancel")}
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={submitMergeFee}
                      data-testid="button-merge-confirm"
                    >
                      {t("withdrawalView.batches.mergeConfirmCta", "Confirm & Upload")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Batch Merge History */}
      {(isMergeFeeLoading || mergeFeeHistory.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
          className="mb-6"
          data-testid="card-batch-history"
        >
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <CardTitle className="text-sm">
                  {t("withdrawalView.batchHistory.title", "Batch Merge History")}
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                {t("withdrawalView.batchHistory.desc", "A record of your past batch merge fee submissions and their current review status.")}
              </CardDescription>
            </CardHeader>
            <CardContent className={isMergeFeeLoading ? "pb-4" : "p-0"}>
              {isMergeFeeLoading ? (
                <PortalSkeleton variant="list" count={2} />
              ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {mergeFeeHistory.map((entry) => {
                  const statusVariant =
                    entry.status === "approved"
                      ? { label: t("withdrawalView.batchHistory.approved", "Approved"), cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" }
                      : entry.status === "rejected"
                        ? { label: t("withdrawalView.batchHistory.rejected", "Rejected"), cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" }
                        : { label: t("withdrawalView.batchHistory.pending", "Pending review"), cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" };

                  const dateStr = new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(entry.uploadedAt));

                  const amountLabel = extractBatchAmountLabel(entry.notes);

                  // Show "Upload proof" only on receipts that are still
                  // awaiting a file (fileName is null → admin placeholder with
                  // no image yet).  Once the user has uploaded proof the
                  // fileName is set server-side and the button is hidden.
                  const isPending =
                    entry.status !== "approved" &&
                    entry.status !== "rejected" &&
                    !entry.fileName;

                  // True when proof has been uploaded but admin hasn't reviewed yet.
                  const hasProofFile =
                    !!entry.fileName &&
                    entry.status !== "approved" &&
                    entry.status !== "rejected";

                  return (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between px-4 py-3 gap-3"
                      data-testid={`batch-history-row-${entry.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {t("withdrawalView.batchHistory.feeLabel", "Merge fee — {{amount}}", { amount: amountLabel })}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5 border-violet-400/50 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
                              onClick={() => handleUploadProof(entry.id)}
                              data-testid={`batch-history-upload-${entry.id}`}
                            >
                              <Upload className="h-3 w-3" />
                              {t("withdrawalView.batchHistory.uploadProof", "Upload proof")}
                            </Button>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold ${statusVariant.cls}`}
                            data-testid="receipt-status-badge"
                          >
                            {statusVariant.label}
                          </Badge>
                        </div>
                        {hasProofFile && (
                          <span
                            className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400"
                            data-testid={`batch-history-proof-submitted-${entry.id}`}
                          >
                            <FileCheck2 className="h-3 w-3" />
                            {t("withdrawalView.batchHistory.proofSubmitted", "Proof submitted")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Application — the final step content */}
      <div ref={formRef} className="scroll-mt-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t("withdrawalView.applicationHeading", "Withdrawal application")}
          </h2>
        </div>

        {!windowEnabled ? (
          <Card data-testid="card-withdrawal-disabled">
            <CardContent className="flex flex-col items-center text-center gap-3 py-12">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-amber-500" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {t("withdrawalView.disabledTitle", "Withdrawal window not open yet")}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                {t(
                  "withdrawalView.disabledBody",
                  "Your case officer has not opened the withdrawal window for this case yet. You will be notified when you can apply.",
                )}
              </p>
            </CardContent>
          </Card>
        ) : pending ? (
          <Card data-testid="card-withdrawal-pending">
            <CardContent className="flex flex-col items-center text-center gap-3 py-12">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-500" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {t("withdrawalView.pendingTitle", "Withdrawal request under review")}
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                {t(
                  "withdrawalView.pendingBody",
                  "You already have a withdrawal request awaiting review. Your case officer will respond before you can submit another.",
                )}
              </p>
              <div
                className="px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-700 dark:text-amber-200 text-sm font-semibold"
                data-testid="chip-withdrawal-pending"
              >
                {pending.amount} {pending.asset}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="card-withdrawal-form">
            <CardHeader>
              <CardTitle className="text-base">
                {t("withdrawalView.formTitle", "Withdrawal application")}
              </CardTitle>
              <CardDescription>
                {t(
                  "withdrawalView.formDescription",
                  "Your case officer will review the destination wallet you submit and notify you of the outcome.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WithdrawalRequestForm
                currentCase={currentCase}
                onSubmitted={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/cases", currentCase.id, "withdrawal-requests"],
                  });
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* Display-only reassurance footer */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-500/5 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
          <span>
            {t(
              "withdrawalView.displayOnlyNote",
              "For your security, IBCCF never holds, routes, or relays funds. Settlement is performed by the regulated settlement bank to the verified wallet on your case file.",
            )}
          </span>
        </div>
      </div>
    </main>
  );
}
