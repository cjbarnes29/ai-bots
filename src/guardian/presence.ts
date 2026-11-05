import { spawn, type ChildProcess } from "node:child_process";

/**
 * Is the owner here? Two signals from Windows: is the session locked, and how long since the last keyboard or mouse input.
 *
 * LIMITS (read these before trusting it):
 *  - Windows' idle timer also counts input that a PROGRAM sends (for example an agent using keyboard automation in this same session).
 *    So automation in the owner's own session can keep the idle timer low. Counting only real hardware input needs a separate
 *    helper and is NOT built yet. Inside a VM this does not matter, because the guest's input does not touch the host timer.
 *  - "Locked" is detected by the lock screen program (LogonUI.exe) running. This has not been tested on a real lock by the project yet.
 *  - These readings are per Windows session. A system-level Guardian (Tier B) cannot read the owner's session directly and needs a small
 *    helper running in that session; that is NOT built yet.
 */
export interface PresenceSample {
  locked: boolean;
  idleMs: number;
  at: number;
}

export interface PresenceSource {
  start(): void;
  stop(): void;
  /** The newest reading, or null if there has never been one. */
  sample(): PresenceSample | null;
}

const HELPER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AwpIdle {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static long IdleMs() {
    LASTINPUTINFO i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i);
    if (!GetLastInputInfo(ref i)) return -1;
    return (long)((uint)Environment.TickCount - i.dwTime);
  }
}
"@
while ($true) {
  try {
    $locked = [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
    [Console]::Out.WriteLine('{"idleMs":' + [AwpIdle]::IdleMs() + ',"locked":' + $locked.ToString().ToLower() + '}')
    [Console]::Out.Flush()
  } catch { exit }  # the Guardian is gone (its pipe is broken): do not linger
  Start-Sleep -Seconds 5
}
`;

export function parsePresenceLine(line: string, now: number): PresenceSample | null {
  try {
    const o = JSON.parse(line) as { idleMs?: unknown; locked?: unknown };
    if (typeof o.idleMs === "number" && o.idleMs >= 0 && typeof o.locked === "boolean") return { idleMs: o.idleMs, locked: o.locked, at: now };
  } catch {
    /* not a reading */
  }
  return null;
}

/** One long-running, hidden PowerShell that prints a reading every 5 seconds. It is restarted at most 3 times in 5 minutes. */
export class PowerShellPresence implements PresenceSource {
  private child: ChildProcess | null = null;
  private latest: PresenceSample | null = null;
  private restarts: number[] = [];
  private stopped = false;
  private buffer = "";

  constructor(private readonly now: () => number = Date.now) {}

  start(): void {
    this.stopped = false;
    this.spawnHelper();
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }

  sample(): PresenceSample | null {
    return this.latest;
  }

  private spawnHelper(): void {
    const encoded = Buffer.from(HELPER_SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const s = parsePresenceLine(this.buffer.slice(0, nl).trim(), this.now());
        this.buffer = this.buffer.slice(nl + 1);
        if (s) this.latest = s;
      }
    });
    child.on("exit", () => {
      if (this.stopped || this.child !== child) return;
      const t = this.now();
      this.restarts = this.restarts.filter((x) => t - x < 5 * 60_000);
      if (this.restarts.length >= 3) return; // gives up; the Guardian then sees no fresh reading and pauses
      this.restarts.push(t);
      setTimeout(() => !this.stopped && this.spawnHelper(), 2000).unref();
    });
  }
}
