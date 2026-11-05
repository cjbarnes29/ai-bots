# AI Workforce - elevated READ-ONLY firewall and network audit (A0-A13)
#
# STATUS: PREPARED, NOT RUN. The project owner decides whether and when to run it. See docs/SECURITY-AUDIT.md.
#
# What it does: it only READS. It prints to the screen and writes NOTHING: no files, no exported rules, no transcript, no registry
# values, no firewall changes, no service changes. There is no Set-/New-/Remove-/Enable-/Disable- command on the system in it.
# The only "Set-" line (A0) changes PowerShell's own history setting for this window, so the commands you ran are not saved.
#
# How to run (you decide): open "Windows PowerShell" as administrator (right click > Run as administrator, approve the UAC prompt), then
#   & "C:\Users\carlou\Desktop\ai bot\scripts\security\firewall-audit.ps1"
# If Windows refuses to run scripts, paste the blocks A0 to A13 one after another instead (same effect, nothing to change in Windows).
# Look at the output before sharing it: it contains program paths and your user name, but it does not read any password
# (the UltraVNC password setting and the UltraViewer settings are deliberately NOT read).

# ---------------------------------------------------------------- A0 preamble
$ErrorActionPreference = 'Continue'; $ProgressPreference = 'SilentlyContinue'; $FormatEnumerationLimit = -1
try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch { }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"A0  Elevated: $isAdmin   PowerShell: $($PSVersionTable.PSVersion)   Time: $(Get-Date -Format s)"
if (-not $isAdmin) { "WARNING: not elevated. Some blocks (A2 onward) will be incomplete. Close this window and open it as administrator." }

# ---------------------------------------------------------------- A1 effective profile defaults
"`n=== A1 firewall profiles (effective) ==="
Get-NetFirewallProfile -PolicyStore ActiveStore | Format-List Name,Enabled,DefaultInboundAction,DefaultOutboundAction,AllowInboundRules,AllowLocalFirewallRules,AllowLocalIPsecRules,NotifyOnListen,LogAllowed,LogBlocked,LogFileName,LogMaxSizeKilobytes
netsh advfirewall show global
netsh advfirewall monitor show currentprofile

# ---------------------------------------------------------------- A2 load every rule and filter (no output except a count)
$ps = 'ActiveStore'
$rules = Get-NetFirewallRule -PolicyStore $ps
$f = @{}
foreach ($kind in 'Port','Address','Application','Service','Interface','InterfaceType','Security') {
  $f[$kind] = @{}
  & "Get-NetFirewall${kind}Filter" -PolicyStore $ps -All | ForEach-Object { $f[$kind][$_.InstanceID] = $_ }
}
$flat = foreach ($r in $rules) {
  $id = $r.InstanceID
  [pscustomobject]@{
    Name = $r.DisplayName; Enabled = [string]$r.Enabled; Dir = [string]$r.Direction; Action = [string]$r.Action; Profile = [string]$r.Profile
    Proto = [string]$f.Port[$id].Protocol; LPort = ($f.Port[$id].LocalPort -join ','); RPort = ($f.Port[$id].RemotePort -join ',')
    LAddr = ($f.Address[$id].LocalAddress -join ','); RAddr = ($f.Address[$id].RemoteAddress -join ',')
    Program = [string]$f.Application[$id].Program; Service = [string]$f.Service[$id].Service
    IfAlias = ($f.Interface[$id].InterfaceAlias -join ','); IfType = [string]$f.InterfaceType[$id].InterfaceType
    OverrideBlock = [string]$f.Security[$id].OverrideBlockRules; Group = $r.DisplayGroup; Store = [string]$r.PolicyStoreSourceType
  }
}
"`nA2  Rules loaded: $(@($flat).Count)"

# ---------------------------------------------------------------- A3 helpers (no output)
$procs = @{}; Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }
$svcByPid = @{}; Get-CimInstance Win32_Service | Where-Object { $_.ProcessId } | ForEach-Object { $svcByPid[[int]$_.ProcessId] += @($_.Name) }
function Test-PortSpec([string]$spec, [int]$p) {
  if ([string]::IsNullOrWhiteSpace($spec) -or $spec -eq 'Any') { return $true }
  foreach ($t in ($spec -split ',')) {
    $t = $t.Trim()
    if ($t -match '^(\d+)-(\d+)$') { if ($p -ge [int]$Matches[1] -and $p -le [int]$Matches[2]) { return $true } }
    elseif ($t -match '^\d+$') { if ([int]$t -eq $p) { return $true } }
    elseif ($t -eq 'RPCEPMap' -and $p -eq 135) { return $true }
    elseif ($t -eq 'RPC' -and $p -ge 49152) { return $true }
  }
  return $false
}

