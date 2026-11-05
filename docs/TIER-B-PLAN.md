# Tier B and isolation: implementation and installation plan

**Status: PLAN ONLY. Nothing in this file has been built, installed, configured, run or verified.** Tier B, the dedicated account, the VM, the firewall rules and the in-guest test are **NOT BUILT / NOT VERIFIED** (board NV-9, NV-10). Everything here that touches Windows needs the owner's separate approval, per operation (D-037, `CLAUDE.md` section 5b). The assistant prepares text and review-only scripts; it does not run them.
Prepared review-only scripts (dry run by default, syntax-checked by the PowerShell parser only, never executed): `scripts/security/tier-b/01-create-ai-account.ps1`, `02-firewall-rules.ps1`, `03-install-guardian.ps1`, `99-rollback.ps1`.
Last updated: 2026-11-04.

## 1. Order of work (and who does what)
| Step | What | Who | State |
|---|---|---|---|
| 0 | Tier A manual checks (lock, 15-minute idle, STOP during a task): `docs/GUARDIAN.md` section 11 | **Owner, physically present** | **NOT DONE** (NV-8) |
| 1 | Run the elevated read-only firewall audit A0-A13 and share the output (`docs/SECURITY-AUDIT.md` section 1) | **Owner** (administrator PowerShell) | **NOT RUN** (NV-10) |
| 2 | Review the audit output: UltraViewer/UltraVNC, Public any-port rules, NetBIOS/file sharing, VMware Authd, MetaTrader (section 4 here) | Assistant, then owner decides | Waiting for step 1 |
| 3 | Owner approves the final design of the account, the firewall rules and the Tier B Guardian | **Owner** | Not asked yet |
| 4 | Build the Tier B Guardian bundle and the in-session presence helper (code and tests; no installation) | Assistant | Not started (needs only code, no approval for the code itself) |
| 5 | Create the dedicated standard account (`01-create-ai-account.ps1 -Apply`) | **Owner approves; administrator runs** | Not started |
| 6 | Install the protected Guardian (`03-install-guardian.ps1`), run the drills (section 3) | **Owner approves; administrator runs** | Not started |
| 7 | Add the firewall rules (`02-firewall-rules.ps1`) after the audit | **Owner approves; administrator runs** | Not started |
| 8 | Check the Windows evaluation image's terms (NV-7), then create the VM and its network (VMware) | **Owner approves each step** | Not started |
| 9 | In-guest isolation test (section 6) | Owner present; assistant prepares the commands | Not started |
| 10 | Only after steps 0-9 pass with evidence and the owner agrees in writing: unattended operation | **Owner** | **Not allowed** |

## 2. Tier B: what it is and why Tier A is not enough
Tier A runs as the owner's Windows user. A program with that same user (including anything an AI agent runs) can edit the Guardian's files, the journal, the passphrase hash, the approval database and the access records, or stop the Guardian (S-15, L-A1). Tier B puts the parts that must not be changeable **outside the AI's reach**:

| Part | Tier A (today) | Tier B (to build) |
|---|---|---|
| Guardian process | Owner's user, started by hand | **SYSTEM scheduled task** (or service) at startup, restart on failure; always starts PAUSED |
| Program files | The project folder (writable by the AI) | A **bundled copy** in `C:\ProgramData\AWP-Guardian\app`, writable only by SYSTEM and Administrators, hash recorded |
| State (passphrase hash, lease key, journal, revocation list) | `data/guardian/` (same user) | `C:\ProgramData\AWP-Guardian\state`: SYSTEM and Administrators only; the AI account cannot read or write it |
| Access records (application and folder grants) | App database, checksum only (L-A1) | The **authoritative grant list and revocation state** in the Guardian's protected state; the app holds a read-only copy and asks the Guardian to confirm (needs a new, still path-free command: "is this grant id still valid" - to be designed and reviewed, **not implemented**) |
| Presence | PowerShell helper reading lock state and the idle timer (counts synthetic input, S-17) | A **small helper in the owner's session** (logon task) that reports the lock state and genuine hardware input to the Guardian over a local channel the AI account cannot impersonate |
| Who can resume | Whoever has the passphrase (and file access) | Only someone who knows the passphrase **and** cannot change the Guardian's files; reset of the passphrase needs administrator rights |
| Process control | Stops the Manager's descendants it can find | Same closed set, plus acting on the **one** configured VM (`vmrun suspend/stop`) and enabling the **one** pre-made firewall rule |

