#!/usr/bin/env bash
# scripts/check-action-job-coverage.sh
#
# Scans YAML files under .github/actions/ and verifies that every job name
# that would become a GitHub check context is accounted for in either:
#   - scripts/required-checks.txt  (enforced required PR gate), or
#   - scripts/ci-job-allowlist.txt (explicitly opted-out utility job).
#
# Background
# ----------
# Composite actions (runs: using: composite) do NOT produce check contexts —
# they are reusable step collections executed inside a job.  However, a YAML
# file placed under .github/actions/ can also be a *reusable workflow*
# (triggered via on: workflow_call + jobs:), and those jobs DO produce check
# contexts of the form "Workflow Name / Job Name" just like regular workflow
# jobs.  Without this guard, a developer could add a new reusable workflow
# under .github/actions/, introduce new check contexts, and leave them absent
# from the required-checks list — the branch-protection trigger for
# .github/actions/** would fire but no automated check would catch the gap.
#
# What this script checks
# -----------------------
# For each .yml/.yaml file under .github/actions/:
#   1. If the file has a top-level `jobs:` key it is treated as a reusable
#      workflow.  The workflow name (top-level `name:`) and every job-level
#      `name:` (4-space indent) are extracted.
#   2. The resulting check context strings ("Workflow Name / Job Name") are
#      cross-referenced against required-checks.txt and ci-job-allowlist.txt.
#   3. Any context string absent from both lists causes a non-zero exit.
#
# For composite actions (no `jobs:` key), the file is noted but skipped —
# composite action step names never become check contexts.
#
# Usage
# -----
#   bash scripts/check-action-job-coverage.sh
#
# Run automatically as the "Action Job Coverage" CI job in unit-tests.yml.
# Exits 0 on success, 1 if any uncovered check context is detected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ACTIONS_DIR="$REPO_ROOT/.github/actions"
CHECKS_FILE="$SCRIPT_DIR/required-checks.txt"
ALLOWLIST_FILE="$SCRIPT_DIR/ci-job-allowlist.txt"

FAILED=false

# ---------------------------------------------------------------------------
# Validate prerequisite files
# ---------------------------------------------------------------------------
if [ ! -f "$CHECKS_FILE" ]; then
  echo "FAIL: $CHECKS_FILE not found." >&2
  echo "      This file is the single source of truth for required status checks." >&2
  exit 1
fi

if [ ! -f "$ALLOWLIST_FILE" ]; then
  echo "FAIL: $ALLOWLIST_FILE not found." >&2
  echo "      Create it and list every context string that is intentionally excluded" >&2
  echo "      from required-checks.txt (utility jobs, notification jobs, etc.)." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Scan .github/actions/ for YAML files
# ---------------------------------------------------------------------------
if [ ! -d "$ACTIONS_DIR" ]; then
  echo "INFO: $ACTIONS_DIR does not exist — nothing to check."
  echo ""
  echo "Action job coverage OK — no action YAML files found."
  exit 0
fi

# Collect all .yml / .yaml files under .github/actions/ (recursive).
mapfile -t ACTION_FILES < <(
  find "$ACTIONS_DIR" -type f \( -name "*.yml" -o -name "*.yaml" \) | sort
)

if [ "${#ACTION_FILES[@]}" -eq 0 ]; then
  echo "INFO: No YAML files found under $ACTIONS_DIR — nothing to check."
  echo ""
  echo "Action job coverage OK — no action YAML files found."
  exit 0
fi

REUSABLE_FOUND=false

for ACTION_FILE in "${ACTION_FILES[@]}"; do
  REL_PATH="${ACTION_FILE#"$REPO_ROOT/"}"

  # Detect whether this file is a reusable workflow: it must have a `jobs:`
  # key at the top level (zero indentation).  Composite actions use
  # `runs: using: composite` and never have a `jobs:` section.
  if ! grep -qE '^jobs:' "$ACTION_FILE"; then
    echo "  SKIP  $REL_PATH — composite action (no jobs: key), no check contexts emitted"
    continue
  fi

  REUSABLE_FOUND=true
  echo "  REUSABLE WORKFLOW  $REL_PATH"

  # Extract the workflow name from the top-level `name:` field.
  WF_NAME=$(grep -m1 '^name:' "$ACTION_FILE" | sed 's/^name:[[:space:]]*//' | tr -d '\r')
  if [ -z "$WF_NAME" ]; then
    echo "  WARN  $REL_PATH has jobs: but no top-level name: — skipping (cannot form check context)" >&2
    continue
  fi

  # Extract job-level name: values.  In standard GitHub Actions YAML these
  # sit at exactly 4 spaces of indent with no leading dash.
  # Step-level name: fields use "      - name:" (6 spaces + dash) and are
  # NOT matched by this pattern, matching the same convention used in
  # check-protection-sync.sh Section 6.
  JOB_NAMES=()
  while IFS= read -r LINE; do
    JOB_NAME=$(echo "$LINE" | sed 's/^    name:[[:space:]]*//' | tr -d '\r')
    [ -n "$JOB_NAME" ] && JOB_NAMES+=("$JOB_NAME")
  done < <(grep -E '^    name: ' "$ACTION_FILE")

  if [ "${#JOB_NAMES[@]}" -eq 0 ]; then
    echo "    WARN  No job-level name: fields found in $REL_PATH — nothing to validate"
    continue
  fi

  for JOB_NAME in "${JOB_NAMES[@]}"; do
    CONTEXT="$WF_NAME / $JOB_NAME"

    # Check 1: present in required-checks.txt
    if grep -qF "$CONTEXT" "$CHECKS_FILE"; then
      echo "    OK  \"$CONTEXT\"  (required)"
      continue
    fi

    # Check 2: present in ci-job-allowlist.txt (strip inline comments first)
    if grep -oP '^[^#\[]+' "$ALLOWLIST_FILE" | grep -qF "$CONTEXT"; then
      echo "    OK  \"$CONTEXT\"  (allowed)"
      continue
    fi

    echo "    FAIL  \"$CONTEXT\" is not in required-checks.txt or ci-job-allowlist.txt" >&2
    echo "          Add it to required-checks.txt to enforce it as a required PR gate, or" >&2
    echo "          add it to scripts/ci-job-allowlist.txt if it is intentionally optional." >&2
    FAILED=true
  done
done

if [ "$REUSABLE_FOUND" = false ]; then
  echo ""
  echo "INFO: No reusable workflows found under $ACTIONS_DIR — all files are" \
       "composite actions and emit no check contexts."
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo ""
if [ "$FAILED" = true ]; then
  echo "Action job coverage FAILED — see errors above." >&2
  exit 1
else
  echo "Action job coverage OK — all reusable-workflow job contexts are accounted for."
fi
