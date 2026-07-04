import { Router } from "express";

// Tiny in-memory FX cache. We hit the free, no-key public API at
// open.er-api.com which returns ALL USD→XXX rates in a single call. We
// cache the whole map for ~1 hour so the live portal isn't bouncing
// requests off the upstream on every page load. USDT is treated 1:1 with
// USD for display purposes (the conversion is shown only as an estimate).
//
// Failure mode: when the upstream is unreachable or returns garbage we
// serve any stale value we still have (with `stale: true`) and otherwise
// return a 503 — the portal then degrades to showing only the USDT figure.
const TTL_MS = 60 * 60 * 1000; // 1 hour
const STALE_MAX_MS = 24 * 60 * 60 * 1000; // serve stale up to 24h on upstream failure
type RateMap = { fetchedAt: number; rates: Record<string, number> };
let cache: RateMap | null = null;
let inflight: Promise<RateMap | null> | null = null;

async function fetchRates(): Promise<RateMap | null> {
  // open.er-api.com: free, no key, returns
  //   { result: "success", base_code: "USD", rates: { CAD: 1.36, ... } }.
  const url = "https://open.er-api.com/v6/latest/USD";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      result?: unknown;
      rates?: Record<string, unknown>;
    };
    if (json.result !== "success" || !json.rates || typeof json.rates !== "object") return null;
    const cleaned: Record<string, number> = {};
    for (const [code, raw] of Object.entries(json.rates)) {
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        cleaned[code] = raw;
      }
    }
    if (Object.keys(cleaned).length === 0) return null;
    cache = { fetchedAt: Date.now(), rates: cleaned };
    return cache;
  } catch {
    return null;
  }
}

function getOrFetch(): Promise<RateMap | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return Promise.resolve(cache);
  }
  if (!inflight) {
    inflight = fetchRates().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export const fxRouter = Router();

// GET /api/fx/rate?to=CAD — returns { base: "USD", to, rate, fetchedAt, stale? }.
// Public endpoint (rate is non-sensitive market data) so the portal can call it
// without admin auth. `to` must be a 3-letter ISO-4217 code.
fxRouter.get("/rate", async (req, res) => {
  const raw = String(req.query.to ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) {
    res.status(400).json({ error: "Invalid 'to' currency (expected 3-letter ISO code)" });
    return;
  }
  if (raw === "USD") {
    res.json({ base: "USD", to: "USD", rate: 1, fetchedAt: Date.now() });
    return;
  }
  const fresh = await getOrFetch();
  const pickRate = (m: RateMap) =>
    typeof m.rates[raw] === "number" ? m.rates[raw] : null;
  if (fresh) {
    const rate = pickRate(fresh);
    if (rate != null) {
      res.json({ base: "USD", to: raw, rate, fetchedAt: fresh.fetchedAt });
      return;
    }
    // Upstream succeeded but didn't carry this currency — treat as 404.
    res.status(404).json({ error: `No rate available for ${raw}` });
    return;
  }
  // Upstream failed — fall back to last-known stale value if it's still
  // within the stale window. Otherwise admit defeat with a 503.
  if (cache && Date.now() - cache.fetchedAt < STALE_MAX_MS) {
    const rate = pickRate(cache);
    if (rate != null) {
      res.json({ base: "USD", to: raw, rate, fetchedAt: cache.fetchedAt, stale: true });
      return;
    }
  }
  res.status(503).json({ error: "FX rate temporarily unavailable" });
});
