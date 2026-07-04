import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProbeStatus = "ok" | "degraded" | "unconfigured";

interface ProbeResult {
  status: ProbeStatus;
}

export interface HealthReport {
  db: ProbeResult;
  smtp: ProbeResult;
  ai: ProbeResult;
}

export const SERVICE_LABELS: Record<string, string> = {
  db: "Database",
  smtp: "SMTP (Email)",
  ai: "AI (OpenAI)",
};

export function degradedServices(h: HealthReport): string[] {
  return (["db", "smtp", "ai"] as const).filter(
    (k) => h[k].status === "degraded",
  );
}

const POLL_INTERVAL_MS = 60_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Polls /health every 60 s and returns the list of currently-degraded service
 * keys (e.g. ["db", "smtp"]).  An empty array means all services are healthy
 * (or the first fetch has not yet completed).
 */
export function useServiceHealth(): string[] {
  const [degraded, setDegraded] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/health");
      if (!res.ok && res.status !== 503) return;
      const data: HealthReport = await res.json();
      setDegraded(degradedServices(data));
    } catch {
      /* best-effort; silently ignore network errors */
    }
  };

  useEffect(() => {
    void fetchHealth();
    intervalRef.current = setInterval(() => void fetchHealth(), POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  return degraded;
}