**Fixed rules that stay (CLAUDE.md 5b):** the command list is closed; no command takes a path, a program name, a command line or a script; the Manager can never resume, unlock, stop or reconfigure it; no stored administrator credentials; no unrestricted administrator shell.
**What Tier B still cannot do:** protect against someone with administrator rights, a power cut, or a compromised host kernel. It also does not make the *file* permissions of section 3 of `docs/ACCESS-CONTROL.md` OS-enforced for a program that runs as the owner; that needs the dedicated account (section 5) or the VM (section 6).

### Tier B drills (all must pass with evidence before any autonomy)
From `docs/GUARDIAN.md` section 9: kill the Manager mid-task; freeze a guest; let the lease lapse; restart in LOCKED; a script of the AI account trying to stop the Guardian, edit its state, or overwrite the bundle (must fail with "access denied"); a script trying to read the passphrase hash; a script trying to write the grant list; reboot and confirm it comes up PAUSED.

## 3. Dedicated standard Windows account (D-036 option A)
- A local **standard** user `AWP-AI` (not in Administrators, no Microsoft account). `01-create-ai-account.ps1` shows the plan by default; with `-Apply` it asks the owner to type the password (hidden) and never stores or prints it.
- The app and any AI-run program would run as this account. Then Windows itself (NTFS permissions) stops them reaching the owner's folders, browser profile, mail and password store, which the app-level checks alone cannot do (S-19). The approved folders must then be given to the account explicitly (the setup instructions will say how; not written yet).
- **Windows Home limits (assumption, board T-assumptions):** no AppLocker, so no per-account program allow-list; a second account's background session may not allow reliable screen capture or UI automation. If it does not, the VM (section 6) is the route for desktop work.
- Rollback: `99-rollback.ps1 -Apply -RemoveAccount` (the profile folder is left for inspection).

## 4. Security review items (D-040 steps 2, 3, 5, 6): what is known and what is waiting
All findings stay **open** until the audit output exists. Nothing below is a conclusion.
| Item | Known now (read-only inspection, no administrator rights) | Waiting for | Likely action (needs owner approval) |
|---|---|---|---|
| **UltraViewer** (S-16) | `UltraViewer_Service` is set to start automatically; discovery flags it Protected; it is a remote-control tool, so an unattended-access setting would let an outsider control the PC. Its settings were deliberately not read. | A10/A11 audit blocks, and the owner checking the program's own settings (unattended access, password) | Prefer: set the service to Manual or uninstall when not needed. Do not leave it running during unattended operation. |
| **UltraVNC** (S-14, S-16) | Not running; an inbound allow rule for any port on the **Public** profile exists | A10/A11/A13 | Remove or restrict that rule (scope to Private + a named remote address) or uninstall |
| **Public-profile any-port program rules** (S-14) | 93 enabled inbound program allow rules; Node.js, UltraVNC and adb have any-port Public rules. An agent-run Node script that opens a port may be reachable from a VM or the network | A2/A13 (full rule list, including port ranges) | Replace with port-specific, Private-only rules or delete the unused ones; the new rules would be listed in a reviewed script |
| **Host-to-VM restrictions** | VMware NAT has no inbound port forwards; the two VMware adapters appear in no network-profile listing (assumed Public, not proven) | A2/A5/A6 | `02-firewall-rules.ps1` (block rules named `AWP-*`) after the subnets are confirmed |
| **NetBIOS and file sharing** | Port 139 is bound to both VMware adapter addresses; 135/139/445 listen locally; no enabled rule opening 139/445 was found by text search (port-range rules unreadable without administrator rights) | A7/A8 | Unbind "File and Printer Sharing" and NetBIOS from the two VMware adapters (Windows adapter settings), or block 139/445 from the VM subnets |
| **VMware Authd** | Listens on 902/912 on all addresses; allowed on Private and Domain profiles | A5/A13 | If the VMware adapters are Private, a guest could reach it: block from the VM subnets (`AWP-VM-To-Host-Block-In`) |
| **MetaTrader tester agents** | Listen on 0.0.0.0:2000-2009; allowed on Domain/Private. MetaTrader is flagged Protected (it can move money) | A5/A13 | Same block rule; do not give the AI or the VM any route to it; consider closing the tester agents when not testing |

