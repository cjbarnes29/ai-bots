# AI Workforce Platform

Create, edit and manage AI bots from a dashboard in your browser.

**Current status: Phase 1 (Agent Manager).** You can create, edit, duplicate, archive and
restore bots, with full version history and per-bot permissions.
**Bots cannot run yet** (that arrives in Phase 2), and no connectors (Gmail, Telegram,
browser) exist yet. Everything runs on your own PC.

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
| `src/db/` | The database and its upgrade scripts |
| `web/` | The dashboard (React + Vite + Tailwind) |
| `scripts/` | Helper scripts (`dev-all.mjs` starts both parts) |

## Safety rules built into the platform

- New bots start **Disabled**. A bot cannot be set to Active until Phase 2.
- Every external **read** permission starts **off**, per bot and per connector.
- **Writing** to the outside world (sending email, messages) will always need your approval.
  The database itself refuses any other setting.
- Version history and the permission change log can never be edited or deleted.
- Bots are archived, never deleted.
- The backend only accepts connections from this PC.
- No secrets belong in code or in `.env.example`. Real settings go in a `.env` file,
  which Git ignores.
