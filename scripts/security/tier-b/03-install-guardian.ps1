# AI Workforce - Tier B step 3: install the system-level Guardian from a PROTECTED copy
#
# STATUS: PREPARED FOR REVIEW. NOT RUN. NOT FINISHED: the Tier B Guardian build (a single bundled file with no dependencies on writable folders) and the
# in-session presence helper do not exist yet (board NV-9). This script shows the intended install so the owner can review the design. It is a DRY RUN
# unless -Apply is given, and -Apply refuses to continue until -BundleDir points at a finished, reviewed bundle.
#
# Why a protected copy: a SYSTEM task that runs code from a folder the AI account can write would let the AI run anything as SYSTEM. So the Guardian is
# copied to C:\ProgramData\AWP-Guardian\app, where only SYSTEM and Administrators can write, and the task runs only that copy. The AI account gets
# read/execute on the program folder and NO write access anywhere in the Guardian's folders. Its state (passphrase hash, journal, lease key) lives in
# C:\ProgramData\AWP-Guardian\state, readable and writable by SYSTEM and Administrators only; the AI account cannot even read it.
#
#   & ".\03-install-guardian.ps1"                                   # dry run: prints the plan
#   & ".\03-install-guardian.ps1" -BundleDir <reviewed bundle> -Apply
[CmdletBinding()]
param(
  [string]$BundleDir,
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$AiAccount = 'AWP-AI',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\AWP-Guardian'
$appDir = Join-Path $root 'app'
$stateDir = Join-Path $root 'state'
$task = 'AWP-Guardian'
"Plan:"
"  1. create $appDir and $stateDir"
"  2. ACL on $root : SYSTEM and Administrators = Full; $AiAccount = Read+Execute on app only; NO inheritance from ProgramData; $stateDir not readable by $AiAccount"
"  3. copy the reviewed bundle from -BundleDir into $appDir and record its SHA-256 in $stateDir\bundle.sha256"
"  4. scheduled task '$task': at startup, run as SYSTEM, '$NodeExe' '$appDir\guardian.js', environment GUARDIAN_DIR=$stateDir ; restart on failure"
"  5. (separate, later) the presence helper: a task in the OWNER's session at logon that reports lock state and real hardware input to the Guardian"
if (-not $Apply) { "DRY RUN: nothing was changed."; return }
if (-not $BundleDir -or -not (Test-Path (Join-Path $BundleDir 'guardian.js'))) { throw "No finished bundle: -BundleDir must contain guardian.js. The Tier B build does not exist yet (NV-9). Nothing was changed." }
if (-not (Test-Path $NodeExe)) { throw "Node not found at $NodeExe." }
if (-not (Get-LocalUser -Name $AiAccount -ErrorAction SilentlyContinue)) { throw "The account $AiAccount does not exist (run 01-create-ai-account.ps1 first)." }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Open Windows PowerShell as administrator first." }
New-Item -ItemType Directory -Force -Path $appDir, $stateDir | Out-Null
icacls $root /inheritance:r | Out-Null
icacls $root /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
icacls $appDir /grant:r "${AiAccount}:(OI)(CI)RX" | Out-Null
Copy-Item -Path (Join-Path $BundleDir '*') -Destination $appDir -Recurse -Force
(Get-FileHash (Join-Path $appDir 'guardian.js') -Algorithm SHA256).Hash | Set-Content -Path (Join-Path $stateDir 'bundle.sha256')
$action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$appDir\guardian.js`"" -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'AI Workforce Guardian (Tier B). Remove with 99-rollback.ps1.' | Out-Null
"Installed task $task. It starts at the next boot; the Guardian always starts PAUSED. Verify with the drills in docs/GUARDIAN.md section 9."
