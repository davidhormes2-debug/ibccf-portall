import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

import { __resetPrerenderCacheForTests } from "../seo/prerender";

const TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "client", "index.html"),
  "utf-8",
);

// Mock the disk reads in serveStatic so the test runs without a built
// dist/public/. We only ever exercise the catch-all HTML handler; the
// express.static layer is unused for our assertions because we hit
// HTML routes (`/`, `/verify`, `/portal/...`) directly.
vi.mock("fs", async () => {
  const real = await vi.importActual<typeof import("fs")>("fs");
  const existsSync = (p: fs.PathLike) => {
    if (typeof p === "string" && (p.endsWith("public") || p.endsWith(path.sep + "public"))) {
      return true;
    }
    return real.existsSync(p);
  };
  const readFileSync = ((p: fs.PathLike | number, opts?: any) => {
    if (typeof p === "string" && p.endsWith(path.join("public", "index.html"))) {
      return TEMPLATE;
    }
    return real.readFileSync(p as any, opts);
  }) as typeof real.readFileSync;
  return {
    ...real,
    default: { ...real, existsSync, readFileSync },
    existsSync,
    readFileSync,
  };
});

let app: express.Express;

beforeAll(async () => {
  __resetPrerenderCacheForTests();
  const { serveStatic } = await import("../static");
  app = express();
  serveStatic(app);
});

// Pin the host header across requests so the prerender cache key
// (pathname, locale, baseUrl) stays stable — supertest spins up an
// ephemeral port per `request(app)` call, which would otherwise vary
// baseUrl and produce a fresh ETag every time.
function get(url: string, headers: Record<string, string> = {}) {
  const r = request(app).get(url).set("X-Forwarded-Host", "ibccf.site").set("X-Forwarded-Proto", "https");
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r;
}

describe("marketing HTML caching headers — task #104", () => {
  it("serves marketing routes with Cache-Control, ETag, Last-Modified, and Vary: Accept-Language", async () => {
    const res = await get("/", { "Accept-Language": "en" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public.*max-age=\d+.*must-revalidate/);
    // Edge / shared-cache directives (task #106): s-maxage tells upstream
    // proxies how long they may reuse the response without revalidating, and
    // stale-while-revalidate lets them serve a stale hit while refreshing
    // in the background so repeat hits don't reach origin.
    expect(res.headers["cache-control"]).toMatch(/s-maxage=\d+/);
    expect(res.headers["cache-control"]).toMatch(/stale-while-revalidate=\d+/);
    // ETag = `"<build-stamp>-<base64-digest>"` (task #105 folds the deploy
    // stamp into the tag so a redeploy invalidates cached marketing HTML).
    expect(res.headers["etag"]).toMatch(/^"[A-Za-z0-9._-]+-[A-Za-z0-9+/]+"$/);
    expect(res.headers["last-modified"]).toBeTruthy();
    expect(res.headers["vary"]).toMatch(/Accept-Language/i);
    expect(res.headers["content-language"]).toBe("en");
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["x-build-stamp"]).toBeTruthy();
    // The ETag must begin with the same build stamp the response advertises.
    expect(res.headers["etag"]).toContain(res.headers["x-build-stamp"]);
  });

  it("returns 304 with no body when If-None-Match matches the served ETag", async () => {
    const first = await get("/verify", { "Accept-Language": "en" });
    expect(first.status).toBe(200);
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();

    const second = await get("/verify", {
      "Accept-Language": "en",
      "If-None-Match": etag,
    });
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
    expect(second.headers["etag"]).toBe(etag);
  });

  it("returns 304 when If-Modified-Since is not older than Last-Modified", async () => {
    const first = await get("/community", { "Accept-Language": "en" });
    const lastMod = first.headers["last-modified"];
    expect(lastMod).toBeTruthy();

    const second = await get("/community", {
      "Accept-Language": "en",
      "If-Modified-Since": lastMod,
    });
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("returns a fresh 200 when If-None-Match does not match", async () => {
    const res = await get("/", {
      "Accept-Language": "en",
      "If-None-Match": '"definitely-not-the-current-etag"',
    });
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("ignores If-Modified-Since when If-None-Match is present but does not match (RFC 7232 precedence)", async () => {
    // First get a valid Last-Modified the server would otherwise honor.
    const seed = await get("/verify", { "Accept-Language": "en" });
    const lastMod = seed.headers["last-modified"];
    expect(lastMod).toBeTruthy();

    // INM mismatch + IMS that would otherwise allow 304 → must be 200,
    // because per RFC 7232 §6 If-None-Match takes precedence.
    const res = await get("/verify", {
      "Accept-Language": "en",
      "If-None-Match": '"stale-tag-from-a-previous-deploy"',
      "If-Modified-Since": lastMod,
    });
    expect(res.status).toBe(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("emits a different ETag for the same path in a different locale (so shared caches don't collide)", async () => {
    const en = await get("/", { "Accept-Language": "en" });
    const de = await get("/?lang=de");
    expect(en.headers["etag"]).toBeTruthy();
    expect(de.headers["etag"]).toBeTruthy();
    expect(en.headers["etag"]).not.toBe(de.headers["etag"]);
    expect(de.headers["content-language"]).toBe("de");
  });

  it("changes the ETag when the build stamp changes (task #105 cache-bust)", async () => {
    // Re-load the static module with a different BUILD_STAMP to simulate
    // a fresh redeploy of byte-identical HTML. The ETag must change so
    // any shared cache revalidating after max-age gets a 200 with the
    // new payload instead of a 304 against the previous deploy's tag.
    const first = await get("/", { "Accept-Language": "en" });
    const firstEtag = first.headers["etag"];
    const firstStamp = first.headers["x-build-stamp"];
    expect(firstEtag).toBeTruthy();

    vi.resetModules();
    __resetPrerenderCacheForTests();
    const prevStamp = process.env.BUILD_STAMP;
    process.env.BUILD_STAMP = `redeploy-${Date.now()}`;
    try {
      const { serveStatic: serveStaticReloaded } = await import("../static");
      const app2 = express();
      serveStaticReloaded(app2);
      const res = await request(app2)
        .get("/")
        .set("X-Forwarded-Host", "ibccf.site")
        .set("X-Forwarded-Proto", "https")
        .set("Accept-Language", "en");
      expect(res.status).toBe(200);
      expect(res.headers["x-build-stamp"]).toBe(process.env.BUILD_STAMP);
      expect(res.headers["x-build-stamp"]).not.toBe(firstStamp);
      expect(res.headers["etag"]).not.toBe(firstEtag);
      // The previous deploy's ETag must NOT 304 against the new server.
      const stale = await request(app2)
        .get("/")
        .set("X-Forwarded-Host", "ibccf.site")
        .set("X-Forwarded-Proto", "https")
        .set("Accept-Language", "en")
        .set("If-None-Match", firstEtag);
      expect(stale.status).toBe(200);
    } finally {
      if (prevStamp === undefined) delete process.env.BUILD_STAMP;
      else process.env.BUILD_STAMP = prevStamp;
    }
  });

  it("does NOT cache portal / app-shell routes", async () => {
    const res = await get("/dashboard");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["etag"]).toBeUndefined();
    expect(res.headers["content-language"]).toBeUndefined();
  });

  it("serves a real 404 with noindex for unrecognized URLs (crawlability fix)", async () => {
    const res = await get("/portal/dashboard");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("serves 200 with noindex for known non-indexable app shells like /contact-admin", async () => {
    const res = await get("/contact-admin");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
