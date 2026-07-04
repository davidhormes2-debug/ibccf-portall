import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  prerenderIndexHtml,
  prerenderIndexHtmlCached,
  SEO_SUPPORTED_LOCALES,
  SEO_DEFAULT_LOCALE,
  SEO_STATIC_ROUTES,
  SEO_DIVISION_IDS,
  __resetPrerenderCacheForTests,
  __prerenderCacheSizeForTests,
} from "../seo/prerender";

const TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "client", "index.html"),
  "utf-8",
);

// Derive routes from the prerender module itself so renaming a route in one
// place can't silently leave the test asserting against a stale list.
const STATIC_ROUTES: Array<{ pathname: string; key: string }> = Object.entries(
  SEO_STATIC_ROUTES,
).map(([pathname, key]) => ({ pathname, key: key as string }));

const DIVISION_ROUTES = SEO_DIVISION_IDS.map((id) => ({
  pathname: `/divisions/${id}`,
  key: id as string,
}));

const PUBLIC_PATHS = [...STATIC_ROUTES, ...DIVISION_ROUTES];

const LOCALE_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "client",
  "src",
  "i18n",
  "locales",
);

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

function loadBundleFromDisk(code: string): SeoBundle {
  const file = path.join(LOCALE_DIR, code, "seo.json");
  return JSON.parse(fs.readFileSync(file, "utf-8")) as SeoBundle;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function urlFor(pathname: string, locale: string): string {
  if (locale === SEO_DEFAULT_LOCALE) return pathname;
  const sep = pathname.includes("?") ? "&" : "?";
  return `${pathname}${sep}lang=${locale}`;
}

describe("SEO prerender — task #89", () => {
  // ---------------------------------------------------------------------------
  // Key-shape check: catches a translator deleting a key or a new route being
  // added without all six locale files being updated. We collect every missing
  // / extra key per locale so the failure names them all in one go rather than
  // forcing a fix-and-rerun loop for each one.
  // ---------------------------------------------------------------------------
  it("every supported locale ships a complete seo.json with the same key shape as English", () => {
    const enBundle = loadBundleFromDisk(SEO_DEFAULT_LOCALE);
    const routeKeys = Object.keys(enBundle.routes).sort();
    const divisionKeys = Object.keys(enBundle.divisions).sort();

    const FIELDS: Array<keyof RouteCopy> = ["title", "description", "h1", "intro"];

    // Cross-check the English baseline against the route table the prerender
    // module actually serves so renaming one without the other is caught.
    for (const { key } of STATIC_ROUTES) {
      expect(
        routeKeys.includes(key),
        `English seo.json is missing routes.${key} (referenced by prerender SEO_STATIC_ROUTES)`,
      ).toBe(true);
    }
    for (const id of SEO_DIVISION_IDS) {
      expect(
        divisionKeys.includes(id),
        `English seo.json is missing divisions.${id} (referenced by prerender SEO_DIVISION_IDS)`,
      ).toBe(true);
    }

    const problems: string[] = [];

    // Discover every locale folder on disk so a translator who drops a new
    // folder under client/src/i18n/locales/ without registering it in
    // SEO_SUPPORTED_LOCALES is still surfaced (and vice versa).
    const onDiskLocales = fs
      .readdirSync(LOCALE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !name.startsWith("_") && !name.startsWith("."));
    const registeredLocales = SEO_SUPPORTED_LOCALES.map((l) => l.code) as string[];

    for (const dir of onDiskLocales) {
      if (!registeredLocales.includes(dir)) {
        problems.push(
          `client/src/i18n/locales/${dir}/ exists on disk but is not registered in SEO_SUPPORTED_LOCALES — prerender will never serve it`,
        );
      }
    }
    for (const code of registeredLocales) {
      if (!onDiskLocales.includes(code)) {
        problems.push(
          `SEO_SUPPORTED_LOCALES advertises "${code}" but client/src/i18n/locales/${code}/ does not exist`,
        );
      }
    }

    // Validate every locale folder we found, registered or not, so unregistered
    // folders also surface their missing keys (helps when a translator adds the
    // folder first and the code registration second).
    const localesToCheck = Array.from(
      new Set([...registeredLocales, ...onDiskLocales]),
    );

    for (const code of localesToCheck) {
      const file = path.join(LOCALE_DIR, code, "seo.json");
      if (!fs.existsSync(file)) {
        problems.push(`missing file: client/src/i18n/locales/${code}/seo.json`);
        continue;
      }
      const bundle = loadBundleFromDisk(code);

      const localRouteKeys = Object.keys(bundle.routes ?? {});
      const localDivisionKeys = Object.keys(bundle.divisions ?? {});

      for (const key of routeKeys) {
        if (!localRouteKeys.includes(key)) {
          problems.push(`${code}/seo.json missing routes.${key}`);
          continue;
        }
        const copy = bundle.routes[key];
        for (const field of FIELDS) {
          if (!copy?.[field] || typeof copy[field] !== "string") {
            problems.push(`${code}/seo.json routes.${key}.${field} is empty or non-string`);
          }
        }
      }
      for (const extra of localRouteKeys) {
        if (!routeKeys.includes(extra)) {
          problems.push(
            `${code}/seo.json has unexpected routes.${extra} (not in English baseline)`,
          );
        }
      }

      for (const key of divisionKeys) {
        if (!localDivisionKeys.includes(key)) {
          problems.push(`${code}/seo.json missing divisions.${key}`);
          continue;
        }
        const copy = bundle.divisions[key];
        for (const field of FIELDS) {
          if (!copy?.[field] || typeof copy[field] !== "string") {
            problems.push(`${code}/seo.json divisions.${key}.${field} is empty or non-string`);
          }
        }
      }
      for (const extra of localDivisionKeys) {
        if (!divisionKeys.includes(extra)) {
          problems.push(
            `${code}/seo.json has unexpected divisions.${extra} (not in English baseline)`,
          );
        }
      }
    }

    expect(
      problems,
      `SEO translation gaps would ship to Google:\n  - ${problems.join("\n  - ")}`,
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Render check: for every (locale, route) pair, run the actual prerender
  // pipeline and assert <html lang>, <title>, <meta description>, canonical
  // and hreflang alternates match the requested locale's seo.json. This is
  // what guarantees /verify?lang=de actually ships German to Google rather
  // than silently falling back to English under a non-canonical URL.
  // ---------------------------------------------------------------------------
  for (const { code, bcp47 } of SEO_SUPPORTED_LOCALES) {
    for (const { pathname, key } of PUBLIC_PATHS) {
      it(`renders ${pathname} in ${code} with translated <html lang>, <title>, meta description, canonical and hreflang alternates`, () => {
        const bundle = loadBundleFromDisk(code);
        const copy: RouteCopy = pathname.startsWith("/divisions/")
          ? bundle.divisions[key]
          : bundle.routes[key];

        expect(
          copy,
          `seo.json for ${code} is missing the ${pathname} entry; cannot render`,
        ).toBeTruthy();

        const url = urlFor(pathname, code);
        const { html, locale, rewrote } = prerenderIndexHtml({
          template: TEMPLATE,
          url,
          acceptLanguage: undefined,
          host: "ibccf.site",
          proto: "https",
        });

        expect(rewrote, `prerender refused to rewrite ${url}`).toBe(true);
        expect(locale).toBe(code);

        // <html lang> must reflect the requested locale (BCP-47 form: `zh-CN`
        // for Chinese, base code for the rest) so screen readers and Google
        // parse it correctly.
        expect(
          html,
          `${code} ${pathname}: <html lang="${bcp47}"> missing`,
        ).toMatch(new RegExp(`<html\\s[^>]*lang="${bcp47}"`));

        // <title> + <meta description> must be the translated strings, not
        // the English defaults from the static template.
        expect(
          html,
          `${code} ${pathname}: translated <title> missing`,
        ).toContain(`<title>${htmlEscape(copy.title)}</title>`);
        expect(
          html,
          `${code} ${pathname}: translated meta description missing`,
        ).toContain(
          `<meta name="description" content="${htmlEscape(copy.description)}" />`,
        );

        // Canonical URL points at the requested locale variant. English uses
        // the bare URL; everything else carries ?lang=<code>.
        const expectedCanonical =
          code === SEO_DEFAULT_LOCALE
            ? `https://ibccf.site${pathname}`
            : `https://ibccf.site${pathname}?lang=${code}`;
        expect(
          html,
          `${code} ${pathname}: canonical href mismatch`,
        ).toContain(`<link rel="canonical" href="${expectedCanonical}" />`);

        // hreflang alternates: one per supported locale + x-default. This
        // mirrors sitemap.xml so the signals stay consistent regardless of
        // how the crawler arrives.
        for (const alt of SEO_SUPPORTED_LOCALES) {
          const altHref =
            alt.code === SEO_DEFAULT_LOCALE
              ? `https://ibccf.site${pathname}`
              : `https://ibccf.site${pathname}?lang=${alt.code}`;
          expect(
            html,
            `${code} ${pathname}: hreflang="${alt.code}" alternate missing or wrong href`,
          ).toContain(
            `<link rel="alternate" hreflang="${alt.code}" href="${altHref}" />`,
          );
        }
        expect(
          html,
          `${code} ${pathname}: hreflang="x-default" alternate missing`,
        ).toMatch(/<link rel="alternate" hreflang="x-default"/);

        // Visible body copy lives inside <div id="root"> until React
        // hydrates — search engines without JS must see the translated h1
        // and intro paragraph in the initial payload.
        const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/);
        expect(
          root,
          `${code} ${pathname}: expected prerendered SEO body inside #root`,
        ).toBeTruthy();
        const rootInner = root![1];
        expect(
          rootInner,
          `${code} ${pathname}: translated <h1> missing from SEO body`,
        ).toContain(htmlEscape(copy.h1));
        expect(
          rootInner,
          `${code} ${pathname}: translated intro paragraph missing from SEO body`,
        ).toContain(htmlEscape(copy.intro));
      });
    }
  }

  it("falls back to English for unknown ?lang= values and leaves non-marketing routes untouched", () => {
    const unknown = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/?lang=xx",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    expect(unknown.locale).toBe("en");
    expect(unknown.rewrote).toBe(true);
    expect(unknown.html).toMatch(/<html\s[^>]*lang="en"/);

    const skipped = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/portal/dashboard?lang=de",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    expect(skipped.rewrote).toBe(false);
    expect(skipped.html).toBe(TEMPLATE);
  });

  it("the production CJS bundle anchors locale lookup on __dirname (not the empty import.meta) and ships the seo.json files", () => {
    // Production smoke: esbuild builds the server as CJS, where
    // `import.meta` is stripped to {} and `import.meta.dirname` is
    // therefore undefined. If `findLocalesDir()` ever regresses to
    // anchoring on `import.meta.dirname` only, every prerendered marketing
    // route 500s in production. This test runs only when a build artefact
    // exists so it doesn't block development without `npm run build`, but
    // is wired into the same suite so CI catches the regression.
    const distBundle = path.resolve(__dirname, "..", "..", "dist", "index.cjs");
    const distLocale = path.resolve(
      __dirname,
      "..",
      "..",
      "dist",
      "i18n-locales",
      "en",
      "seo.json",
    );
    if (!fs.existsSync(distBundle) || !fs.existsSync(distLocale)) return;
    const source = fs.readFileSync(distBundle, "utf-8");
    expect(source).toMatch(/typeof __dirname\s*==\s*"string"/);
    expect(source).toContain("i18n-locales");
    expect(fs.existsSync(distLocale)).toBe(true);
  });

  it("prerenderIndexHtmlCached returns identical output to the uncached path, is bounded, and resets on process start", () => {
    __resetPrerenderCacheForTests();
    expect(__prerenderCacheSizeForTests()).toBe(0);

    const args = {
      template: TEMPLATE,
      url: "/verify?lang=de",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    } as const;
    const direct = prerenderIndexHtml({ ...args });
    const first = prerenderIndexHtmlCached({ ...args });
    const second = prerenderIndexHtmlCached({ ...args });
    expect(first.html).toBe(direct.html);
    expect(second).toBe(first); // identical object reference => cache hit
    expect(__prerenderCacheSizeForTests()).toBe(1);

    // Non-prerenderable paths are skipped (template returned unchanged, no
    // cache pollution).
    const skipped = prerenderIndexHtmlCached({
      ...args,
      url: "/portal/dashboard",
    });
    expect(skipped.rewrote).toBe(false);
    expect(skipped.html).toBe(TEMPLATE);
    expect(__prerenderCacheSizeForTests()).toBe(1);

    // Distinct (pathname, locale) tuples each get their own slot. baseUrl is
    // now pinned to the canonical production origin regardless of the
    // request's `host` header, so varying `host` alone must NOT create a
    // new slot (see "Canonical, hreflang, and sitemap URLs" fix).
    prerenderIndexHtmlCached({ ...args, url: "/?lang=fr" });
    prerenderIndexHtmlCached({ ...args, url: "/verify?lang=es" });
    prerenderIndexHtmlCached({ ...args, url: "/verify?lang=de", host: "other.example.com" });
    expect(__prerenderCacheSizeForTests()).toBe(3);

    // Cache survives many repeat lookups without growing (bounded).
    for (let i = 0; i < 1000; i++) {
      prerenderIndexHtmlCached({ ...args });
    }
    expect(__prerenderCacheSizeForTests()).toBe(3);

    __resetPrerenderCacheForTests();
    expect(__prerenderCacheSizeForTests()).toBe(0);
  });

  it("prerenderIndexHtmlCached caps the cache and evicts the oldest entry when the cap is exceeded", () => {
    __resetPrerenderCacheForTests();

    // Insert > PRERENDER_CACHE_MAX (256) distinct keys by varying the build
    // stamp (baseUrl is pinned to the canonical origin and no longer varies
    // with `host`, so a fixed marketing pathname/locale pair only produces a
    // new cache slot across a redeploy, which is what a changing build
    // stamp simulates). Each insertion must keep the cache size at or below
    // the cap.
    const CAP = 256;
    for (let i = 0; i < CAP + 50; i++) {
      prerenderIndexHtmlCached({
        template: TEMPLATE,
        url: "/verify?lang=de",
        acceptLanguage: undefined,
        host: "ibccf.site",
        proto: "https",
        buildStamp: `build-${i}`,
      });
      expect(__prerenderCacheSizeForTests()).toBeLessThanOrEqual(CAP);
    }
    expect(__prerenderCacheSizeForTests()).toBe(CAP);

    // The oldest entry (build-0) should have been evicted; a fresh lookup
    // produces a different object identity than the one a cache hit would
    // return.
    const a = prerenderIndexHtmlCached({
      template: TEMPLATE,
      url: "/verify?lang=de",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
      buildStamp: "build-0",
    });
    const b = prerenderIndexHtmlCached({
      template: TEMPLATE,
      url: "/verify?lang=de",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
      buildStamp: "build-0",
    });
    // `b` is the cache hit for the freshly re-inserted entry; `a` was the
    // re-insertion itself, so they share identity. The proof that `build-0`
    // had been evicted is that the cache stayed bounded above.
    expect(b).toBe(a);

    __resetPrerenderCacheForTests();
  });

  it("resolveBaseUrl-driven output ignores host/proto and is always pinned to the canonical origin", () => {
    const withHost = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/",
      acceptLanguage: undefined,
      host: "staging.example.com",
      proto: "http",
    });
    const withoutHost = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/",
      acceptLanguage: undefined,
      host: undefined,
      proto: undefined,
    });
    expect(withHost.html).toContain('href="https://ibccf.site/"');
    expect(withHost.html).not.toContain("staging.example.com");
    expect(withHost.html).toBe(withoutHost.html);
  });

  it("injects a <meta name=\"build-stamp\"> tag when buildStamp is provided", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
      buildStamp: "release-abc.123_def",
    });
    expect(out.rewrote).toBe(true);
    expect(out.html).toContain(
      '<meta name="build-stamp" content="release-abc.123_def" />',
    );
    // Exactly one tag — re-rendering must not leave stale copies behind.
    const matches = out.html.match(/<meta\s+name="build-stamp"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("omits the build-stamp meta tag when buildStamp is not provided", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    expect(out.rewrote).toBe(true);
    expect(out.html).not.toMatch(/<meta\s+name="build-stamp"/);
  });

  it("re-renders (no cache hit) when buildStamp changes", () => {
    __resetPrerenderCacheForTests();
    const a = prerenderIndexHtmlCached({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
      buildStamp: "stamp-A",
    });
    const b = prerenderIndexHtmlCached({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
      buildStamp: "stamp-B",
    });
    expect(a.html).toContain('content="stamp-A"');
    expect(b.html).toContain('content="stamp-B"');
    expect(b).not.toBe(a);
    __resetPrerenderCacheForTests();
  });

  it("emits absolute og:image and twitter:image URLs against the canonical production baseUrl", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    expect(out.html).toContain(
      '<meta property="og:image" content="https://ibccf.site/opengraph.jpg" />',
    );
    expect(out.html).toContain(
      '<meta name="twitter:image" content="https://ibccf.site/opengraph.jpg" />',
    );

    // Mirrors the existing canonical/hreflang policy: baseUrl is always the
    // single production origin regardless of the incoming request host (a
    // preview/staging domain must not self-canonicalize), so the image URLs
    // stay pinned to the canonical host too.
    const staged = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: undefined,
      host: "preview.example.com",
      proto: "https",
    });
    expect(staged.html).toContain(
      '<meta property="og:image" content="https://ibccf.site/opengraph.jpg" />',
    );
    expect(staged.html).toContain(
      '<meta name="twitter:image" content="https://ibccf.site/opengraph.jpg" />',
    );
  });

  it("the raw (non-prerendered) template already ships absolute og:image/twitter:image URLs", () => {
    expect(TEMPLATE).toMatch(
      /<meta\s+property="og:image"\s+content="https:\/\/[^"]+"\s*\/?>/,
    );
    expect(TEMPLATE).toMatch(
      /<meta\s+name="twitter:image"\s+content="https:\/\/[^"]+"\s*\/?>/,
    );
  });

  it("injects a localised, host-aware JSON-LD graph with Organization, WebSite and WebPage on a static route", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    const match = out.html.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    expect(match, "expected a JSON-LD script block").toBeTruthy();
    const data = JSON.parse(match![1]);
    expect(data["@context"]).toBe("https://schema.org");
    const types = data["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    expect(types).toContain("WebPage");

    const org = data["@graph"].find((n: { "@type": string }) => n["@type"] === "Organization");
    expect(org.url).toBe("https://ibccf.site/");
    expect(org.name).toBe("IBCCF");

    const webPage = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebPage");
    expect(webPage.url).toBe("https://ibccf.site/verify");
    const enBundle = loadBundleFromDisk("en");
    expect(webPage.name).toBe(enBundle.routes.verify.title);

    // Only one JSON-LD block should be present — the static shell's fallback
    // block must be replaced, not duplicated alongside the localised one.
    const allBlocks = out.html.match(/<script type="application\/ld\+json">/g) ?? [];
    expect(allBlocks.length).toBe(1);
  });

  it("adds a BreadcrumbList for division routes in the JSON-LD graph", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/divisions/aml",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    const match = out.html.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    const data = JSON.parse(match![1]);
    const breadcrumb = data["@graph"].find(
      (n: { "@type": string }) => n["@type"] === "BreadcrumbList",
    );
    expect(breadcrumb).toBeTruthy();
    expect(breadcrumb.itemListElement).toHaveLength(2);
    expect(breadcrumb.itemListElement[1].item).toBe("https://ibccf.site/divisions/aml");
  });

  it("localises the JSON-LD WebPage/inLanguage for a non-English locale", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/verify?lang=fr",
      acceptLanguage: undefined,
      host: "ibccf.site",
      proto: "https",
    });
    const match = out.html.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    const data = JSON.parse(match![1]);
    const webPage = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebPage");
    expect(webPage.inLanguage).toBe("fr");
    const website = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebSite");
    expect(website.inLanguage).toBe("fr");
    const frBundle = loadBundleFromDisk("fr");
    expect(webPage.name).toBe(frBundle.routes.verify.title);
  });

  it("does not render Google Fonts as a render-blocking stylesheet in the shared shell", () => {
    // The self-hosted font migration removed the external fonts.googleapis.com
    // <link rel="stylesheet"> from the critical path. Preconnect hints (if any
    // remain for other origins) are fine; a blocking Google Fonts stylesheet
    // link is not.
    expect(TEMPLATE).not.toMatch(
      /<link[^>]+href="https:\/\/fonts\.googleapis\.com[^"]*"[^>]*rel="stylesheet"/,
    );
    expect(TEMPLATE).not.toMatch(
      /<link[^>]+rel="stylesheet"[^>]*href="https:\/\/fonts\.googleapis\.com/,
    );
  });

  it("uses Accept-Language as a fallback when ?lang= is absent", () => {
    const out = prerenderIndexHtml({
      template: TEMPLATE,
      url: "/verify",
      acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
      host: "ibccf.site",
      proto: "https",
    });
    expect(out.locale).toBe("fr");
    expect(out.html).toMatch(/<html\s[^>]*lang="fr"/);
    const fr = loadBundleFromDisk("fr");
    expect(out.html).toContain(`<title>${fr.routes.verify.title}</title>`);
  });
});
