# The Guardian (emergency stop, pause and owner proof)

Specification, setup, recovery and honest limits. Decisions behind it: `docs/DECISION-BOARD.md` (D-023, D-028 to D-040).
Everything here is **Tier A**. **Tier B is NOT BUILT** (section 9).

## 1. What it is, in one paragraph
A separate small program (`src/guardian/`) that sits beside the app and can say "stop" without asking the Manager or any agent. It has its own
port, its own files and its own log. While it is not in the **RUN** state, the app starts no task, no retry, no schedule and no approved outside
action, and tasks that are already running stop at their next safe point. It pauses by itself when your Windows session is locked or when you
have not touched the keyboard or mouse for 15 minutes. Only you, with your passphrase, can resume it. It also gives you a 10-minute "decision
window" so that approving things, saving keys and changing safety settings need your passphrase, which a script running on your PC does not know.

## 2. Status (read this first)
| Part | State |
|---|---|
| State machine, closed command set, journal, passphrase, leases | **Built and tested** (35 unit tests) |
| Stopping programs the Manager started (and nothing else) | **Built; tested with fakes and with real harmless programs** |
| Presence: lock and 15 minutes without input | **Built; the helper reading was tested. The real lock screen and real 15 minutes have NOT been tested by anyone yet** (section 8) |
| App checks (tasks, schedules, workflows, approvals, owner-only changes) | **Built and tested** (10 integration tests) |
| Dashboard banner and passphrase prompt | **Built and tested** (9 tests) |
| VM stop (`vmrun`) and network block (firewall rule) | **Code written, tested with fake runners only. NOT VERIFIED: no VM exists and no firewall rule was created** |
| Tier A protection against a hostile script of the same Windows user | **Not provided.** Detection only (section 7) |
| **Tier B** (system-level, fixed commands, protected trust anchor) | **NOT BUILT. NOT VERIFIED** |
| Unattended operation | **Not allowed** until Tier B is built, verified and you approve (D-030) |

## 3. Architecture
```
 you ── Guardian page (http://127.0.0.1:3100)  /  npm run guardian:ctl  /  dashboard banner
            │  STOP, PAUSE: no passphrase.  RESUME, UNLOCK, PROOF: passphrase.
            ▼
 ┌───────────────────────── GUARDIAN (own process, own port, own folder data/guardian) ─────────────────────────┐
 │ state: RUN | PAUSED | STOPPED | LOCKED     journal.jsonl (hash chain)     passphrase.json (salted scrypt)     │
 │ presence monitor (lock + idle)             process scan (descendants of the Manager)     lease key            │
 └──────┬──────────────────────────┬───────────────────────────────┬────────────────────────────────────────────┘
        │ GET /v1/status (2 s)     │ kills descendants of the Manager │ (future) vmrun suspend/stop, firewall rule on
        ▼                          ▼                                  ▼
   the app (Manager)        programs it started                  the VM  (NOT VERIFIED)
   GuardianLink: held()? / checkProof(token)?   (cannot resume, unlock, stop or change the Guardian)
```
The app never imports the Guardian's code to control it, and the Guardian never imports the app. The only thing the app can do is **look** and
**check a proof token**. It fails closed: if the Guardian stops answering for 10 seconds, nothing new starts.

## 4. States and commands
| State | Meaning | How you get out |
|---|---|---|
| RUN | May run | pause / stop / lockdown (no passphrase) |
| PAUSED | Nothing new starts. Running tasks stop at their next safe point. | `resume` (passphrase) |
| STOPPED | PAUSED + programs the Manager started are ended + VM suspended (if configured) + network blocked (if configured) | `resume` (passphrase) |
| LOCKED | STOPPED + VM shut down (soft, then hard) | `unlock` (passphrase) then `resume` (passphrase) |

After **every** start the Guardian is PAUSED: only you can say the AI Workforce may run.

The command list is closed (`src/guardian/core.ts`): `status`, `pause`, `stop`, `lockdown`, `resume`, `unlock`, `proof`, `check_proof`, `lease`.
Nothing takes a program name, a path or a script. Anything else is refused with 400. The only free text it ever accepts is your passphrase.

