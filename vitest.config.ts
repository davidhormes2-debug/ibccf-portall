import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Client tests render React components written without an explicit
  // `import React from "react"` (the runtime is `react-jsx`). Tell
  // esbuild (Vitest's default transformer) to emit the automatic
  // runtime so those files transpile cleanly under JSDOM.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    cache: { dir: ".vitest-cache" },
    environment: "node",
    include: ["server/**/*.test.ts", "client/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "video/scripts/**/*.test.ts", "shared/**/*.test.ts"],
    globals: false,
    environmentMatchGlobs: [["client/**", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
