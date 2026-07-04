import React from "react";
import { useTranslation } from "react-i18next";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Image,
  Download,
  ExternalLink,
  CheckCircle,
  X,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CaseMergedReceiptsPanel } from "@/components/admin/CaseMergedReceiptsPanel";
import { type Case, type DepositReceipt } from "@/components/admin/shared";
import {
  assertNeverReceiptStatus,
  type ReceiptStatus,
} from "@/lib/receiptStatus";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// Typed variant map — Record<ReceiptStatus, BadgeVariant> enforces that every
// member of the union has an entry; adding a new ReceiptStatus without updating
// this map produces a compile-time error.
// Exported so tests can assert exhaustiveness at runtime as a second signal.
export const DEPOSIT_RECEIPT_BADGE_VARIANT: Record<ReceiptStatus, BadgeVariant> = {
  pending: "secondary",
  awaiting_admin_approval: "secondary",
  reviewed: "outline",
  approved: "default",
  rejected: "destructive",
};

interface DepositReceiptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCase: Case | null;
  authToken: string | null;
  adminRole: string | null;
  mergedReceiptsScrollKey: string | null;
  depositReceipts: DepositReceipt[];
  isLoading?: boolean;
  pendingReceiptIds: Set<number>;
  receiptEmailFlags: Record<number, boolean>;
  setReceiptEmailFlags: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  updateReceiptStatus: (
    receiptId: number,
    status: 'approved' | 'rejected',
    adminNotes?: string,
    suppressEmail?: boolean,
  ) => void;
}

