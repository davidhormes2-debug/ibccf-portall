import { useState } from "react";

interface AdminEmergencyResetDialogProps {
  onClose: () => void;
}

// Extracted from AdminDashboard.tsx (login screen "Locked out?" flow) to keep
// AdminDashboard.tsx under its byte-size budget — see
// client/src/components/admin/__tests__/AdminDashboardSizeBudget.test.ts.
export default function AdminEmergencyResetDialog({ onClose }: AdminEmergencyResetDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleRequest = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/emergency-reset/request", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, message: (data as { error?: string }).error || "Request failed." });
      } else {
        setResult({
          ok: true,
          message:
            (data as { message?: string }).message ||
            "If configured, a reset link has been emailed to the recovery address.",
        });
      }
    } catch {
      setResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-reset-dialog-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h2 id="emergency-reset-dialog-title" className="text-sm font-semibold text-white mb-2">
          Emergency access recovery
        </h2>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          If ADMIN_RECOVERY_EMAIL is configured, a single-use reset link will be
          emailed there (valid for 30 minutes). See replit.md &rarr; "Admin login
          recovery" for setup and full runbook details.
        </p>
        {result && (
          <div
            className={`mb-4 rounded-lg border p-3 text-xs ${result.ok ? "border-emerald-800 bg-emerald-950/40 text-emerald-200" : "border-red-800 bg-red-950/40 text-red-200"}`}
            data-testid="text-emergency-reset-result"
          >
            {result.message}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="text-xs px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="text-xs px-3 py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 disabled:opacity-50 transition-colors"
            onClick={handleRequest}
            disabled={submitting}
            data-testid="button-emergency-reset-submit"
          >
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </div>
      </div>
    </div>
  );
}
