import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  X,
  Megaphone,
} from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "critical";
  active: boolean;
  expiresAt: string | null;
}

const DISMISS_KEY = "ibccf_announcements_dismissed";

const TYPE_STYLE: Record<
  Announcement["type"],
  { bg: string; border: string; text: string; iconClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  info: {
    bg: "linear-gradient(90deg, rgba(37,99,235,0.18) 0%, rgba(37,99,235,0.08) 100%)",
    border: "rgba(96,165,250,0.45)",
    text: "#cfe1ff",
    iconClass: "text-blue-300",
    Icon: Info,
  },
  success: {
    bg: "linear-gradient(90deg, rgba(22,163,74,0.18) 0%, rgba(22,163,74,0.08) 100%)",
    border: "rgba(74,222,128,0.45)",
    text: "#d3f5e0",
    iconClass: "text-emerald-300",
    Icon: CheckCircle,
  },
  warning: {
    bg: "linear-gradient(90deg, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.08) 100%)",
    border: "rgba(252,211,77,0.50)",
    text: "#fde9b8",
    iconClass: "text-amber-300",
    Icon: AlertTriangle,
  },
  critical: {
    bg: "linear-gradient(90deg, rgba(239,68,68,0.22) 0%, rgba(239,68,68,0.10) 100%)",
    border: "rgba(252,165,165,0.55)",
    text: "#fecaca",
    iconClass: "text-red-300",
    Icon: AlertCircle,
  },
};

function getDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function addDismissed(id: string) {
  const set = new Set(getDismissed());
  set.add(id);
  localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(set)));
}

export function AnnouncementBanner() {
  const { data = [] } = useQuery<Announcement[]>({
    queryKey: ["/api/announcements/active"],
    queryFn: async () => {
      const r = await fetch("/api/announcements/active");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const [dismissed, setDismissed] = useState<string[]>(() => getDismissed());

  useEffect(() => {
    setDismissed(getDismissed());
  }, []);

  const visible = data.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div data-testid="announcement-banner" className="border-b border-white/10">
      {visible.map((a) => {
        const style = TYPE_STYLE[a.type] || TYPE_STYLE.info;
        const Icon = style.Icon;
        return (
          <div
            key={a.id}
            className="border-b last:border-b-0"
            style={{
              background: style.bg,
              borderColor: style.border,
              backdropFilter: "blur(10px)",
            }}
            data-testid={`announcement-${a.id}`}
          >
            <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-start gap-3">
              <div className="shrink-0 flex items-center gap-2 pt-0.5">
                <Megaphone className="w-3.5 h-3.5 text-white/70" />
                <Icon className={`w-4 h-4 ${style.iconClass}`} />
              </div>
              <div className="flex-1 min-w-0" style={{ color: style.text }}>
                <p className="text-sm font-semibold leading-snug">{a.title}</p>
                <p className="text-xs leading-snug mt-0.5 opacity-90 whitespace-pre-wrap">
                  {a.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  addDismissed(a.id);
                  setDismissed(getDismissed());
                }}
                className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
                title="Dismiss"
                aria-label="Dismiss announcement"
                data-testid={`dismiss-announcement-${a.id}`}
              >
                <X className={`w-4 h-4 ${style.iconClass}`} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AnnouncementBanner;
