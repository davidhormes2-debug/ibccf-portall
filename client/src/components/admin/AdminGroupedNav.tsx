import { useCallback, useEffect, useRef, useState } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  FolderOpen,
  MessageCircle,
  BarChart3,
  Settings,
  Globe,
  Users,
  Key,
  Eye,
  Megaphone,
  FolderLock,
  Image as ImageIcon,
  Stamp,
  Scale,
  CreditCard,
  Upload,
  Search,
  X,
  Wallet,
  RotateCcw,
  LockOpen,
} from "lucide-react";

type NavItem = {
  id: string;
  label: string;
  icon: typeof FileText;
  badge?: { count: number; kind: "alert" | "warn" } | null;
  badgeAction?: () => void;
  badgeTitle?: string;
  withdrawalBadge?: { count: number } | null;
  withdrawalBadgeAction?: () => void;
  withdrawalBadgeTitle?: string;
  refundClaimBadge?: { count: number } | null;
  refundClaimBadgeAction?: () => void;
  refundClaimBadgeTitle?: string;
  reactivationBadge?: { count: number } | null;
  reactivationBadgeAction?: () => void;
  reactivationBadgeTitle?: string;
  activeWarningsBadge?: { count: number } | null;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export function AdminGroupedNav(props: {
  activeTab: string;
  setActiveTab: (v: string) => void;
  totalUnread: number;
  stampDutyPendingCount: number;
  onStampDutyBadgeClick: () => void;
  pendingDocCount: number;
  onPendingDocBadgeClick: () => void;
  supportingDocPendingCount: number;
  onSupportingDocBadgeClick: () => void;
  withdrawalPendingCount: number;
  onWithdrawalBadgeClick: () => void;
  refundClaimPendingCount: number;
  onRefundClaimBadgeClick: () => void;
  reactivationPendingCount: number;
  onReactivationBadgeClick: () => void;
  activeWarningsCount: number;
}) {
  const {
    activeTab,
    setActiveTab,
    totalUnread,
    stampDutyPendingCount,
    onStampDutyBadgeClick,
    pendingDocCount,
    onPendingDocBadgeClick,
    supportingDocPendingCount,
    onSupportingDocBadgeClick,
    withdrawalPendingCount,
    onWithdrawalBadgeClick,
    refundClaimPendingCount,
    onRefundClaimBadgeClick,
    reactivationPendingCount,
    onReactivationBadgeClick,
    activeWarningsCount,
  } = props;

  const LAST_ITEM_KEY = "ibccf.admin.groupedNav.lastItemPerGroup";
  const lastItemPerGroup = useRef<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_ITEM_KEY);
      if (raw) lastItemPerGroup.current = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const findGroupForItem = (itemId: string) =>
    groups.find((g) => g.items.some((i) => i.id === itemId))?.id;

  useEffect(() => {
    if (!activeTab) return;
    const groupId = findGroupForItem(activeTab);
    if (!groupId) return;
    const next = { ...lastItemPerGroup.current, [groupId]: activeTab };
    lastItemPerGroup.current = next;
    try {
      localStorage.setItem(LAST_ITEM_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const onGroupHeaderClick = (group: NavGroup) => {
    const remembered = lastItemPerGroup.current[group.id];
    const target =
      remembered && group.items.find((i) => i.id === remembered)
        ? remembered
        : group.items[0]?.id;
    if (target) setActiveTab(target);
  };

  const groups: NavGroup[] = [
    {
      id: "cases",
      label: "Cases",
      items: [
        {
          id: "cases",
          label: "All Cases",
          icon: FileText,
          badge: stampDutyPendingCount > 0
            ? { count: stampDutyPendingCount, kind: "warn" }
            : null,
          badgeAction: onStampDutyBadgeClick,
          badgeTitle: "Stamp-duty receipts awaiting review — click to filter",
          withdrawalBadge: withdrawalPendingCount > 0
            ? { count: withdrawalPendingCount }
            : null,
          withdrawalBadgeAction: onWithdrawalBadgeClick,
          withdrawalBadgeTitle: `${withdrawalPendingCount} withdrawal request${withdrawalPendingCount === 1 ? "" : "s"} awaiting review — click to filter`,
          refundClaimBadge: refundClaimPendingCount > 0
            ? { count: refundClaimPendingCount }
            : null,
          refundClaimBadgeAction: onRefundClaimBadgeClick,
          refundClaimBadgeTitle: `${refundClaimPendingCount} refund claim${refundClaimPendingCount === 1 ? "" : "s"} awaiting review — click to filter`,
          reactivationBadge: reactivationPendingCount > 0
            ? { count: reactivationPendingCount }
            : null,
          reactivationBadgeAction: onReactivationBadgeClick,
          reactivationBadgeTitle: `${reactivationPendingCount} reactivation receipt${reactivationPendingCount === 1 ? "" : "s"} awaiting review — click to filter`,
        },
        { id: "submissions", label: "Submissions", icon: FolderOpen },
        { id: "key-requests", label: "Key Requests", icon: Key },
        { id: "deposit-requests", label: "Deposit Requests", icon: CreditCard },
      ],
    },
    {
      id: "compliance",
      label: "Compliance",
      items: [
        { id: "declarations", label: "Declarations", icon: Scale },
        {
          id: "documents",
          label: "Documents",
          icon: FolderLock,
          badge: pendingDocCount > 0
            ? { count: pendingDocCount, kind: "alert" as const }
            : null,
          badgeAction: onPendingDocBadgeClick,
          badgeTitle: `${pendingDocCount} supporting document${pendingDocCount === 1 ? "" : "s"} awaiting review`,
        },
        {
          id: "supporting-docs",
          label: "Supporting Docs",
          icon: Upload,
          badge: supportingDocPendingCount > 0
            ? { count: supportingDocPendingCount, kind: "alert" as const }
            : null,
          badgeAction: onSupportingDocBadgeClick,
          badgeTitle: `${supportingDocPendingCount} supporting doc${supportingDocPendingCount === 1 ? "" : "s"} awaiting review`,
        },
        { id: "receipts", label: "All Receipts", icon: ImageIcon },
      ],
    },
    {
      id: "communications",
      label: "Communications",
      items: [
        {
          id: "conversations",
          label: "Conversations",
          icon: MessageCircle,
          badge: totalUnread > 0 ? { count: totalUnread, kind: "alert" } : null,
        },
        {
          id: "communications",
          label: "Broadcast",
          icon: Megaphone,
          activeWarningsBadge: activeWarningsCount > 0 ? { count: activeWarningsCount } : null,
        },
        { id: "content", label: "Content", icon: Globe },
        { id: "community", label: "Community", icon: Users },
      ],
    },
    {
      id: "system",
      label: "System",
      items: [
        { id: "analytics", label: "Analytics", icon: BarChart3 },
        { id: "visitors", label: "Visitors", icon: Eye },
        { id: "settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, [focusSearch]);

  // Computed each render (not memoized) so live badge counts in `groups`
  // stay fresh — the array is tiny so the cost is negligible.
  const filteredGroups = !normalizedQuery
    ? groups
    : groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            item.label.toLowerCase().includes(normalizedQuery),
          ),
        }))
        .filter((group) => group.items.length > 0);

  const firstMatchId = filteredGroups[0]?.items[0]?.id;

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && firstMatchId) {
      e.preventDefault();
      setActiveTab(firstMatchId);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  return (
    <aside
      className="lg:sticky lg:top-0 lg:w-60 w-full flex-shrink-0 flex flex-col lg:overflow-y-auto"
      aria-label="Admin sections"
      style={{
        background: "#0d3050",
        minHeight: "100%",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Search box — filters every admin function live so each one stays
          accessible and searchable. Fills the previously-empty top area. */}
      <div className="px-3 pt-4 pb-3 flex-shrink-0">
        <p
          className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-2 px-1"
          style={{ color: "rgba(255,255,255,0.38)" }}
        >
          Menu
        </p>
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: "rgba(255,255,255,0.4)" }}
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search functions…"
            aria-label="Search admin functions (Ctrl+K / ⌘K)"
            data-testid="admin-nav-search"
            className="w-full rounded-md pl-8 pr-16 py-2 text-sm outline-none transition-colors focus:ring-1"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#ffffff",
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              data-testid="admin-nav-search-clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 hover:bg-white/10 focus:outline-none"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none select-none hidden sm:flex items-center gap-0.5"
              aria-hidden="true"
            >
              <kbd
                className="inline-flex items-center justify-center rounded px-1 py-0.5 text-[9px] font-mono leading-none"
                style={{
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "^K"}
              </kbd>
            </span>
          )}
        </div>
      </div>

      <TabsList
        className="flex flex-col w-full h-auto gap-0 px-2 pb-4 border-0 items-stretch flex-1"
        style={{ background: "transparent" }}
      >
        {filteredGroups.length === 0 && (
          <p
            className="px-3 py-4 text-sm"
            style={{ color: "rgba(255,255,255,0.4)" }}
            data-testid="admin-nav-no-results"
          >
            No functions match “{query}”.
          </p>
        )}
        {filteredGroups.map((group, gi) => (
          <div
            key={group.id}
            className={`flex flex-col gap-0 w-full ${gi > 0 ? "mt-4" : "mt-1"}`}
          >
            {/* Group label — clickable to restore last item */}
            <button
              type="button"
              onClick={() => onGroupHeaderClick(group)}
              className="px-3 py-1 text-left focus:outline-none"
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                fontWeight: 600,
                color: "rgba(255,255,255,0.32)",
                transition: "color 0.15s",
              }}
              title={`${group.label} — jump to last opened item`}
              data-testid={`group-header-${group.id}`}
            >
              {group.label}
            </button>

            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <div key={item.id} className="relative inline-flex w-full">
                  <TabsTrigger
                    value={item.id}
                    className="w-full justify-start gap-2.5 px-3 py-2.5 text-sm rounded-md transition-all text-left border-0 outline-none shadow-none"
                    style={{
                      background: isActive ? "#1a5f8a" : "transparent",
                      color: isActive ? "#ffffff" : "rgba(255,255,255,0.62)",
                      fontWeight: isActive ? 600 : 400,
                      boxShadow: isActive
                        ? "0 2px 8px rgba(0,0,0,0.3)"
                        : "none",
                      borderRadius: "0.375rem",
                    }}
                    data-testid={`tab-${item.id}`}
                  >
                    {/* Small checkbox-style prefix square */}
                    <span
                      className="w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center"
                      style={{
                        borderColor: isActive
                          ? "rgba(255,255,255,0.55)"
                          : "rgba(255,255,255,0.28)",
                        background: isActive
                          ? "rgba(255,255,255,0.12)"
                          : "transparent",
                      }}
                    >
                      {isActive && (
                        <span
                          className="w-1.5 h-1.5 rounded-[1px]"
                          style={{ background: "#fff" }}
                        />
                      )}
                    </span>
                    <Icon
                      className="w-3.5 h-3.5 flex-shrink-0"
                      style={{ opacity: isActive ? 0.9 : 0.55 }}
                    />
                    <span className="flex-1 text-left truncate">
                      {item.label}
                    </span>
                    {item.badge && item.badge.kind === "alert" && (
                      <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                        {item.badge.count}
                      </span>
                    )}
                    {item.activeWarningsBadge && item.activeWarningsBadge.count > 0 && (
                      <span
                        className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        style={{ background: "#f59e0b" }}
                        title={`${item.activeWarningsBadge.count} active portal warning${item.activeWarningsBadge.count === 1 ? "" : "s"}`}
                        aria-label={`${item.activeWarningsBadge.count} active portal warning${item.activeWarningsBadge.count === 1 ? "" : "s"}`}
                        data-testid="badge-communications-active-warnings"
                      >
                        {item.activeWarningsBadge.count}
                      </span>
                    )}
                    {(() => {
                      const actionBadgeCount =
                        (item.badge?.kind === "warn" ? 1 : 0) +
                        (item.withdrawalBadge ? 1 : 0) +
                        (item.refundClaimBadge ? 1 : 0) +
                        (item.reactivationBadge ? 1 : 0);
                      return actionBadgeCount > 0 ? (
                        <span
                          className="ml-2 inline-block"
                          style={{ width: actionBadgeCount * 26 + (actionBadgeCount - 1) * 4 }}
                          aria-hidden="true"
                        />
                      ) : null;
                    })()}
                  </TabsTrigger>

                  {(item.badge?.kind === "warn" || item.withdrawalBadge || item.refundClaimBadge || item.reactivationBadge) && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                      {item.reactivationBadge && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.reactivationBadgeAction?.();
                          }}
                          title={item.reactivationBadgeTitle}
                          aria-label={`${item.reactivationBadge.count} reactivation receipt${item.reactivationBadge.count === 1 ? "" : "s"} awaiting review`}
                          className="min-w-[22px] h-5 px-1 rounded-full bg-orange-500 text-[10px] text-white inline-flex items-center justify-center font-bold gap-0.5 cursor-pointer hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300 shadow-[0_0_8px_rgba(249,115,22,0.5)]"
                          data-testid={`badge-${item.id}-reactivation`}
                        >
                          <LockOpen className="w-3 h-3" />
                          {item.reactivationBadge.count}
                        </button>
                      )}
                      {item.refundClaimBadge && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.refundClaimBadgeAction?.();
                          }}
                          title={item.refundClaimBadgeTitle}
                          aria-label={`${item.refundClaimBadge.count} refund claim${item.refundClaimBadge.count === 1 ? "" : "s"} awaiting review`}
                          className="min-w-[22px] h-5 px-1 rounded-full bg-violet-500 text-[10px] text-white inline-flex items-center justify-center font-bold gap-0.5 cursor-pointer hover:bg-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-300 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
                          data-testid={`badge-${item.id}-refund-claim`}
                        >
                          <RotateCcw className="w-3 h-3" />
                          {item.refundClaimBadge.count}
                        </button>
                      )}
                      {item.withdrawalBadge && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.withdrawalBadgeAction?.();
                          }}
                          title={item.withdrawalBadgeTitle}
                          aria-label={`${item.withdrawalBadge.count} withdrawal request${item.withdrawalBadge.count === 1 ? "" : "s"} awaiting review`}
                          className="min-w-[22px] h-5 px-1 rounded-full bg-emerald-500 text-[10px] text-white inline-flex items-center justify-center font-bold gap-0.5 cursor-pointer hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                          data-testid={`badge-${item.id}-withdrawal`}
                        >
                          <Wallet className="w-3 h-3" />
                          {item.withdrawalBadge.count}
                        </button>
                      )}
                      {item.badge?.kind === "warn" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.badgeAction?.();
                          }}
                          title={item.badgeTitle}
                          aria-label={`${item.badge.count} items awaiting review`}
                          className="min-w-[22px] h-5 px-1 rounded-full bg-amber-500 text-[10px] text-white inline-flex items-center justify-center font-bold gap-0.5 cursor-pointer hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
                          data-testid={`badge-${item.id}-warn`}
                        >
                          <Stamp className="w-3 h-3" />
                          {item.badge.count}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </TabsList>
    </aside>
  );
}
