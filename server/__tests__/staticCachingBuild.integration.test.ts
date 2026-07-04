import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

import { buildServer } from "../../script/build";

const TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "client", "index.html"),
  "utf-8",
);

// Bundle inside the workspace tree (not /tmp) so `require("express")` in the
// emitted CJS resolves against the workspace's node_modules.
const TMP_ROOT = fs.mkdtempSync(
  path.join(path.resolve(__dirname, "..", ".."), "node_modules", ".static-build-stamp-test-"),
);

// serveStatic asserts `<__dirname>/public/index.html` exists at boot. Plant
// the real client template there so the bundle loads and serves the same
// HTML the production build would.
fs.mkdirSync(path.join(TMP_ROOT, "public"), { recursive: true });
fs.writeFileSync(path.join(TMP_ROOT, "public", "index.html"), TEMPLATE, "utf-8");

async function buildStaticBundle(stamp: string, suffix: string): Promise<string> {
  const outfile = path.join(TMP_ROOT, `static.${suffix}.cjs`);
  // Reuse the exact production build configuration (define, externals,
  // platform). If anyone removes the BUILD_STAMP define from script/build.ts
  // — the regression this test guards against — `buildServer` will stop
  // baking the stamp in and the assertions below will fail.
  await buildServer({
    release: stamp,
    entryPoints: [path.resolve(__dirname, "..", "static.ts")],
    outfile,
    // Skip minification so build is faster; minify doesn't affect the define.
    minify: false,
  });
  return outfile;
}

function loadServeStatic(bundlePath: string): (app: express.Express) => void {
  // Force a fresh module instance so module-level BUILD_STAMP is re-evaluated
  // against the freshly-bundled artefact.
  delete require.cache[require.resolve(bundlePath)];
  const mod = require(bundlePath) as { serveStatic: (app: express.Express) => void };
  return mod.serveStatic;
}

function mountAndGet(
  serveStatic: (a: express.Express) => void,
  url: string,
  headers: Record<string, string> = {},
) {
  const app = express();
  serveStatic(app);
  const r = request(app)
    .get(url)
    .set("X-Forwarded-Host", "ibccf.site")
    .set("X-Forwarded-Proto", "https");
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r;
}

const STAMP_A = "build-stamp-a-1234567";
const STAMP_B = "build-stamp-b-9876543";

let bundleA: string;
let bundleB: string;

beforeAll(async () => {
  // Clear any ambient BUILD_STAMP / SENTRY_RELEASE so the only stamp the
  // bundle can see is the one buildServer inlines via `define`. That's the
  // contract under test: the stamp must reach the response because esbuild
  // baked it in at build time, not because the runtime env still carries it.
  delete process.env.BUILD_STAMP;
  delete process.env.SENTRY_RELEASE;
  bundleA = await buildStaticBundle(STAMP_A, "a");
  bundleB = await buildStaticBundle(STAMP_B, "b");
}, 60_000);

afterAll(() => {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("production build pipeline bakes BUILD_STAMP into marketing responses — task #110", () => {
  it("X-Build-Stamp on a real build matches the value the production esbuild config injected", async () => {
    // Belt-and-braces: also assert the stamp is present as a string literal
    // in the emitted bundle, so a regression that removes the define from
    // script/build.ts fails here even if the runtime check below somehow
    // picked the value up from elsewhere.
    const bundleSrc = fs.readFileSync(bundleA, "utf-8");
    expect(bundleSrc).toContain(STAMP_A);

    const serveStatic = loadServeStatic(bundleA);
    const res = await mountAndGet(serveStatic, "/", { "Accept-Language": "en" });
    expect(res.status).toBe(200);
    expect(res.headers["x-build-stamp"]).toBe(STAMP_A);
    // The ETag must embed the same stamp the response advertises, otherwise
    // shared caches would revalidate against a tag that doesn't change on
    // redeploy.
    expect(res.headers["etag"]).toContain(STAMP_A);
  });

  it("a second build with a different BUILD_STAMP produces a different ETag for byte-identical HTML", async () => {
    const first = await mountAndGet(loadServeStatic(bundleA), "/", { "Accept-Language": "en" });
    const second = await mountAndGet(loadServeStatic(bundleB), "/", { "Accept-Language": "en" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Sanity: HTML body is byte-identical between the two builds APART
    // from the one tag we deliberately inject per-build — the
    // `<meta name="build-stamp">` line that BuildStampLine.tsx surfaces
    // for support ("what does meta build-stamp say?"). Strip that single
    // line before comparing so the regression we actually care about
    // (task #105: copy/layout changes silently shared across builds)
    // still trips this assertion if anything else drifts.
    const stripStamp = (html: string) =>
      html.replace(
        /\s*<meta\s+name="build-stamp"\s+content="[^"]*"\s*\/?>/i,
        "",
      );
    expect(stripStamp(second.text)).toBe(stripStamp(first.text));

    expect(first.headers["x-build-stamp"]).toBe(STAMP_A);
    expect(second.headers["x-build-stamp"]).toBe(STAMP_B);
    expect(second.headers["etag"]).not.toBe(first.headers["etag"]);

    // And a shared cache holding the previous deploy's tag must get a 200
    // (not a 304) against the new build.
    const stale = await mountAndGet(loadServeStatic(bundleB), "/", {
      "Accept-Language": "en",
      "If-None-Match": first.headers["etag"],
    });
    expect(stale.status).toBe(200);
  });
});
