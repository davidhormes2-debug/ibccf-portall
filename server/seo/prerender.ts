import fs from "fs";
import path from "path";

export const SEO_SUPPORTED_LOCALES = [
  { code: "en", bcp47: "en" },
  { code: "es", bcp47: "es" },
  { code: "fr", bcp47: "fr" },
  { code: "de", bcp47: "de" },
  { code: "pt", bcp47: "pt" },
  { code: "zh", bcp47: "zh-CN" },
] as const;

export const SEO_DEFAULT_LOCALE = "en";

export type SeoLocaleCode = (typeof SEO_SUPPORTED_LOCALES)[number]["code"];

const CANONICAL_HOST = "ibccf.site";

interface RouteCopy {
  title: string;
  description: string;
  h1: string;
  intro: string;
}

interface SeoBundle {
  site: { name: string; fullName: string; tagline: string };
  routes: Record<string, RouteCopy>;
  divisions: Record<string, RouteCopy>;
}

export const SEO_DIVISION_IDS = [
  "aml",
  "cyber",
  "recovery",
  "compliance",
  "intelligence",
  "support",
] as const;

export const SEO_STATIC_ROUTES: Record<string, keyof SeoBundle["routes"]> = {
  "/": "home",
  "/verify": "verify",
  "/community": "community",
  "/request-access": "requestAccess",
  "/legal-resources": "legalResources",
  "/privacy-policy": "privacyPolicy",
  "/terms-of-use": "termsOfUse",
  "/withdrawal-guide": "withdrawalGuide",
};

const DIVISION_IDS = SEO_DIVISION_IDS;
const STATIC_ROUTES = SEO_STATIC_ROUTES;

function findLocalesDir(): string | null {
  // Resolve the on-disk location of the translation JSONs. This module is
  // loaded both as ESM (dev via tsx) and as part of a CJS bundle (prod
  // `dist/index.cjs`, built with esbuild `format:"cjs"`). In CJS output
  // esbuild strips `import.meta` to `{}`, so anchoring on it directly
  // would throw `path.resolve(undefined, ...)` at request time. The
  // bundle exposes `__dirname` natively and dev exposes `import.meta`,
  // so we read both defensively and probe a list of well-known relative
  // layouts — first match (with the expected `<lang>/seo.json` inside)
  // wins.
  const dirnameCandidates: string[] = [];
  if (typeof __dirname === "string" && __dirname.length > 0) {
    dirnameCandidates.push(__dirname);
  }
  try {
    const meta = import.meta as { dirname?: unknown };
    if (typeof meta.dirname === "string" && meta.dirname.length > 0) {
      dirnameCandidates.push(meta.dirname);
    }
  } catch {
    // `import.meta` is unavailable in some bundler outputs — ignore.
  }

  const candidates: string[] = [];
  for (const base of dirnameCandidates) {
    candidates.push(
      // Bundled prod: dist/index.cjs → dist/i18n-locales
      path.resolve(base, "i18n-locales"),
      // Bundled prod (alt layout, e.g. dist/server/index.cjs)
      path.resolve(base, "..", "i18n-locales"),
      // Dev (server/seo/prerender.ts → client/src/i18n/locales)
      path.resolve(base, "..", "..", "client", "src", "i18n", "locales"),
    );
  }
  candidates.push(
    path.resolve(process.cwd(), "dist", "i18n-locales"),
    path.resolve(process.cwd(), "client", "src", "i18n", "locales"),
  );

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, SEO_DEFAULT_LOCALE, "seo.json"))) {
        return dir;
      }
    } catch {
      // ignore individual probe errors and keep trying
    }
  }
  return null;
}

const bundleCache = new Map<string, SeoBundle>();

