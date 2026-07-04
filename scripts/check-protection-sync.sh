#!/usr/bin/env bash
# scripts/check-protection-sync.sh
#
# Verifies that scripts/required-checks.txt is the single source of truth for
# required GitHub branch-protection status checks, and that none of the three
# dependent files contain hardcoded inline lists of check context strings:
#   - scripts/check-github-protection.sh
#   - scripts/setup-github-protection.sh
#   - .github/workflows/branch-protection.yml
#
# Run automatically as the "Protection Checks Sync" CI job in unit-tests.yml.
# Run locally: bash scripts/check-protection-sync.sh
#
# Exits 0 on success, 1 if any problem is detected.
#
# Perf note: sections 5-8 used to re-scan every workflow file (with a fresh
# `grep`/subshell) once per entry in required-checks.txt / ci-job-allowlist.txt,
# which is O(entries * workflow files) external processes. This runs on almost
# every PR (triggered by any .github/workflows/** change), so it's rewritten
# below to read each workflow file's job names into bash associative arrays
# exactly once, then do in-process lookups/substring checks for every entry.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKS_FILE="$SCRIPT_DIR/required-checks.txt"
CHECK_SCRIPT="$SCRIPT_DIR/check-github-protection.sh"
SETUP_SCRIPT="$SCRIPT_DIR/setup-github-protection.sh"
WORKFLOW_FILE="$REPO_ROOT/.github/workflows/branch-protection.yml"

FAILED=false

# ---------------------------------------------------------------------------
# 1. required-checks.txt must exist and be non-empty
# ---------------------------------------------------------------------------
if [ ! -f "$CHECKS_FILE" ]; then
  echo "FAIL: $CHECKS_FILE does not exist." >&2
  echo "      This file is the single source of truth for required status checks." >&2
  FAILED=true
else
  CHECK_COUNT=$(grep -c '[^[:space:]]' "$CHECKS_FILE" || true)
  if [ "$CHECK_COUNT" -eq 0 ]; then
    echo "FAIL: $CHECKS_FILE is empty — it must list at least one required check." >&2
    FAILED=true
  else
    echo "  OK  required-checks.txt exists with $CHECK_COUNT entries"
  fi
fi

# ---------------------------------------------------------------------------
# 2. check-github-protection.sh must source required-checks.txt, not define
#    its own REQUIRED_CHECKS=( ... ) array literal
# ---------------------------------------------------------------------------
if grep -n '^REQUIRED_CHECKS=(' "$CHECK_SCRIPT" > /dev/null 2>&1; then
  echo "FAIL: $CHECK_SCRIPT contains a hardcoded REQUIRED_CHECKS=( array." >&2
  echo "      Remove it and read from scripts/required-checks.txt instead." >&2
  FAILED=true
else
  echo "  OK  check-github-protection.sh has no hardcoded REQUIRED_CHECKS array"
fi

if ! grep -q 'required-checks.txt' "$CHECK_SCRIPT"; then
  echo "FAIL: $CHECK_SCRIPT does not reference required-checks.txt." >&2
  echo "      It must read the canonical list from scripts/required-checks.txt." >&2
  FAILED=true
else
  echo "  OK  check-github-protection.sh references required-checks.txt"
fi

# ---------------------------------------------------------------------------
# 3. setup-github-protection.sh must source required-checks.txt, not contain
#    its own inline JSON array of { "context": "..." } literals
# ---------------------------------------------------------------------------
if grep -n '"context":' "$SETUP_SCRIPT" > /dev/null 2>&1; then
  echo "FAIL: $SETUP_SCRIPT contains hardcoded \"context\" JSON literals." >&2
  echo "      Remove them and build the JSON payload from scripts/required-checks.txt." >&2
  FAILED=true
else
  echo "  OK  setup-github-protection.sh has no hardcoded context JSON literals"
fi

