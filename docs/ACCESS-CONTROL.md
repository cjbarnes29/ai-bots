# Access control: application permissions and folder permissions

Specification, enforcement map, limits and verification record for decisions D-027, D-033, D-038, D-039, D-041.
Code: `src/access/` (backend), `web/src/components/access/` and `web/src/pages/Access.tsx` (dashboard, menu entry **Access**).
Last updated: 2026-11-04. Status words used here: **implemented** = code exists; **tested** = automated tests pass; **verified** = shown on the real thing with evidence. Where something is only implemented or tested, it says so.

## 1. The two questions are independent
| Question | System | Default | Stored as |
|---|---|---|---|
| May the AI use this **program**? | Application policy (`apps.ts`) | Every program is **Not approved** | `approval_settings` key `access.state` (JSON + SHA-256 checksum) |
| May the AI touch this **folder**? | Folder permissions (`folders.ts`) | **Denied** everywhere | same document |

Approving a program can never grant a file, account, credential or personal datum: the program capabilities are only `open`, `view`, `control`, `close`. There is no "files" capability, the API refuses one, and every answer from `decide()` carries `grantsDataAccess: false` (tested). Approving a folder does not approve any program (tested). `AccessService.authorizeAppFile()` needs BOTH, checked separately.

## 2. Application permission specification (D-038, D-033)
| Level | Meaning | How it is reached | Ends |
|---|---|---|---|
| **Unknown** (shown "Not approved") | Default for every program. Used only after the owner allows it **for this session**, for exactly the capabilities ticked. | Owner action "Allow for this session only" (memory only; gone on restart; 12 hours at most) | Restart, 12 h, revoke |
| **Approved** | Owner-defined capabilities, optional expiry (1-3650 days) | Owner action "Approve" | Expiry, revoke, file change |
| **Trusted** | Permanent for the ticked capabilities, **plus a mandatory review date (1-365 days)**. After the date it behaves as Unknown. Only for a program whose file names a publisher; pinned to the file's SHA-256. | Owner action "Trust" | Review date, revoke, file change |
| **Protected** | Needs a separate security policy. **None is written, so a protected program cannot be approved at all** (not even for a session) and is always refused. | Built-in rules (name, publisher, file path) | n/a |

