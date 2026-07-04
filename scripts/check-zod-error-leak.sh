#!/usr/bin/env bash
# check-zod-error-leak.sh
#
# Guards against raw ZodError forwarding to API clients.
#
# A ZodError's `.errors` / `.issues` properties are arrays of ZodIssue objects
# that contain internal type annotations, path structures, and validation
# metadata.  Sending that array directly in a JSON response leaks implementation
# details and can aid targeted attacks.  The safe pattern is to extract a plain
# string:
#
#   BAD:  res.status(400).json({ error: error.errors })
#   BAD:  res.status(400).json({ details: parseResult.error.issues })
#   BAD:  res.status(400).json({ ...parseResult.error.errors })
#   BAD:  const body = { error: err.errors }; res.json(body);   ← multi-line
#   BAD:  function makeErr(e) { return { error: e.errors }; }   ← helper fn
#         res.json(makeErr(zodErr));
#   OK:   res.status(400).json({ error: "Validation error" })
#   OK:   res.status(400).json({ error: parsed.error.errors[0].message })
#
# What this script detects (four independent passes):
#
#   Pass A — whole-array forwarding:
#     Any line in server/**/*.ts or shared/**/*.ts that calls a json() response
#     method and references `.errors` or `.issues` WITHOUT immediately indexing
#     into it (e.g. `.errors[`).  That is the signature of forwarding the whole
#     ZodIssue array.
#
#   Pass B — spread-based forwarding:
#     Any line that spreads `.errors` or `.issues` directly into a json()
#     response (e.g. `res.json({ ...err.errors })`), even without explicit
#     array forwarding syntax.  Spread of the whole array is equally unsafe.
#
#   Pass C — multi-line / dataflow forwarding:
#     A variable is assigned from `.errors` or `.issues` (whole array) on one
#     line, then that variable is forwarded through a `.json(` call within a
#     proximity window of lines in the same file.  Catches patterns the
#     single-line passes miss, e.g.:
#       const body = { error: err.errors };
#       res.json(body);
#
#   Pass D — helper-function / intermediate-call forwarding:
#     A named function (or arrow function) defined in the same file contains a
#     `return` statement that forwards `.errors` or `.issues` (whole array).
#     That function name is then treated as tainted.  If a `.json(` call in the
#     same file invokes that tainted function, it is flagged.  This catches the
#     wrapper-function bypass pattern, e.g.:
#       function makeErr(e) { return { error: e.errors }; }
#       res.json(makeErr(zodErr));
#
#     SCOPE DECISION — cross-file analysis is permanently out of scope:
#       Extending Pass D to follow helpers exported from one file and imported
#       into another would require building a full module-import graph, resolving
#       re-exports, and propagating taint across file boundaries.  The additional
#       complexity is disproportionate to the marginal risk: cross-file
#       ZodError-wrapping helpers are very uncommon, the check already catches
#       the within-file variant (which is the realistic bypass path), and code
#       review provides an adequate backstop for the remaining edge case.
#
#       If you deliberately use a shared helper that returns .errors / .issues
#       and call it inside a .json() response, suppress the specific call-site
#       line with the standard annotation:
#
#         // In server/utils/zodHelpers.ts:
#         export function makeZodBody(e: ZodError) {
#           return { details: e.errors }; // ← helper lives in a shared file
#         }
#
#         // In server/routes/foo.ts:
#         res.json(makeZodBody(err)); // zod-error-leak-ok
#                                     // ↑ cross-file helper — reviewed,
#                                     //   intentionally returns error strings
#                                     //   only (confirmed safe at code review)
#
#       Suppression requires a justification comment on the same line or the
#       line immediately above so future readers understand why the annotation
#       was applied.
#
# Scanned directories: server/ (excluding server/__tests__/) and shared/.
# The __tests__/ directory is excluded so that test-fixture code that exercises
# error-handling paths (e.g. *.zodErrorLeak.test.ts) cannot produce false
# positives.  Those files contain supertest assertions and mock helpers that
# intentionally reference .errors / .issues — they must not be flagged by this
# guard, which is designed to catch production route/service code only.
#
# Exit codes:
#   0 — no raw ZodError forwarding found
#   1 — one or more violations detected (prints a clear diagnostic)
#
# Usage:
#   bash scripts/check-zod-error-leak.sh
#   npm run lint:security
#
# To suppress a line that is a deliberate false-positive (rare), append:
#   // zod-error-leak-ok
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# Helper: filter_violations <property>
#
# Reads raw grep output (path:lineno:content) from stdin and emits only the
# lines that represent genuine leaks for the given property name (.errors or
# .issues).  Safe patterns that are filtered out:
#   - Lines where every occurrence of .<property> is followed by [ (safe index)
#   - Pure comment lines (trimmed content starts with //)
#   - Lines with suppression annotation // zod-error-leak-ok
# ---------------------------------------------------------------------------
filter_violations() {
  local prop="$1"   # "errors" or "issues"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Strip the "path:lineno:" prefix for content analysis
    content="${line#*:*:}"

    # Skip pure comment lines (trimmed content starts with //)
    trimmed="${content#"${content%%[![:space:]]*}"}"
    [[ "$trimmed" == //* ]] && continue

    # Skip suppression-annotated lines
    [[ "$content" == *"zod-error-leak-ok"* ]] && continue

    # If .<prop> is only ever followed by [ on this line, it is safe indexing.
    # Replace every ".<prop>[" with a placeholder, then check if ".<prop>" remains.
    local safe_token="SAFE_IDX_${prop}"
    local sanitized="${content//.${prop}[/${safe_token}}"
    if [[ "$sanitized" != *".${prop}"* ]]; then
      continue
    fi

    printf '%s\n' "$line"
  done
}

# ---------------------------------------------------------------------------
# Pass A — whole-array / direct property forwarding
# Grep for lines that co-locate .json( with .errors or .issues.
# ---------------------------------------------------------------------------
raw_a=$(grep -rn \
  '\.json(.*\.errors\|\.errors.*\.json(\|\.json(.*\.issues\|\.issues.*\.json(' \
  "$REPO_ROOT/server" "$REPO_ROOT/shared" --include="*.ts" \
  --exclude-dir=__tests__ 2>/dev/null || true)

violations_a=""
if [[ -n "$raw_a" ]]; then
  # Run filter for .errors matches
  errors_matches=$(printf '%s\n' "$raw_a" | grep '\.errors' || true)
  if [[ -n "$errors_matches" ]]; then
    filtered=$(printf '%s\n' "$errors_matches" | filter_violations "errors" || true)
    [[ -n "$filtered" ]] && violations_a+="${filtered}"$'\n'
  fi

  # Run filter for .issues matches
  issues_matches=$(printf '%s\n' "$raw_a" | grep '\.issues' || true)
  if [[ -n "$issues_matches" ]]; then
    filtered=$(printf '%s\n' "$issues_matches" | filter_violations "issues" || true)
    [[ -n "$filtered" ]] && violations_a+="${filtered}"$'\n'
  fi
fi
violations_a="${violations_a%$'\n'}"

# ---------------------------------------------------------------------------
# Pass B — spread-based forwarding: ...something.errors / ...something.issues
# Catch patterns like res.json({ ...parseResult.error.errors }) even when the
# .json( and the spread appear close together in slightly different forms.
# We specifically look for lines containing the spread operator immediately
# before .errors or .issues (with no [ after), inside any expression that
# also calls .json(.
# ---------------------------------------------------------------------------
raw_b=$(grep -rn \
  '\.\.\.[^)]*\.errors\b\|\.\.\.[^)]*\.issues\b' \
  "$REPO_ROOT/server" "$REPO_ROOT/shared" --include="*.ts" \
  --exclude-dir=__tests__ 2>/dev/null || true)

violations_b=""
if [[ -n "$raw_b" ]]; then
  # Only flag lines that also have .json( on the same line
  json_lines=$(printf '%s\n' "$raw_b" | grep '\.json(' || true)
  if [[ -n "$json_lines" ]]; then
    # Filter for .errors spreads
    spread_errors=$(printf '%s\n' "$json_lines" | grep '\.errors' || true)
    if [[ -n "$spread_errors" ]]; then
      filtered=$(printf '%s\n' "$spread_errors" | filter_violations "errors" || true)
      [[ -n "$filtered" ]] && violations_b+="${filtered}"$'\n'
    fi

    # Filter for .issues spreads
    spread_issues=$(printf '%s\n' "$json_lines" | grep '\.issues' || true)
    if [[ -n "$spread_issues" ]]; then
      filtered=$(printf '%s\n' "$spread_issues" | filter_violations "issues" || true)
      [[ -n "$filtered" ]] && violations_b+="${filtered}"$'\n'
    fi
  fi
fi
violations_b="${violations_b%$'\n'}"

# ---------------------------------------------------------------------------
# Pass C — multi-line dataflow: variable assigned from .errors/.issues then
# forwarded through .json() within a proximity window.
#
# Implemented as an inline Node.js script so it can perform simple cross-line
# dataflow analysis without external dependencies.  Node.js is always present
# in this project environment.
#
# Algorithm (per file):
#   1. Scan each line for a variable declaration whose RHS contains
#      .errors or .issues (whole array — no [ immediately after).
#   2. Record the variable name and line number.
#   3. For subsequent lines within WINDOW lines of the assignment, check
#      whether the variable name appears in a .json( call.
#   4. Skip comment lines and lines annotated with zod-error-leak-ok.
#   5. Emit file:lineno:content for every detected assignment line
#      (the root cause), formatted to match Pass A / Pass B output.
#
# This catches patterns such as:
#   const body = { error: err.errors };
#   res.json(body);
#
#   const errs = parseResult.error.errors;
#   return res.status(400).json({ error: errs });
# ---------------------------------------------------------------------------
violations_c=""
if command -v node >/dev/null 2>&1; then
  violations_c=$(REPO_ROOT="$REPO_ROOT" node --input-type=module << 'NODE_EOF'
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.env.REPO_ROOT;
const WINDOW = 20; // max lines between assignment and .json( call

function isCommentLine(text) {
  return /^\s*\/\//.test(text);
}

function isSuppressed(text) {
  return text.includes('zod-error-leak-ok');
}

// Returns true when .errors or .issues appears on the line but is NOT
// immediately followed by [ (which would be safe array indexing).
function hasUnsafeWholeArray(text) {
  for (const prop of ['errors', 'issues']) {
    const sanitized = text.replace(new RegExp(`\\.${prop}\\[`, 'g'), `__SAFE__`);
    if (new RegExp(`\\.${prop}\\b`).test(sanitized)) return true;
  }
  return false;
}

// Recursively collect .ts files under a directory, skipping __tests__/ so
// that test-fixture code (e.g. *.zodErrorLeak.test.ts) cannot produce false
// positives.  Those files intentionally reference .errors / .issues and must
// not be scanned by this production-code guard.
function collectTs(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue; // exclude test directory
      results.push(...collectTs(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = [join(root, 'server'), join(root, 'shared')].flatMap(collectTs);

// Regex: matches a const/let/var declaration and captures the variable name.
const ASSIGN_RE = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;

const violations = [];

for (const filepath of files) {
  let text;
  try { text = readFileSync(filepath, 'utf8'); } catch { continue; }
  const lines = text.split('\n');

  // tainted: varName -> 0-based line index of the assignment that introduced taint.
  const tainted = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isCommentLine(line) || isSuppressed(line)) continue;

    // --- Record tainted variable assignments ---
    const assignMatch = ASSIGN_RE.exec(line);
    if (assignMatch) {
      const varName = assignMatch[1];
      if (hasUnsafeWholeArray(line) && !line.includes('.json(')) {
        // .json( on the same line is already covered by Pass A.
        tainted.set(varName, i);
      } else {
        // A clean assignment to the same name clears any prior taint.
        tainted.delete(varName);
      }
    }

    // --- Check whether this line's .json( call uses a tainted variable ---
    if (line.includes('.json(')) {
      for (const [varName, assignIdx] of tainted) {
        if (i === assignIdx) continue; // same line — Pass A handles it
        if (i - assignIdx > WINDOW) {
          tainted.delete(varName);
          continue;
        }
        if (new RegExp(`\\b${varName}\\b`).test(line)) {
          // Report the assignment line (root cause), 1-based line number.
          violations.push(`${filepath}:${assignIdx + 1}:${lines[assignIdx]}`);
          tainted.delete(varName); // report each assignment only once
        }
      }
    }

    // Expire stale tainted entries beyond the window.
    for (const [varName, assignIdx] of tainted) {
      if (i - assignIdx > WINDOW) tainted.delete(varName);
    }
  }
}

if (violations.length > 0) {
  process.stdout.write(violations.join('\n') + '\n');
}
NODE_EOF
  )
fi
violations_c="${violations_c%$'\n'}"

# ---------------------------------------------------------------------------
# Pass D — helper-function / intermediate-call forwarding.
#
# Implemented as an inline Node.js script (same environment assumption as
# Pass C).
#
# Algorithm (per file):
#   1. Scan every line for a `return` statement whose expression contains
#      `.errors` or `.issues` (whole array — no [ immediately after) and is
#      not suppressed.
#   2. Look backward from that `return` (up to WINDOW lines) to find the
#      nearest enclosing named function definition and extract its name.
#      Recognised patterns:
#        function NAME(          — named function declaration
#        const/let/var NAME = (async )? (function | ( ) =>
#   3. Mark that function name as tainted (it returns a ZodError array).
#   4. Scan every line with `.json(` and check whether it invokes a tainted
#      function by name (i.e. the function name appears followed by `(`).
#   5. Skip comment lines and lines annotated with zod-error-leak-ok.
#   6. Emit file:lineno:content for the .json( call line (the call site is
#      the observable leak), formatted to match Pass A / Pass B output.
#
# This catches patterns such as:
#   function makeErr(e) { return { error: e.errors }; }
#   res.json(makeErr(zodErr));
#
#   const buildBody = (r) => ({ details: r.error.issues });
#   res.status(400).json(buildBody(parsed));
#
# Cross-file helper patterns are out of scope; use // zod-error-leak-ok
# for those deliberate cases.
# ---------------------------------------------------------------------------
violations_d=""
if command -v node >/dev/null 2>&1; then
  violations_d=$(REPO_ROOT="$REPO_ROOT" node --input-type=module << 'NODE_EOF'
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.env.REPO_ROOT;
// How far back to search from a `return` for its enclosing function name.
const WINDOW = 40;

function isCommentLine(text) {
  return /^\s*\/\//.test(text);
}

function isSuppressed(text) {
  return text.includes('zod-error-leak-ok');
}

// Returns true when .errors or .issues appears on the line but is NOT
// immediately followed by [ (safe array indexing).
function hasUnsafeWholeArray(text) {
  for (const prop of ['errors', 'issues']) {
    const sanitized = text.replace(new RegExp(`\\.${prop}\\[`, 'g'), '__SAFE__');
    if (new RegExp(`\\.${prop}\\b`).test(sanitized)) return true;
  }
  return false;
}

// Regex that matches a named function definition and captures the name.
// Group 1: `function NAME(`
// Group 2: `const/let/var NAME = (async)? (function | (`
const FUNC_DEF_RE = /(?:function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(|(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?(?:function\b|\())/;

// Recursively collect .ts files under a directory, skipping __tests__/ so
// that test-fixture code (e.g. *.zodErrorLeak.test.ts) cannot produce false
// positives.  Those files intentionally reference .errors / .issues and must
// not be scanned by this production-code guard.
function collectTs(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue; // exclude test directory
      results.push(...collectTs(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = [join(root, 'server'), join(root, 'shared')].flatMap(collectTs);

const violations = [];

for (const filepath of files) {
  let text;
  try { text = readFileSync(filepath, 'utf8'); } catch { continue; }
  const lines = text.split('\n');

  // --- Pass 1: collect tainted function names ---
  // taintedFns: Set of function names whose return value contains a whole
  //             .errors / .issues array.
  const taintedFns = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line) || isSuppressed(line)) continue;

    // Look for a `return` statement that leaks the whole array.
    // We also exclude lines that already call .json( — those are Pass A.
    if (/\breturn\b/.test(line) && hasUnsafeWholeArray(line) && !line.includes('.json(')) {
      // Look backward for the nearest enclosing function definition.
      for (let j = i; j >= Math.max(0, i - WINDOW); j--) {
        if (isCommentLine(lines[j])) continue;
        const m = FUNC_DEF_RE.exec(lines[j]);
        if (m) {
          const name = m[1] || m[2];
          if (name) taintedFns.add(name);
          break;
        }
      }
    }
  }

  if (taintedFns.size === 0) continue;

  // --- Pass 2: flag .json( calls that invoke a tainted function ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line) || isSuppressed(line)) continue;
    if (!line.includes('.json(')) continue;

    for (const fnName of taintedFns) {
      // The tainted function must be called: NAME( (with optional whitespace)
      if (new RegExp(`\\b${fnName}\\s*\\(`).test(line)) {
        violations.push(`${filepath}:${i + 1}:${line}`);
        break; // report each .json( line only once even if multiple tainted fns
      }
    }
  }
}

if (violations.length > 0) {
  process.stdout.write(violations.join('\n') + '\n');
}
NODE_EOF
  )
fi
violations_d="${violations_d%$'\n'}"

# ---------------------------------------------------------------------------
# Merge and de-duplicate
# ---------------------------------------------------------------------------
all_violations=""
[[ -n "$violations_a" ]] && all_violations+="${violations_a}"$'\n'
[[ -n "$violations_b" ]] && all_violations+="${violations_b}"$'\n'
[[ -n "$violations_c" ]] && all_violations+="${violations_c}"$'\n'
[[ -n "$violations_d" ]] && all_violations+="${violations_d}"$'\n'
all_violations=$(printf '%s\n' "$all_violations" | sort -u | grep . || true)

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [[ -z "$all_violations" ]]; then
  echo "check-zod-error-leak: no raw ZodError forwarding found. OK."
  exit 0
fi

violation_count=$(printf '%s\n' "$all_violations" | grep -c .)

echo "" >&2
echo "ERROR: Raw ZodError forwarding to clients detected." >&2
echo "" >&2
echo "  Sending .errors or .issues from a ZodError (or safeParse result) directly" >&2
echo "  in a JSON response leaks internal type/path metadata to API callers." >&2
echo "" >&2
echo "  Replace with a safe string:" >&2
echo "    BAD: res.status(400).json({ error: error.errors })" >&2
echo "    BAD: res.status(400).json({ details: parseResult.error.issues })" >&2
echo "    BAD: res.status(400).json({ ...parseResult.error.errors })" >&2
echo "    BAD: const body = { error: err.errors }; res.json(body);  [multi-line]" >&2
echo "    BAD: function makeErr(e) { return { error: e.errors }; } [helper fn]" >&2
echo "         res.json(makeErr(zodErr));" >&2
echo "    OK:  res.status(400).json({ error: \"Validation error\" })" >&2
echo "    OK:  res.status(400).json({ error: parsed.error.errors[0].message })" >&2
echo "" >&2
echo "  Violations found ($violation_count):" >&2
while IFS= read -r v; do
  [[ -z "$v" ]] && continue
  echo "    $v" >&2
done <<< "$all_violations"
echo "" >&2
echo "  To suppress a deliberate false-positive, append: // zod-error-leak-ok" >&2
exit 1
