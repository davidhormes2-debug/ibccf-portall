// One-time migration: remove orphaned wallet-connect history keys written by
// the now-deleted walletConnectHistory module so browsers don't accumulate
// dead localStorage entries indefinitely. A sentinel key is set after the
// first successful sweep so the scan is skipped on all subsequent page loads.

export const WALLET_HISTORY_SENTINEL =
  "ibccf_migration_wallet_history_cleanup_done";
export const WALLET_HISTORY_PREFIX = "ibccf_wallet_connect_history_";

export function cleanupStaleWalletHistory(): void {
  try {
    if (localStorage.getItem(WALLET_HISTORY_SENTINEL)) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(WALLET_HISTORY_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(WALLET_HISTORY_SENTINEL, "1");
  } catch {
    // localStorage may be unavailable (private browsing, storage quota, etc.)
  }
}
