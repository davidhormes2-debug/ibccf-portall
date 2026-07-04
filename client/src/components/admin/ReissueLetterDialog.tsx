import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw } from "lucide-react";
import type { Case } from "@/components/admin/shared";

function ReissueLetterSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-label="Loading previous letter…">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-4 w-28 mt-4" />
      <Skeleton className="h-20 w-full" />
      <div className="pt-3 border-t border-slate-800 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

export type ReissueDraft = {
  reissueFee: string;
  reason: string;
  headline: string;
  introduction: string;
  bodyContent: string;
  footerNote: string;
  complianceReference: string;
  complianceNotice: string;
  phraseKeyRequirements: string;
  optionATitle: string;
  optionADescription: string;
  optionAFrequency: string;
  optionABatches: string;
  optionAKeyCost: string;
  optionATotalRequirement: string;
  optionAAmount: string;
  optionATotalAmount: string;
  optionBTitle: string;
  optionBDescription: string;
  optionBFrequency: string;
  optionBBatches: string;
  optionBKeyCost: string;
  optionBTotalRequirement: string;
  optionBAmount: string;
  optionBTotalAmount: string;
};

interface ReissueLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reissueCase: Case | null;
  reissueDraft: ReissueDraft;
  setReissueDraft: React.Dispatch<React.SetStateAction<ReissueDraft>>;
  isReissueSubmitting: boolean;
  isReissueLoadingLetter: boolean;
  clearLetterReissue: (c: Case) => void | Promise<void>;
  confirmReissueLetter: () => void | Promise<void>;
}

