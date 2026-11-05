import { patternsForPowerShell } from "./redact.js";

/**
 * The fixed Windows side of the desktop engine: ONE constant PowerShell program that runs as a long-lived child of the app and answers a closed set
 * of JSON requests (one per line on stdin, one JSON answer per line on stdout). Nothing from a request is ever evaluated as code: every operation is a
 * hard-coded branch and request values are only data. There is no dynamic code evaluation, no dynamic command, no network access, and no way to start a
 * program or a shell from here (programs are started by the Node side, from the approved application list only).
 *
 * SAFETY MODEL (rewritten after the 2026-11-04 incident, docs/SECURITY-AUDIT.md):
 *  1. REGISTRY. The host knows no window until its process was REGISTERED: the caller names a process it launched itself; the host proves that the
 *     process exists, runs the named program file, was started by the caller's own process and started moments ago, and remembers its exact start
 *     time. Every later request must name a registered process whose identity still matches (a reused process number fails).
 *  2. NO GLOBAL VIEW. There is no "list all windows". "windows" returns only the windows of one registered process, so the host cannot even see the
 *     user's other windows. A window handle is accepted only if its owner is that registered process; every element is checked the same way.
 *  3. REDACTION INSIDE THE HOST. Names, values, titles and OCR text pass through the secret patterns BEFORE they are written to stdout.
 *     Password fields (and fields named like secrets) are never read and never written.
 *  4. NO OVERWRITE WITHOUT SAY-SO. Typing into a field that already holds text is refused unless the request says overwrite, and closing a window that
 *     looks like it holds unsaved work is refused unless the request says discard.
 *  5. FILES. Screenshots are written, and images read for OCR, only inside the one private folder given by "init" (and the Node side deletes them).
 *  6. KEYS only after the target window is verified to be in the foreground, re-checked immediately before sending.
 *  7. Every walk is bounded in depth, count and time.
 */
