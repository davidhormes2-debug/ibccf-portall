import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

// Root of the repo relative to this test file (server/__tests__/ → ../../)
const ROOT = resolve(__dirname, "../../");
const ROUTES_DIR = resolve(ROOT, "server/routes");

// Route files whose public POST endpoints must all carry a DB-persistent rate
// limiter (rateLimiter(..., { persistNamespace: ... })), enforced by the
// `findPublicPostViolations` scan below.
const TARGET_FILES = [
  "server/routes/visitors.ts",
  "server/routes/submissions.ts",
  "server/routes/access-key-requests.ts",
  "server/routes/ai.ts",
  "server/routes/community.ts",
  "server/routes/webauthn.ts",
] as const;

// Every other file in server/routes/ that instantiates its own `Router()`.
// These are NOT scanned for the `persistNamespace` pattern above because each
// has already been reviewed and uses a different (but still DB-persistent,
// or fully auth-gated) protection mechanism — documented per-file below.
//
// IMPORTANT: this map exists so that a brand-new route file is never
// silently unprotected. When you add a new file under server/routes/ that
// calls `Router()`, the "every router file is accounted for" test below will
// fail until you either:
//   1. add it to TARGET_FILES (if its public POST routes should use the
//      standard `persistNamespace` rate limiter pattern), or
//   2. add it here with a one-line justification of how its routes are
//      actually protected (per-route auth middleware, a bespoke DB-backed
//      limiter, admin/dev-only surface, or no POST routes at all).
const EXEMPT_FILES: Record<string, string> = {
  "server/routes/admin.ts":
    "Admin-only surface guarded per-route by checkAdminAuth; login/emergency-reset use dedicated limiters covered by the Admin Login Rate Limit / Admin Emergency Reset tests.",
  "server/routes/withdrawalActivation.ts":
    "Every route is guarded per-route by requirePortalSessionOnly or checkAdminAuth.",
  "server/routes/cases.ts":
    "Mixed portal/admin surface; public case-access routes use the bespoke DB-backed checkPinRateLimit limiter rather than persistNamespace, and mutating routes are guarded per-route by requirePortalAccess/requirePortalSessionOnly/checkAdminAuth.",
  "server/routes/content.ts":
    "Every POST route is guarded per-route by checkAdminAuth or requirePortalAccess.",
  "server/routes/communications.ts":
    "Every POST route is guarded per-route by checkAdminAuth.",
  "server/routes/sitemap.ts": "No POST routes.",
  "server/routes/health.ts": "No POST routes.",
  "server/routes/tutorial-video.ts": "No POST routes.",
  "server/routes/fx.ts": "No POST routes.",
  "server/routes/adminUsers.ts":
    "Every POST route is guarded per-route by checkAdminAuth.",
  "server/routes/withdrawalRequests.ts":
    "Guarded per-route by withdrawalSubmitRateLimit + requirePortalAccess + requireUnsealed.",
  "server/routes/departments.ts":
    "Every POST route is guarded per-route by checkAdminAuth.",
  "server/routes/public.ts":
    "publicRouter POST routes (/newsletter, /contact) already use the persistNamespace pattern directly; adminPublicContentRouter applies checkAdminAuth via router.use(...) for its whole router rather than per-route.",
  "server/routes/adminCommunityModeration.ts":
    "Every POST route is guarded per-route by checkAdminAuth.",
  "server/routes/debug.ts":
    "Dev/debug-only surface; its one POST route is guarded by checkAdminAuth.",
  "server/routes/deposits.ts":
    "Guarded per-route by requirePortalSessionOnly + requireUnsealed.",
  "server/routes/messages.ts":
    "Every POST route is guarded per-route by requirePortalAccess, requireUnsealed, or checkAdminAuth.",
  "server/routes/clientErrors.ts":
    "Uses a bespoke DB-backed atomic rate limiter (atomicIncrementRateLimit) keyed by CLIENT_ERROR_REPORT_RATE_LIMIT_NAMESPACE rather than the persistNamespace/rateLimiter helper.",
};

// Files under server/routes/ that are never routers themselves (barrel
// exports, shared middleware, or helper functions that only attach routes
// onto a router instance owned by another file) and therefore fall outside
// the scope of this scan entirely.
const NON_ROUTER_FILES = new Set(["index.ts", "middleware.ts"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk source from `openIdx` (the '(') to its matching ')'.
 * Skips string literals to avoid false paren matches inside strings.
 * Returns the full substring including both delimiters.
 */
function extractParenBlock(source: string, openIdx: number): string {
  let depth = 0;
  let i = openIdx;
  let inString: string | null = null;

  while (i < source.length) {
    const c = source[i];

    if (inString) {
      // Escaped character — skip both bytes so the escape char never acts as a
      // quote closer (e.g. `'\''` must not terminate the string at the `\'`).
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
    } else {
      if (c === '"' || c === "'") {
        inString = c;
      } else if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth === 0) return source.slice(openIdx, i + 1);
      }
    }
    i++;
  }
  // Malformed source — return the rest.
  return source.slice(openIdx);
}

