import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface PortalEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  iconClassName?: string;
  "data-testid"?: string;
}

export function PortalEmptyState({
  icon: Icon,
  title,
  description,
  hint,
  action,
  className = "",
  iconClassName = "text-slate-500",
  "data-testid": testId,
}: PortalEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`text-center py-16 rounded-2xl glass-dark ${className}`}
      data-testid={testId ?? "portal-empty-state"}
    >
      <Icon
        className={`w-14 h-14 mx-auto mb-4 ${iconClassName}`}
        aria-hidden="true"
      />
      <h3 className="text-lg font-semibold text-slate-300 mb-2">{title}</h3>
      {description && (
        <p className="text-slate-500 text-sm max-w-xs mx-auto">{description}</p>
      )}
      {hint && (
        <p className="text-xs text-slate-600 mt-4 max-w-xs mx-auto">{hint}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}
