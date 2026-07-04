import type { Case } from "@shared/schema";
import { storage } from "../storage";

export const STAMP_DUTY_DEFAULT_USDT_KEY = "stamp_duty_default_usdt";
export const DEFAULT_STAMP_DUTY_USDT = 250;

// app_settings keys for the disbursement rails the user must send the
// Stamp Duty Deposit to. Stored globally (one platform-wide wallet);
// callers surface them verbatim. Empty/missing values render as
// "Contact compliance" in the portal so the upload step never points
// users at a blank address.
export const STAMP_DUTY_PAYMENT_ADDRESS_KEY = "stamp_duty_payment_address";
export const STAMP_DUTY_PAYMENT_ASSET_KEY = "stamp_duty_payment_asset";
export const STAMP_DUTY_PAYMENT_NETWORK_KEY = "stamp_duty_payment_network";
export const STAMP_DUTY_PAYMENT_MEMO_KEY = "stamp_duty_payment_memo";

// Multi-wallet payment rails (Task #136). Stored as a JSON array under
// the single app_settings key `stamp_duty_payment_wallets` so admins can
// offer multiple receiving wallets (e.g. BTC, USDT-TRC20, ERC20) and
// users pick which asset to pay with. Falls back to the legacy single
// _ADDRESS_KEY / _ASSET_KEY / _NETWORK_KEY / _MEMO_KEY trio if the JSON
// key is empty so existing deployments keep working unchanged.
export const STAMP_DUTY_PAYMENT_WALLETS_KEY = "stamp_duty_payment_wallets";

export interface StampDutyPaymentRails {
  address: string | null;
  asset: string | null;
  network: string | null;
  memo: string | null;
}

export interface StampDutyWallet {
  id: string;
  label: string | null;
  address: string;
  asset: string;
  network: string | null;
  memo: string | null;
}

function readJsonWallets(raw: string | null): StampDutyWallet[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StampDutyWallet[] = [];
    for (const w of parsed) {
      if (!w || typeof w !== "object") continue;
      const address = String((w as { address?: unknown }).address ?? "").trim();
      const asset = String((w as { asset?: unknown }).asset ?? "").trim();
      if (!address || !asset) continue;
      const id = String((w as { id?: unknown }).id ?? "").trim() || `${asset}-${address.slice(0, 6)}`;
      const label = String((w as { label?: unknown }).label ?? "").trim() || null;
      const network = String((w as { network?: unknown }).network ?? "").trim() || null;
      const memo = String((w as { memo?: unknown }).memo ?? "").trim() || null;
      out.push({ id, label, address, asset, network, memo });
    }
    return out;
  } catch {
    return [];
  }
}

export async function getStampDutyPaymentWallets(): Promise<StampDutyWallet[]> {
  try {
    const row = await storage.getAppSetting(STAMP_DUTY_PAYMENT_WALLETS_KEY);
    const wallets = readJsonWallets(row?.value ?? null);
    if (wallets.length > 0) return wallets;
  } catch {
    /* fall through to legacy single-wallet keys */
  }
  // Backward compat: synthesize a one-element list from the legacy keys.
  const legacy = await getStampDutyPaymentRails();
  if (legacy.address && legacy.asset) {
    return [
      {
        id: `${legacy.asset}-legacy`,
        label: null,
        address: legacy.address,
        asset: legacy.asset,
        network: legacy.network,
        memo: legacy.memo,
      },
    ];
  }
  return [];
}

export async function setStampDutyPaymentWallets(
  wallets: StampDutyWallet[],
  updatedBy?: string | null,
  executor?: import("../db").DbExecutor,
): Promise<StampDutyWallet[]> {
  const sanitized: StampDutyWallet[] = wallets.map((w, i) => ({
    id: (w.id ?? "").trim() || `${(w.asset ?? "wallet").trim()}-${i}`,
    label: w.label?.trim() || null,
    address: w.address.trim(),
    asset: w.asset.trim(),
    network: w.network?.trim() || null,
    memo: w.memo?.trim() || null,
  }));
  await storage.setAppSetting(
    STAMP_DUTY_PAYMENT_WALLETS_KEY,
    JSON.stringify(sanitized),
    updatedBy ?? null,
    executor,
  );
  return sanitized;
}

export async function getStampDutyPaymentRails(): Promise<StampDutyPaymentRails> {
  // Prefer the multi-wallet JSON store whenever it has at least one
  // entry — admin edits only touch that key, so reading legacy keys
  // first would let stale single-wallet values shadow the current
  // configuration. The legacy keys are only consulted as a last-resort
  // fallback for deployments that have not migrated yet.
  try {
    const row = await storage.getAppSetting(STAMP_DUTY_PAYMENT_WALLETS_KEY);
    const wallets = readJsonWallets(row?.value ?? null);
    if (wallets.length > 0) {
      const w = wallets[0];
      return {
        address: w.address,
        asset: w.asset,
        network: w.network,
        memo: w.memo,
      };
    }
  } catch {
    /* fall through to legacy single-wallet keys */
  }
  const read = async (k: string): Promise<string | null> => {
    try {
      const row = await storage.getAppSetting(k);
      const v = (row?.value ?? "").trim();
      return v.length > 0 ? v : null;
    } catch {
      return null;
    }
  };
  const [address, asset, network, memo] = await Promise.all([
    read(STAMP_DUTY_PAYMENT_ADDRESS_KEY),
    read(STAMP_DUTY_PAYMENT_ASSET_KEY),
    read(STAMP_DUTY_PAYMENT_NETWORK_KEY),
    read(STAMP_DUTY_PAYMENT_MEMO_KEY),
  ]);
  return { address, asset, network, memo };
}

function parseNumeric(value: string | null | undefined): number {
  if (value == null) return NaN;
  const cleaned = String(value).replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export async function getGlobalDefaultStampDutyUsdt(): Promise<number> {
  try {
    const row = await storage.getAppSetting(STAMP_DUTY_DEFAULT_USDT_KEY);
    const n = parseNumeric(row?.value ?? null);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_STAMP_DUTY_USDT;
}

/**
 * Resolve the effective stamp-duty amount in USDT for a case. Per-case
 * override (`stampDutyAmountUsdt`) wins; otherwise the global default
 * from app_settings; otherwise the hard-coded constant. Returns a
 * `{ amount, source }` pair so callers can surface "default vs override"
 * in the UI without re-deriving it.
 */
export async function getEffectiveStampDutyUsdt(
  caseRow: Pick<Case, "stampDutyAmountUsdt">,
): Promise<{ amount: number; amountUsdt: string; source: "case" | "global" | "fallback" }> {
  const perCase = parseNumeric(caseRow.stampDutyAmountUsdt ?? null);
  if (Number.isFinite(perCase) && perCase >= 0) {
    return { amount: perCase, amountUsdt: perCase.toFixed(2), source: "case" };
  }
  try {
    const row = await storage.getAppSetting(STAMP_DUTY_DEFAULT_USDT_KEY);
    const n = parseNumeric(row?.value ?? null);
    if (Number.isFinite(n) && n >= 0) {
      return { amount: n, amountUsdt: n.toFixed(2), source: "global" };
    }
  } catch {
    /* fall through */
  }
  return {
    amount: DEFAULT_STAMP_DUTY_USDT,
    amountUsdt: DEFAULT_STAMP_DUTY_USDT.toFixed(2),
    source: "fallback",
  };
}