## 5. Pause rules (D-035)
- **Session lock** pauses immediately. **15 minutes without input** pauses (`GUARDIAN_IDLE_MINUTES`, default 15).
- A pause blocks new tasks, retries, leases and scheduled runs. Coming back does not undo it: **you** resume, with the passphrase.
- Watching from a phone counts as autonomous: the phone can look and can pause, nothing more.
- If the presence monitor stops working for more than a minute, the Guardian pauses (fails closed). `GUARDIAN_PRESENCE=off` switches presence
  off for development; it is journaled and shown in the dashboard as "Presence monitoring is OFF".
- Existing automations (schedules, triggers, workflows) obey the same pause as soon as `GUARDIAN_URL` is set. Without a Guardian they run as before.

What the app does when held (`src/delegation/engine.ts`, `src/automation/service.ts`, `src/approvals/service.ts`, `src/app.ts`):
| Thing | While not RUN |
|---|---|
| New task (chat-started task, schedule, trigger, Manager, workflow step) | refused: 409 `guardian_paused` |
| Task already running | stops at its next safe point (before the next model call, delegation or outside action) and is marked failed with `guardian_paused` |
| Schedules and workflow schedules | skipped, not counted as failures |
| Approving a waiting request | refused; the request stays pending |
| Interactive chat in the Chat tab | **not gated** (it needs you at the keyboard; limitation L-6) |

## 6. Owner proof (blocker A, S-13)
**The problem (confirmed in the code):** on this PC any request with Host `127.0.0.1` and the header `x-awp-client: dashboard` is treated as the
owner (`src/remote/access.ts`). A script run through the PC agent can send exactly that. A test (`src/guardian-integration.test.ts`) shows it:
without a Guardian such a request approves an approval and the outside action runs.

**The fix (when `GUARDIAN_URL` is set):** the owner-only changes need a second thing a script does not have, your passphrase:
1. You type the passphrase in the dashboard dialog. It goes **straight to the Guardian**, never to the app.
2. The Guardian answers with a random token valid for **10 minutes** and only while RUN. A pause, stop, lock or restart ends every window.
3. The dashboard sends the token in the header `x-awp-proof`. The app asks the Guardian "is this token valid?" and refuses with 403
   `proof_required` if not (failures are written to the audit log).
4. The token lives only in the page's memory (not in a cookie, localStorage or a file).

Needs the proof (from this PC): approving a request, all owner-only routes (vault, bot permissions, PC permissions, integrations, limits, routing,
skills, workflows, pairing codes, the Business outside-requests lock) and switching a pause back **on**.
Never needs it: pausing, stopping, denying, reading.
Phone requests are unchanged: they already need a paired device and cannot reach owner-only routes.

**Residual weakness (Tier A):** a script of your Windows user can still read `data/guardian/` (including the lease key) and edit the approval
database. It cannot learn the passphrase from those files (only a salted hash is stored), so it cannot obtain a proof, but it could stop the
Guardian process. See section 7.

## 7. Tier A is limited (B, S-15) — read before relying on it
Tier A runs as **your** Windows user, like the agents' scripts. Therefore:
- A hostile script can kill the Guardian, read its files and rewrite its journal and state **with a fresh, valid-looking chain**. The journal
  detects accidents and careless edits only (this is tested and documented in `guardian.test.ts`).
- Leases and proof checks are real, but the lease key is readable by the same user.
- **Use Tier A for development and supervised testing only (D-029):** you are at the PC, watching, able to press STOP.

## 8. Setup (Windows, step by step)
Needs: Node 24 (already installed), this project's packages (`npm run install:all`). No new packages, no admin rights, no settings changes.

1. **Set the passphrase** (once). In a terminal in the project folder: `npm run guardian:passphrase`. Type 12+ characters (a few unrelated words),
   twice. Only a salted hash is saved in `data/guardian/passphrase.json`. Do **this before** you let any agent run, and never store the passphrase
   in the project folder, the vault or any file an agent can read.
