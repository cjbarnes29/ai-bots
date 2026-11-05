# Migration 018 (inbox and projects): review for the owner's approval

**Status: APPLIED on 2026-11-05 (revision 2, owner approval; board D-054).** The text below is the review as it was shown before approval. Two proposals exist: `docs/proposals/018_inbox.sql` (revision 1, four tables) and `docs/proposals/018_inbox_rev2.sql` (revision 1 + three tables for projects and group inbox state). Recommended for approval: **revision 2**, because the product brief is built around projects and group chats and revision 1 cannot serve them. Revision 1 alone is also safe if you prefer to approve less.

## The tables
| Table | Purpose | Keys / constraints |
|---|---|---|
| `inbox_conversation_state` (rev 1) | Per one-bot conversation: rename (`title_override`; the original title stays), pinned, muted, archived, hidden ("delete" = hide; messages kept), `last_read_message_id` (unread = newer bot messages) | PK and FK to `conversations`; booleans CHECKed 0/1; title 1-120 chars |
| `inbox_message_meta` (rev 1) | Why a bot message exists: kind, importance, source (task / approval / schedule / workflow_run / trigger / bot_action) and the real event id | PK and FK to `chat_messages`; FKs to `conversations`, `bots`; **`UNIQUE(source_kind, source_id, kind)`** = one message per real event and kind |
| `inbox_preferences` (rev 1) | Notification level (all / important / none) and `max_per_hour` (1-60, default 6), a default row (bot NULL) plus per-bot overrides | Unique expression index on `COALESCE(bot_id,'')`: only one default row, one row per bot |
| `inbox_held_back` (rev 1) | Messages the hourly cap held back, so nothing disappears silently | FK to `bots`; index (bot, time) |
| `projects` (rev 2) | Name, description, instructions, archived, `deleted_at` (hide, not destroy) | Length CHECKs; index for listing |
| `project_items` (rev 2) | Links a conversation / group / workflow / schedule / task / note to ONE project (linked, never copied) | `PRIMARY KEY(item_kind, item_id)` so an item is in at most one project; FK to `projects`. The target id is checked by the service, not by the database (the targets live in different tables) |
| `inbox_group_state` (rev 2) | The same pinned / muted / hidden / read marker for a group | PK and FK to `bot_groups` |

## What was verified (scratch in-memory database built from migrations 001-017, then 018; script in the session scratchpad, not in the repo)
- **Existing schema untouched:** 0 existing tables, indexes or triggers changed (compared SQL text before and after); 13 new objects (rev 2).
- **Idempotency:** the same real event and kind twice -> refused by the database (`UNIQUE`); a different kind for the same event is allowed (e.g. result and failure).
- **Foreign keys:** a meta row pointing at an unknown conversation is refused; `PRAGMA foreign_key_check` empty; `integrity_check` ok.
- **Unread / pin / mute / archive / hide / rename:** stored and queried (unread count by `last_read_message_id` returned the expected number); the original conversation title is unchanged by a rename.
- **Compatibility with chat tables:** `chat_messages` still append-only, `conversations` still not deletable (hide is the delete); no trigger changed.
- **Preferences:** a second default row is refused; `max_per_hour` 0 and 999 are refused; the hourly count query uses `idx_inbox_meta_bot_time`.
- **NOT verified:** the application code that will use these tables does not exist yet, so the hourly cap, notification choice, unread counts in the UI and "no fake messages" are **design, not behaviour**. The service-level guarantees (only real events write bot messages; cap enforced before insert; project instructions treated as untrusted) must be built and tested after approval. Rev 2's `projects`/`project_items` and `inbox_group_state` were checked for creation, schema and integrity only, not with data.

## Destructive or irreversible?
- No `DROP`, `DELETE`, `UPDATE` or `ALTER` of any existing object. Only `CREATE TABLE` / `CREATE INDEX`. No data is copied or rewritten.
- It is **additive and not reversible by the runner** (no down-migration exists, as for 017). Rollback = restore the backup taken before applying (`npm run backup`), or leave the empty tables in place; they are harmless if unused.
- A deliberate limit: nothing can hard-delete a project or conversation; "delete" hides it. If you want real deletion that is a separate, explicit decision.

## Procedure if you approve (same as 017)
1. Stop the app. 2. `npm run backup`, verify integrity and identity. 3. Rehearse on a scratch copy of `data/app.db`. 4. Copy the approved file unchanged to `src/db/migrations/018_inbox.sql`; update `upgrade.test.ts`/`agent-manager.test.ts` migration counts and add a hash-pin test as for 017. 5. Start the app (the runner applies it in one transaction; a failure rolls back and the app refuses to start). 6. Prove all 52+ existing objects identical; run `npm run check`. 7. Update the board. No commit without your separate approval.

## What I need from you
Reply with one of: **approve rev 2**, **approve rev 1 only**, or **changes wanted** (say which table/column). Until then no migration is applied and the inbox, projects and group chats are not built.
