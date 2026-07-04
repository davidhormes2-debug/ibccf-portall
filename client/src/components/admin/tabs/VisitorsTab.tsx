import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Activity,
  Globe2,
  ShieldAlert,
  Users,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Monitor,
  Fingerprint,
  Clock,
  Link2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Auth header helper — same shape used elsewhere in the admin UI.
function getAdminAuthHeader(): Record<string, string> {
  const token = sessionStorage.getItem("adminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------- Shared types ----------
//
// These mirror the shape of the rows the server returns, but only the
// fields the UI actually reads. Everything is optional/nullable because
// older rows may pre-date a forensic field.
interface PageTimelineEntry {
  path: string;
  title?: string;
  enteredAt: number;
  leftAt?: number;
  dwellMs?: number;
}

interface ActiveVisitor {
  id: number;
  visitorId: string;
  caseId?: string | null;
  currentPage?: string | null;
  pageTitle?: string | null;
  referrer?: string | null;
  ipAddress?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  isp?: string | null;
  asn?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  browserVersion?: string | null;
  os?: string | null;
  osVersion?: string | null;
  userAgent?: string | null;
  screenResolution?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  language?: string | null;
  timezone?: string | null;
  connectionType?: string | null;
  fingerprintHash?: string | null;
  pagesViewed?: string | null;
  pageViewCount?: number | null;
  pageTimeline?: string | null;
  riskScore?: number | null;
  riskFlags?: string | null;
  persona?: string | null;
  personaConfidence?: number | null;
  personaReasoning?: string | null;
  isIdle?: boolean | null;
  hasActiveChat?: boolean | null;
  engagementScore?: number | null;
  sessionStartedAt: string;
  lastHeartbeatAt: string;
}

interface VisitorHistoryRow extends ActiveVisitor {
  sessionEndedAt: string;
  sessionDuration?: number | null;
  hadChat?: boolean | null;
}

interface HistoryListResponse {
  rows: VisitorHistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

interface HistoryStatsResponse {
  days: number;
  totalSessions: number;
  uniqueIps: number;
  uniqueVisitors: number;
  topCountries: Array<{ country: string; count: number }>;
  topPersonas: Array<{ persona: string; count: number }>;
  avgRisk: number;
  highRiskCount: number;
}

// ---------- Helpers ----------
function safeJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function riskBadgeColor(score?: number | null): string {
  const s = score ?? 0;
  if (s >= 70) return "bg-red-500/20 text-red-300 border-red-500/40";
  if (s >= 40) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (s >= 15) return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
}

function personaLabel(persona?: string | null): string {
  if (!persona) return "Unknown";
  return persona.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDuration(seconds?: number | null): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDwell(ms?: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return formatDuration(Math.round(ms / 1000));
}

// ---------- Stats tiles (top of tab) ----------
function StatsTiles() {
  const { data, isLoading } = useQuery<HistoryStatsResponse>({
    queryKey: ["/api/admin/visit-history/stats", 7],
    queryFn: async () => {
      const r = await fetch("/api/admin/visit-history/stats?days=7", {
        headers: getAdminAuthHeader(),
      });
      if (!r.ok) throw new Error("stats failed");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const tiles = [
    {
      label: "Sessions (7d)",
      value: isLoading ? "—" : String(data?.totalSessions ?? 0),
      icon: Activity,
      color: "text-blue-300",
    },
    {
      label: "Unique IPs (7d)",
      value: isLoading ? "—" : String(data?.uniqueIps ?? 0),
      icon: Globe2,
      color: "text-emerald-300",
    },
    {
      label: "Top country",
      value: isLoading ? "—" : data?.topCountries?.[0]?.country ?? "—",
      icon: MapPin,
      color: "text-violet-300",
    },
    {
      label: "Avg risk / High-risk",
      value: isLoading
        ? "—"
        : `${data?.avgRisk ?? 0} / ${data?.highRiskCount ?? 0}`,
      icon: ShieldAlert,
      color: "text-amber-300",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Card key={t.label} className="bg-slate-900/60 border-slate-800">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-5 h-5 ${t.color}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400">{t.label}</div>
                <div className="text-lg font-semibold text-slate-100 truncate">
                  {t.value}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------- Live session-duration ticker ----------
// Updates every second so the admin sees an exact elapsed counter per row
// without waiting for the 15-second polling refetch.
function useLiveNow(): number {
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, []);
  return now;
}

// ---------- Live view ----------
function LiveVisitors({
  onSelectVisitor,
}: {
  onSelectVisitor: (v: ActiveVisitor) => void;
}) {
  const now = useLiveNow();
  const { data, isLoading, refetch, isFetching } = useQuery<ActiveVisitor[]>({
    queryKey: ["/api/visitors/active"],
    queryFn: async () => {
      const r = await fetch("/api/visitors/active", { headers: getAdminAuthHeader() });
      if (!r.ok) throw new Error("active failed");
      return r.json();
    },
    refetchInterval: 15_000,
  });

  const rows = data ?? [];

  return (
    <Card className="bg-slate-900/60 border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-slate-100 flex items-center gap-2 text-base">
          <Users className="w-4 h-4 text-blue-300" /> Active visitors{" "}
          <span className="text-xs text-slate-400">({rows.length})</span>
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="btn-refresh-active"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Visitor</th>
                <th className="text-left px-3 py-2">Page</th>
                <th className="text-left px-3 py-2">Geo</th>
                <th className="text-left px-3 py-2">Device</th>
                <th className="text-left px-3 py-2">Persona</th>
                <th className="text-left px-3 py-2">Risk</th>
                <th className="text-left px-3 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center text-slate-400 py-6">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500 py-6">
                    No active visitors right now.
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-slate-800 hover:bg-slate-800/40 cursor-pointer"
                    onClick={() => onSelectVisitor(v)}
                    data-testid={`row-active-visitor-${v.id}`}
                  >
                    <td className="px-3 py-2 text-slate-200 font-mono text-xs">
                      {v.visitorId.slice(0, 16)}…
                      {v.fingerprintHash && (
                        <div className="text-[10px] text-slate-500">
                          fp {v.fingerprintHash}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-200 max-w-[220px] truncate">
                      {v.currentPage ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {[v.city, v.country].filter(Boolean).join(", ") || v.ipAddress || "—"}
                      {v.isp && (
                        <div className="text-[10px] text-slate-500 truncate max-w-[180px]">
                          {v.isp}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {[v.browser, v.browserVersion].filter(Boolean).join(" ") || "—"}
                      <div className="text-[10px] text-slate-500">
                        {[v.os, v.osVersion].filter(Boolean).join(" ")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="bg-slate-800/60 border-slate-700 text-slate-200">
                        {personaLabel(v.persona)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={riskBadgeColor(v.riskScore)}>
                        {v.riskScore ?? 0}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      <div>
                        {formatDistanceToNow(new Date(v.sessionStartedAt), {
                          addSuffix: true,
                        })}
                      </div>
                      <div className="text-emerald-400 font-mono font-medium tabular-nums">
                        {formatDuration(
                          Math.floor((now - new Date(v.sessionStartedAt).getTime()) / 1000),
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- History view ----------
function HistoryVisitors({
  onSelectVisitor,
}: {
  onSelectVisitor: (v: VisitorHistoryRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [minRisk, setMinRisk] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 50;

  const { data, isLoading, refetch, isFetching } = useQuery<HistoryListResponse>({
    queryKey: ["/api/admin/visit-history", { search, minRisk, page }],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (search) params.set("search", search);
      if (minRisk > 0) params.set("minRisk", String(minRisk));
      const r = await fetch(`/api/admin/visit-history?${params.toString()}`, {
        headers: getAdminAuthHeader(),
      });
      if (!r.ok) throw new Error("history failed");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Card className="bg-slate-900/60 border-slate-800">
      <CardHeader className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <CardTitle className="text-slate-100 flex items-center gap-2 text-base">
          <Clock className="w-4 h-4 text-violet-300" /> Visit history{" "}
          <span className="text-xs text-slate-400">({total})</span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(0);
                  setSearch(searchInput.trim());
                }
              }}
              placeholder="IP, country, persona…"
              className="pl-7 h-8 w-56 bg-slate-950 border-slate-800 text-slate-200"
              data-testid="input-history-search"
            />
          </div>
          <select
            value={minRisk}
            onChange={(e) => {
              setPage(0);
              setMinRisk(Number(e.target.value));
            }}
            className="h-8 rounded-md bg-slate-950 border border-slate-800 text-slate-200 text-xs px-2"
            data-testid="select-min-risk"
          >
            <option value={0}>Any risk</option>
            <option value={15}>Risk ≥ 15</option>
            <option value={40}>Risk ≥ 40</option>
            <option value={70}>Risk ≥ 70</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">IP / Geo</th>
                <th className="text-left px-3 py-2">Device</th>
                <th className="text-left px-3 py-2">Persona</th>
                <th className="text-left px-3 py-2">Pages</th>
                <th className="text-left px-3 py-2">Duration</th>
                <th className="text-left px-3 py-2">Risk</th>
                <th className="text-left px-3 py-2">Chat</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 py-6">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-slate-500 py-6">
                    No matching sessions.
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-slate-800 hover:bg-slate-800/40 cursor-pointer"
                    onClick={() => onSelectVisitor(v)}
                    data-testid={`row-history-${v.id}`}
                  >
                    <td className="px-3 py-2 text-slate-300 text-xs">
                      {formatDistanceToNow(new Date(v.sessionStartedAt), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      <div className="font-mono text-xs">{v.ipAddress ?? "—"}</div>
                      <div className="text-[10px] text-slate-500">
                        {[v.city, v.country].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {[v.browser, v.os].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="bg-slate-800/60 border-slate-700 text-slate-200">
                        {personaLabel(v.persona)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{v.pageViewCount ?? 0}</td>
                    <td className="px-3 py-2 text-slate-300">{formatDuration(v.sessionDuration)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={riskBadgeColor(v.riskScore)}>
                        {v.riskScore ?? 0}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {v.hadChat ? "Yes" : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="btn-history-prev"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              data-testid="btn-history-next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Profile drawer ----------
function VisitorProfileDrawer({
  visitor,
  open,
  onOpenChange,
}: {
  visitor: ActiveVisitor | VisitorHistoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const timeline = useMemo(
    () => safeJsonArray<PageTimelineEntry>(visitor?.pageTimeline),
    [visitor?.pageTimeline],
  );
  const riskFlags = useMemo(
    () => safeJsonArray<{ flag: string; reason: string; weight?: number }>(visitor?.riskFlags),
    [visitor?.riskFlags],
  );
  const personaReasoning = useMemo(
    () => safeJsonArray<string>(visitor?.personaReasoning),
    [visitor?.personaReasoning],
  );
  const pagesViewed = useMemo(
    () => safeJsonArray<string>(visitor?.pagesViewed),
    [visitor?.pagesViewed],
  );

  if (!visitor) return null;

  const isHistory = "sessionEndedAt" in visitor;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-slate-950 border-slate-800 text-slate-100 w-full sm:max-w-2xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-slate-100 flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-blue-300" />
            Visitor profile
            <Badge variant="outline" className={riskBadgeColor(visitor.riskScore)}>
              risk {visitor.riskScore ?? 0}
            </Badge>
            <Badge variant="outline" className="bg-slate-800/60 border-slate-700">
              {personaLabel(visitor.persona)}
            </Badge>
          </SheetTitle>
          <SheetDescription className="text-slate-400 font-mono text-xs">
            {visitor.visitorId}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-5">
          {/* Identity / network */}
          <section>
            <h3 className="text-xs uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Globe2 className="w-3.5 h-3.5" /> Network &amp; geo
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <DT label="IP" value={visitor.ipAddress} mono />
              <DT
                label="Location"
                value={[visitor.city, visitor.region, visitor.country].filter(Boolean).join(", ")}
              />
              <DT label="ISP" value={visitor.isp} />
              <DT label="ASN" value={visitor.asn} mono />
              <DT label="Connection" value={visitor.connectionType} />
              <DT label="Timezone" value={visitor.timezone} />
            </dl>
          </section>

          {/* Device */}
          <section>
            <h3 className="text-xs uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Monitor className="w-3.5 h-3.5" /> Device
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <DT label="Type" value={visitor.deviceType} />
              <DT
                label="Browser"
                value={[visitor.browser, visitor.browserVersion].filter(Boolean).join(" ")}
              />
              <DT label="OS" value={[visitor.os, visitor.osVersion].filter(Boolean).join(" ")} />
              <DT label="Screen" value={visitor.screenResolution} />
              <DT label="Language" value={visitor.language} />
              <DT label="Fingerprint" value={visitor.fingerprintHash} mono />
            </dl>
            {visitor.userAgent && (
              <div className="mt-2 text-[11px] text-slate-500 font-mono break-all">
                {visitor.userAgent}
              </div>
            )}
          </section>

          {/* Referrer */}
          <section>
            <h3 className="text-xs uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" /> Referrer
            </h3>
            <div className="text-sm text-slate-200 break-all">
              {visitor.referrer || <span className="text-slate-500">Direct / none</span>}
            </div>
          </section>

          {/* Persona reasoning */}
          {personaReasoning.length > 0 && (
            <section>
              <h3 className="text-xs uppercase text-slate-400 mb-2">
                Persona reasoning ({visitor.personaConfidence ?? 0}% confidence)
              </h3>
              <ul className="text-sm text-slate-300 list-disc list-inside space-y-0.5">
                {personaReasoning.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Risk flags */}
          {riskFlags.length > 0 && (
            <section>
              <h3 className="text-xs uppercase text-slate-400 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> Risk flags
              </h3>
              <ul className="space-y-1 text-sm">
                {riskFlags.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5"
                  >
                    <Badge
                      variant="outline"
                      className="bg-red-500/10 border-red-500/40 text-red-300 text-[10px]"
                    >
                      {f.flag}
                      {typeof f.weight === "number" ? ` +${f.weight}` : ""}
                    </Badge>
                    <span className="text-slate-300">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Page timeline */}
          <section>
            <h3 className="text-xs uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Page timeline ({timeline.length || pagesViewed.length})
            </h3>
            {timeline.length > 0 ? (
              <ol className="space-y-1 text-sm border-l border-slate-800 pl-3">
                {timeline.map((entry, i) => (
                  <li key={i} className="text-slate-200">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs truncate">{entry.path}</span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {formatDwell(entry.dwellMs)}
                      </span>
                    </div>
                    {entry.title && (
                      <div className="text-[11px] text-slate-500 truncate">{entry.title}</div>
                    )}
                  </li>
                ))}
              </ol>
            ) : pagesViewed.length > 0 ? (
              <ol className="space-y-1 text-sm">
                {pagesViewed.map((p, i) => (
                  <li key={i} className="font-mono text-xs text-slate-300">
                    {p}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-sm text-slate-500">No page activity recorded.</div>
            )}
          </section>

          {/* Session timing */}
          <section>
            <h3 className="text-xs uppercase text-slate-400 mb-2">Session</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <DT
                label="Started"
                value={new Date(visitor.sessionStartedAt).toLocaleString()}
              />
              {isHistory ? (
                <>
                  <DT
                    label="Ended"
                    value={new Date((visitor as VisitorHistoryRow).sessionEndedAt).toLocaleString()}
                  />
                  <DT
                    label="Duration"
                    value={formatDuration((visitor as VisitorHistoryRow).sessionDuration)}
                  />
                  <DT
                    label="Had chat"
                    value={(visitor as VisitorHistoryRow).hadChat ? "Yes" : "No"}
                  />
                </>
              ) : (
                <>
                  <DT
                    label="Last heartbeat"
                    value={new Date(visitor.lastHeartbeatAt).toLocaleString()}
                  />
                  <DT label="Idle" value={visitor.isIdle ? "Yes" : "No"} />
                  <DT label="Active chat" value={visitor.hasActiveChat ? "Yes" : "No"} />
                </>
              )}
              <DT label="Engagement" value={String(visitor.engagementScore ?? 0)} />
              <DT label="Page views" value={String(visitor.pageViewCount ?? 0)} />
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DT({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-slate-500 text-xs">{label}</dt>
      <dd className={`text-slate-200 ${mono ? "font-mono text-xs" : ""} truncate`}>
        {value || <span className="text-slate-600">—</span>}
      </dd>
    </>
  );
}

// ---------- Outer tab ----------
export function VisitorsTab() {
  const [selected, setSelected] = useState<ActiveVisitor | VisitorHistoryRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // When the drawer is opened from a row click in the Live view, refresh
  // the row from the server every 30s so risk/persona stay current. We
  // do this via a follow-up query that targets the active endpoint by
  // visitorId. For history rows there's no need — the snapshot is fixed.
  const isLive =
    selected !== null && !("sessionEndedAt" in (selected as VisitorHistoryRow));

  useQuery<ActiveVisitor | undefined>({
    queryKey: ["/api/visitors", selected?.visitorId, "live"],
    queryFn: async () => {
      if (!selected) return undefined;
      const r = await fetch(`/api/visitors/${encodeURIComponent(selected.visitorId)}`, {
        headers: getAdminAuthHeader(),
      });
      if (!r.ok) return undefined;
      const updated = (await r.json()) as ActiveVisitor;
      setSelected(updated);
      return updated;
    },
    enabled: drawerOpen && isLive,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4" data-testid="visitors-tab">
      <StatsTiles />

      <Tabs defaultValue="live" className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="live" data-testid="tab-visitors-live">
            <Activity className="w-3.5 h-3.5 mr-1.5" /> Live
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-visitors-history">
            <Clock className="w-3.5 h-3.5 mr-1.5" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-3">
          <LiveVisitors
            onSelectVisitor={(v) => {
              setSelected(v);
              setDrawerOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <HistoryVisitors
            onSelectVisitor={(v) => {
              setSelected(v);
              setDrawerOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <VisitorProfileDrawer
        visitor={selected}
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

export default VisitorsTab;
