import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Plugin } from "vite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CAPTIONS_FILE = path.resolve(
  REPO_ROOT,
  "client/src/components/portal/withdrawal-video/captions.ts",
);
const CHECK_SCRIPT = path.resolve(REPO_ROOT, "scripts/check-narration-fresh.ts");

function runCheck(): void {
  const result = spawnSync(
    "npx",
    ["tsx", CHECK_SCRIPT],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );

  const stale = result.status !== 0;

  if (stale) {
    const lines = (result.stderr || result.stdout || "").trim().split("\n");
    console.warn("\n\x1b[33m┌─────────────────────────────────────────────────────────────────┐");
    console.warn(  "\x1b[33m│  ⚠  NARRATION OUT OF DATE                                       │");
    console.warn(  "\x1b[33m│  captions.ts has changed since the last audio was generated.     │");
    console.warn(  "\x1b[33m│  Run:  npm run narration:generate                                │");
    console.warn(  "\x1b[33m│  (or stamp only:  npm run narration:stamp)                       │");
    console.warn(  "\x1b[33m└─────────────────────────────────────────────────────────────────┘\x1b[0m\n");
    for (const line of lines) {
      if (line.trim()) {
        console.warn(`\x1b[33m  ${line}\x1b[0m`);
      }
    }
    console.warn("");
  } else {
    console.log(
      "\x1b[32m  ✓ narration audio is up to date with captions.ts\x1b[0m",
    );
  }
}

export function narrationFreshnessPlugin(): Plugin {
  return {
    name: "narration-freshness",
    apply: "serve",

    configureServer(server) {
      console.log("\x1b[36m  [narration-freshness] checking narration audio…\x1b[0m");
      runCheck();

      server.watcher.add(CAPTIONS_FILE);
      server.watcher.on("change", (file) => {
        if (file === CAPTIONS_FILE) {
          console.log(
            "\x1b[36m  [narration-freshness] captions.ts changed — re-checking narration…\x1b[0m",
          );
          runCheck();
        }
      });
    },
  };
}
