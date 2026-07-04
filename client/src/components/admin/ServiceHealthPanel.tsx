import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HelpCircle,
  Loader2,
  Mail,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProbeStatus = "ok" | "degraded" | "unconfigured";

type AiProbeLabel =
  | "models"
  | "completion"
  | "models→completion-fallback";

interface ProbeResult {
  status: ProbeStatus;
  error?: string;
}

interface AiProbeResult extends ProbeResult {
  probe?: AiProbeLabel;
}

interface HealthReport {
  db: ProbeResult;
  smtp: ProbeResult;
  ai: AiProbeResult;
  recentEmailFailures: number;
  uptime: number;
  version: string;
}

interface TimingSetting {
  minutes: number;
  source: "env" | "db" | "default";
  envOverride: boolean;
  min: number;
  max: number;
  default: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(result: ProbeResult) {
  if (result.status === "ok") {
    return (
      <Badge
        className="bg-green-500/20 text-green-300 border-green-500/30"
        data-testid="badge-status-ok"
      >
        <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden />
        OK
      </Badge>
    );
  }
  if (result.status === "unconfigured") {
    return (
      <Badge
        className="bg-slate-600/40 text-slate-300 border-slate-500/30"
        data-testid="badge-status-unconfigured"
      >
        <HelpCircle className="h-3 w-3 mr-1" aria-hidden />
        Unconfigured
      </Badge>
    );
  }
  return (
    <Badge
      className="bg-red-500/20 text-red-300 border-red-500/30"
      data-testid="badge-status-degraded"
    >
      <AlertTriangle className="h-3 w-3 mr-1" aria-hidden />
      Degraded
    </Badge>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const REFRESH_INTERVAL_MS = 60_000;

// ─── Probe timing setting row ─────────────────────────────────────────────────

function ProbeTimingRow({
  label,
  setting,
  onSave,
  saving,
  saveError,
  saveOk,
  "data-testid": testId,
}: {
  label: string;
  setting: TimingSetting | null;
  onSave: (minutes: number) => void;
  saving: boolean;
  saveError: string | null;
  saveOk: boolean;
  "data-testid"?: string;
}) {
  const [draft, setDraft] = useState<string>("");

  useEffect(() => {
    if (setting) setDraft(String(setting.minutes));
  }, [setting?.minutes]);

  if (!setting) return null;

  const parsed = Number(draft);
  const isValid =
    Number.isFinite(parsed) &&
    Number.isInteger(parsed) &&
    parsed >= setting.min &&
    parsed <= setting.max;
  const unchanged = parsed === setting.minutes;

  return (
    <Card
      className="bg-slate-900/50 border-slate-800"
      data-testid={testId}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-white text-sm">
          <Clock className="h-4 w-4 text-slate-400" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Label
              htmlFor={`${testId}-input`}
              className="text-xs text-slate-400 mb-1 block"
            >
              Minutes ({setting.min}–{setting.max})
            </Label>
            <Input
              id={`${testId}-input`}
              type="number"
              min={setting.min}
              max={setting.max}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={setting.envOverride || saving}
              className="bg-slate-800 border-slate-700 text-white h-8 w-28"
              data-testid={`${testId}-input`}
            />
          </div>
          <Button
            size="sm"
            onClick={() => onSave(parsed)}
            disabled={!isValid || unchanged || setting.envOverride || saving}
            className="mt-5"
            data-testid={`${testId}-save`}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>

        {/* Source badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {setting.source === "env" && (
            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
              Env override active
            </Badge>
          )}
          {setting.source === "db" && (
            <Badge className="bg-slate-600/40 text-slate-300 border-slate-500/30 text-xs">
              DB
            </Badge>
          )}
          {setting.source === "default" && (
            <Badge className="bg-slate-700/40 text-slate-400 border-slate-600/30 text-xs">
              Default
            </Badge>
          )}
          {setting.envOverride && (
            <span className="text-xs text-slate-500">
              Set <code className="font-mono">HEALTH_PROBE_{label.includes("Interval") ? "INTERVAL" : "ALERT_COOLDOWN"}_MINUTES</code> to override via env
            </span>
          )}
          {setting.updatedBy && (
            <span className="text-xs text-slate-500 ml-auto">
              Last set by {setting.updatedBy}
            </span>
          )}
        </div>

        {saveError && (
          <p className="text-xs text-red-400" data-testid={`${testId}-error`}>
            {saveError}
          </p>
        )}
        {saveOk && (
          <p className="text-xs text-green-400" data-testid={`${testId}-ok`}>
            Saved
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function ServiceHealthPanel({ onBack }: { onBack: () => void }) {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Probe timing settings state ───────────────────────────────────────────
  const [intervalSetting, setIntervalSetting] = useState<TimingSetting | null>(null);
  const [cooldownSetting, setCooldownSetting] = useState<TimingSetting | null>(null);
  const [intervalSaving, setIntervalSaving] = useState(false);
  const [intervalSaveError, setIntervalSaveError] = useState<string | null>(null);
  const [intervalSaveOk, setIntervalSaveOk] = useState(false);
  const [cooldownSaving, setCooldownSaving] = useState(false);
  const [cooldownSaveError, setCooldownSaveError] = useState<string | null>(null);
  const [cooldownSaveOk, setCooldownSaveOk] = useState(false);

  const fetchHealth = async (manual = false) => {
    if (manual) setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/health");
      if (!res.ok && res.status !== 503) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const data: HealthReport = await res.json();
      setHealth(data);
      setLastFetched(new Date());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const fetchTimingSettings = async () => {
    try {
      const [intervalRes, cooldownRes] = await Promise.all([
        fetch("/api/admin/settings/health-probe-interval"),
        fetch("/api/admin/settings/health-probe-alert-cooldown"),
      ]);
      if (intervalRes.ok) setIntervalSetting(await intervalRes.json());
      if (cooldownRes.ok) setCooldownSetting(await cooldownRes.json());
    } catch {
      // best-effort, don't block the health panel
    }
  };

  useEffect(() => {
    fetchHealth();
    void fetchTimingSettings();
    intervalRef.current = setInterval(() => fetchHealth(), REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  const saveInterval = async (minutes: number) => {
    setIntervalSaving(true);
    setIntervalSaveError(null);
    setIntervalSaveOk(false);
    try {
      const res = await fetch("/api/admin/settings/health-probe-interval", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setIntervalSaveError(body.error ?? `HTTP ${res.status}`);
      } else {
        const updated: TimingSetting = await res.json();
        setIntervalSetting(updated);
        setIntervalSaveOk(true);
        setTimeout(() => setIntervalSaveOk(false), 3000);
      }
    } catch (err) {
      setIntervalSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIntervalSaving(false);
    }
  };

  const saveCooldown = async (minutes: number) => {
    setCooldownSaving(true);
    setCooldownSaveError(null);
    setCooldownSaveOk(false);
    try {
      const res = await fetch("/api/admin/settings/health-probe-alert-cooldown", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCooldownSaveError(body.error ?? `HTTP ${res.status}`);
      } else {
        const updated: TimingSetting = await res.json();
        setCooldownSetting(updated);
        setCooldownSaveOk(true);
        setTimeout(() => setCooldownSaveOk(false), 3000);
      }
    } catch (err) {
      setCooldownSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCooldownSaving(false);
    }
  };

  const anyDegraded =
    health &&
    (health.db.status === "degraded" ||
      health.smtp.status === "degraded" ||
      health.ai.status === "degraded");

  return (
    <div data-testid="service-health-panel">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-slate-400"
          data-testid="btn-health-back"
        >
          <X className="h-4 w-4 mr-2" /> Back
        </Button>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Activity className="h-5 w-5 text-emerald-400" />
          Service Health
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchHealth(true)}
          disabled={loading}
          className="ml-auto border-slate-600"
          data-testid="btn-health-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall status banner */}
      {!loading && health && (
        <div
          className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 ${
            anyDegraded
              ? "border-red-500/30 bg-red-500/10"
              : "border-green-500/30 bg-green-500/10"
          }`}
          data-testid="health-overall-banner"
          role="status"
        >
          {anyDegraded ? (
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" aria-hidden />
          )}
          <p
            className={`font-medium text-sm ${anyDegraded ? "text-red-300" : "text-green-300"}`}
          >
            {anyDegraded ? "One or more services are degraded" : "All services operational"}
          </p>
          {lastFetched && (
            <span className="ml-auto text-xs text-slate-500">
              Last checked {lastFetched.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Fetch error */}
      {fetchError && (
        <div
          className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
          role="alert"
          data-testid="health-fetch-error"
        >
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" aria-hidden />
          <p className="text-sm text-amber-300">
            Failed to load health data: {fetchError}
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !health && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading health data">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-slate-800/60 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Service rows */}
      {health && (
        <div className="space-y-3">
          {/* Database */}
          <Card
            className="bg-slate-900/50 border-slate-800"
            data-testid="health-card-db"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-white text-base">
                <Database className="h-5 w-5 text-blue-400" />
                Database
                <span className="ml-auto">{statusBadge(health.db)}</span>
              </CardTitle>
            </CardHeader>
            {health.db.error && (
              <CardContent className="pt-0">
                <p className="text-xs text-red-400 font-mono break-all">
                  {health.db.error}
                </p>
              </CardContent>
            )}
          </Card>

          {/* SMTP */}
          <Card
            className="bg-slate-900/50 border-slate-800"
            data-testid="health-card-smtp"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-white text-base">
                <Mail className="h-5 w-5 text-violet-400" />
                SMTP (Email)
                <span className="ml-auto">{statusBadge(health.smtp)}</span>
              </CardTitle>
            </CardHeader>
            {health.smtp.error && (
              <CardContent className="pt-0">
                <p className="text-xs text-red-400 font-mono break-all">
                  {health.smtp.error}
                </p>
              </CardContent>
            )}
          </Card>

          {/* AI */}
          <Card
            className="bg-slate-900/50 border-slate-800"
            data-testid="health-card-ai"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-white text-base">
                <Zap className="h-5 w-5 text-amber-400" />
                AI (OpenAI)
                <span className="ml-auto">{statusBadge(health.ai)}</span>
              </CardTitle>
            </CardHeader>
            {(health.ai.probe || health.ai.error) && (
              <CardContent className="pt-0 space-y-1">
                {health.ai.probe && (
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="text-slate-500">Probe strategy:</span>
                    <code
                      className="font-mono text-amber-300/80"
                      data-testid="ai-probe-strategy"
                    >
                      {health.ai.probe}
                    </code>
                  </p>
                )}
                {health.ai.error && (
                  <p className="text-xs text-red-400 font-mono break-all">
                    {health.ai.error}
                  </p>
                )}
              </CardContent>
            )}
          </Card>

          {/* Email failures + uptime row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Recent email failures */}
            <Card
              className={`bg-slate-900/50 ${health.recentEmailFailures > 0 ? "border-amber-500/40" : "border-slate-800"}`}
              data-testid="health-card-email-failures"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-sm">
                  <Mail
                    className={`h-4 w-4 ${health.recentEmailFailures > 0 ? "text-amber-400" : "text-slate-400"}`}
                  />
                  Email Failures (10 min)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-2xl font-bold ${health.recentEmailFailures > 0 ? "text-amber-300" : "text-green-300"}`}
                    data-testid="value-email-failures"
                  >
                    {health.recentEmailFailures}
                  </span>
                  {health.recentEmailFailures > 0 && (
                    <Badge
                      className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs"
                      data-testid="badge-email-failures-warning"
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" aria-hidden />
                      Warning
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Per-instance rolling count
                </p>
              </CardContent>
            </Card>

            {/* Server uptime */}
            <Card
              className="bg-slate-900/50 border-slate-800"
              data-testid="health-card-uptime"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-white text-sm">
                  <Activity className="h-4 w-4 text-slate-400" />
                  Server Uptime
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <span
                  className="text-2xl font-bold text-slate-200"
                  data-testid="value-uptime"
                >
                  {formatUptime(health.uptime)}
                </span>
                {health.version && (
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    v{health.version}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Probe Timing Settings ─────────────────────────────────────────── */}
      {(intervalSetting || cooldownSetting) && (
        <div className="mt-6" data-testid="probe-timing-section">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            Probe Timing Settings
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Changes apply at the next probe cycle — no restart required.
            Env vars take precedence and disable the input below.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ProbeTimingRow
              label="Probe Interval"
              setting={intervalSetting}
              onSave={saveInterval}
              saving={intervalSaving}
              saveError={intervalSaveError}
              saveOk={intervalSaveOk}
              data-testid="probe-interval-setting"
            />
            <ProbeTimingRow
              label="Alert Cooldown"
              setting={cooldownSetting}
              onSave={saveCooldown}
              saving={cooldownSaving}
              saveError={cooldownSaveError}
              saveOk={cooldownSaveOk}
              data-testid="probe-cooldown-setting"
            />
          </div>
        </div>
      )}
    </div>
  );
}
