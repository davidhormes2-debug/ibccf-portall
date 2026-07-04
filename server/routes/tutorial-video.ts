import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

// Localized recordings of the withdrawal tutorial. These MP4s are produced
// by `video/scripts/record-videos.sh` and live in `video/public/recordings`
// during development; the production build copies them next to the server
// bundle (see script/build.ts). Kept inline so the server stays decoupled
// from the Vite-built client — update alongside `SUPPORTED_LOCALES`.
const SUPPORTED_LOCALE_CODES = ["en", "es", "fr", "de", "pt", "zh"] as const;
const DEFAULT_LOCALE_CODE = "en";

// One year — the file name is locale-stable and the content only changes on
// redeploy (a re-record ships a new build), so aggressive caching is safe.
const VIDEO_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Resolve the directory holding the recorded MP4s. This module is loaded
// both as ESM (dev via tsx) and as a CJS bundle (prod `dist/index.cjs`,
// built with esbuild `format:"cjs"`). In CJS output esbuild strips
// `import.meta`, while ESM has no `__dirname` — so we read both defensively
// (the bare `__dirname` reference would throw a ReferenceError in dev) and
// probe a list of well-known layouts. Production copies the recordings to
// `dist/tutorial-videos` (see script/build.ts); dev reads them from the
// in-repo source. Returns null when none exist so callers respond 404.
function resolveRecordingsDir(): string | null {
  const dirnameCandidates: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname.length > 0) {
      dirnameCandidates.push(__dirname);
    }
  } catch {
    // `__dirname` is undefined under ESM — ignore.
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
      // Bundled prod: dist/index.cjs → dist/tutorial-videos
      path.resolve(base, "tutorial-videos"),
      // Bundled prod (alt layout, e.g. dist/server/index.cjs)
      path.resolve(base, "..", "tutorial-videos"),
    );
  }
  candidates.push(
    path.resolve(process.cwd(), "dist", "tutorial-videos"),
    // Dev source
    path.resolve(process.cwd(), "video", "public", "recordings"),
  );

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // Ignore probe errors and keep trying the next candidate.
    }
  }
  return null;
}

function fileForLocale(dir: string, locale: string): string | null {
  const filePath = path.join(dir, `withdrawal-tutorial-${locale}.mp4`);
  return fs.existsSync(filePath) ? filePath : null;
}

export const tutorialVideoRouter = Router();

// GET /tutorial-videos/:locale[.mp4]
//
// Streams the withdrawal-tutorial recording matching the requested locale,
// falling back to English when the requested locale is unknown or its file
// is missing. `?download=1` forces a Save-As (Content-Disposition:
// attachment); otherwise the file plays inline. `res.sendFile` handles
// Range requests, ETag and Last-Modified, so seeking and conditional GETs
// work out of the box.
tutorialVideoRouter.get(
  "/tutorial-videos/:locale",
  (req: Request, res: Response) => {
    const raw = String(req.params.locale || "")
      .toLowerCase()
      .replace(/\.mp4$/, "")
      .split("-")[0];
    const locale = (SUPPORTED_LOCALE_CODES as readonly string[]).includes(raw)
      ? raw
      : DEFAULT_LOCALE_CODE;

    const dir = resolveRecordingsDir();
    if (!dir) {
      return res
        .status(404)
        .json({ message: "Tutorial videos are not available." });
    }

    const filePath =
      fileForLocale(dir, locale) ?? fileForLocale(dir, DEFAULT_LOCALE_CODE);
    if (!filePath) {
      return res
        .status(404)
        .json({ message: "Tutorial video not found." });
    }

    const servedLocale = path
      .basename(filePath)
      .replace(/^withdrawal-tutorial-/, "")
      .replace(/\.mp4$/, "");
    const download =
      req.query.download === "1" || req.query.download === "true";

    res.setHeader("Cache-Control", `public, max-age=${VIDEO_MAX_AGE_SECONDS}`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="withdrawal-tutorial-${servedLocale}.mp4"`,
    );

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ message: "Tutorial video not found." });
      }
    });
  },
);
