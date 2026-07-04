#!/usr/bin/env node
// record-videos.mjs — headlessly record one MP4 per locale of the withdrawal
// tutorial video.
//
// The standalone recorder app (video/) is a live React/Framer-Motion
// animation, not a pre-rendered file. This script:
//   1. Builds the recorder app to static files (unless --skip-build).
//   2. Serves the build over a local HTTP server.
//   3. For each locale, opens it headlessly at `/?lang=<code>` in Chromium with
//      Playwright video capture, using the app's own
//      `window.startRecording` / `window.stopRecording` lifecycle hooks to time
//      exactly one full pass of the animation.
//   4. Transcodes each captured WebM into an H.264 MP4 via ffmpeg, muxing in the
//      locale's per-scene narration clips (delayed to each scene's start offset
//      and summed into one audio bed) so the exported MP4s are narrated, not
//      silent. Locales with no narration assets fall back to a silent export.
//
// Output: video/public/recordings/withdrawal-tutorial-<locale>.mp4
// Those files are served by the recorder app at /recordings/<file> and can be
// referenced for marketing, email embeds, or offline use.
//
// Usage:
//   node video/scripts/record-videos.mjs                # all six locales
//   node video/scripts/record-videos.mjs en de          # a subset
//   node video/scripts/record-videos.mjs --skip-build    # reuse existing build
//   WIDTH=1920 HEIGHT=1080 node video/scripts/record-videos.mjs
//
// Requirements: ffmpeg on PATH and a Chromium binary resolvable by Playwright
// (Replit sets REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE automatically).

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_PATH,
  recordedLocalesFromResults,
  updateManifest,
} from "./recordingFingerprint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(VIDEO_DIR, "..");
const DIST_DIR = path.join(VIDEO_DIR, "dist", "public");
const OUTPUT_DIR = path.join(VIDEO_DIR, "public", "recordings");
const TMP_DIR = path.join(VIDEO_DIR, ".recordings-tmp");
// Per-scene narration clips generated for the portal voiceover. Each locale has
// one mp3 per scene key; we delay each to its scene's start offset and sum them
// into a single audio bed muxed onto the captured video.
const NARRATION_DIR = path.join(
  REPO_ROOT,
  "client",
  "public",
  "withdrawal-video",
  "narration",
);

// Scene lengths (ms), in play order. Single source of truth is
// `video/scene-durations.json` — edit that file; this script, VideoTemplate.tsx,
// and the portal's sceneDurations.ts all read from it automatically.
const SCENE_DURATIONS = JSON.parse(
  readFileSync(path.join(VIDEO_DIR, "scene-durations.json"), "utf8"),
);

// Cumulative start offset (ms) of each scene's narration within a single pass.
function sceneNarrationOffsets() {
  const offsets = [];
  let acc = 0;
  for (const [key, duration] of Object.entries(SCENE_DURATIONS)) {
    offsets.push({ key, offsetMs: acc });
    acc += duration;
  }
  return offsets;
}

// Resolve the existing narration clips for a locale, paired with their scene
// start offset. Missing clips are skipped so a partially-narrated locale still
// gets whatever audio exists; a locale with none falls back to a silent export.
function narrationClipsForLocale(locale) {
  return sceneNarrationOffsets()
    .map(({ key, offsetMs }) => ({
      offsetMs,
      file: path.join(NARRATION_DIR, locale, `${key}.mp3`),
    }))
    .filter(({ file }) => existsSync(file));
}

const ALL_LOCALES = ["en", "es", "fr", "de", "pt", "zh"];

const WIDTH = Number(process.env.WIDTH ?? 1280);
const HEIGHT = Number(process.env.HEIGHT ?? 720);
const FPS = Number(process.env.FPS ?? 30);
// Hard ceiling so a wiring bug (stopRecording never fires) can't hang forever.
// One full pass of the tutorial is ~50s; allow generous head/tail room.
const MAX_RECORD_MS = Number(process.env.MAX_RECORD_MS ?? 90_000);

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const requested = args.filter((a) => !a.startsWith("--"));
const locales = requested.length
  ? requested.filter((l) => ALL_LOCALES.includes(l))
  : ALL_LOCALES;

