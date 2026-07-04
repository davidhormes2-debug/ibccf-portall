import { MessageCircle } from "lucide-react";
import { usePortal } from "@/pages/portal/PortalContext";
import { showTawkto, isTawktoConfigured } from "@/lib/tawkto";

export function PortalWarningContactChip() {
  const { activeWarning, warningDismissed } = usePortal();

  if (!activeWarning || !warningDismissed || !isTawktoConfigured()) return null;

  return (
    <button
      onClick={showTawkto}
      className="flex items-center gap-1.5 bg-blue-700/20 border border-blue-500/40 text-blue-300 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-blue-700/30 transition-colors"
      title="Contact our support team"
      aria-label="Contact support"
      data-testid="warning-dismissed-contact-support"
    >
      <MessageCircle className="w-3 h-3" />
      Contact Support
    </button>
  );
}
