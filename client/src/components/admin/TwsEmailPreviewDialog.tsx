import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Send, RefreshCw, AlertCircle } from "lucide-react";

interface TwsEmailPreviewData {
  subject: string;
  preheader: string;
  html: string;
  to: string;
  userName: string;
  caseReference: string;
}

interface TwsEmailPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string | null;
  authHeaders: () => Record<string, string>;
  onSent?: () => void;
  /** URL path segment after `/api/cases/:id/` for the preview GET. Defaults to `token-wallet-email-preview`. */
  previewEndpoint?: string;
  /** URL path segment after `/api/cases/:id/` for the resend POST. Defaults to `send-token-wallet-confirmed-email`. */
  sendEndpoint?: string;
  /** Dialog title. Defaults to "Token Wallet Confirmation Email Preview". */
  title?: string;
}

export function TwsEmailPreviewDialog({
  open,
  onOpenChange,
  caseId,
  authHeaders,
  onSent,
  previewEndpoint = "token-wallet-email-preview",
  sendEndpoint = "send-token-wallet-confirmed-email",
  title = "Token Wallet Confirmation Email Preview",
}: TwsEmailPreviewDialogProps) {
  const [preview, setPreview] = useState<TwsEmailPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open || !caseId) {
      setPreview(null);
      setFetchError(null);
      setSentSuccess(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    fetch(`/api/cases/${caseId}/${previewEndpoint}`, {
      headers: authHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<TwsEmailPreviewData>;
      })
      .then((data) => {
        setPreview(data);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load preview");
      })
      .finally(() => setLoading(false));
  }, [open, caseId, previewEndpoint]);

  useEffect(() => {
    if (!iframeRef.current || !preview) return;
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(preview.html);
    doc.close();
  }, [preview]);

  const handleSend = async () => {
    if (!caseId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/${sendEndpoint}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSentSuccess(true);
      onSent?.();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col bg-slate-950 border-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-purple-400" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {preview
              ? <>Preview of the email that will be sent to <span className="text-purple-200">{preview.to}</span></>
              : "Loading email preview…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-3 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          )}

          {fetchError && !loading && (
            <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-800/40 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}

          {preview && !loading && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="uppercase tracking-wider font-semibold text-slate-500">To</span>
                  <span className="text-purple-200">{preview.to}</span>
                </div>
                <div className="flex items-start gap-3 text-xs text-slate-400">
                  <span className="uppercase tracking-wider font-semibold text-slate-500 shrink-0">Subject</span>
                  <span className="text-white font-medium">{preview.subject}</span>
                </div>
              </div>

              <div className="rounded-lg overflow-hidden border border-slate-700/50 bg-white" style={{ height: 420 }}>
                <iframe
                  ref={iframeRef}
                  title="Email preview"
                  className="w-full h-full border-0"
                  sandbox="allow-same-origin"
                />
              </div>
            </>
          )}

          {sentSuccess && (
            <div className="flex items-center gap-2 rounded-lg bg-green-950/30 border border-green-800/40 px-4 py-3 text-sm text-green-300">
              <Send className="h-4 w-4 shrink-0" />
              Email queued for delivery — check the audit log for the final delivery status.
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between mt-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            data-testid="button-tws-preview-close"
          >
            Close
          </Button>
          {preview && !sentSuccess && (
            <Button
              onClick={handleSend}
              disabled={sending}
              className="bg-purple-700 hover:bg-purple-600 text-white font-semibold"
              data-testid="button-tws-preview-send"
            >
              {sending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                <><Send className="h-4 w-4 mr-2" /> Send Now</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
