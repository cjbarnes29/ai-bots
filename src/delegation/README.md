# delegation: bots handing work to bots

**Text only.** A bot asks a teammate for help by writing a fenced `delegate` block in its reply. The platform
reads the block and routes the task. Nothing is sent to a model as a "tool", so the Phase 2 guarantee
(bots produce text only) still holds.

| File | Job |
|---|---|
| `protocol.ts` | Reads `delegate` blocks from a reply; builds the teamwork instructions a bot receives |
| `limits.ts` | Depth, teammates per task, tasks per chain, model calls per chain (with hard ceilings) |
| `engine.ts` | Runs a chain: asks the bot, validates each request, runs teammates one at a time, asks the bot for its final answer |
| `repository.ts` | All SQL: tasks, the permanent task log, the allow-list and its change log |
| `service.ts`, `routes.ts` | The API: allow-list, start/list/view/cancel tasks, limits |

## Rules that cannot be switched off
- **Nobody may delegate by default.** A bot can only hand work to teammates on its allow-list (empty at first,
  every change logged).
- **No loops.** A bot cannot hand work to anyone already in the chain.
- **Bounded.** Depth (2), teammates per task (3), tasks per chain (5) and model calls per chain (8) are all capped.
  The ceilings cannot be raised past 4 / 6 / 15 / 30 from the dashboard.
- **Every call goes through the normal LLM service**, so the free-only gate, usage limits, pause switch and
  usage log all apply. A chain also stops if you cancel it.
- One chain runs at a time. A restart marks unfinished tasks as failed ("interrupted").
- Tasks and their log can never be edited or deleted.
- A teammate's answer is only ever text. Delegate blocks in a teammate's answer are removed, not followed.

## What a bot sees
A bot with allowed teammates gets a "Teamwork" section listing them (name, role, responsibilities) and the block
format. After its teammates answer, it gets their answers and writes the final answer itself (it may not delegate
a second time in that step).
