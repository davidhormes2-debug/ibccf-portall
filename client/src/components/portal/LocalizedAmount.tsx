import { useEffect, useState } from "react";
import { usePortal } from "@/pages/portal/PortalContext";
import { currencyForCountry } from "@shared/currencies";
import { useFormat } from "@/i18n/format";

// Module-level cache: one fetch per currency per browser session, refreshed
// every hour. The server already caches across users; this avoids re-fetching
// on every component mount within a single page load.
type CacheEntry = { rate: number; fetchedAt: number };
const RATE_TTL_MS = 60 * 60 * 1000;
const rateCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<number | null>>();

async function loadRate(currency: string): Promise<number | null> {
  const cached = rateCache.get(currency);
  if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) return cached.rate;
  let p = inflight.get(currency);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`/api/fx/rate?to=${encodeURIComponent(currency)}`);
        if (!r.ok) return null;
        const j = (await r.json()) as { rate?: unknown };
        const rate = typeof j.rate === "number" && Number.isFinite(j.rate) && j.rate > 0 ? j.rate : null;
        if (rate != null) rateCache.set(currency, { rate, fetchedAt: Date.now() });
        return rate;
      } catch {
        return null;
      } finally {
        inflight.delete(currency);
      }
    })();
    inflight.set(currency, p);
  }
  return p;
}

// Pull the leading numeric portion out of an admin-supplied amount string.
// Inputs are intentionally free-form (e.g. "1,500", "1500 USDT", "12,450.00").
// Returns null when nothing parseable is present.
function parseUsdtAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const match = trimmed.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pickFractionDigits(n: number, currency: string): number {
  // Zero-decimal currencies (JPY, KRW, VND…) shouldn't show ".00";
  // small fractional amounts shouldn't round to zero.
  const ZERO_DEC = new Set(["JPY", "KRW", "VND", "IDR", "HUF", "CLP"]);
  return ZERO_DEC.has(currency) ? 0 : n < 1 ? 4 : 2;
}

interface LocalizedAmountProps {
  // The USDT amount string as entered by admin or hard-coded in copy.
  // Free-form: may include separators, decimals, and a currency suffix.
  value: string | number | null | undefined;
  // Optional className applied to the parenthetical local-currency span.
  estimateClassName?: string;
  // When false, suppress the local estimate even if country mode is on
  // (used when the surrounding sentence already mentions the currency).
  showEstimate?: boolean;
  // Wrap the local estimate in a leading separator (default " "). Pass ""
  // to control spacing yourself.
  separator?: string;
  // When true, render only the parenthetical local-currency estimate
  // (omit the raw USDT value). Use this when the surrounding markup
  // already prints the USDT figure as literal text. Renders nothing
  // when the estimate is unavailable or disabled.
  estimateOnly?: boolean;
}

// Renders a USDT amount and, when the case has country mode enabled,
// appends a parenthetical local-currency estimate. The original USDT
// string is rendered verbatim — only the estimate is generated.
export function LocalizedAmount({
  value,
  estimateClassName,
  showEstimate = true,
  separator = " ",
  estimateOnly = false,
}: LocalizedAmountProps) {
  const { currentCase } = usePortal();
  const { formatCurrency } = useFormat();
  const localized = currentCase?.localizedCurrencyEnabled === true;
  const currency = currencyForCountry(currentCase?.country);
  const usdt = parseUsdtAmount(value);

  const [rate, setRate] = useState<number | null>(() => {
    if (!currency) return null;
    const cached = rateCache.get(currency);
    return cached && Date.now() - cached.fetchedAt < RATE_TTL_MS ? cached.rate : null;
  });

  useEffect(() => {
    if (!localized || !currency || usdt == null) return;
    if (currency === "USD") {
      setRate(1);
      return;
    }
    let cancelled = false;
    void loadRate(currency).then((r) => {
      if (!cancelled) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, [localized, currency, usdt]);

  // Always render the original value — if anything below fails or is
  // disabled, the user still sees the USDT figure exactly as before.
  const original = value == null || value === "" ? null : String(value);

  if (!showEstimate || !localized || !currency || usdt == null || rate == null) {
    return estimateOnly ? null : <>{original}</>;
  }

  const amount = usdt * rate;
  const fractionDigits = pickFractionDigits(amount, currency);
  let converted: string;
  try {
    converted = formatCurrency(amount, currency, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    converted = `${amount.toFixed(fractionDigits)} ${currency}`;
  }
  return (
    <>
      {estimateOnly ? null : original}
      <span
        className={estimateClassName ?? "text-xs font-normal opacity-80 ml-1"}
        data-testid="localized-amount-estimate"
      >
        {separator}(~{converted})
      </span>
    </>
  );
}