# ---------------------------------------------------------------- A4 summaries and the full dump
"`n=== A4 rule summary ==="
$flat | Group-Object Enabled,Dir,Action | Sort-Object Name | Format-Table Count,Name -AutoSize
"--- enabled BLOCK rules ---"
$flat | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' } | Format-Table Name,Dir,Profile,Program,LPort,RAddr -AutoSize -Wrap
"--- enabled rules that override block rules ---"
$flat | Where-Object { $_.Enabled -eq 'True' -and $_.OverrideBlock -eq 'True' } | Format-Table Name,Dir,Action,Profile -AutoSize -Wrap
"--- disabled rules (count by group, top 25) ---"
$flat | Where-Object { $_.Enabled -ne 'True' } | Group-Object Group | Sort-Object Count -Descending | Select-Object -First 25 | Format-Table Count,Name -AutoSize
"--- ALL enabled rules (long: hundreds of lines) ---"
$flat | Where-Object { $_.Enabled -eq 'True' } | Sort-Object Dir,Action,Name | Format-Table Dir,Action,Profile,Name,Proto,LPort,RPort,LAddr,RAddr,Program,Service,IfAlias,IfType -AutoSize -Wrap | Out-String -Width 4096

# ---------------------------------------------------------------- A5 port-by-port exposure
"`n=== A5 which enabled inbound rules could let traffic reach these ports (port ranges included) ==="
foreach ($p in 135,139,445,902,912,2000,2009,3000,3100) {
  "`n--- TCP $p ---"
  $l = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Addr=$_.LocalAddress; Pid=$_.OwningProcess; Path=$procs[[int]$_.OwningProcess].ExecutablePath; Svc=($svcByPid[[int]$_.OwningProcess] -join ';') } }
  if (-not $l) { 'No listener'; continue }
  $l | Format-Table -AutoSize -Wrap
  $paths = @($l.Path | Where-Object { $_ }); $svcs = @($l.Svc -split ';' | Where-Object { $_ })
  $flat | Where-Object { $_.Enabled -eq 'True' -and $_.Dir -eq 'Inbound' -and $_.Proto -in 'TCP','6','Any' -and (Test-PortSpec $_.LPort $p) -and ( ((-not $_.Program -or $_.Program -eq 'Any') -and -not $_.Service) -or ($_.Program -and $paths -contains $_.Program) -or ($_.Service -and $svcs -contains $_.Service) ) } | Sort-Object Action,Profile | Format-Table Action,Profile,Name,Program,Service,LAddr,RAddr,IfAlias -AutoSize -Wrap
}

# ---------------------------------------------------------------- A6 network categories and adapters
"`n=== A6 adapters and network categories (Category: 0 = Public, 1 = Private, 2 = Domain) ==="
Get-NetAdapter -IncludeHidden | Format-Table Name,InterfaceDescription,Status,ifIndex,InterfaceGuid -AutoSize -Wrap
Get-NetConnectionProfile | Format-Table InterfaceAlias,InterfaceIndex,Name,NetworkCategory,IPv4Connectivity -AutoSize
"--- stored network profiles ---"
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles' | ForEach-Object { $p = Get-ItemProperty $_.PSPath; [pscustomobject]@{ Profile=$p.ProfileName; Category=$p.Category; Managed=$p.Managed } } | Format-Table -AutoSize
"--- unmanaged network signatures ---"
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Signatures\Unmanaged' -ErrorAction SilentlyContinue | ForEach-Object { $s = Get-ItemProperty $_.PSPath; [pscustomobject]@{ Description=$s.Description; DnsSuffix=$s.DnsSuffix; ProfileGuid=$s.ProfileGuid } } | Format-Table -AutoSize -Wrap

# ---------------------------------------------------------------- A7 adapter bindings (ms_server = File and Printer Sharing)
"`n=== A7 adapter bindings ==="
Get-NetAdapterBinding -IncludeHidden | Where-Object { $_.ComponentID -in 'ms_server','ms_msclient','ms_tcpip','ms_tcpip6' } | Sort-Object Name | Format-Table Name,DisplayName,ComponentID,Enabled -AutoSize

# ---------------------------------------------------------------- A8 NetBIOS
"`n=== A8 NetBIOS (0 = use DHCP setting, 1 = on, 2 = off) ==="
Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object IPEnabled | Format-Table Description,IPAddress,TcpipNetbiosOptions,DHCPEnabled,WINSPrimaryServer -AutoSize -Wrap
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Services\NetBT\Parameters\Interfaces' | ForEach-Object { $p = Get-ItemProperty $_.PSPath; [pscustomobject]@{ Interface=$_.PSChildName; NetbiosOptions=$p.NetbiosOptions; DhcpNetbiosOptions=$p.DhcpNetbiosOptions } } | Format-Table -AutoSize
nbtstat -n

