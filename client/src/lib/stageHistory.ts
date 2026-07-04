export interface StageHistoryEntry {
  stage: number;
  observedAt: string;
}

export const STAGE_HISTORY_KEY_PREFIX = "ibccf_stage_history_";
export const STAGE_SEEN_KEY_PREFIX = "ibccf_stage_seen_";
export const MAX_STAGE_HISTORY_ENTRIES = 50;

const KEY_PREFIX = STAGE_HISTORY_KEY_PREFIX;
const SEEN_PREFIX = STAGE_SEEN_KEY_PREFIX;
const MAX_ENTRIES = MAX_STAGE_HISTORY_ENTRIES;

function key(caseId: string) {
  return `${KEY_PREFIX}${caseId}`;
}

function isStageHistoryEntry(value: unknown): value is StageHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.stage === "number" && typeof v.observedAt === "string";
}

function safeRead(caseId: string): StageHistoryEntry[] {
  try {
    const raw = localStorage.getItem(key(caseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStageHistoryEntry).slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function safeWrite(caseId: string, entries: StageHistoryEntry[]) {
  try {
    localStorage.setItem(
      key(caseId),
      JSON.stringify(entries.slice(-MAX_ENTRIES))
    );
  } catch {
    // ignore quota errors
  }
}

/**
 * Record an observed stage for a case. If the stage is different from
 * the last observed stage we append a new transition entry. Returns the
 * previous stage (if any) so callers can render a one-time transition
 * banner the first time they see a new stage.
 *
 * Pass `maxStageReached` (server-side high-water mark) so that an admin
 * roll-back never records a backwards entry or triggers the banner again.
 * When `stage < highWater` the observation is silently dropped and
 * `isNew` is returned as `false`.
 */
export function recordStageObservation(
  caseId: string,
  stage: number,
  maxStageReached?: number | null
): { previousStage: number | null; isNew: boolean } {
  if (!caseId || !Number.isFinite(stage) || stage < 1) {
    return { previousStage: null, isNew: false };
  }
  const history = safeRead(caseId);
  const last = history.length > 0 ? history[history.length - 1] : null;

  // High-water mark: take the maximum of the server-supplied
  // maxStageReached and whatever the local history already recorded.
  // This prevents a roll-back from adding a backwards entry or firing
  // the one-time transition banner a second time.
  const highWater = Math.max(
    typeof maxStageReached === "number" ? maxStageReached : 0,
    last?.stage ?? 0
  );

  // Already at the same stage — nothing new to record.
  if (last && last.stage === stage) {
    return { previousStage: last.stage, isNew: false };
  }

  // Roll-back: stage dropped below the high-water mark. Silently ignore
  // so the Activity Timeline stays in ascending order.
  if (stage < highWater) {
    return { previousStage: last?.stage ?? null, isNew: false };
  }

  // Forward transition — record it.
  const previousStage = last?.stage ?? null;
  history.push({ stage, observedAt: new Date().toISOString() });
  safeWrite(caseId, history);
  return { previousStage, isNew: true };
}

export function getStageHistory(caseId: string): StageHistoryEntry[] {
  return safeRead(caseId);
}

/**
 * Startup housekeeping: scan localStorage for any stage-history keys and trim
 * each one to MAX_STAGE_HISTORY_ENTRIES. Guards against entries that grew
 * beyond the cap before the per-write limit was in place, and ensures the
 * invariant holds even when localStorage is written outside the normal
 * safeWrite path. Safe to call on every page load — it is a no-op when all
 * keys are already within bounds or localStorage is unavailable.
 */
export function pruneStageHistory(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(KEY_PREFIX))
      .forEach((k) => {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) return;
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          if (parsed.length > MAX_ENTRIES) {
            localStorage.setItem(
              k,
              JSON.stringify(parsed.slice(-MAX_ENTRIES)),
            );
          }
        } catch {
          // ignore malformed entries
        }
      });
  } catch {
    // localStorage may be unavailable (private browsing, storage quota, etc.)
  }
}

/**
 * Per-case+stage "seen" key — the dashboard transition banner uses this
 * so each new stage greets the user only once, and never re-appears
 * after dismissal or a refresh.
 */
export function hasSeenStageBanner(caseId: string, stage: number): boolean {
  try {
    return localStorage.getItem(`${SEEN_PREFIX}${caseId}_${stage}`) === "1";
  } catch {
    return true;
  }
}

export function markStageBannerSeen(caseId: string, stage: number) {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${caseId}_${stage}`, "1");
  } catch {
    // ignore
  }
}
