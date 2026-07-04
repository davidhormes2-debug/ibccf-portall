import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock browser / React dependencies from the client hreflang hook so this
// server-side test can import its exported constants without a DOM or bundler.
// ---------------------------------------------------------------------------
vi.mock("react", () => ({ useEffect: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: vi.fn(() => ["/"]) }));
vi.mock("../../client/src/i18n/index", () => ({
  SUPPORTED_LOCALES: [
    { code: "en", bcp47: "en" },
    { code: "es", bcp47: "es" },
    { code: "fr", bcp47: "fr" },
    { code: "de", bcp47: "de" },
    { code: "pt", bcp47: "pt" },
    { code: "zh", bcp47: "zh-CN" },
  ],
  DEFAULT_LOCALE: "en",
}));
vi.mock("../../client/src/i18n/useLocale", () => ({
  useLocale: vi.fn(() => ({ locale: { code: "en" } })),
}));

// ---------------------------------------------------------------------------
// Mock the DB chain the sitemap route uses to pull public community thread
// permalinks (`select().from().where().orderBy().limit()`). Tests mutate
// `communityThreadRows` to control what the sitemap "finds" in the DB.
// ---------------------------------------------------------------------------
let communityThreadRows: Array<{ id: number; lastActivityAt: Date | null }> = [
  { id: 42, lastActivityAt: new Date("2026-06-15T00:00:00.000Z") },
];

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => communityThreadRows),
          })),
        })),
      })),
    })),
  },
}));

const { STATIC_PUBLIC_PATHS: SITEMAP_PATHS, DIVISION_IDS: SITEMAP_DIVISIONS, sitemapRouter } =
  await import("../routes/sitemap");

const {
  STATIC_PUBLIC_PATHS: HREFLANG_PATHS,
  DIVISION_IDS: HREFLANG_DIVISIONS,
} = await import("../../client/src/i18n/useHreflangTags");

const {
  SEO_STATIC_ROUTES,
  SEO_DIVISION_IDS,
} = await import("../seo/prerender");

function buildApp() {
  const app = express();
  app.use(sitemapRouter);
  return app;
}

