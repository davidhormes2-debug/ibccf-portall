import { useState, useMemo, useEffect, useRef } from "react";
import { useAdminDashboard } from "../AdminDashboardContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Megaphone,
  Send,
  Users,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Trash2,
  Loader2,
  Search,
  Clock,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

const ADMIN_TOKEN_KEY = "adminToken";

function authHeaders(): HeadersInit {
  // Admin token is persisted in sessionStorage by AdminDashboard.tsx — match
  // the convention used by every other admin tab so authenticated requests
  // actually carry the Bearer token.
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface Recipient {
  id: string;
  name: string;
  email: string;
  accessCode: string;
}

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "critical";
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

const TYPE_META: Record<
  Announcement["type"],
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  info: { label: "Info", color: "bg-blue-500/15 text-blue-300 border-blue-500/30", icon: Info },
  success: { label: "Success", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: CheckCircle },
  warning: { label: "Warning", color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: AlertTriangle },
  critical: { label: "Critical", color: "bg-red-500/15 text-red-300 border-red-500/30", icon: AlertCircle },
};

export default function CommunicationsTab() {
  return (
    <div className="space-y-6">
      <ActiveWarningsPanel />
      <Tabs defaultValue="email" className="space-y-6">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="email" data-testid="tab-comms-email">
            <Mail className="w-4 h-4 mr-2" /> Email Users
          </TabsTrigger>
          <TabsTrigger value="bulk" data-testid="tab-comms-bulk">
            <Users className="w-4 h-4 mr-2" /> Broadcast
          </TabsTrigger>
          <TabsTrigger value="announcements" data-testid="tab-comms-announcements">
            <Megaphone className="w-4 h-4 mr-2" /> Announcements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <EmailUserPanel />
        </TabsContent>
        <TabsContent value="bulk">
          <BulkBroadcastPanel />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Active portal warnings summary ---------------- */

interface ActiveWarningCase {
  id: string;
  accessCode: string;
  userName: string;
  userEmail: string | null;
  portalWarningAt: string;
  portalWarningMinutes: number;
  expiresAt: string;
  msLeft: number;
}

interface ActiveWarningsData {
  count: number;
  cases: ActiveWarningCase[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (days > 0) return `${pad(days)}d ${pad(hours)}h ${pad(m)}m`;
  if (hours > 0) return `${pad(hours)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}m ${pad(s)}s`;
}

const NEAR_EXPIRY_MS = 60 * 60 * 1000;

function WarningRow({ w }: { w: ActiveWarningCase }) {
  const [msLeft, setMsLeft] = useState<number>(w.msLeft);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const expiresAt = new Date(w.expiresAt).getTime();
    function tick() {
      setMsLeft(Math.max(0, expiresAt - Date.now()));
    }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [w.expiresAt]);

  const isNearExpiry = msLeft <= NEAR_EXPIRY_MS && msLeft > 0;
  const isExpired = msLeft === 0;

  function openCase() {
    if (typeof (window as any).__adminOpenCase === "function") {
      (window as any).__adminOpenCase(w.accessCode);
    }
  }

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm ${
        isExpired
          ? "border-red-500/30 bg-red-500/5"
          : isNearExpiry
          ? "border-amber-500/30 bg-amber-500/8"
          : "border-slate-700/60 bg-slate-900/40"
      }`}
      data-testid={`active-warning-row-${w.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-100 truncate">{w.userName}</span>
          <span className="text-[10px] font-mono text-blue-300 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded shrink-0">
            {w.accessCode}
          </span>
          {isNearExpiry && !isExpired && (
            <Badge className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
              Near Expiry
            </Badge>
          )}
          {isExpired && (
            <Badge className="text-[10px] bg-red-500/15 text-red-300 border border-red-500/30 shrink-0">
              Expired
            </Badge>
          )}
        </div>
        {w.userEmail && (
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{w.userEmail}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div
          className={`text-xs font-mono tabular-nums ${
            isExpired ? "text-red-400" : isNearExpiry ? "text-amber-300" : "text-slate-300"
          }`}
        >
          <Clock className="inline h-3 w-3 mr-1 opacity-70" />
          {isExpired ? "Expired" : formatCountdown(msLeft)}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openCase}
          className="h-6 px-2 text-[10px] text-slate-400 hover:text-slate-100 hover:bg-slate-700/60"
          data-testid={`button-open-case-${w.id}`}
          title={`Open case ${w.accessCode}`}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open
        </Button>
      </div>
    </div>
  );
}

function ActiveWarningsPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<ActiveWarningsData>({
    queryKey: ["/api/cases/active-warnings"],
    queryFn: async () => {
      const r = await fetch("/api/cases/active-warnings", {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const count = data?.count ?? 0;
  const warnings = data?.cases ?? [];
  const nearExpiryCount = warnings.filter(
    (w) => w.msLeft <= NEAR_EXPIRY_MS && w.msLeft > 0,
  ).length;

  return (
    <Card
      className="border p-4 space-y-3"
      style={{
        background:
          count > 0 ? "rgba(120,53,15,0.10)" : "rgba(15,23,42,0.40)",
        borderColor:
          count > 0 ? "rgba(245,158,11,0.30)" : "rgba(51,65,85,0.50)",
      }}
      data-testid="panel-active-warnings-summary"
    >
      <div className="flex items-center gap-2">
        <div
          className="h-6 w-6 rounded flex items-center justify-center shrink-0"
          style={{
            background:
              count > 0 ? "rgba(245,158,11,0.18)" : "rgba(100,116,139,0.15)",
          }}
        >
          <AlertTriangle
            className="h-3.5 w-3.5"
            style={{ color: count > 0 ? "#fbbf24" : "#64748b" }}
          />
        </div>
        <h4 className="text-sm font-semibold text-slate-100 uppercase tracking-wide flex-1">
          Active Portal Warnings
        </h4>
        {count > 0 && (
          <Badge
            className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs"
            data-testid="badge-active-warnings-count"
          >
            {count} active
          </Badge>
        )}
        {nearExpiryCount > 0 && (
          <Badge
            className="bg-red-500/20 text-red-300 border border-red-500/40 text-xs"
            data-testid="badge-near-expiry-count"
          >
            {nearExpiryCount} near expiry
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          data-testid="button-refresh-active-warnings"
          aria-label="Refresh active warnings"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : count === 0 ? (
        <p className="text-xs text-slate-500 py-1">
          No active portal closure warnings. Open a case and go to its Communications tab to send a warning.
        </p>
      ) : (
        <div className="space-y-1.5">
          {warnings.map((w) => (
            <WarningRow key={w.id} w={w} />
          ))}
          <p className="text-[10px] text-slate-600 pt-1">
            To manage a warning, open the case from the Cases tab and go to the Communications tab.
            Refreshes every 30 seconds.
          </p>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Email a single user ---------------- */

function EmailUserPanel() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedEmail, setSelectedEmail] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const { data: recipients = [], isLoading } = useQuery<Recipient[]>({
    queryKey: ["/api/admin/communications/recipients"],
    queryFn: async () => {
      const r = await fetch("/api/admin/communications/recipients", {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients.slice(0, 50);
    return recipients
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.accessCode.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [recipients, search]);

  const send = useMutation({
    mutationFn: async () => {
      const to = manualEmail.trim() || selectedEmail.trim();
      if (!to) throw new Error("Pick a recipient or enter an email");
      const r = await fetch("/api/admin/communications/email-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Send failed");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: "The user has been notified." });
      setSubject("");
      setBody("");
      setManualEmail("");
      setSelectedEmail("");
    },
    onError: (e: Error) =>
      toast({
        title: "Could not send",
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <Card className="bg-slate-950 border-slate-800 p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <Mail className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Email a User</h3>
          <p className="text-sm text-slate-400">
            Send a one-off branded email to any case-holder.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <Label className="text-slate-300">Recipient</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search by name, email, or access code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-slate-900 border-slate-700 text-white"
              data-testid="input-recipient-search"
            />
          </div>

          <div
            className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/60 divide-y divide-slate-800"
            data-testid="list-recipients"
          >
            {isLoading ? (
              <div className="p-4 text-center text-slate-500 text-sm">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No matches</div>
            ) : (
              filtered.map((r) => {
                const isSelected = selectedEmail === r.email;
                return (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => {
                      setSelectedEmail(r.email);
                      setManualEmail("");
                    }}
                    className={`w-full text-left px-3 py-2.5 hover:bg-slate-800/60 transition-colors ${
                      isSelected ? "bg-blue-600/20" : ""
                    }`}
                    data-testid={`recipient-${r.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{r.name}</p>
                        <p className="text-xs text-slate-400 truncate">{r.email}</p>
                      </div>
                      <span className="text-[10px] text-blue-300 font-mono shrink-0">
                        {r.accessCode}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Or enter an email manually</Label>
            <Input
              type="email"
              placeholder="someone@example.com"
              value={manualEmail}
              onChange={(e) => {
                setManualEmail(e.target.value);
                if (e.target.value) setSelectedEmail("");
              }}
              className="mt-1 bg-slate-900 border-slate-700 text-white"
              data-testid="input-manual-email"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-slate-300">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Update on your case"
              maxLength={200}
              className="bg-slate-900 border-slate-700 text-white"
              data-testid="input-email-subject"
            />
          </div>
          <div>
            <Label className="text-slate-300">Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message — basic HTML is supported (paragraphs, bold, links)…"
              rows={9}
              className="bg-slate-900 border-slate-700 text-white resize-none"
              data-testid="input-email-body"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Wrapped in the IBCCF premium branded shell automatically.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {(manualEmail || selectedEmail) ? `→ ${manualEmail || selectedEmail}` : "No recipient selected"}
            </p>
            <Button
              onClick={() => send.mutate()}
              disabled={send.isPending || !subject || !body || !(manualEmail || selectedEmail)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500"
              data-testid="button-send-email"
            >
              {send.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Email
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Bulk broadcast ---------------- */

function BulkBroadcastPanel() {
  const { toast } = useToast();
  const { adminRole } = useAdminDashboard();
  const canSendBulk = adminRole === "admin" || adminRole === "super_admin";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [lastResult, setLastResult] = useState<{
    sent: number;
    failed: number;
    total: number;
  } | null>(null);

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/admin/communications/recipients"],
    queryFn: async () => {
      const r = await fetch("/api/admin/communications/recipients", {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      if (!testEmail.trim()) throw new Error("Enter a test email");
      const r = await fetch("/api/admin/communications/email-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ subject, body, testTo: testEmail }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Send failed");
      return data;
    },
    onSuccess: () =>
      toast({
        title: "Test sent",
        description: `Preview delivered to ${testEmail}.`,
      }),
    onError: (e: Error) =>
      toast({
        title: "Test failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const sendBulk = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/communications/email-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ subject, body, confirmBroadcast: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Broadcast failed");
      return data;
    },
    onSuccess: (data: { sent: number; failed: number; total: number }) => {
      setLastResult(data);
      setConfirm(false);
      toast({
        title: "Broadcast complete",
        description: `${data.sent}/${data.total} delivered${
          data.failed ? `, ${data.failed} failed` : ""
        }.`,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Broadcast failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <Card className="bg-slate-950 border-slate-800 p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Broadcast to All Users</h3>
          <p className="text-sm text-slate-400">
            Send a single branded email to every case-holder with an email on file.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
        <Users className="w-5 h-5 text-amber-400 shrink-0" />
        <p className="text-sm text-amber-200">
          Currently <strong>{recipients.length}</strong> recipient
          {recipients.length === 1 ? "" : "s"} on file. Always send a test first.
        </p>
      </div>

      {canSendBulk ? (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <Label className="text-slate-300">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Important update from IBCCF"
                maxLength={200}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-bulk-subject"
              />
            </div>
            <div>
              <Label className="text-slate-300">Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write the broadcast message — basic HTML supported…"
                rows={9}
                className="bg-slate-900 border-slate-700 text-white resize-none"
                data-testid="input-bulk-body"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <Label className="text-slate-300 text-sm font-semibold">
                Send a test first
              </Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="input-bulk-test-email"
                />
                <Button
                  variant="outline"
                  onClick={() => sendTest.mutate()}
                  disabled={sendTest.isPending || !subject || !body || !testEmail}
                  className="border-slate-700 text-slate-200 hover:bg-slate-800"
                  data-testid="button-bulk-test"
                >
                  {sendTest.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
              <Label className="text-red-300 text-sm font-semibold">
                Send to everyone
              </Label>
              <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                  className="mt-0.5"
                  data-testid="checkbox-bulk-confirm"
                />
                <span>
                  I understand this will email <strong>{recipients.length}</strong>{" "}
                  user{recipients.length === 1 ? "" : "s"}.
                </span>
              </label>
              <Button
                onClick={() => sendBulk.mutate()}
                disabled={
                  sendBulk.isPending ||
                  !subject ||
                  !body ||
                  !confirm ||
                  recipients.length === 0
                }
                className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500"
                data-testid="button-bulk-send"
              >
                {sendBulk.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" /> Send to {recipients.length}{" "}
                    recipient{recipients.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>

            {lastResult && (
              <div
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200"
                data-testid="bulk-result"
              >
                Last broadcast: <strong>{lastResult.sent}</strong>/
                {lastResult.total} delivered
                {lastResult.failed ? (
                  <span className="text-red-300"> · {lastResult.failed} failed</span>
                ) : null}
                .
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 italic" data-testid="bulk-email-viewer-notice">
          Your role does not permit sending bulk emails.
        </p>
      )}
    </Card>
  );
}

/* ---------------- Announcements ---------------- */

function AnnouncementsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<Announcement["type"]>("info");
  const [active, setActive] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");

  const { data: items = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/admin/communications/announcements"],
    queryFn: async () => {
      const r = await fetch("/api/admin/communications/announcements", {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/communications/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          title,
          message,
          type,
          active,
          expiresAt: expiresAt
            ? new Date(expiresAt).toISOString()
            : null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/communications/announcements"] });
      qc.invalidateQueries({ queryKey: ["/api/announcements/active"] });
      setTitle("");
      setMessage("");
      setType("info");
      setActive(true);
      setExpiresAt("");
      toast({ title: "Announcement published" });
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to publish",
        description: e.message,
        variant: "destructive",
      }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const r = await fetch(
        `/api/admin/communications/announcements/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ active: next }),
        },
      );
      if (!r.ok) throw new Error((await r.json())?.error || "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/communications/announcements"] });
      qc.invalidateQueries({ queryKey: ["/api/announcements/active"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(
        `/api/admin/communications/announcements/${id}`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!r.ok) throw new Error((await r.json())?.error || "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/communications/announcements"] });
      qc.invalidateQueries({ queryKey: ["/api/announcements/active"] });
      toast({ title: "Announcement removed" });
    },
  });

  return (
    <div className="space-y-6">
      <Card className="bg-slate-950 border-slate-800 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Publish Announcement</h3>
            <p className="text-sm text-slate-400">
              Shown as a banner across every portal page until removed or expired.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <Label className="text-slate-300">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Scheduled maintenance"
                maxLength={120}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-announcement-title"
              />
            </div>
            <div>
              <Label className="text-slate-300">Message</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Brief message users will see in the banner…"
                rows={4}
                maxLength={2000}
                className="bg-slate-900 border-slate-700 text-white resize-none"
                data-testid="input-announcement-message"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-slate-300">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as Announcement["type"])}
              >
                <SelectTrigger
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="select-announcement-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info (blue)</SelectItem>
                  <SelectItem value="success">Success (green)</SelectItem>
                  <SelectItem value="warning">Warning (amber)</SelectItem>
                  <SelectItem value="critical">Critical (red)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300">Expires (optional)</Label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-announcement-expires"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div>
                <p className="text-sm text-white font-medium">Active immediately</p>
                <p className="text-xs text-slate-400">
                  Off keeps it as a draft.
                </p>
              </div>
              <Switch
                checked={active}
                onCheckedChange={setActive}
                data-testid="switch-announcement-active"
              />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !title || !message}
              className="w-full bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500"
              data-testid="button-publish-announcement"
            >
              {create.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Megaphone className="w-4 h-4 mr-2" />
              )}
              Publish
            </Button>
          </div>
        </div>
      </Card>

      <Card className="bg-slate-950 border-slate-800 p-6">
        <h4 className="text-base font-bold text-white mb-4">All Announcements</h4>
        {isLoading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-slate-500 text-sm">No announcements yet.</p>
        ) : (
          <div className="space-y-3" data-testid="announcements-list">
            {items.map((a) => {
              const meta = TYPE_META[a.type];
              const Icon = meta.icon;
              const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-4 p-4 rounded-lg border border-slate-800 bg-slate-900/40"
                  data-testid={`announcement-${a.id}`}
                >
                  <div className="shrink-0">
                    <Badge className={`${meta.color} border`}>
                      <Icon className="w-3 h-3 mr-1" />
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{a.title}</p>
                    <p className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">
                      {a.message}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-2">
                      Created {new Date(a.createdAt).toLocaleString()}
                      {a.createdBy ? ` · by ${a.createdBy}` : ""}
                      {a.expiresAt
                        ? ` · expires ${new Date(a.expiresAt).toLocaleString()}`
                        : ""}
                      {expired ? " · EXPIRED" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      checked={a.active}
                      onCheckedChange={(next) => toggle.mutate({ id: a.id, next })}
                      data-testid={`toggle-announcement-${a.id}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Delete this announcement?")) remove.mutate(a.id);
                      }}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      data-testid={`delete-announcement-${a.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
