import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldAlert, Eye } from "lucide-react";
import { setMirrorToken } from "@/lib/portalSession";

// /admin/mirror?token=XXX — exchanges a one-shot mirror token for a portal
// session and boots the user portal in this same tab. The token is set up by
// the admin via "Open as User" and is single-use, expires in 2 minutes, and is
// validated server-side before any session storage is written.
export default function AdminMirror() {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError("Missing mirror token. Please re-open from the admin panel.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/cases/redeem-mirror-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (cancelled) return;
          setError(
            (data && (data as { error?: string }).error) ||
              "This mirror link is invalid or has already been used.",
          );
          return;
        }
        const accessCode = (data as { accessCode?: string }).accessCode;
        const caseId = (data as { caseId?: string }).caseId;
        const issuedBy = (data as { issuedBy?: string }).issuedBy ?? "";
        const reason = (data as { reason?: string }).reason ?? "";
        const expiresAt = (data as { expiresAt?: number }).expiresAt ?? 0;
        const portalSessionToken = (data as { portalSessionToken?: string })
          .portalSessionToken;
        if (!accessCode || !caseId) {
          if (cancelled) return;
          setError("The server did not return a valid case for this token.");
          return;
        }
        // Hard-fail if the portal session token is missing — without it the
        // portal's auto-login (GET /api/cases/access/:code) will 401 for any
        // PIN-protected case and bounce the admin back to the public Secure
        // Gateway Access screen, which is exactly the bug this flow fixes.
        if (!portalSessionToken) {
          if (cancelled) return;
          setError(
            "The server did not return a portal session for this mirror. Please retry from the admin panel.",
          );
          return;
        }
        // Seed the mirror session token BEFORE navigating. setMirrorToken stores
        // it in sessionStorage only — never localStorage — so it dies with this
        // tab and cannot be reused across browser sessions. The server-side row
        // also has a short TTL matching the mirror token's 2-minute window.
        setMirrorToken(portalSessionToken, expiresAt);
        // Boot the portal as if the user had logged in and verified their PIN.
        sessionStorage.setItem("caseAccessCode", accessCode);
        sessionStorage.setItem("caseId", caseId);
        sessionStorage.setItem("pinVerified", "true");
        sessionStorage.removeItem("requiresPinSetup");
        // Mirror context — read by PortalShell to show the assistance banner.
        sessionStorage.setItem("ibccfAdminMirror", "1");
        sessionStorage.setItem("ibccfAdminMirrorIssuedBy", issuedBy);
        sessionStorage.setItem("ibccfAdminMirrorReason", reason);
        if (expiresAt) {
          sessionStorage.setItem("ibccfAdminMirrorExpiresAt", String(expiresAt));
        }
        if (cancelled) return;
        navigate("/dashboard");
      } catch {
        if (cancelled) return;
        setError("Network error while redeeming the mirror token.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-slate-950 text-blue-100 flex items-center justify-center p-6" aria-live="polite">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl">
        {error ? (
          <div className="text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" />
            <h1 className="text-lg font-bold text-white">
              Cannot open user mirror
            </h1>
            <p className="text-sm text-blue-200/80">{error}</p>
            <button
              onClick={() => window.close()}
              className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
              data-testid="button-mirror-close"
            >
              Close window
            </button>
          </div>
        ) : (
          <div className="text-center space-y-3" data-testid="status-mirror-loading">
            <Eye className="w-10 h-10 text-amber-300 mx-auto" />
            <h1 className="text-lg font-bold text-white">Opening user portal</h1>
            <p className="text-sm text-blue-200/80 inline-flex items-center gap-2 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Setting up your mirrored session…
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
