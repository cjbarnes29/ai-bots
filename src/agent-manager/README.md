# agent-manager

Create, edit, duplicate, archive and restore bots, with full version history and
per-bot permissions. (Historical note: this README was written in Phase 1. Bots now run: chat, tasks, delegation, workflows. The safety rules below still hold. See `docs/PROGRESS.md`, `src/bot-studio/README.md` and `docs/IMPLEMENTATION-MATRIX.md`.)

| File | Job |
|---|---|
| `types.ts` | Shared shapes and `AppError` |
| `schemas.ts` | Input validation rules (zod) and size limits |
| `repository.ts` | All SQL. No business rules. |
| `service.ts` | The rules (versioning, restore, permissions, archive) |
| `routes.ts` | HTTP endpoints under `/api/bots` |
| `agent-manager.test.ts` | Automated tests (`npm test`) |

## Safety rules (enforced in code AND by the database)
- New bots start `disabled`. Setting a bot to `active` needs a model (Automatic is fine) and is the owner's choice (2026-11-04, board D-049; the Phase 1 lock is gone). **Only an `active`, non-archived bot runs**: chat, tasks, teammates, workflows, schedules, the Manager and inbound messages are all refused for `disabled` or `paused` bots, centrally in `LlmService.complete` (plus early, clear refusals in chat and task submission). Switching a bot on never changes a permission. Removing the model of an active bot switches it off; archiving switches it off.
- Every external **read** permission starts OFF, per bot and per connector.
- **Write** permission is always `approval_required`. The database rejects any other value.
- Version history and the permission audit log are append-only.
- Bots are archived, never deleted.
- Restoring a version creates a new version; it never changes permissions or status.
- Duplicating a bot copies content only (disabled, all permissions OFF).
