import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessService } from "../access/service.js";
import { hashFileSync } from "../access/discovery.js";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { HostBridge } from "./bridge.js";
import { DesktopEngine, spawnLauncher, type Launcher } from "./engine.js";
import { runSchema, type Step } from "./steps.js";
import { buildTestApp } from "./testapp/build.js";

/**
 * REAL WINDOWS TESTS. They start REAL windows on this PC: only (a) a disposable test program compiled from src/desktop/testapp/AwpTestApp.cs into a
 * temporary folder (fake data only), and (b) Winver, a harmless Windows utility. They never touch Notepad or any window that is not started here, and
 * every program they start is ended in afterEach. Windows appear for a few seconds and may take the keyboard focus. The mocked tests are in engine.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const isWin = process.platform === "win32";
const FAKE_KEY = "AIza" + "SyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345";
const SECRET_NOTE = `USER-UNSAVED-NOTE api key ${FAKE_KEY} end`;
const WINVER = "C:\\Windows\\System32\\winver.exe";

let root: string;
let exe: string;
let bridge: HostBridge;
let access: AccessService;
let engine: DesktopEngine;
let audit: AuditLog;
let held: string | null;
let started: ChildProcess[];
let engines: DesktopEngine[];
let fileNo = 0;
const sfile = () => join(root, `state-${++fileNo}.json`);
let ids: { test: string; winver: string };
const clock = () => Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The test program rewrites its state file every 250 ms; a read can land mid-write (empty or partial JSON). Retry briefly instead of failing. */
const state = (f: string): any => {
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      if (i >= 20) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
};
const until = async <T>(fn: () => T | undefined | false, ms = 8000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A program that is NOT started through the engine: stands for the user's own application with the user's own work in it. */
async function startUserInstance(prefill: string, stateFile: string): Promise<{ pid: number; handle: number }> {
  // started through a short-lived go-between, so (like a window the user opened) it is NOT a child of this process
  const mid = spawn(process.execPath, ["-e", "require('child_process').spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: 'ignore' }).unref()", exe, "--title", "USER-WINDOW", "--prefill", prefill, "--state", stateFile], { stdio: "ignore" });
  mid.on("error", () => undefined);
  const st = await until(() => existsSync(stateFile) && state(stateFile).notes !== undefined && state(stateFile));
  started.push({ kill: () => process.kill(state(stateFile).pid) } as ChildProcess);
  await until(() => state(stateFile).handle > 0);
  await sleep(1000); // the window handle can be re-created while the form settles: read it again
  const settled = state(stateFile);
  return { pid: settled.pid, handle: Number(settled.handle) };
}

function mkEngine(launcher?: Launcher): DesktopEngine {
  const e = new DesktopEngine({ bridge, access, audit, now: clock, guardHeld: () => held, privateDir: join(root, "private"), ...(launcher ? { launcher } : {}), hashFile: hashFileSync });
  engines.push(e);
  return e;
}
const track = (l: Launcher): Launcher => (e, c, env) => {
  const r = l(e, c, env);
  return { ...r, kill: () => r.kill() };
};
const withArgs = (args: string[]): Launcher => {
  const inner = spawnLauncher(args);
  return (e, c, env) => inner(e, c, env);
};

beforeAll(() => {
  if (!isWin) return;
  root = mkdtempSync(join(tmpdir(), "awp-real-"));
  exe = buildTestApp(join(root, "app"));
  bridge = new HostBridge(join(root, "host"));
});
afterAll(() => {
  bridge?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!isWin) return;
  held = null;
  started = [];
  engines = [];
  audit = new AuditLog(openDatabase(":memory:"), clock);
  const kv = new Map<string, string>();
  access = new AccessService({
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    audit,
    now: clock,
    guardHeld: () => held,
    appFolders: () => [process.cwd()],
    hashFile: hashFileSync,
    discover: async () => ({
      installed: [
        { name: "AWP Test App", version: "1", publisher: "Test", location: join(root, "app"), icon: `${exe},0` },
        { name: "Winver", version: "1", publisher: "Microsoft", location: "C:\\Windows\\System32", icon: `${WINVER},0` },
      ],
      procs: [],
      services: [],
      startup: [],
      tasks: [],
      sigs: [],
    }),
  });
  await access.scan();
  const byName = (n: string) => access.view().apps.find((a) => a.name === n)!.id;
  ids = { test: byName("AWP Test App"), winver: byName("Winver") };
  engine = mkEngine();
  await engine.prepare();
});
afterEach(async () => {
  if (!isWin) return;
  for (const e of engines ?? []) await e.shutdown(true);
  for (const c of started) {
    try {
      c.kill();
    } catch {
      /* gone */
    }
  }
  await sleep(300);
});

