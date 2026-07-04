/**
 * Tests for GET /tutorial-videos/:locale
 *
 * The route serves locale-specific MP4 recordings of the withdrawal
 * tutorial from `video/public/recordings/` (dev) or `dist/tutorial-videos/`
 * (prod).  `resolveRecordingsDir()` probes a list of candidate paths; in the
 * test environment it finds `process.cwd()/video/public/recordings` which
 * already holds all six locale files, so no fs mocking is needed.
 *
 * Coverage:
 *  1. Known locale → 200 with Content-Type: video/mp4
 *  2. Unknown locale → falls back to English file (filename in
 *     Content-Disposition contains "en")
 *  3. Known locale with .mp4 extension in URL → same as without extension
 *  4. `?download=1`  → Content-Disposition: attachment; filename=…
 *  5. No download param → Content-Disposition: inline; filename=…
 *  6. `?download=true` → also treated as attachment
 *  7. Content-Disposition filename matches the locale actually served
 *  8. Range request on a known locale → 206 Partial Content
 *  9. Cache-Control header is set (public, long max-age)
 * 10. Content-Type is video/mp4 for all successful responses
 */

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { tutorialVideoRouter } from "../routes/tutorial-video";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(tutorialVideoRouter);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function get(url: string, headers: Record<string, string> = {}) {
  const r = request(app).get(url);
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r;
}

// ---------------------------------------------------------------------------
// 1–3 Locale selection
// ---------------------------------------------------------------------------

describe("locale selection", () => {
  it("serves the correct locale file for a known locale", async () => {
    const res = await get("/tutorial-videos/fr");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/video\/mp4/);
    expect(res.headers["content-disposition"]).toContain("fr");
  });

  it("serves all six supported locales without error", async () => {
    for (const locale of ["en", "es", "fr", "de", "pt", "zh"]) {
      const res = await get(`/tutorial-videos/${locale}`);
      expect(res.status, `locale ${locale} should return 200`).toBe(200);
    }
  });

  it("falls back to English for an unknown locale code", async () => {
    const res = await get("/tutorial-videos/xx");
    expect(res.status).toBe(200);
    // The filename in Content-Disposition must reference the English recording
    expect(res.headers["content-disposition"]).toContain(
      "withdrawal-tutorial-en.mp4",
    );
  });

  it("strips a .mp4 extension from the locale parameter", async () => {
    const res = await get("/tutorial-videos/de.mp4");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("de");
  });

  it("strips a region subtag (e.g. es-419 → es)", async () => {
    const res = await get("/tutorial-videos/es-419");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      "withdrawal-tutorial-es.mp4",
    );
  });
});

// ---------------------------------------------------------------------------
// 4–6 Content-Disposition: inline vs attachment
// ---------------------------------------------------------------------------

describe("Content-Disposition disposition type", () => {
  it("serves inline (no download param) by default", async () => {
    const res = await get("/tutorial-videos/en");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
  });

  it("serves as attachment when ?download=1", async () => {
    const res = await get("/tutorial-videos/en?download=1");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("serves as attachment when ?download=true", async () => {
    const res = await get("/tutorial-videos/en?download=true");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("ignores unrecognised download param values (e.g. ?download=yes) — stays inline", async () => {
    const res = await get("/tutorial-videos/en?download=yes");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
  });
});

// ---------------------------------------------------------------------------
// 7 Filename in Content-Disposition matches served locale
// ---------------------------------------------------------------------------

describe("Content-Disposition filename", () => {
  it("uses the requested locale in the filename for a known locale", async () => {
    const res = await get("/tutorial-videos/pt");
    expect(res.headers["content-disposition"]).toContain(
      'filename="withdrawal-tutorial-pt.mp4"',
    );
  });

  it("uses 'en' in the filename when falling back from an unknown locale", async () => {
    const res = await get("/tutorial-videos/zz");
    expect(res.headers["content-disposition"]).toContain(
      'filename="withdrawal-tutorial-en.mp4"',
    );
  });

  it("includes the filename in an attachment response too", async () => {
    const res = await get("/tutorial-videos/zh?download=1");
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment;.*filename="withdrawal-tutorial-zh\.mp4"/,
    );
  });
});

// ---------------------------------------------------------------------------
// 8 Range request → 206 Partial Content
// ---------------------------------------------------------------------------

describe("Range request (seek support)", () => {
  it("returns 206 Partial Content for a valid Range header on a known locale", async () => {
    const res = await get("/tutorial-videos/en", { Range: "bytes=0-1023" });
    // Express sendFile + Node http handle Range; 206 confirms it works.
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toMatch(/^bytes 0-/);
  });

  it("returns a Content-Range header with the full file size on a range response", async () => {
    const res = await get("/tutorial-videos/en", { Range: "bytes=0-0" });
    expect(res.status).toBe(206);
    // content-range: bytes 0-0/<size>
    expect(res.headers["content-range"]).toMatch(/^bytes 0-0\/\d+$/);
  });
});

// ---------------------------------------------------------------------------
// 9 Cache-Control
// ---------------------------------------------------------------------------

describe("caching headers", () => {
  it("includes a public Cache-Control header with a long max-age", async () => {
    const res = await get("/tutorial-videos/en");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public/);
    // At least one day (86400 s)
    const match = res.headers["cache-control"]?.match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(86400);
  });
});

// ---------------------------------------------------------------------------
// 10 Content-Type
// ---------------------------------------------------------------------------

describe("Content-Type", () => {
  it("is video/mp4 for every locale", async () => {
    for (const locale of ["en", "es", "de"]) {
      const res = await get(`/tutorial-videos/${locale}`);
      expect(res.headers["content-type"], `locale ${locale}`).toMatch(
        /video\/mp4/,
      );
    }
  });
});
