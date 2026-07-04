import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreditCard,
  Search,
  Send,
  Eye,
  RefreshCw,
  Wallet,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useAdminDashboard } from "../AdminDashboardContext";
import type { Case } from "../shared";

type DepositFilter = "all" | "configured" | "not-configured";

const FILTER_LABELS: Record<DepositFilter, string> = {
  all: "All Cases",
  configured: "Address Set",
  "not-configured": "No Address Set",
};

interface EmailTemplate {
  label: string;
  subject: string;
  body: string;
}

const DEPOSIT_COINS = ["USDT", "USDC", "BTC", "ETH", "BNB", "BUSD", "DAI", "TRX"] as const;
const DEPOSIT_NETWORKS = [
  "TRC20 (TRON)",
  "ERC20 (Ethereum)",
  "BEP20 (BSC)",
  "Polygon",
  "Solana",
  "Avalanche (C-Chain)",
  "Arbitrum",
  "Optimism",
  "Bitcoin",
] as const;

const COIN_NETWORK_MAP: Record<string, string[]> = {
  USDT: ["TRC20 (TRON)", "ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Solana", "Avalanche (C-Chain)", "Arbitrum", "Optimism"],
  USDC: ["ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Solana", "Avalanche (C-Chain)", "Arbitrum", "Optimism"],
  BTC: ["Bitcoin"],
  ETH: ["ERC20 (Ethereum)", "Arbitrum", "Optimism"],
  BNB: ["BEP20 (BSC)"],
  BUSD: ["BEP20 (BSC)", "ERC20 (Ethereum)"],
  DAI: ["ERC20 (Ethereum)", "BEP20 (BSC)", "Polygon", "Arbitrum", "Optimism"],
  TRX: ["TRC20 (TRON)"],
};

function isValidAmount(val: string): boolean {
  const n = parseFloat(val.trim());
  return val.trim() !== "" && !isNaN(n) && n > 0 && isFinite(n);
}

