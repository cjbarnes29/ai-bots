# Owner checklist: Guardian checks and the firewall audit (steps 0 and 1 of Tier B)

Written for: you, the owner, doing these steps yourself at your PC. Prepared 2026-11-15 (D-119). **I (Claude) have run none of this.** Nothing here is verified until you run it and share the result. Plain-language detail: `docs/GUARDIAN.md` sections 8 and 11, `docs/SECURITY-AUDIT.md` section 1, `docs/TIER-B-PLAN.md` section 1.

## What these steps are for
The Guardian is the "pause and stop" safety program. Today (Tier A) it only protects you while you are at the PC and supervising. Before anything may run while you are away (Tier B), two things must be proven on your real PC: that the Guardian really pauses and stops, and what your Windows firewall currently allows. Only you can do both. Until then, **everything stays supervised and unattended operation is not allowed.**

## Before you start (2 minutes)
- Be at the PC and able to stop things. Close anything with unsaved work you care about.
- Stay in the project folder: `c:\Users\carlou\Desktop\ai bot`.
- Do NOT run any file in `scripts/security/tier-b/`. Those are for review only and change Windows. Only the audit script in Part B is meant to be run, and it only reads.

## Part A: three Guardian checks (about 10 minutes; no administrator needed)
Needs the Guardian set up once (`docs/GUARDIAN.md` section 8): `npm run guardian:passphrase` (choose a passphrase of 12+ characters, never save it in the project folder), then `npm run guardian` in its own terminal, `GUARDIAN_URL=http://127.0.0.1:3100` in `.env`, restart the app with `npm run dev:all`, open http://127.0.0.1:3100, type the passphrase and press **Resume**. The banner should turn green.

**Check 1: locking pauses it.**
1. With the Guardian in RUN (green), press **Win + L** to lock Windows. Wait a few seconds.
2. Unlock.
3. Expected: the banner says **Paused**, reason "session locked". Write down: pass or fail, and what the banner said.

**Check 2: 15 minutes (here 1 minute) of no input pauses it.**
1. Stop the Guardian (Ctrl+C in its terminal). Start it again with a short timer: in PowerShell run `$env:GUARDIAN_IDLE_MINUTES = "1"; npm run guardian`.
2. Resume it with your passphrase. Then leave the keyboard and mouse completely alone for one minute (do not touch the screen).
3. Expected: it pauses by itself. Write down: pass or fail.
4. Afterwards stop it and start it normally again (without that variable).

**Check 3: STOP ends a running task safely.**
1. Start any harmless task in the dashboard (an agent with a simple instruction).
2. While it is running press **STOP everything** (Guardian page, the banner link, or `npm run guardian:ctl -- stop`).
3. Expected: the task ends as **"Stopped at a safe point"**. Write down: pass or fail and what the task showed.

What these do NOT prove: the real 15-minute timer (check 2 uses 1 minute), a virtual machine, a real firewall rule, or Tier B itself. Say so when you report.

## Part B: the firewall audit (about 10 minutes; needs an administrator PowerShell)
The script `scripts/security/firewall-audit.ps1` only **reads**. It prints to the screen, writes no file, changes no firewall rule, no service and no registry value. It does not read any password. The output contains program paths and your Windows user name, so look at it before you share it.

1. Click Start, type **Windows PowerShell**, right-click it, choose **Run as administrator**, accept the prompt.
2. Run: `& "C:\Users\carlou\Desktop\ai bot\scripts\security\firewall-audit.ps1"`
3. If Windows refuses to run scripts, do not change any Windows setting. Instead open the script in your editor and paste its blocks **A0 to A13 one after another** into the same window; the effect is identical.
4. Wait for it to finish. Check the first line says `Elevated: True`. If it says False, close the window and redo step 1.
5. Copy the whole output. Read it once. If a line shows something you do not want to share, remove that line and tell me what you removed.
6. Paste it to me in the chat (or save it somewhere I may read and tell me where).

## What I do with the output (steps 2 and 3)
I review it for: remote-control programs (UltraViewer or UltraVNC), "Public" profile rules that allow any port, NetBIOS or file sharing on the VMware adapters, VMware Authd and MetaTrader exposure (details: `docs/TIER-B-PLAN.md` section 4). I will report facts and options in plain words and **change nothing**. Every later step (dedicated account, firewall rules, protected Guardian install, VM) needs your separate written approval per operation, and an administrator runs it, not me.

## If something goes wrong
- The Guardian will not start or the banner stays red: see `docs/GUARDIAN.md` section 10 (Recovery). Removing `GUARDIAN_URL` and restarting the app runs without protection, so only do that on purpose.
- A check behaves differently from "Expected": do not retry many times. Write down exactly what you saw and tell me; a failure is useful evidence.
- You are unsure about anything in the audit output: do not share it; ask me first.

## What you will report (copy this)
```
Check 1 (lock):        pass / fail   banner said: ...
Check 2 (idle, 1 min): pass / fail   notes: ...
Check 3 (STOP):        pass / fail   task showed: ...
Firewall audit:        run / not run   Elevated: True/False   removed lines: none / ...
```
I will record your results (not my own) in `docs/SECURITY-AUDIT.md` and the decision board, and keep NV-8 and NV-10 as NOT VERIFIED until your real results are in.