## 5. VMware isolation architecture (design; nothing created)
- **One guest** for desktop work, running the Windows evaluation image **after** its terms are checked (NV-7). No VM exists. Resource plan must be re-checked against the machine at that time (T-8: 23.6 GB RAM, 7.2 GB free when inspected; e.g. 4 vCPU / 8 GB / 60 GB disk is a starting proposal, **not approved**).
- **Network:** a dedicated virtual network (`vmnetN`) used by this guest only; NAT type so the guest reaches the internet but nothing on the LAN is routed to it; **no bridged networking**. The host-side VMware adapter for that network gets File and Printer Sharing / NetBIOS unbound, and the `AWP-VM-To-Host-Block-In` rule applies to its subnet.
- **Disabled integrations:** shared folders, drag and drop, copy and paste, USB passthrough, shared clipboard, the host's printers, VMware Tools "unity" mode. Verified by reading the `.vmx` file (review item, not yet possible).
- **Guest firewall:** default-deny inbound; outbound allow-list is a later decision. Guest has no host credentials, no cloud-drive login, no browser profile of the owner, and no personal files (S-11, S-12).
- **File exchange:** a one-way queue folder for hand-offs, designed later; no live shared folder.
- **Emergency stop of the VM:** the Guardian's `vmrun suspend` on the one configured `.vmx` (`vmrun.exe` exists, T-12; behaviour untested), and the pre-made `AWP-VM-Lockdown-Out` rule enabled at STOP.
- **Snapshots:** a clean snapshot after setup; every AI session starts from it or is reviewed before keeping.

## 6. In-guest isolation test (prepared as a plan; needs a VM, so NOT possible yet)
Run inside the guest, owner present, recording the exact output in `docs/SECURITY-AUDIT.md`. Each line is "expected: fails / unreachable" unless stated.
1. From the guest, try the host's addresses on: 135, 139, 445 (SMB), 902, 912 (Authd), 2000-2009 (MetaTrader), 3000 (the app), 3100 (the Guardian), 5173, 3389 (RDP), 5900 (VNC), plus the UltraViewer port. Use `Test-NetConnection -ComputerName <host-ip> -Port <p>`. **Expected: every one fails.**
2. From the guest, open `\\<host-ip>\C$` and `\\<host-ip>\IPC$`. **Expected: fails.**
3. From the guest, reach other devices on the LAN (router, phone, other PCs) by ping and by TCP. **Expected: fails** (NAT network only).
4. From the guest, reach the internet (an approved test address chosen by the owner). **Expected: works** (or fails if the owner later chooses a stricter network).
5. In the guest: copy/paste, drag and drop, shared folder, USB attach. **Expected: unavailable.**
6. From the host: press STOP on the Guardian and confirm the guest is suspended and the lockdown rule is enabled; resume and confirm it reverses only after the owner's passphrase.
7. From the host: confirm nothing from the guest appears in the app's folders, the database or the vault.
Any "unexpected success" is a finding; the VM is not used until it is closed.

## 7. Installation, recovery and rollback summary
| Situation | What to do |
|---|---|
| Before any Tier B step | Take a safety copy of the project (a local Git tag or a folder copy) and of `data/`. Read the dry run of the script you will run. |
| Roll back everything Tier B added | `99-rollback.ps1` (dry run first), then `-Apply`; add `-RemoveAccount` / `-RemoveGuardianFiles` only on purpose. It only touches names starting `AWP-` and the exact folder `C:\ProgramData\AWP-Guardian`. |
| Tier B Guardian will not start | The app holds everything (fails closed). Boot, then check the scheduled task `AWP-Guardian` history. Administrator can run it by hand from the protected folder. As a last resort remove `GUARDIAN_URL` from `.env` to run the app unprotected, supervised, at your own risk. |
| Forgot the passphrase | Tier B: an administrator stops the task, deletes `state\passphrase.json`, restarts, sets a new one with the CLI (the journal records it). |
| Firewall rule locks you out | Remove it with `Remove-NetFirewallRule -Name 'AWP-*'` or the rollback script (local console only; nothing here changes remote-access rules). |
| VM misbehaves | Guardian STOP; if that fails, close VMware from Task Manager; delete the VM from the snapshot. |

## 8. Administrator-dependent steps (nothing was done)
Create the account; create firewall rules; unbind NetBIOS/file sharing from the VMware adapters; install the Guardian task; create the protected folder and its permissions; create the VMware network; create the VM; change or remove any existing firewall rule or remote-access program. **Each needs the owner's separate approval and the owner's own UAC approval.** No stored administrator credentials exist or will be created.
