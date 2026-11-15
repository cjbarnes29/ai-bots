# Security audit and findings register

Plain record of what was checked, what was NOT, and what is still open. Decisions: `docs/DECISION-BOARD.md`. The Guardian: `docs/GUARDIAN.md`.
Labels: **[C]** confirmed by inspection or test, **[A]** assumption, **[R]** recommendation, **[U]** unresolved or not verified.

## Synthetic recovery evidence (2026-11-15, D-089)
**[C]** Nine new scratch-database recovery cases passed, with three existing backup tests: schema/logical content, integrity/foreign keys, application links/search, restored constraints, pending approval identity and synthetic key matching. Wrong synthetic key cannot decrypt; damaged/empty candidates fail the required acceptance checks. Test-only copies, no owner database/key read, no production restore endpoint or permission change. **[U]** Actual owner backup/key, whole-installation restore, full app restart, abrupt power loss, concurrent key rotation and remote-action reconciliation remain unverified. Exact procedure/results: `BACKUP-RESTORE-REHEARSAL.md`. Existing firewall/Tier B items remain unchanged.

## 1. The elevated read-only firewall audit (A0 to A13)
**STATUS: PREPARED, NOT RUN.** It needs an administrator PowerShell, and only the owner runs it. Nothing below in section 3 that depends on it may be called finished.

- Script for review: `scripts/security/firewall-audit.ps1`. It reads only (no file, no export, no transcript, no registry write, no firewall or service change).
  Checked by the PowerShell parser: no syntax errors; the only non-reading verbs are `Out-String` (formats text) and `Set-PSReadLineOption` (stops this window saving command history).
- To run it (your decision): open Windows PowerShell as administrator, approve the UAC prompt, and run
  `& "C:\Users\carlou\Desktop\ai bot\scripts\security\firewall-audit.ps1"`. If Windows refuses scripts, paste the blocks one after another.
- It does NOT read UltraVNC's password setting or UltraViewer's settings. Review the output before sharing it (it shows program paths and your user name).

| Block | Reads | Why | Admin |
|---|---|---|---|
| A0 | your token, PowerShell version | confirm it is elevated | no |
| A1 | effective firewall profiles, global options, current profile | real inbound default, logging | no (fuller elevated) |
| A2 | every rule and its port, address, program, service, interface, security filters | the complete rule picture, port ranges included | **yes** |
| A3 | process and service tables | map ports to programs | no |
| A4 | rule summaries, block rules, override-block rules, full enabled list | all inbound and outbound rules | no (uses A2) |
| A5 | listeners and matching rules for 135, 139, 445, 902, 912, 2000, 2009, 3000, 3100 | can the VM reach these ports? | no |
| A6 | adapters, network categories (registry) | are the VMware adapters Public, Private or unidentified? | no |
| A7 | adapter bindings (File and Printer Sharing) | does a VMware adapter expose file sharing? | usually no |
| A8 | NetBIOS settings and local names | NetBIOS on the VMware adapters | no |
| A9 | all listening TCP, non-loopback UDP, owners, paths | listener inventory | paths fuller elevated |
| A10 | Server, UltraViewer, UltraVNC, VMware services | state, startup, account, command line | no |
| A11 | UltraViewer/UltraVNC files, allow-listed UltraVNC settings, tasks, Run entries, sockets | step 2: unattended access? | no |
| A12 | VMware NAT config, VMnetLib registry | NAT port forwards, host adapter settings | no |
| A13 | rules naming MetaTrader, VMware Authd, VNC, UltraViewer, Node, adb; Public any-port program rules | steps 3 and 6 | no |

**When you have the output:** give it to the assistant. It will finalize sections 2 and 3, review UltraViewer/UltraVNC (step 2), the Public any-port rules (step 3),
NetBIOS/file sharing (step 5), MetaTrader and VMware Authd (step 6), and design host-to-VM restrictions (step 4) as a script **for your review** (not run).