function ReceiptsLoadingSkeleton() {
  return (
    <div className="space-y-4 py-4" aria-label="Loading receipts…">
      {[0, 1, 2].map((i) => (
        <div key={i} className="p-4 bg-slate-900 rounded-lg border border-slate-800 space-y-3">
          <div className="flex justify-between items-start gap-3">
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-40 w-full rounded" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DepositReceiptsDialog({
  open,
  onOpenChange,
  selectedCase,
  authToken,
  adminRole,
  mergedReceiptsScrollKey,
  depositReceipts,
  isLoading = false,
  pendingReceiptIds,
  receiptEmailFlags,
  setReceiptEmailFlags,
  updateReceiptStatus,
}: DepositReceiptsDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canApproveReceipts = adminRole === 'admin' || adminRole === 'super_admin';
  const reducedMotion = useReducedMotion();
  const [receiptAdminNotes, setReceiptAdminNotes] = React.useState<Record<number, string>>({});
  const fadeTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: "easeInOut" as const };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5 text-amber-500" />
            {t("dialogs.depositReceipts.title", { name: selectedCase?.userName })}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Review and approve/reject deposit receipts for case {selectedCase?.accessCode}
          </DialogDescription>
        </DialogHeader>

        {/* Task #163 — Merged Uploads panel: shows cert + stamp-duty
            receipts in the same place as deposit receipts so admins
            don't have to jump between three dialogs. The deposit
            receipts list below is preserved as the source of truth for
            approve/reject actions. */}
        {selectedCase && open && (
          <CaseMergedReceiptsPanel
            caseId={selectedCase.id}
            authToken={authToken || sessionStorage.getItem('adminToken') || ''}
            scrollToKey={mergedReceiptsScrollKey}
          />
        )}

        {/* Download the per-case Payout Instructions PDF (verified wallet,
            withdrawal amount, release procedure). Admin-auth-only; we
            fetch as a blob so we can attach the bearer header — a raw
            <a href> can't. Mirrors the Sealed Settlement download
            pattern earlier in this file. */}
        {selectedCase && (
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              variant="outline"
              className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
              data-testid="button-download-payout-instructions"
              onClick={async () => {
                try {
                  const res = await fetch(
                    `/api/cases/${selectedCase.id}/payout-instructions/pdf`,
                    {
                      headers: authToken
                        ? { Authorization: `Bearer ${authToken}` }
                        : {},
                    },
                  );
                  if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `IBCCF-Payout-Instructions-${selectedCase.id}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 0);
                } catch (e) {
                  toast({
                    title: "Download failed",
                    description:
                      e instanceof Error ? e.message : "Unknown error",
                    variant: "destructive",
                  });
                }
              }}
            >
              <Download className="h-4 w-4 mr-1" /> Payout Instructions PDF
            </Button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {isLoading ? (
            <motion.div
              key="receipts-skeleton"
              exit={{ opacity: 0 }}
              transition={fadeTransition}
            >
              <ReceiptsLoadingSkeleton />
            </motion.div>
          ) : (
            <motion.div
              key="receipts-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={fadeTransition}
            >
              <div className="py-4">
                {depositReceipts.length === 0 ? (
                  <div className="text-center py-12">
                    <Image className="h-12 w-12 mx-auto text-slate-700 mb-3" />
                    <p className="text-slate-500">No receipts uploaded yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {depositReceipts.map(receipt => {
                      const blob = receipt.imageData ?? '';
                      const isPdf =
                        (receipt.fileName ?? '').toLowerCase().endsWith('.pdf') ||
                        blob.startsWith('data:application/pdf');
                      return (
                        <div
                          key={receipt.id}
                          className={`p-4 rounded-lg border ${receipt.category === 'reissue' && !receipt.reissueId ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-900 border-slate-800'}`}
                        >
                          <div className="flex justify-between items-start mb-3 gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold truncate">{receipt.fileName || `Receipt #${receipt.id}`}</p>
                                {receipt.category === 'reissue' && !receipt.reissueId && (
                                  <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                                    Reactivation
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">{new Date(receipt.uploadedAt).toLocaleString()}</p>
                            </div>
                            <Badge
                              variant={
                                receipt.status === "pending"
                                  ? DEPOSIT_RECEIPT_BADGE_VARIANT.pending
                                  : receipt.status === "awaiting_admin_approval"
                                  ? DEPOSIT_RECEIPT_BADGE_VARIANT.awaiting_admin_approval
                                  : receipt.status === "reviewed"
                                  ? DEPOSIT_RECEIPT_BADGE_VARIANT.reviewed
                                  : receipt.status === "approved"
                                  ? DEPOSIT_RECEIPT_BADGE_VARIANT.approved
                                  : receipt.status === "rejected"
                                  ? DEPOSIT_RECEIPT_BADGE_VARIANT.rejected
                                  : assertNeverReceiptStatus(receipt.status)
                              }
                              data-testid={`badge-receipt-status-${receipt.id}`}
                            >
                              {receipt.status}
                            </Badge>
                          </div>

                          {receipt.notes && (
                            <p className="text-sm text-slate-400 mb-2 break-all">
                              <span className="text-slate-500">User notes:</span> {receipt.notes}
                            </p>
                          )}
                          {receipt.adminNotes && (
                            <p
                              className="text-sm text-slate-500 mb-2"
                              data-testid={`text-admin-notes-${receipt.id}`}
                            >
                              <span className="text-slate-500">Admin notes:</span> {receipt.adminNotes}
                            </p>
                          )}

                          {blob && (
                            <>
                              <div className="flex flex-wrap items-center gap-2 mb-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-slate-800/40 border-slate-700 text-slate-200 hover:bg-slate-800"
                                  onClick={() => {
                                    // Convert the data: URL into a blob: URL and
                                    // hand it to window.open with noopener. Only
                                    // allowlisted MIME types are opened — HTML,
                                    // SVG, and any other active-content types are
                                    // rejected to prevent an uploaded receipt from
                                    // executing same-origin JavaScript in the
                                    // admin's browser (stored XSS via blob URL).
                                    const SAFE_RECEIPT_MIMES = new Set([
                                      "image/jpeg",
                                      "image/png",
                                      "image/webp",
                                      "application/pdf",
                                    ]);
                                    try {
                                      const m = /^data:([^;,]+)(?:;base64)?,(.+)$/.exec(
                                        blob,
                                      );
                                      if (!m) {
                                        alert("Cannot open: unrecognised receipt format.");
                                        return;
                                      }
                                      const mime = m[1].toLowerCase();
                                      if (!SAFE_RECEIPT_MIMES.has(mime)) {
                                        alert("Cannot open: unsupported file type. Use the Download button to save the file locally.");
                                        return;
                                      }
                                      const isB64 = /;base64,/.test(blob);
                                      const data = isB64
                                        ? Uint8Array.from(atob(m[2]), (c) =>
                                            c.charCodeAt(0),
                                          )
                                        : new TextEncoder().encode(
                                            decodeURIComponent(m[2]),
                                          );
                                      const b = new Blob([data], { type: mime });
                                      const url = URL.createObjectURL(b);
                                      window.open(url, "_blank", "noopener,noreferrer");
                                      setTimeout(() => URL.revokeObjectURL(url), 60_000);
                                    } catch {
                                      alert("Cannot open: failed to read the receipt file.");
                                    }
                                  }}
                                  data-testid={`button-open-receipt-${receipt.id}`}
                                >
                                  <ExternalLink className="h-4 w-4 mr-1" /> Open in new tab
                                </Button>
                                <a
                                  href={blob}
                                  download={receipt.fileName || `receipt-${receipt.id}`}
                                  className="inline-flex items-center text-[11px] text-slate-400 hover:text-slate-200 underline"
                                  data-testid={`link-download-receipt-${receipt.id}`}
                                >
                                  <Download className="h-3 w-3 mr-1" /> Download
                                </a>
                              </div>
                              <div className="mb-3">
                                {isPdf ? (
                                  <iframe
                                    src={blob}
                                    title={`Receipt ${receipt.id}`}
                                    className="w-full h-96 rounded border border-slate-800 bg-slate-950"
                                    data-testid={`preview-receipt-pdf-${receipt.id}`}
                                  />
                                ) : (
                                  <img
                                    src={blob}
                                    alt={`Receipt ${receipt.id}`}
                                    className="max-h-96 w-auto rounded border border-slate-800 object-contain bg-slate-950"
                                    data-testid={`preview-receipt-img-${receipt.id}`}
                                  />
                                )}
                              </div>
                            </>
                          )}

                          {receipt.status === 'pending' && canApproveReceipts && (() => {
                            const isPending = pendingReceiptIds.has(receipt.id);
                            const sendEmail = receiptEmailFlags[receipt.id] !== false;
                            const isReactivation = receipt.category === 'reissue' && !receipt.reissueId;
                            const adminNoteValue = receiptAdminNotes[receipt.id] ?? '';
                            return (
                              <div className="space-y-2">
                                {isReactivation && (
                                  <p className="text-xs text-amber-400/80 flex items-center gap-1">
                                    <RefreshCw className="h-3 w-3 shrink-0" />
                                    Approving this receipt will also re-enable the user's portal account and issue a new access code.
                                  </p>
                                )}
                                <div>
                                  <label
                                    htmlFor={`admin-notes-${receipt.id}`}
                                    className="text-xs text-slate-400 mb-1 block"
                                  >
                                    Admin notes (optional — included in rejection email)
                                  </label>
                                  <textarea
                                    id={`admin-notes-${receipt.id}`}
                                    data-testid={`textarea-admin-notes-${receipt.id}`}
                                    rows={2}
                                    value={adminNoteValue}
                                    onChange={(e) =>
                                      setReceiptAdminNotes((prev) => ({
                                        ...prev,
                                        [receipt.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Reason for rejection or approval notes…"
                                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none"
                                    disabled={isPending}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => updateReceiptStatus(receipt.id, 'approved', adminNoteValue || undefined, !sendEmail)}
                                    disabled={isPending}
                                    className={`${isReactivation ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'} disabled:opacity-60`}
                                    data-testid={`button-approve-receipt-${receipt.id}`}
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    {isPending ? "Saving…" : isReactivation ? "Approve & Reactivate" : "Approve"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={isPending}
                                    onClick={() => updateReceiptStatus(receipt.id, 'rejected', adminNoteValue || undefined)}
                                    className="disabled:opacity-60"
                                    data-testid={`button-reject-receipt-${receipt.id}`}
                                  >
                                    <X className="h-4 w-4 mr-1" />
                                    {isPending ? "Saving…" : "Reject"}
                                  </Button>
                                </div>
                                {/* Per-receipt email toggle. Only relevant for
                                    reissue receipts (the server ignores it for
                                    plain activation receipts since no approval
                                    email exists for those). On by default so
                                    the user is always notified unless the admin
                                    explicitly opts out. */}
                                <div className="flex items-center gap-2">
                                  <Switch
                                    id={`notify-receipt-${receipt.id}`}
                                    checked={sendEmail}
                                    onCheckedChange={(checked) =>
                                      setReceiptEmailFlags((prev) => ({
                                        ...prev,
                                        [receipt.id]: checked,
                                      }))
                                    }
                                    data-testid={`switch-receipt-notify-${receipt.id}`}
                                  />
                                  <Label
                                    htmlFor={`notify-receipt-${receipt.id}`}
                                    className="text-xs text-slate-400 cursor-pointer select-none"
                                  >
                                    {sendEmail ? "Notify user by email on approval" : "Skip notification email"}
                                  </Label>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