if ! grep -q 'required-checks.txt' "$SETUP_SCRIPT"; then
  echo "FAIL: $SETUP_SCRIPT does not reference required-checks.txt." >&2
  echo "      It must build its payload from scripts/required-checks.txt." >&2
  FAILED=true
else
  echo "  OK  setup-github-protection.sh references required-checks.txt"
fi

# ---------------------------------------------------------------------------
# 4. branch-protection.yml must reference required-checks.txt and must not
#    contain any hardcoded check context strings from the canonical list.
#    We detect hardcoded names by scanning the YAML for each check context
#    string that appears in required-checks.txt.
# ---------------------------------------------------------------------------
if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "FAIL: $WORKFLOW_FILE does not exist." >&2
  FAILED=true
else
  if ! grep -q 'required-checks.txt' "$WORKFLOW_FILE"; then
    echo "FAIL: $WORKFLOW_FILE does not reference required-checks.txt." >&2
    echo "      It must read check names from scripts/required-checks.txt at runtime." >&2
    FAILED=true
  else
    echo "  OK  branch-protection.yml references required-checks.txt"
  fi

  # Check that none of the canonical check names are hardcoded in the workflow.
  # Read the workflow file into memory once and do in-process substring checks
  # instead of spawning a `grep` subshell per required-checks.txt entry.
  if [ -f "$CHECKS_FILE" ]; then
    WORKFLOW_CONTENT="$(cat "$WORKFLOW_FILE")"
    WORKFLOW_HARDCODED=false
    while IFS= read -r CHECK_NAME; do
      [ -z "${CHECK_NAME// /}" ] && continue
      if [[ "$WORKFLOW_CONTENT" == *"$CHECK_NAME"* ]]; then
        echo "FAIL: $WORKFLOW_FILE contains a hardcoded check name: \"$CHECK_NAME\"" >&2
        echo "      Remove the literal and let required-checks.txt be the sole source." >&2
        WORKFLOW_HARDCODED=true
        FAILED=true
      fi
    done < "$CHECKS_FILE"
    if [ "$WORKFLOW_HARDCODED" = false ]; then
      echo "  OK  branch-protection.yml has no hardcoded check context strings"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Build an in-memory index of every workflow file exactly once:
#   WF_FILE_OF_NAME["<workflow name>"]      = path to the workflow file
#   JOB_EXISTS["<file>|<job name>"]          = 1
#   CONTEXT_TO_FILE["<wf name> / <job name>"] = path to the workflow file
#
# Sections 5-7 previously repeated an O(entries) loop over all workflow files,
# each re-grepping the same files from scratch. Building this index once and
# doing associative-array lookups for every entry turns that into O(files) +
# O(entries) total work instead of O(entries * files).
# ---------------------------------------------------------------------------
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"
declare -A WF_FILE_OF_NAME=()
declare -A JOB_EXISTS=()
declare -A CONTEXT_TO_FILE=()

if [ -d "$WORKFLOWS_DIR" ]; then
  for WF_FILE in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [ -f "$WF_FILE" ] || continue
    WF_NAME=$(grep -m1 '^name:' "$WF_FILE" | sed 's/^name:[[:space:]]*//' | tr -d '\r')
    [ -z "$WF_NAME" ] && continue
    WF_FILE_OF_NAME["$WF_NAME"]="$WF_FILE"
    # Job-level name: fields sit at exactly 4 spaces of indent in standard
    # GitHub Actions YAML; step-level name: fields use "      - name:" (6
    # spaces + dash) and are intentionally excluded by this pattern.
    while IFS= read -r LINE; do
      JOB_NAME=$(echo "$LINE" | sed 's/^    name:[[:space:]]*//' | tr -d '\r')
      [ -z "$JOB_NAME" ] && continue
      JOB_EXISTS["$WF_FILE|$JOB_NAME"]=1
      CONTEXT_TO_FILE["$WF_NAME / $JOB_NAME"]="$WF_FILE"
    done < <(grep -E '^    name: ' "$WF_FILE" || true)
  done
