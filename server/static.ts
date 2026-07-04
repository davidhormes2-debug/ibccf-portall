import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  prerenderIndexHtmlCached,
  isKnownAppPath,
  prerenderCommunityThreadHtml,
  matchCommunityThreadPath,
  type CommunityThreadSeoData,
} from "./seo/prerender";
import { db } from "./db";
import { communityThreads } from "@shared/schema";
import { eq } from "drizzle-orm";

// `__dirname` is provided natively by the CJS runtime (prod bundle built with
// esbuild). In ESM mode (dev via tsx, unit tests) it is undefined — derive the
// equivalent from `import.meta.url` so `serveStatic` can locate `dist/public`.
const _serverDir: string = (() => {
  if (typeof __dirname === "string" && __dirname.length > 0) return __dirname;
  try {
    const metaUrl = (import.meta as { url?: string }).url;
    if (metaUrl) return path.dirname(fileURLToPath(metaUrl));
  } catch {
    // ignore
  }
  return path.join(process.cwd(), "server");
})();

// Cache freshness window for marketing HTML. The in-process prerender cache
// produces deterministic output for a given (path, locale, baseUrl) tuple
// and only changes on redeploy — but we still bound the public/edge TTL so
// an in-place content patch (translation tweak, hotfix redeploy) propagates
// within minutes rather than relying on cache busting. Conditional GETs
// (If-None-Match / If-Modified-Since) revalidate cheaply against the boot
// ETag, so a short max-age is the right trade-off.
const MARKETING_MAX_AGE_SECONDS = 300;

// Shared-cache (edge / CDN / reverse proxy) freshness window. Matches the
// browser max-age so a redeploy propagates on the same minute-scale schedule
// at every layer, but is set explicitly via `s-maxage` so an upstream cache
// uses it instead of falling back to whatever default it ships with.
const MARKETING_S_MAXAGE_SECONDS = 300;

// Window during which a shared cache is allowed to serve a stale response
// while it revalidates against origin in the background. Lets repeat hits
// during a revalidate skip the origin round-trip entirely; bounded so a
// genuinely broken deploy doesn't keep stale HTML alive for hours.
const MARKETING_STALE_WHILE_REVALIDATE_SECONDS = 600;

// Boot-time Last-Modified: HTML output is fully determined by the deployed
// artefact, so anchoring on process-start means every conditional GET in
// this deploy can short-circuit to 304.
const BOOT_TIME = new Date();
const BOOT_TIME_HTTP = BOOT_TIME.toUTCString();
const BOOT_TIME_MS = Math.floor(BOOT_TIME.getTime() / 1000) * 1000;

// Per-deploy build stamp folded into every marketing ETag. Without it, a
// hotfix redeploy that ships identical HTML (e.g. server-side fix, locale
// JSON tweak that doesn't touch the rendered route copy) would re-emit
// the same content-hash ETag, and any shared cache/edge that revalidates
// after max-age would see 304 and keep serving the previous payload.
// Prefixing with the build stamp guarantees every new deploy produces a
// fresh ETag and forces a 200 on the next revalidation — capping staleness
// to (max-age + a few seconds) per request rather than the full TTL of an
// unchanged content hash.
//
// Resolution order:
//   1. `BUILD_STAMP`         — explicit override for ops / one-off deploys
//   2. `SENTRY_RELEASE`      — set by script/build.ts (git sha or epoch ms)
//   3. boot-<epoch-seconds>  — dev fallback; stable for the lifetime of the
//                              process so 304s still work in `npm run dev`
//
// The value is normalised to the RFC 7232 entity-tag opaque-tag charset
// (letters / digits / `.` / `_` / `-`) so it embeds cleanly inside the
// quoted ETag with no need for additional escaping.
function resolveBuildStamp(): string {
  const raw =
    process.env.BUILD_STAMP ||
    process.env.SENTRY_RELEASE ||
    `boot-${Math.floor(BOOT_TIME_MS / 1000)}`;
  const sanitised = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return sanitised || `boot-${Math.floor(BOOT_TIME_MS / 1000)}`;
}
const BUILD_STAMP = resolveBuildStamp();

// Exposed so other server modules (e.g. the admin /build-info endpoint and
// the prerender meta-tag injector) read the exact same value that's folded
// into the X-Build-Stamp header and ETag. Single source of truth — never
// recompute `process.env.BUILD_STAMP` elsewhere.
export function getBuildStamp(): string {
  return BUILD_STAMP;
}

export function getBootTimeIso(): string {
  return BOOT_TIME.toISOString();
}

// Memoise ETag computation on the cached prerender result object so we
// only hash each unique (path, locale, baseUrl) HTML payload once.
const etagByResult = new WeakMap<object, string>();

