import React, { useEffect, useState } from "react";
import { ShieldAlert, RefreshCw, Check, X, Eye, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface CaseData {
  id: string;
  sessionRefreshRequired?: boolean | null;
  sessionRefreshAddress?: string | null;
  sessionRefreshAmount?: string | null;
  sessionRefreshAsset?: string | null;
  sessionRefreshNetwork?: string | null;
  sessionRefreshNote?: string | null;
  sessionRefreshStatus?: string | null;
}

interface Receipt {
  id: number;
  caseId: string;
  txHash?: string | null;
  fileName?: string | null;
  adminNotes?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  submittedAt: string;
}

interface Props {
  selectedCase: CaseData | null;
  authToken: string | null;
  onCaseUpdated: (updated: CaseData) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pending upload",   color: "text-amber-400"  },
  submitted: { label: "Awaiting review",  color: "text-blue-400"   },
  approved:  { label: "Approved",         color: "text-green-400"  },
  rejected:  { label: "Rejected",         color: "text-red-400"    },
};

export function SessionRefreshPanel({ selectedCase, authToken, onCaseUpdated }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  // Config form state — synced from selectedCase when panel opens or case changes.
  const [enabled,  setEnabled]  = useState(false);
  const [address,  setAddress]  = useState("");
  const [amount,   setAmount]   = useState("");
  const [asset,    setAsset]    = useState("USDT");
  const [network,  setNetwork]  = useState("TRC20");
  const [note,     setNote]     = useState("");
  const [saving,   setSaving]   = useState(false);

  // Receipt list state.
  const [receipts,  setReceipts]  = useState<Receipt[]>([]);
  const [loadingR,  setLoadingR]  = useState(false);
  const [viewBlob,  setViewBlob]  = useState<string | null>(null);
  const [loadingB,  setLoadingB]  = useState(false);

  // Review action state.
  const [rejectNote,   setRejectNote]   = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [reviewing,    setReviewing]    = useState(false);
  const [reRequesting, setReRequesting] = useState(false);
  const [showReject,   setShowReject]   = useState(false);

  // Sync form fields from case.
  useEffect(() => {
    if (!selectedCase) return;
    setEnabled(!!selectedCase.sessionRefreshRequired);
    setAddress(selectedCase.sessionRefreshAddress  ?? "");
    setAmount(selectedCase.sessionRefreshAmount   ?? "");
    setAsset(selectedCase.sessionRefreshAsset    ?? "USDT");
    setNetwork(selectedCase.sessionRefreshNetwork  ?? "TRC20");
    setNote(selectedCase.sessionRefreshNote     ?? "");
  }, [selectedCase?.id, selectedCase?.sessionRefreshRequired, selectedCase?.sessionRefreshStatus]);

  // Load receipts when panel is opened.
  useEffect(() => {
    if (!open || !selectedCase?.id || !authToken) return;
    loadReceipts();
  }, [open, selectedCase?.id]);

  const loadReceipts = async () => {
    if (!selectedCase?.id || !authToken) return;
    setLoadingR(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/session-refresh/receipts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) setReceipts(await res.json());
    } catch { /* swallow */ }
    setLoadingR(false);
  };

  const refreshCase = async () => {
    if (!selectedCase?.id || !authToken) return;
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) onCaseUpdated(await res.json());
    } catch { /* swallow */ }
  };

  const saveConfig = async () => {
    if (!selectedCase?.id || !authToken) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        sessionRefreshRequired: enabled,
        sessionRefreshAddress:  address.trim() || null,
        sessionRefreshAmount:   amount.trim()  || null,
        sessionRefreshAsset:    asset.trim()   || null,
        sessionRefreshNetwork:  network.trim() || null,
        sessionRefreshNote:     note.trim()    || null,
      };
      // When turning on the gate for the first time, set status to 'pending'.
      if (enabled && !selectedCase.sessionRefreshStatus) {
        body.sessionRefreshStatus = "pending";
      }
      const res = await fetch(`/api/cases/${selectedCase.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast({ title: "Session refresh gate saved" });
        await refreshCase();
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setSaving(false);
  };

  const viewReceipt = async (receiptId: number) => {
    if (!selectedCase?.id || !authToken) return;
    setLoadingB(true);
    setViewBlob(null);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/session-refresh/receipts/${receiptId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const d = await res.json();
        setViewBlob(d.receiptData ?? null);
      }
    } catch { /* swallow */ }
    setLoadingB(false);
  };

  const review = async (action: "approve" | "reject") => {
    if (!selectedCase?.id || !authToken) return;
    setReviewing(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/session-refresh/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action,
          adminNotes: action === "reject" ? rejectNote.trim() || undefined : approvalNote.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast({ title: `Receipt ${action}d` });
        setShowReject(false);
        setRejectNote("");
        setApprovalNote("");
        await loadReceipts();
        await refreshCase();
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Review failed", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setReviewing(false);
  };

  const reRequest = async () => {
    if (!selectedCase?.id || !authToken) return;
    setReRequesting(true);
    try {
      const res = await fetch(`/api/cases/${selectedCase.id}/session-refresh/re-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        toast({ title: "Re-requested", description: "Gate reset to pending." });
        await refreshCase();
      } else {
        toast({ title: "Failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setReRequesting(false);
  };

  if (!selectedCase) return null;

  const status = selectedCase.sessionRefreshStatus;
  const statusInfo = status ? STATUS_LABELS[status] : null;
  const isSubmitted = status === "submitted";

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      {/* Collapsible header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-500/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-amber-300">Session Refresh Deposit</span>
            {statusInfo && (
              <span className={`ml-2 text-xs ${statusInfo.color}`}>— {statusInfo.label}</span>
            )}
            {!selectedCase.sessionRefreshRequired && (
              <span className="ml-2 text-xs text-slate-500">— Disabled</span>
            )}
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-amber-500/15 px-4 py-4 space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">Require deposit to access portal</p>
              <p className="text-xs text-slate-400 mt-0.5">
                When enabled, the user sees a blocking gate page after login until their receipt is approved.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Config fields — only meaningful when enabled */}
          <div className={`space-y-3 transition-opacity ${enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">Amount</Label>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="bg-slate-800/50 border-slate-700 text-white text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">Asset</Label>
                <Input
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  placeholder="USDT"
                  className="bg-slate-800/50 border-slate-700 text-white text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">Network</Label>
              <Input
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder="TRC20"
                className="bg-slate-800/50 border-slate-700 text-white text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">Deposit Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Wallet address"
                className="bg-slate-800/50 border-slate-700 text-white text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Note for user (optional)
              </Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any additional instructions shown on the gate page…"
                className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={saveConfig}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Configuration"}
            </Button>
            {(status === "approved" || status === "rejected") && (
              <Button
                size="sm"
                variant="outline"
                onClick={reRequest}
                disabled={reRequesting}
                className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                {reRequesting
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Working…</>
                  : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Re-request Deposit</>
                }
              </Button>
            )}
          </div>

          {/* Submitted receipt review */}
          {isSubmitted && (
            <div className="border-t border-white/8 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
                  Submitted Receipt
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadReceipts}
                  disabled={loadingR}
                  className="h-6 px-2 text-xs bg-slate-800/40 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  {loadingR ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
                </Button>
              </div>

              {loadingR ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading receipts…
                </div>
              ) : receipts.length === 0 ? (
                <p className="text-xs text-slate-500">No receipts found.</p>
              ) : (
                <div className="space-y-2">
                  {receipts.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg bg-slate-800/40 border border-slate-700 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 text-xs text-slate-400">
                          <p>
                            <span className="text-slate-300">Submitted:</span>{" "}
                            {new Date(r.submittedAt).toLocaleString()}
                          </p>
                          {r.txHash && (
                            <p className="font-mono break-all">
                              <span className="text-slate-300">Tx:</span> {r.txHash}
                            </p>
                          )}
                          {r.fileName && <p><span className="text-slate-300">File:</span> {r.fileName}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewReceipt(r.id)}
                          disabled={loadingB}
                          className="h-7 px-2 text-xs shrink-0 bg-slate-900/50 border-slate-600 text-slate-300 hover:bg-slate-800"
                        >
                          {loadingB ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Eye className="w-3 h-3 mr-1" />View</>}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Receipt image / PDF preview */}
              {viewBlob && (
                <div className="rounded-lg overflow-hidden border border-slate-700">
                  {viewBlob.startsWith("data:application/pdf") ? (
                    <iframe src={viewBlob} className="w-full h-64" title="Receipt PDF" />
                  ) : (
                    <img src={viewBlob} alt="Receipt" className="max-h-72 w-full object-contain bg-black/30" />
                  )}
                  <div className="flex justify-end px-3 py-1.5 bg-slate-900/50">
                    <button
                      onClick={() => setViewBlob(null)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Hide
                    </button>
                  </div>
                </div>
              )}

              {/* Approve / Reject actions */}
              <div className="space-y-3 pt-1">
                {showReject ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                        Rejection reason (shown to user)
                      </Label>
                      <Textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Explain why the receipt was rejected…"
                        className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => review("reject")}
                        disabled={reviewing || !rejectNote.trim()}
                      >
                        {reviewing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><X className="w-3.5 h-3.5 mr-1" />Confirm Rejection</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setShowReject(false); setRejectNote(""); }}
                        className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                        Approval note (optional, audit log only)
                      </Label>
                      <Textarea
                        value={approvalNote}
                        onChange={(e) => setApprovalNote(e.target.value)}
                        placeholder="Internal note…"
                        className="bg-slate-800/50 border-slate-700 text-white text-sm resize-none"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => review("approve")}
                        disabled={reviewing}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {reviewing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5 mr-1" />Approve</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowReject(true)}
                        disabled={reviewing}
                      >
                        <X className="w-3.5 h-3.5 mr-1" /> Reject…
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Receipt history (when not in submitted state) */}
          {!isSubmitted && receipts.length > 0 && (
            <div className="border-t border-white/8 pt-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Receipt History</p>
              {receipts.map((r) => (
                <div key={r.id} className="text-xs text-slate-500 flex items-center gap-2">
                  <span>{new Date(r.submittedAt).toLocaleDateString()}</span>
                  {r.reviewedBy && <span>— reviewed by {r.reviewedBy}</span>}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => viewReceipt(r.id)}
                    className="h-5 px-1.5 text-[10px] text-slate-500 hover:text-slate-300"
                  >
                    <Eye className="w-2.5 h-2.5 mr-0.5" /> View
                  </Button>
                </div>
              ))}
              {viewBlob && (
                <div className="rounded-lg overflow-hidden border border-slate-700">
                  {viewBlob.startsWith("data:application/pdf") ? (
                    <iframe src={viewBlob} className="w-full h-64" title="Receipt PDF" />
                  ) : (
                    <img src={viewBlob} alt="Receipt" className="max-h-64 w-full object-contain bg-black/30" />
                  )}
                  <div className="flex justify-end px-3 py-1.5 bg-slate-900/50">
                    <button onClick={() => setViewBlob(null)} className="text-xs text-slate-500 hover:text-slate-300">
                      Hide
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