const approveAll = (id: string) => access.apps.set(access.identityOf(id)!, { level: "approved", capabilities: ["open", "view", "control", "close"] }, "owner");
const run = (steps: Step[], extra: Record<string, unknown> = {}, e: DesktopEngine = engine) => e.run(runSchema.parse({ steps, ...extra }));
const T = (): Step => ({ do: "launch", app: ids.test }) as Step;
const grantData = (ops = ["read", "create", "edit"]) => {
  mkdirSync(join(root, "data"), { recursive: true });
  // the temporary folder lives under AppData, which is a secrets place by design, so the grant is the deliberate short-lived kind
  return access.folders.grant({ subject: "workforce", path: join(root, "data"), ops, inherit: false, acknowledgeSensitive: "app_data", expiresInMinutes: 60 }, "owner");
};

describe.skipIf(!isWin)("REAL WINDOWS: the host", () => {
  it("UI Automation and the Windows OCR engine are available on this PC", async () => {
    const s = await bridge.status();
    expect(s.uia).toBe(true);
    expect(s.ocr).toBe(true);
    expect(s.ocrLanguages.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!isWin)("REAL WINDOWS: the incident reproduced with disposable windows (a 'user' window holding 'unsaved work')", () => {
  it("the engine starts its OWN instance and never reads, changes, lists or closes the user's window", async () => {
    approveAll(ids.test);
    const sf = sfile();
    const user = await startUserInstance(SECRET_NOTE, sf);
    const before = state(sf);
    expect(before.notes).toContain("USER-UNSAVED-NOTE");

    const r = await run([T(), { do: "type", target: { name: "Notes" }, text: "ENGINE-OWN-TEXT" }, { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r.finished, JSON.stringify(r.results)).toBe(true);
    expect(r.results[1]).toMatchObject({ status: "ok", evidence: "readback_confirmed" });

    // the user's window is exactly as it was, still open, and nothing of the engine's text reached it
    await sleep(600);
    const after = state(sf);
    expect(after.notes).toBe(before.notes);
    expect(after.feature).toBe(false);
    expect(after.closed).toBe(false);
    expect(alive(user.pid)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(r)).not.toContain("USER-UNSAVED-NOTE");
  });

  it("the Windows host refuses every direct attempt on the user's process and window", async () => {
    approveAll(ids.test);
    const sf = sfile();
    const user = await startUserInstance(SECRET_NOTE, sf);
    const r = await run([T()]);
    const mine = engine.sessionInfo()[0]!;
    expect(mine).toBeDefined();
    // not registered: no listing, no tree, no write, no keys, no close, no picture
    await expect(bridge.windows(user.pid)).rejects.toThrow(/not registered/);
    await expect(bridge.tree(user.handle, user.pid)).rejects.toThrow(/not registered/);
    await expect(bridge.act({ handle: user.handle, pid: user.pid, path: "0", expectName: null, expectType: "Edit", action: "setvalue", value: "OVERWRITTEN", overwrite: true })).rejects.toThrow(/not registered/);
    await expect(bridge.keys({ handle: user.handle, pid: user.pid, keys: "x" })).rejects.toThrow(/not registered/);
    await expect(bridge.close({ handle: user.handle, pid: user.pid, discard: true })).rejects.toThrow(/not registered/);
    await expect(bridge.capture({ handle: user.handle, pid: user.pid, out: join(root, "private", "shot-x.png") })).rejects.toThrow(/not registered/);
    // registered process, but the OTHER program's window handle
    const myPid = (audit.list(50).find((e) => e.kind === "desktop.launch")!.detail as any).pid as number;
    await expect(bridge.tree(user.handle, myPid)).rejects.toThrow(/does not belong to the registered program/);
    await expect(bridge.act({ handle: user.handle, pid: myPid, path: "0", expectName: null, expectType: "Edit", action: "setvalue", value: "X", overwrite: true })).rejects.toThrow(/does not belong/);
    await expect(bridge.close({ handle: user.handle, pid: myPid, discard: true })).rejects.toThrow(/does not belong/);
    // a process the engine did not start cannot be registered either (running program, wrong parent)
    await expect(bridge.register({ pid: user.pid, exe, parentPid: process.pid, nowMs: Date.now() })).rejects.toThrow(/not started by the desktop engine|did not just start/);
    await sleep(400);
    expect(state(sf).notes).toContain("USER-UNSAVED-NOTE");
    expect(state(sf).closed).toBe(false);
    expect(r.finished).toBe(true);
  });

  it("a launch that hands over to another process (the Notepad case) is refused, and the other process is left alone", async () => {
    approveAll(ids.test);
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--handoff", "--state", sf]));
    await e2.prepare();
    const r = await run([T(), { do: "type", target: { name: "Notes" }, text: "must never be typed" }], {}, e2);
    expect(r.results[0]!.status).toBe("failed");
    expect(r.results[0]!.detail).toMatch(/handed over to another process/);
    expect(r.results).toHaveLength(1);
    // the handed-over copy has its own window, exists, and was never touched
    const st = await until(() => existsSync(sf) && state(sf));
    started.push({ kill: () => process.kill(st.pid) } as ChildProcess);
    await sleep(600);
    expect(alive(st.pid)).toBe(true);
    expect(state(sf).notes).toBe("");
    expect(state(sf).closed).toBe(false);
  });
});

describe.skipIf(!isWin)("REAL WINDOWS: reading and operating the disposable test program", () => {
  beforeEach(() => approveAll(ids.test));

  it("discovers the window, reads its controls, and shows lengths instead of contents", async () => {
    const r = await run([T()]);
    const view = await engine.inspect(r.session!);
    const names = view.controls.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Notes", "Password", "Enable feature", "Compute", "Show Message", "Save As...", "Write file"]));
    expect(view.controls.find((c) => c.name === "Password")!.secret).toBe(true);
    expect(view.window.title).toBe("AWP Test App");
    expect(JSON.stringify(view)).not.toContain("fake-password-for-tests");
  });

  it("performs real interactions and confirms each from the control's own state, checked from outside", async () => {
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--state", sf]));
    await e2.prepare();
    const r = await run(
      [
        T(),
        { do: "type", target: { name: "Notes" }, text: "Hello from the engine" },
        { do: "toggle", target: { name: "Enable feature" } },
        { do: "click", target: { name: "Compute" }, expect: { control: { name: "Result" }, valueEquals: "Result: 42" } },
        { do: "read", target: { name: "Result" } },
      ],
      {},
      e2,
    );
    expect(r.finished).toBe(true);
    expect(r.results.map((x) => x.evidence)).toEqual(["state_changed", "readback_confirmed", "readback_confirmed", "expected_state_confirmed", "readback_confirmed"]);
    expect(r.results[4]!.data!["text"]).toBe("Result: 42");
    await sleep(500);
    const st = state(sf);
    expect(st).toMatchObject({ notes: "Hello from the engine", feature: true, result: "Result: 42" });
    expect(r.summary).toMatch(/All steps performed and confirmed|not all were independently confirmed/);
  });

  it("never reads or writes the password field", async () => {
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--state", sf]));
    await e2.prepare();
    const r = await run([T(), { do: "type", target: { name: "Password" }, text: "HACKED" }], {}, e2);
    expect(r.results[1]!.detail).toMatch(/never written/);
    const r2 = await run([{ do: "read", target: { name: "Password" } }], { session: r.session! }, e2);
    expect(r2.results[0]!.detail).toMatch(/never read/);
    await sleep(500);
    expect(state(sf).password).toBe("fake-password-for-tests");
    expect(JSON.stringify([r, r2])).not.toContain("fake-password-for-tests");
  });

  it("redacts secrets inside the Windows host before anything is returned (window title, field, OCR)", async () => {
    const e2 = mkEngine(withArgs(["--title", `Doc ${FAKE_KEY}`, "--prefill", SECRET_NOTE]));
    await e2.prepare();
    const r = await run([T()], {}, e2);
    const pid = (audit.list(10).find((e) => e.kind === "desktop.launch")!.detail as any).pid as number;
    const wins = await bridge.windows(pid);
    expect(JSON.stringify(wins)).not.toContain(FAKE_KEY);
    expect(wins[0]!.title).toContain("[redacted]");
    const tree = await bridge.tree(wins[0]!.handle, pid);
    const notes = tree.nodes.find((n) => n.name === "Notes")!;
    expect(notes.value).toContain("[redacted]");
    expect(notes.value).not.toContain(FAKE_KEY);
    expect(notes.valueLength).toBe(SECRET_NOTE.length);
    const read = await run([{ do: "read", target: { name: "Notes" } }], { session: r.session! }, e2);
    expect(JSON.stringify(read)).not.toContain(FAKE_KEY);
    const scr = await run([{ do: "read_screen" }], { session: r.session! }, e2);
    expect(JSON.stringify(scr)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(audit.list(500))).not.toContain(FAKE_KEY);
  });

  it("does not replace existing text unless the plan allows it, and refuses to close a window holding text", async () => {
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--prefill", "EXISTING WORK", "--state", sf]));
    await e2.prepare();
    const r = await run([T(), { do: "type", target: { name: "Notes" }, text: "overwrite attempt" }], {}, e2);
    expect(r.results[1]!.detail).toMatch(/already contains text/);
    const c = await run([{ do: "close_window" }], { session: r.session! }, e2);
    expect(c.results[0]!.status).toBe("failed");
    expect(c.results[0]!.detail).toMatch(/holds text/);
    await sleep(500);
    expect(state(sf)).toMatchObject({ notes: "EXISTING WORK", closed: false });
    // only with explicit say-so, in a plan that allows destructive steps
    const ok = await run([{ do: "type", target: { name: "Notes" }, text: "replaced on purpose", overwrite: true }, { do: "close_window", discard: true }], { session: r.session!, allowDestructive: true }, e2);
    expect(ok.finished).toBe(true);
    await until(() => state(sf).closed === true);
  });

  it("stops at an unexpected dialog, lists its buttons, and a follow-up plan dismisses it", async () => {
    const r = await run([T(), { do: "click", target: { name: "Show Message" } }, { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r.finished).toBe(false);
    expect(r.results).toHaveLength(2);
    expect(r.results[1]!.status).toBe("stopped");
    expect(r.results[1]!.detail).toMatch(/Surprise/);
    expect(r.results[1]!.detail).toMatch(/OK/);
    const fix = await run([{ do: "click", target: { name: "OK" }, window: { titleContains: "Surprise" }, expect: { windowGone: "Surprise" } }], { session: r.session! });
    expect(fix.results[0]).toMatchObject({ status: "ok", evidence: "expected_state_confirmed" });
  });

  it("captures only the target window, reads it with OCR combined with UI Automation, and leaves no picture behind", async () => {
    const r = await run([T(), { do: "read_screen" }]);
    expect(r.results[1]!.status).toBe("ok");
    const d = r.results[1]!.data as any;
    expect(d.private).toBe(true);
    expect(d.controls.map((c: any) => c.name)).toEqual(expect.arrayContaining(["Compute", "Notes"]));
    expect(JSON.stringify(d.ocrLines)).toMatch(/4711/);
    expect(readdirSync(join(root, "private")).filter((f) => f.startsWith("shot-"))).toEqual([]);
  });

  it("sends keys only after proving the window is in front, and only to the engine's own window", async () => {
    const sf = sfile();
    await startUserInstance("USER NOTE", sf);
    const sf2 = sfile();
    const e2 = mkEngine(withArgs(["--state", sf2]));
    await e2.prepare();
    const r = await run([T(), { do: "focus", target: { name: "Notes" } }, { do: "keys", keys: "abc", expect: { control: { name: "Notes" }, valueContains: "abc" } }], {}, e2);
    await sleep(600);
    // the user's window never receives a key, whatever happened to the engine's own
    expect(state(sf).notes).toBe("USER NOTE");
    if (r.results[2]!.status === "ok") {
      expect(r.results[2]!.evidence).toBe("expected_state_confirmed");
      expect(state(sf2).notes).toBe("abc");
    } else expect(r.results[2]!.detail).toMatch(/no keys were sent|took the focus|front|NOT seen/);
  });
});

describe.skipIf(!isWin)("REAL WINDOWS: permissions, revocation and the Guardian act on real windows", () => {
  it("rejects an application nobody approved: nothing is started", async () => {
    const r = await run([T()]);
    expect(r.results[0]!.status).toBe("failed");
    expect(engine.sessionInfo()).toHaveLength(0);
  });

  it("sees a revoke between two steps and does nothing further", async () => {
    approveAll(ids.test);
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--state", sf]));
    await e2.prepare();
    const r1 = await run([T(), { do: "toggle", target: { name: "Enable feature" } }], {}, e2);
    expect(r1.finished).toBe(true);
    access.apps.revoke(access.identityOf(ids.test)!, "owner");
    const r2 = await run([{ do: "toggle", target: { name: "Enable feature" } }], { session: r1.session! }, e2);
    expect(r2.results[0]!.status).toBe("failed");
    expect(r2.results[0]!.detail).toMatch(/approve it for this session first/);
    await sleep(500);
    expect(state(sf).feature).toBe(true); // switched once, not twice
  });

  it("stops at the next step boundary when the Guardian pauses", async () => {
    approveAll(ids.test);
    const sf = sfile();
    const e2 = mkEngine(withArgs(["--state", sf]));
    await e2.prepare();
    const r1 = await run([T()], {}, e2);
    expect(r1.session, JSON.stringify(r1.results)).toBeTruthy();
    held = "the Windows session is locked";
    const r2 = await run([{ do: "toggle", target: { name: "Enable feature" } }], { session: r1.session! }, e2);
    expect(r2.results[0]!.status).toBe("stopped");
    expect(r2.stoppedBecause).toMatch(/Guardian/);
    held = null;
    await sleep(500);
    expect(state(sf).feature).toBe(false);
  });

  it("refuses a session once the Windows host was restarted (identity can no longer be proven)", async () => {
    approveAll(ids.test);
    const r1 = await run([T()]);
    bridge.stop();
    const r2 = await run([{ do: "toggle", target: { name: "Enable feature" } }], { session: r1.session! });
    expect(r2.results[0]!.status).toBe("failed");
    expect(r2.results[0]!.detail).toMatch(/restarted|not registered|Windows host/);
    await engine.prepare();
  });

  it("saves a file only inside an approved folder, through the real Save dialog, and verifies the output on disk", async () => {
    approveAll(ids.test);
    grantData();
    const out = join(root, "data", "result.txt");
    const r = await run([
      T(),
      { do: "type", target: { name: "Notes" }, text: "Saved by the engine" },
      { do: "click", target: { name: "Save As..." }, expectDialog: "Save" },
      { do: "file_dialog", mode: "save", path: out },
    ]);
    expect(r.finished, JSON.stringify(r.results.map((x) => x.detail))).toBe(true);
    expect(r.results[3]!.evidence).toBe("expected_state_confirmed");
    expect(readFileSync(out, "utf8")).toBe("Saved by the engine");
  });

  it("refuses a path outside the approved folder, and after a revoke: the real dialog is not touched and no file appears", async () => {
    approveAll(ids.test);
    const g = grantData();
    const outside = join(root, "elsewhere", "no.txt");
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    const r = await run([T(), { do: "click", target: { name: "Save As..." }, expectDialog: "Save" }, { do: "file_dialog", mode: "save", path: outside }]);
    expect(r.results[2]!.detail).toMatch(/Folder permission/);
    expect(existsSync(outside)).toBe(false);
    access.folders.revoke(g.id, "owner");
    const r2 = await run([{ do: "file_dialog", mode: "save", path: join(root, "data", "late.txt") }], { session: r.session! });
    expect(r2.results[0]!.detail).toMatch(/Folder permission/);
    expect(existsSync(join(root, "data", "late.txt"))).toBe(false);
    // the dialog can still be cancelled (the only click allowed there)
    const c = await run([{ do: "click", target: { name: "Cancel" }, expect: { windowGone: "Save test file" } }], { session: r.session! });
    expect(c.results[0]!.status).toBe("ok");
  });

  it("OPENS a file only with folder READ permission: the real Open dialog loads it and the engine reads it back", async () => {
    approveAll(ids.test);
    grantData(["read"]);
    const src = join(root, "data", "source.txt");
    writeFileSync(src, "Quarterly notes: fake data for the test");
    const r = await run([T(), { do: "click", target: { name: "Open..." }, expectDialog: "Open" }, { do: "file_dialog", mode: "open", path: src }, { do: "read", target: { name: "Notes" } }]);
    expect(r.finished, JSON.stringify(r.results.map((x) => x.detail))).toBe(true);
    expect(r.results[2]!.evidence).toBe("expected_state_confirmed");
    expect((r.results[3]!.data as any).text).toBe("Quarterly notes: fake data for the test");
    expect(readFileSync(src, "utf8")).toBe("Quarterly notes: fake data for the test"); // opening never changes the file
  });

  it("refuses to open a file without READ permission, or outside the approved folder; the dialog is left for Cancel", async () => {
    approveAll(ids.test);
    grantData(["create"]); // create only: no read
    const src = join(root, "data", "secret-plan.txt");
    writeFileSync(src, "not for the bot");
    const r = await run([T(), { do: "click", target: { name: "Open..." }, expectDialog: "Open" }, { do: "file_dialog", mode: "open", path: src }]);
    expect(r.results[2]!.detail).toMatch(/Folder permission/);
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    writeFileSync(join(root, "elsewhere", "x.txt"), "x");
    const r2 = await run([{ do: "file_dialog", mode: "open", path: join(root, "elsewhere", "x.txt") }], { session: r.session! });
    expect(r2.results[0]!.detail).toMatch(/Folder permission/);
    const c = await run([{ do: "click", target: { name: "Cancel" }, expect: { windowGone: "Open test file" } }], { session: r.session! });
    expect(c.results[0]!.status).toBe("ok");
  });

  it("EDITS an existing file: open, change the text, save over it only with EDIT permission and an explicit overwrite, then verify on disk", async () => {
    approveAll(ids.test);
    const doc = join(root, "data", "draft.txt");
    // 1. read + create but no edit: replacing the existing file is refused before the dialog is touched
    let g = grantData(["read", "create"]);
    writeFileSync(doc, "Version 1");
    const r = await run([
      T(),
      { do: "click", target: { name: "Open..." }, expectDialog: "Open" },
      { do: "file_dialog", mode: "open", path: doc },
      { do: "type", target: { name: "Notes" }, text: "Version 2, edited by the engine", overwrite: true },
      { do: "click", target: { name: "Save As..." }, expectDialog: "Save" },
      { do: "file_dialog", mode: "save", path: doc },
    ], { allowDestructive: true }); // replacing the Notes text is destructive: the owner allows it for this plan
    expect(r.results[5]!.detail).toMatch(/already exists.*overwrite/);
    const noEdit = await run([{ do: "file_dialog", mode: "save", path: doc, overwrite: true }], { session: r.session!, allowDestructive: true });
    expect(noEdit.results[0]!.detail).toMatch(/Folder permission/);
    expect(readFileSync(doc, "utf8")).toBe("Version 1");
    // 2. with EDIT permission and overwrite, the real "replace?" prompt is answered and the new text is on disk
    access.folders.revoke(g.id, "owner");
    g = grantData(["read", "create", "edit"]);
    const ok = await run([{ do: "file_dialog", mode: "save", path: doc, overwrite: true }], { session: r.session!, allowDestructive: true });
    expect(ok.results[0]!.status, ok.results[0]!.detail).toBe("ok");
    expect(readFileSync(doc, "utf8")).toBe("Version 2, edited by the engine");
  });

  it("refuses generic clicking and typing inside the real file dialog", async () => {
    approveAll(ids.test);
    grantData();
    const r = await run([T(), { do: "click", target: { name: "Save As..." }, expectDialog: "Save" }, { do: "click", target: { name: "Save", type: "Button" } }]);
    expect(r.results[2]!.detail).toMatch(/file_dialog/);
    const k = await run([{ do: "keys", keys: "{ENTER}" }], { session: r.session! });
    expect(k.results[0]!.detail).toMatch(/file_dialog/);
  });
});

describe.skipIf(!isWin)("REAL WINDOWS: an installed Windows utility (Winver)", () => {
  it("opens, is read through UI Automation and OCR, and is closed again, with approvals checked at each step", async () => {
    approveAll(ids.winver);
    const r = await run([{ do: "launch", app: ids.winver }, { do: "read_screen" }]);
    if (!r.results[0]!.detail.startsWith("Started")) {
      // the utility handed over to another process on this build: the engine must refuse, and it did (that is the safe outcome)
      expect(r.results[0]!.detail).toMatch(/handed over|opened no window|could not be proven/);
      return;
    }
    expect(r.results[1]!.status).toBe("ok");
    expect(JSON.stringify((r.results[1]!.data as any).ocrLines)).toMatch(/windows/i);
    const view = await engine.inspect(r.session!);
    expect(view.controls.length).toBeGreaterThan(0);
    const c = await run([{ do: "click", target: { name: "OK", type: "Button" }, expect: { windowGone: "About Windows" } }], { session: r.session! });
    expect(c.results[0]!.status).toBe("ok");
  });
});

describe.skipIf(!isWin)("REAL WINDOWS: privacy of screenshots and text", () => {
  it("makes no network connection of its own: the host script and the engine contain no network code", () => {
    const src = [readFileSync(join(__dirname, "host-script.ts"), "utf8"), readFileSync(join(__dirname, "engine.ts"), "utf8"), readFileSync(join(__dirname, "bridge.ts"), "utf8")].join("\n");
    for (const banned of [/Invoke-WebRequest/i, /Invoke-RestMethod/i, /WebClient/i, /System\.Net\./, /node:http/, /node:https/, /\bfetch\(/, /node:net/, /Start-Process/i, /Invoke-Expression/i, /\biex\b/]) {
      expect(src, String(banned)).not.toMatch(banned);
    }
  });
  it("leaves no picture in the private folder after all the screen reads above", () => {
    const dir = join(root, "private");
    if (existsSync(dir)) expect(readdirSync(dir).filter((f) => f.startsWith("shot-"))).toEqual([]);
    writeFileSync(join(root, "marker"), "x");
  });
});
