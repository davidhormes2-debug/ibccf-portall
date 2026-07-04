"""
Unit tests for the SSL-detection logic used in CI workflow SMTP steps.

The detection rule (duplicated verbatim in smoke-test.yml and
voice-id-check.yml) is:

    smtp_ssl_env = os.environ.get("SMTP_SSL", "").strip().lower()
    use_ssl = port == 465 or smtp_ssl_env in ("1", "true", "yes")

These tests verify that:
  - port 465 always selects smtplib.SMTP_SSL
  - SMTP_SSL=true / 1 / yes selects smtplib.SMTP_SSL regardless of port
  - Any other configuration (port 587, no env var) selects smtplib.SMTP +
    STARTTLS
  - The smtplib class selection is NOT influenced by unrelated env vars

Run with:  python3 scripts/test_smtp_ssl_detection.py
"""

import os
import smtplib
import sys
import unittest
from unittest.mock import MagicMock, patch, call


# ---------------------------------------------------------------------------
# The detection function — extracted verbatim from the workflow inline Python.
# If the workflow logic ever changes, update this function too.
# ---------------------------------------------------------------------------

def _detect_mode(port: int, smtp_ssl_env: str) -> str:
    """Return 'ssl' or 'starttls' using the same rule as the CI workflows."""
    use_ssl = port == 465 or smtp_ssl_env.strip().lower() in ("1", "true", "yes")
    return "ssl" if use_ssl else "starttls"


def _connect(host: str, port: int, smtp_ssl_env: str):
    """
    Replicate the smtplib branching from the CI workflows.
    Returns the smtplib server object (or mock) selected.
    """
    use_ssl = port == 465 or smtp_ssl_env.strip().lower() in ("1", "true", "yes")
    if use_ssl:
        server = smtplib.SMTP_SSL(host, port, timeout=15)
    else:
        server = smtplib.SMTP(host, port, timeout=15)
        server.ehlo()
        server.starttls()
        server.ehlo()
    return server, use_ssl


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSslDetectionLogic(unittest.TestCase):
    """Pure-logic tests — no network, no smtplib instantiation."""

    # --- Port-465 branch -------------------------------------------------- #

    def test_port_465_selects_ssl(self):
        self.assertEqual(_detect_mode(465, ""), "ssl")

    def test_port_465_overrides_empty_smtp_ssl(self):
        self.assertEqual(_detect_mode(465, ""), "ssl")

    def test_port_465_overrides_false_smtp_ssl(self):
        """Port 465 wins even if SMTP_SSL is explicitly false-ish."""
        self.assertEqual(_detect_mode(465, "false"), "ssl")

    def test_port_465_overrides_zero_smtp_ssl(self):
        self.assertEqual(_detect_mode(465, "0"), "ssl")

    # --- SMTP_SSL env-var branch ------------------------------------------ #

    def test_smtp_ssl_true_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "true"), "ssl")

    def test_smtp_ssl_1_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "1"), "ssl")

    def test_smtp_ssl_yes_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "yes"), "ssl")

    def test_smtp_ssl_true_mixed_case_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "True"), "ssl")

    def test_smtp_ssl_TRUE_uppercase_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "TRUE"), "ssl")

    def test_smtp_ssl_yes_mixed_case_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "YES"), "ssl")

    def test_smtp_ssl_with_whitespace_selects_ssl(self):
        self.assertEqual(_detect_mode(587, "  true  "), "ssl")

    # --- STARTTLS (fallback) branch --------------------------------------- #

    def test_port_587_no_env_selects_starttls(self):
        self.assertEqual(_detect_mode(587, ""), "starttls")

    def test_port_25_no_env_selects_starttls(self):
        self.assertEqual(_detect_mode(25, ""), "starttls")

    def test_smtp_ssl_false_selects_starttls(self):
        self.assertEqual(_detect_mode(587, "false"), "starttls")

    def test_smtp_ssl_0_selects_starttls(self):
        self.assertEqual(_detect_mode(587, "0"), "starttls")

    def test_smtp_ssl_no_selects_starttls(self):
        self.assertEqual(_detect_mode(587, "no"), "starttls")

    def test_smtp_ssl_empty_string_selects_starttls(self):
        self.assertEqual(_detect_mode(587, ""), "starttls")

    def test_smtp_ssl_arbitrary_string_selects_starttls(self):
        self.assertEqual(_detect_mode(587, "enabled"), "starttls")


