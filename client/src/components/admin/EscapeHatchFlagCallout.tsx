import { AlertTriangle } from "lucide-react";

type FlagKind = "password" | "username" | "sessionSecret";

const FLAG_LABELS: Record<FlagKind, string> = {
  password: "ALLOW_WEAK_ADMIN_PASSWORD=1",
  username: "ALLOW_WEAK_ADMIN_USERNAME=1",
  sessionSecret: "ALLOW_WEAK_SESSION_SECRET=1",
};

const FLAG_DESCRIPTIONS: Record<FlagKind, string> = {
  password: "Password strength check is currently bypassed.",
  username: "Username trivial-check is currently bypassed.",
  sessionSecret: "Session-secret strength check is currently bypassed.",
};

const FLAG_TESTIDS: Record<FlagKind, string> = {
  password: "callout-escape-hatch-password",
  username: "callout-escape-hatch-username",
  sessionSecret: "callout-escape-hatch-session-secret",
};

interface Props {
  flag: FlagKind;
  active: boolean;
  isProduction: boolean;
}

export function EscapeHatchFlagCallout({ flag, active, isProduction }: Props) {
  if (!active || isProduction) return null;

  return (
    <div
      className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5"
      data-testid={FLAG_TESTIDS[flag]}
      role="note"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" aria-hidden />
      <span className="text-xs text-amber-300 leading-snug">
        {FLAG_DESCRIPTIONS[flag]}{" "}
        <span className="font-mono text-amber-200 text-[10px]">
          {FLAG_LABELS[flag]}
        </span>{" "}
        is active.
      </span>
    </div>
  );
}
