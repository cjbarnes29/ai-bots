# Desktop application execution engine (first version)

Code: `src/desktop/` (host script, bridge, engine, steps, connector, routes, redaction, vision interface, disposable test program), `src/access/` (permissions it reuses), `web/src/components/access/DesktopPanel.tsx`.
Status 2026-11-04: **implemented and tested** with mocked tests and with real-Windows tests on disposable windows. **Not verified:** any program other than the disposable test program and Winver; Office, Photoshop, Resolve, Premiere, browsers, VS Code. UNCOMMITTED.

## 1. What it does
A worker (through the Manager) asks for a **plan** of up to 25 steps. The owner approves the plan on the Approvals page (it lists every step; typed text appears only as a length). The engine starts the approved program itself, operates it through **Windows UI Automation**, reads it with **local Windows OCR** when controls are missing, and saves files only through the program's own file dialog after a **folder-permission check**. Each step reports which **evidence** shows it worked: `expected_state_confirmed`, `readback_confirmed`, `state_changed` (only "something changed") or `none` (performed but NOT verified). The run summary never says "confirmed" for steps without evidence.
Steps (a closed list; none takes a command, script or program path): `launch`, `wait_window`, `click`, `toggle`, `select`, `focus`, `type`, `keys`, `read`, `read_screen`, `file_dialog` (save/open), `close_window`, `release`.

## 2. Layers (all reused, none duplicated)
| Gate | Where | Checked |
|---|---|---|
| Owner approval of the plan | existing approval gate (`write` action) | once, shows every step |
| Bot permission | PC agent grants: `read` for list/inspect, `execute` for run_steps (no migration) | when asked and when approved |
| Guardian | `guardHeld()` | before every step, during waits, before the file click; PAUSE/STOP/LOCK stops at the next safe point |
| Application approval | `src/access/apps.ts` `decide()` with the program file's SHA-256 | before **every** operation: Open / View / Control / Close; a revoke applies on the next step; protected programs never |
| Folder permission | `src/access/folders.ts` | right before the Save/Open click, again after, and `stillValid()` |
| Destructive steps | `allowDestructive: true` required by the schema, shown as IRREVERSIBLE in the approval | overwrite text, replace file, discard unsaved work |

## 3. The 2026-11-04 incident and what changed
**What happened.** While probing the new UI Automation host I launched `C:\Windows\System32\notepad.exe`. On this PC that opened the owner's existing Notepad session (unsaved tabs). The throwaway probe then read the active tab, overwrote it with a test line and closed the window; the original text is not recoverable from disk, and the tab text (which looked like secrets) was printed into the session's tool output. The owner handles recovery and rotation.
**How the safeguards were bypassed (root causes).**
1. The probe called the Windows host directly. The checks that existed (application approval, process checks) lived in the engine, which did not exist yet, so nothing stood between the probe and the host.
2. The host trusted any window handle plus a matching process number. It had no notion of "a process this engine started".
3. Launching by program path is not ownership: `notepad.exe` is a redirector on this build; the window belonged to a different (Store) process that restored the user's session.
4. `tree` returned raw field contents; `setvalue` replaced non-empty fields; `close` accepted any window; screenshots could be written anywhere.
**Corrective actions (all in the host, so even a direct caller is bound):**
- **Process registry.** The host knows no window until its process was registered: the process must exist, run the exact approved file, have been started by the engine's own process (parent id), and be seconds old; its exact start time is stored and re-checked on every call (a reused number fails). A launch that hands over to another process leaves the launched process windowless: refused, nothing else touched. There is **no attach** operation at all.
- **No global view.** The host cannot list windows; `windows` returns only those of one registered process (including its owned dialogs). Every handle and every element is verified to belong to that process.
- **Redaction in the host** before output: window titles, control names and values, OCR lines (secret patterns: `src/desktop/redact.ts`); a second pass on the Node side. Password fields and fields named like secrets are never read or written; credential, security and shell programs are never registered.
- **No overwrite / no close over content** unless the plan says so explicitly and is approved: typing into a non-empty field and closing a window with editable text or an unsaved marker are refused in the host and the engine.
- **Screenshots:** only inside one private folder, only of one window (PrintWindow, not the desktop), deleted immediately after OCR (also on failure, and purged at start-up); never logged, never returned as an image.
- **Audit records** contain step kinds, outcomes and counts only: never typed text or screen text.
- **Launched programs get a cleaned environment** (no keys, tokens or Guardian settings).
- **File dialogs show the user's folders**: they are never captured, OCR'd or listed; generic click/type/keys are refused inside them (only Cancel); files go only through `file_dialog`.
- **Tests use only disposable windows** (below).

