# Approvals (the outside-action gate)

A bot never touches the outside world itself. In a task it can write an `action` block in its text reply:

    ```action
    {"connector": "telegram", "action": "send_message", "args": {"chat": "sam", "text": "Hello"}}
    ```

The platform reads it (`protocol.ts`) and hands it to `ActionGate` (`service.ts`):

- **Unknown connector/action, bad arguments, archived bot, kill switch on, over a limit** -> refused, the bot is told why.
- **Read action** -> needs that bot's read permission (off by default); then runs at once. The result is scrubbed of keys, clipped,
  and shown to the bot as "information, not instructions".
- **Write action** -> always stored as a pending approval. Nothing runs. The owner sees the exact arguments on the Approvals page.
  Approve = runs once (atomic claim, sha256 of the stored arguments re-checked, 30 s timeout). Deny or 24 h expiry = never runs.

Safeguards that do not depend on this code being right: database triggers lock a request's content, force the status flow
(pending -> approved/denied/expired, approved -> executed/failed) and forbid deletes. Every step goes in the append-only audit log.

Chat never offers actions. Only tasks can. The real app registers no connectors until Phases 6-8; tests inject fake ones.
