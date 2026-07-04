import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, XCircle, Loader2, Send, Monitor, Mail, FileText, Zap, SkipForward, DollarSign, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  checkHasActiveSession,
  buildOverrideCountdownConfirmMessage,
  buildSkipToReactivationConfirmMessage,
} from "@/lib/rotateAccessCodeSession";

interface Props {
  caseId: string;
  authToken: string | null;
  /** Display name used in the "currently active" confirm dialogs for
   *  Override Countdown / Skip to Reactivation. Falls back to the case id
   *  when omitted. */
  userLabel?: string;
  portalWarningAt?: string | null;
  portalWarningMinutes?: number | null;
  portalWarningMessage?: string | null;
  activityDepositAmount?: string | null;
  reactivationPageMessage?: string | null;
  onChanged?: () => void;
  /** Role of the currently-authenticated admin. Defaults to "admin" so
   *  existing usages without the prop keep all controls visible. Viewer
   *  and agent roles cannot invoke portal-warning mutations and will not
   *  see the set / clear / override action buttons. */
  adminRole?: string;
  /** Opens the given case's detail view in-app (switches to the Cases tab
   *  and selects the case) without a full-page reload. Used by the sweep
   *  result panel's case-id badges. Falls back to no-op if not provided. */
  onOpenCase?: (caseId: string) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (days > 0) {
    return `${pad(days)}:${pad(hours)}:${pad(m)}:${pad(s)}`;
  }
  if (hours > 0) {
    return `${pad(hours)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

const DURATION_OPTIONS = [
  { value: "1",    label: "1 minute" },
  { value: "2",    label: "2 minutes" },
  { value: "5",    label: "5 minutes" },
  { value: "10",   label: "10 minutes" },
  { value: "15",   label: "15 minutes" },
  { value: "20",   label: "20 minutes" },
  { value: "30",   label: "30 minutes" },
  { value: "45",   label: "45 minutes" },
  { value: "60",   label: "1 hour" },
  { value: "90",   label: "1.5 hours" },
  { value: "120",  label: "2 hours" },
  { value: "180",  label: "3 hours" },
  { value: "240",  label: "4 hours" },
  { value: "360",  label: "6 hours" },
  { value: "480",  label: "8 hours" },
  { value: "720",  label: "12 hours" },
  { value: "1440", label: "24 hours (1 day)" },
  { value: "2880", label: "48 hours (2 days)" },
  { value: "4320", label: "72 hours (3 days)" },
  { value: "5760", label: "4 days" },
  { value: "7200", label: "5 days" },
];

const CLOSURE_TEMPLATE = {
  portal:
    "Due to extended inactivity, your portal session and withdrawal pathway are scheduled to close when this countdown ends. Once closed, your withdrawal structure will be reset and all NDA seals, declarations, and prior validations will be voided. A reactivation deposit will be required to restore access. You will be redirected to the reactivation deposit page after closure.",
  email:
    "Your account has remained inactive for an extended period, and your portal session is now scheduled to close. When the countdown ends, your withdrawal pathway will be reset and all NDA seals, declarations, and compliance validations will be voided. To continue with your withdrawal, you will need to complete the reactivation process on the reactivation deposit page that will appear after closure.",
};

const LOCKOUT_WARNING_TEMPLATE =
  "Your portal access is about to be suspended due to a compliance hold on your withdrawal pathway. When this countdown expires, you will be automatically logged out and redirected to the reactivation deposit page. If you believe this is in error, please contact support immediately using the button below.";


export function AdminPortalWarningPanel({
  caseId,
  authToken,
  userLabel,
  portalWarningAt,
  portalWarningMinutes,
  portalWarningMessage,
  activityDepositAmount,
  reactivationPageMessage: reactivationPageMessageProp,
  onChanged,
  adminRole = "admin",
  onOpenCase,
}: Props) {
  const canMutate = adminRole === "admin" || adminRole === "super_admin";
  const { toast } = useToast();
  const [minutes, setMinutes] = useState("5");
  const [portalMessage, setPortalMessage] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [lockoutMessage, setLockoutMessage] = useState("");
  const [depositAmount, setDepositAmount] = useState(activityDepositAmount ?? "");
  const [reactivationPageMessage, setReactivationPageMessage] = useState(reactivationPageMessageProp ?? "");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [savingDeposit, setSavingDeposit] = useState(false);
  const [savingReactivationMessage, setSavingReactivationMessage] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [lastSweepResult, setLastSweepResult] = useState<{ processed: number; closedCaseIds: string[] } | null>(null);
  const [msLeft, setMsLeft] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive =
    !!portalWarningAt &&
    !!portalWarningMinutes &&
    Date.now() <
      new Date(portalWarningAt).getTime() + portalWarningMinutes * 60 * 1000;

  useEffect(() => {
    setDepositAmount(activityDepositAmount ?? "");
  }, [activityDepositAmount]);

  useEffect(() => {
    setReactivationPageMessage(reactivationPageMessageProp ?? "");
  }, [reactivationPageMessageProp]);

  useEffect(() => {
    if (!isActive || !portalWarningAt || !portalWarningMinutes) {
      setMsLeft(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const expiresAt =
      new Date(portalWarningAt).getTime() + portalWarningMinutes * 60 * 1000;
    function tick() {
      setMsLeft(Math.max(0, expiresAt - Date.now()));
    }
    tick();
    intervalRef.current = setInterval(tick, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, portalWarningAt, portalWarningMinutes]);

  const sendWarning = useCallback(async () => {
    if (!authToken) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/portal-warning`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          minutes: Number(minutes),
          portalMessage: (lockoutMessage.trim() || portalMessage.trim()) || undefined,
          emailMessage: emailMessage.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      const durationLabel = DURATION_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} minutes`;
      toast({
        title: "Portal warning sent",
        description: `The user will see a ${durationLabel} countdown overlay. An email notification has been dispatched.`,
      });
      setPortalMessage("");
      setEmailMessage("");
      setLockoutMessage("");
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to send warning",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [authToken, caseId, minutes, portalMessage, lockoutMessage, emailMessage, toast, onChanged]);

  const cancelWarning = useCallback(async () => {
    if (!authToken) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/portal-warning`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Warning cancelled", description: "The portal closure warning has been cancelled." });
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to cancel warning",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  }, [authToken, caseId, toast, onChanged]);

