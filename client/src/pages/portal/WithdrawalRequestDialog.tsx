import React from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Wallet } from "lucide-react";
import { WithdrawalRequestForm } from "./WithdrawalRequestForm";
import type { Case } from "./PortalContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCase: Case;
  onSubmitted?: () => void;
}

/**
 * Four-section withdrawal request dialog. The form itself lives in the
 * shared `WithdrawalRequestForm` component so the Dashboard dialog and the
 * dedicated portal Withdrawal tab render the exact same fields + validation.
 *
 * The platform is DISPLAY ONLY — submitting this form does NOT initiate any
 * funds transfer. It records the user's intent against the case so a case
 * officer can review the requested destination wallet, then advance the
 * case manually.
 */
export function WithdrawalRequestDialog({
  open,
  onOpenChange,
  currentCase,
  onSubmitted,
}: Props) {
  const { t } = useTranslation("portal");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-withdrawal-request">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-500" />
            {t("withdrawalRequest.dialog.title", "Request Withdrawal")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "withdrawalRequest.dialog.description",
              "Submit your withdrawal details for compliance review. This platform is display only — funds are not moved by this form. Your case officer will review your requested destination wallet and notify you of the outcome.",
            )}
          </DialogDescription>
        </DialogHeader>

        <WithdrawalRequestForm
          currentCase={currentCase}
          onCancel={() => onOpenChange(false)}
          onSubmitted={() => {
            onOpenChange(false);
            onSubmitted?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
