"""
Unit tests for the auto-discovery logic in check_smtp_ssl_sync.py.

Verifies:
  1. A new workflow file containing the use_ssl snippet is discovered and, when
     its expression drifts from the canonical source, drift is detected (exit 1).
  2. A workflow file that does NOT contain the snippet is excluded from the check.
  3. When no workflow files contain the snippet, main() exits with code 1.

Run with:  python3 scripts/test_smtp_ssl_sync_discovery.py
"""

import os
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

# Allow importing from the scripts/ directory regardless of cwd.
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

import check_smtp_ssl_sync  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CANONICAL_USE_SSL = (
    'use_ssl = port == 465 or smtp_ssl_env in ("1", "true", "yes")'
)
_SSL_ENV_ASSIGN = (
    'smtp_ssl_env = os.environ.get("SMTP_SSL", "").strip().lower()'
)
_DRIFTED_USE_SSL = (
    'use_ssl = port == 465 or smtp_ssl_env in ("1", "true")'  # missing "yes"
)

# A minimal workflow YAML fragment that embeds the correct SSL snippet.
_GOOD_WORKFLOW_CONTENT = textwrap.dedent(f"""\
    name: smoke-test
    on: push
    jobs:
      smtp-check:
        runs-on: ubuntu-latest
        steps:
          - run: |
              python3 - <<'EOF'
              import os, smtplib
              port = int(os.environ.get("SMTP_PORT", "587"))
              {_SSL_ENV_ASSIGN}
              {_CANONICAL_USE_SSL}
              EOF
""")

# A workflow fragment where the use_ssl expression intentionally differs.
_DRIFTED_WORKFLOW_CONTENT = textwrap.dedent(f"""\
    name: drifted-workflow
    on: push
    jobs:
      smtp-check:
        runs-on: ubuntu-latest
        steps:
          - run: |
              python3 - <<'EOF'
              import os, smtplib
              port = int(os.environ.get("SMTP_PORT", "587"))
              {_SSL_ENV_ASSIGN}
              {_DRIFTED_USE_SSL}
              EOF
""")

# A workflow file with no SSL detection snippet at all.
_NO_SNIPPET_WORKFLOW_CONTENT = textwrap.dedent("""\
    name: unrelated-workflow
    on: push
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - run: echo "nothing to do with SSL"
""")


