import { Router, type Request } from "express";
import { db } from "../db";
import { communityThreads } from "@shared/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";

export const sitemapRouter = Router();

// Bounds how many individual thread permalinks are listed in the sitemap.
// Crawlers discover older/less-active threads by following in-page links
// from `/community` rather than via the sitemap, so this only needs to
// cover the actively-discussed set.
const COMMUNITY_THREAD_SITEMAP_LIMIT = 500;

const CANONICAL_HOST = "ibccf.site";

// Locale codes that match `client/src/i18n/locales/<code>/`. Kept inline so
// the server bundle stays decoupled from the Vite-built client. Update both
// lists together when adding a new language. The first entry is the default
// (no `?lang=` query string emitted) and is also surfaced as `x-default`.
const SUPPORTED_LOCALE_CODES = ["en", "es", "fr", "de", "pt", "zh"] as const;
const DEFAULT_LOCALE_CODE = "en";

function localeHref(baseUrl: string, path: string, code: string): string {
  if (code === DEFAULT_LOCALE_CODE) {
    return `${baseUrl}${path}`;
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${baseUrl}${path}${sep}lang=${code}`;
}

export const STATIC_PUBLIC_PATHS: ReadonlyArray<{
  path: string;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: string;
}> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/verify", changefreq: "weekly", priority: "0.8" },
  { path: "/community", changefreq: "daily", priority: "0.8" },
  { path: "/request-access", changefreq: "monthly", priority: "0.7" },
  { path: "/legal-resources", changefreq: "monthly", priority: "0.6" },
  { path: "/privacy-policy", changefreq: "yearly", priority: "0.4" },
  { path: "/terms-of-use", changefreq: "yearly", priority: "0.4" },
  { path: "/withdrawal-guide", changefreq: "monthly", priority: "0.7" },
];

export const DIVISION_IDS = [
  "aml",
  "cyber",
  "recovery",
  "compliance",
  "intelligence",
  "support",
] as const;

// Sitemap URLs must never depend on the incoming request host — a preview
// or staging domain hitting this route must not advertise itself as the
// `<loc>` / alternate origin. Every URL in the sitemap is anchored on the
// single production origin regardless of `host` / `x-forwarded-host`.
function resolveBaseUrl(_req: Request): string {
  return `https://${CANONICAL_HOST}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

sitemapRouter.get("/sitemap.xml", async (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  // A single `lastmod` value for the whole sitemap keeps the response
  // cheap (no DB round-trips) and still gives crawlers a fresh signal
  // every time the cache window expires. The marketing pages are
  // mostly-static, so this is accurate enough for crawl scheduling.
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls: Array<{ path: string; changefreq: string; priority: string; lastmod?: string }> = [];
  for (const entry of STATIC_PUBLIC_PATHS) {
    urls.push({
      path: entry.path,
      changefreq: entry.changefreq,
      priority: entry.priority,
    });
  }
  for (const id of DIVISION_IDS) {
    urls.push({
      path: `/divisions/${id}`,
      changefreq: "monthly",
      priority: "0.7",
    });
  }

  // Public, non-flagged community threads get their own indexable
  // permalink (`/community/:id`) — see client/src/pages/CommunityPage.tsx.
  // A sitemap failure here (e.g. transient DB error) must never break the
  // rest of the sitemap, so it's isolated in its own try/catch.
  try {
    const threads = await db
      .select({
        id: communityThreads.id,
        lastActivityAt: communityThreads.lastActivityAt,
      })
      .from(communityThreads)
      .where(
        and(
          or(
            eq(communityThreads.isFlagged, false),
            sql`${communityThreads.isFlagged} IS NULL`,
          ),
        ),
      )
      .orderBy(desc(communityThreads.lastActivityAt))
      .limit(COMMUNITY_THREAD_SITEMAP_LIMIT);

    for (const thread of threads) {
      urls.push({
        path: `/community/${thread.id}`,
        changefreq: "weekly",
        priority: "0.5",
        lastmod: thread.lastActivityAt
          ? new Date(thread.lastActivityAt).toISOString().slice(0, 10)
          : lastmod,
      });
    }
  } catch {
    // Skip thread permalinks for this response — the static/division
    // pages above are more valuable and shouldn't be lost to a DB blip.
  }

  // hreflang alternates tell Google to show the right translation per user
  // locale (and avoid flagging the localised copies as duplicate content).
  // We emit one alternate per supported locale plus `x-default` (the
  // un-prefixed English URL) for users whose language we don't ship.
  const renderAlternates = (path: string): string => {
    const lines = SUPPORTED_LOCALE_CODES.map(
      (code) =>
        `    <xhtml:link rel="alternate" hreflang="${code}" href="${xmlEscape(
          localeHref(baseUrl, path, code),
        )}" />`,
    );
    lines.push(
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
        localeHref(baseUrl, path, DEFAULT_LOCALE_CODE),
      )}" />`,
    );
    return lines.join("\n");
  };

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
    ` xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n` +
          `    <loc>${xmlEscape(localeHref(baseUrl, u.path, DEFAULT_LOCALE_CODE))}</loc>\n` +
          `    <lastmod>${u.lastmod ?? lastmod}</lastmod>\n` +
          `    <changefreq>${u.changefreq}</changefreq>\n` +
          `    <priority>${u.priority}</priority>\n` +
          `${renderAlternates(u.path)}\n` +
          `  </url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  // The sitemap file itself shouldn't appear as a search result — it's
  // a crawler input, not a destination. `noindex` keeps the URL out of
  // the index while still allowing crawlers to fetch and follow the
  // links inside (per Google's sitemap guidance). This overrides the
  // `index, follow` value set for public paths in `securityHeaders()`.
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).send(body);
});
