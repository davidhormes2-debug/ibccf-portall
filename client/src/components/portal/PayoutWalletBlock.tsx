import { ShieldCheck, Wallet } from "lucide-react";
import type { Case } from "@/pages/portal/PortalContext";
import { useFormat } from "@/i18n/format";

/**
 * Compact, read-only payout wallet block reused across the portal
 * (LetterView, DeclarationView, Stage 12 final-confirmation card, etc.).
 *
 * IMPORTANT: this is purely DISPLAY. The platform does NOT route, hold,
 * or relay funds — every label below reinforces that.
 */
export function PayoutWalletBlock({
  currentCase,
  variant = "dark",
  className = "",
}: {
  currentCase: Case;
  variant?: "dark" | "light";
  className?: string;
}) {
  const { formatDateTime } = useFormat();
  const address = (currentCase.payoutWalletAddress || "").trim();
  const asset = (currentCase.payoutWalletAsset || "").trim();
  const network = (currentCase.payoutWalletNetwork || "").trim();
  // payoutWalletNote is intentionally INTERNAL and is not surfaced in
  // any user-facing portal view or outbound email — it's an officer-only
  // field shown only inside the admin case-detail dialog.
  const verifiedAt = currentCase.payoutWalletVerifiedAt || null;
  const verifiedBy = (currentCase.payoutWalletVerifiedBy || "").trim();

  const isLight = variant === "light";

  if (!address) {
    return (
      <div
        className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
          isLight
            ? "bg-slate-50 border-slate-200"
            : "bg-slate-800/40 border-slate-700/60"
        } ${className}`}
        data-testid="payout-wallet-block-empty"
      >
        <Wallet className={`w-5 h-5 mt-0.5 shrink-0 ${isLight ? "text-slate-500" : "text-slate-400"}`} />
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-semibold ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            Verified Payout Wallet
          </p>
          <p className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
            Awaiting designation by your case officer
          </p>
          <p className={`text-xs mt-0.5 ${isLight ? "text-slate-600" : "text-slate-300/80"}`}>
            The portal is display-only — IBCCF never holds, routes, or relays funds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        isLight
          ? "bg-emerald-50 border-emerald-200"
          : "bg-emerald-950/30 border-emerald-500/30"
      } ${className}`}
      data-testid="payout-wallet-block"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className={`w-5 h-5 mt-0.5 shrink-0 ${isLight ? "text-emerald-700" : "text-emerald-300"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-[10px] uppercase tracking-widest font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
              Verified Payout Wallet
            </p>
            <span
              className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${
                isLight
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  : "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30"
              }`}
            >
              Display only
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div>
              <div className={`text-[10px] uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Asset</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`} data-testid="payout-wallet-block-asset">
                {asset || "—"}
              </div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Network</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`} data-testid="payout-wallet-block-network">
                {network || "—"}
              </div>
            </div>
          </div>
          <div className="mt-2">
            <div className={`text-[10px] uppercase tracking-wider ${isLight ? "text-slate-500" : "text-slate-400"}`}>Wallet address</div>
            <code
              className={`text-xs font-mono break-all block mt-0.5 ${
                isLight ? "text-emerald-900" : "text-emerald-200"
              }`}
              data-testid="payout-wallet-block-address"
            >
              {address}
            </code>
          </div>
          {(verifiedAt || verifiedBy) && (
            <p className={`text-[11px] mt-2 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
              Verified
              {verifiedBy ? (
                <> by <span className={`font-semibold ${isLight ? "text-slate-700" : "text-slate-200"}`}>{verifiedBy}</span></>
              ) : null}
              {verifiedAt ? (
                <> on <span className="font-mono">{formatDateTime(verifiedAt)}</span></>
              ) : null}
            </p>
          )}
          <p className={`text-[11px] mt-1 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
            IBCCF does not hold, route, or relay funds. This address is your case officer's verified destination.
          </p>
        </div>
      </div>
    </div>
  );
}
