# AI Workforce Platform

Create, edit and manage AI bots from a dashboard in your browser.

**Current status: phone access, OmniRoute and Phases 7-9 built.** You can use the platform from your Windows PC and your Android phone (private, over Tailscale; see `docs/PHONE-AND-REMOTE.md`). Earlier: Phases 7-9 (Gmail, Browser, installable app). Behind the Phase 5 safety gate there are now three connections:
**Telegram**, **Gmail** and **Browser** (reads public https web pages). None does anything until you set it up in Settings. A bot can only *ask*:
every write (sending a message or email, submitting a web form) waits on the **Approvals** page for your click and runs once with exactly the
content shown; reading from outside is off for every bot until you switch it on. Keys live in an encrypted **vault** (Settings). The
dashboard can be installed as an app (see docs/PHONE-AND-REMOTE.md). Earlier: Phase 4 schedules and text triggers can start tasks for your bots (all
switched off until you switch them on, and always limited). Before that, from Phase 3: you can create, edit, duplicate, archive and
restore bots, with full version history and per-bot permissions, and **chat with a bot** once
you have connected a free AI provider. Each bot picks its own provider and model.
Bots can **hand text tasks to teammates you allow** (nobody, by default) and you can watch the
whole chain on the **Tasks** page.
Bots work **only when you message them or give them a task**. They have **no tools** (nothing is ever sent to a model as a tool),
and their only possible outside connections are Telegram, Gmail and the Browser reader, all behind your approval. Everything runs on your own PC.

**Free only.** Only free models can be used. This is locked on and cannot be turned off:
no paid models, no paid fallbacks, no automatic billing.

## Updating from Phase 1
Starting the app upgrades `data/app.db` automatically (it only **adds** things, and your bots,
versions and permissions are kept: this is tested against a copy of a real Phase 1 database).
Before the first start of a new version it is still sensible to copy `data/app.db`
(and `app.db-wal` / `app.db-shm` if present) somewhere safe while the app is stopped.

## Run it (Windows)

1. Open a terminal in this folder (in VS Code: Terminal > New Terminal).
2. Start everything with one command:

   ```
   npm run dev:all
   ```

3. Wait a few seconds until you see both of these:
   - a line containing `Server listening at http://127.0.0.1:3000` (the backend)
   - a line containing `Local:   http://127.0.0.1:5173/` (the dashboard)

   A notice saying `.env not found. Continuing without it.` is normal. It just means you
   haven't made a settings file, and the defaults are fine.
4. Open **http://127.0.0.1:5173** in your browser (`http://localhost:5173` usually works too,
   but can be slower to load on some PCs).
5. To stop everything, click the terminal and press **Ctrl+C**.

Your bots are saved in `data/app.db` on your PC (created automatically on first run).
Git ignores that folder, so back it up yourself if you rely on it.

### First time on a new computer
Install the packages once with `npm run install:all`.

## Check that everything works

```
npm run check
```

Runs the type checks, all automated tests and a production build of both parts.

## How it is organised

| Folder | What it is |
|---|---|
| `src/` | The backend (TypeScript + Fastify + SQLite) |
| `src/agent-manager/` | Bots, versions and permissions: the rules and the API |
| `src/llm/` | AI providers, models, the free-only gate, limits and usage tracking |
| `src/runtimes/` | What makes a bot think (built-in engine now, OpenClaw later) |
| `src/chat/` | Test chat: conversations and messages |
| `src/delegation/` | Teamwork: allow-lists, tasks, the engine that runs a chain of bots |
| `src/automation/` | Schedules, text triggers, the 30-second clock, the run log |
| `src/approvals/` | The outside-action gate: requests, your approval, limits, kill switch |
| `src/connectors/` | What a connector must look like, and the Telegram, Gmail and Browser connectors |
| `src/vault/` | The encrypted store for keys and tokens |
| `src/audit/` | The permanent security log |
| `src/remote/` | Phone access: who is asking, device pairing, serving the dashboard |
| `src/db/` | The database and its upgrade scripts |
| `web/` | The dashboard (React + Vite + Tailwind) |
| `scripts/` | Helper scripts (`dev-all.mjs` starts both parts) |

## Safety rules built into the platform

- New bots start **Disabled**. A bot cannot be set to Active yet.
- **Free-only mode is locked on.** Paid or unverified models are blocked, and a model that ever
  reports a cost is switched off automatically.
- **No tools.** Bots only produce text, and only when you message them or give them a task. Asking for an outside action is
  also just text, which the platform checks and holds for you.
- **Automation is off by default and bounded.** New schedules and triggers start switched off. Runs are at least 15 minutes
  apart, capped per day, never replayed after the app was off, and a one-click kill switch stops them all. A schedule or
  trigger switches itself off after 3 failures in a row. Automatic runs obey every AI limit and the free-only rule.
- **Teamwork is off by default and bounded.** A bot can only hand work to teammates you tick on its Team tab. No
  loops, limited depth, tasks and model calls per chain, a cancel button, and a permanent log.
- Usage limits (requests and tokens per day and month, per bot and overall) are checked before
  every call. There is a one-click pause switch for all AI calls.
- API keys live in the encrypted **vault** (Settings page) or in your `.env` file; the vault is used first. A saved key is never
  shown again, never sent to a bot, never written to the logs, and removed from error messages. The vault's encryption key is the
  file `data/vault.key` (created on first start; Git ignores it). **Back it up with `data/app.db`**: without it, saved keys cannot be read.
- **Outside actions need you.** A bot can only ask. Writes wait for your approval on the **Approvals** page, show the exact content,
  run once, and expire after 24 hours. Reads need a per-bot permission. One switch pauses all outside actions. Limits: 5 waiting and
  20 requests per bot per day, 50 outside reads per bot per day. Every step goes in a permanent security log without secrets.
- Every external **read** permission starts **off**, per bot and per connector.
- **Writing** to the outside world (sending email, messages) will always need your approval.
  The database itself refuses any other setting.
- Version history and the permission change log can never be edited or deleted.
- Bots are archived, never deleted.
- The backend only accepts connections from this PC.
- No secrets belong in code or in `.env.example`. Real settings go in a `.env` file,
  which Git ignores.
