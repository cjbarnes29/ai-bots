import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PowerShellPresence } from "./presence.js";
import { ProcessTreeGuard, WindowsProcessTable } from "./process-tree.js";

/**
 * These tests use the REAL Windows process table and the REAL presence helper, but only against harmless programs that the test
 * starts itself (a node program that sleeps). They never touch anything else, and clean up what they started.
 */
const win = process.platform === "win32";
const started: ChildProcess[] = [];
afterEach(() => {
  for (const c of started.splice(0)) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
});

function startSleeper(script: string): ChildProcess {
  const c = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  started.push(c);
  return c;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function lines(c: ChildProcess, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("timed out waiting for output")), 15_000);
    c.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      const got = buf.split("\n").filter(Boolean);
      if (got.length >= count) {
        clearTimeout(timer);
        resolve(got.map((x) => x.trim()));
      }
    });
  });
}

describe.skipIf(!win)("with the real Windows process table (harmless test programs only)", () => {
  it("stops the child of the Manager-like process and nothing else", async () => {
    const manager = startSleeper(
      "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)']);console.log(c.pid)});setInterval(()=>{},1000)",
    );
    const bystander = startSleeper("console.log('up');setInterval(()=>{},1000)");
    const [port, childPid] = (await lines(manager, 2)).map(Number) as [number, number];
    await lines(bystander, 1);
    expect(alive(childPid)).toBe(true);

    const guard = new ProcessTreeGuard(new WindowsProcessTable(port), process.pid);
    const report = await guard.stop();

    expect(report.managerFound).toBe(true);
    expect(report.killed.map((k) => k.pid)).toContain(childPid);
    await new Promise((r) => setTimeout(r, 500));
    expect(alive(childPid)).toBe(false); // the child is gone
    expect(alive(manager.pid!)).toBe(true); // the Manager-like process is NOT killed
    expect(alive(bystander.pid!)).toBe(true); // an unrelated program survives
  }, 60_000);

  it("finds no Manager (and kills nothing) when nothing listens on the port", async () => {
    const bystander = startSleeper("console.log('up');setInterval(()=>{},1000)");
    await lines(bystander, 1);
    const report = await new ProcessTreeGuard(new WindowsProcessTable(1), process.pid).stop();
    expect(report.managerFound).toBe(false);
    expect(report.killed).toEqual([]);
    expect(alive(bystander.pid!)).toBe(true);
  }, 60_000);

  it("the presence helper produces a reading (idle time and lock state)", async () => {
    const presence = new PowerShellPresence();
    presence.start();
    try {
      const deadline = Date.now() + 25_000;
      while (!presence.sample() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
      const s = presence.sample();
      expect(s).not.toBeNull();
      expect(s!.idleMs).toBeGreaterThanOrEqual(0);
      expect(typeof s!.locked).toBe("boolean");
    } finally {
      presence.stop();
    }
  }, 60_000);
});
