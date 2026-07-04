import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send } from "lucide-react";
import type { Case } from "@/components/admin/shared";

export type StageEmailDraft = {
  stageNumber: number;
  stageTitle: string;
  subject: string;
  summary: string;
  detailedExplanation: string;
  whyItMatters: string;
  whatToDoText: string;
  whatToExpect: string;
  regulatoryBasisText: string;
};

interface StageEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCase: Case | null;
  stageEmailDraft: StageEmailDraft;
  setStageEmailDraft: React.Dispatch<React.SetStateAction<StageEmailDraft>>;
  isSendingStageEmail: boolean;
  resetStageEmailDraftToDefault: () => void | Promise<void>;
  confirmSendStageEmail: () => void | Promise<void>;
}

export function StageEmailDialog({
  open,
  onOpenChange,
  selectedCase,
  stageEmailDraft,
  setStageEmailDraft,
  isSendingStageEmail,
  resetStageEmailDraftToDefault,
  confirmSendStageEmail,
}: StageEmailDialogProps) {
  const { t } = useTranslation("admin");
  return (
      <Dialog open={open} onOpenChange={(o) => {
        if (!isSendingStageEmail) onOpenChange(o);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-amber-400" />
              {t("dialogs.stageEmail.title", { stage: stageEmailDraft.stageNumber })}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Review and edit the email content below before sending to{" "}
              <span className="text-amber-200">{selectedCase?.userEmail}</span>.
              Each line in the bullet-list fields becomes one bullet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Subject</label>
              <Input
                value={stageEmailDraft.subject}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, subject: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white"
                data-testid="input-stage-email-subject"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Stage Summary</label>
              <Textarea
                value={stageEmailDraft.summary}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, summary: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px]"
                data-testid="textarea-stage-email-summary"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Detailed Explanation</label>
              <Textarea
                value={stageEmailDraft.detailedExplanation}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, detailedExplanation: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[140px]"
                data-testid="textarea-stage-email-detailed"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Why This Step Is Needed</label>
              <Textarea
                value={stageEmailDraft.whyItMatters}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, whyItMatters: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[100px]"
                data-testid="textarea-stage-email-why"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                What You Need To Do <span className="text-slate-500 normal-case font-normal">(one item per line)</span>
              </label>
              <Textarea
                value={stageEmailDraft.whatToDoText}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, whatToDoText: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[120px] font-mono text-sm"
                data-testid="textarea-stage-email-todo"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">What To Expect Next</label>
              <Textarea
                value={stageEmailDraft.whatToExpect}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, whatToExpect: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px]"
                data-testid="textarea-stage-email-expect"
                disabled={isSendingStageEmail}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Regulatory Basis <span className="text-slate-500 normal-case font-normal">(one reference per line)</span>
              </label>
              <Textarea
                value={stageEmailDraft.regulatoryBasisText}
                onChange={(e) => setStageEmailDraft(d => ({ ...d, regulatoryBasisText: e.target.value }))}
                className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[120px] font-mono text-sm"
                data-testid="textarea-stage-email-regbasis"
                disabled={isSendingStageEmail}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={resetStageEmailDraftToDefault}
              disabled={isSendingStageEmail}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
              data-testid="button-stage-email-reset"
            >
              Reset to Default
            </Button>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSendingStageEmail}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                data-testid="button-stage-email-cancel"
              >
                No, Cancel
              </Button>
              <Button
                onClick={confirmSendStageEmail}
                disabled={isSendingStageEmail || !stageEmailDraft.subject.trim()}
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                data-testid="button-stage-email-confirm-send"
              >
                <Send className="h-4 w-4 mr-2" />
                {isSendingStageEmail ? "Sending…" : "Yes, Send Email"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