function buildPortalRefreshTemplates(
  c: Case,
  coin = "USDT",
  network = "TRC20 (TRON)",
  amount = "750",
): EmailTemplate[] {
  const name = c.userName || "Valued Applicant";
  const ref = c.accessCode;
  const depositLine = c.depositAddress
    ? `\n\nDeposit address: ${c.depositAddress}\nCoin: ${coin}\nNetwork: ${network}`
    : `\n\nCoin: ${coin}\nNetwork: ${network}`;
  return [
    {
      label: "Access Window Renewal Required",
      subject: "Important: Your Case Portal — Access Window Renewal Required",
      body: `Dear ${name},

We are writing to inform you that your active portal session for case reference ${ref} has entered a compliance-mandated refresh cycle, which has temporarily suspended your access to the IBCCF case management portal until a brief renewal process is completed.

WHY THIS HAS HAPPENED

Your case portal operates within a defined access window — a secure, time-bounded environment provisioned specifically for your case. Think of this in the same way you would think about cloud storage or a safety deposit box: the service provider allocates dedicated, encrypted capacity on your behalf, and that allocation must be periodically confirmed to remain active. When an access window expires without renewal confirmation, the system automatically gates access to protect both you and the integrity of your case.

This is not a penalty or a sign of any issue with your case. It is a mandatory checkpoint built into the platform's security architecture. Every active case holder goes through this process.

WHAT IS REQUIRED

To restore your portal access and resume case activity, a Refundable Access Renewal Deposit of ${amount} ${coin} per declaration is required. Here is what you need to know:

  • The deposit amount is ${amount} ${coin} per declaration on your case.
  • Payment must be sent in ${coin} on the ${network} network — deposits on any other network cannot be credited.
  • The deposit is entirely refundable — it is held in trust against your case and returned to you at the conclusion of the withdrawal process, alongside your case settlement.
  • It is not a fee. No portion of this amount is retained by IBCCF as a charge for the renewal itself.
  • Once your deposit is received and verified, your access window will be reinstated immediately.${depositLine}

WHY THIS CANNOT BE BYPASSED

The access window framework is a regulatory compliance requirement tied to the security layer governing your case file. When a window lapses, the platform automatically moves your case into a protected hold state. This cannot be overridden by our compliance team, cannot be waived, and cannot be deferred — the system architecture does not permit manual session re-injection without a confirmed deposit, because doing so would break the cryptographic audit trail your case depends on for its legal and regulatory standing.

Attempting to access the portal through alternative means (direct URLs, cached sessions, third-party tools) will not succeed. The protection operates at the authentication infrastructure level, not at the interface level.

YOUR CASE IS FULLY SECURE

  • All of your case documents, correspondence, and progress are fully preserved and unaffected.
  • No deadlines within your case file are impacted by this renewal period.
  • Your personal information remains encrypted and accessible only to authorised parties.
  • This renewal in no way affects the outcome or timeline of your settlement process.

NEXT STEPS

Please log in to the portal using your case access credentials and follow the on-screen instructions to complete the Access Window Renewal. Once your ${amount} ${coin} deposit on the ${network} network has been processed and confirmed, you will receive a confirmation email and your portal access will be restored.

If you have any questions or concerns, do not hesitate to contact our compliance team via the secure messaging feature in your portal.

We appreciate your cooperation and understanding.

Warm regards,
IBCCF Compliance Management Team
ISO-D Compliance & Case Resolution Division`,
    },
    {
      label: "Access Window Renewal — Reminder",
      subject: `Reminder: Access Window Renewal Still Outstanding — Case ${ref}`,
      body: `Dear ${name},

This is a follow-up regarding your case reference ${ref}. Our records indicate that your Access Window Renewal is still outstanding and your portal access remains suspended.

As outlined in our previous correspondence, the renewal requires a Refundable Access Renewal Deposit of ${amount} ${coin} per declaration sent on the ${network} network to reactivate your dedicated session environment. This deposit is held entirely in trust and is returned to you as part of your case settlement — it is not a fee or a charge.

Please ensure you send ${coin} specifically on the ${network} network. Deposits sent on any other network cannot be credited to your case.${depositLine}

Until the renewal is completed, your portal access cannot be restored. The compliance checkpoint is enforced at the infrastructure level and cannot be bypassed or deferred by our team.

Your case data, documents, and withdrawal progress are fully preserved and secure. This is a procedural step only — completing it promptly will allow your case to continue without further delay.

To proceed, please log in to the portal with your access credentials and follow the on-screen instructions.

If you have any questions, please reach out via the secure messaging feature in your portal.

Regards,
IBCCF Compliance Management Team
ISO-D Compliance & Case Resolution Division`,
    },
  ];
}

function buildRequestEmail(c: Case): { subject: string; body: string } {
  const depositLine = c.depositAddress
    ? `\n\nYour designated deposit address: ${c.depositAddress}`
    : "";

  return {
    subject: "Action Required – Please Upload Your Activation Deposit Receipt",
    body: `Dear ${c.userName || "Valued Applicant"},

We have completed our review of your Declaration of Compliance for case reference ${c.accessCode}.${depositLine}

To proceed with your withdrawal, please log in to the portal and upload your deposit receipt confirming payment to the designated address.

Please ensure your receipt clearly shows:
  • Transaction hash / reference number
  • Amount transferred
  • Date and time of transfer

You can upload your receipt via the portal under the "Uploads" section.

If you have any questions, please contact us via the secure messaging feature in your portal.

Regards,
IBCCF Compliance Team`,
  };
}

interface SavedEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export function DepositsTab() {
  const { cases, isDataLoading, loadData, authToken, openReceiptsDialog, toast } =
    useAdminDashboard();

  const [filter, setFilter] = useState<DepositFilter>("all");
  const [search, setSearch] = useState("");

