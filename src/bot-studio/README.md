# bot-studio

Ways to make and manage bots ON TOP of the existing Agent Manager (`src/agent-manager`). Nothing here replaces it: every bot is created through `AgentManagerService.createBot`, so it starts **disabled, with no model and every permission OFF**.

| File | Job |
|---|---|
| `templates.ts` | 20 editable starting configurations in four groups (data, not code). A template grants nothing; `suggests` is advice shown to the owner |
| `portable.ts` | export/import of bot CONTENT only. Import refuses permission-like or secret-like fields, unknown fields, anything that looks like a key, oversize files. Warns about suspicious instructions |
| `draft.ts` | AI-assisted creation: the description is untrusted data; the model's answer is validated, clipped and secret-scanned and returned as a DRAFT. Never saved by this code |
| `modes.ts` | operating modes (Chat Only, Research, Workflow Execution, Desktop Operator) as **ceilings**: effective permission = what the owner granted AND what the mode allows. A mode never adds a permission. Stored in the existing key-value table (no migration) |
| `routes.ts` | `/api/bot-studio/*`. Creating or changing anything is owner-only (passphrase proof when a Guardian runs) |
| `bot-studio.test.ts` | 17 tests |

Operating modes are enforced in the approval gate (`ActionGate.modeBlock`): when offering actions, when a request arrives, and again when the owner approves it. A bot with no mode behaves exactly as before.
Model capability flags (yes / no / unknown) live in `src/routing/capabilities.ts`; automatic routing can require them (`CompleteInput.require`).
