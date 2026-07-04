import { useState } from "react";
import { Award, Send, Eye, FileText, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Case {
  id: string;
  userName?: string;
  userEmail?: string;
  refundClaimStatus?: string | null;
}

interface Props {
  open: boolean;
  caseRow: Case | null;
  onClose: () => void;
  onSent: () => void;
  authToken: string | null;
}

function FormPreview({ recommendations, refundableAmount }: { recommendations: string; refundableAmount: string }) {
  const displayAmount = refundableAmount.trim() ? `${refundableAmount.trim()} USDT` : "— USDT";
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(10,20,60,0.6)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Mini portal header */}
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-amber-400" />
          <span className="text-white font-semibold text-sm">Refund Claim</span>
        </div>
        <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
          Awaiting submission
        </Badge>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Refundable balance chip */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl"
          style={{ background: "rgba(200,169,81,0.08)", border: "1px solid rgba(200,169,81,0.2)" }}
        >
          <span className="text-amber-300/70 text-[10px]">Refundable activation balance:</span>
          <span className="text-amber-300 font-bold text-xs font-mono">{displayAmount}</span>
        </div>

        {/* Doc recommendations preview */}
        {recommendations.trim() && (
          <div
            className="rounded-xl p-3"
            style={{ background: "rgba(200,169,81,0.07)", border: "1px solid rgba(200,169,81,0.2)" }}
          >
            <p className="text-amber-300/80 text-[10px] uppercase tracking-wider font-semibold mb-2">
              Documentary Recommendations
            </p>
            <p className="text-amber-100/70 text-xs whitespace-pre-line leading-relaxed">
              {recommendations}
            </p>
          </div>
        )}

        {/* Mock entry row */}
        <div>
          <p className="text-blue-300/60 text-[10px] uppercase tracking-widest font-semibold mb-2">
            Itemised Deposit Entries
          </p>
          <div
            className="rounded-xl p-3 flex items-center gap-3 opacity-50"
            style={{ border: "1.5px dashed rgba(255,255,255,0.1)" }}
          >
            <div className="w-6 h-6 rounded-lg bg-blue-600/30 flex items-center justify-center text-blue-300 font-bold text-[10px]">
              1
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2">
              {["Amount (USDT)", "Charged for", "Date"].map((label) => (
                <div key={label} className="h-6 rounded-md bg-white/5 flex items-center px-2">
                  <span className="text-blue-400/30 text-[9px]">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            className="mt-2 flex items-center gap-1 text-blue-400/60 text-[10px] font-medium"
            onClick={() => {}}
          >
            <span className="text-blue-400/40">+</span> Add Entry
          </button>
        </div>

        {/* Mock submit button */}
        <div
          className="text-center py-2 rounded-xl text-white/40 text-xs font-semibold"
          style={{ background: "rgba(37,99,235,0.15)", border: "1px solid rgba(37,99,235,0.2)" }}
        >
          Submit Refund Claim
        </div>
      </div>
    </div>
  );
}

export function RefundClaimRequestDialog({ open, caseRow, onClose, onSent, authToken }: Props) {
  const [refundableAmount, setRefundableAmount] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"compose" | "preview">("compose");

  const handleSend = async () => {
    if (!caseRow || !authToken) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cases/${caseRow.id}/refund-claim/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          refundableAmount: refundableAmount.trim() || null,
          documentaryRecommendations: recommendations.trim() || null,
        }),
      });
      if (res.ok) {
        onSent();
        onClose();
        setRefundableAmount("");
        setRecommendations("");
        setTab("compose");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl border border-white/10 text-white p-0 overflow-hidden"
        style={{ background: "rgba(8,16,48,0.98)", backdropFilter: "blur(24px)" }}
      >
        {/* Gold accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />

        <div className="px-6 pt-5 pb-2">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-700/20 border border-amber-500/20 flex items-center justify-center">
                <Award className="h-4.5 w-4.5 text-amber-400" />
              </div>
              <div>
                <DialogTitle className="text-white text-base font-bold">Send Refund Claim Request</DialogTitle>
                <DialogDescription className="text-blue-300/60 text-xs">
                  {caseRow?.userName || caseRow?.id} — {caseRow?.userEmail}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "compose" | "preview")} className="px-6">
          <TabsList className="bg-white/5 border border-white/10 w-full mb-4">
            <TabsTrigger value="compose" className="flex-1 data-[state=active]:bg-blue-600/40 data-[state=active]:text-white text-blue-300/70 text-xs">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Compose
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1 data-[state=active]:bg-blue-600/40 data-[state=active]:text-white text-blue-300/70 text-xs">
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Portal Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="space-y-4 mt-0">
            {/* Refundable amount field */}
            <div>
              <Label className="text-blue-300/80 text-xs mb-2 block">
                Refundable Amount (USDT)
                <span className="text-blue-400/40 ml-1 font-normal">(required)</span>
              </Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={refundableAmount}
                  onChange={(e) => setRefundableAmount(e.target.value)}
                  placeholder="e.g. 1000"
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/30 focus-visible:ring-amber-500/50 pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-300/60 text-xs font-mono font-semibold pointer-events-none">
                  USDT
                </span>
              </div>
              <p className="text-blue-400/40 text-[10px] mt-1.5">
                This is the refundable portion the user is claiming back. It will appear prominently on their Refund Claim form.
              </p>
            </div>

            <div>
              <Label className="text-blue-300/80 text-xs mb-2 block">
                Documentary Recommendations
                <span className="text-blue-400/40 ml-1 font-normal">(optional)</span>
              </Label>
              <Textarea
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="e.g. Please include your bank statement for April and a signed screenshot of the transaction showing the wallet address…"
                rows={4}
                className="bg-white/5 border-white/10 text-white placeholder:text-blue-400/30 focus-visible:ring-amber-500/50 resize-none text-sm"
              />
              <p className="text-blue-400/40 text-[10px] mt-1.5">
                These notes will appear in the email and at the top of the user's Refund Claim form.
              </p>
            </div>

            {/* Preview link */}
            <button
              onClick={() => setTab("preview")}
              className="flex items-center gap-1.5 text-blue-400/60 hover:text-blue-300 text-xs transition-colors"
            >
              <Eye className="h-3 w-3" />
              See how this looks in the portal
              <ChevronRight className="h-3 w-3" />
            </button>
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            <FormPreview recommendations={recommendations} refundableAmount={refundableAmount} />
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-white/8">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-blue-300/60 hover:text-blue-300 hover:bg-white/5 text-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !refundableAmount.trim()}
            className="bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white font-semibold px-6 rounded-xl shadow-lg shadow-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…</>
              : <><Send className="h-4 w-4 mr-2" /> Send & Enable</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
