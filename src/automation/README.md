# automation: schedules and text triggers

**Text only.** An automatic run is just a task started for a bot, through the normal task engine. So the
free-only gate, the AI usage limits, the AI pause switch and the teamwork limits all apply. Nothing external happens.

| File | Job |
|---|---|
| `limits.ts` | The limits and their hard ceilings |
| `timing.ts` | Pure time maths: when is the next run? (local time) |
| `repository.ts` | All SQL: schedules, triggers, the permanent run log, settings |
| `service.ts` | The rules: validation, switching on/off, launching a run, failures, trigger matching, the clock tick |
| `scheduler.ts` | The 30-second clock. Only the real server starts it. |
| `routes.ts` | `/api/schedules`, `/api/triggers`, `/api/events`, `/api/automation/...` |

## Schedules
Every N minutes (at least 15), daily at a time on chosen days, or once. Created **switched off**.

## Triggers
- **A text event arrives** (`POST /api/events`, the test form now; Telegram and Gmail will send events here later).
- **Another bot finishes a task** (its answer becomes the text).
Both can require a keyword, have a cooldown (at least 30 seconds), and use a message template with `{{text}}`. Created **switched off**.

## Rules that cannot be switched off
- Kill switch for all automation, separate from the AI pause switch. A pause is reported before a cooldown.
- Never replays: a run more than 5 minutes late (app off, PC asleep) is skipped and logged.
- Daily caps: 20 automatic runs overall, 10 per schedule or trigger (ceilings 200 / 100).
- A schedule or trigger switches itself off after 3 failed runs in a row, with the reason shown.
- No endless chains: at most 2 automatic hops (ceiling 4); a trigger never restarts itself; a bot's own results cannot trigger itself.
- One run of a schedule at a time: a new run is skipped while the previous one is still working.
- The run log is permanent and cannot be edited or deleted. Deleting a schedule keeps its history.
