import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileText, Loader2, ShieldAlert } from "lucide-react";
import type { Case } from "@/components/admin/shared";

interface NdaMetadata {
  signed: boolean;
  signedName?: string | null;
  signedAt?: string | null;
  signedLocale?: string | null;
  contentHash?: string | null;
  templateVersion?: string | null;
}

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  zh: "中文",
};

function localeLabel(code?: string | null): string {
  if (!code) return "—";
  return LOCALE_LABELS[code] ?? code.toUpperCase();
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

interface SignedNdaDialogProps {
  caseData: Case | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
}

export function SignedNdaDialog({ caseData, open, onOpenChange, authToken }: SignedNdaDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<NdaMetadata | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    blobUrlRef.current = blobUrl;
  }, [blobUrl]);

  useEffect(() => {
    if (!open || !caseData) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetadata(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);

    (async () => {
      try {
        const headers = { Authorization: `Bearer ${authToken}` };
        const [metaRes, pdfRes] = await Promise.all([
          fetch(`/api/cases/${caseData.id}/nda/metadata`, { headers }),
          fetch(`/api/cases/${caseData.id}/nda/pdf`, { headers }),
        ]);
        if (!metaRes.ok) {
          const errBody = await metaRes.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || `Failed to load NDA metadata (${metaRes.status})`,
          );
        }
        if (!pdfRes.ok) {
          const errBody = await pdfRes.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || `Failed to load signed PDF (${pdfRes.status})`,
          );
        }
        const meta = (await metaRes.json()) as NdaMetadata;
        const blob = await pdfRes.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setMetadata(meta);
        setBlobUrl(url);
        blobUrlRef.current = url;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unable to load signed NDA");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, caseData, authToken]);

  useEffect(() => {
    if (!open && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setBlobUrl(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handleDownload = () => {
    if (!blobUrl || !caseData) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `IBCCF-Sealed-Settlement-${caseData.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-slate-950 border-slate-800 text-slate-100 max-w-4xl w-[95vw] h-[90vh] flex flex-col"
        data-testid="dialog-signed-nda"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" /> Signed NDA / Sealed Settlement
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {caseData ? `Case ${caseData.accessCode} — ${caseData.userName ?? "Unnamed"}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading signed NDA…
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-md text-center space-y-2 p-6 rounded-lg border border-red-700/60 bg-red-950/40 text-red-200">
              <ShieldAlert className="w-8 h-8 mx-auto" />
              <p className="font-semibold">Unable to display signed NDA</p>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {metadata && (
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs rounded-lg border border-amber-700/40 bg-amber-950/30 p-3"
                data-testid="signed-nda-metadata"
              >
                <div>
                  <span className="text-amber-200/70 uppercase tracking-wider mr-1">Signed by:</span>
                  <span className="text-amber-100 font-medium">{metadata.signedName ?? "—"}</span>
                </div>
                <div>
                  <span className="text-amber-200/70 uppercase tracking-wider mr-1">Signed at:</span>
                  <span className="text-amber-100">{formatDate(metadata.signedAt)}</span>
                </div>
                <div>
                  <span className="text-amber-200/70 uppercase tracking-wider mr-1">Signed locale:</span>
                  <span className="text-amber-100">{localeLabel(metadata.signedLocale)}</span>
                </div>
                <div>
                  <span className="text-amber-200/70 uppercase tracking-wider mr-1">Template:</span>
                  <span className="text-amber-100">{metadata.templateVersion ?? "—"}</span>
                </div>
                <div className="md:col-span-2 break-all">
                  <span className="text-amber-200/70 uppercase tracking-wider mr-1">Content hash:</span>
                  <code className="text-amber-100/90 text-[11px]">{metadata.contentHash ?? "—"}</code>
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
              {blobUrl ? (
                <iframe
                  src={blobUrl}
                  className="w-full h-full border-0 bg-white"
                  title="Signed NDA PDF"
                />
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
          <Button
            variant="outline"
            className="border-slate-700 bg-slate-800"
            onClick={() => onOpenChange(false)}
            data-testid="button-signed-nda-close"
          >
            Close
          </Button>
          <Button
            disabled={!blobUrl}
            onClick={handleDownload}
            className="bg-amber-600 hover:bg-amber-500 text-slate-900"
            data-testid="button-signed-nda-download"
          >
            <Download className="w-4 h-4 mr-2" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SigningLocalesResponse {
  value: string[];
  supported?: string[];
  required?: string[];
}

interface PreviewNdaDialogProps {
  caseData: Case | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
}

export function PreviewNdaDialog({ caseData, open, onOpenChange, authToken }: PreviewNdaDialogProps) {
  const [allowedLocales, setAllowedLocales] = useState<string[]>([]);
  const [locale, setLocale] = useState<string>("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    blobUrlRef.current = blobUrl;
  }, [blobUrl]);

  // Load allowed signing locales once when dialog opens, and pick a default.
  useEffect(() => {
    if (!open || !caseData) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/nda-signing-locales", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SigningLocalesResponse;
        if (cancelled) return;
        const list = Array.isArray(data.value) && data.value.length > 0 ? data.value : ["en"];
        setAllowedLocales(list);
        const pref = (caseData.preferredLocale ?? "").trim().toLowerCase();
        setLocale(pref && list.includes(pref) ? pref : list.includes("en") ? "en" : list[0]);
      } catch {
        if (!cancelled) {
          setAllowedLocales(["en"]);
          setLocale("en");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, caseData, authToken]);

  // Fetch the unsigned preview PDF for the active locale.
  useEffect(() => {
    if (!open || !caseData) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEmptyState(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/cases/${caseData.id}/nda/pdf?locale=${encodeURIComponent(locale)}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));
          if (cancelled) return;
          setEmptyState(
            (body as { error?: string }).error ||
              "NDA not available yet — this case has not reached the signing stage.",
          );
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error || `Failed to render preview (${res.status})`,
          );
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setBlobUrl(url);
        blobUrlRef.current = url;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unable to render unsigned NDA preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, caseData, authToken, locale]);

  useEffect(() => {
    if (!open && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setBlobUrl(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handleDownload = () => {
    if (!blobUrl || !caseData) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `IBCCF-Settlement-Preview-${caseData.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const localeOptions = useMemo(
    () =>
      allowedLocales.map((code) => ({
        code,
        label: localeLabel(code),
      })),
    [allowedLocales],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-slate-950 border-slate-800 text-slate-100 max-w-4xl w-[95vw] h-[90vh] flex flex-col"
        data-testid="dialog-preview-nda"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-300" /> Preview Unsigned NDA
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {caseData
              ? `Case ${caseData.accessCode} — exactly what the user will be asked to sign.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 uppercase tracking-wider">Language</label>
          <Select
            value={locale}
            onValueChange={(v) => setLocale(v)}
            disabled={loading || localeOptions.length === 0}
          >
            <SelectTrigger
              className="w-[200px] bg-slate-900 border-slate-700 text-white"
              data-testid="select-preview-nda-locale"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {localeOptions.map((opt) => (
                <SelectItem
                  key={opt.code}
                  value={opt.code}
                  className="text-white hover:bg-slate-800"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>

        <div className="flex-1 min-h-0 rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
          {emptyState ? (
            <div className="h-full flex items-center justify-center p-6 text-center text-slate-300">
              <div className="max-w-md space-y-2">
                <ShieldAlert className="w-8 h-8 mx-auto text-blue-300" />
                <p className="font-semibold">NDA not available yet</p>
                <p className="text-sm text-slate-400">{emptyState}</p>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div className="max-w-md space-y-2 text-red-200">
                <ShieldAlert className="w-8 h-8 mx-auto" />
                <p className="font-semibold">Unable to render preview</p>
                <p className="text-sm opacity-90">{error}</p>
              </div>
            </div>
          ) : blobUrl ? (
            <iframe
              src={blobUrl}
              className="w-full h-full border-0 bg-white"
              title="Unsigned NDA preview PDF"
            />
          ) : !loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              No preview rendered.
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
          <Button
            variant="outline"
            className="border-slate-700 bg-slate-800"
            onClick={() => onOpenChange(false)}
            data-testid="button-preview-nda-close"
          >
            Close
          </Button>
          <Button
            disabled={!blobUrl}
            onClick={handleDownload}
            className="bg-blue-600 hover:bg-blue-500 text-white"
            data-testid="button-preview-nda-download"
          >
            <Download className="w-4 h-4 mr-2" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
