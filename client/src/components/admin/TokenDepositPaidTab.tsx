import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Lock, Settings, Wallet, Zap } from "lucide-react";
import { computeTokenDepositRequired, formatUsdt } from "@shared/tokenDeposit";
import { type Case } from "@/components/admin/shared";
import { TwsEmailPreviewDialog } from "@/components/admin/TwsEmailPreviewDialog";

export function TokenDepositPaidTab({
  selectedCase,
  authToken,
  onRefresh,
}: {
  selectedCase: Case;
  authToken: string | null;
  onRefresh: () => void | Promise<void>;
}) {
  const [rateInput, setRateInput] = useState(selectedCase.tokenDepositRatePer100k ?? '600');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [permitting, setPermitting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const [vdWalletAddress, setVdWalletAddress] = useState(selectedCase.validationDepositWalletAddress ?? '');
  const [vdWalletAsset, setVdWalletAsset] = useState(selectedCase.validationDepositWalletAsset ?? 'USDT');
  const [vdWalletNetwork, setVdWalletNetwork] = useState(selectedCase.validationDepositWalletNetwork ?? 'TRC20');
  const [vdAmount, setVdAmount] = useState(selectedCase.validationDepositAmount ?? '550');
  const [savingVd, setSavingVd] = useState(false);
  const [confirmingVd, setConfirmingVd] = useState(false);
  const [twsLink, setTwsLink] = useState(selectedCase.tokenWalletSetupLink ?? '');
  const [twsNote, setTwsNote] = useState(selectedCase.tokenWalletSetupNote ?? '');
  const [savingTws, setSavingTws] = useState(false);
  const [confirmingTws, setConfirmingTws] = useState(false);
  const [isTwsEmailPreviewOpen, setIsTwsEmailPreviewOpen] = useState(false);
  const [isTwsGuideEmailPreviewOpen, setIsTwsGuideEmailPreviewOpen] = useState(false);

  useEffect(() => {
    setRateInput(selectedCase.tokenDepositRatePer100k ?? '600');
  }, [selectedCase.id, selectedCase.tokenDepositRatePer100k]);

  useEffect(() => {
    setVdWalletAddress(selectedCase.validationDepositWalletAddress ?? '');
    setVdWalletAsset(selectedCase.validationDepositWalletAsset ?? 'USDT');
    setVdWalletNetwork(selectedCase.validationDepositWalletNetwork ?? 'TRC20');
    setVdAmount(selectedCase.validationDepositAmount ?? '550');
  }, [
    selectedCase.id,
    selectedCase.validationDepositWalletAddress,
    selectedCase.validationDepositWalletAsset,
    selectedCase.validationDepositWalletNetwork,
    selectedCase.validationDepositAmount,
  ]);

  useEffect(() => {
    setTwsLink(selectedCase.tokenWalletSetupLink ?? '');
    setTwsNote(selectedCase.tokenWalletSetupNote ?? '');
  }, [selectedCase.id, selectedCase.tokenWalletSetupLink, selectedCase.tokenWalletSetupNote]);

  const required = computeTokenDepositRequired(
    selectedCase.withdrawalAmount,
    rateInput || selectedCase.tokenDepositRatePer100k,
  );

  const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken || sessionStorage.getItem('adminToken') || ''}`,
  });

  const saveRate = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/withdrawal-activation/admin`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ tokenDepositRatePer100k: rateInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] save rate failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const overrideRequest = async () => {
    setRequesting(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/withdrawal-activation/admin/request`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] override request failed:', err);
    } finally {
      setRequesting(false);
    }
  };

  const permit = async () => {
    if (!paidAmountInput.trim()) return;
    setPermitting(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/withdrawal-activation/admin/permit`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ paidAmount: paidAmountInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? res.statusText);
      }
      setPaidAmountInput('');
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] permit failed:', err);
    } finally {
      setPermitting(false);
    }
  };

  const markDone = async () => {
    setMarkingDone(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/withdrawal-activation/admin/mark-done`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] mark done failed:', err);
    } finally {
      setMarkingDone(false);
    }
  };

  const saveValidationWallet = async () => {
    setSavingVd(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          validationDepositWalletAddress: vdWalletAddress.trim() || null,
          validationDepositWalletAsset: vdWalletAsset.trim() || null,
          validationDepositWalletNetwork: vdWalletNetwork.trim() || null,
          validationDepositAmount: vdAmount.trim() || '550',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] save validation wallet failed:', err);
    } finally {
      setSavingVd(false);
    }
  };

  const confirmValidationDeposit = async (confirmed: boolean) => {
    setConfirmingVd(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ validationDepositConfirmed: confirmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      console.error('[Paid tab] confirm validation deposit failed:', err);
    } finally {
      setConfirmingVd(false);
    }
  };

  const isPermitted = selectedCase.withdrawalActivationStatus === 'approved';
  const permitCount = selectedCase.tokenDepositPermitCount ?? 0;

  return (
    <div className="space-y-4 mt-0">

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800/60">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${isPermitted ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
          <span className="text-xs text-slate-400">Gate:</span>
          <span className={`text-xs font-semibold ${isPermitted ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isPermitted ? 'Unlocked' : 'Locked'}
          </span>
          <span className="text-xs text-slate-600">({selectedCase.withdrawalActivationStatus ?? 'pending_address'})</span>
        </div>
        <div className="text-xs text-slate-500">
          Permits issued: <span className="font-semibold text-slate-200">{permitCount}</span>
        </div>
        {selectedCase.tokenDepositPaidAmount && (
          <div className="text-xs text-slate-500">
            Last paid: <span className="font-semibold text-slate-200">{selectedCase.tokenDepositPaidAmount} USDT</span>
          </div>
        )}
        {selectedCase.tokenDepositLastPermittedBy && (
          <div className="text-xs text-slate-500">
            By: <span className="font-semibold text-slate-200">{selectedCase.tokenDepositLastPermittedBy}</span>
          </div>
        )}
        {selectedCase.tokenDepositLastPermittedAt && (
          <div className="text-xs text-slate-500">
            At: <span className="font-semibold text-slate-200">{new Date(selectedCase.tokenDepositLastPermittedAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* STEP 1 — Set Rate */}
      <div className="rounded-xl border border-l-4 border-indigo-800/50 border-l-indigo-500 bg-indigo-950/20 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-900/30 border-b border-indigo-800/40">
          <div className="h-5 w-5 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-indigo-400">1</span>
          </div>
          <Settings className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
          <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Set Token Deposit Rate</h3>
          <span className="ml-auto text-[10px] font-semibold text-indigo-400 bg-indigo-900/50 border border-indigo-700/50 rounded-full px-2 py-0.5">
            {selectedCase.tokenDepositRatePer100k ? 'DONE' : 'ACTIVE'}
          </span>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-slate-500">USDT required per 100,000 USDT of withdrawal amount. Default 600.</p>
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              placeholder="600"
              className="w-28 bg-slate-800/50 border-slate-700 text-sm"
            />
            <span className="text-xs text-slate-500">USDT / 100k</span>
            <Button size="sm" onClick={saveRate} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs">
              {saving ? 'Saving…' : 'Save Rate'}
            </Button>
          </div>
          {selectedCase.withdrawalAmount && (
            <p className="text-xs text-slate-400">
              Required for this case ({selectedCase.withdrawalAmount}):&nbsp;
              <span className="font-semibold text-indigo-300">{formatUsdt(required)} USDT</span>
            </p>
          )}
        </div>
      </div>

      {/* STEP 2 — Request Deposit (gated: rate must be set in Step 1 first) */}
      {(() => {
        const rateSet = !!selectedCase.tokenDepositRatePer100k;
        return (
          <div className={`rounded-xl border border-l-4 overflow-hidden transition-opacity ${rateSet ? 'border-sky-800/50 border-l-sky-500 bg-sky-950/20' : 'border-slate-800/50 border-l-sky-500/40 bg-slate-900/30 opacity-50 pointer-events-none'}`}>
            <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${rateSet ? 'bg-sky-900/30 border-sky-800/40' : 'bg-slate-800/40 border-slate-800/50'}`}>
              <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${rateSet ? 'bg-sky-500/20 border border-sky-500/40' : 'bg-slate-500/20 border border-slate-500/40'}`}>
                <span className={`text-[10px] font-bold ${rateSet ? 'text-sky-400' : 'text-slate-500'}`}>2</span>
              </div>
              <Zap className={`h-3.5 w-3.5 flex-shrink-0 ${rateSet ? 'text-sky-400' : 'text-slate-500'}`} />
              <h3 className={`text-xs font-semibold uppercase tracking-wide ${rateSet ? 'text-sky-400' : 'text-slate-500'}`}>Request Token Deposit from User</h3>
              <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${rateSet ? 'text-sky-400 bg-sky-900/50 border border-sky-700/50' : 'text-slate-500 bg-slate-800/50 border border-slate-700/50'}`}>
                {rateSet ? 'ACTIVE' : 'PENDING'}
              </span>
            </div>
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-slate-500">
                Forces the case into the "awaiting deposit" step regardless of where the activation flow sits.
                Use this to start the token deposit cycle without requiring the user to complete prior steps.
              </p>
              {!rateSet && (
                <p className="text-xs text-amber-400/80">⚠ Set the token deposit rate in Step 1 before requesting a deposit.</p>
              )}
              <Button size="sm" onClick={overrideRequest} disabled={requesting || !rateSet} variant="outline" className="border-sky-700 text-sky-400 hover:bg-sky-900/30 text-xs">
                {requesting ? 'Requesting…' : 'Request Token Deposit'}
              </Button>
            </div>
          </div>
        );
      })()}

      {/* STEP 3 — Permit Withdrawal (gated: rate must be set in Step 1 first) */}
      {(() => {
        const rateSet3 = !!selectedCase.tokenDepositRatePer100k;
        return (
      <div className={`rounded-xl border border-l-4 border-l-emerald-500 overflow-hidden transition-opacity ${isPermitted ? 'border-emerald-700/50 bg-emerald-950/20' : rateSet3 ? 'border-slate-800/50 bg-slate-900/30' : 'border-slate-800/50 bg-slate-900/30 opacity-50 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${isPermitted ? 'bg-emerald-900/30 border-emerald-800/40' : 'bg-slate-800/40 border-slate-800/50'}`}>
          <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${isPermitted ? 'bg-emerald-500/30 border border-emerald-500/50' : 'bg-emerald-500/20 border border-emerald-500/40'}`}>
            {isPermitted
              ? <CheckCircle className="h-3 w-3 text-emerald-400" />
              : <span className="text-[10px] font-bold text-emerald-400">3</span>
            }
          </div>
          <CheckCircle className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
          <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Permit Withdrawal</h3>
          <span className="ml-auto text-[10px] font-semibold text-emerald-400 bg-emerald-900/50 border border-emerald-700/50 rounded-full px-2 py-0.5">
            {isPermitted ? 'ACTIVE' : 'PENDING'}
          </span>
        </div>
        <div className="px-4 py-3 space-y-2.5">
          <p className="text-xs text-slate-500">
            Enter the USDT amount the user deposited and click Permit. The case is set to{' '}
            <span className="text-emerald-400 font-medium">approved</span>, the permit counter increments,
            and the user receives a processing confirmation email with their PDF invoice.
          </p>
          {required > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Required:</span>
              <span className="font-semibold text-amber-300">{formatUsdt(required)} USDT</span>
              {selectedCase.tokenDepositPaidAmount && (
                <span className="text-slate-600">· last paid: {selectedCase.tokenDepositPaidAmount} USDT</span>
              )}
            </div>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              value={paidAmountInput}
              onChange={(e) => setPaidAmountInput(e.target.value)}
              placeholder={required > 0 ? `${formatUsdt(required)} (required)` : 'Amount paid'}
              className="w-48 bg-slate-800/50 border-slate-700 text-sm"
            />
            <span className="text-xs text-slate-500">USDT</span>
            <Button
              size="sm"
              onClick={permit}
              disabled={permitting || !paidAmountInput.trim()}
              className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold"
            >
              {permitting ? 'Processing…' : 'Permit Withdrawal'}
            </Button>
          </div>
        </div>
      </div>
        );
      })()}

      {/* STEP 4 — Issue Validation Deposit Wallet (gated: withdrawal must be permitted in Step 3 first) */}
      {(() => {
        const vdConfirmed = selectedCase.validationDepositConfirmed;
        const step4Unlocked = isPermitted;
        return (
          <div className={`rounded-xl border border-l-4 border-l-violet-500 overflow-hidden transition-opacity ${vdConfirmed ? 'border-violet-700/50 bg-violet-950/20' : step4Unlocked ? 'border-slate-800/50 bg-slate-900/30' : 'border-slate-800/50 bg-slate-900/30 opacity-50 pointer-events-none'}`}>
            <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${vdConfirmed ? 'bg-violet-900/30 border-violet-800/40' : 'bg-slate-800/40 border-slate-800/50'}`}>
              <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${vdConfirmed ? 'bg-violet-500/30 border border-violet-500/50' : 'bg-violet-500/20 border border-violet-500/40'}`}>
                {vdConfirmed
                  ? <CheckCircle className="h-3 w-3 text-violet-400" />
                  : <span className="text-[10px] font-bold text-violet-400">4</span>
                }
              </div>
              <Wallet className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
              <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wide">Issue Validation Deposit Wallet</h3>
              <span className="ml-auto text-[10px] font-semibold text-violet-400 bg-violet-900/50 border border-violet-700/50 rounded-full px-2 py-0.5">
                {vdConfirmed ? 'CONFIRMED' : selectedCase.validationDepositWalletAddress ? 'ACTIVE' : 'PENDING'}
              </span>
            </div>
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-slate-500">
                Set a wallet for the user to deposit{' '}
                <span className="text-violet-300 font-semibold">{vdAmount || '550'} USDT</span>{' '}
                (or equivalent in any supported coin) as a validation fee before withdrawal completes.
                The portal will display a deposit instruction card with this wallet address.
              </p>
              <div className="space-y-2">
                <Input
                  value={vdWalletAddress}
                  onChange={(e) => setVdWalletAddress(e.target.value)}
                  placeholder="Wallet address"
                  className="w-full bg-slate-800/50 border-slate-700 text-sm font-mono"
                />
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    value={vdWalletAsset}
                    onChange={(e) => setVdWalletAsset(e.target.value)}
                    placeholder="Asset (e.g. USDT)"
                    className="w-28 bg-slate-800/50 border-slate-700 text-sm"
                  />
                  <Input
                    value={vdWalletNetwork}
                    onChange={(e) => setVdWalletNetwork(e.target.value)}
                    placeholder="Network (e.g. TRC20)"
                    className="w-32 bg-slate-800/50 border-slate-700 text-sm"
                  />
                  <Input
                    value={vdAmount}
                    onChange={(e) => setVdAmount(e.target.value)}
                    placeholder="550"
                    className="w-24 bg-slate-800/50 border-slate-700 text-sm"
                  />
                  <span className="text-xs text-slate-500">USDT</span>
                </div>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <Button size="sm" onClick={saveValidationWallet} disabled={savingVd} className="bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold">
                  {savingVd ? 'Saving…' : 'Set Wallet'}
                </Button>
                {selectedCase.validationDepositWalletAddress && !vdConfirmed && (
                  <Button size="sm" onClick={() => confirmValidationDeposit(true)} disabled={confirmingVd} className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold">
                    {confirmingVd ? 'Confirming…' : 'Confirm Receipt'}
                  </Button>
                )}
                {vdConfirmed && (
                  <Button size="sm" onClick={() => confirmValidationDeposit(false)} disabled={confirmingVd} variant="outline" className="border-slate-700 text-slate-400 hover:bg-slate-800 text-xs">
                    {confirmingVd ? 'Unconfirming…' : 'Unconfirm'}
                  </Button>
                )}
              </div>
              {vdConfirmed && selectedCase.validationDepositConfirmedAt && (
                <p className="text-xs text-violet-400">
                  ✓ Receipt confirmed by {selectedCase.validationDepositConfirmedBy ?? 'Admin'} on{' '}
                  {new Date(selectedCase.validationDepositConfirmedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* STEP 5 — Token Wallet Setup (visible/active only after validation deposit confirmed) */}
      {(() => {
        const vdConf = !!selectedCase.validationDepositConfirmed;
        const twsConfirmed = !!selectedCase.tokenWalletSetupConfirmed;
        const linkSaved = !!selectedCase.tokenWalletSetupLink;

        const saveTws = async () => {
          if (!twsLink.trim()) return;
          setSavingTws(true);
          try {
            const res = await fetch(`/api/cases/${selectedCase.id}`, {
              method: 'PATCH',
              headers: headers(),
              body: JSON.stringify({
                tokenWalletSetupLink: twsLink.trim(),
                tokenWalletSetupNote: twsNote.trim() || null,
              }),
            });
            if (res.ok) await onRefresh();
          } finally { setSavingTws(false); }
        };

        const unsetTws = async () => {
          setSavingTws(true);
          try {
            const res = await fetch(`/api/cases/${selectedCase.id}`, {
              method: 'PATCH',
              headers: headers(),
              body: JSON.stringify({
                tokenWalletSetupLink: null,
                tokenWalletSetupNote: null,
                tokenWalletSetupConfirmed: false,
              }),
            });
            if (res.ok) { setTwsLink(''); setTwsNote(''); await onRefresh(); }
          } finally { setSavingTws(false); }
        };

        const confirmTws = async (confirmed: boolean) => {
          setConfirmingTws(true);
          try {
            const res = await fetch(`/api/cases/${selectedCase.id}`, {
              method: 'PATCH',
              headers: headers(),
              body: JSON.stringify({ tokenWalletSetupConfirmed: confirmed }),
            });
            if (res.ok) await onRefresh();
          } finally { setConfirmingTws(false); }
        };

        return (
          <div className={`rounded-xl border border-l-4 border-l-purple-500 overflow-hidden transition-opacity ${!vdConf ? 'border-slate-800/50 bg-slate-900/30 opacity-50 pointer-events-none' : twsConfirmed ? 'border-purple-700/50 bg-purple-950/20' : 'border-slate-800/50 bg-slate-900/30'}`}>
            <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${twsConfirmed ? 'bg-purple-900/30 border-purple-800/40' : 'bg-slate-800/40 border-slate-800/50'}`}>
              <div className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${twsConfirmed ? 'bg-purple-500/30 border border-purple-500/50' : 'bg-purple-500/20 border border-purple-500/40'}`}>
                {twsConfirmed
                  ? <CheckCircle className="h-3 w-3 text-purple-400" />
                  : <span className="text-[10px] font-bold text-purple-400">5</span>
                }
              </div>
              <Wallet className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
              <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Token Wallet Setup</h3>
              <span data-testid="tws-status-badge" className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${twsConfirmed ? 'text-purple-300 bg-purple-900/50 border border-purple-700/50' : 'text-slate-400 bg-slate-800/50 border border-slate-700/50'}`}>
                {twsConfirmed ? 'SET UP' : 'PENDING'}
              </span>
            </div>
            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-slate-500">
                Provide the wallet setup guide URL and optional note for the user, then confirm once they complete setup.
              </p>
              {twsConfirmed ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-purple-300 bg-purple-900/20 rounded-lg px-3 py-2 border border-purple-800/30">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Wallet set up — confirmed by {selectedCase.tokenWalletSetupConfirmedBy ?? 'Admin'}
                      {selectedCase.tokenWalletSetupConfirmedAt && ` on ${new Date(selectedCase.tokenWalletSetupConfirmedAt).toLocaleString()}`}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button data-testid="tws-unconfirm-button" size="sm" variant="outline" onClick={() => confirmTws(false)} disabled={confirmingTws}
                      className="border-slate-700 text-slate-400 hover:bg-slate-800/50 text-xs">
                      {confirmingTws ? 'Unconfirming…' : 'Unconfirm'}
                    </Button>
                    <Button data-testid="tws-unset-button" size="sm" variant="outline" onClick={unsetTws} disabled={savingTws}
                      className="border-red-900/50 text-red-400 hover:bg-red-900/20 text-xs">
                      Unset
                    </Button>
                    <Button data-testid="tws-preview-email-button" size="sm" variant="outline"
                      onClick={() => setIsTwsEmailPreviewOpen(true)}
                      className="border-purple-800/60 text-purple-300 hover:bg-purple-900/20 text-xs ml-auto">
                      Preview confirmation email
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Wallet Setup URL <span className="text-red-400">*</span>
                    </label>
                    <div className="flex gap-2">
                      <Input
                        data-testid="tws-link-input"
                        value={twsLink}
                        onChange={(e) => setTwsLink(e.target.value)}
                        placeholder="https://…"
                        className="flex-1 bg-slate-800/50 border-slate-700 text-sm"
                      />
                      <Button data-testid="tws-save-button" size="sm" onClick={saveTws} disabled={savingTws || !twsLink.trim()}
                        className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold shrink-0">
                        {savingTws ? 'Saving…' : linkSaved ? 'Update' : 'Send Setup Guide'}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Instruction Note (optional)
                    </label>
                    <Textarea
                      data-testid="tws-note-textarea"
                      value={twsNote}
                      onChange={(e) => setTwsNote(e.target.value)}
                      placeholder="Additional setup instructions…"
                      className="bg-slate-800/50 border-slate-700 text-sm resize-none"
                      rows={2}
                    />
                  </div>
                  {linkSaved && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button data-testid="tws-confirm-button" size="sm" onClick={() => confirmTws(true)} disabled={confirmingTws}
                        className="bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold">
                        {confirmingTws ? 'Confirming…' : 'Mark Wallet Set Up'}
                      </Button>
                      <Button data-testid="tws-unset-button" size="sm" variant="outline" onClick={unsetTws} disabled={savingTws}
                        className="border-red-900/50 text-red-400 hover:bg-red-900/20 text-xs">
                        Unset
                      </Button>
                      <Button data-testid="tws-preview-guide-email-button" size="sm" variant="outline"
                        onClick={() => setIsTwsGuideEmailPreviewOpen(true)}
                        className="border-purple-800/60 text-purple-300 hover:bg-purple-900/20 text-xs ml-auto">
                        Preview setup guide email
                      </Button>
                      <Button data-testid="tws-preview-email-button-pending" size="sm" variant="outline"
                        onClick={() => setIsTwsEmailPreviewOpen(true)}
                        className="border-purple-800/60 text-purple-300 hover:bg-purple-900/20 text-xs">
                        Preview confirmation email
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* STEP 6 — Mark Done */}
      <div className={`rounded-xl border border-l-4 border-l-emerald-500 overflow-hidden transition-opacity ${isPermitted ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-slate-800/50 bg-slate-900/30 opacity-50 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${isPermitted ? 'bg-emerald-900/30 border-emerald-800/40' : 'bg-slate-800/40 border-slate-800/50'}`}>
          <div className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-emerald-400">6</span>
          </div>
          <Lock className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
          <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Mark Done &amp; Relock Gate</h3>
          <span className="ml-auto text-[10px] font-semibold text-emerald-400 bg-emerald-900/50 border border-emerald-700/50 rounded-full px-2 py-0.5">
            {isPermitted ? 'PENDING' : 'LOCKED'}
          </span>
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-slate-500">
            Relock the deposit gate once the withdrawal has been fully processed.
            The next disbursement cycle will require a fresh Permit (Step 3).
          </p>
          <Button size="sm" onClick={markDone} disabled={markingDone} variant="outline" className="border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/30 text-xs">
            {markingDone ? 'Relocking…' : 'Mark Done (Relock)'}
          </Button>
        </div>
      </div>

      <TwsEmailPreviewDialog
        open={isTwsEmailPreviewOpen}
        onOpenChange={setIsTwsEmailPreviewOpen}
        caseId={selectedCase.id}
        authHeaders={headers}
      />

      <TwsEmailPreviewDialog
        open={isTwsGuideEmailPreviewOpen}
        onOpenChange={setIsTwsGuideEmailPreviewOpen}
        caseId={selectedCase.id}
        authHeaders={headers}
        previewEndpoint="token-wallet-guide-email-preview"
        sendEndpoint="send-token-wallet-guide-email"
        title="Token Wallet Setup Guide Email Preview"
      />

    </div>
  );
}
