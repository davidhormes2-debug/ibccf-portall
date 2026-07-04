import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, GripVertical, RotateCcw, Star, Trash2, Undo2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { RefundClaimStatusFilter } from "@shared/types";

export type FilterPresetState = {
  searchQuery: string;
  statusFilter: string;
  localeFilter: string;
  sealedFilter: string;
  stampDutyPendingOnly: boolean;
  reactivationPendingOnly: boolean;
  refundClaimStatusFilter: RefundClaimStatusFilter;
  legacyAccessCodeOnly: boolean;
};

type Preset = { id: string; name: string; state: FilterPresetState };

const STORAGE_KEY = "ibccf.admin.casesFilterPresets";
const LAST_USED_KEY = "ibccf.admin.casesFilterPresets.lastUsed";
const PINNED_KEY = "ibccf.admin.casesFilterPresets.pinned";
const ORDER_KEY = "ibccf.admin.casesFilterPresets.order";

export const MAX_PINS = 3;

const DEFAULT_STATE: FilterPresetState = {
  searchQuery: "",
  statusFilter: "all",
  localeFilter: "all",
  sealedFilter: "all",
  stampDutyPendingOnly: false,
  reactivationPendingOnly: false,
  refundClaimStatusFilter: "all",
  legacyAccessCodeOnly: false,
};

const BUILT_IN: Preset[] = [
  {
    id: "all",
    name: "All",
    state: { ...DEFAULT_STATE },
  },
  {
    id: "awaiting-my-action",
    name: "Awaiting my action",
    state: {
      ...DEFAULT_STATE,
      statusFilter: "syncing",
    },
  },
  {
    id: "reissue-pending",
    name: "Reissue pending",
    // Heuristic: surface active cases whose case data mentions a reissue.
    // The free-text search hits user name / email / access code / notes, so
    // operators can pin the preset to whatever signal their team uses
    // ("reissue", "REISSUE2", etc.) without coupling to schema changes.
    state: {
      ...DEFAULT_STATE,
      statusFilter: "active",
      searchQuery: "reissue",
    },
  },
  {
    id: "stamp-duty-pending",
    name: "Stamp-duty pending",
    state: {
      ...DEFAULT_STATE,
      stampDutyPendingOnly: true,
    },
  },
  {
    id: "reactivation-pending",
    name: "Reactivation pending",
    state: {
      ...DEFAULT_STATE,
      reactivationPendingOnly: true,
    },
  },
  {
    id: "sealed",
    name: "Sealed",
    state: {
      ...DEFAULT_STATE,
      sealedFilter: "sealed",
    },
  },
  {
    id: "submitted-claims",
    name: "Submitted claims",
    state: {
      ...DEFAULT_STATE,
      refundClaimStatusFilter: "submitted",
    },
  },
  {
    id: "pending-claims",
    name: "Pending submission",
    state: {
      ...DEFAULT_STATE,
      refundClaimStatusFilter: "pending_submission",
    },
  },
  {
    id: "approved-claims",
    name: "Approved claims",
    state: {
      ...DEFAULT_STATE,
      refundClaimStatusFilter: "approved",
    },
  },
  {
    id: "rejected-claims",
    name: "Rejected claims",
    state: {
      ...DEFAULT_STATE,
      refundClaimStatusFilter: "rejected",
    },
  },
  {
    id: "legacy-access-codes",
    name: "Legacy access codes",
    state: {
      ...DEFAULT_STATE,
      legacyAccessCodeOnly: true,
    },
  },
];

function normalizePresetState(raw: Partial<FilterPresetState>): FilterPresetState {
  return { ...DEFAULT_STATE, ...raw };
}

/** Return all presets in display order: pinned presets first, then the rest,
 *  each group preserving the saved order. New presets not yet in `order` are
 *  appended to the end of their group. */
function buildDisplayOrder(all: Preset[], order: string[], pinned: string[]): Preset[] {
  const idToPreset = new Map(all.map((p) => [p.id, p]));
  const allIds = all.map((p) => p.id);

  // Merge saved order with any new IDs not yet recorded.
  const knownInOrder = order.filter((id) => idToPreset.has(id));
  const newIds = allIds.filter((id) => !knownInOrder.includes(id));
  const fullOrder = [...knownInOrder, ...newIds];

  const pinnedSet = new Set(pinned);
  const pinnedItems = fullOrder
    .filter((id) => pinnedSet.has(id))
    .map((id) => idToPreset.get(id)!)
    .filter(Boolean);
  const restItems = fullOrder
    .filter((id) => !pinnedSet.has(id))
    .map((id) => idToPreset.get(id)!)
    .filter(Boolean);

  return [...pinnedItems, ...restItems];
}

