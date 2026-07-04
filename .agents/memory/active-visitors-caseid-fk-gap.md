---
name: active_visitors / visitor_history caseId FK not cleaned up on case delete
description: storage.deleteCase doesn't cascade active_visitors, visitor_history, or chat_satisfaction_ratings; a case that ever had a chat/rating 500s on delete.
---

`storage.deleteCase` (server/storage.ts) explicitly cleans up several
related tables before deleting a case row, but not `active_visitors`,
`visitor_history`, or `chat_satisfaction_ratings` — all of which have a
`case_id` FK with no `ON DELETE CASCADE`. Deleting a case that ever had
an active chat session or a satisfaction rating on file 500s on the FK
constraint.

**Why:** discovered building an e2e test for the chat-to-rating flow —
seeding an `active_visitors` row with a real `caseId` (required to
reach the "chat happened" precondition, since no production route ever
binds a non-null caseId there) left rows that blocked case-delete
teardown.

**How to apply:** any e2e/integration test that seeds `active_visitors`,
`visitor_history`, or `chat_satisfaction_ratings` with a real `caseId`
must delete those rows itself before calling the case-delete endpoint.
A tracked follow-up exists to fix this at the `deleteCase`/schema level
instead of requiring every caller to know about it.