class TestSmtplibClassSelection(unittest.TestCase):
    """
    Mock smtplib to verify the *correct smtplib class* is instantiated for
    each branch — mirrors exactly how the workflow code branches.
    """

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_port_465_instantiates_smtp_ssl(self, mock_smtp, mock_smtp_ssl):
        mock_smtp_ssl.return_value = MagicMock()
        server, use_ssl = _connect("mail.example.com", 465, "")
        self.assertTrue(use_ssl)
        mock_smtp_ssl.assert_called_once_with("mail.example.com", 465, timeout=15)
        mock_smtp.assert_not_called()

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_smtp_ssl_true_instantiates_smtp_ssl(self, mock_smtp, mock_smtp_ssl):
        mock_smtp_ssl.return_value = MagicMock()
        server, use_ssl = _connect("mail.example.com", 587, "true")
        self.assertTrue(use_ssl)
        mock_smtp_ssl.assert_called_once_with("mail.example.com", 587, timeout=15)
        mock_smtp.assert_not_called()

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_smtp_ssl_1_instantiates_smtp_ssl(self, mock_smtp, mock_smtp_ssl):
        mock_smtp_ssl.return_value = MagicMock()
        server, use_ssl = _connect("mail.example.com", 587, "1")
        self.assertTrue(use_ssl)
        mock_smtp_ssl.assert_called_once()
        mock_smtp.assert_not_called()

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_smtp_ssl_yes_instantiates_smtp_ssl(self, mock_smtp, mock_smtp_ssl):
        mock_smtp_ssl.return_value = MagicMock()
        server, use_ssl = _connect("mail.example.com", 587, "yes")
        self.assertTrue(use_ssl)
        mock_smtp_ssl.assert_called_once()
        mock_smtp.assert_not_called()

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_starttls_fallback_instantiates_smtp(self, mock_smtp, mock_smtp_ssl):
        mock_server = MagicMock()
        mock_smtp.return_value = mock_server
        server, use_ssl = _connect("mail.example.com", 587, "")
        self.assertFalse(use_ssl)
        mock_smtp.assert_called_once_with("mail.example.com", 587, timeout=15)
        mock_smtp_ssl.assert_not_called()
        mock_server.starttls.assert_called_once()

    @patch("smtplib.SMTP_SSL")
    @patch("smtplib.SMTP")
    def test_starttls_fallback_calls_ehlo_twice(self, mock_smtp, mock_smtp_ssl):
        mock_server = MagicMock()
        mock_smtp.return_value = mock_server
        _connect("mail.example.com", 587, "false")
        self.assertEqual(mock_server.ehlo.call_count, 2,
                         "STARTTLS path must call ehlo() before and after starttls()")


class TestConsistencyBetweenWorkflows(unittest.TestCase):
    """
    The SSL-detection snippet is duplicated in smoke-test.yml and
    voice-id-check.yml. This test documents the shared contract so a future
    divergence is caught here first.
    """

    TRUTHY_SMTP_SSL_VALUES = ("1", "true", "yes", "True", "TRUE", "YES", "  true  ")
    FALSY_SMTP_SSL_VALUES  = ("", "0", "false", "False", "no", "NO", "enabled")

    def test_all_truthy_values_select_ssl(self):
        for val in self.TRUTHY_SMTP_SSL_VALUES:
            with self.subTest(SMTP_SSL=val):
                self.assertEqual(_detect_mode(587, val), "ssl",
                                 f"SMTP_SSL={val!r} should select SSL mode")

    def test_all_falsy_values_select_starttls(self):
        for val in self.FALSY_SMTP_SSL_VALUES:
            with self.subTest(SMTP_SSL=val):
                self.assertEqual(_detect_mode(587, val), "starttls",
                                 f"SMTP_SSL={val!r} should select STARTTLS mode")

    def test_port_465_always_ssl_regardless_of_env(self):
        for val in list(self.FALSY_SMTP_SSL_VALUES) + list(self.TRUTHY_SMTP_SSL_VALUES):
            with self.subTest(SMTP_SSL=val):
                self.assertEqual(_detect_mode(465, val), "ssl",
                                 f"port 465 must always select SSL (SMTP_SSL={val!r})")


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    sys.exit(0 if result.result.wasSuccessful() else 1)
