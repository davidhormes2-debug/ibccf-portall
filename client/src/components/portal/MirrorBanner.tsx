import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { clearMirrorToken } from "@/lib/portalSession";

function readMirrorState() {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem("ibccfAdminMirror") !== "1") return null;
  const issuedBy = sessionStorage.getItem("ibccfAdminMirrorIssuedBy") ?? "";
  const reason = sessionStorage.getItem("ibccfAdminMirrorReason") ?? "";
  const expiresAt = Number(
    sessionStorage.getItem("ibccfAdminMirrorExpiresAt") ?? "0",
  );
  return { issuedBy, reason, expiresAt };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "ending";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function MirrorBanner() {
  const [state, _setState] = useState(readMirrorState);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!state) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      // When the mirror window closes, actively revoke the session token so
      // it cannot be used for additional API calls even within the same tab.
      if (state.expiresAt > 0 && current >= state.expiresAt) {
        clearMirrorToken();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  if (!state) return null;

  const remaining = state.expiresAt > 0 ? state.expiresAt - now : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15"
      data-testid="mirror-banner"
    >
      <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-start gap-3 text-amber-100">
        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-300 mt-0.5" />
        <div className="flex-1 text-xs sm:text-sm leading-snug">
          <p className="font-semibold text-amber-50">
            You are currently being assisted by a compliance officer.
          </p>
          <p className="mt-0.5 text-amber-200/90">
            {state.issuedBy ? (
              <>
                Officer <span className="font-mono">{state.issuedBy}</span> is
                viewing your account
              </>
            ) : (
              <>A compliance officer is viewing your account</>
            )}
            {state.reason ? (
              <>
                {" "}
                — reason: <span className="italic">"{state.reason}"</span>
              </>
            ) : null}
            . This session is logged in the audit trail
            {state.expiresAt > 0 ? (
              <>
                {" "}
                and ends in{" "}
                <span className="font-mono">{formatRemaining(remaining)}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      </div>
    </div>
  );
}
