import { execFile } from "node:child_process";

/**
 * Stops the programs the AI Workforce started, and ONLY those.
 *
 * "Ours" means: a descendant of the Manager's process (found as the program listening on the Manager's port, and only if it is node.exe),
 * or a process we saw as a descendant earlier that is still alive with the same start time (so a program that was left behind by an
 * exited parent is still caught). Nothing is ever chosen by program name, and a short list of Windows' own programs is never touched
 * even if one somehow appears below the Manager.
 *
 * LIMIT: a program that started AND lost its parent between two scans (about 5 seconds) can be missed.
 */
export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  path: string;
  start: string;
}

export interface ProcessSnapshot {
  procs: ProcInfo[];
  listenerPid: number | null;
}

export interface ProcessTable {
  snapshot(): Promise<ProcessSnapshot>;
  kill(pid: number): boolean;
}

export interface StopReport {
  managerFound: boolean;
  killed: { pid: number; name: string }[];
  skipped: { pid: number; name: string; reason: string }[];
  failed: { pid: number; name: string }[];
}

export interface TreeStopper {
  scan(): Promise<void>;
  stop(): Promise<StopReport>;
}

/** Windows' own programs: never stopped by the Guardian, whatever the process tree says. */
export const NEVER_STOP = new Set(["system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "svchost.exe", "dwm.exe", "explorer.exe", "fontdrvhost.exe", "sihost.exe", "taskhostw.exe", "ctfmon.exe", "searchhost.exe", "startmenuexperiencehost.exe", "msmpeng.exe", "vmware-vmx.exe", "vmware.exe", "vmnat.exe", "vmware-authd.exe"]);

export function descendants(procs: ProcInfo[], rootPid: number): { proc: ProcInfo; depth: number }[] {
  const byParent = new Map<number, ProcInfo[]>();
  for (const p of procs) byParent.set(p.ppid, [...(byParent.get(p.ppid) ?? []), p]);
  const out: { proc: ProcInfo; depth: number }[] = [];
  const seen = new Set<number>([rootPid]);
  let level = [rootPid];
  for (let depth = 1; level.length > 0 && depth < 50; depth++) {
    const next: number[] = [];
    for (const parent of level) {
      for (const child of byParent.get(parent) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        out.push({ proc: child, depth });
        next.push(child.pid);
      }
    }
    level = next;
  }
  return out;
}

export class ProcessTreeGuard implements TreeStopper {
  private seen = new Map<number, ProcInfo & { depth: number }>();

  constructor(
    private readonly table: ProcessTable,
    private readonly ownPid: number,
    private readonly rootNames: string[] = ["node.exe"],
  ) {}

  private rootOf(s: ProcessSnapshot): ProcInfo | null {
    if (s.listenerPid === null) return null;
    const p = s.procs.find((x) => x.pid === s.listenerPid);
    return p && this.rootNames.includes(p.name.toLowerCase()) ? p : null;
  }

  async scan(): Promise<void> {
    const snap = await this.table.snapshot();
    const alive = new Map(snap.procs.map((p) => [p.pid, p]));
    for (const [pid, rec] of this.seen) {
      const now = alive.get(pid);
      if (!now || now.start !== rec.start) this.seen.delete(pid);
    }
    const root = this.rootOf(snap);
    if (!root) return;
    for (const { proc, depth } of descendants(snap.procs, root.pid)) this.seen.set(proc.pid, { ...proc, depth });
  }

  async stop(): Promise<StopReport> {
    const snap = await this.table.snapshot();
    const alive = new Map(snap.procs.map((p) => [p.pid, p]));
    const root = this.rootOf(snap);
    const candidates = new Map<number, ProcInfo & { depth: number }>();
    if (root) for (const { proc, depth } of descendants(snap.procs, root.pid)) candidates.set(proc.pid, { ...proc, depth });
    for (const [pid, rec] of this.seen) {
      const now = alive.get(pid);
      if (now && now.start === rec.start && !candidates.has(pid)) candidates.set(pid, { ...now, depth: rec.depth });
    }
    const report: StopReport = { managerFound: root !== null, killed: [], skipped: [], failed: [] };
    const ordered = [...candidates.values()].sort((a, b) => b.depth - a.depth); // deepest first
    for (const p of ordered) {
      const why = this.refusal(p, root);
      if (why) {
        report.skipped.push({ pid: p.pid, name: p.name, reason: why });
        continue;
      }
      if (this.table.kill(p.pid)) {
        report.killed.push({ pid: p.pid, name: p.name });
        this.seen.delete(p.pid);
      } else report.failed.push({ pid: p.pid, name: p.name });
    }
    return report;
  }

  private refusal(p: ProcInfo, root: ProcInfo | null): string | null {
    if (p.pid <= 4) return "system process";
    if (p.pid === this.ownPid) return "the Guardian itself";
    if (root && p.pid === root.pid) return "the Manager itself (it is paused, not killed)";
    if (NEVER_STOP.has(p.name.toLowerCase())) return "protected Windows or VMware program";
    return null;
  }
}

// ---- the real Windows table: one fixed, read-only PowerShell query; the port is a checked integer ----
const POWERSHELL = "powershell.exe";

export class WindowsProcessTable implements ProcessTable {
  constructor(private readonly managerPort: number) {
    if (!Number.isInteger(managerPort) || managerPort < 1 || managerPort > 65535) throw new Error("The Manager port must be a whole number from 1 to 65535.");
  }

  snapshot(): Promise<ProcessSnapshot> {
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$l=(Get-NetTCPConnection -State Listen -LocalPort ${this.managerPort} | Select-Object -First 1).OwningProcess`,
      "$p=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=[string]$_.Name; path=[string]$_.ExecutablePath; start=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}) } })",
      "[pscustomobject]@{ listenerPid=$(if($l){[int]$l}else{$null}); procs=$p } | ConvertTo-Json -Compress -Depth 4",
    ].join("; ");
    return new Promise((resolve, reject) => {
      execFile(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 30_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        try {
          const o = JSON.parse(stdout) as { listenerPid: number | null; procs: ProcInfo[] | ProcInfo };
          resolve({ listenerPid: o.listenerPid ?? null, procs: Array.isArray(o.procs) ? o.procs : [o.procs] });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  kill(pid: number): boolean {
    try {
      return process.kill(pid); // ends exactly this one process
    } catch {
      return false;
    }
  }
}
