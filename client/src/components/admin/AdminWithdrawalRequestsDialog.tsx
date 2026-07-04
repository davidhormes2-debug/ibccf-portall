import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Wallet, CheckCircle, XCircle, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function WithdrawalLoadingSkeleton() {
  return (
    <div className="space-y-3 py-4" aria-label="Loading withdrawal requests…">
      {[0, 1].map((i) => (
        <div key={i} className="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface AdminWithdrawalRequest {
  id: number;
  caseId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  amount: string;
  asset: string;
  network: string;
  withdrawalType: string;
  requestedWalletAddress: string;
  requestedWalletAsset?: string | null;
  requestedWalletNetwork?: string | null;
  preferredPayoutDate?: string | null;
  confirmationChannel: string;
  userNote?: string | null;
  adminNote?: string | null;
  twoFactorProvidedAt?: string | null;
  termsAcceptedAt?: string | null;
  reqIp?: string | null;
  reqUserAgent?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string | null;
  caseLabel?: string;
  authToken: string;
  /** When true, sealed-case read-only mode disables approve/reject/cancel. */
  sealed?: boolean;
  /** Fired after a successful approve/reject/cancel so the parent can refresh
   *  cross-case pending-withdrawal badge counts (Task #780). */
  onActioned?: () => void;
}

export function AdminWithdrawalRequestsDialog({
  open,
  onOpenChange,
  caseId,
  caseLabel,
  authToken,
  sealed = false,
  onActioned,
}: Props) {
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const fadeTransition = reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeInOut" as const };
  const [rows, setRows] = useState<AdminWithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewNoteByRequest, setReviewNoteByRequest] = useState<Record<number, string>>({});
  const [reviewing, setReviewing] = useState<number | null>(null);

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/withdrawal-requests/admin`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setRows([]);
        toast({ variant: 'destructive', title: 'Failed to load withdrawal requests' });
        return;
      }
      const data = (await res.json()) as AdminWithdrawalRequest[];
      setRows(data);
    } catch {
      setRows([]);
      toast({ variant: 'destructive', title: 'Network error loading withdrawal requests' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && caseId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId]);

  const review = async (requestId: number, status: 'approved' | 'rejected' | 'cancelled') => {
    if (!caseId) return;
    if (sealed) {
      toast({
        variant: 'destructive',
        title: 'Case is sealed',
        description: 'Override the seal before reviewing withdrawal requests.',
      });
      return;
    }
    if (status === 'rejected' && !(reviewNoteByRequest[requestId] || '').trim()) {
      toast({
        variant: 'destructive',
        title: 'Reviewer note required',
        description: 'Please leave a note explaining the rejection — the user will see it.',
      });
      return;
    }
    setReviewing(requestId);
    try {
      const res = await fetch(`/api/cases/${caseId}/withdrawal-requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          status,
          adminNote: (reviewNoteByRequest[requestId] || '').trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          variant: 'destructive',
          title: 'Could not review withdrawal request',
          description: typeof err?.error === 'string' ? err.error : undefined,
        });
        return;
      }
      toast({
        title: `Withdrawal request ${status}`,
        description: 'The user has been notified by email.',
      });
      await load();
      onActioned?.();
    } catch {
      toast({ variant: 'destructive', title: 'Network error reviewing withdrawal request' });
    } finally {
      setReviewing(null);
    }
  };

  const statusBadge = (status: AdminWithdrawalRequest['status']) => {
    const palette: Record<string, string> = {
      pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      approved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      rejected: 'bg-red-500/20 text-red-300 border-red-500/40',
      cancelled: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    };
    return (
      <Badge variant="outline" className={palette[status] || palette.pending}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-amber-500" />
            Withdrawal Requests{caseLabel ? `: ${caseLabel}` : ''}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Display-only review. Approving here notifies the user and audit-logs the
            decision — it does <strong>not</strong> move any funds. Stage progression
            remains a separate manual action.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence initial={false}>
          {loading ? (
            <motion.div
              key="wr-skeleton"
              exit={{ opacity: 0 }}
              transition={fadeTransition}
              data-testid="text-wr-admin-loading"
            >
              <WithdrawalLoadingSkeleton />
            </motion.div>
          ) : (
            <motion.div
              key="wr-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={fadeTransition}
            >
              <div className="py-4 space-y-3">
                {rows.length === 0 && (
                  <div className="text-center py-10">
                    <Wallet className="h-10 w-10 mx-auto text-slate-700 mb-3" />
                    <p className="text-slate-500 text-sm">No withdrawal requests for this case yet.</p>
                  </div>
                )}
                {rows.map((r) => (
            <div
              key={r.id}
              className="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3"
              data-testid={`row-withdrawal-request-${r.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {r.amount} {r.asset}{' '}
                    <span className="text-slate-500 text-xs">· {r.network} · {r.withdrawalType}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Submitted {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
                {statusBadge(r.status)}
              </div>

              <div className="text-xs text-slate-300 grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Requested destination
                  </div>
                  <div className="font-mono break-all">{r.requestedWalletAddress}</div>
                  {(r.requestedWalletAsset || r.requestedWalletNetwork) && (
                    <div className="text-slate-500">
                      {r.requestedWalletAsset || r.asset} · {r.requestedWalletNetwork || r.network}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Preferences
                  </div>
                  <div>Channel: {r.confirmationChannel}</div>
                  {r.preferredPayoutDate && (
                    <div>Payout date: {new Date(r.preferredPayoutDate).toLocaleDateString()}</div>
                  )}
                  {r.twoFactorProvidedAt && <div>2FA provided</div>}
                </div>
              </div>

              {r.userNote && (
                <div className="text-xs">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">User note</div>
                  <p className="text-slate-300 whitespace-pre-wrap">{r.userNote}</p>
                </div>
              )}
              {r.adminNote && r.status !== 'pending' && (
                <div className="text-xs">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Reviewer note
                  </div>
                  <p className="text-slate-300 whitespace-pre-wrap">{r.adminNote}</p>
                </div>
              )}
              {r.reviewedAt && (
                <div className="text-[11px] text-slate-500">
                  Reviewed {new Date(r.reviewedAt).toLocaleString()} by {r.reviewedBy || 'admin'}
                </div>
              )}

              {r.status === 'pending' && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  {sealed && (
                    <p className="text-xs text-amber-300" data-testid={`text-wr-sealed-${r.id}`}>
                      This case is sealed — review actions are read-only. Override the
                      seal before approving, rejecting, or cancelling.
                    </p>
                  )}
                  <Textarea
                    value={reviewNoteByRequest[r.id] || ''}
                    onChange={(e) =>
                      setReviewNoteByRequest((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="Required when rejecting; optional otherwise. The user sees this note."
                    rows={2}
                    maxLength={2000}
                    disabled={sealed}
                    className="bg-slate-950 border-slate-800 text-sm"
                    data-testid={`textarea-wr-admin-note-${r.id}`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={sealed || reviewing === r.id}
                      onClick={() => review(r.id, 'approved')}
                      className="bg-emerald-600 hover:bg-emerald-500"
                      data-testid={`button-wr-approve-${r.id}`}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={sealed || reviewing === r.id}
                      onClick={() => review(r.id, 'rejected')}
                      data-testid={`button-wr-reject-${r.id}`}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sealed || reviewing === r.id}
                      onClick={() => review(r.id, 'cancelled')}
                      className="border-slate-700"
                      data-testid={`button-wr-cancel-${r.id}`}
                    >
                      <Ban className="w-4 h-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              )}
                </div>
              ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
