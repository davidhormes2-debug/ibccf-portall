import { useState } from "react";
import { History } from "lucide-react";

export function PayoutWalletHistoryHint({
  caseId,
  authToken,
}: {
  caseId: string;
  authToken: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{
    id: number;
    action: string;
    adminUsername?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    createdAt: string;
  }> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (logs !== null || loading) return;
    setLoading(true);
    try {
      const token = authToken || sessionStorage.getItem('adminToken') || '';
      const res = await fetch('/api/audit-logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const all = (await res.json()) as Array<{
          id: number;
          action: string;
          adminUsername?: string | null;
          targetType?: string | null;
          targetId?: string | null;
          createdAt: string;
        }>;
        setLogs(
          all
            .filter(
              (l) =>
                l.action === 'payout_wallet_updated' &&
                l.targetType === 'case' &&
                l.targetId === caseId,
            )
            .slice(0, 10),
        );
      } else {
        setLogs([]);
      }
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="text-[11px] text-slate-400 bg-slate-900/40 border border-slate-800/60 rounded-lg px-3 py-2"
      data-testid="payout-wallet-history-hint"
    >
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors"
        data-testid="button-payout-wallet-history-toggle"
      >
        <History className="h-3.5 w-3.5" />
        <span className="font-semibold">Change history</span>
        <span className="text-slate-500">
          ({open ? 'hide' : 'view recent payout_wallet_updated entries'})
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5" data-testid="payout-wallet-history-list">
          {loading && <p className="text-slate-500 italic">Loading…</p>}
          {!loading && logs && logs.length === 0 && (
            <p className="text-slate-500 italic">
              No prior wallet changes recorded for this case.
            </p>
          )}
          {!loading &&
            logs &&
            logs.map((l) => (
              <div
                key={l.id}
                className="text-[11px] text-slate-300 border-l-2 border-emerald-700/50 pl-2"
              >
                <span className="text-slate-500">
                  {new Date(l.createdAt).toLocaleString()}
                </span>{' '}
                — <span className="text-emerald-300">{l.adminUsername || 'admin'}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
