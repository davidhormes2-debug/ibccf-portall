import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Plus,
  Save,
  Trash2,
  RefreshCw,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LedgerEntry {
  id: number;
  caseId: string;
  direction: "credit" | "debit";
  amount: string;
  asset: string;
  category: string | null;
  entryDate: string;
  userVisible: boolean;
  userNote: string | null;
  adminNote: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface AdminLedgerResponse {
  entries: LedgerEntry[];
  computedTotal: string;
  currentBalance: string | null;
  lastSyncedTotal: string | null;
  manualOverrideActive: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string | null;
  caseLabel?: string;
  authToken: string | null;
}

interface DraftEntry {
  direction: "credit" | "debit";
  amount: string;
  asset: string;
  category: string;
  entryDate: string;
  userVisible: boolean;
  userNote: string;
  adminNote: string;
  notifyByEmail: boolean;
}

function toDatetimeLocal(value?: string | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeEmptyDraft(): DraftEntry {
  return {
    direction: "credit",
    amount: "",
    asset: "USDT",
    category: "",
    entryDate: toDatetimeLocal(),
    userVisible: false,
    userNote: "",
    adminNote: "",
    notifyByEmail: false,
  };
}

export function AdminCaseLedgerDialog({
  open,
  onOpenChange,
  caseId,
  caseLabel,
  authToken,
}: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<AdminLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftEntry>(makeEmptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<number | null>(null);

  const reset = () => {
    setDraft(makeEmptyDraft());
    setEditingId(null);
  };

  const load = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/ledger/admin`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to load ledger" });
        return;
      }
      const body = (await res.json()) as AdminLedgerResponse;
      setData(body);
    } catch {
      toast({ variant: "destructive", title: "Network error loading ledger" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && caseId) {
      reset();
      void load();
    }
  }, [open, caseId]);

  const buildBody = () => {
    let entryDateIso: string | null = null;
    if (draft.entryDate) {
      const parsed = new Date(draft.entryDate);
      if (!Number.isNaN(parsed.getTime())) entryDateIso = parsed.toISOString();
    }
    return {
      direction: draft.direction,
      amount: draft.amount.trim(),
      asset: draft.asset.trim() || "USDT",
      category: draft.category.trim() || null,
      entryDate: entryDateIso,
      userVisible: draft.userVisible,
      userNote: draft.userNote.trim() || null,
      adminNote: draft.adminNote.trim() || null,
      notifyByEmail: draft.notifyByEmail,
    };
  };

  const save = async () => {
    if (!caseId) return;
    if (!/^\d{1,12}(?:[.,]\d{1,4})?$/.test(draft.amount.trim())) {
      toast({
        variant: "destructive",
        title: "Invalid amount",
        description: "Use a number like 250.00 — no currency suffix.",
      });
      return;
    }
    setSaving(true);
    try {
      const url = editingId
        ? `/api/cases/${caseId}/ledger/${editingId}`
        : `/api/cases/${caseId}/ledger`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: editingId ? "Failed to update entry" : "Failed to create entry",
          description: body?.error,
        });
        return;
      }
      toast({
        title: editingId ? "Entry updated" : "Entry recorded",
        description: draft.notifyByEmail && !editingId ? "User notified by email." : undefined,
      });
      reset();
      await load();
    } catch {
      toast({ variant: "destructive", title: "Network error saving entry" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: LedgerEntry) => {
    setEditingId(entry.id);
    setDraft({
      direction: entry.direction,
      amount: entry.amount,
      asset: entry.asset,
      category: entry.category ?? "",
      entryDate: toDatetimeLocal(entry.entryDate),
      userVisible: entry.userVisible,
      userNote: entry.userNote ?? "",
      adminNote: entry.adminNote ?? "",
      notifyByEmail: false,
    });
  };

  const remove = async (entry: LedgerEntry) => {
    if (!caseId) return;
    if (!confirm(`Delete ${entry.direction} of ${entry.amount} ${entry.asset}?`)) return;
    setBusyEntryId(entry.id);
    try {
      const res = await fetch(`/api/cases/${caseId}/ledger/${entry.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to delete entry" });
        return;
      }
      toast({ title: "Entry deleted" });
      if (editingId === entry.id) reset();
      await load();
    } finally {
      setBusyEntryId(null);
    }
  };

  const syncBalance = async () => {
    if (!caseId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/ledger/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to sync balance" });
        return;
      }
      toast({ title: "Balance synced to ledger total" });
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-slate-800 max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-400" />
            Case Ledger {caseLabel ? `— ${caseLabel}` : ""}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Record credits and debits against this case. The displayed account
            balance auto-syncs to the ledger total while no manual override is
            active. This platform is display-only — no funds are moved.
          </DialogDescription>
        </DialogHeader>

        {/* Summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Ledger total
            </p>
            <p className="text-lg font-bold text-white">
              {data?.computedTotal || "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Displayed balance
            </p>
            <p className="text-lg font-bold text-white">
              {data?.currentBalance || "—"}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 flex flex-col justify-between">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Sync state
            </p>
            {data?.manualOverrideActive ? (
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-amber-300 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Manual override active
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10 h-7 text-xs"
                  onClick={syncBalance}
                  disabled={saving}
                  data-testid="button-sync-ledger"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Sync
                </Button>
              </div>
            ) : (
              <span className="text-emerald-300 text-xs font-semibold">In sync</span>
            )}
          </div>
        </div>

        {/* Draft form */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              {editingId ? (
                <>
                  <Save className="h-4 w-4 text-blue-400" /> Editing entry #{editingId}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 text-emerald-400" /> New entry
                </>
              )}
            </h4>
            {editingId && (
              <Button
                size="sm"
                variant="ghost"
                className="text-slate-400 hover:text-white h-7 text-xs"
                onClick={reset}
              >
                Cancel edit
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Direction</Label>
              <Select
                value={draft.direction}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, direction: v as "credit" | "debit" }))
                }
              >
                <SelectTrigger
                  className="bg-slate-900 border-slate-700 text-white"
                  data-testid="select-ledger-direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (+)</SelectItem>
                  <SelectItem value="debit">Debit (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Amount</Label>
              <Input
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                placeholder="250.00"
                className="bg-slate-900 border-slate-700 text-white font-mono"
                data-testid="input-ledger-amount"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Asset</Label>
              <Input
                value={draft.asset}
                onChange={(e) => setDraft((d) => ({ ...d, asset: e.target.value }))}
                placeholder="USDT"
                className="bg-slate-900 border-slate-700 text-white"
                data-testid="input-ledger-asset"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Category (optional)</Label>
              <Input
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                placeholder="fee, refund, …"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-400">Entry date</Label>
            <Input
              type="datetime-local"
              value={draft.entryDate}
              onChange={(e) => setDraft((d) => ({ ...d, entryDate: e.target.value }))}
              className="bg-slate-900 border-slate-700 text-white max-w-xs"
              data-testid="input-ledger-entry-date"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">User-facing note</Label>
              <Textarea
                value={draft.userNote}
                onChange={(e) => setDraft((d) => ({ ...d, userNote: e.target.value }))}
                placeholder="Visible to the case holder when user-visible is on."
                className="bg-slate-900 border-slate-700 text-white min-h-[64px]"
                data-testid="textarea-ledger-user-note"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Admin-only note</Label>
              <Textarea
                value={draft.adminNote}
                onChange={(e) => setDraft((d) => ({ ...d, adminNote: e.target.value }))}
                placeholder="Officer-only context — never exposed to the portal."
                className="bg-slate-900 border-slate-700 text-white min-h-[64px]"
                data-testid="textarea-ledger-admin-note"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.userVisible}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, userVisible: v }))}
                data-testid="switch-ledger-visible"
              />
              <span className="text-sm text-slate-300">Show to user</span>
            </div>
            {!editingId && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.notifyByEmail}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, notifyByEmail: v }))}
                  data-testid="switch-ledger-notify"
                />
                <span className="text-sm text-slate-300">Notify by email</span>
              </div>
            )}
            <div className="ml-auto">
              <Button
                onClick={save}
                disabled={saving || !draft.amount.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-ledger-save"
              >
                {editingId ? <Save className="h-4 w-4 mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                {editingId ? "Save changes" : "Add entry"}
              </Button>
            </div>
          </div>
        </div>

        {/* Existing entries */}
        <div className="mt-3">
          <h4 className="text-sm font-semibold text-white mb-2">
            Existing entries{" "}
            <span className="text-slate-500 font-normal">
              ({data?.entries.length ?? 0})
            </span>
          </h4>
          <ScrollArea className="h-[280px] rounded-lg border border-slate-800">
            {loading ? (
              <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
            ) : !data || data.entries.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                No ledger entries recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {data.entries.map((e) => (
                  <div
                    key={e.id}
                    className="p-3 flex items-start gap-3 hover:bg-slate-900/40"
                    data-testid={`ledger-entry-${e.id}`}
                  >
                    <div className="mt-0.5">
                      {e.direction === "credit" ? (
                        <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <ArrowDownLeft className="h-4 w-4 text-rose-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-mono text-sm font-semibold ${
                            e.direction === "credit" ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {e.direction === "credit" ? "+" : "−"}
                          {e.amount} {e.asset}
                        </span>
                        {e.category && (
                          <Badge
                            variant="outline"
                            className="border-slate-700 text-slate-300 text-[10px]"
                          >
                            {e.category}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] gap-1 ${
                            e.userVisible
                              ? "border-blue-500/40 text-blue-300"
                              : "border-slate-700 text-slate-500"
                          }`}
                        >
                          {e.userVisible ? (
                            <>
                              <Eye className="h-3 w-3" /> User
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3 w-3" /> Admin
                            </>
                          )}
                        </Badge>
                      </div>
                      {e.userNote && (
                        <p className="text-xs text-slate-300 mt-1">{e.userNote}</p>
                      )}
                      {e.adminNote && (
                        <p className="text-xs text-amber-300/80 mt-1">
                          Admin: {e.adminNote}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-500 mt-1">
                        {new Date(e.entryDate).toLocaleString()}
                        {e.createdBy ? ` · ${e.createdBy}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 h-7 px-2 text-xs"
                        onClick={() => startEdit(e)}
                        data-testid={`button-edit-ledger-${e.id}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-7 px-2 text-xs"
                        onClick={() => remove(e)}
                        disabled={busyEntryId === e.id}
                        data-testid={`button-delete-ledger-${e.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