fi

# ---------------------------------------------------------------------------
# 5. Every "Workflow Name / Job Name" context string in required-checks.txt
#    must map to a real job in a real workflow file.  This prevents a job
#    rename from silently orphaning a required check — GitHub will accept the
#    stale name in branch-protection rules but will never match it to a run.
#
#    Context strings that do NOT contain " / " are left-through (they would
#    be direct check names not tied to a workflow job and are out of scope).
# ---------------------------------------------------------------------------
CONTEXT_CHECK_FAILED=false

if [ ! -d "$WORKFLOWS_DIR" ]; then
  echo "FAIL: $WORKFLOWS_DIR does not exist." >&2
  FAILED=true
else
  while IFS= read -r CHECK_NAME; do
    [ -z "${CHECK_NAME// /}" ] && continue
    # Only validate entries that follow the "Workflow Name / Job Name" pattern.
    [[ "$CHECK_NAME" != *" / "* ]] && continue
    WORKFLOW_NAME="${CHECK_NAME%% / *}"
    JOB_NAME="${CHECK_NAME#* / }"
    MATCHED_FILE="${WF_FILE_OF_NAME[$WORKFLOW_NAME]:-}"
    if [ -z "$MATCHED_FILE" ]; then
      echo "  FAIL  No workflow file found with name: \"$WORKFLOW_NAME\"" >&2
      echo "        (required check: \"$CHECK_NAME\")" >&2
      CONTEXT_CHECK_FAILED=true
      FAILED=true
      continue
    fi
    if [ -n "${JOB_EXISTS[$MATCHED_FILE|$JOB_NAME]:-}" ]; then
      echo "  OK  \"$CHECK_NAME\""
    else
      echo "  FAIL  Job name \"$JOB_NAME\" not found in $(basename "$MATCHED_FILE")" >&2
      echo "        Check that the job's name: field matches required-checks.txt exactly." >&2
      echo "        (required check: \"$CHECK_NAME\")" >&2
      CONTEXT_CHECK_FAILED=true
      FAILED=true
    fi
  done < "$CHECKS_FILE"
  if [ "$CONTEXT_CHECK_FAILED" = false ]; then
    echo "  OK  all required check context strings map to real workflow jobs"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Every "Workflow Name / Job Name" context string derived from all
#    .github/workflows/*.yml files must appear in either required-checks.txt
#    (enforced gate) or scripts/ci-job-allowlist.txt (explicitly opted out).
#
#    This is the complement of section 5: section 5 catches jobs that were
#    renamed/removed without updating required-checks.txt; section 6 catches
#    new jobs that were added but never registered in either list, preventing
#    silent "runs but never enforced" situations.
# ---------------------------------------------------------------------------
ALLOWLIST_FILE="${CI_JOB_ALLOWLIST_FILE:-$SCRIPT_DIR/ci-job-allowlist.txt}"
COVERAGE_FAILED=false

if [ ! -d "$WORKFLOWS_DIR" ]; then
  : # Already reported in section 5; skip duplicate message.
elif [ ! -f "$ALLOWLIST_FILE" ]; then
  echo "FAIL: $ALLOWLIST_FILE does not exist." >&2
  echo "      Create it and list every context string that is intentionally excluded" >&2
  echo "      from required-checks.txt (utility jobs, notification jobs, etc.)." >&2
  FAILED=true
