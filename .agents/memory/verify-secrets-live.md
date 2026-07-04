---
name: Verify secrets live, not just presence
description: A configured secret (SMTP_*, webhook URL, API key) can still be invalid/expired; test the real call before trusting a "configured" check.
---

Checking `viewEnvVars`/`process.env` for a secret's presence, or a script's own
"is this configured?" boolean, only proves the variable is *set* — not that the
credential is *valid*. Scripts commonly gate behavior on presence alone (e.g. "if
SMTP_HOST && SMTP_USER && ... then attempt send"), which will happily report
"configured" even when the password is stale/expired/rotated.

**Why:** In one case, all seven `SMTP_*` secrets for a project were present and
had been for a while, but the password was stale — every real send (including the
app's regular transactional email, not just the task at hand) was silently failing
with a 535 auth error. Nothing in the codebase or "configured" checks surfaced
this; only an actual live send attempt did.

**How to apply:** When a task is "set up/verify alerting or notification
secrets," don't stop at confirming the env vars exist. Trigger the real
send/call once (a test webhook post, a test email, a real API ping) and read the
result. If it fails, surface it to the user immediately — an invalid credential
silently breaks every consumer of that secret, not just the one you're working on.
