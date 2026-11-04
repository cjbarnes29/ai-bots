# PC agent (PowerShell tools): how to use it safely

1. **PC Control Center** → PC agent → add ONE project folder (full path), for example `C:\Users\you\Projects\my-app`. Bots can only work inside it.
2. Open a bot → **Permissions** tab → **PC access**. Tick only what the bot needs:
   - **READ**: look at files and the PC status (no approval needed).
   - **MODIFY**: write files, create folders, move things to the trash folder (each one waits for your approval).
   - **EXECUTE**: run approved commands such as `npm run build`, `node build.js`, `git status`, `python tool.py` (each waits for your approval and shows the exact command).
   - **INSTALL**: add packages with npm or pip (install scripts are always off; each waits for your approval).
   - **ADMIN** does not exist.
3. Bots ask in text; the request appears on the **Approvals** page. Read the command, then approve or deny. It runs once.
4. **Emergency stop** (PC Control Center, also from your phone) ends everything that is running and blocks new work until you press Resume on the PC.
5. The PC Control Center shows a permanent log of everything that ran, what is kept running, and how busy the PC is.

What it will never do: run PowerShell or cmd text, push or pull from the internet with git, run `node -e` / `python -c`, install globally or from a URL, touch files outside the workspace, read `.env`, keys or databases, or use administrator rights.
