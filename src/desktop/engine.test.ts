import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessService } from "../access/service.js";
import type { FsProbe } from "../access/paths.js";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { badKeys, cleanEnv, DesktopEngine, type Launcher } from "./engine.js";
import { FakeBridge, node, type FakeWin } from "./fake-bridge.js";
import type { OcrLine } from "./bridge.js";
import { runSchema, type Step } from "./steps.js";

/* MOCKED tests: a pretend Windows (fake-bridge.ts) that follows the host's rules. The real host is tested in real-windows.test.ts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const clock = { t: Date.parse("2026-11-04T09:00:00Z") };
class FakeFs implements FsProbe {
  dirs = new Set<string>(["d:\\work", "d:\\work\\proj"]);
  resolve(p: string) {
    return p;
  }
  isDirectory(p: string) {
    return this.dirs.has(p.toLowerCase());
  }
}

let dir: string;
let exe: string;
let held: string | null;
let bridge: FakeBridge;
let audit: AuditLog;
let access: AccessService;
let engine: DesktopEngine;
let launches: { exe: string; env: NodeJS.ProcessEnv }[];
let killed: number[];
let mode: "normal" | "handoff";
let nextPid: number;
let appId: string;
let dialogOpen: boolean;

const mainWin = (pid: number): FakeWin => ({
  handle: pid * 10,
  title: "Notes",
  className: "WindowsForms10.Window",
  nodes: [
    node("0", "Edit", "Notes", { automationId: "notes", value: "", valueLength: 0, patterns: ["Value"] }),
    node("1", "Edit", "Password", { secret: true, valueLength: 12, patterns: ["Value"] }),
    node("2", "CheckBox", "Enable feature", { toggle: "Off", patterns: ["Toggle"] }),
    node("3", "Button", "Compute", { automationId: "compute" }),
    node("4", "Button", "Show Message", { automationId: "boom" }),
    node("5", "Button", "Save As...", { automationId: "saveas" }),
    node("6", "Text", "Result", { value: "Result: none", valueLength: 12 }),
  ],
});
const fileDialog = (pid: number): FakeWin => ({
  handle: pid * 10 + 1,
  title: "Save test file",
  className: "#32770",
  nodes: [node("0", "ComboBox", "File name:", { automationId: "1001" }), node("0.0", "Edit", "File name:", { automationId: "1001", patterns: ["Value"] }), node("1", "Button", "Save", { automationId: "1" }), node("2", "Button", "Cancel", { automationId: "2" })],
});

const launcher: Launcher = (e, _cwd, env) => {
  launches.push({ exe: e, env });
  const pid = nextPid++;
  if (mode === "normal") bridge.worlds.set(pid, [mainWin(pid)]);
  return { pid, kill: () => killed.push(pid), exited: () => mode === "handoff" };
};

beforeEach(async () => {
  clock.t = Date.parse("2026-11-04T09:00:00Z");
  dir = mkdtempSync(join(tmpdir(), "awp-eng-"));
  exe = join(dir, "notes.exe");
  writeFileSync(exe, "x");
  held = null;
  launches = [];
  killed = [];
  mode = "normal";
  nextPid = 1000;
  dialogOpen = false;
  bridge = new FakeBridge();
  audit = new AuditLog(openDatabase(":memory:"), () => clock.t);
  const kv = new Map<string, string>();
  const fs = new FakeFs();
  access = new AccessService({
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    audit,
    now: () => clock.t,
    guardHeld: () => held,
    fs,
    home: "C:\\Users\\owner",
    hashFile: () => "h1",
    discover: async () => ({
      installed: [{ name: "Notes", version: "1", publisher: "Acme", location: dir, icon: `${exe},0` }],
      procs: [],
      services: [],
      startup: [],
      tasks: [],
      sigs: [{ path: exe, signer: "CN=Acme" }],
    }),
  });
  await access.scan();
  appId = access.identityOf(access.view().apps[0]!.id)!.id;
  engine = new DesktopEngine({ bridge, access, audit, now: () => clock.t, guardHeld: () => held, privateDir: join(dir, "private"), launcher, sleep: async (ms) => void (clock.t += ms), hashFile: () => "h1" });
  bridge.onInvoke = (pid, win, n) => {
    if (n.automationId === "compute") win.nodes.find((x) => x.name === "Result")!.value = "Result: 42";
    if (n.automationId === "boom") bridge.worlds.get(pid)!.unshift({ handle: pid * 10 + 2, title: "Surprise", className: "#32770", nodes: [node("0", "Button", "OK")] });
    if (n.automationId === "saveas") bridge.worlds.get(pid)!.unshift(fileDialog(pid));
    if (n.name === "OK") bridge.worlds.set(pid, bridge.worlds.get(pid)!.filter((w) => w.title !== "Surprise"));
  };
});

const approve = (caps: string[], level: "approved" | "trusted" = "approved") => access.apps.set(access.identityOf(appId)!, { level, capabilities: caps, ...(level === "trusted" ? { reviewInDays: 30 } : {}) }, "owner");
const run = (steps: Step[], extra: Record<string, unknown> = {}) => engine.run({ steps, ...extra } as any);
const launchStep: Step = { do: "launch", app: "" };
const L = (): Step => ({ ...launchStep, app: appId }) as Step;
const kinds = () => audit.list(500).map((e) => e.kind);
const auditText = () => JSON.stringify(audit.list(500));

describe("only approved applications, only what was approved", () => {
  it("refuses an application nobody approved, and starts nothing", async () => {
    const r = await run([L()]);
    expect(r.finished).toBe(false);
    expect(r.results[0]!.detail).toMatch(/approve it for this session first/);
    expect(launches).toHaveLength(0);
    expect(bridge.calls.filter((c) => c.startsWith("register"))).toHaveLength(0);
  });

  it("refuses a protected application however it is asked", async () => {
    const prot = new AccessService({
      kv: { get: () => null, set: () => undefined },
      audit,
      now: () => clock.t,
      hashFile: () => "h",
      discover: async () => ({ installed: [{ name: "UltraViewer", version: "1", publisher: "X", location: dir, icon: `${exe},0` }], procs: [], services: [], startup: [], tasks: [], sigs: [] }),
    });
    await prot.scan();
    const e2 = new DesktopEngine({ bridge, access: prot, audit, now: () => clock.t, guardHeld: () => null, privateDir: join(dir, "p2"), launcher, sleep: async () => undefined, hashFile: () => "h" });
    const r = await e2.run(runSchema.parse({ steps: [{ do: "launch", app: prot.identityOf(prot.view().apps[0]!.id)!.id }] }));
    expect(r.results[0]!.detail).toMatch(/protected/i);
    expect(launches).toHaveLength(0);
  });

  it("respects Open, View, Control and Close one by one", async () => {
    approve(["open"]);
    let r = await run([L(), { do: "read_screen" }]);
    expect(r.results[1]!.detail).toMatch(/not to see what the program shows/);
    approve(["open", "view"]);
    r = await run([L(), { do: "click", target: { name: "Compute" } }]);
    expect(r.results[1]!.detail).toMatch(/not to operate the program/);
    approve(["open", "view", "control"]);
    r = await run([L(), { do: "close_window" }]);
    expect(r.results[1]!.detail).toMatch(/not to close the program/);
    expect(bridge.calls.some((c) => c.startsWith("close"))).toBe(false);
  });

  it("sees a revoke on the very next operation", async () => {
    approve(["open", "view", "control"]);
    bridge.onAct = () => access.apps.revoke(access.identityOf(appId)!, "owner");
    const r = await run([L(), { do: "click", target: { name: "Compute" } }, { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r.results.map((x) => x.status)).toEqual(["ok", "ok", "failed"]);
    expect(r.results[2]!.detail).toMatch(/approve it for this session first/);
    expect(bridge.calls.filter((c) => c.startsWith("act:toggle"))).toHaveLength(0);
  });

  it("stops at the next step boundary when the Guardian pauses, and runs nothing more", async () => {
    approve(["open", "view", "control"]);
    bridge.onAct = () => (held = "the Windows session is locked");
    const r = await run([L(), { do: "click", target: { name: "Compute" } }, { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r.finished).toBe(false);
    expect(r.results.at(-1)!).toMatchObject({ status: "stopped" });
    expect(r.stoppedBecause).toMatch(/Guardian/);
    expect(bridge.calls.filter((c) => c.startsWith("act:toggle"))).toHaveLength(0);
    expect(kinds()).toContain("desktop.interrupted");
  });

  it("refuses to launch at all while the Guardian holds", async () => {
    approve(["open"]);
    held = "STOP";
    const r = await run([L()]);
    expect(r.results[0]!.status).toBe("stopped");
    expect(launches).toHaveLength(0);
  });
});

describe("process ownership and window identity (the 2026-11-04 incident)", () => {
  beforeEach(() => approve(["open", "view", "control", "close"]));

  it("refuses a launch that handed over to another process: no window of its own means nothing is controlled", async () => {
    mode = "handoff";
    const r = await run([L(), { do: "type", target: { name: "Notes" }, text: "x" }]);
    expect(r.results[0]!.detail).toMatch(/handed over to another process/);
    expect(killed).toEqual([1000]);
    expect(bridge.calls.some((c) => c.startsWith("act"))).toBe(false);
    expect(bridge.registered.size).toBe(0);
  });

  it("refuses when the host cannot prove the process was started by the engine", async () => {
    bridge.registerError = "That process was not started by the desktop engine. Refusing.";
    const r = await run([L()]);
    expect(r.results[0]!.detail).toMatch(/could not be proven/);
    expect(killed).toEqual([1000]);
  });

  it("has no way to attach to a running program: every session starts from a launch", async () => {
    const r = await run([{ do: "click", target: { name: "Compute" } }]);
    expect(r.results[0]!.detail).toMatch(/Start with a launch step/);
    const r2 = await run([{ do: "click", target: { name: "Compute" } }], { session: "s0123456789ab" });
    expect(r2.results[0]!.detail).toMatch(/does not exist/);
    expect(bridge.calls.some((c) => c.startsWith("act"))).toBe(false);
  });

  it("refuses a session after the Windows host restarted (its registry is gone)", async () => {
    const r1 = await run([L()]);
    bridge.epoch += 1;
    const r2 = await run([{ do: "click", target: { name: "Compute" } }], { session: r1.session! });
    expect(r2.results[0]!.detail).toMatch(/restarted/);
  });

  it("passes the launched program no secrets from the environment", () => {
    const env = cleanEnv({ PATH: "x", GEMINI_API_KEY: "k", GITHUB_TOKEN: "t", MY_PASSWORD: "p", GUARDIAN_URL: "u", SystemRoot: "C:\\Windows", COOKIE_JAR: "c" });
    expect(Object.keys(env).sort()).toEqual(["PATH", "SystemRoot"]);
  });

  it("starts the program with a cleaned environment", async () => {
    process.env["AWP_TEST_API_KEY"] = "do-not-pass";
    await run([L()]);
    delete process.env["AWP_TEST_API_KEY"];
    expect(launches[0]!.env["AWP_TEST_API_KEY"]).toBeUndefined();
  });
});

describe("content is never replaced, closed over, or read without say-so", () => {
  beforeEach(() => approve(["open", "view", "control", "close"]));

  it("types into an empty field and confirms by reading it back", async () => {
    const r = await run([L(), { do: "type", target: { name: "Notes" }, text: "hello" }]);
    expect(r.results[1]).toMatchObject({ status: "ok", evidence: "readback_confirmed" });
  });

  it("refuses to replace text that is already there unless the plan says overwrite AND allows destructive steps", async () => {
    const r1 = await run([L(), { do: "type", target: { name: "Notes" }, text: "first" }, { do: "type", target: { name: "Notes" }, text: "second" }]);
    expect(r1.results[2]!.detail).toMatch(/already contains text/);
    const r2 = await run([L(), { do: "type", target: { name: "Notes" }, text: "a" }, { do: "type", target: { name: "Notes" }, text: "b", overwrite: true }]);
    expect(r2.results[0]!.detail).toMatch(/allowDestructive/);
    const r3 = await run([L(), { do: "type", target: { name: "Notes" }, text: "a" }, { do: "type", target: { name: "Notes" }, text: "b", overwrite: true }], { allowDestructive: true });
    expect(r3.finished).toBe(true);
  });

  it("never reads or writes a password field", async () => {
    const w = await run([L(), { do: "type", target: { name: "Password" }, text: "x" }]);
    expect(w.results[1]!.detail).toMatch(/never written/);
    const r = await run([L(), { do: "read", target: { name: "Password" } }]);
    expect(r.results[1]!.detail).toMatch(/never read/);
  });

  it("refuses to close a window that holds text, unless discarding is explicitly allowed", async () => {
    const r = await run([L(), { do: "type", target: { name: "Notes" }, text: "my unsaved work" }, { do: "close_window" }]);
    expect(r.results[2]!).toMatchObject({ status: "failed" });
    expect(r.results[2]!.detail).toMatch(/holds text/);
    expect(bridge.worlds.get(1000)!).toHaveLength(1);
    const r2 = await run([{ do: "close_window", discard: true }], { session: r.session! });
    expect(r2.results[0]!.detail).toMatch(/allowDestructive/);
    const r3 = await run([{ do: "close_window", discard: true }], { session: r.session!, allowDestructive: true });
    expect(r3.results[0]!).toMatchObject({ status: "ok" });
  });

  it("never lets the model see field contents in an inspection (lengths only)", async () => {
    const r = await run([L(), { do: "type", target: { name: "Notes" }, text: "private note" }]);
    const view = await engine.inspect(r.session!);
    expect(JSON.stringify(view)).not.toContain("private note");
    expect(view.controls.find((c) => c.name === "Notes")!.valueLength).toBe(12);
  });
});

describe("nothing is claimed without evidence", () => {
  beforeEach(() => approve(["open", "view", "control", "close"]));

  it("a click with no expectation and no visible change is reported as NOT verified", async () => {
    const r = await run([L(), { do: "click", target: { name: "Save As..." }, expectDialog: "Save" }]);
    expect(r.results[1]!.evidence).not.toBe("expected_state_confirmed");
    const r2 = await run([L(), { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r2.results[1]).toMatchObject({ evidence: "readback_confirmed" });
    const r3 = await run([L(), { do: "click", target: { name: "Compute" } }]);
    expect(r3.results[1]!.evidence).toBe("state_changed");
    expect(r3.summary).toMatch(/not all were independently confirmed/);
    expect(r3.summary).not.toMatch(/All steps performed and confirmed/);
  });

  it("an expectation that is not met makes the step FAIL, whatever the click did", async () => {
    const r = await run([L(), { do: "click", target: { name: "Compute" }, expect: { control: { name: "Result" }, valueEquals: "Result: 43", withinMs: 500 } }]);
    expect(r.results[1]).toMatchObject({ status: "failed", evidence: "none" });
    expect(r.results[1]!.detail).toMatch(/NOT seen/);
    const ok = await run([L(), { do: "click", target: { name: "Compute" }, expect: { control: { name: "Result" }, valueEquals: "Result: 42" } }]);
    expect(ok.results[1]).toMatchObject({ status: "ok", evidence: "expected_state_confirmed" });
    expect(ok.summary).toMatch(/confirmed/);
  });

  it("a read-back mismatch is a failure, not a success", async () => {
    bridge.onAct = () => undefined;
    const orig = bridge.act.bind(bridge);
    bridge.act = async (p) => {
      const r = await orig(p);
      if (p.action === "setvalue" && r.after) r.after.valueLength = 1;
      return r;
    };
    const r = await run([L(), { do: "type", target: { name: "Notes" }, text: "hello" }]);
    expect(r.results[1]).toMatchObject({ status: "failed", evidence: "none" });
  });

  it("refuses an ambiguous target instead of guessing", async () => {
    const r = await run([L(), { do: "click", target: { nameContains: "e", type: "Button" } }]);
    expect(r.results[1]!.detail).toMatch(/More than one control matches/);
    expect(bridge.calls.some((c) => c.startsWith("act:invoke"))).toBe(false);
  });
});

describe("unexpected dialogs", () => {
  beforeEach(() => approve(["open", "view", "control", "close"]));

  it("stops at a dialog the plan did not expect, names its buttons, and runs nothing further", async () => {
    const r = await run([L(), { do: "click", target: { name: "Show Message" } }, { do: "toggle", target: { name: "Enable feature" } }]);
    expect(r.results[1]!.status).toBe("stopped");
    expect(r.results[1]!.detail).toMatch(/Surprise/);
    expect(r.results[1]!.detail).toMatch(/OK/);
    expect(bridge.calls.some((c) => c.startsWith("act:toggle"))).toBe(false);
  });

  it("can then dismiss it in a follow-up plan that names it", async () => {
    const r = await run([L(), { do: "click", target: { name: "Show Message" } }]);
    const r2 = await run([{ do: "click", target: { name: "OK" }, window: { titleContains: "Surprise" }, expect: { windowGone: "Surprise" } }], { session: r.session! });
    expect(r2.results[0]).toMatchObject({ status: "ok", evidence: "expected_state_confirmed" });
  });

  it("continues when the plan said which dialog to expect", async () => {
    const r = await run([L(), { do: "click", target: { name: "Show Message" }, expectDialog: "Surprise" }, { do: "click", target: { name: "OK" }, window: { titleContains: "Surprise" } }]);
    expect(r.results.map((x) => x.status)).toEqual(["ok", "ok", "ok"]);
  });
});

describe("files only through the file dialog, with the folder permissions", () => {
  beforeEach(async () => {
    approve(["open", "view", "control", "close"]);
    access.folders.grant({ subject: "workforce", path: "D:\\work\\proj", ops: ["read", "create"], inherit: false }, "owner");
  });
  const toDialog = (): Step[] => [L(), { do: "click", target: { name: "Save As..." }, expectDialog: "Save" }];

  it("refuses generic clicks, typing and keys inside a file dialog (they would bypass the folder check)", async () => {
    const r = await run([...toDialog(), { do: "click", target: { name: "Save" } }]);
    expect(r.results[2]!.detail).toMatch(/file_dialog/);
    const r2 = await run([{ do: "type", target: { name: "File name:", type: "Edit" }, text: "D:\\anywhere\\x.txt" }], { session: r.session! });
    expect(r2.results[0]!.detail).toMatch(/file_dialog/);
    const r3 = await run([{ do: "keys", keys: "{ENTER}" }], { session: r.session! });
    expect(r3.results[0]!.detail).toMatch(/file_dialog/);
    expect(bridge.calls.filter((c) => c.startsWith("act:setvalue") || c.startsWith("keys"))).toHaveLength(0);
  });

  it("refuses a folder nobody approved: the dialog is not touched", async () => {
    const r = await run([...toDialog(), { do: "file_dialog", mode: "save", path: "D:\\work\\other\\x.txt" }]);
    expect(r.results[2]!.detail).toMatch(/Folder permission/);
    expect(bridge.calls.filter((c) => c.startsWith("act:setvalue"))).toHaveLength(0);
    expect(kinds()).toContain("desktop.file_denied");
  });

  it("refuses a secrets place even inside an approved folder, and a relative or network path", async () => {
    for (const p of ["D:\\work\\proj\\.env", "relative.txt", "\\\\server\\share\\x.txt"]) {
      const r = await run([...toDialog(), { do: "file_dialog", mode: "save", path: p }]);
      expect(r.results[2]!.status, p).toBe("failed");
    }
    expect(bridge.calls.filter((c) => c.startsWith("act:setvalue"))).toHaveLength(0);
  });

  it("notices a revoke made after the check and before the click: nothing is written", async () => {
    let n = 0;
    bridge.onAct = (action) => {
      if (action === "setvalue" && ++n === 1) access.folders.revokeAll("owner");
    };
    const r = await run([...toDialog(), { do: "file_dialog", mode: "save", path: "D:\\work\\proj\\out.txt" }]);
    expect(r.results[2]!.detail).toMatch(/withdrawn|Folder permission/);
    expect(bridge.calls.filter((c) => c.startsWith("act:invoke:1")).length).toBe(0);
  });

  it("an approved path fills the dialog and clicks Save, then does not claim success until the file exists", async () => {
    const r = await run([...toDialog(), { do: "file_dialog", mode: "save", path: "D:\\work\\proj\\out.txt" }]);
    // the pretend dialog never closes or writes, so the engine must say so instead of reporting success
    expect(r.results[2]!.status).toBe("failed");
    expect(r.results[2]!.detail).toMatch(/Not confirmed|still open/);
  });
});

// The standard Windows OPEN dialog differs from the Save dialog: its file-name box is Edit#1148 (no #1001), and its folder listing has
// "System.ItemNameDisplay" cells whose names are file names (both seen on a real window, 2026-11-04). Before the fix the engine's open step
// could not find the box, and inspect() returned the listing rows.
describe("the Open dialog (Edit#1148, folder listing with file names)", () => {
  const openDialog = (pid: number): FakeWin => ({
    handle: pid * 10 + 3,
    title: "Open test file",
    className: "#32770",
    nodes: [
      node("0", "Pane", "Shell Folder View"),
      node("0.0", "List", "Items View"),
      node("0.0.0", "ListItem", "Bank-statement-2026.pdf"),
      node("0.0.0.0", "Edit", "Bank-statement-2026.pdf", { automationId: "System.ItemNameDisplay" }),
      node("0.0.0.1", "Edit", "12 KB", { automationId: "System.Size" }),
      node("1", "ToolBar", "Address: C:\\Users\\owner\\Documents\\Private"),
      node("2", "Text", "File name:", { automationId: "1090" }),
      node("3", "Edit", "File name:", { automationId: "1148", patterns: ["Value"] }),
      node("4", "Button", "Open", { automationId: "1" }),
      node("5", "Button", "Cancel", { automationId: "2" }),
    ],
  });
  beforeEach(() => {
    approve(["open", "view", "control", "close"]);
    const before = bridge.onInvoke;
    bridge.onInvoke = (pid, win, n) => {
      if (n.automationId === "openbtn") bridge.worlds.get(pid)!.unshift(openDialog(pid));
      before?.(pid, win, n);
    };
  });
  const toOpen = async () => {
    const r = await run([L()]);
    bridge.worlds.get(1000)!.find((w) => w.title === "Notes")!.nodes.push(node("7", "Button", "Open...", { automationId: "openbtn" })); // the first launch gets pid 1000
    return run([{ do: "click", target: { name: "Open..." }, expectDialog: "Open" }], { session: r.session! });
  };

  it("is recognised as a file dialog without a #1001 control, and inspect() never shows the folder listing or the address", async () => {
    const r = await toOpen();
    expect(r.results[0]!.status, r.results[0]!.detail).not.toBe("failed");
    const view = await engine.inspect(r.session!);
    expect(view.window.fileDialog).toBe(true);
    const ids = view.controls.map((c: any) => c.automationId);
    expect(ids.sort()).toEqual(["1", "1090", "1148", "2"]);
    const shown = JSON.stringify(view);
    expect(shown).not.toContain("Bank-statement");
    expect(shown).not.toContain("Private");
    expect(shown).not.toContain("12 KB");
  });

  it("refuses reading a listing cell, clicking in the listing, and screen capture of the Open dialog", async () => {
    const r = await toOpen();
    const read = await run([{ do: "read", target: { name: "Bank-statement-2026.pdf", type: "Edit" } }], { session: r.session! });
    expect(read.results[0]!.status).toBe("failed");
    expect(JSON.stringify(read)).not.toContain("12 KB");
    const click = await run([{ do: "click", target: { name: "Bank-statement-2026.pdf", type: "ListItem" } }], { session: r.session! });
    expect(click.results[0]!.detail).toMatch(/file_dialog/);
    const shot = await run([{ do: "read_screen" }], { session: r.session! });
    expect(shot.results[0]!.detail).toMatch(/never captured/);
    expect(bridge.calls.filter((c) => c.startsWith("act:"))).toEqual(expect.not.arrayContaining([expect.stringMatching(/Bank-statement/)]));
  });
});

describe("keyboard shortcuts", () => {
  it("allows ordinary shortcuts and refuses ones that leave or close the application", () => {
    for (const ok of ["^s", "^a", "{ENTER}", "hello{TAB}world", "^(ac)", "%f", "{F5}", "^{HOME}"]) expect(badKeys(ok), ok).toBeNull();
    for (const bad of ["%{F4}", "%{TAB}", "%{ESC}", "^{ESC}", "^+{ESC}", "{WIN}", "[x]", "{LWIN}", "a\\b", "^%{DEL}x{", "%(x{F4})"]) expect(badKeys(bad), bad).not.toBeNull();
  });
});

describe("screen reading keeps the picture and the text local", () => {
  beforeEach(() => approve(["open", "view"]));
  const lines = (...t: string[]): OcrLine[] => t.map((text) => ({ text, redacted: false, words: [{ text, rect: [1, 2, 3, 4] }] }));

  it("combines UI Automation and OCR, labels the result private, and deletes the picture", async () => {
    bridge.ocrLines = lines("OCR-TEST-4711 hello world", "Compute");
    const r = await run([L(), { do: "read_screen" }]);
    expect(r.results[1]!.data!["private"]).toBe(true);
    expect((r.results[1]!.data!["ocrOnly"] as string[])).toEqual(["OCR-TEST-4711 hello world"]);
    expect(existsSync(bridge.lastCapture!)).toBe(false);
    expect(readdirSync(join(dir, "private"))).toEqual([]);
  });

  it("deletes the picture even when OCR fails", async () => {
    bridge.ocrError = "No Windows OCR language is installed.";
    const r = await run([L(), { do: "read_screen" }]);
    expect(r.results[1]!.status).toBe("failed");
    expect(existsSync(bridge.lastCapture!)).toBe(false);
  });

  it("writes neither typed text nor screen text to the audit log", async () => {
    approve(["open", "view", "control"]);
    bridge.ocrLines = lines("OCR-TEST-4711 hello world");
    await run([L(), { do: "type", target: { name: "Notes" }, text: "TYPED-SENTINEL-123" }, { do: "read_screen" }]);
    expect(auditText()).not.toContain("TYPED-SENTINEL-123");
    expect(auditText()).not.toContain("OCR-TEST-4711");
    expect(kinds()).toEqual(expect.arrayContaining(["desktop.launch", "desktop.step", "desktop.read_screen"]));
  });
});

describe("the plan itself", () => {
  it("a destructive plan without allowDestructive is rejected by the schema, before it can be asked for", () => {
    expect(runSchema.safeParse({ steps: [{ do: "close_window", discard: true }] }).success).toBe(false);
    expect(runSchema.safeParse({ steps: [{ do: "close_window", discard: true }], allowDestructive: true }).success).toBe(true);
    expect(runSchema.safeParse({ steps: [{ do: "type", target: { name: "x" }, text: "y", overwrite: true }] }).success).toBe(false);
  });
  it("is a closed list: no step can name a command, a script or a program path", () => {
    for (const bad of [{ do: "run", command: "cmd" }, { do: "launch", app: "C:\\Windows\\notepad.exe" }, { do: "powershell", script: "x" }, { do: "click", target: {} }]) {
      expect(runSchema.safeParse({ steps: [bad] }).success).toBe(false);
    }
  });
  it("refuses a destructive step that the plan did not allow, before anything runs", async () => {
    approve(["open", "view", "control", "close"]);
    const r = await run([L(), { do: "close_window", discard: true }]);
    expect(r.results[0]).toMatchObject({ status: "failed" });
    expect(launches).toHaveLength(0);
  });
});