export const HOST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, UIAutomationClientsideProviders, System.Drawing, System.Windows.Forms, System.Runtime.WindowsRuntime
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class AwpWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public static string GetText(IntPtr h) { int n = GetWindowTextLength(h); StringBuilder sb = new StringBuilder(n + 2); SendMessage(h, 0x0D, (IntPtr)(n + 1), sb); return sb.ToString(); }
  public static uint PidOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static string Shot(IntPtr h, string path, out int w, out int ht) {
    w = 0; ht = 0; RECT r;
    if (!GetWindowRect(h, out r)) return "The window rectangle could not be read.";
    w = r.Right - r.Left; ht = r.Bottom - r.Top;
    if (w < 8 || ht < 8 || w > 8000 || ht > 8000) return "The window size is not capturable (" + w + "x" + ht + ").";
    using (Bitmap bmp = new Bitmap(w, ht, PixelFormat.Format32bppArgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) {
        IntPtr dc = g.GetHdc();
        bool ok = PrintWindow(h, dc, 2);
        g.ReleaseHdc(dc);
        if (!ok) return "Windows refused to draw this window into an image.";
      }
      bmp.Save(path, ImageFormat.Png);
    }
    return null;
  }
}
"@
[void][AwpWin]::SetProcessDPIAware()
# Classic Windows controls (message boxes, Win32 dialogs, old Windows Forms) are only understood through the client-side providers; without them every such control is an unnamed Pane.
try {
  $provAsm = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq 'UIAutomationClientsideProviders' }
  $provTable = $provAsm.GetType('UIAutomationClientsideProviders.UIAutomationClientSideProviders').GetField('ClientSideProviderDescriptionTable').GetValue($null)
  [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders($provTable)
} catch { }
$UIA = [System.Windows.Automation.AutomationElement]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$MAX_DEPTH = 9; $MAX_NODES = 300; $MAX_MS = 6000
$SECRET_RES = @(__PATTERNS__ | ForEach-Object { New-Object System.Text.RegularExpressions.Regex($_, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) })
$SECRET_NAME = New-Object System.Text.RegularExpressions.Regex('password|passwd|passphrase|\bpin\b|secret|token|api[ _-]?key|credential|security code|cvv|cvc', 'IgnoreCase')
$NEVER_EXE = @('consent.exe', 'logonui.exe', 'credentialuibroker.exe', 'winlogon.exe', 'lsass.exe', 'csrss.exe', 'services.exe', 'svchost.exe', 'taskmgr.exe', 'regedit.exe', 'mmc.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'wt.exe', 'conhost.exe', 'explorer.exe', 'applicationframehost.exe', 'systemsettings.exe', 'securityhealthsystray.exe')
$script:privDir = $null
$script:reg = @{}
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1' })[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(20000)) { throw 'The Windows OCR engine did not answer in time.' }
  return $t.Result
}
function Reply($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 12)); [Console]::Out.Flush() }
function Fail($id, $msg) { Reply @{ id = $id; ok = $false; error = [string]$msg } }
function Redact($s) { if ($null -eq $s) { return $null }; $t = [string]$s; foreach ($r in $SECRET_RES) { $t = $r.Replace($t, '[redacted]') }; return $t }
function Safe($s, $n) { if ($null -eq $s) { return $null }; $t = Redact $s; if ($t.Length -gt $n) { return $t.Substring(0, $n) }; return $t }
function Rect($e) { try { $r = $e.Current.BoundingRectangle; if ($r.IsEmpty -or [double]::IsInfinity($r.X)) { return $null }; return @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) } catch { return $null } }
function RawType($e) { try { return $e.Current.ControlType.ProgrammaticName -replace '^ControlType.', '' } catch { return 'Unknown' } }
# Classic Win32 controls (message boxes, old dialogs) appear as bare panes in this UI Automation client. They are recognised by their window class,
# and only when the window belongs to the process that owns the element, so the engine can still read and operate the dialogs of a program it launched.
function W32($e) {
  try {
    if ((RawType $e) -ne 'Pane') { return $null }
    $cur = $e.Current; $h = [int64]$cur.NativeWindowHandle
    if ($h -eq 0) { return $null }
    if ([int][AwpWin]::PidOf([IntPtr]$h) -ne [int]$cur.ProcessId) { return $null }
    $cls = [string]$cur.ClassName; $style = [AwpWin]::GetWindowLong([IntPtr]$h, -16)
    if ($cls -eq 'Button') {
      $k = $style -band 0xF
      $t = 'Button'; if ($k -in 2, 3, 5, 6) { $t = 'CheckBox' } elseif ($k -in 4, 9) { $t = 'RadioButton' } elseif ($k -eq 7) { $t = 'Group' }
      return @{ type = $t; hwnd = $h; kind = 'button'; password = $false }
    }
    if ($cls -eq 'Edit') { return @{ type = 'Edit'; hwnd = $h; kind = 'edit'; password = (($style -band 0x20) -ne 0) } }
    if ($cls -eq 'Static') { return @{ type = 'Text'; hwnd = $h; kind = 'static'; password = $false } }
  } catch { }
  return $null
}
function TypeName($e) { $w = W32 $e; if ($w) { return $w.type }; return (RawType $e) }
function InPrivDir($p) {
  if (-not $script:privDir) { throw 'The private folder has not been set.' }
  $full = [System.IO.Path]::GetFullPath([string]$p); $root = [System.IO.Path]::GetFullPath($script:privDir).TrimEnd('\') + '\'
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Images may only be written or read in the private folder.' }
  return $full
}
function Registered($procId) {
  $key = [string][int]$procId
  if (-not $script:reg.ContainsKey($key)) { throw 'That process is not registered. The desktop engine controls only programs it started itself.' }
  $entry = $script:reg[$key]
  try { $p = [System.Diagnostics.Process]::GetProcessById([int]$procId) } catch { $script:reg.Remove($key); throw 'That program has ended.' }
  if ($p.StartTime.ToUniversalTime().Ticks -ne $entry.ticks) { $script:reg.Remove($key); throw 'The identity of that process changed (its number was reused). Refusing.' }
  return $entry
}
function WindowOf($h, $procId) {
  [void](Registered $procId)
  $handle = [IntPtr][int64]$h
  if (-not [AwpWin]::IsWindow($handle)) { throw 'That window no longer exists.' }
  if ([int][AwpWin]::PidOf($handle) -ne [int]$procId) { throw 'That window does not belong to the registered program. Refusing.' }
  $e = $UIA::FromHandle($handle)
  if ([int]$e.Current.ProcessId -ne [int]$procId) { throw 'That window does not belong to the registered program. Refusing.' }
  return $e
}
function ResolvePath($win, $path, $procId) {
  $e = $win
  if ($path -ne '' -and $null -ne $path) {
    foreach ($part in ([string]$path).Split('.')) {
      $i = [int]$part; $c = $walker.GetFirstChild($e)
      while ($i -gt 0 -and $null -ne $c) { $c = $walker.GetNextSibling($c); $i-- }
      if ($null -eq $c) { throw 'The control is no longer where it was (the window changed).' }
      $e = $c
    }
  }
  if ([int]$e.Current.ProcessId -ne [int]$procId) { throw 'That control belongs to another program. Refusing.' }
  return $e
}
# Controls can move while a window finishes drawing (a file dialog fills in after it opens). If the remembered position no longer holds, the control is looked up
# again by its automation id; it is used only if exactly ONE control has that id, the same type and the same name.
function FindById($win, $autoId, $type, $name, $procId) {
  $found = @(); $n = 0; $stack = New-Object System.Collections.Stack; $stack.Push(@($win, 0))
  while ($stack.Count -gt 0 -and $n -lt 500) {
    $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $n++
    try {
      if ([int]$e.Current.ProcessId -ne [int]$procId) { continue }
      if ($d -gt 0 -and [string]$e.Current.AutomationId -eq [string]$autoId -and (TypeName $e) -eq [string]$type -and ($null -eq $name -or (Safe $e.Current.Name 200) -eq [string]$name)) { $found += $e }
    } catch { continue }
    if ($d -lt $MAX_DEPTH) { $c = $walker.GetFirstChild($e); $k = 0; while ($null -ne $c -and $k -lt 120) { $stack.Push(@($c, ($d + 1))); $c = $walker.GetNextSibling($c); $k++ } }
  }
  if ($found.Count -eq 1) { return $found[0] }
  return $null
}
function SecretLike($cur, $e) {
  $pw = $false; try { $pw = [bool]$cur.IsPassword } catch { }
  $w = $null; if ($e) { $w = W32 $e }
  if ($w -and $w.password) { $pw = $true }
  return ($pw -or $SECRET_NAME.IsMatch([string]$cur.Name) -or $SECRET_NAME.IsMatch([string]$cur.AutomationId))
}
function NodeInfo($e, $path) {
  $cur = $e.Current
  $pats = @(); try { $pats = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'Identifiers\.Pattern$|Pattern$', '' -replace '^.*\.', '' }) } catch { }
  $value = $null; $valueLength = 0; $toggle = $null; $selected = $null; $secret = SecretLike $cur $e
  if (-not $secret) {
    try { $vp = $null; if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $raw = [string]$vp.Current.Value; $valueLength = $raw.Length; $value = Safe $raw 600 } } catch { }
  }
  try { $tp = $null; if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) { $toggle = [string]$tp.Current.ToggleState } } catch { }
  $w32 = W32 $e
  if ($w32) {
    if ($w32.kind -eq 'button') { $pats += 'Win32Click'; if ($w32.type -eq 'CheckBox') { $st = [int][AwpWin]::SendMessage([IntPtr]$w32.hwnd, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero); $toggle = $(if ($st -eq 1) { 'On' } elseif ($st -eq 2) { 'Indeterminate' } else { 'Off' }) }; if ($w32.type -eq 'RadioButton') { $st = [int][AwpWin]::SendMessage([IntPtr]$w32.hwnd, 0xF0, [IntPtr]::Zero, [IntPtr]::Zero); $selected = ($st -eq 1) } }
    if ($w32.kind -eq 'edit') { $pats += 'Win32Text'; if (-not $secret) { $raw = [AwpWin]::GetText([IntPtr]$w32.hwnd); $valueLength = $raw.Length; $value = Safe $raw 600 } }
  }
  try { $sp = $null; if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $selected = [bool]$sp.Current.IsSelected } } catch { }
  return @{ path = $path; name = (Safe $cur.Name 200); type = (TypeName $e); automationId = (Safe $cur.AutomationId 100); className = (Safe $cur.ClassName 100); enabled = [bool]$cur.IsEnabled; offscreen = [bool]$cur.IsOffscreen; focusable = [bool]$cur.IsKeyboardFocusable; secret = [bool]$secret; value = $value; valueLength = $valueLength; toggle = $toggle; selected = $selected; patterns = $pats; rect = (Rect $e) }
}
function Foreground($handle, $procId) {
  if ([AwpWin]::IsIconic($handle)) { [void][AwpWin]::ShowWindow($handle, 9) }
  for ($i = 0; $i -lt 5; $i++) {
    [void][AwpWin]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 80
    if ([int][AwpWin]::PidOf([AwpWin]::GetForegroundWindow()) -eq [int]$procId) { return $true }
    if ($i -eq 2) { [AwpWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [AwpWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) }
  }
  return $false
}
function HoldsContent($win) {
  $n = 0; $stack = New-Object System.Collections.Stack; $stack.Push($win)
  while ($stack.Count -gt 0 -and $n -lt 250) {
    $e = $stack.Pop(); $n++
    try {
      $t = TypeName $e
      if ($t -eq 'Edit' -or $t -eq 'Document') {
        $vp = $null
        if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -and -not $vp.Current.IsReadOnly -and ([string]$vp.Current.Value).Length -gt 0) { return $true }
      }
    } catch { }
    $c = $walker.GetFirstChild($e); $k = 0
    while ($null -ne $c -and $k -lt 80) { $stack.Push($c); $c = $walker.GetNextSibling($c); $k++ }
  }
  return $false
}
function Handle($req) {
  switch ($req.op) {
    'status' {
      $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      $langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
      return @{ uia = $true; ocr = ($null -ne $eng); ocrLanguage = $(if ($eng) { $eng.RecognizerLanguage.LanguageTag } else { $null }); ocrLanguages = $langs; powershell = $PSVersionTable.PSVersion.ToString(); registered = $script:reg.Count }
    }
    'init' {
      $dir = [System.IO.Path]::GetFullPath([string]$req.privateDir)
      if (-not (Test-Path -LiteralPath $dir -PathType Container)) { throw 'The private folder does not exist.' }
      $script:privDir = $dir
      return @{ privateDir = $dir }
    }
    'register' {
      $p = $null
      try {
      $procId = [int]$req.pid
      $leaf = ([System.IO.Path]::GetFileName([string]$req.exe)).ToLowerInvariant()
      if ($NEVER_EXE -contains $leaf) { throw 'This kind of program is never controlled by the desktop engine.' }
      try { $p = [System.Diagnostics.Process]::GetProcessById($procId) } catch { throw 'The program is not running (it may have handed over to another process).' }
      $actualExe = $null
      for ($try = 0; $try -lt 20 -and -not $actualExe; $try++) {
        try { $actualExe = $p.MainModule.FileName } catch { $actualExe = $null }
        if (-not $actualExe) { Start-Sleep -Milliseconds 100; try { $p.Refresh() } catch { } }
      }
      if (-not $actualExe) { throw 'The program file of that process cannot be read, so its identity cannot be proven.' }
      if ($actualExe.ToLowerInvariant() -ne ([string]$req.exe).ToLowerInvariant()) { throw 'That process runs a different program file than the approved one.' }
      $cim = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $procId)
      if ($null -eq $cim) { throw 'The program is not running (it may have handed over to another process).' }
      if ([int]$cim.ParentProcessId -ne [int]$req.parentPid) { throw 'That process was not started by the desktop engine. Refusing.' }
      $epoch = New-Object System.DateTime 1970, 1, 1, 0, 0, 0, ([System.DateTimeKind]::Utc)
      $startMs = [int64](($p.StartTime.ToUniversalTime() - $epoch).TotalMilliseconds)
      $age = [int64]$req.nowMs - $startMs
      if ($age -lt -2000 -or $age -gt 30000) { throw 'That process did not just start. Refusing to take over a program that was already running.' }
      $script:reg[[string]$procId] = @{ ticks = $p.StartTime.ToUniversalTime().Ticks; exe = $actualExe }
      return @{ registered = $true; startMs = $startMs }
      } catch {
        $gone = $false; if ($null -ne $p) { try { $gone = $p.HasExited } catch { $gone = $true } }
        if ($gone) { throw 'The program is not running (it may have handed over to another process).' }
        throw
      }
    }
    'unregister' { $script:reg.Remove([string][int]$req.pid); return @{ unregistered = $true } }
    'windows' {
      [void](Registered $req.pid)
      $kids = $UIA::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      $out = @()
      foreach ($k in $kids) {
        try {
          $c = $k.Current
          if ([int]$c.ProcessId -ne [int]$req.pid) { continue }
          $h = [int64]$c.NativeWindowHandle
          if ($h -eq 0) { continue }
          if ([string]$c.ClassName -in 'SysShadow', 'IME', 'MSCTFIME UI', 'tooltips_class32') { continue }
          # dialogs owned by this window (a message box, a Save dialog) are listed by UI Automation as its children, and the dialogs THEY own (the
          # "replace the existing file?" question owned by a Save dialog, seen on a real window 2026-11-04) as grandchildren. Up to three levels are
          # listed, deepest first (they are on top). Same rule as before: only windows of this registered process.
          $owned = @()
          try {
            $isWin = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
            $level = @($k)
            for ($depth = 0; $depth -lt 3 -and $level.Count -gt 0; $depth++) {
              $nextLevel = @()
              $found = @()
              foreach ($p in $level) {
                foreach ($d in $p.FindAll([System.Windows.Automation.TreeScope]::Children, $isWin)) {
                  $dc = $d.Current; $dh = [int64]$dc.NativeWindowHandle
                  if ($dh -ne 0 -and [int]$dc.ProcessId -eq [int]$req.pid -and [string]$dc.ClassName -notin 'SysShadow', 'IME', 'MSCTFIME UI') {
                    $found += @{ handle = $dh; pid = [int]$req.pid; title = (Safe $dc.Name 200); className = (Safe $dc.ClassName 100); rect = (Rect $d); offscreen = [bool]$dc.IsOffscreen }
                    $nextLevel += $d
                  }
                }
              }
              $owned = @($found) + @($owned)
              $level = $nextLevel
            }
          } catch { }
          $out += $owned
          $out += @{ handle = $h; pid = [int]$req.pid; title = (Safe $c.Name 200); className = (Safe $c.ClassName 100); rect = (Rect $k); offscreen = [bool]$c.IsOffscreen }
        } catch { }
      }
      return @{ windows = $out }
    }
    'tree' {
      $win = WindowOf $req.handle $req.pid
      $sw = [Diagnostics.Stopwatch]::StartNew(); $nodes = New-Object System.Collections.ArrayList; $truncated = $false; $foreign = 0
      $stack = New-Object System.Collections.Stack
      $first = $walker.GetFirstChild($win); $idx = 0; $list = @()
      while ($null -ne $first) { $list += , @($first, [string]$idx, 1); $first = $walker.GetNextSibling($first); $idx++ }
      for ($j = $list.Count - 1; $j -ge 0; $j--) { $stack.Push($list[$j]) }
      while ($stack.Count -gt 0) {
        if ($nodes.Count -ge $MAX_NODES -or $sw.ElapsedMilliseconds -gt $MAX_MS) { $truncated = $true; break }
        $item = $stack.Pop(); $e = $item[0]; $path = $item[1]; $depth = $item[2]
        try { if ([int]$e.Current.ProcessId -ne [int]$req.pid) { $foreign++; continue } } catch { continue }
        try { [void]$nodes.Add((NodeInfo $e $path)) } catch { continue }
        if ($depth -lt $MAX_DEPTH) {
          $kids = @(); $c = $walker.GetFirstChild($e); $n = 0
          while ($null -ne $c -and $n -lt 120) { $kids += , @($c, ($path + '.' + $n), ($depth + 1)); $c = $walker.GetNextSibling($c); $n++ }
          for ($j = $kids.Count - 1; $j -ge 0; $j--) { $stack.Push($kids[$j]) }
        }
      }
      return @{ window = (NodeInfo $win ''); nodes = @($nodes); truncated = $truncated; foreign = $foreign }
    }
    'act' {
      $win = WindowOf $req.handle $req.pid
      $e = $null
      try { $e = ResolvePath $win $req.path $req.pid } catch { $e = $null }
      if ($null -ne $e) { $cur0 = $e.Current; if (($null -ne $req.expectName -and (Safe $cur0.Name 200) -ne [string]$req.expectName) -or ($null -ne $req.expectType -and (TypeName $e) -ne [string]$req.expectType)) { $e = $null } }
      if ($null -eq $e -and $req.automationId) { $e = FindById $win $req.automationId $req.expectType $req.expectName $req.pid }
      if ($null -eq $e) { throw 'The control is no longer where it was, or is not the same control (the window changed). Nothing was done.' }
      $cur = $e.Current
      if (-not $cur.IsEnabled) { throw 'The control is disabled.' }
      if ($cur.IsOffscreen) { throw 'The control is not visible.' }
      $w32 = W32 $e
      if ($w32 -and $req.action -in 'invoke', 'toggle', 'select', 'setvalue') {
        $hw = [IntPtr]$w32.hwnd
        if ($req.action -eq 'setvalue') {
          if ($w32.kind -ne 'edit') { throw 'This control cannot be typed into.' }
          if (SecretLike $cur $e) { throw 'Password and secret fields are never written by the desktop engine.' }
          if ([AwpWin]::GetWindowTextLength($hw) -gt 0 -and $req.overwrite -ne $true) { throw 'This field already contains text. It is not replaced unless the task explicitly allows overwriting.' }
          [void][AwpWin]::SendMessage($hw, 0x0C, [IntPtr]::Zero, [string]$req.value)
        } else {
          if ($w32.kind -ne 'button') { throw 'This control cannot be clicked.' }
          [void][AwpWin]::PostMessage($hw, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
        }
        Start-Sleep -Milliseconds 200
        $after = $null; try { $after = NodeInfo $e $req.path } catch { }
        return @{ done = $true; after = $after }
      }
      switch ($req.action) {
        'invoke' { $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { throw 'This control cannot be clicked through UI Automation (no Invoke pattern).' }; $p.Invoke() }
        'toggle' { $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { throw 'This control cannot be toggled (no Toggle pattern).' }; $p.Toggle() }
        'select' { $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { throw 'This item cannot be selected (no SelectionItem pattern).' }; $p.Select() }
        'expand' { $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { throw 'This control cannot be expanded (no ExpandCollapse pattern).' }; $p.Expand() }
        'collapse' { $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { throw 'This control cannot be collapsed (no ExpandCollapse pattern).' }; $p.Collapse() }
        'setvalue' {
          if (SecretLike $cur $e) { throw 'Password and secret fields are never written by the desktop engine.' }
          $p = $null; if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { throw 'This control cannot be typed into through UI Automation (no Value pattern).' }
          if ($p.Current.IsReadOnly) { throw 'This control is read-only.' }
          if (([string]$p.Current.Value).Length -gt 0 -and $req.overwrite -ne $true) { throw 'This field already contains text. It is not replaced unless the task explicitly allows overwriting.' }
          $p.SetValue([string]$req.value)
        }
        'focus' { $e.SetFocus() }
        default { throw 'Unknown action.' }
      }
      Start-Sleep -Milliseconds 120
      $after = $null; try { $after = NodeInfo $e $req.path } catch { }
      return @{ done = $true; after = $after }
    }
    'focus' {
      [void](WindowOf $req.handle $req.pid)
      return @{ foreground = (Foreground ([IntPtr][int64]$req.handle) $req.pid) }
    }
    'keys' {
      [void](WindowOf $req.handle $req.pid)
      if (-not (Foreground ([IntPtr][int64]$req.handle) $req.pid)) { throw 'The window could not be brought to the front, so no keys were sent (they would have gone to another program).' }
      if ([int][AwpWin]::PidOf([AwpWin]::GetForegroundWindow()) -ne [int]$req.pid) { throw 'Another program took the focus, so no keys were sent.' }
      [System.Windows.Forms.SendKeys]::SendWait([string]$req.keys)
      Start-Sleep -Milliseconds 150
      return @{ sent = $true }
    }
    'close' {
      $win = WindowOf $req.handle $req.pid
      if (-not ($req.discard -eq $true)) {
        if ((Redact $win.Current.Name) -match '^\*|modified|unsaved') { throw 'This window looks like it holds unsaved work. It is not closed unless the task explicitly allows discarding.' }
        if (HoldsContent $win) { throw 'This window holds text in an editable field. It is not closed unless the task explicitly allows discarding.' }
      }
      $p = $null; if (-not $win.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { throw 'This window cannot be closed through UI Automation.' }
      $p.Close()
      return @{ requested = $true }
    }
    'capture' {
      [void](WindowOf $req.handle $req.pid)
      $out = InPrivDir $req.out
      $w = 0; $h = 0
      $err = [AwpWin]::Shot([IntPtr][int64]$req.handle, $out, [ref]$w, [ref]$h)
      if ($err) { throw $err }
      return @{ width = $w; height = $h }
    }
    'ocr' {
      $img = InPrivDir $req.image
      $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      if ($null -eq $eng) { throw 'No Windows OCR language is installed.' }
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img)) ([Windows.Storage.StorageFile])
      $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
      $lines = @()
      foreach ($l in $res.Lines) {
        $clean = Redact $l.Text; $changed = ($clean -ne $l.Text); $words = @()
        foreach ($w in $l.Words) { $r = $w.BoundingRect; $words += @{ text = $(if ($changed) { '[redacted]' } else { Safe $w.Text 80 }); rect = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) } }
        $lines += @{ text = (Safe $clean 300); words = $words; redacted = $changed }
        if ($lines.Count -ge 200) { break }
      }
      $stream.Dispose()
      return @{ language = $eng.RecognizerLanguage.LanguageTag; lines = $lines }
    }
    default { throw 'Unknown operation.' }
  }
}
Reply @{ id = 0; ok = $true; ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $req = $null
  try {
    $req = ConvertFrom-Json -InputObject $line
    $r = Handle $req
    $r.id = $req.id; $r.ok = $true
    Reply $r
  } catch {
    Fail $(if ($req) { $req.id } else { -1 }) $_.Exception.Message
  }
}
`.replace("__PATTERNS__", () => patternsForPowerShell());
