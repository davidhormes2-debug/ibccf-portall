import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    cache: { dir: ".vitest-cache" },
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
