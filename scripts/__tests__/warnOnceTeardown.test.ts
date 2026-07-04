import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ============================================================================
// Source-assertion: warnOnce dedup reset in test teardown (scripts scan)
//
// WHY THIS TEST EXISTS
// `warnOnce` in `server/lib/warnOnce.ts` deduplicates repeated warn messages
// using a module-level Map with a 60-second TTL. When a test fires a warnOnce
// code path and the next test runs within the same 60-second window, the dedup
// map will suppress a warn call the next test expects — a subtle cross-test
// bleed that produces flaky assertion failures.
//
// `__resetWarnDedupForTests()` exists solely to clear that map before each
// test, but callers must remember to invoke it in `beforeEach`. This test
// ensures no future test file silently forgets:
//
//   Any test file that REFERENCES `warnOnce` without fully mocking the module
//   MUST also contain an invocation of `__resetWarnDedupForTests(`.
//
// WHAT COUNTS AS "FULLY MOCKED"
// Files that do `vi.mock(…/lib/warnOnce…)` (single or double quotes, with or
// without trailing content) replace the real module entirely — the dedup Map
// is never touched, so no reset is required. Those files are excluded.
//
// SCOPE
// The scan covers all `*.test.ts` files under `scripts/`, `video/scripts/`,
// and `shared/` recursively, matching the remaining Vitest `include` globs
// from vitest.config.ts:
//   `scripts/**/*.test.ts`
//   `video/scripts/**/*.test.ts`
//   `shared/**/*.test.ts`
// ============================================================================

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = [
  path.join(REPO_ROOT, "scripts"),
  path.join(REPO_ROOT, "video", "scripts"),
  path.join(REPO_ROOT, "shared"),
];

// Recursively collect all *.test.ts files under a directory.
function collectTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

// Detects a full vi.mock of the warnOnce module, using either quote style.
// Matches: vi.mock('./lib/warnOnce', …) / vi.mock("../lib/warnOnce") / etc.
const FULL_MOCK_RE = /vi\.mock\(['"]([^'"]*\/lib\/warnOnce)['"]/;

describe("warnOnce dedup-reset teardown guard (scripts + video/scripts)", () => {
  it("every scripts/video test file that uses warnOnce without a full vi.mock also invokes __resetWarnDedupForTests()", () => {
    const thisFile = path.resolve(__filename);
    // The coverage companion also mentions "warnOnce" only in documentation
    // strings and JSDoc — it is not a runtime consumer of the module.
    const coverageFile = path.resolve(__dirname, "warnOnceGuardCoverage.test.ts");

    const files = SCAN_ROOTS.flatMap(collectTestFiles).filter(
      // Exclude source-assertion files that reference "warnOnce" only in
      // string literals and comments, not as a runtime dependency.
      (f) => f !== thisFile && f !== coverageFile,
    );

    const violators: string[] = [];

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf-8");

      const mentionsWarnOnce = source.includes("warnOnce");
      const hasFullMock = FULL_MOCK_RE.test(source);
      // Require a call (opening paren), not just the symbol being mentioned.
      const hasResetCall = source.includes("__resetWarnDedupForTests(");

      if (mentionsWarnOnce && !hasFullMock && !hasResetCall) {
        violators.push(path.relative(REPO_ROOT, filePath));
      }
    }

    expect(
      violators,
      [
        "The following scripts/video test files reference warnOnce without a full vi.mock but do",
        "not invoke __resetWarnDedupForTests() — add it to beforeEach to prevent the",
        "60-second dedup window from bleeding across tests:",
        ...violators.map((f) => `  ${f}`),
      ].join("\n"),
    ).toEqual([]);
  });
});
