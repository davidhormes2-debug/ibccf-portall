import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send } from "lucide-react";
import type { Case } from "@/components/admin/shared";

export type DeclarationEmailDraft = {
  sendEmail: boolean;
  subject: string;
  intro: string;
  whatToDoText: string;
  closingNote: string;
};

interface DeclarationEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  declarationEmailCase: Case | null;
  declarationEmailDraft: DeclarationEmailDraft;
  setDeclarationEmailDraft: React.Dispatch<React.SetStateAction<DeclarationEmailDraft>>;
  isRequestingDeclaration: boolean;
  resetDeclarationEmailDraftToDefault: () => void;
  confirmRequestDeclaration: () => void | Promise<void>;
}

export function DeclarationEmailDialog({
  open,
  onOpenChange,
  declarationEmailCase,
  declarationEmailDraft,
  setDeclarationEmailDraft,
  isRequestingDeclaration,
  resetDeclarationEmailDraftToDefault,
  confirmRequestDeclaration,
}: DeclarationEmailDialogProps) {
  const { t } = useTranslation("admin");
  return (
      <Dialog open={open} onOpenChange={(o) => {
        if (!isRequestingDeclaration) onOpenChange(o);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-amber-400" />
              {t("dialogs.openDeclarationPortal.title")}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This opens the Declaration of Compliance portal for{" "}
              <span className="text-white">{declarationEmailCase?.userName ?? declarationEmailCase?.userEmail ?? "this user"}</span>{" "}
              and issues an access code valid for <span className="text-amber-300">24 hours</span>.
              {declarationEmailCase?.userEmail
                ? " You can also send the code by email — preview & edit the message below."
                : " This user has no email on file; the code will only be available in the admin dashboard."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {declarationEmailCase?.userEmail && (
              <label className="flex items-start gap-3 p-3 rounded-md bg-slate-900 border border-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={declarationEmailDraft.sendEmail}
                  onChange={(e) => setDeclarationEmailDraft(d => ({ ...d, sendEmail: e.target.checked }))}
                  className="mt-1"
                  data-testid="checkbox-declaration-send-email"
                  disabled={isRequestingDeclaration}
                />
                <div className="flex-1 text-sm">
                  <div className="font-semibold text-white">Email the access code to the user</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Sends to <span className="text-amber-200">{declarationEmailCase.userEmail}</span>. Uncheck to issue the code without sending.
                  </div>
                </div>
              </label>
            )}
            {declarationEmailDraft.sendEmail && declarationEmailCase?.userEmail && (
              <>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Subject</label>
                  <Input
                    value={declarationEmailDraft.subject}
                    onChange={(e) => setDeclarationEmailDraft(d => ({ ...d, subject: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white"
                    data-testid="input-declaration-email-subject"
                    disabled={isRequestingDeclaration}
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Intro Paragraph</label>
                  <Textarea
                    value={declarationEmailDraft.intro}
                    onChange={(e) => setDeclarationEmailDraft(d => ({ ...d, intro: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[120px]"
                    data-testid="textarea-declaration-email-intro"
                    disabled={isRequestingDeclaration}
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    What You Need To Do <span className="text-slate-500 normal-case font-normal">(one item per line)</span>
                  </label>
                  <Textarea
                    value={declarationEmailDraft.whatToDoText}
                    onChange={(e) => setDeclarationEmailDraft(d => ({ ...d, whatToDoText: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[140px] font-mono text-sm"
                    data-testid="textarea-declaration-email-todo"
                    disabled={isRequestingDeclaration}
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Closing / Security Note</label>
                  <Textarea
                    value={declarationEmailDraft.closingNote}
                    onChange={(e) => setDeclarationEmailDraft(d => ({ ...d, closingNote: e.target.value }))}
                    className="mt-1 bg-slate-900 border-slate-700 text-white min-h-[80px]"
                    data-testid="textarea-declaration-email-closing"
                    disabled={isRequestingDeclaration}
                  />
                </div>
                <div className="text-xs text-slate-500 bg-slate-900/50 rounded px-3 py-2 border border-slate-800">
                  The access code itself and the 24-hour expiry timestamp are inserted automatically and cannot be edited here.
                </div>
              </>
            )}
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            {declarationEmailDraft.sendEmail && declarationEmailCase?.userEmail ? (
              <Button
                variant="outline"
                onClick={resetDeclarationEmailDraftToDefault}
                disabled={isRequestingDeclaration}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                data-testid="button-declaration-email-reset"
              >
                Reset to Default
              </Button>
            ) : <span />}
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isRequestingDeclaration}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
                data-testid="button-declaration-email-cancel"
              >
                No, Cancel
              </Button>
              <Button
                onClick={confirmRequestDeclaration}
                disabled={
                  isRequestingDeclaration ||
                  (declarationEmailDraft.sendEmail && !declarationEmailDraft.subject.trim())
                }
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
                data-testid="button-declaration-email-confirm"
              >
                <Send className="h-4 w-4 mr-2" />
                {isRequestingDeclaration
                  ? "Working…"
                  : declarationEmailDraft.sendEmail && declarationEmailCase?.userEmail
                    ? "Yes, Open Portal & Send Email"
                    : "Yes, Open Portal"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
