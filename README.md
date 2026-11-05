# AI Workforce Platform

Create, edit and manage AI bots from a dashboard in your browser.

> **Security status (read this):** the **Guardian** (a separate stop/pause program with an owner passphrase) is built as **Tier A: for development and
> supervised testing only**. **Tier B, the isolated AI account and the VM are NOT built or verified, so unattended operation is not allowed.**
> Honest status, setup and recovery: [docs/HANDOVER.md](docs/HANDOVER.md), [docs/GUARDIAN.md](docs/GUARDIAN.md), [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md), [TASKS.md](TASKS.md).

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

## The Guardian (emergency stop, pause, owner proof)
A separate program on this PC that can stop everything without asking the Manager or any bot.

```
npm run guardian:passphrase     # once: choose your owner passphrase (stored only as a salted hash)
npm run guardian                # start it (own terminal); it always starts PAUSED
# add GUARDIAN_URL=http://127.0.0.1:3100 to .env, restart the app, then open http://127.0.0.1:3100 and press Resume
```
While it is not running (RUN), nothing new starts and running tasks stop at their next safe point. It pauses when Windows is locked or after 15 minutes without
input. Approving things and changing safety settings need your passphrase (10-minute window). Without `GUARDIAN_URL` the app behaves as before and the
dashboard says "Guardian not set up". Full details, limits and recovery: [docs/GUARDIAN.md](docs/GUARDIAN.md).

## Workforce, groups and the Workforce Board
Open **Workforce** to place bots in the four divisions (dedicated, shared specialist or a temporary agent) and to see the board: the Central Manager, divisions, groups, bots, projects, tasks, decisions and approvals, read from the real records (nothing is invented). Open **Groups** to switch groups on (off by default), make teams of bots, write to them and hand work over (a handoff needs the delegation allow-list). In **Decisions** the Manager can run the discussion between bots, you edit the wording as versions, approve an exact version and see what each bot was told. Details: `docs/WORKFORCE.md`.

## Bot Studio
Open **Bot Studio** to start a bot from one of 20 templates, describe a bot and review the AI's draft before saving, export/import a bot file (content only, never permissions or secrets), or set an operating mode (Chat Only, Research, Workflow Execution, Desktop Operator) that can only *limit* what a bot may ask for. Every new bot starts switched off with every permission off. Group chats are not available yet: their database tables exist (migration 017, applied 2026-11-04), but the group features are still to be built and tested before they are switched on: [docs/MIGRATION-PROPOSAL-GROUPS.md](docs/MIGRATION-PROPOSAL-GROUPS.md).

## Desktop control
Approved workers can operate programs you approved (Access > Applications) through Windows UI Automation and local OCR. Only programs the engine starts itself; never your open windows; every plan waits for your approval; nothing leaves this PC; files only in approved folders. First version, tested on disposable windows only: [docs/DESKTOP-ENGINE.md](docs/DESKTOP-ENGINE.md). A planned upgrade (Bot Studio, group chats, model router, workflows) is audited in [docs/IMPLEMENTATION-MATRIX.md](docs/IMPLEMENTATION-MATRIX.md).

## Settings audit
`docs/SETTINGS-AUDIT.md` compares every available AI provider and tool by cost class, limits, privacy and suitability for operating desktop applications, and recommends the zero-cost combination. Settings > AI Models now shows the same facts per provider.

## Access: which folders and programs the AI may use
Open **Access** in the dashboard. Nothing is allowed until you say so. **Folders:** you approve one folder at a time and tick exactly what may be done in it
(read, create, edit, rename, delete), for how long, and whether sub-folders are included; a preview shows what it allows and does not allow. Secrets
(keys, .env files, browser profiles, mail, chat, password stores) are never included and need their own 24-hour approval. **Applications:** a read-only scan
lists installed and running programs; each is Not approved, Approved, Trusted or Protected (Protected ones cannot be approved). Approving a program never
approves any file or account. Everything is recorded and any approval can be taken back at once. The PC agent's workspace folders (PC Control Center) now also
need a folder approval here. Not enforced by Windows itself (needs Tier B and a dedicated account): [docs/ACCESS-CONTROL.md](docs/ACCESS-CONTROL.md),
[docs/TIER-B-PLAN.md](docs/TIER-B-PLAN.md).

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
| `src/monitor/` | The Monitor page's overview of health and recent activity |
| `src/backup/` | `npm run backup`: a safe copy of your database and vault key |
| `src/remote/` | Phone access: who is asking, device pairing, serving the dashboard |
| `src/guardian/` | The Guardian: state machine, journal, passphrase, leases, presence, stopping the Manager's programs |
| `src/bot-studio/` | Bot templates, export/import, AI drafts, operating modes |
| `src/desktop/` | Desktop engine: Windows host script, bridge, engine, connector, redaction |
| `src/access/` | Application discovery and policy, folder permissions, the Access routes |
| `scripts/security/` | Security scripts **for review** (the read-only firewall audit; `tier-b/` install, account, firewall and rollback scripts; none run by the assistant) |
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