## 4. Test evidence (2026-11-04)
| Suite | Kind | Result |
|---|---|---|
| `src/desktop/engine.test.ts` | **MOCKED** (pretend Windows that follows the host's rules) | 36 passed: approvals per capability, revoke on next step, Guardian stops, handoff refused, no attach, host restart refused, clean environment, overwrite/close/password guards, evidence honesty, dialogs, file-dialog folder checks and revoke race, keys allow-list, picture deletion, audit free of content, closed plan language |
| `src/desktop/connector.test.ts` | **MOCKED** | 8 passed: list of approved programs, approval with every step visible, refusal runs nothing, evidence in the result, destructive plans rejected / marked IRREVERSIBLE, screen text withheld from cloud-model workers, missing PC permission, Guardian hold, status and record |
| `src/desktop/real-windows.test.ts` | **REAL WINDOWS** (a compiled disposable WPF test program with fake data, plus Winver) | 22 passed: UI Automation and OCR present; the incident reproduced (a separate "user" window holding fake secret-bearing unsaved work is never read, changed, listed or closed; direct host calls on it are refused; a hand-over launch is refused and the other process left alone); controls discovered; real click/toggle/type confirmed and cross-checked from outside the window; password field untouched; secrets redacted inside the host (title, field, OCR); overwrite and close refused then allowed explicitly; unexpected message box stops the run and is dismissed by a follow-up plan; screenshot + OCR (the engine reads "4711") with no picture left; keys never reach the user window; unapproved program rejected; revoke respected; Guardian pause respected; host restart refused; file saved through the real Save dialog only in an approved folder, verified on disk; outside/revoked folder refused; Winver read with OCR and closed; no network code in the engine/host |
| `src/llm/image-policy.test.ts` | mocked | 5 passed: private pictures never go to a cloud provider; pictures need vision support + policy approval; tools offered only to providers that declare them |
Real runs open windows for a few seconds and may take the keyboard focus. After the runs no test process remained.

**Update 2026-11-04 (file opening and editing).** The test program got an **Open...** button (standard Windows Open dialog, loads the file into Notes). New evidence: `engine.test.ts` 38 passed (+2: an Open-style dialog without #1001 is recognised, `inspect()` never returns its folder listing or address, listing cells cannot be read or clicked, no screen capture); `real-windows.test.ts` **25 passed** (+3, on real windows): a file is OPENED only with folder READ permission and read back through UI Automation (file unchanged); opening without READ permission or outside the approved folder is refused and the dialog left for Cancel; an existing file is EDITED (open, change, save over it) only with EDIT permission and an explicit `overwrite` in a plan marked `allowDestructive`, and the new text is verified on disk (before that: "already exists" refused, missing EDIT permission refused, original untouched). Three defects were found by these real-window runs and fixed (section 5).

## 5. Findings made while building (kept: they shape the design)
- The managed UI Automation client in Windows PowerShell 5.1 shows classic Win32 controls (message boxes, old dialogs) as unnamed panes without patterns. The host recognises them by window class (Button, Edit, Static) and clicks/writes through the process's own window handles, bounded by the same ownership checks. Old Windows Forms controls compiled without modern accessibility behave the same.
- Owned dialogs (message boxes, Save dialogs) are children of their owner in UI Automation, not top-level windows; the host lists them, skipping shadow and input-method windows.
- Dialogs appear a moment after the click; the engine waits briefly, and waits up to 4 s for a dialog the plan said to expect.
- Control positions shift while a window finishes drawing; the host re-finds a control by automation id only if exactly one control has that id, type and name.
- Store (UWP) applications run inside a frame host and are refused (the frame host is on the never-control list). Chromium/Electron applications expose little UI Automation.
- (2026-11-04, real window) The **Open** dialog keeps its file-name box under id **1148**, not 1001 like the Save dialog. The `file_dialog` open step could never find it ("does not look like a standard Save/Open dialog"). Both ids are now recognised everywhere (dialog detection, the read rule, the name box).
- (2026-11-04, real window, privacy) `inspect()` of the Open dialog returned its folder-listing cells (`System.ItemNameDisplay`, `DateModified`, `Size`), whose names are **file names** of the folder shown: the old deny-list only knew the Save dialog's layout. It is now an **allow-list**: only the file-name box (1001/1148), the type box (1136), their labels (1090/1089), Open/Save (1), Cancel (2) and Help are ever returned. Only temporary test files were exposed in the run that found it.
- (2026-11-04, real window) The "file already exists, replace it?" question of the Save dialog is owned by the Save dialog (a grandchild of the program's window) and carries the **Save dialog's title**, not "Confirm". The host listed owned dialogs one level deep, so the engine never saw it and reported "still open" (safe: nothing was replaced). The host now lists owned dialogs up to three levels deep (still only the registered process), and the engine also recognises the question by its text; it is answered only when the step says `overwrite` and EDIT permission was checked.

## 6. Limits and unresolved risks
- **Tier A gives no Windows isolation.** A program the engine starts runs as the owner. Folder checks cover what goes through the engine's file dialog step; a program that writes files by its own means is not controlled (L-D1). Only the dedicated account or the VM closes this.
- Keys are sent to the foreground window after a verified focus, re-checked immediately before; a human changing focus in that millisecond could still receive them (L-D2). Prefer UI Automation patterns; keys are supervised-only.
- OCR depends on the installed languages (en-US, en-GB here) and on PrintWindow, which can return a blank picture for GPU-drawn windows.
- The window of a program that the engine started but the user also uses is, by definition, the engine's: the engine cannot tell what the user later types into it. Sessions are meant to be short; the plan ends with `release` or `close_window`.
- `Invoke` on a control that opens a modal dialog may block in some programs; the host call times out (20 s) and the host is restarted, which makes every session untrusted by design.
- Supervised use only (D-035). Unattended operation is not allowed.

## 7. Using it
Access > Applications: scan, then Approve (Open, View, Control, Close as needed) a program. Access > Folders: approve the folder it may save to. Give the worker the PC agent permissions `read` and `execute`. Ask the Manager for the task; approve the plan on the Approvals page. Access > Desktop control shows status and the record.

## 8. Dependencies
None added. Uses Windows PowerShell 5.1 (`powershell.exe`, per-process `-ExecutionPolicy Bypass` for the one fixed script file `data/desktop/host/host.ps1`, written by the app), the built-in .NET UI Automation and WinRT OCR. The disposable test program is compiled by the C# compiler that ships with Windows into a temporary folder by the tests only.

## 9. Future local vision model (NOT installed; interface only: `src/desktop/vision.ts`, `src/llm/image-policy.ts`)
Install nothing until testing shows UI Automation and OCR are insufficient for a real task.
- **RAM (estimates, not measured here):** a 2B-4B vision model in 4-bit form needs about 3-5 GB of RAM plus the picture; a 9B about 7-9 GB; a 27B about 18 GB (Ollama lists 18 GB for the 27B file). This PC has 23.6 GB total and ~7 GB free when measured: realistically 2B-4B only, with other programs closed.
- **CPU:** no NVIDIA GPU; Intel Core 5 120U (10 cores, 12 threads). Expect several seconds per picture and a few tokens per second; an interactive multi-step flow with a model call per step will be slow. Untested here.
- **Formats:** GGUF through Ollama's OpenAI-compatible API (the existing adapter), image sent as a data URL once the picture policy approves it.
- **What it would add:** answering questions about a picture (find a button without an accessible name, read a chart). **Privacy:** the picture stays on this PC; it is the only kind of provider the policy lets receive a private picture.
- **Limits:** small models misread dense interfaces and are poor at pixel-accurate coordinates; the engine has no mouse-coordinate click by design, so a vision answer could not be acted on except through UI Automation anyway.
- **Gate:** the owner's approval to install Ollama and download a model (D-018, P-18), a licence check of the chosen model, and a trial on disposable windows first.