2. **Start the Guardian** in its own terminal: `npm run guardian`. It prints its port (3100), its state (PAUSED) and whether the passphrase is set.
3. **Tell the app about it:** add `GUARDIAN_URL=http://127.0.0.1:3100` to `.env` (create the file if it does not exist). Restart the app
   (`npm run dev:all`). The dashboard banner turns red ("Paused") until you resume.
4. **Resume:** open http://127.0.0.1:3100 (or click the link in the banner), type the passphrase, press **Resume**. The banner turns green.
5. **Normal day:** start the Guardian first, then the app. Press **STOP everything** (Guardian page, banner link, or `npm run guardian:ctl -- stop`)
   whenever you want everything to stop.

Settings (environment variables or `.env`; all optional):
| Variable | Default | Meaning |
|---|---|---|
| `GUARDIAN_URL` (app) | unset | Puts the app under the Guardian. Unset = app behaves as before and shows "Guardian not set up". |
| `GUARDIAN_PORT` | 3100 | Guardian's port on 127.0.0.1 |
| `GUARDIAN_DIR` | `data/guardian` | Its files (git-ignored) |
| `GUARDIAN_APP_PORT` | `PORT` or 3000 | Used to find the Manager's process (it must be `node.exe`) |
| `GUARDIAN_ORIGINS` | localhost/127.0.0.1 on 3000 and 5173 | Dashboard addresses allowed to send the passphrase to the Guardian |
| `GUARDIAN_IDLE_MINUTES` | 15 | Minutes without input before PAUSE |
| `GUARDIAN_PRESENCE` | on | `off` = development only, logged and shown |
| `GUARDIAN_VMRUN`, `GUARDIAN_VMX` | unset | The ONE VM to suspend/stop. **Do not set until a VM exists and you approve.** |
| `GUARDIAN_FIREWALL_RULE` | unset | A pre-made block rule to switch on at STOP. **Needs administrator and an approved rule. Do not set yet.** |

Command line: `npm run guardian:ctl -- status | pause | stop | lockdown | resume | unlock | journal` (resume and unlock ask for the passphrase hidden).

## 9. Tier B (NOT BUILT — what must exist before unattended operation)
Required by D-030 and the blockers in `docs/SECURITY-AUDIT.md`. Nothing below is built or verified. The detailed plan, the review-only install/account/firewall/rollback scripts and the isolation test plan are in `docs/TIER-B-PLAN.md` and `scripts/security/tier-b/` (prepared, NOT RUN). The folder and application permissions (`docs/ACCESS-CONTROL.md`) use the Guardian in two ways: every decision is denied while the Guardian is not RUN, and granting or changing anything needs the owner proof; the Guardian itself still takes no paths.
1. A **fixed-command, system-level Guardian** (a Windows service or SYSTEM scheduled task) with exactly the commands in section 4 plus the VM/firewall actions
   on the one configured VM and the one pre-made rule. No command takes a path, command line or script.
2. The **trust anchor, revocation state, passphrase hash, lease key and journal** in a folder only SYSTEM and Administrators can write; the AI's account has no write access.
3. A **small helper in your own session** that reads lock state and real (non-injected) input, because a system service cannot read your session.
   This also closes the "synthetic input resets the idle timer" gap (L-1).
4. A **dedicated standard Windows account** for the AI (D-036 option A) and the firewall rules from the audit (host-to-VM restrictions).
5. Installation needs **administrator rights** (separate, per-operation approval from you: D-037). Scripts will be prepared for review and not run.
6. **Drills before any autonomy:** kill the Manager mid-task, freeze a guest, let the lease lapse, restart in LOCKED, a script trying to stop the Guardian.