Built-in protected classes: remote access (UltraViewer, UltraVNC, AnyDesk, TeamViewer, WinSCP, PuTTY, RDP ...), password managers and authenticators, security/system tools (Windows Security, PowerShell, cmd, Terminal, registry editor, Task Manager, "sandbox" ...), virtual-machine software (VMware, VirtualBox, Hyper-V, Docker Desktop), trading/finance (MetaTrader, wallets ...), VPN/tunnels (Tailscale, WireGuard ...). The rules err on the side of "protected": a false match only means the owner cannot approve that program yet.
Browsers, mail, chat and cloud-drive programs are **not** protected but show a plain warning (they are usually already signed in to the owner's accounts).
Rules for the owner's approvals (all tested): trusted without a signature is refused; trusted without a review date or with more than 365 days is refused; a changed program file (SHA-256) cancels the approval; an expired approval counts as Unknown; revoking is immediate and needs no passphrase.
**Not available yet:** nothing in the platform *operates* applications (no desktop-control connector exists). These permissions are the policy and records that connector must call (`AccessService.apps.decide()`); today they are enforced only by the policy API and tests.

## 3. Folder access specification
- **Default deny.** No active grant covering the path and operation = denied. A reason is returned and recorded.
- **Requester (`subject`):** `workforce` (the built-in agents: PC agent and the document writer) or `app:<application id>`. A grant for one requester is invisible to the other (tested).
- **Operations:** read, create, edit, rename, delete, each ticked separately.
- **Reach:** a grant names one folder. Without "include sub-folders" it covers that folder and the entries directly inside it, nothing deeper. With it, everything below. It never covers the parent, a sibling, another drive, or a name that merely starts the same (`proj2` vs `proj`). Windows ignores case; the comparison does too.
- **Delete and rename:** a grant can never delete or rename the approved folder itself. Deleting a *folder* needs a grant that includes sub-folders (its contents go with it).
- **Real location:** the path is resolved to its real place (junctions, symbolic links, 8.3 short names). Both the written path and the real path must be covered. `..`, network (UNC) and device paths, hidden data streams (`file:stream`), trailing dots/spaces, reserved names (`CON`, `NUL`), control characters and relative paths are refused.
- **Never approvable:** a whole drive, the Windows and Program Files folders, the user's whole profile folder or a folder containing it, and this app's own folders (project, database, vault).
- **Secrets and personal data** (SSH/GPG keys, `.env`, tokens, saved credentials, password stores, browser profiles, mail, chat data, contacts, and the hidden AppData folder): an ordinary grant **never covers them, even inside an approved folder**. They need their own grant that names the kind (the owner must confirm the kind), with an **expiry of at most 24 hours**. That grant covers only that kind.
- **Temporary grants** expire (1 minute to 365 days). The first notice of an expiry is recorded once.
- **Revoking** takes effect on the next check (state is re-read each time; there is no cache). A long job can call `stillValid(verdict)` to learn whether the approval it started with still stands. "Take back all" revokes every grant at once. Revoking never needs the passphrase and works from a paired phone (taking access away is always safe).
- **Changing** a grant (operations, sub-folders, time limit) is supported by the API (`PATCH /api/access/folders/:id`); the old and new values are recorded. The dashboard offers revoke-and-approve-again instead, to keep the screen simple.
- **Record:** every grant, change, revoke, expiry and every denial goes to the audit log (`access.folder.grant|change|revoke|revoke_all|expire|deny|allow_sensitive`, `access.app.set|session_approve|revoke|revoke_all|deny|deny_protected`, `access.discovery.scan`, `access.reset`). The Access page shows it.
- **Tamper detection:** the saved state carries a SHA-256 checksum. If it does not match, **every decision is denied** and the dashboard shows why, until the owner resets (`POST /api/access/reset`, needs the passphrase proof; clears all grants). A same-user program can recompute the checksum (limit L-A1).
- **Cap:** 50 active folder approvals.

## 4. Where it is enforced (honest map)
| Place | Enforced by | State |
|---|---|---|
| PC agent: `list_dir`, `read_file` (read), `make_dir`, `write_file` (create / edit when replacing), `delete_path` (delete, directory-aware) | `FolderGate` check inside each action, **after** approval, right before it acts | implemented + tested end to end with a real temp folder (grant, deny, revoke between approval and execution, secrets, create-vs-edit) |
| PC agent: `run_command`, `start_server`, `install_dependencies` | requires read + create + edit on the working folder | implemented + tested at unit level. **What the program then does is not controlled** (S-19) |
| Documents: every file creation (create/edit), `summarize_data` (read) | same gate | implemented; covered by the same code path (not separately tested end to end) |
| Guardian | While the Guardian is not RUN (paused, locked, stopped, unreachable) **every folder and application decision is DENY** (tested). Granting, changing and the reset are owner-only routes that need the passphrase proof; a paired phone is refused (tested). The Guardian itself takes no paths (closed command list is unchanged). | implemented + tested |
| The operating system | **Nothing.** These checks run inside the app. A program the AI runs, or a script with the same Windows account, is limited by Windows permissions, not by this module | **Not enforced at OS level.** Needs Tier B + the dedicated account / VM (`docs/TIER-B-PLAN.md`) |
| Manager AI | The Manager has no tool or route for granting; the routes are owner-only and need the proof | tested for the HTTP routes |
| Chat tab, the Business leads file, the memory notes, uploads | not routed through the folder gate (they write only to the app's own data folders) | open, low (S-18, L-A3) |

Folder enforcement is on by default in the real app (`connectors === undefined`) and opt-in in test builds (`enforceFolderGrants`). **Consequence for existing setups:** the PC agent's workspace folders (PC Control Center) no longer work by themselves. The owner must also approve the folder under **Access > Folders**. This is the requested default-deny.

## 4b. The desktop engine is the first runtime caller of the application policy
`src/desktop/engine.ts` calls `apps.decide()` with the program file's SHA-256 before launching (Open), reading (View), operating (Control) and closing (Close), on every step, so a revoke or a changed file stops the next step. Files created or opened through a program go only through the `file_dialog` step, which calls `folders.authorize()` before the Save/Open click, re-checks after, and verifies the result. Application approval still never grants files: the file dialog step asks the folder system separately. Details and the incident: `docs/DESKTOP-ENGINE.md`.

## 5. Application discovery (read-only)
- One fixed PowerShell script (constant text; nothing from outside is inserted) reads: the three Windows "installed programs" lists, running processes, services, startup entries, non-Microsoft scheduled tasks, and the publisher name embedded in each program file. The test file scans the script text and fails if it contains any command that could change something (`Start-`, `Stop-`, `Set-`, `Remove-`, `Invoke-`, `Out-File`, ...), and checks that the only `New-` is an in-memory set.
- It makes no network request. It deliberately does **not** call `Get-AuthenticodeSignature` (Windows may contact the internet to check certificate revocation). "Names a publisher in the file" means the file *claims* a publisher; the signature chain is **not verified** (S-20).
- Output per program: name, version, publisher, location, program file, publisher claim, running (process count), services, startup entries, scheduled tasks, existing integrations (the PC agent's approved developer programs), protected class, risk notes. Windows' own programs are hidden by default; Windows' own services are left out.
- Real run on this PC (2026-11-04, one scan, read-only, 16 s): 44 installed-program entries, 244 processes with a path, 307 services, 14 startup entries, 24 non-Microsoft scheduled tasks, 107 publisher reads; 124 programs after joining, 98 outside Windows, 47 of them running, 24 with a service, 9 with a startup entry, 10 with a scheduled task, 57 naming a publisher; 10 flagged protected (UltraViewer, UltraVnc, WinSCP, VMware Workstation and its USB service, MetaTrader 5, three Microsoft Defender services, and a sandbox service of an AI desktop app). Nothing was started, stopped or changed. The names are not recorded here beyond that.
- Limits: Microsoft Store apps and portable programs that are neither installed nor running can be missing; a program with a changed name can be listed twice.

## 6. API (all under `/api/access`)
| Route | Who | Proof needed |
|---|---|---|
| `GET /applications`, `GET /folders`, `GET /log` | any paired device | no |
| `POST /applications/scan` (read-only) | any paired device | no |
| `POST /folders/preview`, `POST /check` | any paired device | no (read-only; denials are recorded) |
| `PUT /applications/:id`, `POST /applications/:id/session`, `POST /folders`, `PATCH /folders/:id`, `POST /reset` | **this PC only** | **yes** (passphrase proof) when a Guardian is configured |
| `POST /applications/:id/revoke`, `POST /applications/revoke-all`, `POST /folders/:id/revoke`, `POST /folders/revoke-all` | any paired device | no (only removes access) |

## 7. Limits and unresolved risks (this module)
- **L-A1** The saved state is in the app database, editable by a program with the same Windows account; the checksum is recomputable. Tier B moves the trust anchor out of the AI account's reach (S-15).
- **L-A2** App-layer enforcement only (section 4). A command run through the PC agent, or any script, can touch what the account can touch (S-19). Mitigations that exist: the command list is closed, paths in arguments are checked against workspace folders, every run needs approval.
- **L-A3** Not every write path of the platform goes through the gate (section 4, last row).
- **L-A4** The secret-place patterns are a safety net (names and well-known folders). A secret stored under an innocent name inside an approved folder is not detected. Approve narrow folders.
- **L-A5** A grant on a folder reached through a junction is evaluated on the real location; a junction *created after* a long job started is caught on its next check only.
- **L-A6** Short-lived session approvals live in memory; after a restart they are gone (intended).
- **L-A7** There is no desktop-control connector yet, so application permissions have no runtime caller beyond the API.
- **L-A8** The check at request time (before the owner approves a write) does not look at folder grants; a doomed request can still wait for approval and then fail at execution. This is safe, only less convenient.

## 8. Test and verification record
| What | Result (2026-11-04) |
|---|---|
| `src/access/access.test.ts` | 33 tests passed: path rules, secret-place detection, default deny, one-folder reach, inheritance, the five operations, delete/rename limits, links and `..`, forbidden targets, secrets need their own grant, expiry (recorded once), revoke (including a running job), change/revoke records, Guardian hold, tamper -> deny -> reset, requester separation, preview wording; application levels, session approvals, capabilities, independence from folders, trusted rules (signature, review date, hash pin, lapse), expiry, protected programs, revoke, Guardian/tamper; discovery joining, protected flags, read-only script check |
| `src/access/access-integration.test.ts` | 10 tests passed: passphrase proof on every owner act and not on looking/revoking, a paired phone cannot grant, audit log, protected program refused over the API, PC agent default deny -> allow -> revoke, secrets still refused inside an approved folder, revoke between approval and execution, create-is-not-edit, Guardian hold |
| `web/src/access.test.tsx` | 10 tests passed: default text, preview before approval, bad path wording, secrets confirmation, one-click take-back, scan, protected has no buttons, session approval, trust needs review days |
| `npm run check` | typecheck clean; 1,278 backend + 250 dashboard tests passed; both builds succeeded |
| Real application scan on this PC | verified (section 5) |
| **NOT verified** | the Access page in a real browser (only component tests); the permission checks against a real passphrase-protected Guardian running as a separate process together with these routes (the integration test uses a fake Guardian gate; the Guardian-to-app proof path itself is covered by `guardian-integration.test.ts`); OS-level enforcement; signature chains; any operation of a desktop program |