if (requested.length && locales.length !== requested.length) {
  const unknown = requested.filter((l) => !ALL_LOCALES.includes(l));
  console.error(`Unknown locale(s): ${unknown.join(", ")}`);
  console.error(`Supported locales: ${ALL_LOCALES.join(", ")}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
};

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}

function ffmpeg(ffArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ffArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

async function startStaticServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/" || pathname === "") pathname = "/index.html";
      let filePath = path.join(root, pathname);
      // Prevent path traversal outside the served root.
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (!existsSync(filePath)) {
        // SPA fallback to index.html for unknown routes.
        filePath = path.join(root, "index.html");
      }
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port };
}

async function recordLocale({ port, locale, executablePath }) {
  const localeTmp = path.join(TMP_DIR, locale);
  await mkdir(localeTmp, { recursive: true });

  // A fresh browser per locale guarantees the bundled video-encoder (ffmpeg)
  // and renderer processes are fully released between recordings. Reusing one
  // browser across contexts let encoder load accumulate and stalled the
  // capture after the first locale.
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Keep rAF/timers running at full speed. Headless pages are otherwise
      // treated as backgrounded/occluded and throttled, which freezes the
      // animation mid-pass and stalls the video capture.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    recordVideo: { dir: localeTmp, size: { width: WIDTH, height: HEIGHT } },
  });

  const page = await context.newPage();

  // The animation drives its own recording lifecycle via these globals
  // (see video/src/lib/video/hooks.ts). We use them purely as timing signals:
  // startRecording fires on mount, stopRecording fires after exactly one full
  // pass. Capturing the wall-clock deltas lets us trim the Playwright capture
  // to that precise window.
  const contextStart = Date.now();
  let recStart = null;
  let recStop = null;
  let resolveStop;
  const stopped = new Promise((resolve) => (resolveStop = resolve));

  await page.exposeFunction("startRecording", () => {
    recStart = Date.now();
  });
  await page.exposeFunction("stopRecording", () => {
    if (recStop === null) {
      recStop = Date.now();
      resolveStop();
    }
  });

  await page.goto(`http://127.0.0.1:${port}/?lang=${locale}`, {
    waitUntil: "load",
  });

  // Wait for one full pass, with a hard ceiling as a safety net.
  await Promise.race([
    stopped,
    new Promise((resolve) => setTimeout(resolve, MAX_RECORD_MS)),
  ]);

  // Small tail so the final frame's exit animation is captured.
  await page.waitForTimeout(500);

  const video = page.video();
  await context.close(); // finalizes the .webm
  const webmPath = await video.path();
  await browser.close();

  const leadInSec = recStart ? Math.max(0, (recStart - contextStart) / 1000) : 0;
  const durationSec = recStart && recStop ? (recStop - recStart) / 1000 : null;

  const outPath = path.join(
    OUTPUT_DIR,
    `withdrawal-tutorial-${locale}.mp4`,
  );

  const narrationClips = narrationClipsForLocale(locale);

  // -ss before -i seeks the captured video to the recording start; the narration
  // inputs follow. Each clip is delayed to its scene offset and the clips are
  // summed (normalize=0 keeps original loudness; the clips never overlap) into a
  // single audio bed mapped alongside the trimmed video.
  const ffArgs = ["-y", "-ss", leadInSec.toFixed(3), "-i", webmPath];
  for (const clip of narrationClips) ffArgs.push("-i", clip.file);

  if (narrationClips.length) {
    const delayed = narrationClips.map(
      (clip, i) => `[${i + 1}:a]adelay=${clip.offsetMs}:all=1[a${i}]`,
    );
    const mixInputs = narrationClips.map((_, i) => `[a${i}]`).join("");
    const filter =
      `${delayed.join(";")};` +
      `${mixInputs}amix=inputs=${narrationClips.length}:normalize=0[aout]`;
    ffArgs.push(
      "-filter_complex",
      filter,
      "-map",
      "0:v:0",
      "-map",
      "[aout]",
    );
  }

  if (durationSec) ffArgs.push("-t", durationSec.toFixed(3));
  ffArgs.push(
    "-r",
    String(FPS),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  );
  if (narrationClips.length) {
    ffArgs.push("-c:a", "aac", "-b:a", "192k");
  } else {
    ffArgs.push("-an");
  }
  ffArgs.push(outPath);

  await ffmpeg(ffArgs);

  const { size } = await stat(outPath);
  return {
    locale,
    outPath,
    sizeMB: (size / (1024 * 1024)).toFixed(2),
    durationSec: durationSec ? durationSec.toFixed(1) : "n/a",
    timedOut: recStop === null,
    narratedScenes: narrationClips.length,
  };
}