## 1b. Application discovery run (read-only, 2026-11-04)
One scan of this PC with the fixed read-only script (`src/access/discovery.ts`; `docs/ACCESS-CONTROL.md` section 5). It found UltraViewer (with an auto-start service and a startup entry), UltraVnc, WinSCP, VMware Workstation, MetaTrader 5 and three Microsoft Defender services and classed them Protected. It confirms what S-16 said; it adds no firewall evidence and does not replace the elevated audit. Nothing was started, stopped or changed.

## 1c. INCIDENT 2026-11-04: desktop probe overwrote an unsaved Notepad tab (corrected, verified on disposable windows)
**Impact.** While probing the first UI Automation host, a throwaway script launched `C:\Windows\System32\notepad.exe`, which on this PC opened the owner's existing Notepad session. The script read the active tab, overwrote it with a test line, and closed the window. The original unsaved text is not on disk (Notepad's tab-state files were checked by yes/no content tests only) and was printed into the session's tool output, so any key-looking strings in it should be treated as exposed to that transcript (rotate if real). The screenshot the probe took was deleted. The owner handles recovery; the assistant was told never to open, read or modify Notepad or the owner's windows, and did not touch them again.
**Root causes** (details in `docs/DESKTOP-ENGINE.md` section 3): a direct probe with no engine checks; a host that trusted any window handle with a matching process number; launching by path mistaken for ownership (a redirector stub started a different, session-restoring process); raw contents returned; overwrite and close allowed on any window; screenshots written anywhere.
**Corrective actions:** process registry in the Windows host (proof of the exact program file, the engine as parent, seconds-old start, start time re-checked on every call); no attach operation; no global window list; every handle and element verified to belong to the registered process; redaction inside the host; password and secret-named fields never read or written; overwrite and close-over-content refused unless explicitly authorised in an owner-approved destructive plan; private screenshot folder with immediate deletion; file dialogs never captured; cleaned environment for launched programs; credential/security/shell programs never registered; every operation re-checks Guardian, application approval (file fingerprint) and, for files, folder permissions.
**Evidence.** `src/desktop/real-windows.test.ts`, 22 tests on REAL windows of a disposable program (and Winver) including a reproduction: a separate "user" window with fake secret-bearing unsaved work is never read, changed, listed or closed, direct host attacks on it are refused, a hand-over launch is refused with the other process untouched. Mocked tests (clearly separate): `engine.test.ts`, `connector.test.ts`. All passed on 2026-11-04.
**Status: corrected and verified on disposable windows only. NOT verified on any real application beyond Winver. The owner's recovery of the lost tab is outside this audit.** Residual: Tier A gives no Windows isolation (S-19); foreground-focus race for keys (L-D2); programs that write files by their own means (L-D1).

## 2. Security plan order (D-040) and status
| # | Step | Status |
|---|---|---|
| 1 | Elevated read-only firewall audit | **Prepared, NOT RUN** (owner runs it) |
| 2 | Review UltraViewer and UltraVNC | Waiting for A10/A11 output |
| 3 | Review Public-profile any-port program rules | Waiting for A13 output |
| 4 | Design host-to-VM network restrictions | Design and a review-only rule script written (`scripts/security/tier-b/02-firewall-rules.ps1`, NOT RUN); waiting for A2/A5/A6 to confirm the subnets |
| 5 | Review NetBIOS and file sharing on the VMware adapters | Waiting for A7/A8 |
| 6 | Review MetaTrader and VMware Authd exposure | Waiting for A5/A13 |
| 7 | In-guest connectivity test | Test plan written (`docs/TIER-B-PLAN.md` section 6). **Not possible: no VM exists** (VM creation needs separate approval) |

