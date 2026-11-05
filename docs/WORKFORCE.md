# Workforce, groups, collaboration and the Workforce Board

One Central Manager coordinates four divisions. Everything here reuses an existing service; nothing is a second registry of bots, tasks, projects or decisions. Decisions D-063 to D-065 on the board.

## 1. Organisation (`src/workforce/service.ts`)
- **Central Manager** = the existing Manager AI (`src/manager`). Bots coordinate through it and through the delegation allow-list.
- **Four divisions**: Personal Office, Business Operations, AI Digital Agency, Research & Innovation.
- **Three kinds of bot** (a small document in the settings store; no migration): *dedicated* (exactly one division), *shared specialist* (one or more), *temporary task agent* (one division, a stated purpose, 1-168 hours; archived reversibly with the Agent Manager's own archive when its time is up).
- Placing a bot grants it nothing. With groups on it also joins its division's group.
- API: `GET /api/workforce/organization`, `PUT/DELETE /api/workforce/bots/:botId` (owner-only on a phone, owner proof on this PC).

## 2. Groups (`src/groups`, tables from migration 017)
- **OFF until the owner switches them on** (`PUT /api/groups/enabled`, owner-only, owner proof). This is the NV-15 switch. Every route except `/api/groups/status` answers `groups_disabled` while off. Nothing was switched on in the owner's real database.
- Create/edit/archive, members (member / reviewer / observer), a coordinator, per-group responsibilities (an append-only event; the newest per bot counts; text only), division groups (one per division) and project groups (linked to an existing project).
- **Participation modes**: mention only, relevant bot, group discussion (up to 3), manager coordinates (the coordinator answers or hands parts on), all invited (up to 5).
- **Work = ordinary tasks** through the TaskEngine (Guardian hold, pause switches, delegation limits, free-only gate, approval gate all apply). A bot's group message is the recorded result of a real task, written once by the server; there is no route that posts as a bot.
- **Loop guard**: after one owner message at most `max_rounds` bot turns (default 6); bot text never starts another turn; identical handoffs within 6 hours are refused; every block is an event (`blocked_loop`, `blocked_duplicate`, `blocked_permission`).
- **Visibility**: a direct message to one bot is never put in another bot's context; the owner sees everything. Group conversation is passed to bots as DATA.
- **Handoffs** (`POST /api/groups/:id/handoffs`): need the delegation allow-list entry that already decides who may delegate to whom (group membership grants no right); the source task's result can be shared as context (capped, data).
- **Disagreements**: `POST /api/groups/:id/recommendations` asks members for options (existing Decisions inquiry, <= 3 bots); `POST /api/groups/:id/escalate` puts them on the Decisions board (and in the group's project). The group keeps an `escalate` event.

## 3. Collaboration and the owner's decision centre (`src/decisions/collaboration.ts`)
Rule: **collaborate first; escalate what stays unresolved to the owner.**
1. Bots submit recommendations (options). 2. The owner (or the Manager's loop) starts review rounds: each bot gives a reasoned view. 3. `POST /api/decisions/:id/collaborate` = the Manager's loop: review, check agreement, stop at agreement, at most two rounds (a database rule), then record "sent to the owner". 4. The **consensus check** uses only recorded views: silence is never agreement, an "alternative" counts against the viewed option, at least two bots must stand behind one option and nobody against it. It never chooses; its "Manager's summary" is labelled as a count, not a bot's view and not a decision. 5. The outcome is written to the permanent decision history (once per distinct outcome).
- **Instruction versions**: the database already keeps an append-only history. `GET /api/decisions/:id/options/:optionId/versions` returns version 1 (the original, by a bot or the owner) and one version per owner edit with the exact changes and a sha256 fingerprint; the approved version is the last one that existed at approval. After approval the options are frozen by a database rule.
- **What executes**: the task instruction is built from the approved option text plus the duty the owner wrote per bot at approval. The owner's private note and comments are never part of it (tested). `GET /api/decisions/:id/execution` shows the exact instruction each bot received, whether it matches the approved wording, and the recorded result.
- Owner acts are unchanged: only the owner chooses/approves/rejects; owner proof on this PC; paired phones may decide (D-063).

## 4. The Workforce Board (`GET /api/workforce/board`, page `/workforce`)
Read-only aggregation of the real tables: Manager, divisions, groups, bots, projects, tasks (recent chains with sub-task lines), decisions, approvals and approved documents (deliverables). Statuses are the true ones (active / completed / blocked = waiting for an approval / failed / idle). Lines: coordinates, division membership (dedicated/shared), group membership, delegation allow-list, task assignment, sub-task, origin (group or decision), project, decision assignment, approval. Caps are shown ("newest only"), never hidden. Node history comes from the owning record. Saved layouts (max 10) keep positions and filters only. Large screens: interactive SVG (drag, click to inspect, filters); phones: the same nodes as a list.

## 5. Model coordination
Group turns are normal tasks, so the existing registry/routing rules apply unchanged: only verified free models, automatic routing with failover (verified end to end with fake providers, `scripts/e2e/groups-e2e.mjs`: the gateway failed, the local provider answered, the group conversation reached it, usage recorded, a priced model was never called). **Limit:** a group's `model_ref` is stored and validated but not applied to tasks; each bot's own model (or automatic routing) is used.

## 6. Known limits (not hidden)
- Division/project/general kind and the division of a group are kept in a settings document (no schema column; no migration was approved). Placement of bots likewise.
- Reassigning an already assigned decision duty is not supported (assignments are immutable by database rule); another bot can be added.
- Bots do not talk to each other by themselves: every handoff is started by the owner or the Manager through the API.
- Not tested with a real provider; all model behaviour above was verified with scripted fake providers. NV-15 stays "built, tested with fakes, owner switch not turned on".
