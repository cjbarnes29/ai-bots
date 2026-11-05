import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { win32 } from "node:path";
import { appIdFor, protectedMatch, riskNotesFor } from "./apps.js";

/**
 * Read-only application discovery (D-027). It LOOKS; it never starts, stops, changes, installs or removes anything, and seeing a program
 * never authorizes it.
 *
 * One fixed PowerShell script (no input from anywhere is put into it) reads: the three Windows "installed programs" lists, running
 * processes, services, startup entries and non-Microsoft scheduled tasks, and the publisher name embedded in each program file. It makes no
 * network request: the embedded publisher is read from the file itself, NOT verified against a certificate chain (that could contact the
 * internet), so "signed" here means "claims a publisher", not "proven". The test file checks the script for any command that could change
 * something.
 */
export const DISCOVERY_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$hives = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
$installed = @(Get-ItemProperty -Path $hives | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object { [pscustomobject]@{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion; publisher = [string]$_.Publisher; location = [string]$_.InstallLocation; icon = [string]$_.DisplayIcon } })
$procs = @(Get-Process | Where-Object { $_.Path } | ForEach-Object { [pscustomobject]@{ pid = $_.Id; name = [string]$_.ProcessName; path = [string]$_.Path } })
$services = @(Get-CimInstance -ClassName Win32_Service | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; display = [string]$_.DisplayName; state = [string]$_.State; start = [string]$_.StartMode; path = [string]$_.PathName } })
$startup = @(Get-CimInstance -ClassName Win32_StartupCommand | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; command = [string]$_.Command; location = [string]$_.Location; user = [string]$_.User } })
$tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object { $a = $_.Actions | Select-Object -First 1; [pscustomobject]@{ name = [string]$_.TaskName; path = [string]$_.TaskPath; state = [string]$_.State; exe = [string]$a.Execute; args = [string]$a.Arguments } })
$files = New-Object System.Collections.Generic.HashSet[string]
foreach ($p in $procs) { [void]$files.Add($p.path) }
foreach ($i in $installed) { $e = ($i.icon -split ',')[0].Trim('"'); if ($e -like '*.exe') { [void]$files.Add($e) } }
$sigs = @()
foreach ($f in ($files | Select-Object -First 400)) {
  $s = $null; $subject = $null
  try { $c = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($f); $subject = $c.Subject } catch { }
  $sigs += [pscustomobject]@{ path = [string]$f; signer = [string]$subject }
}
[pscustomobject]@{ installed = $installed; procs = $procs; services = $services; startup = $startup; tasks = $tasks; sigs = $sigs } | ConvertTo-Json -Compress -Depth 4
`;

export interface RawDiscovery {
  installed: { name: string; version: string; publisher: string; location: string; icon: string }[];
  procs: { pid: number; name: string; path: string }[];
  services: { name: string; display: string; state: string; start: string; path: string }[];
  startup: { name: string; command: string; location: string; user: string }[];
  tasks: { name: string; path: string; state: string; exe: string; args: string }[];
  sigs: { path: string; signer: string }[];
}

export interface DiscoveredApp {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installLocation: string | null;
  exePath: string | null;
  /** The publisher named inside the program file, or null. NOT verified against a certificate chain. */
  signer: string | null;
  signed: boolean;
  /** Part of Windows itself (under the Windows folder). Hidden by default in the dashboard. */
  system: boolean;
  running: { pids: number[]; count: number };
  services: { name: string; state: string; startMode: string }[];
  startup: { name: string; location: string }[];
  tasks: { name: string; state: string }[];
  /** Ways THIS app (the AI Workforce) already uses the program. */
  integrations: string[];
  protectedBy: { category: string; why: string } | null;
  riskNotes: string[];
  sources: string[];
}

export interface Inventory {
  scannedAt: string;
  readOnly: true;
  apps: DiscoveredApp[];
  notes: string[];
}

/** Takes the program file out of a command line such as `"C:\Program Files\X\x.exe" /run`. */
export function exeFromCommand(command: string | undefined | null): string | null {
  if (!command) return null;
  const c = command.trim();
  const quoted = /^"([^"]+)"/.exec(c);
  const candidate = quoted ? quoted[1]! : (/^(.+?\.(?:exe|com|bat|cmd))(?:\s|$)/i.exec(c)?.[1] ?? null);
  if (!candidate) return null;
  const expanded = candidate.replace(/%([A-Za-z0-9_]+)%/g, (m, v: string) => process.env[v] ?? m);
  return /^[a-zA-Z]:\\/.test(expanded) ? win32.normalize(expanded) : null;
}

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();
const nonEmpty = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const isSystemPath = (p: string | null) => !!p && /^[a-z]:\\windows(\\|$)/i.test(p);
const commonName = (subject: string): string | null => /CN=("([^"]+)"|[^,]+)/.exec(subject)?.[1]?.replace(/^"|"$/g, "") ?? null;

/** Builds the inventory from the raw read. Pure: given the same input it always gives the same answer (tests feed it fake data). */
export function buildInventory(raw: RawDiscovery, existing: { label: string; programs?: string[] }[], nowIso: string): Inventory {
  const signerOf = new Map(raw.sigs.map((s) => [lower(s.path), nonEmpty(s.signer) ? commonName(s.signer) : null]));
  const byKey = new Map<string, DiscoveredApp>();
  const make = (name: string, exe: string | null, publisher: string | null, init: Partial<DiscoveredApp> = {}): DiscoveredApp => {
    const id = appIdFor(exe, name, publisher);
    let a = byKey.get(id);
    if (!a) {
      const signer = exe ? (signerOf.get(lower(exe)) ?? null) : null;
      a = {
        id, name, version: null, publisher, installLocation: null, exePath: exe, signer, signed: signer !== null, system: isSystemPath(exe),
        running: { pids: [], count: 0 }, services: [], startup: [], tasks: [], integrations: [],
        protectedBy: protectedMatch(`${name} ${publisher ?? ""} ${exe ?? ""}`), riskNotes: riskNotesFor(`${name} ${exe ?? ""}`), sources: [], ...init,
      };
      byKey.set(id, a);
    }
    return a;
  };
  const addSource = (a: DiscoveredApp, s: string) => {
    if (!a.sources.includes(s)) a.sources.push(s);
  };

  // 1) installed programs (the main list). Their main program file comes from the icon entry when it points at an .exe
  const installs: { app: DiscoveredApp; location: string | null }[] = [];
  for (const i of raw.installed) {
    const icon = nonEmpty(i.icon)?.split(",")[0]?.replace(/^"|"$/g, "") ?? null;
    const exe = icon && /\.exe$/i.test(icon) && /^[a-zA-Z]:\\/.test(icon) ? win32.normalize(icon) : null;
    const loc = nonEmpty(i.location) && /^[a-zA-Z]:\\/.test(i.location) ? win32.normalize(i.location.replace(/"/g, "")) : null;
    const a = make(i.name, exe, nonEmpty(i.publisher), { version: nonEmpty(i.version), installLocation: loc });
    addSource(a, "installed");
    installs.push({ app: a, location: loc ?? (exe ? win32.dirname(exe) : null) });
  }
  // find the install that owns a program file: the deepest install folder containing it (never a bare drive or the Windows folder)
  const owner = (exe: string): DiscoveredApp | null => {
    let best: { app: DiscoveredApp; len: number } | null = null;
    const e = lower(exe);
    for (const it of installs) {
      if (!it.location) continue;
      const l = lower(it.location).replace(/\\+$/, "");
      if (l.length < 6 || /^[a-z]:\\(windows|program files|program files \(x86\)|users)$/.test(l)) continue;
      if ((e === l || e.startsWith(l + "\\")) && (!best || l.length > best.len)) best = { app: it.app, len: l.length };
    }
    return best?.app ?? null;
  };
  const attach = (exe: string | null, fallbackName: string, publisher: string | null): DiscoveredApp => {
    if (exe) {
      const o = owner(exe);
      if (o) {
        if (!o.exePath) {
          o.exePath = exe;
          o.signer = signerOf.get(lower(exe)) ?? null;
          o.signed = o.signer !== null;
          o.system = isSystemPath(exe);
        }
        return o;
      }
      return make(fallbackName, exe, publisher);
    }
    return make(fallbackName, null, publisher);
  };

  // 2) running processes
  for (const p of raw.procs) {
    const a = attach(win32.normalize(p.path), p.name, null);
    if (!a.running.pids.includes(p.pid)) a.running.pids.push(p.pid);
    a.running.count = a.running.pids.length;
    addSource(a, "running");
  }
  // 3) services
  for (const s of raw.services) {
    const exe = exeFromCommand(s.path);
    // Windows' own services are left out of the application list (hundreds of rows nobody can act on)
    if (!exe || isSystemPath(exe)) continue;
    const a = attach(exe, nonEmpty(s.display) ?? s.name, null);
    a.services.push({ name: s.name, state: s.state, startMode: s.start });
    addSource(a, "service");
  }
  // 4) startup entries
  for (const s of raw.startup) {
    const exe = exeFromCommand(s.command);
    const a = attach(exe, s.name, null);
    a.startup.push({ name: s.name, location: s.location });
    addSource(a, "startup");
  }
  // 5) scheduled tasks (non-Microsoft only)
  for (const t of raw.tasks) {
    const exe = exeFromCommand(t.exe);
    if (!exe) continue;
    const a = attach(exe, t.name, null);
    a.tasks.push({ name: `${t.path}${t.name}`, state: t.state });
    addSource(a, "task");
  }
  // 6) existing integrations of this app (programs the PC agent may run)
  for (const a of byKey.values()) {
    const base = lower(a.exePath ? win32.basename(a.exePath, ".exe") : a.name);
    for (const e of existing) {
      if (e.programs?.some((p) => lower(p) === base)) a.integrations.push(e.label);
    }
  }
  const apps = [...byKey.values()].sort((x, y) => Number(x.system) - Number(y.system) || x.name.localeCompare(y.name));
  return {
    scannedAt: nowIso,
    readOnly: true,
    apps,
    notes: [
      "Read-only: nothing was started, stopped, changed or removed.",
      "Microsoft Store apps and portable programs that are neither installed nor running may be missing.",
      "'Signed' means the program file names a publisher. It is NOT checked against a certificate chain here.",
      "Seeing a program in this list does not approve it.",
    ],
  };
}

export type DiscoveryRunner = () => Promise<RawDiscovery>;

/** Runs the fixed script. The only input is the constant above; the command line holds no data from anywhere else. */
export const powershellDiscovery: DiscoveryRunner = () =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Application discovery is only available on Windows."));
    const encoded = Buffer.from(DISCOVERY_SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The scan took too long and was stopped."));
    }, 90_000);
    child.stdout.on("data", (d: Buffer) => {
      if (out.length < 20_000_000) out += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 2000) err += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as Partial<RawDiscovery>;
        const arr = <T,>(x: T | T[] | undefined): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
        resolve({ installed: arr(j.installed), procs: arr(j.procs), services: arr(j.services), startup: arr(j.startup), tasks: arr(j.tasks), sigs: arr(j.sigs) });
      } catch {
        reject(new Error("The scan did not return readable results."));
      }
    });
  });

/** SHA-256 of a program file, or null if it cannot be read. Reading only. */
export function hashFileSync(path: string): string | null {
  try {
    // synchronous, bounded read in chunks
    const fd = openSync(path, "r");
    try {
      const h = createHash("sha256");
      const buf = Buffer.alloc(1 << 20);
      let n: number;
      let total = 0;
      while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
        h.update(buf.subarray(0, n));
        total += n;
        if (total > 500 * 1024 * 1024) return null;
      }
      return h.digest("hex");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