function loadBundle(locale: SeoLocaleCode): SeoBundle | null {
  const cached = bundleCache.get(locale);
  if (cached) return cached;
  const dir = findLocalesDir();
  if (!dir) return null;
  const file = path.join(dir, locale, "seo.json");
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as SeoBundle;
    bundleCache.set(locale, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function normalizeLocale(input: string | undefined | null): SeoLocaleCode {
  if (!input) return SEO_DEFAULT_LOCALE;
  // Handle Accept-Language with q-values and region tags, plus our own
  // x-www-form-urlencoded ?lang= values.
  const first = input.split(",")[0]?.trim() ?? "";
  const base = first.split(";")[0]!.trim().toLowerCase().split("-")[0];
  const match = SEO_SUPPORTED_LOCALES.find((l) => l.code === base);
  return (match?.code ?? SEO_DEFAULT_LOCALE) as SeoLocaleCode;
}

export function resolveLocaleForRequest(
  url: string,
  acceptLanguage: string | undefined,
): SeoLocaleCode {
  // Parse `?lang=` off the path (we don't have a real URL object yet because
  // the request URL may be relative).
  const qIdx = url.indexOf("?");
  if (qIdx >= 0) {
    const search = url.slice(qIdx + 1);
    for (const pair of search.split("&")) {
      const [k, v] = pair.split("=");
      if (k === "lang" && v) {
        return normalizeLocale(decodeURIComponent(v));
      }
    }
  }
  // Fall back to Accept-Language so crawlers without an explicit ?lang= still
  // get a localised payload when they advertise a non-English preference.
  return normalizeLocale(acceptLanguage);
}

function routeCopyForPath(
  bundle: SeoBundle,
  pathname: string,
): RouteCopy | null {
  if (pathname.startsWith("/divisions/")) {
    const id = pathname.slice("/divisions/".length).split("/")[0];
    if ((DIVISION_IDS as readonly string[]).includes(id)) {
      return bundle.divisions[id] ?? null;
    }
    return null;
  }
  // Strip trailing slash so `/verify/` and `/verify` resolve identically.
  const trimmed = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  const key = STATIC_ROUTES[trimmed];
  return key ? bundle.routes[key] ?? null : null;
}

// Real SPA routes that intentionally are NOT search-facing (authenticated
// app shells, session-gated support flows, admin surfaces reached without
// the `/admin` prefix guard already covered by `securityHeaders()`). These
// must still resolve to a real page for a signed-in user hitting the URL
// directly, so they are excluded from the "unknown URL" 404 path in
// `server/static.ts` — but they should never be treated as indexable
// marketing content either. Kept here as the single source of truth so
// `server/static.ts` and `server/middleware/security.ts` don't drift.
export const KNOWN_NON_INDEXABLE_APP_ROUTES: ReadonlySet<string> = new Set([
  "/dashboard",
  "/admin",
  "/admin/mirror",
  "/admin/mobile",
  "/admin/support",
  "/contact-admin",
]);

export function isKnownAppPath(pathname: string): boolean {
  const trimmed = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return isPrerenderablePath(trimmed) || KNOWN_NON_INDEXABLE_APP_ROUTES.has(trimmed);
}

export function isPrerenderablePath(pathname: string): boolean {
  if (pathname.startsWith("/divisions/")) {
    const id = pathname.slice("/divisions/".length).split("/")[0];
    return (DIVISION_IDS as readonly string[]).includes(id);
  }
  const trimmed = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return Object.prototype.hasOwnProperty.call(STATIC_ROUTES, trimmed);
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attrEscape(value: string): string {
  return htmlEscape(value);
}

// Canonical SEO URLs must never depend on the incoming request host. Preview
// domains, `x-forwarded-host` overrides, or any alternate hostname that
// happens to serve this app would otherwise self-canonicalize as the source
// of truth, splitting crawl/index authority across duplicate hosts. Every
// prerendered `<link rel="canonical">`, `og:url`, and `hreflang` alternate
// is anchored on the single production origin instead. `host`/`proto` are
// still accepted on `PrerenderInput` for logging/back-compat but are no
// longer consulted here.
function resolveBaseUrl(
  _host: string | undefined,
  _proto: string | undefined,
): string {
  return `https://${CANONICAL_HOST}`;
}

function localeHref(baseUrl: string, pathname: string, code: SeoLocaleCode): string {
  if (code === SEO_DEFAULT_LOCALE) return `${baseUrl}${pathname}`;
  const sep = pathname.includes("?") ? "&" : "?";
  return `${baseUrl}${pathname}${sep}lang=${code}`;
}

export interface PrerenderInput {
  template: string;
  url: string;
  acceptLanguage: string | undefined;
  host: string | undefined;
  proto: string | undefined;
  // Per-deploy identifier injected as <meta name="build-stamp"> so support
  // can ask a visitor to view-source and read which release they are on
  // without parsing response headers. Resolved by the caller from the
  // server/static.ts source of truth and threaded through so it always
  // matches the X-Build-Stamp header and ETag prefix for the same response.
  buildStamp?: string;
}

export function prerenderIndexHtml(input: PrerenderInput): {
  html: string;
  locale: SeoLocaleCode;
  rewrote: boolean;
} {
  const { template, url, acceptLanguage, host, proto, buildStamp } = input;
  const locale = resolveLocaleForRequest(url, acceptLanguage);

  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;

  if (!isPrerenderablePath(pathname)) {
    return { html: template, locale, rewrote: false };
  }

  const bundle = loadBundle(locale) ?? loadBundle(SEO_DEFAULT_LOCALE);
  if (!bundle) {
    return { html: template, locale, rewrote: false };
  }

  const copy = routeCopyForPath(bundle, pathname);
  if (!copy) {
    return { html: template, locale, rewrote: false };
  }

  const localeMeta = SEO_SUPPORTED_LOCALES.find((l) => l.code === locale)!;
  const baseUrl = resolveBaseUrl(host, proto);
  const canonical = localeHref(baseUrl, pathname, locale);

  let html = template;

  // <html lang="...">
  html = html.replace(
    /<html(\s[^>]*?)?\blang="[^"]*"/i,
    (_m, attrs = "") => `<html${attrs ?? ""} lang="${attrEscape(localeMeta.bcp47)}"`.replace(/\s+/, " "),
  );
  if (!/<html[^>]*\blang=/i.test(html)) {
    html = html.replace(/<html(\s[^>]*)?>/i, (_m, attrs = "") =>
      `<html${attrs ?? ""} lang="${attrEscape(localeMeta.bcp47)}">`,
    );
  }

  // <title>
  html = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${htmlEscape(copy.title)}</title>`,
  );

  // <meta name="description">
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${attrEscape(copy.description)}" />`,
  );

  // OG + Twitter mirrors so social previews also get the localised copy.
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${attrEscape(copy.title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${attrEscape(copy.description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${attrEscape(canonical)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${attrEscape(copy.title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${attrEscape(copy.description)}" />`,
  );

  // og:image / twitter:image must be absolute URLs — some Open Graph and
  // Twitter Card consumers resolve relative image paths inconsistently (or
  // not at all). Rewrite both against the same baseUrl used for canonical /
  // og:url so a prerendered response always ships a fully-qualified image.
  html = html.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:image" content="${attrEscape(`${baseUrl}/opengraph.jpg`)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image" content="${attrEscape(`${baseUrl}/opengraph.jpg`)}" />`,
  );

  // Canonical URL points at the localised variant; hreflang alternates for
  // every supported locale + x-default mirror what sitemap.xml emits so the
  // signals stay consistent whether the crawler arrives via sitemap or by
  // following an in-page link.
  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${attrEscape(canonical)}" />`,
  );
  const altLinks: string[] = [];
  for (const l of SEO_SUPPORTED_LOCALES) {
    altLinks.push(
      `<link rel="alternate" hreflang="${attrEscape(l.code)}" href="${attrEscape(
        localeHref(baseUrl, pathname, l.code),
      )}" />`,
    );
  }
  altLinks.push(
    `<link rel="alternate" hreflang="x-default" href="${attrEscape(
      localeHref(baseUrl, pathname, SEO_DEFAULT_LOCALE),
    )}" />`,
  );
  // Drop any pre-existing hreflang links from a prior pass, then inject the
  // freshly-computed set just before </head>.
  html = html.replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>/gi, "");
  html = html.replace(/<\/head>/i, `${altLinks.map((l) => `    ${l}`).join("\n")}\n  </head>`);

  // Localised JSON-LD structured data. The static shell in client/index.html
  // ships a generic (English) Organization + WebSite block as a fallback for
  // non-prerendered responses; for prerendered marketing routes we replace
  // it with a locale-aware graph (anchored on the same canonical baseUrl as
  // the rest of this response) that adds a route-level WebPage (or
  // BreadcrumbList for division pages) so crawlers get entity + page-purpose
  // signals consistent with canonical/og:url instead of a static English
  // fallback block.
  const orgId = `${baseUrl}/#organization`;
  const websiteId = `${baseUrl}/#website`;
  const graph: unknown[] = [
    {
      "@type": "Organization",
      "@id": orgId,
      name: bundle.site.name,
      alternateName: bundle.site.fullName,
      url: `${baseUrl}/`,
      logo: `${baseUrl}/icons/icon-192x192.svg`,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: bundle.site.name,
      url: `${baseUrl}/`,
      publisher: { "@id": orgId },
      inLanguage: localeMeta.bcp47,
    },
  ];

  if (pathname.startsWith("/divisions/")) {
    const homeCopy = bundle.routes.home;
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: homeCopy?.title ?? bundle.site.name,
          item: localeHref(baseUrl, "/", locale),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: copy.title,
          item: canonical,
        },
      ],
    });
    graph.push({
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: copy.title,
      description: copy.description,
      inLanguage: localeMeta.bcp47,
      isPartOf: { "@id": websiteId },
      about: { "@id": orgId },
      breadcrumb: `${canonical}#breadcrumb`,
    });
  } else {
    graph.push({
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: copy.title,
      description: copy.description,
      inLanguage: localeMeta.bcp47,
      isPartOf: { "@id": websiteId },
      about: { "@id": orgId },
    });
  }

  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  // JSON-LD is embedded inside a <script> element, so `</script>` (or any
  // `</` sequence) in a translated string must be escaped — otherwise a
  // malicious/careless translation could prematurely close the script tag.
  const safeJsonLd = jsonLd.replace(/<\/script/gi, "<\\/script");
  html = html.replace(
    /\s*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
    `\n    <script type="application/ld+json">\n    ${safeJsonLd}\n    </script>`,
  );

  // Per-deploy build identifier as a view-source-readable meta tag so
  // support can ask a visitor "what does <meta name='build-stamp'> say?"
  // without curling the X-Build-Stamp header. Always re-emit (drop any
  // prior pass first) so a re-render with a new stamp doesn't leave a
  // stale tag behind alongside the new one.
  if (buildStamp) {
    html = html.replace(/\s*<meta\s+name="build-stamp"\s+content="[^"]*"\s*\/?>/gi, "");
    html = html.replace(
      /<\/head>/i,
      `    <meta name="build-stamp" content="${attrEscape(buildStamp)}" />\n  </head>`,
    );
  }

  // SEO body block: this content lives inside <div id="root"> and is wiped
  // the moment React calls createRoot().render() — verified in client/src/
  // main.tsx. Crawlers that don't run JS see a fully visible, semantically
  // structured localised landing block (h1 + intro + brand line). The
  // styling is deliberately plain and matches the brand palette so the
  // ~one-frame flash before hydration looks like a load state rather than
  // an off-screen / hidden-text pattern (which would risk cloaking flags).
  const seoBody =
    `<div data-prerender="true" data-locale="${attrEscape(locale)}" ` +
    `style="min-height:100vh;background:#0a1840;color:#f8fafc;` +
    `font-family:'Public Sans',system-ui,sans-serif;padding:48px 24px;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    `text-align:center;gap:16px;">` +
    `<p style="margin:0;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;">` +
    `${htmlEscape(bundle.site.fullName)}` +
    `</p>` +
    `<h1 style="margin:0;max-width:880px;font-family:'Merriweather',Georgia,serif;` +
    `font-size:clamp(28px,5vw,52px);line-height:1.15;">` +
    `${htmlEscape(copy.h1)}` +
    `</h1>` +
    `<p style="margin:0;max-width:720px;font-size:clamp(16px,2vw,18px);line-height:1.6;opacity:0.85;">` +
    `${htmlEscape(copy.intro)}` +
    `</p>` +
    `</div>`;
  html = html.replace(
    /<div\s+id="root"\s*>\s*<\/div>/i,
    `<div id="root">${seoBody}</div>`,
  );

  return { html, locale, rewrote: true };
}

// ---------------------------------------------------------------------------
// Bounded (pathname, locale, baseUrl) → rendered HTML cache.
//
// The translation bundles and the built `index.html` only change on
// redeploy. Each marketing-route response is therefore fully determined by
// (pathname, locale, baseUrl) once we've resolved them. Memoising the final
// HTML turns the hot path into a single Map lookup and avoids re-running
// eight regex replaces + a JSON parse on every request.
//
// The cache lives in module scope so it is dropped on process start
// (no stale strings across deploys). It is bounded so unexpected paths
// (e.g. random crawler probes that still hit `isPrerenderablePath`-allowed
// templates with varied baseUrls) can't grow it unbounded — we evict the
// oldest entry once we exceed the cap (Map iteration order = insertion
// order, so the first key is the least-recently-inserted).
// ---------------------------------------------------------------------------

const PRERENDER_CACHE_MAX = 256;
const prerenderCache = new Map<
  string,
  { html: string; locale: SeoLocaleCode; rewrote: boolean }
>();

function cacheKey(
  pathname: string,
  locale: SeoLocaleCode,
  baseUrl: string,
  buildStamp: string | undefined,
): string {
  // Include the build stamp in the key so a re-resolve after a deploy
  // (when buildStamp would change) produces a fresh entry rather than
  // serving the previous deploy's HTML — the cached HTML embeds the
  // <meta name="build-stamp"> value and would otherwise drift from the
  // live BUILD_STAMP / X-Build-Stamp header.
  return `${baseUrl}\n${locale}\n${pathname}\n${buildStamp ?? ""}`;
}

export function prerenderIndexHtmlCached(input: PrerenderInput): {
  html: string;
  locale: SeoLocaleCode;
  rewrote: boolean;
} {
  const { url, acceptLanguage, host, proto } = input;
  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;

  // Only cache for the bounded set of marketing routes; anything else
  // returns the untouched template and we don't want random URLs filling
  // the map.
  if (!isPrerenderablePath(pathname)) {
    return { html: input.template, locale: resolveLocaleForRequest(url, acceptLanguage), rewrote: false };
  }

  const locale = resolveLocaleForRequest(url, acceptLanguage);
  const baseUrl = resolveBaseUrl(host, proto);
  const key = cacheKey(pathname, locale, baseUrl, input.buildStamp);

  const hit = prerenderCache.get(key);
  if (hit) {
    // Refresh recency by re-inserting (Map preserves insertion order).
    prerenderCache.delete(key);
    prerenderCache.set(key, hit);
    return hit;
  }

  const result = prerenderIndexHtml(input);
  // Don't poison the cache with the "couldn't render" fallback — those
  // paths return the raw template and won't benefit from memoisation.
  if (!result.rewrote) {
    return result;
  }

  prerenderCache.set(key, result);
  if (prerenderCache.size > PRERENDER_CACHE_MAX) {
    const oldest = prerenderCache.keys().next().value;
    if (oldest !== undefined) prerenderCache.delete(oldest);
  }
  return result;
}

export function __resetPrerenderCacheForTests(): void {
  prerenderCache.clear();
}

export function __prerenderCacheSizeForTests(): number {
  return prerenderCache.size;
}

// ---------------------------------------------------------------------------
// Community thread permalinks (`/community/:threadId`)
//
// Unlike the static marketing routes above, thread metadata is dynamic and
// lives in the database, so it can't be pre-baked into `seo.json`. The caller
// (server/static.ts, server/vite.ts) is responsible for resolving the thread
// row and passing it in — this module stays free of any DB import so it
// remains a pure, easily-testable string transform.
// ---------------------------------------------------------------------------

// Mirrors `COMMUNITY_THREAD_PATH_RE` in `client/src/i18n/useHreflangTags.ts` —
// both must be updated together.
const COMMUNITY_THREAD_PATH_RE = /^\/community\/(\d+)$/;

export function matchCommunityThreadPath(pathname: string): number | null {
  const m = pathname.match(COMMUNITY_THREAD_PATH_RE);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export interface CommunityThreadSeoData {
  id: number;
  title: string;
  content: string;
  authorHandle: string;
  createdAt: string | Date;
  viewCount: number;
  replyCount: number;
}

export interface CommunityThreadPrerenderInput extends PrerenderInput {
  // `null` means the thread does not exist, or is hidden/flagged — the
  // permalink still resolves (the SPA renders its own "not found" state)
  // but we must not fabricate SEO content for it and should mark it
  // noindex so a stale/moderated URL never gets indexed.
  thread: CommunityThreadSeoData | null;
}

function truncateForDescription(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

export function prerenderCommunityThreadHtml(
  input: CommunityThreadPrerenderInput,
): { html: string; locale: SeoLocaleCode; rewrote: boolean; found: boolean } {
  const { template, url, acceptLanguage, host, proto, buildStamp, thread } = input;
  const locale = resolveLocaleForRequest(url, acceptLanguage);

  const qIdx = url.indexOf("?");
  const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
  if (matchCommunityThreadPath(pathname) === null) {
    return { html: template, locale, rewrote: false, found: false };
  }

  const bundle = loadBundle(locale) ?? loadBundle(SEO_DEFAULT_LOCALE);
  const siteName = bundle?.site.name ?? "IBCCF";
  const localeMeta = SEO_SUPPORTED_LOCALES.find((l) => l.code === locale)!;
  const baseUrl = resolveBaseUrl(host, proto);
  const canonical = localeHref(baseUrl, pathname, locale);

  let html = template;

  html = html.replace(
    /<html(\s[^>]*?)?\blang="[^"]*"/i,
    (_m, attrs = "") => `<html${attrs ?? ""} lang="${attrEscape(localeMeta.bcp47)}"`.replace(/\s+/, " "),
  );
  if (!/<html[^>]*\blang=/i.test(html)) {
    html = html.replace(/<html(\s[^>]*)?>/i, (_m, attrs = "") =>
      `<html${attrs ?? ""} lang="${attrEscape(localeMeta.bcp47)}">`,
    );
  }

  const title = thread
    ? `${thread.title} — Community Discussion | ${siteName}`
    : `Discussion Not Found | ${siteName}`;
  const description = thread
    ? truncateForDescription(thread.content, 160)
    : "This community discussion is unavailable or has been removed.";

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlEscape(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${attrEscape(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${attrEscape(title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${attrEscape(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${attrEscape(canonical)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${attrEscape(title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${attrEscape(description)}" />`,
  );

  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${attrEscape(canonical)}" />`,
  );

  const altLinks: string[] = [];
  for (const l of SEO_SUPPORTED_LOCALES) {
    altLinks.push(
      `<link rel="alternate" hreflang="${attrEscape(l.code)}" href="${attrEscape(
        localeHref(baseUrl, pathname, l.code),
      )}" />`,
    );
  }
  altLinks.push(
    `<link rel="alternate" hreflang="x-default" href="${attrEscape(
      localeHref(baseUrl, pathname, SEO_DEFAULT_LOCALE),
    )}" />`,
  );
  html = html.replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>/gi, "");
  html = html.replace(/<\/head>/i, `${altLinks.map((l) => `    ${l}`).join("\n")}\n  </head>`);

  if (buildStamp) {
    html = html.replace(/\s*<meta\s+name="build-stamp"\s+content="[^"]*"\s*\/?>/gi, "");
    html = html.replace(
      /<\/head>/i,
      `    <meta name="build-stamp" content="${attrEscape(buildStamp)}" />\n  </head>`,
    );
  }

  // A missing/hidden thread still resolves the permalink (the SPA shows its
  // own not-found state) but must never be advertised as indexable.
  if (!thread) {
    html = html.replace(/\s*<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/gi, "");
    html = html.replace(
      /<\/head>/i,
      `    <meta name="robots" content="noindex, follow" />\n  </head>`,
    );
  }

  if (thread) {
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "DiscussionForumPosting",
      headline: thread.title,
      text: thread.content,
      url: canonical,
      datePublished: new Date(thread.createdAt).toISOString(),
      author: { "@type": "Person", name: thread.authorHandle },
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/ViewAction",
          userInteractionCount: thread.viewCount,
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/CommentAction",
          userInteractionCount: thread.replyCount,
        },
      ],
      isPartOf: { "@type": "WebSite", name: siteName, url: baseUrl },
    };
    const jsonLdScript =
      `<script type="application/ld+json" data-community-thread-seo>` +
      `${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;
    html = html.replace(
      /\s*<script type="application\/ld\+json" data-community-thread-seo>[\s\S]*?<\/script>/gi,
      "",
    );
    html = html.replace(/<\/head>/i, `    ${jsonLdScript}\n  </head>`);
  }

  const eyebrow = `${htmlEscape(siteName)} Community`;
  const heading = htmlEscape(thread ? thread.title : "Discussion Not Found");
  const seoBody =
    `<div data-prerender="true" data-locale="${attrEscape(locale)}" ` +
    `style="min-height:100vh;background:#0a1840;color:#f8fafc;` +
    `font-family:'Public Sans',system-ui,sans-serif;padding:48px 24px;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    `text-align:center;gap:16px;">` +
    `<p style="margin:0;font-size:14px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;">` +
    `${eyebrow}` +
    `</p>` +
    `<h1 style="margin:0;max-width:880px;font-family:'Merriweather',Georgia,serif;` +
    `font-size:clamp(28px,5vw,52px);line-height:1.15;">` +
    `${heading}` +
    `</h1>` +
    `<p style="margin:0;max-width:720px;font-size:clamp(16px,2vw,18px);line-height:1.6;opacity:0.85;">` +
    `${htmlEscape(description)}` +
    `</p>` +
    `</div>`;
  html = html.replace(
    /<div\s+id="root"\s*>\s*<\/div>/i,
    `<div id="root">${seoBody}</div>`,
  );

  return { html, locale, rewrote: true, found: !!thread };
}