function computeEtag(html: string): string {
  const digest = crypto.createHash("sha1").update(html).digest("base64");
  // Prefix with the deploy stamp so a new build invalidates every cached
  // tag from the previous deploy, even when the HTML body is byte-identical.
  return `"${BUILD_STAMP}-${digest.replace(/=+$/, "")}"`;
}

function getEtagFor(result: object, html: string): string {
  const cached = etagByResult.get(result);
  if (cached) return cached;
  const tag = computeEtag(html);
  etagByResult.set(result, tag);
  return tag;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Some proxies collapse repeated headers into a string[]; join so the
  // tag-list parse below sees every value.
  return Array.isArray(raw) ? raw.join(",") : raw;
}

function isNotModified(req: Request, etag: string): boolean {
  const inm = headerValue(req.headers["if-none-match"]);
  if (inm && inm.length > 0) {
    // RFC 7232 §6: when If-None-Match is present, it takes precedence
    // over If-Modified-Since — IMS must not be consulted in that case.
    // A non-matching INM forces a 200 even if IMS would have allowed 304.
    const tags = inm.split(",").map((t) => t.trim());
    for (const t of tags) {
      if (t === "*" || t === etag || t === `W/${etag}`) return true;
    }
    return false;
  }
  const ims = headerValue(req.headers["if-modified-since"]);
  if (ims && ims.length > 0) {
    const since = Date.parse(ims);
    if (!Number.isNaN(since) && BOOT_TIME_MS <= since) return true;
  }
  return false;
}

// Community thread SEO metadata is dynamic (DB-backed), so it can't reuse
// the static marketing-route cache above. A short TTL cache still spares the
// DB from a query on every single crawler/user hit to the same permalink —
// staleness only affects meta tags/JSON-LD, never the live page (the SPA
// fetches fresh data from the API once it hydrates).
const COMMUNITY_THREAD_SEO_TTL_MS = MARKETING_MAX_AGE_SECONDS * 1000;
const COMMUNITY_THREAD_SEO_CACHE_MAX = 200;
const communityThreadSeoCache = new Map<
  number,
  { data: CommunityThreadSeoData | null; fetchedAt: number }
>();