## 3. Findings
### Confirmed [C]
- Ports 135, 139 and 445 are open locally; 139 is bound to both VMware adapter addresses (192.168.86.1, 192.168.109.1). No enabled inbound rule opening 139/445 was found by text search; port-range rules could not be read without administrator rights.
- VMware NAT has no inbound port forwards. The two VMware adapters appear in no network profile listing.
- 93 enabled inbound program allow rules exist; Node.js, UltraVNC and adb have any-port rules for the Public profile.
- `UltraViewer_Service` runs at startup. UltraVNC (`winvnc`) is not running. MetaTrader tester agents listen on 0.0.0.0 ports 2000-2009. VMware Authd listens on 902/912 on all addresses (allowed on Private and Domain only).
- `vmrun.exe` exists (VMware Workstation 17.5.0). No VM exists. Hardware: see board T-8.
- Before the Guardian, anything on this PC sending the dashboard header was treated as the owner (S-13). A test pins this ("TODAY, with no Guardian configured…").

### Assumptions [A]
- Windows blocks inbound traffic that no rule allows (profiles show NotConfigured).
- The unlisted VMware adapters are treated as Public. If they are Private, a guest could reach MetaTrader and Authd.
- Windows Home has no per-account application allowlist feature (AppLocker), so the access gate is the only application control.
- A background session on Windows Home may not allow reliable screen capture or UI automation (Option A account viability).

### Not verified [U]
- Everything the audit would show; what a guest can reach; the real lock-screen and 15-minute behaviour of the Guardian; Tier B; `vmrun` suspend/stop behaviour; any firewall rule design; the Windows evaluation image's licence (NV-7).

## 4. Findings register (open items)

S-29 provenance proposal (D-097, planning only): `REPLY-PROVENANCE-PLAN.md` specifies origin-labelled ranges and atomic task/event binding rather than trusting a text heading, with strict unknown/legacy/truncation handling. It is NOT implemented and does not close RV-3. Hash binding is not protection against a same-user database attacker; no new secret, grant, migration or boundary change is proposed. Resume state saved in HANDOVER.

D-096 UI follow-up: approval mutation IDs/payloads/authorization remain unchanged. New focus handling explicitly yields to owner proof; controls/counts are not hidden in read-only folds. Synthetic browser checks observe no writes on opening/cancelling and one fake effect after one confirmation. Evidence/actual full-check outcome and limits: `DASHBOARD-APPROVALS.md`. This does not verify a real passphrase-protected Guardian/browser setup or close existing isolation findings.

S-29 implementation follow-up (D-093): exact task-bound action/object matching and unknown-effect ceiling now implemented with source-owned metadata; no execute/authorize/FolderGate/Guardian boundary changed. Evidence, fake tests and final checks: `EXACT-ACTION-MATCHING.md`. RV-3 trusted text boundary and target/content/remote-receipt proof remain open. Earlier D-090/D-092 assessment records are historical, not current claims that action matching is still unimplemented.

