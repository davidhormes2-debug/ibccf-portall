// Visitor intelligence helpers: IP geolocation, user-agent parsing,
// persona inference, and risk scoring. All four are pure functions of
// their inputs (the geo lookup is the only impure piece — it hits a
// public API and caches the result in-process).

// ---------- IP geolocation ----------------------------------------

export interface IpGeo {
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  asn?: string;
}

interface GeoCacheEntry {
  geo: IpGeo;
  cachedAt: number;
}

const GEO_CACHE_MAX = 5_000;
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const geoCache = new Map<string, GeoCacheEntry>();

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (!ip) return true;
  // strip IPv6 mapping
  const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (v === "::1" || v === "127.0.0.1" || v === "0.0.0.0") return true;
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;
  if (v.startsWith("169.254.")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // ULA
  if (v.startsWith("fe80")) return true; // link-local v6
  // 172.16.0.0 - 172.31.255.255
  if (v.startsWith("172.")) {
    const second = parseInt(v.split(".")[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function getCachedIpGeo(ip: string): IpGeo | undefined {
  const entry = geoCache.get(ip);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > GEO_CACHE_TTL_MS) {
    geoCache.delete(ip);
    return undefined;
  }
  return entry.geo;
}

function rememberIpGeo(ip: string, geo: IpGeo) {
  // Simple eviction: when we hit the cap, drop the oldest entry.
  if (geoCache.size >= GEO_CACHE_MAX) {
    const firstKey = geoCache.keys().next().value;
    if (firstKey !== undefined) geoCache.delete(firstKey);
  }
  geoCache.set(ip, { geo, cachedAt: Date.now() });
}

// Looks up an IP via the free ip-api.com endpoint (no key required, ~45
// req/min limit). Skips private addresses, returns {} on any error so
// the caller can carry on without geo data.
export async function lookupIpGeo(ip: string): Promise<IpGeo> {
  if (!ip || isPrivateOrLoopbackIp(ip)) return {};
  const cached = getCachedIpGeo(ip);
  if (cached) return cached;
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,as`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      rememberIpGeo(ip, {});
      return {};
    }
    const data = (await res.json()) as {
      status?: string;
      country?: string;
      regionName?: string;
      city?: string;
      isp?: string;
      as?: string;
    };
    if (data.status !== "success") {
      rememberIpGeo(ip, {});
      return {};
    }
    const geo: IpGeo = {
      country: data.country,
      region: data.regionName,
      city: data.city,
      isp: data.isp,
      asn: data.as, // shape: "AS15169 Google LLC"
    };
    rememberIpGeo(ip, geo);
    return geo;
  } catch {
    return {};
  }
}

// ---------- User-agent parsing -----------------------------------

export interface ParsedUa {
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  isHeadless: boolean;
}

const HEADLESS_PATTERNS = [
  /HeadlessChrome/i,
  /PhantomJS/i,
  /Slimerjs/i,
  /puppeteer/i,
  /playwright/i,
  /python-requests/i,
  /curl\//i,
  /Go-http-client/i,
  /axios/i,
  /node-fetch/i,
  /bot|spider|crawler/i,
];

function matchVersion(ua: string, re: RegExp): string | undefined {
  const m = ua.match(re);
  return m?.[1];
}

export function parseUserAgent(ua: string | undefined | null): ParsedUa {
  if (!ua) {
    return { deviceType: "unknown", isHeadless: false };
  }

  let deviceType: ParsedUa["deviceType"] = "desktop";
  if (/iPad|tablet/i.test(ua)) deviceType = "tablet";
  else if (/mobile|iPhone|iPod|Android.*Mobile/i.test(ua)) deviceType = "mobile";

  let browser: string | undefined;
  let browserVersion: string | undefined;
  if (/Edg\//.test(ua)) {
    browser = "Edge";
    browserVersion = matchVersion(ua, /Edg\/([\d.]+)/);
  } else if (/OPR\/|Opera/.test(ua)) {
    browser = "Opera";
    browserVersion = matchVersion(ua, /(?:OPR|Opera)\/([\d.]+)/);
  } else if (/Firefox\//.test(ua)) {
    browser = "Firefox";
    browserVersion = matchVersion(ua, /Firefox\/([\d.]+)/);
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = "Chrome";
    browserVersion = matchVersion(ua, /Chrome\/([\d.]+)/);
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = "Safari";
    browserVersion = matchVersion(ua, /Version\/([\d.]+)/);
  }

  let os: string | undefined;
  let osVersion: string | undefined;
  if (/Windows NT/.test(ua)) {
    os = "Windows";
    osVersion = matchVersion(ua, /Windows NT ([\d.]+)/);
  } else if (/Mac OS X/.test(ua)) {
    os = "macOS";
    osVersion = matchVersion(ua, /Mac OS X ([\d_.]+)/)?.replace(/_/g, ".");
  } else if (/Android/.test(ua)) {
    os = "Android";
    osVersion = matchVersion(ua, /Android ([\d.]+)/);
  } else if (/iPhone OS|iPad; CPU OS/.test(ua)) {
    os = "iOS";
    osVersion = matchVersion(ua, /OS ([\d_]+)/)?.replace(/_/g, ".");
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  }

  const isHeadless = HEADLESS_PATTERNS.some((re) => re.test(ua));

  return { deviceType, browser, browserVersion, os, osVersion, isHeadless };
}

// ---------- Persona inference ------------------------------------

export interface PersonaResult {
  persona: string;
  confidence: number; // 0-100
  reasoning: string[];
}

interface PersonaRule {
  persona: string;
  match: (path: string) => boolean;
  // weight contributed per matched page
  weight: number;
  // human-readable explanation
  reason: (count: number) => string;
}

const PERSONA_RULES: PersonaRule[] = [
  {
    persona: "victim-portal",
    match: (p) => p.startsWith("/portal") || p.startsWith("/secure-portal") || p === "/request-access-key",
    weight: 30,
    reason: (n) => `Visited portal/access pages ${n} time(s) — appears to be a complainant`,
  },
  {
    persona: "scam-research",
    match: (p) => p.includes("scam-alert") || p.includes("alerts") || p.includes("verify"),
    weight: 25,
    reason: (n) => `Viewed ${n} scam-alert/verification page(s) — likely researching a suspicious party`,
  },
  {
    persona: "researcher",
    match: (p) => p.startsWith("/legal") || p.includes("resources"),
    weight: 20,
    reason: (n) => `Read ${n} legal/resource page(s) — research-oriented browsing`,
  },
  {
    persona: "community",
    match: (p) => p.startsWith("/community"),
    weight: 15,
    reason: (n) => `Engaged with community pages ${n} time(s)`,
  },
  {
    persona: "department-prospect",
    match: (p) => p.startsWith("/division") || p.startsWith("/departments"),
    weight: 15,
    reason: (n) => `Browsed department/division pages ${n} time(s) — evaluating services`,
  },
  {
    persona: "admin-staff",
    match: (p) => p.startsWith("/admin"),
    weight: 50,
    reason: (n) => `Accessed admin pages ${n} time(s)`,
  },
];

export function inferPersona(
  pageTimeline: Array<{ path: string }> | undefined,
  hadChat: boolean,
  caseId: string | null | undefined,
): PersonaResult {
  const paths = (pageTimeline ?? []).map((p) => p.path).filter(Boolean);
  if (paths.length === 0) {
    return {
      persona: "unknown",
      confidence: 0,
      reasoning: ["No page activity recorded yet"],
    };
  }

  const scores = new Map<string, { score: number; count: number; reason: string }>();
  for (const rule of PERSONA_RULES) {
    const matchCount = paths.filter(rule.match).length;
    if (matchCount === 0) continue;
    const score = matchCount * rule.weight;
    scores.set(rule.persona, {
      score,
      count: matchCount,
      reason: rule.reason(matchCount),
    });
  }

  // Boost the victim-portal persona if they actually have an open case or
  // started a chat — those are strong signals beyond just URL patterns.
  if (caseId) {
    const existing = scores.get("victim-portal") ?? { score: 0, count: 0, reason: "Linked to an open case" };
    scores.set("victim-portal", {
      score: existing.score + 40,
      count: existing.count,
      reason: existing.count > 0 ? `${existing.reason}; linked to an open case` : "Linked to an open case",
    });
  }
  if (hadChat) {
    const existing = scores.get("victim-portal") ?? { score: 0, count: 0, reason: "Initiated a live chat" };
    scores.set("victim-portal", {
      score: existing.score + 20,
      count: existing.count,
      reason: existing.count > 0 || caseId ? `${existing.reason}; initiated a live chat` : "Initiated a live chat",
    });
  }

  if (scores.size === 0) {
    return {
      persona: "browser",
      confidence: 30,
      reasoning: [`Visited ${paths.length} page(s) without matching any specific intent pattern`],
    };
  }

  // Pick the highest-scoring persona; record the top three reasons for context.
  const ranked = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
  const [topName, topInfo] = ranked[0];
  const reasoning = ranked.slice(0, 3).map(([, info]) => info.reason);

  // Confidence: cap at 100, scale so a single matching page gives ~ rule.weight,
  // and a deeply engaged victim/researcher easily reaches 80+.
  const confidence = Math.min(100, topInfo.score);

  return { persona: topName, confidence, reasoning };
}

// ---------- Risk scoring ------------------------------------------

export interface RiskFlag {
  flag: string;
  reason: string;
  weight: number;
}

export interface RiskResult {
  score: number; // 0-100
  flags: RiskFlag[];
}

interface RiskInput {
  ua: string | undefined | null;
  parsedUa: ParsedUa;
  pageTimeline: Array<{ path: string; enteredAt: number }> | undefined;
  pageViewCount: number | null | undefined;
  sessionStartedAt: Date;
  lastHeartbeatAt: Date;
  referrer: string | null | undefined;
  asn: string | null | undefined;
  hadChat: boolean;
}

const DATACENTER_ASN_HINTS = [
  /amazon|aws/i,
  /google|gcp/i,
  /microsoft|azure/i,
  /digitalocean/i,
  /linode|akamai/i,
  /ovh/i,
  /hetzner/i,
  /vultr/i,
  /alibaba/i,
  /tencent/i,
  /cloudflare/i,
  /oracle/i,
];

export function computeRiskScore(input: RiskInput): RiskResult {
  const flags: RiskFlag[] = [];

  if (!input.ua || input.ua.trim().length < 10) {
    flags.push({ flag: "missing-ua", reason: "User-agent string is missing or implausibly short", weight: 35 });
  }
  if (input.parsedUa.isHeadless) {
    flags.push({ flag: "headless-or-bot-ua", reason: "User-agent matches a known headless browser, scraper, or bot", weight: 50 });
  }

  const timeline = input.pageTimeline ?? [];
  if (timeline.length >= 5) {
    // Compute average inter-page interval in seconds
    let intervals = 0;
    let total = 0;
    for (let i = 1; i < timeline.length; i++) {
      const dt = (timeline[i].enteredAt - timeline[i - 1].enteredAt) / 1000;
      if (dt >= 0) {
        total += dt;
        intervals++;
      }
    }
    if (intervals > 0) {
      const avgSec = total / intervals;
      if (avgSec < 1.0) {
        flags.push({
          flag: "rapid-page-turns",
          reason: `Averaged ${avgSec.toFixed(2)}s between page views across ${timeline.length} pages`,
          weight: 30,
        });
      }
    }
  }

  if (!input.referrer && (input.pageViewCount ?? 0) === 1) {
    // Could be normal direct navigation, mild signal
    flags.push({ flag: "no-referrer-bounce", reason: "Single page view with no referrer", weight: 5 });
  }

  if (input.asn && DATACENTER_ASN_HINTS.some((re) => re.test(input.asn!))) {
    flags.push({
      flag: "datacenter-ip",
      reason: `IP belongs to a datacenter/cloud ASN (${input.asn}) — unusual for a consumer browser`,
      weight: 25,
    });
  }

  // Very long session with no chat and very few pages — possible scraper sitting on a page
  const ageMin = (input.lastHeartbeatAt.getTime() - input.sessionStartedAt.getTime()) / 60000;
  if (ageMin > 30 && (input.pageViewCount ?? 0) <= 1 && !input.hadChat) {
    flags.push({
      flag: "long-idle-session",
      reason: `Session open for ${Math.round(ageMin)}m with only 1 page view and no chat`,
      weight: 10,
    });
  }

  // Score is the sum of weights, capped at 100. We deliberately don't
  // average — multiple weak signals should still combine into a higher
  // total risk than any single one alone.
  const score = Math.min(100, flags.reduce((sum, f) => sum + f.weight, 0));

  return { score, flags };
}
