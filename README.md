# AI Workforce Platform

Create, edit and manage AI bots from a dashboard in your browser.

**Current status: Phase 3 (collaboration).** You can create, edit, duplicate, archive and
restore bots, with full version history and per-bot permissions, and **chat with a bot** once
you have connected a free AI provider. Each bot picks its own provider and model.
Bots can **hand text tasks to teammates you allow** (nobody, by default) and you can watch the
whole chain on the **Tasks** page.
Bots work **only when you message them or give them a task**. They have **no tools**, and no
connectors (Gmail, Telegram, browser) exist yet. Everything runs on your own PC.

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
| `src/db/` | The database and its upgrade scripts |
| `web/` | The dashboard (React + Vite + Tailwind) |
| `scripts/` | Helper scripts (`dev-all.mjs` starts both parts) |

## Safety rules built into the platform

- New bots start **Disabled**. A bot cannot be set to Active yet.
- **Free-only mode is locked on.** Paid or unverified models are blocked, and a model that ever
  reports a cost is switched off automatically.
- **No tools.** Bots only produce text, and only when you message them or give them a task.
- **Teamwork is off by default and bounded.** A bot can only hand work to teammates you tick on its Team tab. No
  loops, limited depth, tasks and model calls per chain, a cancel button, and a permanent log.
- Usage limits (requests and tokens per day and month, per bot and overall) are checked before
  every call. There is a one-click pause switch for all AI calls.
- API keys live only in your `.env` file. They are never shown in the dashboard, never stored in
  the database, and removed from error messages.
- Every external **read** permission starts **off**, per bot and per connector.
- **Writing** to the outside world (sending email, messages) will always need your approval.
  The database itself refuses any other setting.
- Version history and the permission change log can never be edited or deleted.
- Bots are archived, never deleted.
- The backend only accepts connections from this PC.
- No secrets belong in code or in `.env.example`. Real settings go in a `.env` file,
  which Git ignores.