// ---------------------------------------------------------------------------
// 1. Sync guard: the two parallel path lists must stay identical.
//    Adding a path to one without the other is a regression.
// ---------------------------------------------------------------------------
describe("sitemap ↔ hreflang sync guard", () => {
  it("every STATIC_PUBLIC_PATH in sitemap.ts also appears in useHreflangTags.ts", () => {
    const missing: string[] = [];
    for (const { path } of SITEMAP_PATHS) {
      if (!HREFLANG_PATHS.has(path)) {
        missing.push(path);
      }
    }
    expect(
      missing,
      `Paths in sitemap STATIC_PUBLIC_PATHS that are missing from the hreflang STATIC_PUBLIC_PATHS:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every STATIC_PUBLIC_PATH in useHreflangTags.ts also appears in sitemap.ts", () => {
    const sitemapPathSet = new Set(SITEMAP_PATHS.map((e) => e.path));
    const missing: string[] = [];
    for (const path of HREFLANG_PATHS) {
      if (!sitemapPathSet.has(path)) {
        missing.push(path);
      }
    }
    expect(
      missing,
      `Paths in hreflang STATIC_PUBLIC_PATHS that are missing from the sitemap STATIC_PUBLIC_PATHS:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every DIVISION_ID in sitemap.ts also appears in useHreflangTags.ts", () => {
    const missing: string[] = [];
    for (const id of SITEMAP_DIVISIONS) {
      if (!HREFLANG_DIVISIONS.has(id)) {
        missing.push(id);
      }
    }
    expect(
      missing,
      `Division IDs in sitemap.ts that are missing from useHreflangTags.ts:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every DIVISION_ID in useHreflangTags.ts also appears in sitemap.ts", () => {
    const sitemapDivisionSet = new Set(SITEMAP_DIVISIONS as readonly string[]);
    const missing: string[] = [];
    for (const id of HREFLANG_DIVISIONS) {
      if (!sitemapDivisionSet.has(id)) {
        missing.push(id);
      }
    }
    expect(
      missing,
      `Division IDs in useHreflangTags.ts that are missing from sitemap.ts:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Sync guard: sitemap paths ↔ SEO prerender route table must stay in sync.
//    Adding a path to one without the other is a regression.
// ---------------------------------------------------------------------------
describe("sitemap ↔ prerender sync guard", () => {
  it("every STATIC_PUBLIC_PATH in sitemap.ts also exists as a key in SEO_STATIC_ROUTES", () => {
    const missing: string[] = [];
    for (const { path } of SITEMAP_PATHS) {
      if (!Object.prototype.hasOwnProperty.call(SEO_STATIC_ROUTES, path)) {
        missing.push(path);
      }
    }
    expect(
      missing,
      `Paths in sitemap STATIC_PUBLIC_PATHS that are missing from SEO_STATIC_ROUTES:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every key in SEO_STATIC_ROUTES also appears in sitemap STATIC_PUBLIC_PATHS", () => {
    const sitemapPathSet = new Set(SITEMAP_PATHS.map((e) => e.path));
    const missing: string[] = [];
    for (const path of Object.keys(SEO_STATIC_ROUTES)) {
      if (!sitemapPathSet.has(path)) {
        missing.push(path);
      }
    }
    expect(
      missing,
      `Keys in SEO_STATIC_ROUTES that are missing from sitemap STATIC_PUBLIC_PATHS:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every DIVISION_ID in sitemap.ts also appears in SEO_DIVISION_IDS", () => {
    const seoSet = new Set(SEO_DIVISION_IDS as readonly string[]);
    const missing: string[] = [];
    for (const id of SITEMAP_DIVISIONS) {
      if (!seoSet.has(id)) {
        missing.push(id);
      }
    }
    expect(
      missing,
      `Division IDs in sitemap.ts that are missing from SEO_DIVISION_IDS:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every SEO_DIVISION_ID also appears in sitemap DIVISION_IDS", () => {
    const sitemapDivisionSet = new Set(SITEMAP_DIVISIONS as readonly string[]);
    const missing: string[] = [];
    for (const id of SEO_DIVISION_IDS) {
      if (!sitemapDivisionSet.has(id)) {
        missing.push(id);
      }
    }
    expect(
      missing,
      `Division IDs in SEO_DIVISION_IDS that are missing from sitemap DIVISION_IDS:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP smoke test: GET /sitemap.xml returns well-formed XML and contains
//    every expected public path (including /privacy-policy and /terms-of-use).
// ---------------------------------------------------------------------------
describe("GET /sitemap.xml", () => {
  const app = buildApp();

  it("returns 200 with Content-Type application/xml", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
  });

  it("includes all STATIC_PUBLIC_PATHS in the XML body", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    const xml = res.text;
    const problems: string[] = [];
    for (const { path } of SITEMAP_PATHS) {
      const expectedLoc = `<loc>https://ibccf.site${path}</loc>`;
      if (!xml.includes(expectedLoc)) {
        problems.push(`missing <loc> for ${path}`);
      }
    }
    expect(
      problems,
      `sitemap.xml is missing expected <loc> entries:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });

  it("explicitly includes /privacy-policy and /terms-of-use", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    const xml = res.text;
    expect(xml, "sitemap.xml must contain /privacy-policy").toContain(
      "<loc>https://ibccf.site/privacy-policy</loc>",
    );
    expect(xml, "sitemap.xml must contain /terms-of-use").toContain(
      "<loc>https://ibccf.site/terms-of-use</loc>",
    );
  });

  it("includes all division paths in the XML body", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    const xml = res.text;
    const problems: string[] = [];
    for (const id of SITEMAP_DIVISIONS) {
      const expectedLoc = `<loc>https://ibccf.site/divisions/${id}</loc>`;
      if (!xml.includes(expectedLoc)) {
        problems.push(`missing <loc> for /divisions/${id}`);
      }
    }
    expect(
      problems,
      `sitemap.xml is missing expected division <loc> entries:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });

  it("emits hreflang alternates for every supported locale on each path", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    const xml = res.text;
    const problems: string[] = [];
    const locales = ["en", "es", "fr", "de", "pt", "zh"] as const;
    for (const { path } of SITEMAP_PATHS) {
      for (const code of locales) {
        const href =
          code === "en"
            ? `https://ibccf.site${path}`
            : `https://ibccf.site${path}?lang=${code}`;
        if (!xml.includes(`hreflang="${code}" href="${href}"`)) {
          problems.push(`missing hreflang="${code}" alternate for ${path}`);
        }
      }
      if (!xml.includes(`hreflang="x-default"`)) {
        problems.push(`missing x-default alternate`);
      }
    }
    expect(
      problems,
      `sitemap.xml hreflang issues:\n  ${problems.join("\n  ")}`,
    ).toEqual([]);
  });

  it("sets X-Robots-Tag: noindex and Cache-Control: public, max-age=3600", async () => {
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
  });
});

// ---------------------------------------------------------------------------
// 3b. Community thread permalinks: each public (non-flagged) thread returned
//     by the DB should get its own <url> entry with a per-thread <lastmod>
//     derived from lastActivityAt, so search engines can discover and
//     re-crawl individual discussions.
// ---------------------------------------------------------------------------
describe("GET /sitemap.xml — community thread permalinks", () => {
  it("includes a <loc> and per-thread <lastmod> for each row the DB returns", async () => {
    communityThreadRows = [
      { id: 42, lastActivityAt: new Date("2026-06-15T00:00:00.000Z") },
      { id: 7, lastActivityAt: null },
    ];
    const app = buildApp();
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    const xml = res.text;
    expect(xml).toContain("<loc>https://ibccf.site/community/42</loc>");
    expect(xml).toContain("<lastmod>2026-06-15</lastmod>");
    expect(xml).toContain("<loc>https://ibccf.site/community/7</loc>");
  });

  it("still returns a valid sitemap when the community threads query throws", async () => {
    const { db } = await import("../db");
    (db.select as any).mockImplementationOnce(() => {
      throw new Error("simulated DB failure");
    });
    const app = buildApp();
    const res = await request(app)
      .get("/sitemap.xml")
      .set("X-Forwarded-Host", "ibccf.site")
      .set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<loc>https://ibccf.site/privacy-policy</loc>");
  });
});

// ---------------------------------------------------------------------------
// 4. Sync guard: every route key referenced in SEO_STATIC_ROUTES and every
//    division ID in SEO_DIVISION_IDS must have a matching entry in the
//    English seo.json translation file. If a key is registered in
//    SEO_STATIC_ROUTES but missing from seo.json, prerendering silently
//    returns rewrote:false with no error — this test catches that drift.
// ---------------------------------------------------------------------------
describe("SEO_STATIC_ROUTES ↔ seo.json sync guard", () => {
  const seoJsonPath = path.resolve(
    process.cwd(),
    "client",
    "src",
    "i18n",
    "locales",
    "en",
    "seo.json",
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

  let bundle: SeoBundle;
  try {
    bundle = JSON.parse(fs.readFileSync(seoJsonPath, "utf-8")) as SeoBundle;
  } catch (err) {
    throw new Error(
      `Could not read ${seoJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  it("en/seo.json exists and is valid JSON with routes and divisions", () => {
    expect(bundle).toBeDefined();
    expect(typeof bundle.routes).toBe("object");
    expect(typeof bundle.divisions).toBe("object");
  });

  it("every route key in SEO_STATIC_ROUTES exists as a key in bundle.routes", () => {
    const missing: string[] = [];
    for (const [path, routeKey] of Object.entries(SEO_STATIC_ROUTES)) {
      if (!Object.prototype.hasOwnProperty.call(bundle.routes, routeKey)) {
        missing.push(`"${routeKey}" (from path "${path}")`);
      }
    }
    expect(
      missing,
      `Route keys in SEO_STATIC_ROUTES that are missing from en/seo.json bundle.routes:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every key in bundle.routes also appears as a value in SEO_STATIC_ROUTES", () => {
    const registeredKeys = new Set(Object.values(SEO_STATIC_ROUTES));
    const extra: string[] = [];
    for (const key of Object.keys(bundle.routes)) {
      if (!registeredKeys.has(key)) {
        extra.push(key);
      }
    }
    expect(
      extra,
      `Keys in en/seo.json bundle.routes that are not referenced by any SEO_STATIC_ROUTES entry:\n  ${extra.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every SEO_DIVISION_ID exists as a key in bundle.divisions", () => {
    const missing: string[] = [];
    for (const id of SEO_DIVISION_IDS) {
      if (!Object.prototype.hasOwnProperty.call(bundle.divisions, id)) {
        missing.push(id);
      }
    }
    expect(
      missing,
      `Division IDs in SEO_DIVISION_IDS that are missing from en/seo.json bundle.divisions:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every key in bundle.divisions also appears in SEO_DIVISION_IDS", () => {
    const registeredIds = new Set(SEO_DIVISION_IDS as readonly string[]);
    const extra: string[] = [];
    for (const key of Object.keys(bundle.divisions)) {
      if (!registeredIds.has(key)) {
        extra.push(key);
      }
    }
    expect(
      extra,
      `Keys in en/seo.json bundle.divisions that are not listed in SEO_DIVISION_IDS:\n  ${extra.join("\n  ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-locale sync guard: every route key and division ID present in the
//    English seo.json must also exist in each of the other five locale files.
//    A missing key in a non-English file causes silent fallback to English
//    prerender copy that the check:i18n script does not catch.
// ---------------------------------------------------------------------------
const LOCALE_CODES = ["en", "es", "fr", "de", "pt", "zh"] as const;

const enSeoPath = path.resolve(
  process.cwd(),
  "client",
  "src",
  "i18n",
  "locales",
  "en",
  "seo.json",
);

interface RouteCopyRef {
  title: string;
  description: string;
  h1: string;
  intro: string;
}
interface SeoBundleRef {
  site: { name: string; fullName: string; tagline: string };
  routes: Record<string, RouteCopyRef>;
  divisions: Record<string, RouteCopyRef>;
}

let enBundle: SeoBundleRef;
try {
  enBundle = JSON.parse(fs.readFileSync(enSeoPath, "utf-8")) as SeoBundleRef;
} catch (err) {
  throw new Error(
    `Could not read ${enSeoPath}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const enRouteKeys = Object.keys(enBundle.routes);
const enDivisionKeys = Object.keys(enBundle.divisions);

for (const code of LOCALE_CODES) {
  describe(`seo.json cross-locale sync guard — ${code}`, () => {
    const localeSeoPath = path.resolve(
      process.cwd(),
      "client",
      "src",
      "i18n",
      "locales",
      code,
      "seo.json",
    );

    let localeBundle: SeoBundleRef;
    try {
      localeBundle = JSON.parse(
        fs.readFileSync(localeSeoPath, "utf-8"),
      ) as SeoBundleRef;
    } catch (err) {
      throw new Error(
        `Could not read ${localeSeoPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    it(`${code}/seo.json exists and is valid JSON with routes and divisions`, () => {
      expect(localeBundle).toBeDefined();
      expect(typeof localeBundle.routes).toBe("object");
      expect(typeof localeBundle.divisions).toBe("object");
    });

    it(`every route key from en/seo.json exists in ${code}/seo.json`, () => {
      const missing: string[] = [];
      for (const key of enRouteKeys) {
        if (!Object.prototype.hasOwnProperty.call(localeBundle.routes, key)) {
          missing.push(key);
        }
      }
      expect(
        missing,
        `Route keys present in en/seo.json but missing from ${code}/seo.json:\n  ${missing.join("\n  ")}`,
      ).toEqual([]);
    });

    it(`${code}/seo.json contains the withdrawalGuide route key with title and description`, () => {
      expect(
        Object.prototype.hasOwnProperty.call(localeBundle.routes, "withdrawalGuide"),
        `withdrawalGuide route key is missing from ${code}/seo.json — non-English visitors will get no SEO preview for the withdrawal guide`,
      ).toBe(true);
      const entry = (localeBundle.routes as Record<string, { title?: string; description?: string }>)["withdrawalGuide"];
      expect(
        typeof entry.title === "string" && entry.title.length > 0,
        `withdrawalGuide.title is missing or empty in ${code}/seo.json`,
      ).toBe(true);
      expect(
        typeof entry.description === "string" && entry.description.length > 0,
        `withdrawalGuide.description is missing or empty in ${code}/seo.json`,
      ).toBe(true);
    });

    it(`every division key from en/seo.json exists in ${code}/seo.json`, () => {
      const missing: string[] = [];
      for (const key of enDivisionKeys) {
        if (
          !Object.prototype.hasOwnProperty.call(localeBundle.divisions, key)
        ) {
          missing.push(key);
        }
      }
      expect(
        missing,
        `Division keys present in en/seo.json but missing from ${code}/seo.json:\n  ${missing.join("\n  ")}`,
      ).toEqual([]);
    });

    it(`${code}/seo.json has no extra route keys absent from en/seo.json`, () => {
      const enRouteKeySet = new Set(enRouteKeys);
      const extra: string[] = [];
      for (const key of Object.keys(localeBundle.routes)) {
        if (!enRouteKeySet.has(key)) {
          extra.push(key);
        }
      }
      expect(
        extra,
        `Route keys present in ${code}/seo.json but missing from en/seo.json:\n  ${extra.join("\n  ")}`,
      ).toEqual([]);
    });

    it(`${code}/seo.json has no extra division keys absent from en/seo.json`, () => {
      const enDivisionKeySet = new Set(enDivisionKeys);
      const extra: string[] = [];
      for (const key of Object.keys(localeBundle.divisions)) {
        if (!enDivisionKeySet.has(key)) {
          extra.push(key);
        }
      }
      expect(
        extra,
        `Division keys present in ${code}/seo.json but missing from en/seo.json:\n  ${extra.join("\n  ")}`,
      ).toEqual([]);
    });
  });
}
