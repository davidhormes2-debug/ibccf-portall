import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Loader2 } from "lucide-react";

interface DocumentPreviewProps {
  dataUrl: string;
  fileName?: string | null;
  variant?: "admin" | "portal";
  className?: string;
  testIdPrefix?: string;
}

type Kind = "pdf" | "image" | "unsupported";

function detectKind(dataUrl: string, fileName?: string | null): Kind {
  const head = dataUrl.slice(0, 64).toLowerCase();
  if (head.includes("application/pdf")) return "pdf";
  if (head.startsWith("data:image/")) return "image";
  const name = (fileName || "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif)$/.test(name)) return "image";
  return "unsupported";
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    const [, mime, b64] = match;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

export function DocumentPreview({
  dataUrl,
  fileName,
  variant = "admin",
  className = "",
  testIdPrefix = "document-preview",
}: DocumentPreviewProps) {
  const kind = useMemo(() => detectKind(dataUrl, fileName), [dataUrl, fileName]);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (kind !== "pdf") {
      setBlobUrl(null);
      setLoading(false);
      return;
    }
    const url = dataUrlToBlobUrl(dataUrl);
    setBlobUrl(url);
    setLoading(false);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [dataUrl, kind]);

  const isPortal = variant === "portal";
  const shellCls = isPortal
    ? "rounded-xl border border-white/10 bg-black/40 overflow-hidden"
    : "rounded-lg border border-slate-800/60 bg-slate-950/60 overflow-hidden";
  const captionCls = isPortal
    ? "px-3 py-2 text-[11px] text-blue-300/80 border-t border-white/10 flex items-center gap-2"
    : "px-3 py-2 text-[11px] text-slate-400 border-t border-slate-800/60 flex items-center gap-2";

  if (kind === "unsupported") {
    return (
      <div className={`${shellCls} p-6 text-center ${className}`} data-testid={`${testIdPrefix}-unsupported`}>
        <AlertTriangle className={`h-6 w-6 mx-auto mb-2 ${isPortal ? "text-amber-300" : "text-amber-400"}`} />
        <p className={`text-sm ${isPortal ? "text-blue-100" : "text-slate-300"}`}>
          Inline preview is not available for this file type. Use Download to open it.
        </p>
      </div>
    );
  }

  return (
    <div className={`${shellCls} ${className}`} data-testid={`${testIdPrefix}-${kind}`}>
      {kind === "pdf" ? (
        loading ? (
          <div className="h-[480px] flex items-center justify-center">
            <Loader2 className={`h-5 w-5 animate-spin ${isPortal ? "text-blue-300" : "text-slate-400"}`} />
          </div>
        ) : !blobUrl ? (
          <div className="h-[200px] flex flex-col items-center justify-center p-6 text-center" data-testid={`${testIdPrefix}-pdf-error`}>
            <AlertTriangle className={`h-6 w-6 mb-2 ${isPortal ? "text-amber-300" : "text-amber-400"}`} />
            <p className={`text-sm ${isPortal ? "text-blue-100" : "text-slate-300"}`}>
              Unable to render this PDF inline. Use Download to open it locally.
            </p>
          </div>
        ) : (
          <iframe
            src={blobUrl}
            title={fileName || "PDF preview"}
            className="w-full h-[600px] bg-white"
            data-testid={`${testIdPrefix}-pdf-frame`}
          />
        )
      ) : (
        <div className="bg-slate-950/40 max-h-[600px] overflow-auto flex items-start justify-center">
          <img
            src={dataUrl}
            alt={fileName || "Submitted document"}
            className="w-full h-auto object-contain"
            data-testid={`${testIdPrefix}-image`}
          />
        </div>
      )}
      <div className={captionCls}>
        {kind === "pdf" ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
        <span className="truncate">{fileName || (kind === "pdf" ? "PDF document" : "Image")}</span>
        {kind === "pdf" && (
          <span className="ml-auto opacity-70">Use the toolbar above to navigate pages</span>
        )}
      </div>
    </div>
  );
}
