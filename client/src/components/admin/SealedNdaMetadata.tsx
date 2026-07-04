import { useEffect, useState } from "react";

type SealedNdaIntegrityCheck = {
  status: "ok" | "failed";
  checkedAt: string;
  checkedBy: string | null;
  detail?: string | null;
};

type SealedNdaMetadataPayload = {
  signedName: string;
  signedAt: string;
  signedIp?: string | null;
  signedUserAgent?: string | null;
  contentHash: string;
  templateVersion: string;
  signedLocale?: string | null;
  lastIntegrityCheck?: SealedNdaIntegrityCheck | null;
};

const SEALED_NDA_LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  zh: "Simplified Chinese",
};

export function SealedNdaMetadata({ caseId, authToken }: { caseId: string; authToken: string | null }) {
  const [meta, setMeta] = useState<SealedNdaMetadataPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live result from the most recent click of "Verify integrity" in this
  // session. It supersedes `meta.lastIntegrityCheck` (which is the value
  // loaded from the server when the dialog opened) so the admin sees the
  // outcome of the click they just made without waiting for a refetch.
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    storedHash: string;
    recomputedHash: string;
    checkedAt: string;
    checkedBy: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cases/${caseId}/nda/metadata`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setMeta(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
    return () => { cancelled = true; };
  }, [caseId, authToken]);
  if (error) {
    return (
      <p className="text-[11px] text-amber-200/70">
        Signature metadata unavailable: {error}
      </p>
    );
  }
  if (!meta) return <p className="text-[11px] text-amber-200/60">Loading signature metadata…</p>;
  // The fresh in-session verifyResult wins; otherwise fall back to the
  // server-recorded latest check so a previously-flagged tamper finding
  // persists across reloads and admin handoffs.
  const effectiveCheck: SealedNdaIntegrityCheck | null = verifyResult
    ? {
        status: verifyResult.ok ? "ok" : "failed",
        checkedAt: verifyResult.checkedAt,
        checkedBy: verifyResult.checkedBy,
        detail: undefined,
      }
    : meta.lastIntegrityCheck ?? null;
  return (
    <div className="space-y-1 rounded border border-amber-800/40 bg-amber-950/40 p-2 text-[11px] text-amber-100/85" data-testid="sealed-nda-metadata">
      <div><span className="opacity-70">Signed name:</span> <span className="font-semibold">{meta.signedName}</span></div>
      <div><span className="opacity-70">Signed at:</span> <span className="font-mono">{new Date(meta.signedAt).toLocaleString()}</span></div>
      {meta.signedIp && <div><span className="opacity-70">IP:</span> <span className="font-mono">{meta.signedIp}</span></div>}
      <div className="break-all"><span className="opacity-70">SHA-256:</span> <span className="font-mono">{meta.contentHash}</span></div>
      <div><span className="opacity-70">Template:</span> <span className="font-mono">{meta.templateVersion}</span></div>
      {meta.signedLocale && (
        <div data-testid="sealed-nda-signed-locale">
          <span className="opacity-70">Signed language:</span>{" "}
          <span className="font-mono">
            {SEALED_NDA_LOCALE_LABELS[meta.signedLocale] ?? meta.signedLocale} ({meta.signedLocale})
          </span>
        </div>
      )}
      {effectiveCheck && (() => {
        // Extract a recomputed-hash hex from the audit-row detail when
        // the badge is being driven by the persisted lastIntegrityCheck
        // (e.g. after page reload). The verify endpoint writes the
        // string "recomputed hash <64-hex>" on failure so we parse the
        // same shape here for reload-parity with the in-session result.
        const persistedRecomputed = (() => {
          if (verifyResult) return null;
          const detail = effectiveCheck.detail ?? "";
          const m = detail.match(/recomputed hash\s+([0-9a-f]{64})/i);
          return m ? m[1] : null;
        })();
        const recomputedHash = verifyResult?.recomputedHash ?? persistedRecomputed ?? null;
        return (
          <div
            className={
              effectiveCheck.status === "ok"
                ? "mt-1 rounded border border-emerald-700/50 bg-emerald-950/40 p-2 text-emerald-100"
                : "mt-1 rounded border border-red-600/70 bg-red-950/50 p-2 text-red-100"
            }
            data-testid={
              effectiveCheck.status === "ok"
                ? "nda-integrity-ok"
                : "nda-integrity-failed"
            }
          >
            <div className="font-semibold">
              {effectiveCheck.status === "ok"
                ? "Integrity verified"
                : "INTEGRITY FAILED — possible tampering"}
            </div>
            <div className="opacity-80">
              Checked {new Date(effectiveCheck.checkedAt).toLocaleString()}
              {effectiveCheck.checkedBy ? ` by ${effectiveCheck.checkedBy}` : ""}
            </div>
            {effectiveCheck.status === "ok" && (
              <div className="break-all mt-1">
                <span className="opacity-70">Recomputed:</span>{" "}
                <span className="font-mono">{recomputedHash ?? meta.contentHash}</span>{" "}
                <span className="opacity-70">(matches stored)</span>
              </div>
            )}
            {effectiveCheck.status === "failed" && recomputedHash && (
              <div className="break-all mt-1">
                <span className="opacity-70">Recomputed:</span>{" "}
                <span className="font-mono">{recomputedHash}</span>
              </div>
            )}
          </div>
        );
      })()}
      <button
        type="button"
        className="inline-block mt-1 mr-3 underline text-amber-200 hover:text-amber-100 disabled:opacity-50"
        data-testid="button-verify-nda-integrity"
        disabled={verifying}
        onClick={async () => {
          setVerifying(true);
          try {
            const res = await fetch(`/api/cases/${caseId}/nda/verify`, {
              method: "POST",
              headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setVerifyResult({
              ok: !!data.ok,
              storedHash: data.storedHash,
              recomputedHash: data.recomputedHash,
              checkedAt: data.checkedAt,
              checkedBy: data.checkedBy,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Verification failed");
          } finally {
            setVerifying(false);
          }
        }}
      >
        {verifying ? "Verifying…" : "Verify integrity"}
      </button>
      <button
        type="button"
        className="inline-block mt-1 underline text-amber-200 hover:text-amber-100"
        data-testid="link-download-sealed-pdf"
        onClick={async () => {
          // The PDF endpoint requires either a portal session OR an
          // admin bearer token. A raw <a href> cannot attach the
          // Authorization header, so for the admin dashboard we
          // fetch as a blob and trigger a client-side download.
          try {
            const res = await fetch(`/api/cases/${caseId}/nda/pdf`, {
              headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            });
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `IBCCF-Sealed-Settlement-${caseId}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download failed");
          }
        }}
      >
        Download signed PDF
      </button>
    </div>
  );
}
