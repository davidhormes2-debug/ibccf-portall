import { useState, useEffect } from "react";
import {
  Award, CheckCircle2, XCircle, Clock, Download, Loader2, FileText, RotateCcw, AlertTriangle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface RefundClaimEntry {
  amount: string;
  chargedFor: string;
  date: string;
  txId?: string;
  network?: string;
  notes?: string;
}

interface RefundClaimData {
  id: number;
  status: string;
  entries: RefundClaimEntry[];
  documentaryRecommendations?: string | null;
  adminNotes?: string | null;
  requestedAt?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

interface Props {
  open: boolean;
  caseId: string;
  caseName?: string;
  onClose: () => void;
  onActioned: () => void;
  authToken: string | null;
}

function statusConfig(status: string) {
  const cfgs: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    pending_submission: { icon: <Clock className="h-3.5 w-3.5" />, label: "Pending Submission", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    submitted:          { icon: <Clock className="h-3.5 w-3.5" />, label: "Submitted",          color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
    approved:           { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Approved",    color: "bg-green-500/20 text-green-300 border-green-500/30" },
    rejected:           { icon: <XCircle className="h-3.5 w-3.5" />, label: "Rejected",         color: "bg-red-500/20 text-red-300 border-red-500/30" },
  };
  return cfgs[status] ?? cfgs.pending_submission;
}

export function RefundClaimReviewDialog({ open, caseId, caseName, onClose, onActioned, authToken }: Props) {
  const { toast } = useToast();
  const [claim, setClaim] = useState<RefundClaimData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const [adminNotes, setAdminNotes] = useState("");
  const [actioning, setActioning] = useState<"approve" | "reject" | "unapprove" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [certError, setCertError] = useState(false);

  useEffect(() => {
    if (!open || !caseId || !authToken) return;
    setLoading(true);
    setFetchError(false);
    setCertError(false);
    setClaim(null);
    fetch(`/api/cases/${caseId}/refund-claim`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((d: RefundClaimData | null) => { if (d?.id) { setClaim(d); setAdminNotes(d.adminNotes ?? ""); } })
      .catch(() => {
        setFetchError(true);
        toast({
          title: "Could not load refund claim",
          description: "A network error occurred — please try again.",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, [open, caseId, authToken, fetchKey]);

  const handleAction = async (action: "approve" | "reject") => {
    if (!authToken) return;
    setActioning(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ adminNotes: adminNotes.trim() || null }),
      });
      if (res.ok) {
        onActioned();
        onClose();
      } else {
        const msg = "The server rejected the request. Please try again.";
        setActionError(msg);
        toast({
          title: `${action === "approve" ? "Approval" : "Rejection"} failed`,
          description: msg,
          variant: "destructive",
        });
      }
    } catch {
      const msg = "A network error occurred. Please check your connection and try again.";
      setActionError(msg);
      toast({
        title: `${action === "approve" ? "Approval" : "Rejection"} failed`,
        description: msg,
        variant: "destructive",
      });
    } finally {
      setActioning(null);
    }
  };

  const handleUnapprove = async () => {
    if (!authToken) return;
    setActioning("unapprove");
    setActionError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim/unapprove`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        onActioned();
        onClose();
      } else {
        const msg = "The server rejected the request. Please try again.";
        setActionError(msg);
        toast({
          title: "Unapprove failed",
          description: msg,
          variant: "destructive",
        });
      }
    } catch {
      const msg = "A network error occurred. Please check your connection and try again.";
      setActionError(msg);
      toast({
        title: "Unapprove failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setActioning(null);
    }
  };

  const handleDownloadCert = async () => {
    if (!authToken) return;
    setDownloadingCert(true);
    setCertError(false);
    try {
      const res = await fetch(`/api/cases/${caseId}/refund-claim/certificate`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error("Certificate download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IBCCF-RefundCertificate-${caseId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setCertError(true);
    } finally {
      setDownloadingCert(false);
    }
  };

  const cfg = claim ? statusConfig(claim.status) : statusConfig("pending_submission");
  const canAction = claim?.status === "submitted";
  const isApproved = claim?.status === "approved";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl border border-white/10 text-white p-0 overflow-hidden max-h-[90vh] overflow-y-auto"
        style={{ background: "rgba(8,16,48,0.98)", backdropFilter: "blur(24px)" }}
      >
        <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />

        <div className="px-6 pt-5 pb-3">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/20 flex items-center justify-center">
                <Award className="h-4.5 w-4.5 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-white text-base font-bold">Refund Claim Review</DialogTitle>
                <DialogDescription className="text-blue-300/60 text-xs">{caseName || caseId}</DialogDescription>
              </div>
              {claim && (
                <Badge className={`ml-auto ${cfg.color} flex items-center gap-1 text-[10px]`}>
                  {cfg.icon} {cfg.label}
                </Badge>
              )}
            </div>
          </DialogHeader>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        )}

        {!loading && !claim && fetchError && (
          <div
            className="mx-6 mb-4 rounded-xl px-4 py-4 flex items-start gap-3"
            data-testid="claim-fetch-error"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-red-300 text-sm font-semibold">Could not load claim</p>
              <p className="text-red-400/70 text-xs mt-0.5">A network error occurred. Check your connection and try again.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFetchKey((k) => k + 1)}
              className="shrink-0 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200 rounded-lg text-xs"
            >
              Retry
            </Button>
          </div>
        )}

        {!loading && !claim && !fetchError && (
          <div className="px-6 pb-6 text-center text-blue-400/50 text-sm py-10">
            <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
            No refund claim found for this case.
          </div>
        )}

        {!loading && claim && (
          <>
            {/* Doc recommendations */}
            {claim.documentaryRecommendations && (
              <div
                className="mx-6 mb-3 rounded-xl px-4 py-3"
                style={{ background: "rgba(200,169,81,0.07)", border: "1px solid rgba(200,169,81,0.2)" }}
              >
                <p className="text-amber-300/70 text-[10px] uppercase tracking-widest font-semibold mb-1">
                  Documentary Recommendations (sent to user)
                </p>
                <p className="text-amber-100/70 text-xs whitespace-pre-line">{claim.documentaryRecommendations}</p>
              </div>
            )}

            {/* Entries table */}
            <div className="px-6 pb-4">
              <p className="text-blue-300/60 text-[10px] uppercase tracking-widest font-semibold mb-3">
                Deposit Entries
                {claim.entries?.length > 0 && (
                  <span className="ml-2 text-blue-400/40 font-normal normal-case">
                    ({claim.entries.length} {claim.entries.length === 1 ? "entry" : "entries"})
                  </span>
                )}
              </p>

              {(!claim.entries || claim.entries.length === 0) ? (
                <div
                  className="text-center py-8 rounded-xl text-blue-400/40 text-sm"
                  style={{ border: "1.5px dashed rgba(255,255,255,0.07)" }}
                >
                  No entries submitted yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {claim.entries.map((entry, i) => {
                    const total = parseFloat(entry.amount ?? "0");
                    return (
                      <div
                        key={i}
                        className="rounded-xl px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                      >
                        <div>
                          <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Charged for</p>
                          <p className="text-white text-sm font-medium">{entry.chargedFor || "—"}</p>
                        </div>
                        <div>
                          <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Amount</p>
                          <p className="text-amber-300 text-sm font-bold font-mono">
                            {isNaN(total) ? entry.amount : total.toFixed(2)} USDT
                          </p>
                        </div>
                        <div>
                          <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Date</p>
                          <p className="text-blue-100/80 text-xs">{entry.date || "—"}</p>
                        </div>
                        <div>
                          <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Network</p>
                          <p className="text-blue-100/80 text-xs">{entry.network || "—"}</p>
                        </div>
                        {entry.txId && (
                          <div className="col-span-2">
                            <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Tx / Reference</p>
                            <p className="text-blue-100/60 text-xs font-mono break-all">{entry.txId}</p>
                          </div>
                        )}
                        {entry.notes && (
                          <div className="col-span-2">
                            <p className="text-blue-400/50 text-[10px] uppercase tracking-wide">Notes</p>
                            <p className="text-blue-100/60 text-xs">{entry.notes}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Total */}
                  <div
                    className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: "rgba(200,169,81,0.06)", border: "1px solid rgba(200,169,81,0.15)" }}
                  >
                    <span className="text-amber-300/70 text-sm font-semibold">Total</span>
                    <span className="text-amber-300 font-bold font-mono text-base">
                      {claim.entries.reduce((s, e) => {
                        const n = parseFloat(e.amount ?? "0");
                        return s + (isNaN(n) ? 0 : n);
                      }, 0).toFixed(2)} USDT
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Admin notes & action */}
            {(canAction || isApproved) && (
              <div
                className="mx-6 mb-4 rounded-xl p-4"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {canAction && (
                  <>
                    <Label className="text-blue-300/80 text-xs mb-2 block">
                      Review Notes
                      <span className="text-blue-400/40 ml-1 font-normal">(optional — sent to user)</span>
                    </Label>
                    <Textarea
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      placeholder="Add any notes for the user about this decision…"
                      rows={3}
                      className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/30 focus-visible:ring-blue-500 resize-none text-sm mb-4"
                    />
                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleAction("approve")}
                        disabled={actioning !== null}
                        className="flex-1 bg-green-700 hover:bg-green-600 text-white font-semibold rounded-xl"
                      >
                        {actioning === "approve"
                          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          : <CheckCircle2 className="h-4 w-4 mr-2" />
                        }
                        Approve
                      </Button>
                      <Button
                        onClick={() => handleAction("reject")}
                        disabled={actioning !== null}
                        variant="outline"
                        className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl"
                      >
                        {actioning === "reject"
                          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          : <XCircle className="h-4 w-4 mr-2" />
                        }
                        Reject
                      </Button>
                    </div>
                    {actionError && (
                      <div
                        className="mt-3 rounded-xl px-4 py-3 flex items-start gap-3"
                        data-testid="action-error-banner"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
                      >
                        <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-red-300 text-xs font-semibold">Action failed</p>
                          <p className="text-red-400/70 text-xs mt-0.5">{actionError}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActionError(null)}
                          className="text-red-400/60 hover:text-red-300 text-xs shrink-0"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </>
                )}

                {isApproved && (
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 text-green-400 mb-3">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-semibold text-sm">Claim approved</span>
                      {claim.reviewedAt && (
                        <span className="text-green-400/50 text-xs">
                          {new Date(claim.reviewedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {claim.adminNotes && (
                      <p className="text-green-100/60 text-xs mb-4 whitespace-pre-line">{claim.adminNotes}</p>
                    )}
                    {certError && (
                      <div
                        className="mb-4 rounded-xl px-4 py-3 flex items-start gap-3 text-left"
                        data-testid="cert-download-error"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
                      >
                        <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-red-300 text-sm font-semibold">Download failed</p>
                          <p className="text-red-400/70 text-xs mt-0.5">Could not download the certificate. Please try again.</p>
                        </div>
                        <button
                          onClick={() => setCertError(false)}
                          aria-label="Dismiss error"
                          className="shrink-0 text-red-400/60 hover:text-red-300 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <div className="flex gap-3 justify-center">
                      <Button
                        onClick={handleDownloadCert}
                        disabled={downloadingCert || actioning === "unapprove"}
                        className="bg-amber-700/60 hover:bg-amber-700/80 text-amber-200 border border-amber-600/30 font-semibold rounded-xl px-6"
                      >
                        {downloadingCert
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating…</>
                          : <><Download className="h-4 w-4 mr-2" /> Download Certificate</>
                        }
                      </Button>
                      <Button
                        onClick={handleUnapprove}
                        disabled={actioning === "unapprove" || downloadingCert}
                        variant="outline"
                        className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 rounded-xl px-5"
                      >
                        {actioning === "unapprove"
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Reverting…</>
                          : <><RotateCcw className="h-4 w-4 mr-2" /> Unapprove</>
                        }
                      </Button>
                    </div>
                    {actionError && (
                      <div
                        className="mt-3 rounded-xl px-4 py-3 flex items-start gap-3 text-left"
                        data-testid="action-error-banner"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
                      >
                        <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-red-300 text-xs font-semibold">Action failed</p>
                          <p className="text-red-400/70 text-xs mt-0.5">{actionError}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActionError(null)}
                          className="text-red-400/60 hover:text-red-300 text-xs shrink-0"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end px-6 py-4 border-t border-white/8">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-blue-300/60 hover:text-blue-300 hover:bg-white/5 text-sm"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
