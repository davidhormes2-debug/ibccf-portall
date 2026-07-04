import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { WithdrawalGuideBanner } from "@/components/portal/WithdrawalGuideBanner";

export function WithdrawalGuidePreview({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = body.trim();
  const hasBody = trimmed.length > 0;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200 focus:outline-none"
        data-testid="button-toggle-withdrawal-guide-preview"
        aria-expanded={open}
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        {open ? 'Hide preview' : 'Preview'}
      </button>
      {open && (
        <div className="mt-2" data-testid="withdrawal-guide-preview">
          <WithdrawalGuideBanner
            customBody={hasBody ? body : null}
            animated={false}
            emptyBodyFallback={
              <p
                className="text-slate-500 text-sm italic"
                data-testid="withdrawal-guide-preview-placeholder"
              >
                Default seven-step list will be shown
              </p>
            }
          />
        </div>
      )}
    </div>
  );
}