async function main() {
  console.log(
    `Recording locales: ${locales.join(", ")} @ ${WIDTH}x${HEIGHT} ${FPS}fps`,
  );

  if (!skipBuild) {
    console.log("\n› Building recorder app…");
    await run(
      "npx",
      ["vite", "build", "--config", "video/vite.config.ts"],
      { cwd: REPO_ROOT },
    );
  } else if (!existsSync(path.join(DIST_DIR, "index.html"))) {
    console.error(
      `--skip-build set but no build found at ${DIST_DIR}. Run without --skip-build first.`,
    );
    process.exit(1);
  }

  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const { server, port } = await startStaticServer(DIST_DIR);
  console.log(`\n› Serving ${DIST_DIR} on http://127.0.0.1:${port}`);

  // Mirror playwright.config.ts: Replit's sandbox blocks `npx playwright
  // install`, so point at the system/Replit-provided Chromium when available.
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    undefined;

  const results = [];
  try {
    for (const locale of locales) {
      console.log(`\n› Recording ${locale}…`);
      const result = await recordLocale({ port, locale, executablePath });
      if (result.timedOut) {
        console.warn(
          `  ! ${locale}: stopRecording never fired — hit the ${MAX_RECORD_MS}ms ceiling. ` +
            `Check the recording lifecycle (bash video/scripts/validate-recording.sh).`,
        );
      }
      if (result.narratedScenes === 0) {
        console.warn(
          `  ! ${locale}: no narration clips found under ` +
            `${path.relative(REPO_ROOT, path.join(NARRATION_DIR, locale))} — exported silently.`,
        );
      }
      const audioNote =
        result.narratedScenes > 0
          ? `${result.narratedScenes} narration scene(s)`
          : "silent";
      console.log(
        `  ✓ ${path.relative(REPO_ROOT, result.outPath)} (${result.sizeMB} MB, ${result.durationSec}s, ${audioNote})`,
      );
      results.push(result);
    }
  } finally {
    server.close();
    await rm(TMP_DIR, { recursive: true, force: true });
  }

  // Stamp each successfully recorded locale with the current source fingerprint
  // so the freshness test can later tell which MP4s drifted from the animation
  // source. A locale that hit the MAX_RECORD_MS ceiling is suspect, so we skip
  // it rather than vouch for a possibly-truncated capture.
  const recorded = recordedLocalesFromResults(results);
  if (recorded.length) {
    await updateManifest(recorded);
    console.log(
      `\n› Updated ${path.relative(REPO_ROOT, MANIFEST_PATH)} for: ${recorded.join(", ")}`,
    );
  }

  console.log("\nDone. Recorded files:");
  for (const r of results) {
    console.log(
      `  ${r.locale}  →  ${path.relative(REPO_ROOT, r.outPath)}  (${r.sizeMB} MB)`,
    );
  }
}

main().catch((err) => {
  console.error("\nRecording failed:", err);
  process.exit(1);
});