async function getCommunityThreadSeoData(
  id: number,
): Promise<CommunityThreadSeoData | null> {
  const cached = communityThreadSeoCache.get(id);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < COMMUNITY_THREAD_SEO_TTL_MS) {
    return cached.data;
  }

  let data: CommunityThreadSeoData | null = cached?.data ?? null;
  try {
    const [row] = await db
      .select({
        id: communityThreads.id,
        title: communityThreads.title,
        content: communityThreads.content,
        authorHandle: communityThreads.authorHandle,
        createdAt: communityThreads.createdAt,
        viewCount: communityThreads.viewCount,
        replyCount: communityThreads.replyCount,
        isFlagged: communityThreads.isFlagged,
      })
      .from(communityThreads)
      .where(eq(communityThreads.id, id));

    data =
      row && !row.isFlagged
        ? {
            id: row.id,
            title: row.title,
            content: row.content,
            authorHandle: row.authorHandle,
            createdAt: row.createdAt as unknown as string,
            viewCount: row.viewCount ?? 0,
            replyCount: row.replyCount ?? 0,
          }
        : null;
  } catch {
    // Leave `data` as whatever was previously cached (or null) — a
    // transient DB error should never crash a page render.
  }

  communityThreadSeoCache.set(id, { data, fetchedAt: now });
  if (communityThreadSeoCache.size > COMMUNITY_THREAD_SEO_CACHE_MAX) {
    const oldestKey = communityThreadSeoCache.keys().next().value;
    if (oldestKey !== undefined) communityThreadSeoCache.delete(oldestKey);
  }
  return data;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(_serverDir, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve hashed asset files, but exclude index.html — we always serve it
  // through the prerender pipeline below so the localised <title>/meta/SEO
  // body are emitted on every marketing-route request, including the root.
  app.use(express.static(distPath, { index: false }));

  const indexPath = path.resolve(distPath, "index.html");
  // Read once at boot; index.html only changes on redeploy, so caching
  // saves a disk hit per request.
  const templateCache = fs.readFileSync(indexPath, "utf-8");

  app.use("*", async (req: Request, res: Response) => {
    const pathname = req.originalUrl.split("?")[0] || "/";
    const threadId = matchCommunityThreadPath(pathname);

    const prerendered = threadId !== null
      ? prerenderCommunityThreadHtml({
          template: templateCache,
          url: req.originalUrl,
          acceptLanguage: req.headers["accept-language"] as string | undefined,
          host: (req.headers["x-forwarded-host"] as string | undefined)
            ?? (req.headers.host as string | undefined),
          proto: (req.headers["x-forwarded-proto"] as string | undefined)
            ?? req.protocol,
          buildStamp: BUILD_STAMP,
          thread: await getCommunityThreadSeoData(threadId),
        })
      : prerenderIndexHtmlCached({
          template: templateCache,
          url: req.originalUrl,
          acceptLanguage: req.headers["accept-language"] as string | undefined,
          host: (req.headers["x-forwarded-host"] as string | undefined)
            ?? (req.headers.host as string | undefined),
          proto: (req.headers["x-forwarded-proto"] as string | undefined)
            ?? req.protocol,
          buildStamp: BUILD_STAMP,
        });

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (prerendered.rewrote) {
      // Marketing route — cacheable by browsers and shared edges. Vary on
      // Accept-Language so different locales don't collide in shared caches
      // (a fr-FR visitor must not be served the cached en payload from a
      // previous en-US visitor for the same path).
      res.setHeader("Content-Language", prerendered.locale);
      res.setHeader("Vary", "Accept-Language");
      // Cache-Control directive layout:
      //   public                    — any cache (browser + shared) may store
      //   max-age                   — browser freshness window
      //   s-maxage                  — shared-cache freshness window (edge/CDN/
      //                               reverse proxy); takes precedence over
      //                               max-age in shared caches, so we set it
      //                               explicitly rather than relying on the
      //                               implicit fallback to max-age
      //   stale-while-revalidate    — shared caches may serve a stale hit
      //                               while refreshing in the background, so
      //                               repeat hits during a revalidate window
      //                               never reach origin
      //   must-revalidate           — once a browser entry is past max-age it
      //                               MUST revalidate before reuse (no offline
      //                               serving of stale marketing HTML)
      res.setHeader(
        "Cache-Control",
        `public, max-age=${MARKETING_MAX_AGE_SECONDS}, s-maxage=${MARKETING_S_MAXAGE_SECONDS}, stale-while-revalidate=${MARKETING_STALE_WHILE_REVALIDATE_SECONDS}, must-revalidate`,
      );
      res.setHeader("Last-Modified", BOOT_TIME_HTTP);
      // Surface the build stamp on every marketing response so an edge /
      // ops layer can read it without parsing the ETag (useful for purge
      // tooling, smoke tests, and "what version am I on?" debugging).
      res.setHeader("X-Build-Stamp", BUILD_STAMP);
      const etag = getEtagFor(prerendered, prerendered.html);
      res.setHeader("ETag", etag);

      if (isNotModified(req, etag)) {
        // 304s must omit the body and Content-Length per RFC 7232 §4.1.
        res.removeHeader("Content-Length");
        res.status(304).end();
        return;
      }

      // Use end() rather than send() so Express doesn't overwrite our
      // strong ETag with its own weak length+hash variant (which would
      // break conditional revalidation against the tag we just set).
      res.setHeader(
        "Content-Length",
        Buffer.byteLength(prerendered.html).toString(),
      );
      res.status(200).end(prerendered.html);
      return;
    }

    // Portal / app-shell HTML must never be cached: it bootstraps a SPA
    // whose runtime state (auth, case data, locale) depends on the live
    // request. A stale shell would pin users to an old asset manifest
    // across deploys.
    res.setHeader("Cache-Control", "no-store");

    // Anything that isn't a known SPA route (marketing pages handled above,
    // plus authenticated app shells / session-gated flows in
    // KNOWN_NON_INDEXABLE_APP_ROUTES) is an unrecognized URL — a typo, a
    // stale/removed link, or a probe. Non-JS crawlers and social/AI bots
    // never run the client router's `NotFound` fallback, so without this
    // check they would see an HTTP 200 app shell advertising home-page
    // metadata (a soft-404), which Google explicitly discourages. Serve a
    // real 404 with an explicit noindex directive instead; the same shell
    // HTML still boots the SPA for a human who hits "back" or has JS
    // enabled, so the client-side NotFound page still renders.
    const qIdx = req.originalUrl.indexOf("?");
    const pathnameOnly = qIdx >= 0 ? req.originalUrl.slice(0, qIdx) : req.originalUrl;
    if (!isKnownAppPath(pathnameOnly)) {
      res.removeHeader("X-Robots-Tag");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      // Reinforce the header with an in-HTML directive (defense in depth —
      // the raw shell's <meta name="robots"> otherwise still advertises the
      // home page's "index, follow", which some crawlers weight alongside
      // or in place of the header).
      const noindexHtml = prerendered.html
        .replace(
          /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="robots" content="noindex, nofollow" />`,
        )
        .replace(
          /<meta\s+name="googlebot"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="googlebot" content="noindex, nofollow" />`,
        );
      res.setHeader(
        "Content-Length",
        Buffer.byteLength(noindexHtml).toString(),
      );
      res.status(404).end(noindexHtml);
      return;
    }

    // Known app route that isn't search-facing (dashboard/admin shells,
    // /contact-admin) — `securityHeaders()` already set noindex for these,
    // so just serve the shell normally.
    res.setHeader(
      "Content-Length",
      Buffer.byteLength(prerendered.html).toString(),
    );
    res.status(200).end(prerendered.html);
  });
}