export function ReissueLetterDialog({
  open,
  onOpenChange,
  reissueCase,
  reissueDraft,
  setReissueDraft,
  isReissueSubmitting,
  isReissueLoadingLetter,
  clearLetterReissue,
  confirmReissueLetter,
}: ReissueLetterDialogProps) {
  const { t } = useTranslation("admin");
  const reducedMotion = useReducedMotion();
  const fadeTransition = reducedMotion ? { duration: 0 } : { duration: 0.15, ease: "easeInOut" as const };
  return (
      <Dialog open={open} onOpenChange={(o) => {
        if (!isReissueSubmitting) onOpenChange(o);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-amber-400" />
              {t("dialogs.reissueLetter.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Open a new reissue round for{" "}
              <span className="text-white">{reissueCase?.userName ?? reissueCase?.userEmail ?? "this user"}</span>.
              The previous letter is loaded below — tweak any field or leave
              it as-is. The user will be prompted to upload a deposit receipt
              for the fee below; only after you approve that receipt will
              they be able to resubmit. If a previous round is still active
              it will be cancelled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Reissue Fee
              </label>
              <Input
                value={reissueDraft.reissueFee}
                onChange={(e) =>
                  setReissueDraft((d) => ({ ...d, reissueFee: e.target.value }))
                }
                placeholder="e.g. 150 USDT"
                className="mt-1 bg-slate-900 border-slate-700 text-white"
                data-testid="input-reissue-fee"
                disabled={isReissueSubmitting}
              />
              <p className="text-xs text-slate-500 mt-1">
                The amount the user must deposit for this reissue round.
              </p>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Reason <span className="text-slate-500 normal-case font-normal">(optional)</span>
              </label>
              <Textarea
                value={reissueDraft.reason}
                onChange={(e) =>
                  setReissueDraft((d) => ({ ...d, reason: e.target.value }))
                }
                placeholder="Why is the letter being reissued? Shown to the user."
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px]"
                data-testid="textarea-reissue-reason"
                disabled={isReissueSubmitting}
              />
            </div>

            {/* ─────────────── Letter content ─────────────── */}
            <div className="pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-amber-300">
                  Letter Content
                </h4>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Pre-filled with the previous letter. Edit any field to send a
                revised letter with this reissue, or leave as-is to send the
                same content.
              </p>

              <AnimatePresence initial={false}>
                {isReissueLoadingLetter ? (
                  <motion.div
                    key="reissue-skeleton"
                    exit={{ opacity: 0 }}
                    transition={fadeTransition}
                  >
                    <ReissueLetterSkeleton />
                  </motion.div>
                ) : (
                  <motion.div
                    key="reissue-content"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={fadeTransition}
                  >
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Headline</label>
                  <Input
                    value={reissueDraft.headline}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, headline: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                    data-testid="input-reissue-headline"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Introduction</label>
                  <Textarea
                    value={reissueDraft.introduction}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, introduction: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                    data-testid="textarea-reissue-introduction"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Body Content</label>
                  <Textarea
                    value={reissueDraft.bodyContent}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, bodyContent: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                    data-testid="textarea-reissue-body"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Footer Note</label>
                  <Textarea
                    value={reissueDraft.footerNote}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, footerNote: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[50px]"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                    data-testid="textarea-reissue-footer"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Compliance Reference</label>
                  <Input
                    value={reissueDraft.complianceReference}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, complianceReference: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Compliance Notice</label>
                  <Textarea
                    value={reissueDraft.complianceNotice}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, complianceNotice: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[60px]"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    Phrase Key Requirements <span className="normal-case text-slate-500">(JSON array of bullet points)</span>
                  </label>
                  <Textarea
                    value={reissueDraft.phraseKeyRequirements}
                    onChange={(e) => setReissueDraft((d) => ({ ...d, phraseKeyRequirements: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px] font-mono text-xs"
                    disabled={isReissueSubmitting || isReissueLoadingLetter}
                  />
                </div>

                {/* Option A */}
                <div className="pt-3 border-t border-slate-800">
                  <h5 className="text-xs font-semibold text-blue-300 uppercase tracking-wide mb-2">Option A</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Title</label>
                      <Input value={reissueDraft.optionATitle} onChange={(e) => setReissueDraft((d) => ({ ...d, optionATitle: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Description</label>
                      <Textarea value={reissueDraft.optionADescription} onChange={(e) => setReissueDraft((d) => ({ ...d, optionADescription: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[50px]" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Frequency</label>
                      <Input value={reissueDraft.optionAFrequency} onChange={(e) => setReissueDraft((d) => ({ ...d, optionAFrequency: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="every 12 hours" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Batches</label>
                      <Input value={reissueDraft.optionABatches} onChange={(e) => setReissueDraft((d) => ({ ...d, optionABatches: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="10 Transfers" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Key Cost</label>
                      <Input value={reissueDraft.optionAKeyCost} onChange={(e) => setReissueDraft((d) => ({ ...d, optionAKeyCost: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="260.996 USDT" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Total Requirement</label>
                      <Input value={reissueDraft.optionATotalRequirement} onChange={(e) => setReissueDraft((d) => ({ ...d, optionATotalRequirement: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="2,609.96 USDT" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Amount</label>
                      <Input value={reissueDraft.optionAAmount} onChange={(e) => setReissueDraft((d) => ({ ...d, optionAAmount: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Total Amount</label>
                      <Input value={reissueDraft.optionATotalAmount} onChange={(e) => setReissueDraft((d) => ({ ...d, optionATotalAmount: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                  </div>
                </div>

                {/* Option B */}
                <div className="pt-3 border-t border-slate-800">
                  <h5 className="text-xs font-semibold text-purple-300 uppercase tracking-wide mb-2">Option B</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Title</label>
                      <Input value={reissueDraft.optionBTitle} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBTitle: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Description</label>
                      <Textarea value={reissueDraft.optionBDescription} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBDescription: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[50px]" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Frequency</label>
                      <Input value={reissueDraft.optionBFrequency} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBFrequency: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="every 12 hours" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Batches</label>
                      <Input value={reissueDraft.optionBBatches} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBBatches: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="20 Transfers" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Key Cost</label>
                      <Input value={reissueDraft.optionBKeyCost} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBKeyCost: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="521.993 USDT" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Total Requirement</label>
                      <Input value={reissueDraft.optionBTotalRequirement} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBTotalRequirement: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} placeholder="5,219.92 USDT" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Amount</label>
                      <Input value={reissueDraft.optionBAmount} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBAmount: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Total Amount</label>
                      <Input value={reissueDraft.optionBTotalAmount} onChange={(e) => setReissueDraft((d) => ({ ...d, optionBTotalAmount: e.target.value }))} className="mt-1 bg-slate-900 border-slate-700 text-white" disabled={isReissueSubmitting || isReissueLoadingLetter} />
                    </div>
                  </div>
                </div>
              </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            {reissueCase ? (
              <Button
                variant="outline"
                onClick={async () => {
                  await clearLetterReissue(reissueCase);
                  onOpenChange(false);
                }}
                disabled={isReissueSubmitting}
                className="border-red-700 bg-red-950/40 text-red-200 hover:bg-red-900/60"
                data-testid="button-reissue-clear"
              >
                Cancel Active Round
              </Button>
            ) : <span />}
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isReissueSubmitting}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                data-testid="button-reissue-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmReissueLetter}
                disabled={
                  isReissueSubmitting ||
                  isReissueLoadingLetter ||
                  !reissueDraft.reissueFee.trim()
                }
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                data-testid="button-reissue-confirm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {isReissueSubmitting
                  ? "Saving…"
                  : isReissueLoadingLetter
                    ? "Loading letter…"
                    : "Open Reissue Round"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
