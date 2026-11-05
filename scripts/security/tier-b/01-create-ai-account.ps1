# AI Workforce - Tier B step 1: create the dedicated STANDARD Windows account for the AI (D-036 option A)
#
# STATUS: PREPARED FOR REVIEW. NOT RUN. Syntax-checked only. Running it needs the owner's separate approval (D-037) and an administrator PowerShell.
#
# Default behaviour is a DRY RUN: it only prints what it would do. Nothing changes unless you pass -Apply.
# It never stores or prints a password. With -Apply it asks YOU to type the new account's password (hidden input) and hands it straight
# to Windows. The account is a plain standard user: it is NOT added to Administrators, and no administrator password is used or kept anywhere.
#
#   & ".\01-create-ai-account.ps1"                 # dry run
#   & ".\01-create-ai-account.ps1" -Apply          # really create it (administrator PowerShell, your own UAC approval)
#
# Undo: 99-rollback.ps1 -RemoveAccount
[CmdletBinding()]
param(
  [switch]$Apply,
  [ValidatePattern('^AWP-[A-Za-z0-9]{2,12}$')][string]$Name = 'AWP-AI'
)
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"Account name : $Name   (the AWP- prefix is what the rollback script looks for)"
"Type         : local STANDARD user (no administrator rights, no Microsoft account, password never expires = no, change at first logon = no)"
"Elevated now : $isAdmin"
if (Get-LocalUser -Name $Name -ErrorAction SilentlyContinue) { "The account already exists. Nothing to do."; return }
if (-not $Apply) {
  "DRY RUN: would run  New-LocalUser -Name $Name -Password <typed by you> -AccountNeverExpires:`$false -UserMayNotChangePassword:`$false"
  "DRY RUN: would run  Add-LocalGroupMember -Group Users -Member $Name   (standard users only; NOT Administrators)"
  "Nothing was changed. Re-run with -Apply to create the account."
  return
}
if (-not $isAdmin) { throw "Open Windows PowerShell as administrator first (right click > Run as administrator)." }
$pw = Read-Host -AsSecureString "Choose a password for $Name (it is not saved anywhere by this script)"
$pw2 = Read-Host -AsSecureString "Type it again"
$a = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
$b = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw2))
if ($a -ne $b -or $a.Length -lt 14) { $a = $null; $b = $null; throw "The two passwords differ or are shorter than 14 characters. Nothing was created." }
$a = $null; $b = $null
New-LocalUser -Name $Name -Password $pw -Description 'AI Workforce dedicated standard account (see docs/TIER-B-PLAN.md)' -AccountNeverExpires | Out-Null
Add-LocalGroupMember -Group 'Users' -Member $Name
"Created the standard account $Name. It is not an administrator. Verify with:  Get-LocalGroupMember -Group Administrators   (it must NOT be listed)"