def _write_temp_yml(directory: str, name: str, content: str) -> str:
    """Write *content* to *directory*/<name>.yml and return the full path."""
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    return path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDiscoverWorkflowFiles(unittest.TestCase):
    """Tests for _discover_workflow_files() auto-discovery logic."""

    def test_file_with_snippet_is_discovered(self):
        """A workflow file containing the use_ssl snippet must be returned."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write_temp_yml(tmpdir, "smoke-test.yml", _GOOD_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                discovered = check_smtp_ssl_sync._discover_workflow_files()
            self.assertIn(path, discovered)
            self.assertEqual(len(discovered), 1)

    def test_file_without_snippet_is_excluded(self):
        """A workflow file that lacks the use_ssl line must NOT be returned."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_temp_yml(tmpdir, "unrelated.yml", _NO_SNIPPET_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                discovered = check_smtp_ssl_sync._discover_workflow_files()
            self.assertEqual(discovered, [],
                             "file without snippet should be excluded from discovery")

    def test_mixed_directory_only_returns_snippet_files(self):
        """Only files that contain the snippet are included; others are skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            good_path = _write_temp_yml(tmpdir, "smoke-test.yml", _GOOD_WORKFLOW_CONTENT)
            _write_temp_yml(tmpdir, "unrelated.yml", _NO_SNIPPET_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                discovered = check_smtp_ssl_sync._discover_workflow_files()
            self.assertEqual(discovered, [good_path])

    def test_empty_directory_returns_empty_list(self):
        """With no YAML files at all, discovery returns an empty list."""
        with tempfile.TemporaryDirectory() as tmpdir:
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                discovered = check_smtp_ssl_sync._discover_workflow_files()
            self.assertEqual(discovered, [])


class TestNoFilesFoundPath(unittest.TestCase):
    """main() must exit with code 1 when no workflow files contain the snippet."""

    def test_no_discovered_files_exits_1(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_temp_yml(tmpdir, "unrelated.yml", _NO_SNIPPET_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                exit_code = check_smtp_ssl_sync.main()
            self.assertEqual(exit_code, 1,
                             "main() must return 1 when no files contain the snippet")

    def test_completely_empty_directory_exits_1(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern):
                exit_code = check_smtp_ssl_sync.main()
            self.assertEqual(exit_code, 1)


class TestDriftDetection(unittest.TestCase):
    """
    When a newly discovered workflow file contains the snippet but its
    use_ssl expression differs from the canonical test-file form, main()
    must return 1 (drift detected).
    """

    def _make_canonical_test_file(self, directory: str) -> str:
        """Write a minimal canonical test file with the correct _detect_mode body."""
        content = textwrap.dedent('''\
            def _detect_mode(port: int, smtp_ssl_env: str) -> str:
                """Return 'ssl' or 'starttls' using the same rule as the CI workflows."""
                use_ssl = port == 465 or smtp_ssl_env.strip().lower() in ("1", "true", "yes")
                return "ssl" if use_ssl else "starttls"
        ''')
        path = os.path.join(directory, "test_smtp_ssl_detection.py")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return path

    def test_drifted_workflow_causes_exit_1(self):
        """A workflow file with a different use_ssl expression triggers drift detection."""
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = self._make_canonical_test_file(tmpdir)
            wf_path = _write_temp_yml(tmpdir, "drifted.yml", _DRIFTED_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with (
                patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern),
                patch.object(check_smtp_ssl_sync, "TEST_FILE", canonical),
            ):
                exit_code = check_smtp_ssl_sync.main()
            self.assertEqual(exit_code, 1,
                             "drifted use_ssl expression must cause exit code 1")

    def test_consistent_workflow_causes_exit_0(self):
        """A workflow file matching the canonical expression returns exit 0."""
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = self._make_canonical_test_file(tmpdir)
            _write_temp_yml(tmpdir, "smoke-test.yml", _GOOD_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with (
                patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern),
                patch.object(check_smtp_ssl_sync, "TEST_FILE", canonical),
            ):
                exit_code = check_smtp_ssl_sync.main()
            self.assertEqual(exit_code, 0,
                             "consistent use_ssl expression must cause exit code 0")

    def test_new_file_with_snippet_is_automatically_caught(self):
        """
        Adding a new workflow file that embeds the snippet (with drift) is caught
        without modifying check_smtp_ssl_sync.py — auto-discovery picks it up.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = self._make_canonical_test_file(tmpdir)
            # Pre-existing good workflow
            _write_temp_yml(tmpdir, "existing.yml", _GOOD_WORKFLOW_CONTENT)
            # "New" workflow added by a developer — drifted expression
            _write_temp_yml(tmpdir, "new-workflow.yml", _DRIFTED_WORKFLOW_CONTENT)
            glob_pattern = os.path.join(tmpdir, "*.yml")
            with (
                patch.object(check_smtp_ssl_sync, "WORKFLOW_GLOB", glob_pattern),
                patch.object(check_smtp_ssl_sync, "TEST_FILE", canonical),
            ):
                discovered = check_smtp_ssl_sync._discover_workflow_files()
                exit_code = check_smtp_ssl_sync.main()
            # Both files should be discovered (both contain the snippet)
            self.assertEqual(len(discovered), 2,
                             "both the existing and new workflow should be discovered")
            # Drift in the new file must cause a non-zero exit
            self.assertEqual(exit_code, 1,
                             "drift in the new workflow file must be caught automatically")


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if result.result.wasSuccessful() else 1)
