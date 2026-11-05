# AI Workforce - Tier B step 2: fixed-name firewall rules that keep a VM away from this PC
#
# STATUS: PREPARED FOR REVIEW. NOT RUN. Syntax-checked only. It must NOT be run before the owner has run and shared the firewall audit
# (scripts/security/firewall-audit.ps1, A0-A13) and approved the final design, because the right subnets and exceptions depend on that output.
#
# Default behaviour is a DRY RUN that prints the rules it would add. Nothing changes unless you pass -Apply (administrator PowerShell).
# Every rule is named with the fixed prefix "AWP-" so the rollback script can remove exactly these and nothing else. No existing rule is changed or removed.
#
# What the rules do:
#   AWP-VM-To-Host-Block-In   BLOCK inbound traffic whose source is a VM subnet (so a guest cannot reach MetaTrader, VMware Authd, file sharing, any
#                             program the host listens with). Block rules win over allow rules in Windows Firewall.
#   AWP-VM-Lockdown-Out       BLOCK outbound traffic to the VM subnets. Created DISABLED. The Guardian's pre-made-rule adapter enables it at STOP/LOCKDOWN.
# What they do NOT do: restrict what the guest reaches on the internet or on your LAN. That is set by the VMware network type (NAT or host-only
# on the vmnet you create) and by the guest's own firewall (docs/TIER-B-PLAN.md section 5). The host firewall is not the guest's boundary.
#
#   & ".\02-firewall-rules.ps1" -VmSubnets 192.168.109.0/24,192.168.86.0/24             # dry run
#   & ".\02-firewall-rules.ps1" -VmSubnets 192.168.109.0/24,192.168.86.0/24 -Apply      # add the rules
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$')][string[]]$VmSubnets,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$rules = @(
  @{ Name = 'AWP-VM-To-Host-Block-In'; Direction = 'Inbound';  Enabled = 'True';  Remote = $VmSubnets; Note = 'blocks the VM subnets from reaching this PC' },
  @{ Name = 'AWP-VM-Lockdown-Out';     Direction = 'Outbound'; Enabled = 'False'; Remote = $VmSubnets; Note = 'created disabled; the Guardian enables it at STOP' }
)
foreach ($r in $rules) { "{0,-26} {1,-8} enabled={2,-5} remote={3}   ({4})" -f $r.Name, $r.Direction, $r.Enabled, ($r.Remote -join ','), $r.Note }
if (-not $Apply) { "DRY RUN: nothing was changed. Re-run with -Apply from an administrator PowerShell to add these rules."; return }
if (-not $isAdmin) { throw "Open Windows PowerShell as administrator first." }
foreach ($r in $rules) {
  if (Get-NetFirewallRule -Name $r.Name -ErrorAction SilentlyContinue) { "$($r.Name) already exists; left as it is."; continue }
  New-NetFirewallRule -Name $r.Name -DisplayName $r.Name -Direction $r.Direction -Action Block -Profile Any -RemoteAddress $r.Remote -Enabled $r.Enabled -Description 'AI Workforce VM isolation (docs/TIER-B-PLAN.md). Safe to remove with 99-rollback.ps1.' | Out-Null
  "Added $($r.Name)"
}
"Verify:  Get-NetFirewallRule -Name 'AWP-*' | Format-Table Name,Enabled,Direction,Action"
