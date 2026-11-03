# agent-manager

Create, edit, duplicate, archive and restore bots, with full version history and
per-bot permissions. **Phase 1: bots are records only. Nothing can run them yet.**

| File | Job |
|---|---|
| `types.ts` | Shared shapes and `AppError` |
| `schemas.ts` | Input validation rules (zod) and size limits |
| `repository.ts` | All SQL. No business rules. |
| `service.ts` | The rules (versioning, restore, permissions, archive) |
| `routes.ts` | HTTP endpoints under `/api/bots` |
| `agent-manager.test.ts` | Automated tests (`npm test`) |

## Safety rules (enforced in code AND by the database)
- New bots start `disabled`. Setting a bot to `active` is refused until Phase 2.
- Every external **read** permission starts OFF, per bot and per connector.
- **Write** permission is always `approval_required`. The database rejects any other value.
- Version history and the permission audit log are append-only.
- Bots are archived, never deleted.
- Restoring a version creates a new version; it never changes permissions or status.
- Duplicating a bot copies content only (disabled, all permissions OFF).