  const overrideCountdown = useCallback(async () => {
    if (!authToken) return;
    const label = userLabel || caseId;
    const activeSession = await checkHasActiveSession(caseId, authToken);
    if (!window.confirm(buildOverrideCountdownConfirmMessage(label, activeSession))) {
      return;
    }
    setOverriding(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/portal-warning/override`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      toast({
        title: "Countdown overridden",
        description: "The countdown has been ended and the account is now locked. The user will be redirected to the reactivation page.",
      });
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to override countdown",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setOverriding(false);
    }
  }, [authToken, caseId, userLabel, toast, onChanged]);

  const skipToReactivation = useCallback(async () => {
    if (!authToken) return;
    const label = userLabel || caseId;
    const activeSession = await checkHasActiveSession(caseId, authToken);
    if (!window.confirm(buildSkipToReactivationConfirmMessage(label, activeSession))) {
      return;
    }
    setSkipping(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/portal-warning/skip-reactivation`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      toast({
        title: "Skipped to reactivation",
        description: "The account has been locked immediately. The user will be redirected to the reactivation deposit page.",
      });
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to skip to reactivation",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSkipping(false);
    }
  }, [authToken, caseId, userLabel, toast, onChanged]);

  const saveDepositAmount = useCallback(async () => {
    if (!authToken) return;
    const trimmed = depositAmount.trim();
    setSavingDeposit(true);
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ activityDepositAmount: trimmed || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Deposit amount saved", description: trimmed ? `Reactivation deposit set to ${trimmed} USDT.` : "Reactivation deposit amount cleared." });
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to save deposit amount",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingDeposit(false);
    }
  }, [authToken, caseId, depositAmount, toast, onChanged]);

  const saveReactivationPageMessage = useCallback(async () => {
    if (!authToken) return;
    const trimmed = reactivationPageMessage.trim();
    setSavingReactivationMessage(true);
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ reactivationPageMessage: trimmed || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Message saved", description: trimmed ? "Reactivation page message updated." : "Reactivation page message cleared." });
      onChanged?.();
    } catch (err) {
      toast({
        title: "Failed to save message",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingReactivationMessage(false);
    }
  }, [authToken, caseId, reactivationPageMessage, toast, onChanged]);

  const runExpirySweep = useCallback(async () => {
    if (!authToken) return;
    setSweepRunning(true);
    setLastSweepResult(null);
    try {
      const res = await fetch("/api/admin/portal-warning-expiry-sweep/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { processed: number; skipped: boolean; closedCaseIds: string[] };
      if (data.skipped) {
        toast({
          title: "Sweep skipped",
          description: "A sweep was already in progress. Try again in a moment.",
        });
      } else {
        setLastSweepResult({ processed: data.processed, closedCaseIds: data.closedCaseIds ?? [] });
        toast({
          title: "Sweep complete",
          description: data.processed === 0
            ? "No expired warnings found."
            : `${data.processed} case${data.processed === 1 ? "" : "s"} force-disabled.`,
        });
      }
      onChanged?.();
    } catch (err) {
      toast({
        title: "Sweep failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSweepRunning(false);
    }
  }, [authToken, toast, onChanged]);


  return (
    <div
      className="rounded-xl border space-y-4 p-4"
      style={{
        background: isActive
          ? "rgba(120,53,15,0.12)"
          : "rgba(15,23,42,0.4)",
        borderColor: isActive
          ? "rgba(245,158,11,0.35)"
          : "rgba(51,65,85,0.6)",
      }}
      data-testid="panel-portal-warning"
    >
      <div className="flex items-center gap-2">
        <div
          className="h-6 w-6 rounded flex items-center justify-center"
          style={{
            background: isActive
              ? "rgba(245,158,11,0.2)"
              : "rgba(239,68,68,0.15)",
          }}
        >
          <AlertTriangle
            className="h-3.5 w-3.5"
            style={{ color: isActive ? "#fbbf24" : "#f87171" }}
          />
        </div>
        <h4 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
          Portal Closure Warning
        </h4>
        {isActive && (
          <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 ml-auto text-xs">
            <Clock className="h-3 w-3 mr-1" />
            ACTIVE — {formatCountdown(msLeft)} left
          </Badge>
        )}
      </div>

      {isActive ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-sm text-amber-200 space-y-1">
            <div className="font-semibold">Warning is active</div>
            <div className="text-amber-300/80 text-xs">
              Duration: {DURATION_OPTIONS.find((o) => o.value === String(portalWarningMinutes))?.label ?? `${portalWarningMinutes} minutes`} &nbsp;·&nbsp;
              Expires: {formatCountdown(msLeft)} remaining
            </div>
            {portalWarningMessage && (
              <div className="text-amber-200/70 text-xs mt-1 italic">
                Portal message: "{portalWarningMessage}"
              </div>
            )}
          </div>
          {/* Reactivation deposit amount — editable while warning is active */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400 flex items-center gap-1.5">
              <DollarSign className="h-3 w-3" />
              Reactivation deposit amount (USDT)
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 250"
                className="h-8 text-xs bg-slate-900 border-slate-700 text-slate-200 flex-1"
                data-testid="input-reactivation-deposit-amount"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={saveDepositAmount}
                disabled={savingDeposit}
                className="h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 bg-transparent shrink-0"
                data-testid="button-save-deposit-amount"
              >
                {savingDeposit ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
          {/* Reactivation page message — editable while warning is active */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400 flex items-center gap-1.5">
              <Monitor className="h-3 w-3" />
              Reactivation page message
              <span className="text-slate-600 font-normal">(shown at the top of the reactivation deposit page)</span>
            </Label>
            <div className="flex gap-2 items-start">
              <Textarea
                value={reactivationPageMessage}
                onChange={(e) => setReactivationPageMessage(e.target.value)}
                placeholder="e.g. Your account has been suspended due to a compliance review. Please submit the reactivation deposit to restore access."
                className="text-xs bg-slate-900 border-slate-700 text-slate-200 resize-none h-16 flex-1"
                maxLength={600}
                data-testid="input-reactivation-page-message"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={saveReactivationPageMessage}
                disabled={savingReactivationMessage}
                className="h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 bg-transparent shrink-0 mt-0.5"
                data-testid="button-save-reactivation-page-message"
              >
                {savingReactivationMessage ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-[10px] text-slate-600" data-testid="char-count-reactivation-page-message">{reactivationPageMessage.length}/600</p>
          </div>
          {canMutate && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={cancelWarning}
                disabled={cancelling}
                className="border-red-500/40 text-red-300 hover:bg-red-500/10 bg-transparent"
                data-testid="button-cancel-portal-warning"
              >
                {cancelling ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                )}
                Cancel Warning
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={overrideCountdown}
                disabled={overriding}
                className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10 bg-transparent"
                data-testid="button-override-countdown"
              >
                {overriding ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                )}
                Override Countdown
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Sends a timed fullscreen countdown to the user's portal and an email notification. The user is automatically logged out when the timer reaches zero. Supports up to 5 days.
          </p>

          {canMutate ? (
            <>
              {/* Skip to Reactivation (no countdown needed) */}
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 flex items-start gap-2.5">
                <SkipForward className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-300 font-medium leading-snug">Skip to Reactivation</p>
                  <p className="text-[10px] text-slate-500 leading-snug mt-0.5">Immediately lock the account and redirect the user to the reactivation deposit page — no countdown required.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-6 text-[10px] px-2 border-red-500/40 text-red-300 hover:bg-red-500/10 bg-transparent"
                  onClick={skipToReactivation}
                  disabled={skipping}
                  data-testid="button-skip-to-reactivation"
                >
                  {skipping ? <Loader2 className="h-3 w-3 animate-spin" /> : "Skip Now"}
                </Button>
              </div>

              {/* Duration */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Countdown Duration</Label>
                <Select value={minutes} onValueChange={setMinutes}>
                  <SelectTrigger className="h-8 text-xs bg-slate-900 border-slate-700 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    {DURATION_OPTIONS.map(({ value, label }) => (
                      <SelectItem key={value} value={value} className="text-xs text-slate-200">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reactivation deposit amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                  <DollarSign className="h-3 w-3" />
                  Reactivation deposit amount (USDT)
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="e.g. 250"
                    className="h-8 text-xs bg-slate-900 border-slate-700 text-slate-200 flex-1"
                    data-testid="input-reactivation-deposit-amount"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={saveDepositAmount}
                    disabled={savingDeposit}
                    className="h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 bg-transparent shrink-0"
                    data-testid="button-save-deposit-amount"
                  >
                    {savingDeposit ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>

              {/* Reactivation page message */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Monitor className="h-3 w-3" />
                  Reactivation page message
                  <span className="text-slate-600 font-normal">(shown at the top of the reactivation deposit page)</span>
                </Label>
                <div className="flex gap-2 items-start">
                  <Textarea
                    value={reactivationPageMessage}
                    onChange={(e) => setReactivationPageMessage(e.target.value)}
                    placeholder="e.g. Your account has been suspended due to a compliance review. Please submit the reactivation deposit to restore access."
                    className="text-xs bg-slate-900 border-slate-700 text-slate-200 resize-none h-16 flex-1"
                    maxLength={600}
                    data-testid="input-reactivation-page-message"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={saveReactivationPageMessage}
                    disabled={savingReactivationMessage}
                    className="h-8 text-xs border-slate-700 text-slate-300 hover:bg-slate-800 bg-transparent shrink-0 mt-0.5"
                    data-testid="button-save-reactivation-page-message"
                  >
                    {savingReactivationMessage ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <p className="text-[10px] text-slate-600" data-testid="char-count-reactivation-page-message">{reactivationPageMessage.length}/600</p>
              </div>

              {/* Template shortcut */}
              <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2.5 flex items-start gap-2.5">
                <FileText className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-300 font-medium leading-snug">Account closure &amp; reactivation template</p>
                  <p className="text-[10px] text-slate-500 leading-snug mt-0.5">Notifies the user their portal will close and a reactivation deposit is required.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 h-6 text-[10px] px-2 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 bg-transparent"
                  onClick={() => {
                    setPortalMessage(CLOSURE_TEMPLATE.portal);
                    setEmailMessage(CLOSURE_TEMPLATE.email);
                  }}
                  data-testid="button-use-template"
                >
                  Use template
                </Button>
              </div>

              {/* Portal page message (legacy / quick fill) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Monitor className="h-3 w-3" />
                  Portal countdown message
                  <span className="text-slate-600 font-normal">(shown inside the countdown overlay)</span>
                </Label>
                <Textarea
                  value={portalMessage}
                  onChange={(e) => setPortalMessage(e.target.value)}
                  placeholder="e.g. Your portal access will close at the end of this session. A reactivation deposit will be required to continue."
                  className="text-xs bg-slate-900 border-slate-700 text-slate-200 resize-none h-16"
                  maxLength={500}
                  data-testid="input-portal-warning-message"
                />
                <p className="text-[10px] text-slate-600">{portalMessage.length}/500</p>
              </div>

              {/* Lockout warning message */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                    Lockout warning message
                    <span className="text-slate-600 font-normal">(overlay body text — overrides countdown message)</span>
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 text-[10px] px-1.5 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => setLockoutMessage(LOCKOUT_WARNING_TEMPLATE)}
                    data-testid="button-use-lockout-template"
                  >
                    Use template
                  </Button>
                </div>
                <Textarea
                  value={lockoutMessage}
                  onChange={(e) => setLockoutMessage(e.target.value)}
                  placeholder="e.g. Your portal access is about to be suspended. Please contact support if you need assistance before the timer expires."
                  className="text-xs bg-slate-900 border-slate-700 text-slate-200 resize-none h-20"
                  maxLength={600}
                  data-testid="input-lockout-warning-message"
                />
                <p className="text-[10px] text-slate-600">{lockoutMessage.length}/600</p>
              </div>

              {/* Email message */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Mail className="h-3 w-3" />
                  Email to user
                  <span className="text-slate-600 font-normal">(sent in the notification email — leave blank to use portal message)</span>
                </Label>
                <Textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder="e.g. Your portal access will close for compliance review. A reactivation deposit will be required to resume your withdrawal."
                  className="text-xs bg-slate-900 border-slate-700 text-slate-200 resize-none h-20"
                  maxLength={1000}
                  data-testid="input-portal-warning-email-message"
                />
                <p className="text-[10px] text-slate-600">{emailMessage.length}/1000</p>
              </div>

              <Button
                size="sm"
                onClick={sendWarning}
                disabled={sending}
                className="bg-amber-600 hover:bg-amber-500 text-white border-0"
                data-testid="button-send-portal-warning"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                Send Warning
              </Button>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic" data-testid="portal-warning-viewer-notice">
              Your role does not permit sending or modifying portal warnings.
            </p>
          )}
        </div>
      )}

      {/* Global sweep trigger — always visible */}
      <div className="space-y-2">
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-2.5 flex items-center gap-2.5">
          <RefreshCw className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-300 font-medium leading-snug">Run expiry sweep now</p>
            <p className="text-[10px] text-slate-500 leading-snug mt-0.5">Force-disable all cases whose warning countdown has already expired — without waiting for the next 5-minute auto-run.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 h-6 text-[10px] px-2 border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
            onClick={runExpirySweep}
            disabled={sweepRunning}
            data-testid="button-run-expiry-sweep"
          >
            {sweepRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : "Run now"}
          </Button>
        </div>

        {/* Sweep result detail — shown after a successful run */}
        {lastSweepResult !== null && (
          <div
            className="rounded-lg border px-3 py-2.5 space-y-1.5"
            style={{
              borderColor: lastSweepResult.processed > 0 ? "rgba(239,68,68,0.3)" : "rgba(51,65,85,0.5)",
              background: lastSweepResult.processed > 0 ? "rgba(239,68,68,0.06)" : "rgba(15,23,42,0.3)",
            }}
            data-testid="sweep-result-panel"
          >
            <p className="text-[11px] font-medium" style={{ color: lastSweepResult.processed > 0 ? "#fca5a5" : "#94a3b8" }}>
              {lastSweepResult.processed === 0
                ? "No expired warnings — all countdowns are still active or none exist."
                : `${lastSweepResult.processed} case${lastSweepResult.processed === 1 ? "" : "s"} force-disabled by sweep:`}
            </p>
            {lastSweepResult.closedCaseIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="sweep-result-case-ids">
                {lastSweepResult.closedCaseIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpenCase?.(id)}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
                    data-testid={`sweep-result-case-id-${id}`}
                  >
                    #{id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
