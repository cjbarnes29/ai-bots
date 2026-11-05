# AI Workforce - Tier B rollback: removes ONLY what the Tier B scripts created, found by the fixed "AWP-" names
#
# STATUS: PREPARED FOR REVIEW. NOT RUN. Syntax-checked only. DRY RUN unless -Apply is given. Needs an administrator PowerShell.
# It never touches a rule, task, folder or account whose name does not start with "AWP-" (the folder is exactly C:\ProgramData\AWP-Guardian).
# The account and the Guardian's state folder (passphrase hash, journal) are only removed when you ask for it explicitly.
#
#   & ".\99-rollback.ps1"                                  # dry run: lists what exists
#   & ".\99-rollback.ps1" -Apply                           # remove the firewall rules and the scheduled task
#   & ".\99-rollback.ps1" -Apply -RemoveAccount            # also delete the AWP-AI account (and its profile folder is left for you to inspect)
#   & ".\99-rollback.ps1" -Apply -RemoveGuardianFiles      # also delete C:\ProgramData\AWP-Guardian (journal and passphrase hash are lost)
[CmdletBinding()]
param([switch]$Apply, [switch]$RemoveAccount, [switch]$RemoveGuardianFiles, [string]$AiAccount = 'AWP-AI')
$ErrorActionPreference = 'Stop'
if ($AiAccount -notlike 'AWP-*') { throw "Refusing: the account name must start with AWP-." }
$rules = @(Get-NetFirewallRule -Name 'AWP-*' -ErrorAction SilentlyContinue)
$task = Get-ScheduledTask -TaskName 'AWP-Guardian' -ErrorAction SilentlyContinue
$acct = Get-LocalUser -Name $AiAccount -ErrorAction SilentlyContinue
$folder = 'C:\ProgramData\AWP-Guardian'
"Firewall rules named AWP-* : $($rules.Count)  $(($rules | ForEach-Object Name) -join ', ')"
"Scheduled task AWP-Guardian : $([bool]$task)"
"Account $AiAccount : $([bool]$acct)  (removed only with -RemoveAccount)"
"Folder $folder : $(Test-Path $folder)  (removed only with -RemoveGuardianFiles)"
if (-not $Apply) { "DRY RUN: nothing was changed."; return }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Open Windows PowerShell as administrator first." }
foreach ($r in $rules) { Remove-NetFirewallRule -Name $r.Name; "Removed rule $($r.Name)" }
if ($task) { Stop-ScheduledTask -TaskName 'AWP-Guardian' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'AWP-Guardian' -Confirm:$false; "Removed task AWP-Guardian" }
if ($RemoveAccount -and $acct) { Remove-LocalUser -Name $AiAccount; "Removed account $AiAccount (its profile folder under C:\Users was left in place)" }
if ($RemoveGuardianFiles -and (Test-Path $folder)) { Remove-Item -Path $folder -Recurse -Force; "Removed $folder" }
"Rollback finished. Run the dry run again to confirm nothing named AWP-* is left."
