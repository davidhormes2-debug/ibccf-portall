import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RefreshCw, Send, ChevronDown, ChevronRight, Zap } from "lucide-react";
import type { Case } from "@/components/admin/shared";
import { QUICK_SEND_TEMPLATES, STAGE_SHORT_LABELS } from "@/lib/adminEmailTemplates";
import { getStageInstruction } from "@shared/stageInstructions";

interface SendEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCase: Case | null;
  emailSubject: string;
  setEmailSubject: React.Dispatch<React.SetStateAction<string>>;
  emailBody: string;
  setEmailBody: React.Dispatch<React.SetStateAction<string>>;
  isSendingEmail: boolean;
  sendEmail: () => void | Promise<void>;
}

export function SendEmailDialog({
  open,
  onOpenChange,
  selectedCase,
  emailSubject,
  setEmailSubject,
  emailBody,
  setEmailBody,
  isSendingEmail,
  sendEmail,
}: SendEmailDialogProps) {
  const { t } = useTranslation("admin");
  const [templatesExpanded, setTemplatesExpanded] = useState(true);

  const stageNum = selectedCase?.withdrawalStage
    ? parseInt(selectedCase.withdrawalStage, 10)
    : null;
  const stageName =
    stageNum && !isNaN(stageNum) && STAGE_SHORT_LABELS[stageNum]
      ? STAGE_SHORT_LABELS[stageNum]
      : null;
  const stageLabel = stageNum && stageName ? `Stage ${stageNum} — ${stageName}` : null;
  const stageInstruction = stageNum && !isNaN(stageNum) ? getStageInstruction(stageNum) : null;

  const applyTemplate = (templateId: string) => {
    const tpl = QUICK_SEND_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const name = selectedCase?.userName ?? "";
    const sName = stageName ?? "your current stage";
    setEmailSubject(tpl.getSubject(sName));
    setEmailBody(tpl.getBody(name, sName, stageNum));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-950 border-slate-800 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-cyan-400" />
            {t("dialogs.sendEmail.title", { name: selectedCase?.userName })}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Compose and send an email to {selectedCase?.userEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quick templates section */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/50">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-slate-200 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
              onClick={() => setTemplatesExpanded((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" />
                Quick templates
              </span>
              {templatesExpanded ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {templatesExpanded && (
              <div className="px-3 pb-3 pt-1 space-y-2.5">
                {/* Current stage context */}
                {stageLabel ? (
                  <div className="rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 space-y-0.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Current stage
                    </p>
                    <p className="text-sm text-slate-200 font-medium">{stageLabel}</p>
                    {stageInstruction?.summary && (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {stageInstruction.summary}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    No withdrawal stage set — templates will use a generic stage reference.
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  Click a template to pre-fill the subject and body below. You can edit before sending.
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_SEND_TEMPLATES.map((tpl) => (
                    <Button
                      key={tpl.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-slate-600 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-white hover:border-slate-500"
                      onClick={() => applyTemplate(tpl.id)}
                      data-testid={`quick-template-${tpl.id}`}
                    >
                      {tpl.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Subject</Label>
            <Input
              placeholder="Enter email subject..."
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
              data-testid="input-email-subject"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Message (HTML supported)</Label>
            <Textarea
              placeholder="Enter email message..."
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={10}
              className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
              data-testid="input-email-body"
            />
            <p className="text-xs text-slate-500">
              You can use HTML for formatting. The email will be wrapped in the IBCCF branded template.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700"
          >
            Cancel
          </Button>
          <Button
            onClick={sendEmail}
            disabled={!emailSubject.trim() || !emailBody.trim() || isSendingEmail}
            className="bg-cyan-600 hover:bg-cyan-700"
            data-testid="button-send-email"
          >
            {isSendingEmail ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Sending...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Send Email</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