type Props = {
  current: FilterPresetState;
  apply: (s: FilterPresetState) => void;
};

export function CaseFilterPresets({ current, apply }: Props) {
  const [custom, setCustom] = useState<Preset[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<{ order: string[]; pinned: string[] } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Load custom presets, pinned IDs, order, and restore last-used preset on first mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Array<{ id: string; name: string; state: Partial<FilterPresetState> }> =
          JSON.parse(raw);
        setCustom(parsed.map((p) => ({ ...p, state: normalizePresetState(p.state) })));
      }
    } catch {
      /* ignore */
    }
    try {
      const rawPinned = localStorage.getItem(PINNED_KEY);
      if (rawPinned) setPinned(JSON.parse(rawPinned));
    } catch {
      /* ignore */
    }
    try {
      const rawOrder = localStorage.getItem(ORDER_KEY);
      if (rawOrder) setOrder(JSON.parse(rawOrder));
    } catch {
      /* ignore */
    }

    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const lastId = localStorage.getItem(LAST_USED_KEY);
      if (!lastId) return;
      const customRaw = localStorage.getItem(STORAGE_KEY);
      const rawCustomList: Array<{ id: string; name: string; state: Partial<FilterPresetState> }> =
        customRaw ? JSON.parse(customRaw) : [];
      const customList: Preset[] = rawCustomList.map((p) => ({
        ...p,
        state: normalizePresetState(p.state),
      }));
      const found =
        BUILT_IN.find((p) => p.id === lastId) || customList.find((p) => p.id === lastId);
      if (found) apply(normalizePresetState(found.state));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: Preset[]) => {
    setCustom(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const persistPinned = (next: string[]) => {
    setPinned(next);
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const persistOrder = (next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const isActive = (p: Preset) =>
    p.state.searchQuery === current.searchQuery &&
    p.state.statusFilter === current.statusFilter &&
    p.state.localeFilter === current.localeFilter &&
    p.state.sealedFilter === current.sealedFilter &&
    p.state.stampDutyPendingOnly === current.stampDutyPendingOnly &&
    p.state.reactivationPendingOnly === current.reactivationPendingOnly &&
    p.state.refundClaimStatusFilter === current.refundClaimStatusFilter &&
    p.state.legacyAccessCodeOnly === current.legacyAccessCodeOnly;

  const handleApply = (p: Preset) => {
    apply(p.state);
    try {
      localStorage.setItem(LAST_USED_KEY, p.id);
    } catch {
      /* ignore */
    }
  };

  const togglePin = (id: string) => {
    if (pinned.includes(id)) {
      persistPinned(pinned.filter((p) => p !== id));
    } else if (pinned.length < MAX_PINS) {
      persistPinned([...pinned, id]);
    }
  };

  const saveDraft = () => {
    const name = draft.trim();
    if (!name) return;
    const id = `c-${Date.now()}`;
    const next: Preset[] = [
      ...custom.filter((p) => p.name !== name),
      { id, name, state: { ...current } },
    ];
    persist(next);
    try {
      localStorage.setItem(LAST_USED_KEY, id);
    } catch {
      /* ignore */
    }
    setSavingName(null);
    setDraft("");
  };

  // --- Drag-and-drop handlers ---

  const getFullOrder = (allPresets: Preset[]): string[] => {
    const allIds = allPresets.map((p) => p.id);
    const knownInOrder = order.filter((id) => allIds.includes(id));
    const newIds = allIds.filter((id) => !knownInOrder.includes(id));
    return [...knownInOrder, ...newIds];
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const allPresets = [...BUILT_IN, ...custom];
    const fullOrder = getFullOrder(allPresets);
    const from = fullOrder.indexOf(sourceId);
    const to = fullOrder.indexOf(targetId);
    if (from === -1 || to === -1) return;

    const next = [...fullOrder];
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    persistOrder(next);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  const resetLayout = () => {
    setUndoSnapshot({ order, pinned });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 5000);

    setOrder([]);
    setPinned([]);
    try {
      localStorage.removeItem(ORDER_KEY);
      localStorage.removeItem(PINNED_KEY);
    } catch {
      /* ignore */
    }
  };

  const undoReset = () => {
    if (!undoSnapshot) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    persistOrder(undoSnapshot.order);
    persistPinned(undoSnapshot.pinned);
    setUndoSnapshot(null);
  };

  const all = [...BUILT_IN, ...custom];
  const displayed = buildDisplayOrder(all, order, pinned);
  const pinnedSet = new Set(pinned);

  return (
    <TooltipProvider>
    <div
      className="flex flex-wrap items-center gap-2 mb-3"
      data-testid="case-filter-presets"
    >
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold inline-flex items-center gap-1">
        <Bookmark className="w-3 h-3" /> Presets
      </span>
      {displayed.map((p) => {
        const active = isActive(p);
        const isCustom = !BUILT_IN.find((b) => b.id === p.id);
        const isPinned = pinnedSet.has(p.id);
        const isDragging = dragId === p.id;
        const isDragOver = dragOverId === p.id;
        const atPinLimit = !isPinned && pinned.length >= MAX_PINS;

        return (
          <button
            key={p.id}
            draggable
            onDragStart={(e) => handleDragStart(e, p.id)}
            onDragOver={(e) => handleDragOver(e, p.id)}
            onDrop={(e) => handleDrop(e, p.id)}
            onDragEnd={handleDragEnd}
            onClick={() => handleApply(p)}
            className={`group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border transition-colors cursor-pointer select-none ${
              active
                ? "bg-amber-500/15 border-amber-500/50 text-amber-100"
                : "bg-slate-900/50 border-slate-700 text-slate-300 hover:border-slate-600 hover:text-white"
            } ${isDragging ? "opacity-40" : ""} ${isDragOver && !isDragging ? "border-amber-500/60 ring-1 ring-amber-500/30" : ""}`}
            data-testid={`preset-${p.id}`}
            aria-pressed={active}
          >
            <GripVertical
              className="w-3 h-3 text-slate-600 cursor-grab active:cursor-grabbing shrink-0"
              aria-hidden="true"
              onClick={(e) => e.stopPropagation()}
            />
            {isPinned && (
              <span className="sr-only">(pinned) </span>
            )}
            {p.name}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0">
                  <Star
                    className={`w-3 h-3 shrink-0 transition-colors ${
                      isPinned
                        ? "text-amber-400 fill-amber-400"
                        : "text-slate-600 hover:text-amber-300 opacity-0 group-hover:opacity-100"
                    } ${atPinLimit ? "cursor-not-allowed" : "cursor-pointer"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(p.id);
                    }}
                    aria-label={isPinned ? `Unpin preset ${p.name}` : `Pin preset ${p.name}`}
                    aria-disabled={atPinLimit ? true : undefined}
                    role="button"
                    tabIndex={atPinLimit ? 0 : -1}
                  />
                </span>
              </TooltipTrigger>
              {atPinLimit && (
                <TooltipContent>
                  3 pins maximum — unpin one first
                </TooltipContent>
              )}
            </Tooltip>
            {isCustom && (
              <Trash2
                className="w-3 h-3 text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  persist(custom.filter((c) => c.id !== p.id));
                  persistPinned(pinned.filter((id) => id !== p.id));
                }}
                aria-label={`Delete preset ${p.name}`}
                role="button"
                tabIndex={-1}
              />
            )}
          </button>
        );
      })}
      {undoSnapshot ? (
        <button
          onClick={undoReset}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border border-amber-500/50 text-amber-300 hover:text-amber-100 hover:border-amber-400/70 animate-in fade-in duration-150"
          data-testid="preset-undo-reset"
          aria-label="Undo preset layout reset"
        >
          <Undo2 className="w-3 h-3" /> Undo reset
        </button>
      ) : (order.length > 0 || pinned.length > 0) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={resetLayout}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border border-slate-700 text-slate-400 hover:text-amber-200 hover:border-amber-500/40"
              data-testid="preset-reset-layout"
              aria-label="Reset preset order and pins"
            >
              <RotateCcw className="w-3 h-3" /> Reset order
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Clears custom order and all pins, restoring built-in defaults
          </TooltipContent>
        </Tooltip>
      )}
      {savingName === "new" ? (
        <div className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveDraft();
              if (e.key === "Escape") {
                setSavingName(null);
                setDraft("");
              }
            }}
            placeholder="Preset name"
            className="h-7 rounded-md bg-slate-900 border border-slate-700 text-xs px-2 text-white outline-none focus:border-amber-500/50"
          />
          <button
            onClick={saveDraft}
            className="h-7 px-2 rounded-md bg-amber-600 hover:bg-amber-500 text-xs text-white"
          >
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSavingName("new")}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border border-dashed border-slate-700 text-slate-400 hover:text-amber-200 hover:border-amber-500/40"
          data-testid="preset-save"
        >
          <BookmarkPlus className="w-3 h-3" /> Save current
        </button>
      )}
    </div>
    </TooltipProvider>
  );
}
