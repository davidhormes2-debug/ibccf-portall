---
name: EmailService test mock factory
description: Why EmailService test mocks use a Proxy-based factory instead of hand-written literal objects
---

`server/__tests__/helpers/emailServiceMock.ts` exports `createEmailServiceMock(overrides)`, a Proxy that auto-stubs any `EmailService` method not explicitly overridden (returns `vi.fn(async () => undefined)`). Every `vi.mock("../services/EmailService", ...)` block in `server/__tests__/` uses it instead of a literal `{ methodA: vi.fn(), ... }` object.

**Why:** a hand-written mock listing only the methods a test currently knows about silently throws "X is not a function" inside the best-effort/non-blocking email-send try/catch that wraps most `emailService.*` calls — the error gets swallowed instead of surfacing as a test failure, which is exactly how a missing `sendAccountReactivationNotification` stub previously went undetected. The factory makes every mock complete by construction, so a newly added `EmailService` method never needs a matching update across dozens of test files.

**How to apply:** when adding a new EmailService method, no test changes are required unless a specific test needs to assert on that method's call args/behavior — then pass it explicitly in that test's `overrides`. Mirrors the identical pattern already used for `storage` mocks (`createStorageMock` in `./storageMock.ts`); keep both factories consistent if one's design changes.