S-29 exact-action follow-up: D-092 saved `EXACT-ACTION-MATCHING-PLAN.md`, specifying source-owned operation/object declarations and conservative unknown effects. Planning only; does not close the remaining action/provenance findings or change a permission. No application/test change or live-service evidence from that checkpoint.
| ID | Finding | State |
|---|---|---|
| S-29 | Result confirmation can overstate evidence scope: connector-only claim matching, ignored failed chain members and a model-supplied platform separator | **Scoped task records addressed D-091/D-093/D-098; Manager helper view D-099; bounded workflow task/approval view D-101 implemented.** Shared D-088 binding and existing action observations retained; workflow Manager refs stay unbound with zero inherited evidence, and all final summaries remain unverified. Missing/ambiguous/unlinked/incomplete/skipped/uncertain receipts and unreadable files cannot yield a fully confirmed workflow supporting verdict. Actual full/fake/browser results: `WORKFLOW-RESULT-CHECKS.md` and earlier reports. Exact workflow→Manager backlinks, durable read receipts, targets/content/delivery/semantic/final-claim proof remain OPEN. Legacy/invalid/mixed/incomplete task origins stay unverified. No permission/approval/Guardian boundary change, real-provider or same-user tamper protection claim (S-15 unchanged). |
| S-13 | Local requests count as the owner (a script can approve its own requests) | **Fixed when `GUARDIAN_URL` is set and the Guardian runs** (tested). **Open when no Guardian is configured**: the dashboard says so. A same-user script can still stop a Tier A Guardian. |
| S-14 | Public any-port program allow rules (Node.js, UltraVNC, adb, others) defeat the default block | **Open** (audit step 3) |
| S-15 | Tier A integrity: a same-user process can edit the approval database, the journal and the Guardian's files | **Open by design until Tier B**; documented in the product |
| S-16 (replaces S-10) | `UltraViewer_Service` runs at startup; UltraVNC has an any-port Public rule but is not running; MetaTrader 2000-2009 and VMware Authd listen on all addresses | **Open** (audit steps 2 and 6) |
| S-17 | Idle timer counts synthetic input (agent keyboard automation in the owner's session) | **Open** (L-1, Tier B helper) |
| S-18 | Interactive chat is not gated by the Guardian | **Open, low** (needs the owner at the keyboard; L-6) |
| S-19 | Folder permissions are enforced inside the app only; a command run through the PC agent, or any same-account script, can touch what the Windows account can | **Open** (closed by Tier B + dedicated account or VM; `docs/ACCESS-CONTROL.md` section 4) |
| S-20 | Discovery reads the publisher name embedded in a program file but does not verify the certificate chain (it could contact the internet) | **Open** (NV-12) |
| S-21 | Access records are editable by a same-account program; the checksum is recomputable (L-A1) | **Open until Tier B** |
| S-23 | Desktop probe overwrote the owner's unsaved Notepad tab and echoed its text (2026-11-04) | **Corrected and verified on disposable windows** (section 1c). Recovery and any key rotation are the owner's. |
| S-24 | Programs the desktop engine starts run as the owner (Tier A) and can write files by their own means; keys have a millisecond focus race | **Open** (docs/DESKTOP-ENGINE.md section 6) |
| S-25 | `inspect()` of a Windows **Open** dialog returned the folder listing (file names, sizes, dates) of the folder it showed: the filter was a deny-list written for the Save dialog (found on a real window 2026-11-04; only temporary test files were exposed) | **Fixed 2026-11-04**: allow-list of file-dialog controls; mocked test proves no listing, address or file name is returned and listing cells cannot be read or clicked (docs/DESKTOP-ENGINE.md section 5) |
| T-12 (replaces T-11) | `vmrun.exe` exists; suspend/stop behaviour untested | **Partly resolved** |
| S-28 | New approval insertion and workflow-reference persistence were separate writes | **Atomic existing-table binding implemented 2026-11-15 (D-088):** gate validation remains, same-connection insert/link/audits commit together and notify after commit; stale CAS rolls back the losing request and preserves winner. Cold-start approved/no-receipt remains uncertain, never resent. Synthetic scratch-file reopen/fault evidence and final check: `docs/ATOMIC-APPROVAL-LINKAGE.md`. No real crash/power-loss or exactly-once remote claim; legacy orphan matching and distributed workers not provided. |
| S-27 | Route-only capability assessment missed internally launched tasks and Manager runs | **Covered at execution entry, fake-tested 2026-11-15 (D-086):** common task hook includes children, schedules/triggers, groups, decisions and specialist/workflow tasks; internal Manager planning has its own hook. Best-effort state is root/run-local and grants nothing. Keyword matching is not an authorization boundary; direct chat/Manager self-step text are not separately assessed. Full evidence/limits: `docs/EXECUTION-ASSESSMENT.md`. |
| S-26 | A restart between outside-action request creation and workflow reference persistence could replay it; an upstream retry could reset a protected descendant | **Fixed conservatively, fake-tested 2026-11-15 (D-085):** running integration steps fail as uncertain on recovery; retry checks every affected descendant before resetting. 16 new in-memory regression cases; targeted workflow suites 70/70. No new live crash drill or exactly-once remote guarantee. Durable correlation remains future work. See `docs/WORKFLOW-RESTART-SAFETY.md` for full-check results and the development watcher observation. |
