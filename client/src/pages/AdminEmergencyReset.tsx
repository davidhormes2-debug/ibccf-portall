import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";

// /admin/emergency-reset?token=XXX — confirms an emergency admin-credential
// reset requested via the "Emergency access recovery" link on the admin
// login screen. See replit.md → "Admin login recovery" for the full runbook.
// Deliberately unauthenticated: the whole point is to recover access when
// the admin cannot log in. Safety comes from the emailed single-use token,
// not a session.
export default function AdminEmergencyReset() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing reset token. Re-open this page from the emailed link.");
      return;
    }
    if (!newPassword || newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/emergency-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newUsername: newUsername.trim() || undefined,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "Emergency reset failed.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <ShieldAlert className="h-6 w-6 text-amber-400" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-white">
            Emergency admin credential reset
          </h1>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Admin credentials have been updated. You can now log in with the new
                {newUsername.trim() ? " username and " : " "}password.
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
            >
              Go to admin login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-slate-400">
              This single-use link was emailed to the configured recovery address.
              Set new admin credentials below. Leave the username blank to keep the
              current one.
            </p>

            {!token && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                Missing reset token — re-open this page from the emailed link.
              </div>
            )}

            <div>
              <label htmlFor="newUsername" className="block text-xs font-medium text-slate-300 mb-1">
                New username (optional)
              </label>
              <input
                id="newUsername"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-xs font-medium text-slate-300 mb-1">
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-medium text-slate-300 mb-1">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !token}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Reset admin credentials
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