else
  # Build lookup sets for required-checks.txt and ci-job-allowlist.txt once,
  # instead of re-grepping both files for every job found in the workflows.
  declare -A CHECKS_SET=()
  if [ -f "$CHECKS_FILE" ]; then
    while IFS= read -r LINE; do
      [ -z "${LINE// /}" ] && continue
      CHECKS_SET["$LINE"]=1
    done < "$CHECKS_FILE"
  fi

  declare -A ALLOWLIST_SET=()
  while IFS= read -r RAW_LINE; do
    TRIMMED="${RAW_LINE#"${RAW_LINE%%[![:space:]]*}"}"
    [ -z "$TRIMMED" ] && continue
    [[ "$TRIMMED" == \#* ]] && continue
    CONTEXT=$(echo "$TRIMMED" | sed 's/[[:space:]]*[\[#].*//' | sed 's/[[:space:]]*$//')
    [ -z "$CONTEXT" ] && continue
    ALLOWLIST_SET["$CONTEXT"]=1
  done < "$ALLOWLIST_FILE"

  for CONTEXT in "${!CONTEXT_TO_FILE[@]}"; do
    if [ -n "${CHECKS_SET[$CONTEXT]:-}" ]; then
      continue
    fi
    if [ -n "${ALLOWLIST_SET[$CONTEXT]:-}" ]; then
      continue
    fi
    echo "  FAIL  \"$CONTEXT\" is not in required-checks.txt or ci-job-allowlist.txt" >&2
    echo "        Add it to required-checks.txt to enforce it as a required PR gate, or" >&2
    echo "        add it to scripts/ci-job-allowlist.txt if it is intentionally optional." >&2
    COVERAGE_FAILED=true
    FAILED=true
  done
  if [ "$COVERAGE_FAILED" = false ]; then
    echo "  OK  all workflow jobs are accounted for in required-checks.txt or ci-job-allowlist.txt"
  fi
fi

# ---------------------------------------------------------------------------
# 7. Every "Workflow Name / Job Name" context string in ci-job-allowlist.txt
#    must map to a real job in a real workflow file.  This is the complement
#    of Section 6: Section 6 catches new jobs that were never registered;
#    this section catches allowlist entries that became stale when a job was
#    renamed or removed, which would silently prevent Section 6 from
#    detecting the "job renamed but never re-registered" case.
#
#    Lines that begin with # are skipped (comments).  Inline [category]
#    labels (everything from the first [ or # after the context string) are
#    stripped before the context string is compared.
#
#    Entries that do NOT follow the "Workflow Name / Job Name" pattern are
#    skipped (they would not correspond to a workflow job and are out of scope).
# ---------------------------------------------------------------------------
ALLOWLIST_STALE_FAILED=false

if [ ! -f "$ALLOWLIST_FILE" ]; then
  : # Already reported in section 6; skip duplicate message.
elif [ ! -d "$WORKFLOWS_DIR" ]; then
  : # Already reported in section 5; skip duplicate message.
else
  while IFS= read -r RAW_LINE; do
    # Skip blank lines and comment lines.
    TRIMMED="${RAW_LINE#"${RAW_LINE%%[![:space:]]*}"}"
    [ -z "$TRIMMED" ] && continue
    [[ "$TRIMMED" == \#* ]] && continue
    # Strip inline [category] label and any trailing # comment.
    CONTEXT=$(echo "$TRIMMED" | sed 's/[[:space:]]*[\[#].*//' | sed 's/[[:space:]]*$//')
    [ -z "$CONTEXT" ] && continue
    # Only validate entries that follow the "Workflow Name / Job Name" pattern.
    [[ "$CONTEXT" != *" / "* ]] && continue
    WORKFLOW_NAME="${CONTEXT%% / *}"
    JOB_NAME="${CONTEXT#* / }"
    MATCHED_FILE="${WF_FILE_OF_NAME[$WORKFLOW_NAME]:-}"
    if [ -z "$MATCHED_FILE" ]; then
      echo "  FAIL  ci-job-allowlist.txt: no workflow file found with name: \"$WORKFLOW_NAME\"" >&2
      echo "        Stale allowlist entry: \"$CONTEXT\"" >&2
      echo "        Remove or update the entry if the workflow was renamed or deleted." >&2
      ALLOWLIST_STALE_FAILED=true
      FAILED=true
      continue
    fi
    if [ -n "${JOB_EXISTS[$MATCHED_FILE|$JOB_NAME]:-}" ]; then
      echo "  OK  allowlist: \"$CONTEXT\""
    else
      echo "  FAIL  ci-job-allowlist.txt: job \"$JOB_NAME\" not found in $(basename "$MATCHED_FILE")" >&2
      echo "        Stale allowlist entry: \"$CONTEXT\"" >&2
      echo "        Remove or update the entry if the job was renamed or deleted." >&2
      ALLOWLIST_STALE_FAILED=true
      FAILED=true
    fi
  done < "$ALLOWLIST_FILE"
  if [ "$ALLOWLIST_STALE_FAILED" = false ]; then
    echo "  OK  all ci-job-allowlist.txt entries map to real workflow jobs"
  fi
fi

# ---------------------------------------------------------------------------
# 8. Every context string in required-checks.txt must be documented somewhere
#    in either replit.md or docs/ci-checks.md.
#
#    replit.md now keeps only a compact grouped list of bare check names (see
#    the "Unit Tests" bullet split from docs/ci-checks.md); the full per-check
#    description lives in docs/ci-checks.md. This mirrors the substring-match
#    logic already used by the two dedicated CI guards
#    (scripts/__tests__/check-replit-md-annotations.test.ts and
#    scripts/__tests__/check-ci-checks-doc-coverage.test.ts) rather than
#    requiring a literal `required branch protection status check: "..."`
#    annotation string in replit.md, which no longer matches how the docs are
#    structured and previously produced stale failures for every check that
#    only appears in the compact list.
#
#    Both files are read into memory once and checked with bash substring
#    matching, instead of spawning two `grep` subshells per required-checks.txt
#    entry.
# ---------------------------------------------------------------------------
REPLIT_MD="$REPO_ROOT/replit.md"
CI_CHECKS_DOC="$REPO_ROOT/docs/ci-checks.md"
DOC_CHECK_FAILED=false

if [ ! -f "$REPLIT_MD" ]; then
  echo "FAIL: $REPLIT_MD does not exist." >&2
  FAILED=true
elif [ ! -f "$CI_CHECKS_DOC" ]; then
  echo "FAIL: $CI_CHECKS_DOC does not exist." >&2
  FAILED=true
else
  REPLIT_MD_CONTENT="$(cat "$REPLIT_MD")"
  CI_CHECKS_DOC_CONTENT="$(cat "$CI_CHECKS_DOC")"
  while IFS= read -r CHECK_NAME; do
    [ -z "${CHECK_NAME// /}" ] && continue
    # Documented if the bare check name appears verbatim as a substring of
    # either file (replit.md's compact list or docs/ci-checks.md's full entry).
    if [[ "$REPLIT_MD_CONTENT" == *"$CHECK_NAME"* ]] || [[ "$CI_CHECKS_DOC_CONTENT" == *"$CHECK_NAME"* ]]; then
      echo "  OK  \"$CHECK_NAME\" is documented in replit.md or docs/ci-checks.md"
    else
      echo "  FAIL  \"$CHECK_NAME\" is missing from both replit.md and docs/ci-checks.md" >&2
      echo "        Add \"$CHECK_NAME\" to the relevant bullet in replit.md's compact list" >&2
      echo "        and/or add a full description to docs/ci-checks.md." >&2
      DOC_CHECK_FAILED=true
      FAILED=true
    fi
  done < "$CHECKS_FILE"
  if [ "$DOC_CHECK_FAILED" = false ]; then
    echo "  OK  all required checks are documented in replit.md or docs/ci-checks.md"
  fi
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo ""
if [ "$FAILED" = true ]; then
  echo "Protection checks sync FAILED — see errors above." >&2
  exit 1
else
  echo "Protection checks sync OK — required-checks.txt is the sole source of truth."
fi
