import { useEffect } from "react";
import { useLocation } from "wouter";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./index";
import { useLocale } from "./useLocale";

const CANONICAL_ORIGIN = "https://ibccf.site";

export const STATIC_PUBLIC_PATHS = new Set<string>([
  "/",
  "/verify",
  "/community",
  "/request-access",
  "/legal-resources",
  "/privacy-policy",
  "/terms-of-use",
  "/withdrawal-guide",
]);

// Mirror of `DIVISION_IDS` in `server/routes/sitemap.ts`. We intentionally
// duplicate the list rather than import from the server bundle so the
// browser build stays decoupled — both arrays must be updated together when
// a new division is added.
export const DIVISION_IDS = new Set<string>([
  "aml",
  "cyber",
  "recovery",
  "compliance",
  "intelligence",
  "support",
]);

// Public community thread permalinks (`/community/123`) are crawlable
// standalone documents. Mirrors the `matchCommunityThreadPath` regex in
// `server/seo/prerender.ts` — both must be updated together.
const COMMUNITY_THREAD_PATH_RE = /^\/community\/\d+$/;

function isPublicPath(path: string): boolean {
  if (STATIC_PUBLIC_PATHS.has(path)) return true;
  const m = path.match(/^\/divisions\/([^/]+)$/);
  if (m && DIVISION_IDS.has(m[1])) return true;
  if (COMMUNITY_THREAD_PATH_RE.test(path)) return true;
  return false;
}

function buildHref(origin: string, path: string, code: string): string {
  if (code === DEFAULT_LOCALE) {
    return `${origin}${path}`;
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${origin}${path}${sep}lang=${code}`;
}

const MANAGED_ATTR = "data-i18n-hreflang";
const CANONICAL_FALLBACK = `${CANONICAL_ORIGIN}/`;

function setManagedLinks(hrefs: Array<{ hreflang: string; href: string }>) {
  const head = document.head;
  const existing = head.querySelectorAll(`link[${MANAGED_ATTR}]`);
  existing.forEach((el) => el.parentNode?.removeChild(el));
  for (const { hreflang, href } of hrefs) {
    const link = document.createElement("link");
    link.setAttribute("rel", "alternate");
    link.setAttribute("hreflang", hreflang);
    link.setAttribute("href", href);
    link.setAttribute(MANAGED_ATTR, "");
    head.appendChild(link);
  }
}

/**
 * Keep the single `<link rel="canonical">` element (declared statically
 * in `client/index.html`) pointing at the active locale's URL for public
 * routes. For the default locale or non-public routes we restore the
 * site-root fallback so we never advertise a portal/admin URL as
 * canonical.
 */
function setCanonical(href: string | null) {
  const head = document.head;
  let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    head.appendChild(link);
  }
  link.setAttribute("href", href ?? CANONICAL_FALLBACK);
}

/**
 * Render `<link rel="alternate" hreflang="…">` tags in <head> for the
 * current public marketing route so search engines know which translated
 * URL to surface per user locale. The list mirrors the entries emitted by
 * `server/routes/sitemap.ts`; both files must be updated together when
 * adding a new public page or locale.
 *
 * Non-public routes (admin, portal, mirror, …) intentionally do not get
 * hreflang tags — they're behind auth and excluded from the sitemap.
 */
export function useHreflangTags() {
  const [location] = useLocation();
  const { locale } = useLocale();

  useEffect(() => {
    if (typeof document === "undefined") return;

    // Strip any leading `?…` Wouter would never return, but normalise
    // defensively so `?lang=de` from the URL doesn't change which path we
    // treat as the canonical alternate.
    const path = location.split("?")[0] || "/";

    if (!isPublicPath(path)) {
      setManagedLinks([]);
      // Restore the static index.html fallback for non-public routes so
      // we never advertise a portal/admin URL as canonical.
      setCanonical(null);
      return;
    }

    // hreflang alternates — like the canonical link — must always point at
    // the production origin, never the live `window.location.origin`. If a
    // preview/staging host ever became crawlable, emitting alternates on
    // that host would drift away from the canonical domain declared in the
    // static HTML and the sitemap, splitting index signals across hosts.
    const origin = CANONICAL_ORIGIN;

    const links = SUPPORTED_LOCALES.map((l) => ({
      hreflang: l.code,
      href: buildHref(origin, path, l.code),
    }));
    links.push({
      hreflang: "x-default",
      href: buildHref(origin, path, DEFAULT_LOCALE),
    });

    setManagedLinks(links);
    setCanonical(buildHref(CANONICAL_ORIGIN, path, locale.code));

    return () => {
      setManagedLinks([]);
      setCanonical(null);
    };
  }, [location, locale]);
}