  // Saved (admin-defined) email templates fetched from the server
  const [savedTemplates, setSavedTemplates] = useState<SavedEmailTemplate[]>([]);

  useEffect(() => {
    const token = sessionStorage.getItem("adminToken") ?? "";
    fetch("/api/admin/settings/email-templates", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.templates)) setSavedTemplates(d.templates);
      })
      .catch(() => {});
  }, []);

  // Request email composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerCase, setComposerCase] = useState<Case | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [depositCoin, setDepositCoin] = useState<string>("USDT");
  const [depositNetwork, setDepositNetwork] = useState<string>("TRC20 (TRON)");
  const [depositAmount, setDepositAmount] = useState<string>("750");
  const [templateSnapshot, setTemplateSnapshot] = useState<{ coin: string; network: string; amount: string } | null>(null);

  const amountValid = isValidAmount(depositAmount);
  const networkMismatch = !!(COIN_NETWORK_MAP[depositCoin] && !COIN_NETWORK_MAP[depositCoin].includes(depositNetwork));
  const templateStale = templateSnapshot !== null && (
    templateSnapshot.coin !== depositCoin ||
    templateSnapshot.network !== depositNetwork ||
    templateSnapshot.amount !== depositAmount
  );

  const openComposer = (c: Case) => {
    const template = buildRequestEmail(c);
    setComposerCase(c);
    setEmailSubject(template.subject);
    setEmailBody(template.body);
    setSelectedTemplate("");
    setDepositCoin("USDT");
    setDepositNetwork("TRC20 (TRON)");
    setDepositAmount("750");
    setTemplateSnapshot(null);
    setComposerOpen(true);
  };

  const applyTemplate = (value: string, c: Case | null, coin: string, network: string, amount: string) => {
    if (!value || !c) return;
    if (value.startsWith("saved:")) {
      const savedIdx = Number(value.slice(6));
      const tpl = savedTemplates[savedIdx];
      if (!tpl) return;
      setEmailSubject(tpl.subject);
      setEmailBody(tpl.body);
      setSelectedTemplate("");
      setTemplateSnapshot(null);
      return;
    }
    const templates = buildPortalRefreshTemplates(c, coin, network, amount);
    const tpl = templates.find((_, i) => String(i) === value);
    if (!tpl) return;
    setEmailSubject(tpl.subject);
    setEmailBody(tpl.body);
    setSelectedTemplate("");
    setTemplateSnapshot({ coin, network, amount });
  };

  const sendRequest = async () => {
    if (!composerCase || !emailSubject.trim() || !emailBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cases/${composerCase.id}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        title: "Request sent",
        description: `Deposit receipt request sent to ${composerCase.userEmail}.`,
      });
      setComposerOpen(false);
    } catch (e) {
      toast({
        title: "Failed to send",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const filtered = useMemo(() => {
    let list = [...cases];
    if (filter === "configured") list = list.filter((c) => !!c.depositAddress);
    if (filter === "not-configured")
      list = list.filter((c) => !c.depositAddress);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.userName?.toLowerCase().includes(q) ||
          c.userEmail?.toLowerCase().includes(q) ||
          c.id?.toLowerCase().includes(q) ||
          c.accessCode?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [cases, filter, search]);

  const configuredCount = cases.filter((c) => !!c.depositAddress).length;
  const notConfiguredCount = cases.filter((c) => !c.depositAddress).length;

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-amber-400" />
            Deposit Requests
          </h2>
          <p className="text-slate-400 text-sm">
            Request users to upload their activation deposit receipt. Cases
            without a configured address must be set up first via the case
            detail.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="border-slate-700"
          onClick={() => loadData(true)}
          disabled={isDataLoading}
          title="Refresh cases"
        >
          <RefreshCw
            className={`h-4 w-4 ${isDataLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {(
          [
            {
              label: "Total Cases",
              value: cases.length,
              icon: CreditCard,
              color: "text-slate-300",
            },
            {
              label: "Address Configured",
              value: configuredCount,
              icon: CheckCircle2,
              color: "text-emerald-400",
            },
            {
              label: "Address Not Set",
              value: notConfiguredCount,
              icon: AlertCircle,
              color: "text-amber-400",
            },
          ] as const
        ).map(({ label, value, icon: Icon, color }) => (
          <Card
            key={label}
            className="bg-slate-900 border-slate-800 px-4 py-3 flex items-center gap-3"
          >
            <Icon className={`h-5 w-5 flex-shrink-0 ${color}`} />
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">
                {label}
              </p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter + Search bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(["all", "configured", "not-configured"] as DepositFilter[]).map(
          (f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                filter === f
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                  : "bg-transparent border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ),
        )}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input
            placeholder="Search name, email, case ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 bg-slate-900 border-slate-700 text-white text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="bg-slate-950 border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900">
              <TableRow className="hover:bg-slate-900 border-slate-800">
                <TableHead className="text-slate-400">Case ID</TableHead>
                <TableHead className="text-slate-400">User</TableHead>
                <TableHead className="text-slate-400">Email</TableHead>
                <TableHead className="text-slate-400">Deposit Address</TableHead>
                <TableHead className="text-slate-400">Network / Asset</TableHead>
                <TableHead className="text-slate-400 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDataLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i} className="border-slate-800 animate-pulse">
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-slate-800 rounded w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-slate-500"
                  >
                    No cases match your filter.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const ca = c as Case & {
                    depositAsset?: string;
                    depositNetwork?: string;
                  };
                  const hasAddress = !!ca.depositAddress;
                  return (
                    <TableRow
                      key={c.id}
                      className="border-slate-800 hover:bg-slate-900/60 transition-colors"
                    >
                      <TableCell className="font-mono text-xs text-amber-300">
                        {c.accessCode}
                      </TableCell>
                      <TableCell className="text-slate-100 font-medium text-sm">
                        {c.userName || <span className="text-slate-600 italic">Unknown</span>}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {c.userEmail}
                      </TableCell>
                      <TableCell>
                        {hasAddress ? (
                          <div className="flex items-center gap-1.5">
                            <Wallet className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                            <span className="font-mono text-xs text-emerald-300 break-all">
                              {ca.depositAddress}
                            </span>
                          </div>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs">
                            Not configured
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {ca.depositAsset || ca.depositNetwork ? (
                          <span>
                            {ca.depositAsset}
                            {ca.depositAsset && ca.depositNetwork ? " / " : ""}
                            {ca.depositNetwork}
                          </span>
                        ) : (
                          <span className="text-slate-600 italic">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-700/50 text-amber-400 hover:text-amber-200 hover:border-amber-600 h-7 px-2 text-xs"
                            onClick={() => openComposer(c)}
                            title="Send deposit receipt request email to user"
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Request
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-700 text-slate-300 hover:text-white h-7 px-2 text-xs"
                            onClick={() => openReceiptsDialog(c)}
                            title="View submitted receipts for this case"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Receipts
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {!isDataLoading && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-800">
            <p className="text-xs text-slate-600">
              Showing {filtered.length} of {cases.length} cases
            </p>
          </div>
        )}
      </Card>

      {/* Email Composer Dialog */}
      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-amber-400" />
              Request Deposit Receipt
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Send an email to{" "}
              <span className="text-slate-200 font-medium">
                {composerCase?.userName || composerCase?.userEmail}
              </span>{" "}
              (case {composerCase?.accessCode}) requesting them to upload their
              deposit receipt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs uppercase tracking-wider">
                Amount
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="750"
                className={`bg-slate-900 text-white ${!amountValid && depositAmount !== "" ? "border-rose-500/70 focus:ring-rose-500/30" : "border-slate-700"}`}
              />
              {!amountValid && depositAmount !== "" && (
                <p className="text-rose-400 text-xs">Enter a valid positive number (e.g. 750)</p>
              )}
              {depositAmount === "" && (
                <p className="text-amber-400/70 text-xs">Amount is required before applying a template</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs uppercase tracking-wider">
                  Coin
                </Label>
                <select
                  value={depositCoin}
                  onChange={(e) => setDepositCoin(e.target.value)}
                  className="w-full h-9 text-sm bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                >
                  {DEPOSIT_COINS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs uppercase tracking-wider">
                  Network
                </Label>
                <select
                  value={depositNetwork}
                  onChange={(e) => setDepositNetwork(e.target.value)}
                  className="w-full h-9 text-sm bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                >
                  {DEPOSIT_NETWORKS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
            {networkMismatch && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-rose-500/8 border border-rose-500/25">
                <AlertCircle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-rose-300 text-xs leading-relaxed">
                  <span className="font-semibold">Network mismatch:</span> {depositCoin} is not typically sent on the {depositNetwork} network. Double-check before sending — a wrong network pairing causes lost funds.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs uppercase tracking-wider">
                Quick Templates
              </Label>
              <select
                value={selectedTemplate}
                onChange={(e) => applyTemplate(e.target.value, composerCase, depositCoin, depositNetwork, depositAmount)}
                className="w-full h-9 text-sm bg-slate-900 border border-slate-700 text-white rounded-md px-2.5 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-colors"
              >
                <option value="">— Select a template to auto-fill —</option>
                {composerCase && (
                  <optgroup label="Built-in">
                    {buildPortalRefreshTemplates(composerCase, depositCoin, depositNetwork, depositAmount).map((tpl, i) => (
                      <option key={i} value={String(i)}>
                        {tpl.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {savedTemplates.length > 0 && (
                  <optgroup label="Saved Templates">
                    {savedTemplates.map((tpl, i) => (
                      <option key={tpl.id} value={`saved:${i}`}>
                        {tpl.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            {templateStale && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                <p className="text-amber-300 text-xs">
                  <span className="font-semibold">Template is stale</span> — you changed the amount, coin, or network after applying a template. Re-apply a template to update the body, or edit it manually.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs uppercase tracking-wider">
                Subject
              </Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs uppercase tracking-wider">
                Message
              </Label>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={12}
                className="bg-slate-900 border-slate-700 text-white text-sm font-mono resize-none"
              />
            </div>

            {/* Admin guidance note */}
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Before you send</p>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  </span>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    <span className="font-semibold text-slate-200">Confirm the deposit address is set</span> on this case before sending. It is embedded directly into the email body — if it is missing, the user will have no address to send funds to.
                  </p>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  </span>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    <span className="font-semibold text-slate-200">Match the coin and network to the address</span> you have configured — for example, a TRC20 address must pair with USDT on TRC20 (TRON). A mismatch will result in lost funds.
                  </p>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  </span>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    Use <span className="font-semibold text-slate-200">Access Window Renewal Required</span> for a first contact and <span className="font-semibold text-slate-200">Reminder</span> for follow-up if no receipt arrives within 48 hours. Do not send both on the same day.
                  </p>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  </span>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    The template states <span className="font-semibold text-slate-200">{depositAmount || "750"} {depositCoin} per declaration</span> on the <span className="font-semibold text-slate-200">{depositNetwork}</span> network. Review the body and confirm this matches what you intend before hitting Send.
                  </p>
                </li>
              </ul>
              {composerCase && !composerCase.depositAddress && (
                <div className="flex items-start gap-2.5 pt-1 border-t border-slate-700/50">
                  <AlertCircle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <p className="text-rose-300 text-xs leading-relaxed">
                    <span className="font-semibold">No deposit address on this case.</span> Add one in the case detail first — this email will be sent without a valid payment destination.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-700"
              onClick={() => setComposerOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-500 text-white"
              onClick={sendRequest}
              disabled={sending || !emailSubject.trim() || !emailBody.trim() || !amountValid}
            >
              {sending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
