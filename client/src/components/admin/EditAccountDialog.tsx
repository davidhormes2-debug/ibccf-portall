import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LayoutDashboard,
  FileText,
  Wallet,
  Bell,
  MessageCircle,
  History,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
  KeyRound,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COUNTRY_OPTIONS } from "@shared/currencies";
import { SUPPORTED_LOCALES } from "@/i18n";
import { type Case } from "@/components/admin/shared";
import {
  formatLastActiveAgo,
  type ActiveSessionInfo,
} from "@/lib/rotateAccessCodeSession";

interface EditAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editAccountCase: Case | null;
  editAccountForm: Record<string, string>;
  setEditAccountForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSave: () => void;
  rotatingAccessCode?: boolean;
  sendingAccessCode?: boolean;
  onRotateAccessCode?: () => void;
  onSendAccessCode?: () => void;
  // Task #2382 — plain, always-visible "last active" signal for this case's
  // portal session. `undefined` = not yet fetched, `null`/`hasActiveSession:
  // false` = no active session found.
  activeSession?: ActiveSessionInfo | null;
}

export function EditAccountDialog({
  open,
  onOpenChange,
  editAccountCase,
  editAccountForm,
  setEditAccountForm,
  saving,
  onSave,
  rotatingAccessCode,
  sendingAccessCode,
  onRotateAccessCode,
  onSendAccessCode,
  activeSession,
}: EditAccountDialogProps) {
  const { t } = useTranslation();
  const [showAccessCode, setShowAccessCode] = React.useState(false);
  React.useEffect(() => {
    if (open) setShowAccessCode(false);
  }, [open, editAccountCase?.id]);
  const currentAccessCode = editAccountCase?.accessCode ?? "";
  const hasUserEmail = Boolean((editAccountCase?.userEmail ?? "").trim());
  const maskedAccessCode = currentAccessCode
    ? "•".repeat(Math.max(currentAccessCode.length, 8))
    : "—";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-fuchsia-300">{t("dialogs.editAccount.title")}</span>
            <span className="text-slate-300 text-sm font-normal">
              — {editAccountCase?.userName ?? editAccountCase?.id ?? ''}
            </span>
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Edit any field on this case. Leave a field empty to clear it.
            Changes are saved directly to the user's record.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider>
          <div className="rounded-lg border border-fuchsia-800/40 bg-fuchsia-500/5 p-3.5 mt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300 flex items-center gap-1.5 mb-2">
              <KeyRound className="h-3.5 w-3.5" /> Access Code
            </h4>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="font-mono text-base text-amber-200 tracking-wider"
                  data-testid="text-edit-acct-access-code"
                >
                  {showAccessCode ? currentAccessCode || "—" : maskedAccessCode}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-400 hover:text-white"
                  onClick={() => setShowAccessCode((v) => !v)}
                  data-testid="button-toggle-access-code-visibility"
                  aria-label={showAccessCode ? "Hide access code" : "Reveal access code"}
                >
                  {showAccessCode ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-fuchsia-700/50 text-fuchsia-200 hover:bg-fuchsia-900/30"
                disabled={!onRotateAccessCode || rotatingAccessCode}
                onClick={onRotateAccessCode}
                data-testid="button-rotate-access-code"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rotatingAccessCode ? "animate-spin" : ""}`} />
                {rotatingAccessCode ? "Rotating…" : "Rotate Code"}
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-slate-700 text-slate-200 hover:bg-slate-800"
                      disabled={!onSendAccessCode || !hasUserEmail || sendingAccessCode}
                      onClick={onSendAccessCode}
                      data-testid="button-send-access-code"
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      {sendingAccessCode ? "Sending…" : "Send to User"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!hasUserEmail && (
                  <TooltipContent>
                    No email on file for this case — add one to enable sending.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Rotating immediately invalidates the previous code and signs out any
              active portal session. Sending emails the current code to the
              registered address — it does not change the code.
            </p>
            {activeSession !== undefined && (
              <p
                className="text-[11px] mt-2 flex items-center gap-1.5"
                data-testid="text-edit-acct-last-active"
              >
                {activeSession?.hasActiveSession ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    <span className="text-emerald-300">
                      Currently active in the portal
                      {(() => {
                        const ago = formatLastActiveAgo(activeSession.lastActivityAt);
                        return ago ? ` — last activity ${ago}` : "";
                      })()}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">
                    No active portal session
                    {(() => {
                      const ago = formatLastActiveAgo(activeSession?.lastActivityAt ?? null);
                      return ago ? ` — last active ${ago}` : "";
                    })()}
                  </span>
                )}
              </p>
            )}
          </div>
        </TooltipProvider>

        {(() => {
          const renderField = (f: { key: string; label: string; help?: string }) => (
            <div key={f.key}>
              <Label htmlFor={`edit-acct-${f.key}`} className="text-slate-300 text-xs">
                {f.label}
              </Label>
              <Input
                id={`edit-acct-${f.key}`}
                value={editAccountForm[f.key] ?? ''}
                onChange={(e) =>
                  setEditAccountForm({ ...editAccountForm, [f.key]: e.target.value })
                }
                className="bg-slate-900 border-slate-700 text-white mt-1"
                data-testid={`input-edit-acct-${f.key}`}
              />
              {f.help && (
                <p className="text-[11px] text-slate-500 mt-1">{f.help}</p>
              )}
            </div>
          );

          const sectionHeading = (title: string, subtitle?: string) => (
            <div className="sm:col-span-2 mt-2 mb-1 border-t border-slate-800 pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">
                {title}
              </h4>
              {subtitle && (
                <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>
          );

          return (
            <div className="grid sm:grid-cols-2 gap-4 mt-2">
              {sectionHeading('Profile')}
              {[
                { key: 'caseRef', label: 'Case Reference', help: 'Auto-generated (IBF-YYYY-NNNN). Edit to set a custom unique label.' },
                { key: 'userName', label: 'User Name' },
                { key: 'userEmail', label: 'User Email' },
                { key: 'userMobile', label: 'User Mobile' },
                { key: 'username', label: 'Username (login)' },
                { key: 'vipStatus', label: 'VIP Status' },
                { key: 'status', label: 'Case Status' },
                { key: 'priority', label: 'Priority (high/medium/low)' },
                { key: 'assignedTo', label: 'Assigned To' },
                { key: 'tags', label: 'Tags (JSON array)' },
              ].map(renderField)}

              {/* Landing Page — picks which portal view the user lands on
                  after sign-in. Backed by a Select rather than a free-text
                  input so admins can't accidentally type an unrecognised
                  value (PortalContext falls back to 'dashboard' if so). */}
              <div>
                <Label htmlFor="edit-acct-landingPage" className="text-slate-300 text-xs">
                  Landing Page
                </Label>
                <Select
                  value={editAccountForm.landingPage || "dashboard"}
                  onValueChange={(v) =>
                    setEditAccountForm({ ...editAccountForm, landingPage: v })
                  }
                >
                  <SelectTrigger
                    id="edit-acct-landingPage"
                    className="bg-slate-900 border-slate-700 text-white mt-1"
                    data-testid="select-edit-acct-landingPage"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="dashboard">
                      <span className="flex items-center gap-2">
                        <LayoutDashboard className="h-4 w-4" /> Dashboard (Default)
                      </span>
                    </SelectItem>
                    <SelectItem value="letter">
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4" /> Withdrawal Letter
                      </span>
                    </SelectItem>
                    <SelectItem value="deposit">
                      <span className="flex items-center gap-2">
                        <Wallet className="h-4 w-4" /> Deposit Information
                      </span>
                    </SelectItem>
                    <SelectItem value="messages">
                      <span className="flex items-center gap-2">
                        <Bell className="h-4 w-4" /> Required Actions
                      </span>
                    </SelectItem>
                    <SelectItem value="chat">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4" /> Support Chat
                      </span>
                    </SelectItem>
                    <SelectItem value="history">
                      <span className="flex items-center gap-2">
                        <History className="h-4 w-4" /> Submission History
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="edit-acct-preferredLocale" className="text-slate-300 text-xs">
                  Preferred Email Language
                </Label>
                <Select
                  value={editAccountForm.preferredLocale || "__none__"}
                  onValueChange={(v) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      preferredLocale: v === "__none__" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger
                    id="edit-acct-preferredLocale"
                    className="bg-slate-900 border-slate-700 text-white mt-1"
                    data-testid="select-edit-acct-preferredLocale"
                  >
                    <SelectValue placeholder="Auto (admin/browser)" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="__none__">Auto (admin/browser)</SelectItem>
                    {SUPPORTED_LOCALES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.nativeLabel} ({l.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Locks transactional emails to this language. Leave on Auto to follow
                  whichever locale the user last picked in the portal.
                </p>
              </div>

              {sectionHeading(
                'Account Balance',
                "What the user sees as their available balance on the dashboard. Free-form — include the currency/units (e.g. '12,450.00 USDT')."
              )}
              {[
                {
                  key: 'userBalance',
                  label: 'Account Balance',
                  help: "Shown prominently on the user's dashboard. Leave empty to hide the balance card.",
                },
              ].map(renderField)}

              {sectionHeading(
                'Withdrawal',
                'Stage and total amounts surfaced to the user.'
              )}
              {[
                { key: 'withdrawalAmount', label: 'Withdrawal Amount' },
                { key: 'withdrawalBatches', label: 'Withdrawal Batches' },
                { key: 'withdrawalStage', label: 'Withdrawal Stage (1-14)' },
                { key: 'completionPercentage', label: 'Completion %' },
                { key: 'submissionUrl', label: 'Submission URL' },
                { key: 'profileRedirectUrl', label: 'Profile Redirect URL' },
              ].map(renderField)}

              <div className="sm:col-span-2 flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-700/40">
                <Switch
                  id="edit-acct-withdrawalWindowEnabled"
                  checked={String(editAccountForm.withdrawalWindowEnabled ?? '') === 'true'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      withdrawalWindowEnabled: checked ? 'true' : 'false',
                    })
                  }
                  data-testid="switch-edit-acct-withdrawalWindowEnabled"
                />
                <div className="flex-1">
                  <Label htmlFor="edit-acct-withdrawalWindowEnabled" className="text-amber-200 text-sm font-semibold">
                    Withdrawal Window Open
                  </Label>
                  <p className="text-[11px] text-amber-100/70 mt-0.5">
                    When ON, the user sees a "Request Withdrawal" button on
                    their dashboard and can submit a withdrawal request for
                    your review. Display-only — this never moves funds.
                  </p>
                </div>
              </div>

              {/* Per-case NDA toggle. Defaults to ON (mirrors the DB
                  default). When OFF the portal Sealed view hides the
                  typed-signature flow and surfaces a "no signature
                  required" notice; POST /api/cases/:id/nda/sign is
                  rejected server-side. Previously signed snapshots
                  remain in case_ndas for audit durability. */}
              <div className="sm:col-span-2 flex items-start gap-3 p-3 rounded-lg bg-indigo-500/5 border border-indigo-700/40">
                <Switch
                  id="edit-acct-ndaEnabled"
                  checked={String(editAccountForm.ndaEnabled ?? 'true') !== 'false'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      ndaEnabled: checked ? 'true' : 'false',
                    })
                  }
                  data-testid="switch-edit-acct-ndaEnabled"
                />
                <div className="flex-1">
                  <Label htmlFor="edit-acct-ndaEnabled" className="text-indigo-200 text-sm font-semibold">
                    Sealed Settlement &amp; NDA Required
                  </Label>
                  <p className="text-[11px] text-indigo-100/70 mt-0.5">
                    When ON (default), the user must type-and-sign the NDA
                    at the end of the workflow. When OFF, the signing step
                    is bypassed — the Sealed view shows a "no signature
                    required" notice and the case can be sealed
                    administratively without one. Previously signed
                    snapshots remain in the audit trail.
                  </p>
                </div>
              </div>

              {/* Task #70 — Merge Phrase Certificate.
                  Toggling this ON surfaces the Certificate view in the
                  user's portal and unlocks the fee gating flow.
                  The percent field is per-case override; leave blank
                  to use the global default (App Settings →
                  `certificate_fee_default_percent`, defaults to 5%). */}
              <div className="sm:col-span-2 flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-700/40">
                <Switch
                  id="edit-acct-certificateEnabled"
                  checked={String(editAccountForm.certificateEnabled ?? '') === 'true'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      certificateEnabled: checked ? 'true' : 'false',
                    })
                  }
                  data-testid="switch-edit-acct-certificateEnabled"
                />
                <div className="flex-1">
                  <Label htmlFor="edit-acct-certificateEnabled" className="text-amber-200 text-sm font-semibold">
                    Merge Phrase Certificate
                  </Label>
                  <p className="text-[11px] text-amber-100/70 mt-0.5">
                    When ON, the user sees a Certificate section in
                    their portal with a watermarked preview PDF and a
                    fee-payment screen. The clean PDF is released only
                    after you approve the user's fee receipt. The fee
                    is calculated as a % of the case Withdrawal Amount.
                  </p>
                  <div className="mt-2 max-w-xs">
                    <Label htmlFor="edit-acct-certificateFeePercent" className="text-amber-100/80 text-[11px]">
                      Fee % (blank = use global default)
                    </Label>
                    <Input
                      id="edit-acct-certificateFeePercent"
                      value={editAccountForm.certificateFeePercent ?? ''}
                      onChange={(e) => setEditAccountForm({
                        ...editAccountForm,
                        certificateFeePercent: e.target.value,
                      })}
                      placeholder="e.g. 5"
                      className="bg-slate-900/80 border-amber-700/40 text-white mt-1"
                      data-testid="input-edit-acct-certificateFeePercent"
                    />
                  </div>
                </div>
              </div>

              {sectionHeading(
                'Coin / Currency Preference',
                "The user's declared preferred settlement coin and network. Set by the user from their Withdrawal view (coin/currency selector), or override here. Used to pre-fill the upload category dropdown and withdrawal request form."
              )}
              <div>
                <Label htmlFor="edit-acct-preferredDepositAsset" className="text-slate-300 text-xs">
                  Preferred Asset
                </Label>
                <Select
                  value={editAccountForm.preferredDepositAsset ?? ''}
                  onValueChange={(v) =>
                    setEditAccountForm({ ...editAccountForm, preferredDepositAsset: v })
                  }
                >
                  <SelectTrigger
                    id="edit-acct-preferredDepositAsset"
                    className="bg-slate-900 border-slate-700 text-white mt-1"
                    data-testid="select-edit-acct-preferredDepositAsset"
                  >
                    <SelectValue placeholder="USDT" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="BTC">BTC</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="BNB">BNB</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">User's preferred settlement asset.</p>
              </div>
              <div>
                <Label htmlFor="edit-acct-preferredDepositNetwork" className="text-slate-300 text-xs">
                  Preferred Network
                </Label>
                <Select
                  value={editAccountForm.preferredDepositNetwork ?? ''}
                  onValueChange={(v) =>
                    setEditAccountForm({ ...editAccountForm, preferredDepositNetwork: v })
                  }
                >
                  <SelectTrigger
                    id="edit-acct-preferredDepositNetwork"
                    className="bg-slate-900 border-slate-700 text-white mt-1"
                    data-testid="select-edit-acct-preferredDepositNetwork"
                  >
                    <SelectValue placeholder="TRC20" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="TRC20">TRC20 (Tron)</SelectItem>
                    <SelectItem value="ERC20">ERC20 (Ethereum)</SelectItem>
                    <SelectItem value="BEP20">BEP20 (BSC)</SelectItem>
                    <SelectItem value="Polygon">Polygon</SelectItem>
                    <SelectItem value="Solana">Solana</SelectItem>
                    <SelectItem value="Bitcoin">Bitcoin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">User's preferred settlement network.</p>
              </div>

              <div>
                <Label htmlFor="edit-acct-mergeFeeAmount" className="text-slate-300 text-xs">
                  Batch Merge Fee Amount
                </Label>
                <Input
                  id="edit-acct-mergeFeeAmount"
                  data-testid="input-edit-acct-mergeFeeAmount"
                  className="bg-slate-900 border-slate-700 text-white mt-1"
                  placeholder="500"
                  value={editAccountForm.mergeFeeAmount ?? ''}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, mergeFeeAmount: e.target.value })
                  }
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Processing fee shown in the Merge Withdrawal confirmation card. Defaults to 500 if left blank.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 py-2.5">
                <div>
                  <p className="text-slate-300 text-xs font-medium">Hide merge-fee banner</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    When ON, the contextual merge-fee notice in the Uploads section is suppressed for this case.
                  </p>
                </div>
                <Switch
                  id="edit-acct-mergeFeeHideBanner"
                  data-testid="switch-edit-acct-mergeFeeHideBanner"
                  checked={String(editAccountForm.mergeFeeHideBanner ?? '') === 'true'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({ ...editAccountForm, mergeFeeHideBanner: checked ? 'true' : 'false' })
                  }
                />
              </div>

              {sectionHeading(
                'Deposit Balance',
                'Free-form override of every deposit amount the user sees on their portal. Leave a field empty to clear it.'
              )}
              {[
                {
                  key: 'depositAddress',
                  label: 'Deposit Address',
                  help: 'Wallet address shown to the user on the deposit screen.',
                },
                {
                  key: 'activityDepositAmount',
                  label: 'Activity Deposit Amount',
                  help: 'Amount the user must keep in wallet for activity verification.',
                },
                {
                  key: 'phraseKeyDepositAmount',
                  label: 'Phrase Key Deposit',
                  help: 'Total phrase-key deposit billed to the user.',
                },
                {
                  key: 'phraseKeyMergeDeposit',
                  label: 'Phrase Key Merge Deposit',
                  help: 'Override the auto-calculated 30% merge deposit.',
                },
                {
                  key: 'activityWalletRequirement',
                  label: 'Activity Wallet Requirement',
                  help: 'USDT amount used for the activity verification step.',
                },
              ].map(renderField)}

              {sectionHeading(
                'Withdrawal Pathway Clearance',
                'The clearance code the user must receive from the admin in order to submit the Declaration of Compliance. Editing this overrides the auto-generated value.'
              )}
              <div className="sm:col-span-2">
                <Label htmlFor="edit-acct-declarationAccessCode" className="text-slate-300 text-xs">
                  Clearance Code
                </Label>
                <Input
                  id="edit-acct-declarationAccessCode"
                  value={editAccountForm.declarationAccessCode ?? ''}
                  onChange={(e) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      declarationAccessCode: e.target.value,
                    })
                  }
                  placeholder="e.g. 12345678"
                  className="bg-slate-900 border-amber-700/60 text-amber-200 font-mono mt-1"
                  data-testid="input-edit-acct-declarationAccessCode"
                />
                <p className="text-[11px] text-amber-400/80 mt-1">
                  Sensitive — share with the user out-of-band only. Leave
                  empty to clear and force the user to request a new one.
                </p>
              </div>

              {sectionHeading(
                'Country Mode',
                "When enabled, every USDT amount the user sees on their portal also displays an estimated value in their local currency (e.g. \"1,500 USDT (~2,040 CAD)\"). Live exchange rates are pulled from a public FX API and cached server-side for one hour."
              )}
              <div>
                <Label htmlFor="edit-acct-country" className="text-slate-300 text-xs">
                  User's Country
                </Label>
                <Select
                  value={editAccountForm.country ?? ''}
                  onValueChange={(v) =>
                    setEditAccountForm({ ...editAccountForm, country: v === '__none__' ? '' : v })
                  }
                >
                  <SelectTrigger
                    id="edit-acct-country"
                    className="bg-slate-900 border-slate-700 text-white mt-1"
                    data-testid="select-edit-acct-country"
                  >
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-72">
                    <SelectItem value="__none__">Not set</SelectItem>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Used to pick the local currency. Eurozone countries map to EUR.
                </p>
              </div>
              <div className="flex items-start gap-3 mt-1">
                <Switch
                  id="edit-acct-isRegulated"
                  checked={editAccountForm.isRegulated === 'true'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      isRegulated: checked ? 'true' : 'false',
                    })
                  }
                  data-testid="switch-edit-acct-isRegulated"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="edit-acct-isRegulated"
                    className="text-slate-300 text-xs cursor-pointer"
                  >
                    Mark account as Fully Regulated
                  </Label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Shows a blue verified checkmark next to the user's name
                    in the portal. Use only after every regulatory checkpoint
                    (KYC, declaration, source-of-funds) has been cleared.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 mt-1">
                <Switch
                  id="edit-acct-localizedCurrencyEnabled"
                  checked={editAccountForm.localizedCurrencyEnabled === 'true'}
                  onCheckedChange={(checked) =>
                    setEditAccountForm({
                      ...editAccountForm,
                      localizedCurrencyEnabled: checked ? 'true' : 'false',
                    })
                  }
                  data-testid="switch-edit-acct-localizedCurrencyEnabled"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="edit-acct-localizedCurrencyEnabled"
                    className="text-slate-300 text-xs cursor-pointer"
                  >
                    Show local currency estimates
                  </Label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Requires a country to be selected. If the country has no mapped
                    currency, no estimate is shown and the USDT figure is kept as-is.
                  </p>
                </div>
              </div>

              {sectionHeading('Notes')}
              <div className="sm:col-span-2">
                <Label htmlFor="edit-acct-internalNotes" className="text-slate-300 text-xs">
                  Internal Notes (admin-only)
                </Label>
                <Textarea
                  id="edit-acct-internalNotes"
                  value={editAccountForm.internalNotes ?? ''}
                  onChange={(e) =>
                    setEditAccountForm({ ...editAccountForm, internalNotes: e.target.value })
                  }
                  rows={4}
                  className="bg-slate-900 border-slate-700 text-white mt-1"
                  data-testid="textarea-edit-acct-internalNotes"
                />
              </div>
            </div>
          );
        })()}
        <DialogFooter className="mt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            data-testid="button-edit-acct-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white"
            data-testid="button-edit-acct-save"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
