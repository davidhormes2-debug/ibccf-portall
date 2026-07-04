#!/usr/bin/env python3
"""
Drift guard: asserts the SSL-detection decision expression is semantically
identical across the canonical test file and every workflow file that embeds
the use_ssl detection snippet.

Canonical source:
  scripts/test_smtp_ssl_detection.py   (extracted from _detect_mode body)

Workflow files are discovered automatically via glob:
  .github/workflows/*.yml
Only files that actually contain the `use_ssl = port == 465` line are checked,
so adding a new workflow that embeds the snippet will be caught immediately
without any change to this script.

The test file uses an inline-normalization form:
  use_ssl = port == 465 or smtp_ssl_env.strip().lower() in ("1", "true", "yes")

The workflow files use a pre-normalized form (smtp_ssl_env is already
stripped/lowered by the preceding line):
  use_ssl = port == 465 or smtp_ssl_env in ("1", "true", "yes")

Both are semantically equivalent. This script normalizes both forms to:
  use_ssl = port == 465 or smtp_ssl_env in ("1", "true", "yes")
and asserts all sources match.

Additionally, the smtp_ssl_env assignment line that appears in workflow files
is compared to catch drift there too.

Run with:  python3 scripts/check_smtp_ssl_sync.py
Exit 0 = all sources agree; exit 1 = drift detected or snippet missing.
"""

import glob
import re
import sys

TEST_FILE = "scripts/test_smtp_ssl_detection.py"
WORKFLOW_GLOB = ".github/workflows/*.yml"

# Matches the use_ssl decision expression in either form:
#   ... smtp_ssl_env.strip().lower() in (...)   [test-file form]
#   ... smtp_ssl_env in (...)                   [workflow pre-normalized form]
_USE_SSL_RE = re.compile(
    r"use_ssl\s*=\s*port\s*==\s*\d+\s+or\s+smtp_ssl_env"
)

# Matches the env-var assignment line present in workflow files.
_SSL_ENV_RE = re.compile(
    r"""smtp_ssl_env\s*=\s*os\.environ\.get\(["']SMTP_SSL["'],\s*["']["']\)\.strip\(\)\.lower\(\)"""
)

# Normalization: collapse the inline-normalize form to the pre-normalized form
# so all sources can be compared as a single string.
_INLINE_NORMALIZE_RE = re.compile(r"smtp_ssl_env\.strip\(\)\.lower\(\)\s+in")


def _normalize(line: str) -> str:
    """Strip leading/trailing whitespace and collapse .strip().lower() calls."""
    line = line.strip()
    line = _INLINE_NORMALIZE_RE.sub("smtp_ssl_env in", line)
    return line


def _find_function_body_use_ssl(path: str) -> str | None:
    """
    Extract the use_ssl line from the body of _detect_mode in the test file.
    Looks for the function definition then returns the first use_ssl= line inside it.
    """
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()

    in_detect_mode = False
    for raw in lines:
        stripped = raw.strip()
        if re.match(r"def _detect_mode\s*\(", stripped):
            in_detect_mode = True
            continue
        if in_detect_mode:
            # Stop at the next top-level definition or blank-line-then-def
            if re.match(r"def ", stripped) and not stripped.startswith("#"):
                break
            if _USE_SSL_RE.search(stripped):
                return _normalize(stripped)
    return None


def _find_workflow_use_ssl(path: str) -> str | None:
    """Return the (first) stripped use_ssl= line from a workflow file."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    for raw in lines:
        stripped = raw.strip()
        if _USE_SSL_RE.search(stripped):
            return _normalize(stripped)
    return None


def _find_workflow_ssl_env(path: str) -> str | None:
    """Return the stripped smtp_ssl_env= assignment from a workflow file."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    for raw in lines:
        stripped = raw.strip()
        if _SSL_ENV_RE.search(stripped):
            return stripped
    return None


def _discover_workflow_files() -> list[str]:
    """
    Return sorted paths of all .github/workflows/*.yml files that contain the
    use_ssl detection snippet.  Sorting makes output deterministic.
    """
    candidates = sorted(glob.glob(WORKFLOW_GLOB))
    matches = []
    for path in candidates:
        try:
            with open(path, encoding="utf-8") as fh:
                content = fh.read()
        except OSError:
            continue
        if _USE_SSL_RE.search(content):
            matches.append(path)
    return matches


def main() -> int:
    ok = True

    # ── 0. Discover workflow files that embed the snippet ─────────────────────
    workflow_files = _discover_workflow_files()
    if not workflow_files:
        print(
            f"ERROR: no files matching {WORKFLOW_GLOB} contain the use_ssl "
            "detection snippet.  If all workflow files have been renamed or "
            "the snippet was removed, update the canonical source and this guard.",
            file=sys.stderr,
        )
        return 1

    print(
        f"Found {len(workflow_files)} workflow file(s) containing the SSL snippet:"
    )
    for p in workflow_files:
        print(f"  {p}")

    # ── 1. Extract the canonical use_ssl expression from _detect_mode ────────
    ref_use_ssl = _find_function_body_use_ssl(TEST_FILE)
    if ref_use_ssl is None:
        print(
            f"ERROR: use_ssl= line not found inside _detect_mode in {TEST_FILE}",
            file=sys.stderr,
        )
        return 1

    # ── 2. Compare use_ssl expression from each discovered workflow file ───────
    for path in workflow_files:
        try:
            wf_use_ssl = _find_workflow_use_ssl(path)
        except OSError as exc:
            print(f"ERROR: cannot read {path}: {exc}", file=sys.stderr)
            ok = False
            continue

        if wf_use_ssl is None:
            print(
                f"ERROR: use_ssl= decision line not found in {path}", file=sys.stderr
            )
            ok = False
            continue

        if wf_use_ssl != ref_use_ssl:
            print(
                f"DRIFT in {path} — use_ssl expression differs from _detect_mode in {TEST_FILE}:",
                file=sys.stderr,
            )
            print(f"  canonical (normalized): {ref_use_ssl!r}", file=sys.stderr)
            print(f"  workflow  (normalized): {wf_use_ssl!r}", file=sys.stderr)
            ok = False

    # ── 3. Compare smtp_ssl_env= assignment across all discovered workflow files
    ssl_env_values: dict[str, str] = {}
    for path in workflow_files:
        try:
            line = _find_workflow_ssl_env(path)
        except OSError:
            line = None  # already reported above

        if line is None:
            print(
                f"ERROR: smtp_ssl_env= assignment line not found in {path}",
                file=sys.stderr,
            )
            ok = False
        else:
            ssl_env_values[path] = line

    if len(ssl_env_values) > 1:
        paths = list(ssl_env_values)
        ref_path, ref_line = paths[0], ssl_env_values[paths[0]]
        for path in paths[1:]:
            if ssl_env_values[path] != ref_line:
                print(
                    "DRIFT — smtp_ssl_env= assignment differs between workflow files:",
                    file=sys.stderr,
                )
                print(f"  {ref_path}: {ref_line!r}", file=sys.stderr)
                print(f"  {path}: {ssl_env_values[path]!r}", file=sys.stderr)
                ok = False

    if ok:
        print("OK  SSL-detection logic is consistent across all sources.")
        print(f"    use_ssl (canonical, normalized): {ref_use_ssl}")
        if ssl_env_values:
            print(f"    smtp_ssl_env assignment: {next(iter(ssl_env_values.values()))}")
    else:
        print(
            "\nFix: update the drifted source(s) so the detection logic matches "
            "_detect_mode in scripts/test_smtp_ssl_detection.py.",
            file=sys.stderr,
        )

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
