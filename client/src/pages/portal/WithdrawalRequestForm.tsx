import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { getPortalToken } from "@/lib/portalSession";
import { ShieldCheck, Wallet, Settings2, FileCheck } from "lucide-react";
import type { Case } from "./PortalContext";

interface Props {
  currentCase: Case;
  /** Fired after a successful submission so the host can refresh/close. */
  onSubmitted?: () => void;
  /**
   * When provided, a Cancel button is rendered alongside Submit (used by the
   * dialog). The dedicated page variant omits this so only Submit shows.
   */
  onCancel?: () => void;
}

/**
 * Shared withdrawal-request form — the single source of truth for the
 * four-section withdrawal application (details, destination wallet,
 * preferences, security & terms). Used by both the Dashboard
 * `WithdrawalRequestDialog` and the dedicated portal Withdrawal tab so the
 * fields and validation never drift between the two entry points.
 *
 * The platform is DISPLAY ONLY — submitting this form does NOT initiate any
 * funds transfer. It records the user's intent against the case so a case
 * officer can review the requested destination wallet.
 */
export function WithdrawalRequestForm({ currentCase, onSubmitted, onCancel }: Props) {
  const { toast } = useToast();
  const { t } = useTranslation("portal");
  const [submitting, setSubmitting] = useState(false);

  // Tomorrow in the user's local calendar — used as the date input `min`.
  // We deliberately format with local Y/M/D parts (not toISOString) because
  // `toISOString()` returns UTC and would shift the date backward for users
  // in UTC+ timezones near local midnight.
  const tomorrowIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // Section 4 — security
  const [pin, setPin] = useState("");

  // Section 1 — Withdrawal inputs. Pre-fill asset/network from the case's
  // user-declared preference (Task #938) so repeat submissions don't need to
  // re-select the coin every time. Falls back to USDT/TRC20 for legacy cases.
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState(currentCase.preferredDepositAsset?.trim() || "USDT");
  const [network, setNetwork] = useState(currentCase.preferredDepositNetwork?.trim() || "TRC20");
  const [withdrawalType, setWithdrawalType] = useState<"full" | "partial">("full");

  // Section 2 — Requested destination wallet (SEPARATE from payoutWallet)
  const [walletAddress, setWalletAddress] = useState("");
  const [walletAsset, setWalletAsset] = useState("");
  const [walletNetwork, setWalletNetwork] = useState("");

  // Section 3 — Preferences
  const [preferredPayoutDate, setPreferredPayoutDate] = useState("");
  const [confirmationChannel, setConfirmationChannel] = useState<"email" | "sms" | "both">("email");
  const [userNote, setUserNote] = useState("");

  // Section 4 — Security & terms
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const reset = () => {
    setAmount("");
    setAsset("USDT");
    setNetwork("TRC20");
    setWithdrawalType("full");
    setWalletAddress("");
    setWalletAsset("");
    setWalletNetwork("");
    setPreferredPayoutDate("");
    setConfirmationChannel("email");
    setUserNote("");
    setTwoFactorCode("");
    setPin("");
    setTermsAccepted(false);
  };

  // Computed form validity — drives the submit button's `disabled` state so
  // users get immediate visual feedback for the *required* fields instead of
  // clicking through to a toast.
  //
  // The optional 2FA code is deliberately NOT gated here: a partially-typed
  // optional code (e.g. 4 digits) must not silently disable the button with no
  // explanation. Its full validation still lives in `handleSubmit`, which
  // surfaces an actionable toast telling the user to fix or clear the code.
  const isFormValid = useMemo(() => {
    if (!amount.trim() || !asset.trim() || !network.trim() || !walletAddress.trim()) return false;
    if (!/^\d{6}$/.test(pin)) return false;
    if (preferredPayoutDate && preferredPayoutDate < tomorrowIso) return false;
    if (!termsAccepted) return false;
    return true;
  }, [amount, asset, network, walletAddress, pin, preferredPayoutDate, tomorrowIso, termsAccepted]);

  const handleSubmit = async () => {
    if (!amount.trim() || !asset.trim() || !network.trim() || !walletAddress.trim()) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.missingTitle", "Missing details"),
        description: t(
          "withdrawalRequest.errors.missingDescription",
          "Please fill in amount, asset, network, and destination wallet address.",
        ),
      });
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.pinTitle", "PIN required"),
        description: t(
          "withdrawalRequest.errors.pinDescription",
          "Please enter your 6-digit case PIN to confirm this request.",
        ),
      });
      return;
    }
    if (twoFactorCode.trim() && !/^\d{6}$/.test(twoFactorCode.trim())) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.twoFaTitle", "Invalid 2FA code"),
        description: t(
          "withdrawalRequest.errors.twoFaDescription",
          "Verification codes must be exactly 6 digits.",
        ),
      });
      return;
    }
    if (preferredPayoutDate && preferredPayoutDate < tomorrowIso) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.dateTitle", "Date too soon"),
        description: t(
          "withdrawalRequest.errors.dateDescription",
          "Preferred payout date must be tomorrow or later.",
        ),
      });
      return;
    }
    if (!termsAccepted) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.termsTitle", "Terms required"),
        description: t(
          "withdrawalRequest.errors.termsDescription",
          "Please accept the withdrawal terms before submitting.",
        ),
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = getPortalToken();
      const res = await fetch(`/api/cases/${currentCase.id}/withdrawal-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-session-token": token,
        },
        body: JSON.stringify({
          amount: amount.trim(),
          asset: asset.trim(),
          network: network.trim(),
          withdrawalType,
          requestedWalletAddress: walletAddress.trim(),
          requestedWalletAsset: walletAsset.trim() || null,
          requestedWalletNetwork: walletNetwork.trim() || null,
          preferredPayoutDate: preferredPayoutDate
            ? new Date(preferredPayoutDate).toISOString()
            : null,
          confirmationChannel,
          twoFactorCode: twoFactorCode.trim() || null,
          pin,
          termsAccepted: true,
          userNote: userNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: t(
            "withdrawalRequest.errors.submitFailedTitle",
            "Could not submit withdrawal request",
          ),
          description: typeof err?.error === "string"
            ? err.error
            : t(
                "withdrawalRequest.errors.submitFailedDefault",
                "Please try again or contact your case officer.",
              ),
        });
        return;
      }

      toast({
        title: t("withdrawalRequest.success.title", "Withdrawal request submitted"),
        description: t(
          "withdrawalRequest.success.description",
          "Your case officer will review the destination wallet and contact you with the outcome.",
        ),
      });
      reset();
      onSubmitted?.();
    } catch (_e) {
      toast({
        variant: "destructive",
        title: t("withdrawalRequest.errors.networkTitle", "Network error"),
        description: t(
          "withdrawalRequest.errors.networkDescription",
          "Unable to submit withdrawal request. Please try again.",
        ),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="form-withdrawal-request">
      <div className="space-y-6 py-2">
        {/* SECTION 1 — Withdrawal inputs */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <FileCheck className="w-4 h-4 text-amber-500" />
            {t("withdrawalRequest.sections.details", "1. Withdrawal Details")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wr-amount">{t("withdrawalRequest.fields.amount", "Amount")}</Label>
              <Input
                id="wr-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("withdrawalRequest.fields.amountPlaceholder", "e.g. 1000")}
                data-testid="input-wr-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-type">{t("withdrawalRequest.fields.type", "Type")}</Label>
              <select
                id="wr-type"
                value={withdrawalType}
                onChange={(e) => setWithdrawalType(e.target.value as "full" | "partial")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-wr-type"
              >
                <option value="full">{t("withdrawalRequest.fields.typeFull", "Full balance")}</option>
                <option value="partial">{t("withdrawalRequest.fields.typePartial", "Partial")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-asset">{t("withdrawalRequest.fields.asset", "Asset")}</Label>
              <Input
                id="wr-asset"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                placeholder="USDT"
                data-testid="input-wr-asset"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-network">{t("withdrawalRequest.fields.network", "Network")}</Label>
              <Input
                id="wr-network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder="TRC20"
                data-testid="input-wr-network"
              />
            </div>
          </div>
        </section>

        {/* SECTION 2 — Requested destination wallet */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Wallet className="w-4 h-4 text-amber-500" />
            {t("withdrawalRequest.sections.wallet", "2. Requested Destination Wallet")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "withdrawalRequest.walletHint",
              "This is the wallet you would like funds released to. It is independent of any verified payout wallet your case officer may already have on file — compliance will verify the address you submit here.",
            )}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="wr-wallet-address">
              {t("withdrawalRequest.fields.walletAddress", "Wallet address")}
            </Label>
            <Input
              id="wr-wallet-address"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder={t("withdrawalRequest.fields.walletAddressPlaceholder", "Paste destination address")}
              data-testid="input-wr-wallet-address"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wr-wallet-asset">
                {t("withdrawalRequest.fields.walletAssetOptional", "Asset (optional)")}
              </Label>
              <Input
                id="wr-wallet-asset"
                value={walletAsset}
                onChange={(e) => setWalletAsset(e.target.value)}
                placeholder={t("withdrawalRequest.fields.walletMatchAbove", "Leave blank to match above")}
                data-testid="input-wr-wallet-asset"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-wallet-network">
                {t("withdrawalRequest.fields.walletNetworkOptional", "Network (optional)")}
              </Label>
              <Input
                id="wr-wallet-network"
                value={walletNetwork}
                onChange={(e) => setWalletNetwork(e.target.value)}
                placeholder={t("withdrawalRequest.fields.walletMatchAbove", "Leave blank to match above")}
                data-testid="input-wr-wallet-network"
              />
            </div>
          </div>
        </section>

        {/* SECTION 3 — Preferences */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Settings2 className="w-4 h-4 text-amber-500" />
            {t("withdrawalRequest.sections.preferences", "3. Preferences")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wr-payout-date">
                {t("withdrawalRequest.fields.payoutDate", "Preferred payout date (optional, tomorrow or later)")}
              </Label>
              <Input
                id="wr-payout-date"
                type="date"
                min={tomorrowIso}
                value={preferredPayoutDate}
                onChange={(e) => setPreferredPayoutDate(e.target.value)}
                data-testid="input-wr-payout-date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-channel">
                {t("withdrawalRequest.fields.channel", "Confirmation channel")}
              </Label>
              <select
                id="wr-channel"
                value={confirmationChannel}
                onChange={(e) => setConfirmationChannel(e.target.value as "email" | "sms" | "both")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                data-testid="select-wr-channel"
              >
                <option value="email">{t("withdrawalRequest.fields.channelEmail", "Email")}</option>
                <option value="sms">{t("withdrawalRequest.fields.channelSms", "SMS")}</option>
                <option value="both">{t("withdrawalRequest.fields.channelBoth", "Both")}</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wr-note">
              {t("withdrawalRequest.fields.note", "Note for compliance (optional)")}
            </Label>
            <Textarea
              id="wr-note"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("withdrawalRequest.fields.notePlaceholder", "Anything your case officer should know")}
              data-testid="textarea-wr-note"
            />
          </div>
        </section>

        {/* SECTION 4 — Security & terms */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            {t("withdrawalRequest.sections.security", "4. Security & Terms")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wr-pin">
                {t("withdrawalRequest.fields.pin", "Re-enter your 6-digit case PIN")}
              </Label>
              <Input
                id="wr-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                data-testid="input-wr-pin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wr-2fa">
                {t("withdrawalRequest.fields.twoFa", "2FA / verification code (optional, 6 digits)")}
              </Label>
              <Input
                id="wr-2fa"
                inputMode="numeric"
                maxLength={6}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("withdrawalRequest.fields.twoFaPlaceholder", "If your officer issued one")}
                data-testid="input-wr-2fa"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={termsAccepted}
              onCheckedChange={(v) => setTermsAccepted(v === true)}
              data-testid="checkbox-wr-terms"
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              {t(
                "withdrawalRequest.termsCheckbox",
                "I confirm the destination wallet address above is mine and I understand this platform is display-only — submitting this request asks compliance to review my withdrawal, it does not itself move funds.",
              )}
            </span>
          </label>
        </section>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
            data-testid="button-wr-cancel"
          >
            {t("withdrawalRequest.buttons.cancel", "Cancel")}
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !isFormValid}
          data-testid="button-wr-submit"
        >
          {submitting
            ? t("withdrawalRequest.buttons.submitting", "Submitting…")
            : t("withdrawalRequest.buttons.submit", "Submit withdrawal request")}
        </Button>
      </div>
    </div>
  );
}
