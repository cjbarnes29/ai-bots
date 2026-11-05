# Demo mode and everyday usability (2026-11-05, board D-051)

Goal: make the application useful and explorable BEFORE any API key or outside account exists. Nothing here contacts anything outside this PC, uses a key, or costs money.

## What Demo mode is (and is not)
- A built-in provider with id `demo`, shown as **"Demo AI (simulated, built in)"**. Code: `src/llm/providers/demo.ts`, `src/llm/plugins/demo.ts`. It is **not an AI**: it echoes what an agent was asked, how many characters of instructions it got and how long the conversation is. Models: `simulated-echo` (always answers) and `simulated-failing` (always fails, to practise reading errors and fallbacks).
- **It can never pass for a real AI.** Every reply starts with `[SIMULATED RESPONSE - no real AI was used]`; that line is part of the saved text, so it appears in chats, tasks, workflow outputs and the activity log. The dashboard also shows a "Simulated" badge on chat messages, workflows that use demo agents, workflow runs and the provider card.
- **It is never chosen silently.** Automatic routing ignores it unless the owner ticks "Demo AI" by name in Settings > AI Models > Model routing (an empty provider list means "all real providers", not the demo), and even then it ranks after every real model. It is never counted as a "connected" AI on the dashboard. Free-only rules are unchanged (the demo is free by construction).
- Tests: `src/demo/demo.test.ts` (9, the real provider, `fetch` replaced by a function that fails the test if called), `web/src/demo.test.tsx` (8), scratch end-to-end `node scripts/e2e/demo-e2e.mjs` (16 checks, real app over HTTP, scratch database, no keys).

## Using it
Dashboard > "Try it without an AI account" > **Set up the demo** (PC only; a phone gets a clear refusal). It enables the demo provider and its two models, then creates, only if missing (by name):
- Agents: `Demo: Researcher`, `Demo: Writer`, `Demo: Reviewer`, `Demo: Failing agent`. Ordinary agents with editable instructions, **all permissions off**, on the simulated model. Edit, copy or delete them like any agent. Setup never overwrites what you edited.
- Workflows (switched off, run with the Run button): `Demo: Research, write, review` (three agents, a check, a checkpoint where you decide) and `Demo: Where did it fail?` (the second step fails on purpose; the run shows "Stopped at the box ...").

## What works with what
| Needs | Works |
|---|---|
| Nothing | Creating, editing and versioning agents; drawing, checking, saving, copying and archiving workflows; schedules; approvals queue; limits and usage pages; Access and folder permissions; the vault; backups |
| The simulated Demo AI | Chatting with an agent, tasks, agents handing work over, running a workflow start to end, a failed step, a checkpoint, the routing screens and fallback rules |
| A real AI provider (Gemini, Groq, OpenRouter, Ollama) | Real answers; the Manager's planning (automatic routing never picks the Demo AI, and the Demo AI cannot write a plan: a Manager request fails with a clear message); AI-drafted bots; the setup assistant; skill tests; Business lead text |
| Your own accounts or tokens | Telegram, Gmail, Google Workspace, GitHub, Notion, n8n, MCP, phone access |
The same map is shown in the app (Demo card > "What works without a real AI provider").

## Other improvements in this change
- **Dashboard:** "Your AI right now" (each provider's real state, models switched on, calls today; real and simulated kept apart), the routing strategy in one paragraph and what would be chosen now, recent workflow runs with the box where one failed, a hint for people without a key.
- **Model routing (Settings > AI Models):** provider order as Preferred / Backup 1.. with Up and Down; a first choice per kind of task; the default model for new agents; "never choose automatically" per model; a Model availability list (ready, or why not); maximum attempts; a plain statement of what triggers fallback and what stops it, and which settings work with the simulated provider and which need real API access. These settings existed in the backend; the screen only exposed some of them.
- **Integrations Center:** every card says "Works on this PC, no account" or "Needs your own account or token", gives one concrete next step, and says there is no simulated version of outside services; "Which services do I need?" maps a goal (files, documents, email, Telegram, GitHub, Notion, n8n, MCP, "just explore") to the services, their current state and whether a real AI is also needed. The setup wizards are unchanged.
- **Workflows:** failed runs say which box they stopped at; "Started with: ..." in a run; unknown status words (`completed`, `skipped`, `pending`) are shown in plain words.
- **Bug fixed:** a finished workflow run has status `completed`, but the Dashboard counted `done` (so "finished" was always 0) and the Workflows page printed the raw word. The test fake used `done` too, which hid it. Fixed in the pages and the fake.

## Limitations
- Demo calls count as "AI calls" in usage and in the daily limits, although no model was involved.
- The Demo AI cannot do anything intelligent: no summarising, planning, classification or JSON. Workflows with a condition on the text of an answer behave according to the echo text, not real meaning.
- The workflow editor itself is unchanged (it already supports adding and configuring boxes, arrows, agents, conditions, checkpoints, validation and saving); it has not been exercised by hand in a real browser in this change, only through component tests. Choosing a provider/model per workflow box is done through the agent that the box uses.
- No "dry run without any AI" mode and no stored workflow templates beyond the two demo workflows.
- Outside integrations have no simulated mode. They still need real accounts and remain untested against real services.
- Real-browser check this session (headless Edge, scratch instance): dashboard, workflows, integrations and settings pages opened and read; the Model routing section rendered with its new controls but its screenshot was too small to proofread, so its wording was verified by component tests only. Nothing was clicked by hand in a browser.
