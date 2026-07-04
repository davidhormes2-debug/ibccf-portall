import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp, readdir } from "fs/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";

export function deriveSentryRelease(): string {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha) return `ibccf@${sha}`;
  } catch {
    // git unavailable — fall through to timestamp
  }
  return `ibccf@${Date.now()}`;
}

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
export const allowlist = [
  "@google/generative-ai",
  "@neondatabase/serverless",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

// Server-bundle build step, exported so integration tests can invoke the
// exact same esbuild configuration (especially the `define` block that
// inlines BUILD_STAMP) against a controlled entry / outfile / stamp.
// `entryPoints` and `outfile` default to the production layout; tests pass
// `server/static.ts` + a temp outfile and a deterministic `release`.
export async function buildServer(opts: {
  release: string;
  entryPoints?: string[];
  outfile?: string;
  minify?: boolean;
} = { release: "" }) {
  const release = opts.release;
  const entryPoints = opts.entryPoints ?? ["server/index.ts"];
  const outfile = opts.outfile ?? "dist/index.cjs";
  const minify = opts.minify ?? true;

  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints,
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile,
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.SENTRY_RELEASE": JSON.stringify(release),
      // Inline the deploy stamp so dist/index.cjs carries it even if the
      // runtime environment forgets to forward BUILD_STAMP (the marketing
      // ETag cache-bust depends on this being present).
      "process.env.BUILD_STAMP": JSON.stringify(release),
    },
    minify,
    external: externals,
    logLevel: "info",
  });
}

async function buildAll() {
  // Mark this build with a Sentry release tag so client + server + uploaded
  // source maps all share the same identifier and stack traces resolve.
  const release = deriveSentryRelease();
  process.env.SENTRY_RELEASE = release;
  process.env.VITE_SENTRY_RELEASE = release;
  process.env.NODE_ENV = "production";
  // Use the same identifier as both the Sentry release tag and the marketing
  // ETag build stamp (see server/static.ts). Folding the deploy stamp into
  // the ETag is what guarantees a redeploy invalidates cached marketing
  // HTML at every browser / shared edge on the next revalidation, even when
  // the rendered body is byte-identical to the previous deploy.
  process.env.BUILD_STAMP = release;
  console.log(`building with SENTRY_RELEASE=${release}`);

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  await buildServer({ release });

  // Copy translation JSONs so the server's SEO prerender helper can read
  // them at runtime (the esbuild bundle only handles JS). Without this,
  // dist/index.cjs falls back to the un-localised English template and
  // /?lang=de et al. would lose their localised <title>/meta/body again.
  const i18nSrc = "client/src/i18n/locales";
  if (existsSync(i18nSrc)) {
    const i18nDest = "dist/i18n-locales";
    await mkdir(i18nDest, { recursive: true });
    // Copy the contents of the source dir (NOT the dir itself) so the layout
    // is guaranteed to be `dist/i18n-locales/<lang>/seo.json` regardless of
    // platform-specific `cp` semantics. The SEO prerender helper's
    // findLocalesDir() probes for `<dir>/en/seo.json` and would silently
    // fall back to the un-localised template if the layout were wrong.
    const entries = await readdir(i18nSrc, { withFileTypes: true });
    for (const entry of entries) {
      await cp(`${i18nSrc}/${entry.name}`, `${i18nDest}/${entry.name}`, {
        recursive: true,
      });
    }
    if (!existsSync(`${i18nDest}/en/seo.json`)) {
      throw new Error(
        `i18n locale copy failed: expected ${i18nDest}/en/seo.json to exist`,
      );
    }
    console.log(`copied i18n locales: ${i18nSrc} → ${i18nDest}`);
  }

  // Copy runtime asset bundles that the server reads via fs at runtime
  // (the esbuild bundle above only handles JS). Today this is the CJK
  // font pair used by the NDA PDF renderer; without it, zh-locale
  // sealed documents would fall back to a Latin-only font and render
  // missing-glyph boxes.
  const fontSrc = "server/assets/fonts";
  if (existsSync(fontSrc)) {
    const fontDest = "dist/assets/fonts";
    await mkdir(fontDest, { recursive: true });
    await cp(fontSrc, fontDest, { recursive: true });
    console.log(`copied fonts: ${fontSrc} → ${fontDest}`);
  }

  // Copy the localized withdrawal-tutorial recordings next to the server
  // bundle so the runtime tutorial-video route (server/routes/tutorial-
  // video.ts) can stream them in production. The route probes
  // `dist/tutorial-videos` first, then the in-repo dev source.
  const videoSrc = "video/public/recordings";
  if (existsSync(videoSrc)) {
    const videoDest = "dist/tutorial-videos";
    await mkdir(videoDest, { recursive: true });
    await cp(videoSrc, videoDest, { recursive: true });
    console.log(`copied tutorial videos: ${videoSrc} → ${videoDest}`);
  }
}

// Only auto-run the full build when this file is invoked directly as a
// script (e.g. `tsx script/build.ts` from package.json), not when it's
// imported for its exported helpers (the staticCachingBuild integration
// test imports `buildServer` to verify the BUILD_STAMP define is wired).
// Without this guard, importing buildServer would unconditionally trigger
// `rm dist` + a full vite + esbuild build and could process.exit() the
// importer on failure.
//
// The repo is `"type": "module"`, so `require` may be undefined under
// tsx/ESM. Detect direct-run by comparing this file's path to argv[1]
// (the entry script tsx/node was asked to run). Endswith match handles
// absolute paths, relative paths, and the tsx case where argv[1] points
// at the .ts source.
const __invokedAs = process.argv[1] ?? "";
const __isDirectRun =
  __invokedAs.endsWith("script/build.ts") ||
  __invokedAs.endsWith("script/build.js") ||
  __invokedAs.endsWith("script\\build.ts") ||
  __invokedAs.endsWith("script\\build.js");
if (__isDirectRun) {
  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