# ---------------------------------------------------------------- A9 listeners
"`n=== A9 listening ports (TCP, all) and UDP (not loopback) ==="
Get-NetTCPConnection -State Listen | Sort-Object LocalPort | ForEach-Object { $pr = $procs[[int]$_.OwningProcess]; [pscustomobject]@{ Proto='TCP'; Addr=$_.LocalAddress; Port=$_.LocalPort; Pid=$_.OwningProcess; Process=$pr.Name; Path=$pr.ExecutablePath; Services=($svcByPid[[int]$_.OwningProcess] -join ';') } } | Format-Table -AutoSize -Wrap
Get-NetUDPEndpoint | Where-Object { $_.LocalAddress -notin '127.0.0.1','::1' } | Sort-Object LocalPort | ForEach-Object { $pr = $procs[[int]$_.OwningProcess]; [pscustomobject]@{ Proto='UDP'; Addr=$_.LocalAddress; Port=$_.LocalPort; Pid=$_.OwningProcess; Process=$pr.Name; Path=$pr.ExecutablePath; Services=($svcByPid[[int]$_.OwningProcess] -join ';') } } | Format-Table -AutoSize -Wrap

# ---------------------------------------------------------------- A10 services
"`n=== A10 services: Server, UltraViewer, UltraVNC, VMware ==="
Get-CimInstance Win32_Service | Where-Object { $_.Name -match '^(LanmanServer|LanmanWorkstation|lmhosts|UltraView|uvnc|winvnc|VMware|VMnet|VMAuthd|VMUSB|vmware)' -or $_.DisplayName -match 'UltraView|UltraVNC|VNC|VMware' } | Sort-Object Name | Format-Table Name,DisplayName,State,StartMode,StartName,ProcessId,PathName -AutoSize -Wrap

# ---------------------------------------------------------------- A11 UltraViewer / UltraVNC (no passwords read)
"`n=== A11 UltraViewer and UltraVNC (allow-listed settings only; no password setting is read) ==="
foreach ($d in 'C:\Program Files\UltraViewer','C:\Program Files (x86)\UltraViewer','C:\Program Files\uvnc bvba\UltraVNC','C:\Program Files (x86)\uvnc bvba\UltraVNC') { if (Test-Path $d) { "== $d"; Get-ChildItem $d -File | Format-Table Name,Length,LastWriteTime -AutoSize } }
$ini = 'C:\Program Files\uvnc bvba\UltraVNC\ultravnc.ini'
if (Test-Path $ini) { "== ultravnc.ini (allow-listed settings only)"; Get-Content $ini | Where-Object { $_ -match '^\s*(PortNumber|AutoPortSelect|AllowLoopback|LoopbackOnly|AuthRequired|HTTPConnect|QuerySetting|QueryAccept|QueryTimeout|FileTransferEnabled|UseRegistry|AuthHosts|MSLogonRequired|NewMSLogon|AllowShutdown)\s*=' } }
Get-ScheduledTask | Where-Object { $_.TaskName -match 'UltraView|UltraVNC|uvnc' -or $_.TaskPath -match 'UltraView|UltraVNC' } | Format-Table TaskPath,TaskName,State -AutoSize
foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run') { $p = Get-ItemProperty $k -ErrorAction SilentlyContinue; if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -match 'UltraView|UltraVNC|uvnc|winvnc|MetaTrader|VMware' } | ForEach-Object { "{0}: {1} = {2}" -f $k,$_.Name,$_.Value } } }
$uv = Get-Process | Where-Object { $_.ProcessName -match 'UltraViewer|winvnc|uvnc' }
if ($uv) { $uv | Format-Table Id,ProcessName,Path -AutoSize; Get-NetTCPConnection -OwningProcess $uv.Id -ErrorAction SilentlyContinue | Format-Table LocalAddress,LocalPort,RemoteAddress,RemotePort,State -AutoSize } else { 'No UltraViewer/UltraVNC process running' }

# ---------------------------------------------------------------- A12 VMware configuration
"`n=== A12 VMware NAT configuration and virtual-network settings ==="
"--- vmnetnat.conf (non-comment lines) ---"
Get-Content 'C:\ProgramData\VMware\vmnetnat.conf' -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() }
"--- VMnetLib registry ---"
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\VMware, Inc.\VMnetLib\VMnetConfig\*' -ErrorAction SilentlyContinue | Format-List *

# ---------------------------------------------------------------- A13 targeted views
"`n=== A13 rules naming MetaTrader, VMware Authd, VNC, UltraViewer, Node, adb ==="
$flat | Where-Object { $_.Program -match 'metatester|MetaTrader|vmware-authd|winvnc|vncviewer|UltraViewer|node\.exe|adb\.exe' } | Sort-Object Name | Format-Table Enabled,Dir,Action,Profile,Name,Proto,LPort,RAddr,Program -AutoSize -Wrap
"--- PUBLIC / ANY-profile inbound allow rules with a program and no port limit (security plan step 3 list) ---"
$flat | Where-Object { $_.Enabled -eq 'True' -and $_.Dir -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Profile -match 'Public|Any' -and (-not $_.LPort -or $_.LPort -eq 'Any') -and $_.Program -and $_.Program -ne 'Any' -and $_.Program -notmatch '^(C:\\Windows|System)' } | Sort-Object Program | Format-Table Name,Profile,Proto,Program,RAddr -AutoSize -Wrap
"`nAUDIT COMPLETE - nothing was changed."