/**
 * Return the set of variable names that were declared with
 *   const <name> = rateLimiter(..., { persistNamespace: ... })
 * in the given source.
 *
 * These are pre-built limiter instances (e.g. `aiChatLimiter`) passed by name
 * as middleware to a route.  Detecting them here lets the per-route scan
 * recognise their presence without requiring the `persistNamespace` text to
 * appear directly inside the `.post(...)` call.
 */
function extractPersistVarNames(source: string): Set<string> {
  const names = new Set<string>();
  // Matches both `const foo = rateLimiter(...)` and the thunk form
  // `const foo = () => rateLimiter(...)` (used e.g. by communityGetLimiter /
  // communityPostLimiter / publicGetLimiter so the limiter is instantiated
  // fresh per mount rather than shared as a single middleware instance).
  const pattern = /\bconst\s+(\w+)\s*=\s*(?:\(\)\s*=>\s*)?rateLimiter\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(source)) !== null) {
    const varName = m[1];
    // Locate the opening '(' of the rateLimiter call.
    const parenIdx = source.indexOf("(", m.index + m[0].length - 1);
    if (parenIdx === -1) continue;

    const block = extractParenBlock(source, parenIdx);
    if (/\bpersistNamespace\b/.test(block)) {
      names.add(varName);
    }
  }

  return names;
}

/**
 * Return the list of public POST route paths in `filePath` that are missing a
 * DB-persistent rate limiter.
 *
 * A route is classified as "public" (and therefore checked) when it has NONE
 * of the following guards:
 *   • `checkAdminAuth`  — admin-only middleware
 *   • `requirePortalAccess` — portal-session middleware
 *   • `requireUnsealed`     — implies requirePortalAccess
 *   • Inline session checks: `x-portal-session-token` or `isValidAdminToken`
 *
 * A public route is considered *protected* when its `.post(...)` call either:
 *   1. Contains `persistNamespace` directly (inline rateLimiter call), OR
 *   2. References a named variable that was declared with `persistNamespace`.
 */
