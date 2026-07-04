// Dedup map for rate-limited warn messages: key → last-warned timestamp.
// Suppresses repeat log lines when the same DB error fires on every request
// (e.g. a brief DB outage on a hot per-request code path would otherwise
// flood logs and bury other errors).
//
// Shared across the codebase so every DB-fallback / rate-limit catch block
// gets the same dedup window and we don't reinvent the helper per module.
const _warnDedupLastSeen = new Map<string, number>();
const WARN_DEDUP_INTERVAL_MS = 60_000; // one warning per key per minute

export function warnOnce(key: string, message: string, err?: unknown): void {
  const now = Date.now();
  const last = _warnDedupLastSeen.get(key) ?? 0;
  if (now - last < WARN_DEDUP_INTERVAL_MS) return;
  _warnDedupLastSeen.set(key, now);
  if (err !== undefined) {
    console.warn(message, err);
  } else {
    console.warn(message);
  }
}

// Test-only escape hatch to reset the warnOnce dedup map so each test
// starts with a clean slate and can assert warn-call counts independently.
export function __resetWarnDedupForTests(): void {
  _warnDedupLastSeen.clear();
}