## 9b. The desktop engine and the Guardian
The desktop engine (`docs/DESKTOP-ENGINE.md`) checks `held()` before every step, during every wait, and again immediately before a file dialog's Save/Open click: PAUSE, STOP, LOCK or an unreachable Guardian stop it at the next safe point and the remaining steps are not run. The Windows host and every program the engine started are descendants of the app, so a Guardian STOP that ends the Manager's descendants ends them too (unsaved work in a program the engine started can be lost; plans end with `close_window` or `release`). The Guardian still takes no paths, programs or commands; it cannot resume or reconfigure the engine. Tested: real-Windows "stops at the next step boundary when the Guardian pauses" and mocked equivalents.

## 10. Recovery
| Situation | What to do |
|---|---|
| Forgot the passphrase | Stop the Guardian (Ctrl+C). Delete `data/guardian/passphrase.json`. Run `npm run guardian:passphrase`. (Tier A: anyone with file access can do this, which is exactly the Tier A limit. In Tier B this needs administrator rights.) |
| Guardian crashed / not responding | The app holds everything (fails closed). Start it again (`npm run guardian`); it comes up PAUSED; resume with the passphrase. To run without it: remove `GUARDIAN_URL` and restart the app (you then lose the protections). |
| Banner says "Paused" and you are at the PC | Open the Guardian page and press Resume (it pauses at lock, after 15 minutes idle, and after every restart) |
| Wrong passphrase 5 times | 15-minute lockout. Wait, or restart the Guardian |
| Journal says "chain broken" | `npm run guardian:ctl -- journal` shows where. Treat as a sign something edited the file. Keep a copy; start a new journal by moving `journal.jsonl` aside |
| A program the AI started will not stop | Task Manager > Details > end the `node.exe` children of the app. The Guardian does not kill the app itself |
| Manual emergency (no software helps) | Close the terminals, or press Ctrl+C in the app and Guardian terminals; sign out or restart Windows |

## 11. Tests and how to run them
```
npx vitest run src/guardian                  # Guardian unit tests (fakes) + real-Windows tests (harmless programs it starts itself)
npx vitest run src/guardian-integration.test.ts   # the app + a real Guardian server (fake processes)
npm --prefix web test -- guardian             # dashboard banner and passphrase dialog
npm run check                                 # everything
```
What the tests prove: 35 Guardian tests (states, passphrase, lockout, windows expire at exactly 10 minutes, idle limit boundary 14:59 / 15:00, STOP kills only descendants,
reused process numbers, journal tamper detection and its documented blind spot, closed command set, CORS and Host/Origin checks), 10 integration tests (impersonation
without and with a Guardian, proof expiry, safe-point stop, schedules skipped, approval held, fail closed), 9 dashboard tests, 3 real-Windows tests.
What they do NOT prove: the real lock screen, the real 15 minutes, a real VM, a real firewall rule, Tier B.

**Manual checks only you can do (record the results in `docs/SECURITY-AUDIT.md`):**
1. Lock Windows (Win+L) for a moment with the Guardian running in RUN. Unlock. The banner must say Paused, reason "session locked".
2. Start the Guardian with `GUARDIAN_IDLE_MINUTES=1`, resume, leave the keyboard and mouse alone for 1 minute: it must pause.
3. Press STOP while a task is running: the task must end as "Stopped at a safe point".

## 12. Known limitations
- **L-1** Windows' idle timer also counts input that a program sends (for example agent keyboard automation in your own session). Only a helper counting real hardware input fixes this (Tier B).
- **L-2** Lock is detected by the lock-screen program (LogonUI.exe) running. Untested on a real lock.
- **L-3** A program that started and lost its parent between two scans (about 5 seconds) can be missed. The Manager itself is paused, not killed.
- **L-4** The Guardian finds the Manager as the `node.exe` listening on the app port. If you run the app differently, set `GUARDIAN_APP_PORT`.
- **L-5** Tier A is not protection against a determined same-user attacker (section 7).
- **L-6** Interactive chat is not gated.
- **L-7** The decision window is one 10-minute window per passphrase entry (not per approval). A pause ends it.
- **L-8** Journal rotation exists (5 MB) but is untested at that size.
- **L-9** The Guardian page and the dashboard dialog talk over plain HTTP on 127.0.0.1. Other processes on this PC can see that traffic only with administrator rights.