function findPublicPostViolations(filePath: string): string[] {
  const source = readFileSync(filePath, "utf-8");
  const persistVarNames = extractPersistVarNames(source);
  const violations: string[] = [];

  // Match every `.post(` call site (e.g. router.post(, communityRouter.post()
  const postCallRegex = /\.post\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = postCallRegex.exec(source)) !== null) {
    // Find the '(' that opens the argument list.
    const openIdx = source.indexOf("(", m.index + m[0].length - 1);
    if (openIdx === -1) continue;

    const block = extractParenBlock(source, openIdx);

    // 1. Skip routes guarded by standard auth middleware.
    if (/\bcheckAdminAuth\b/.test(block)) continue;
    if (/\brequirePortalAccess\b/.test(block)) continue;
    if (/\brequireUnsealed\b/.test(block)) continue;

    // 2. Skip routes that perform inline auth (access-key-requests.ts pattern):
    //    they verify a portal session inside the handler body rather than via
    //    a standard middleware argument.
    //    Known inline-auth indicators:
    //      • isAuthorizedForCase     — access-key-requests.ts portal-session check
    //
    //    Note: community.ts routes also authenticate inline (x-portal-session-token
    //    header read / isValidAdminToken check) but are NOT given a skip here —
    //    they carry their own persistNamespace limiter (communityPostLimiter), so
    //    they are correctly picked up as protected via the var-persist check below
    //    rather than being exempted from the scan entirely.
    if (/\bisAuthorizedForCase\b/.test(block)) continue;

    // 3. For the remaining truly-public routes, assert DB-persistent limiting.
    const hasInlinePersist = /\bpersistNamespace\b/.test(block);
    const hasVarPersist = [...persistVarNames].some((name) =>
      new RegExp(`\\b${name}\\b`).test(block),
    );

    if (!hasInlinePersist && !hasVarPersist) {
      // Extract the route path string for the failure message.
      const pathMatch = block.match(/\(\s*["'`]([^"'`\n]+)["'`]/);
      const routePath = pathMatch ? pathMatch[1] : "(unknown path)";
      violations.push(routePath);
    }
  }

  return violations;
}

/**
 * Return every `server/routes/*.ts` file (relative to ROOT, forward-slashed)
 * that instantiates its own `Router()` — i.e. is a real route file, not a
 * barrel export or a helper that only attaches routes onto someone else's
 * router instance.
 */
function discoverRouterFiles(): string[] {
  const files = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith(".ts") && !NON_ROUTER_FILES.has(f),
  );

  const routerFiles: string[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(ROUTES_DIR, file), "utf-8");
    if (/\bRouter\s*\(\s*\)/.test(source)) {
      routerFiles.push(`server/routes/${file}`);
    }
  }
  return routerFiles.sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("public POST route exhaustive persistNamespace scan", () => {
  // Why this test exists
  // --------------------
  // Each individual public POST limiter is exercised in publicPostRateLimit.test.ts,
  // but there is no single exhaustive check that a *new* public POST route
  // inevitably has a persistNamespace limiter.  Without this scan, a developer
  // could add a new public POST endpoint, forget the rate limiter, and no
  // existing check would catch it before it reached production.
  //
  // This source-scan test reads every target route file and fails immediately
  // when a public POST route is detected without a DB-persistent rate limiter.

  for (const relPath of TARGET_FILES) {
    it(`every public POST route in ${relPath} has a DB-persistent rate limiter`, () => {
      const absPath = resolve(ROOT, relPath);
      const violations = findPublicPostViolations(absPath);

      expect(
        violations,
        [
          `The following public POST routes in ${relPath} are missing a`,
          `DB-persistent rate limiter (persistNamespace):`,
          violations.map((p) => `  • ${p}`).join("\n"),
          "",
          `Each public POST route must have:`,
          `  rateLimiter(MAX, WINDOW_MS, { persistNamespace: "some_stable_namespace" })`,
          `as middleware so the per-IP cap is enforced across all autoscale instances.`,
          `Without persistNamespace the limiter falls back to in-memory counting,`,
          `which is instance-local and resets on every restart.`,
        ].join("\n"),
      ).toHaveLength(0);
    });
  }
});

describe("public POST route scan coverage", () => {
  // Why this test exists
  // --------------------
  // The scan above only ever looks at the hardcoded TARGET_FILES list. If a
  // developer adds a brand-new file under server/routes/ (e.g.
  // server/routes/newsletter.ts) and registers it in server/routes.ts
  // without adding it to TARGET_FILES (or EXEMPT_FILES), its public POST
  // routes would be completely invisible to this scan — the exact gap this
  // test closes.
  //
  // Every file under server/routes/ that instantiates its own Router() must
  // appear in EXACTLY ONE of TARGET_FILES or EXEMPT_FILES. A new,
  // uncategorized router file fails this test immediately, forcing an
  // explicit decision (scan it, or document why it doesn't need to be).

  it("every server/routes/*.ts file that exports a router is scanned or explicitly exempted", () => {
    const discovered = discoverRouterFiles();
    const covered = new Set<string>([...TARGET_FILES, ...Object.keys(EXEMPT_FILES)]);

    const uncovered = discovered.filter((f) => !covered.has(f));

    expect(
      uncovered,
      [
        "The following server/routes/*.ts files instantiate a Router() but are",
        "not covered by publicPostRateLimitScan.test.ts:",
        uncovered.map((f) => `  • ${f}`).join("\n"),
        "",
        "Add each one to TARGET_FILES (to run the persistNamespace scan against",
        "it) or to EXEMPT_FILES (with a one-line justification of how its",
        "routes are actually protected) in server/__tests__/publicPostRateLimitScan.test.ts.",
      ].join("\n"),
    ).toHaveLength(0);
  });

  it("TARGET_FILES and EXEMPT_FILES do not overlap and do not list stale files", () => {
    const discovered = new Set(discoverRouterFiles());
    const overlap = TARGET_FILES.filter((f) => f in EXEMPT_FILES);
    const stale = [...TARGET_FILES, ...Object.keys(EXEMPT_FILES)].filter(
      (f) => !discovered.has(f),
    );

    expect(overlap, `Files listed in both TARGET_FILES and EXEMPT_FILES: ${overlap.join(", ")}`).toHaveLength(0);
    expect(
      stale,
      [
        "The following files are listed in TARGET_FILES/EXEMPT_FILES but no",
        "longer exist (or no longer instantiate a Router()) under server/routes/:",
        stale.map((f) => `  • ${f}`).join("\n"),
        "Remove them from publicPostRateLimitScan.test.ts.",
      ].join("\n"),
    ).toHaveLength(0);
  });
});
