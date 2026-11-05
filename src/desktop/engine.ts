import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { win32 } from "node:path";
import type { AuditLog } from "../audit/audit.js";
import type { AccessService } from "../access/service.js";
import type { AppCapability } from "../access/store.js";
import type { DesktopBridge, NodeInfo, TreeResult, WindowInfo } from "./bridge.js";
import { BridgeError } from "./bridge.js";
import { redactSensitive } from "./redact.js";
import { describeStep, isDestructive, type Expect, type RunRequest, type Step, type Target } from "./steps.js";

/**
 * The Universal Desktop Application Execution Engine (first version): operates ONLY application processes that it started itself, from the owner's
 * approved application list, through Windows UI Automation, with local OCR as a reader. It reuses the application permissions, the folder permissions and
 * the Guardian; it adds no permission system of its own.
 *
 * Rules (each is tested; see docs/SECURITY-AUDIT.md, incident 2026-11-04):
 *  - Only processes this engine launched and registered. No "attach to a running program" exists. If the identity of a window or process is uncertain
 *    (handed over to another process, host restarted, window of another process), the operation is refused.
 *  - Every operation re-checks the Guardian, the application approval (open / view / control / close) and the program file's fingerprint. A revoke
 *    therefore takes effect on the very next operation.
 *  - Nothing is ever reported as succeeded without evidence. Each step says WHICH evidence it has: an expectation confirmed, a read-back confirmed,
 *    an observed change, or none.
 *  - Text never leaves unredacted; password and secret fields are never read or written; screenshots exist only for the length of one OCR call.
 *  - Files are written only through the program's file dialog, after a folder permission check made immediately before the Save click and repeated on the result.
 *  - It stops at step boundaries when the Guardian holds, when a dialog appears that the plan did not expect, and on the first failure.
 */
export class DesktopError extends Error {
  constructor(
    public readonly code: "guardian" | "not_approved" | "protected" | "identity" | "folder" | "refused" | "dialog" | "failed" | "interrupted",
    message: string,
  ) {
    super(message);
  }
}

export type Evidence = "expected_state_confirmed" | "readback_confirmed" | "state_changed" | "none";
export interface StepResult {
  index: number;
  step: string;
  status: "ok" | "failed" | "stopped";
  /** What shows that it worked. "none" = performed but NOT independently verified. */
  evidence: Evidence;
  detail: string;
  data?: Record<string, unknown>;
}
export interface RunResult {
  session: string | null;
  results: StepResult[];
  finished: boolean;
  stoppedBecause: string | null;
  /** Plain-language summary that never says "succeeded" unless every step has evidence. */
  summary: string;
}

export interface Launched {
  pid: number | undefined;
  kill(): void;
  exited(): boolean;
}
export type Launcher = (exe: string, cwd: string, env: NodeJS.ProcessEnv) => Launched;

export interface DesktopDeps {
  bridge: DesktopBridge;
  access: AccessService;
  audit: AuditLog;
  now: () => number;
  /** Why nothing may run now (the Guardian is not RUN), or null. */
  guardHeld: () => string | null;
  /** A folder only this engine uses: screenshots live here for one OCR call. Must be outside every approvable folder. */
  privateDir: string;
  launcher?: Launcher;
  sleep?: (ms: number) => Promise<void>;
  hashFile: (path: string) => string | null;
}

interface Session {
  id: string;
  appId: string;
  name: string;
  exe: string;
  pid: number;
  epoch: number;
  launched: Launched;
  known: Set<number>;
  ended: boolean;
}

const SECRETISH_ENV = /key|token|secret|password|passwd|credential|guardian|auth|cookie|session/i;
export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRETISH_ENV.test(k)));
}

/** Starts a program directly (no shell). Production passes no arguments; tests pass the disposable test program's own switches. */
export const spawnLauncher = (args: string[] = []): Launcher => (exe, cwd, env) => {
  const child = spawn(exe, args, { cwd, env, stdio: "ignore", detached: false, windowsHide: false, shell: false });
  let done = false;
  child.on("exit", () => (done = true));
  child.on("error", () => (done = true));
  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
    },
    exited: () => done,
  };
};
const defaultLauncher: Launcher = spawnLauncher();

// ---------------- keyboard shortcuts ----------------
const KEY_NAMES = new Set(["ENTER", "TAB", "ESC", "BACKSPACE", "BS", "DELETE", "DEL", "HOME", "END", "UP", "DOWN", "LEFT", "RIGHT", "PGUP", "PGDN", "SPACE", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);
/** Returns a reason if the key sequence is not allowed. Allowed: letters, digits, basic punctuation, {NAMED} keys, ^ % + modifiers, groups after a modifier. */
export function badKeys(keys: string): string | null {
  if (keys.length > 200) return "Too long.";
  let mods = "";
  const out: { mods: string; key: string }[] = [];
  const parse = (s: string, inherited: string): string | null => {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if ("^%+".includes(c)) {
        mods += c;
        continue;
      }
      if (c === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === "(") depth++;
          if (s[j] === ")") depth--;
          j++;
        }
        if (depth !== 0) return "Unbalanced brackets.";
        const err = parse(s.slice(i + 1, j - 1), inherited + mods);
        if (err) return err;
        mods = "";
        i = j - 1;
        continue;
      }
      let key: string;
      if (c === "{") {
        const end = s.indexOf("}", i + 2);
        if (end < 0) return "Unclosed brace.";
        const body = s.slice(i + 1, end === i + 2 ? end + 1 : end);
        key = body.split(" ")[0]!.toUpperCase();
        i = end === i + 2 ? end + 1 : end;
        if (body.length === 1) {
          if (!"+^%~(){}".includes(body)) return `The key {${body}} is not allowed.`;
        } else if (!KEY_NAMES.has(key)) return `The key {${key}} is not allowed.`;
      } else if (c === "~") key = "ENTER";
      else if (/[A-Za-z0-9 .,;:'"\-_=/@#!?*<>|&$]/.test(c)) key = c.toUpperCase();
      else return `The character "${c}" is not allowed in a shortcut.`;
      out.push({ mods: inherited + mods, key });
      mods = "";
    }
    return null;
  };
  const err = parse(keys, "");
  if (err) return err;
  for (const k of out) {
    if (k.mods.includes("%") && (k.key === "F4" || k.key === "TAB" || k.key === "ESC")) return "Alt+F4, Alt+Tab and Alt+Esc are not allowed (they close or switch away from the application).";
    if (k.mods.includes("^") && k.key === "ESC") return "Ctrl+Esc and Ctrl+Shift+Esc are not allowed.";
  }
  return out.length === 0 ? "No keys." : null;
}

// ---------------- targets ----------------
function matches(n: NodeInfo, t: Target): boolean {
  const name = n.name ?? "";
  if (t.name !== undefined && name !== t.name) return false;
  if (t.nameContains !== undefined && !name.toLowerCase().includes(t.nameContains.toLowerCase())) return false;
  if (t.type !== undefined && n.type !== t.type) return false;
  if (t.automationId !== undefined && n.automationId !== t.automationId) return false;
  return !n.offscreen;
}
function findNode(nodes: NodeInfo[], t: Target): NodeInfo {
  let hits = nodes.filter((n) => matches(n, t));
  // a label nested inside a matching control (a Button's own caption) is the same thing, not a second candidate
  hits = hits.filter((h) => !(h.type === "Text" && hits.some((g) => g !== h && h.path.startsWith(g.path + "."))));
  if (hits.length === 0) throw new DesktopError("failed", "No control matches that description.");
  if (t.index === undefined && hits.length > 1) throw new DesktopError("refused", `More than one control matches (${hits.slice(0, 4).map((h) => `"${h.name ?? h.automationId}" (${h.type})`).join(", ")}${hits.length > 4 ? ", ..." : ""}). Say which one with "index" or a more exact name. Nothing was done.`);
  const hit = hits[t.index ?? 0];
  if (!hit) throw new DesktopError("failed", "There is no control with that index.");
  return hit;
}
const signature = (tree: TreeResult, wins: WindowInfo[]): string =>
  JSON.stringify([wins.map((w) => w.title).sort(), tree.nodes.map((n) => [n.type, n.name, n.valueLength, n.value, n.toggle, n.enabled, n.selected])]);
const FILE_DIALOG_SAFE = new Set(["Button", "Edit", "ComboBox", "Text", "CheckBox"]);
/**
 * The standard Windows file dialogs keep their file-name box under different ids: 1001 in the Save dialog, 1148 in the Open dialog
 * (verified on a real window 2026-11-04: the Open dialog exposes Edit#1148). Both are recognised, so every file-dialog guard covers both.
 */
const FILE_NAME_IDS = new Set(["1001", "1148"]);
/**
 * What may be shown of a file dialog: the file-name box (1001/1148), the file-type box (1136), their labels (1090, 1089), the Open/Save
 * and Cancel buttons (1, 2) and Help. An ALLOW-list: everything else (the folder listing with its file names, the address bar, the
 * navigation pane, search) is never returned. Before 2026-11-04 a deny-list missed the Open dialog's listing rows
 * ("System.ItemNameDisplay" cells, whose names are file names).
 */
const FILE_DIALOG_SHOWN_IDS = new Set(["1", "2", "1001", "1148", "1136", "1090", "1089", "HelpButton"]);
const isFileDialog = (win: WindowInfo, tree: TreeResult): boolean => win.className === "#32770" && tree.nodes.some((n) => FILE_NAME_IDS.has(n.automationId ?? ""));
const pubNode = (n: NodeInfo) => ({ path: n.path, type: n.type, name: n.name, automationId: n.automationId, enabled: n.enabled, secret: n.secret, valueLength: n.valueLength, toggle: n.toggle, selected: n.selected, patterns: n.patterns });

export class DesktopEngine {
  private readonly sessions = new Map<string, Session>();
  private readonly hashes = new Map<string, { sig: string; sha: string | null }>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly launcher: Launcher;

  constructor(private readonly d: DesktopDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.launcher = d.launcher ?? defaultLauncher;
    mkdirSync(d.privateDir, { recursive: true });
    this.purgePrivate();
  }

  /** Screenshots never outlive the call that made them; anything left by a crash is removed at start-up. */
  private purgePrivate(): void {
    try {
      for (const f of readdirSync(this.d.privateDir)) if (f.startsWith("shot-")) rmSync(win32.join(this.d.privateDir, f), { force: true });
    } catch {
      /* nothing to purge */
    }
  }

  async prepare(): Promise<void> {
    await this.d.bridge.init(this.d.privateDir);
  }

  private rec(kind: string, detail: Record<string, unknown>): void {
    this.d.audit.record(`desktop.${kind}`, detail, { actor: "desktop-engine" });
  }

  private sha(exe: string): string | null {
    try {
      const st = statSync(exe);
      const sig = `${st.size}:${st.mtimeMs}`;
      const hit = this.hashes.get(exe);
      if (hit && hit.sig === sig) return hit.sha;
      const sha = this.d.hashFile(exe);
      this.hashes.set(exe, { sig, sha });
      return sha;
    } catch {
      return null;
    }
  }

  // ---------------- the one gate every operation passes ----------------
  private async identity(appId: string) {
    let ident = this.d.access.identityOf(appId);
    if (!ident) {
      await this.d.access.scan();
      ident = this.d.access.identityOf(appId);
    }
    if (!ident) throw new DesktopError("not_approved", "That application is not in the scan of this PC, so it is not approved.");
    return ident;
  }

  private async gate(sessionId: string | null, appId: string, cap: AppCapability): Promise<{ session: Session | null; exe: string }> {
    const held = this.d.guardHeld();
    if (held) throw new DesktopError("guardian", `Stopped by the Guardian: ${held}`);
    const ident = await this.identity(appId);
    if (!ident.exePath) throw new DesktopError("refused", "That application has no known program file, so its identity cannot be proven.");
    const dec = this.d.access.apps.decide(ident, cap, { sha256: this.sha(ident.exePath) });
    if (!dec.allowed) {
      this.rec("deny", { appId, name: ident.name, capability: cap, reason: dec.reason });
      throw new DesktopError(dec.level === "protected" ? "protected" : "not_approved", dec.reason);
    }
    let session: Session | null = null;
    if (sessionId) {
      session = this.sessions.get(sessionId) ?? null;
      if (!session || session.ended) throw new DesktopError("identity", "That session does not exist or has ended. Start the application again.");
      if (session.epoch !== this.d.bridge.epoch) {
        session.ended = true;
        throw new DesktopError("identity", "The Windows host was restarted, so the identity of this application can no longer be proven. Start it again.");
      }
      if (session.launched.exited()) {
        session.ended = true;
        throw new DesktopError("identity", "The application has ended.");
      }
    }
    return { session, exe: ident.exePath };
  }

  private async poll<T>(fn: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
    const t0 = this.d.now();
    for (;;) {
      const held = this.d.guardHeld();
      if (held) throw new DesktopError("interrupted", `Stopped by the Guardian: ${held}`);
      const v = await fn();
      if (v !== null) return v;
      if (this.d.now() - t0 >= timeoutMs) return null;
      await this.sleep(250);
    }
  }

  // ---------------- launching ----------------
  async launch(appId: string): Promise<{ session: string; title: string | null }> {
    const { exe } = await this.gate(null, appId, "open");
    if (!existsSync(exe)) throw new DesktopError("refused", "The program file no longer exists.");
    const ident = await this.identity(appId);
    const child = this.launcher(exe, this.d.privateDir, cleanEnv(process.env));
    const pid = child.pid;
    if (!pid) {
      child.kill();
      throw new DesktopError("refused", "The program did not start.");
    }
    const refuse = async (msg: string): Promise<never> => {
      child.kill();
      try {
        await this.d.bridge.unregister(pid);
      } catch {
        /* not registered */
      }
      this.rec("launch_refused", { appId, name: ident.name, reason: msg });
      throw new DesktopError("identity", msg);
    };
    try {
      await this.d.bridge.register({ pid, exe, parentPid: process.pid, nowMs: this.d.now() });
    } catch (e) {
      return refuse(`The new process could not be proven to be the approved program started by this engine: ${e instanceof Error ? e.message : "refused"}`);
    }
    const win = await this.poll(async () => {
      if (child.exited()) return null;
      const w = (await this.d.bridge.windows(pid)).filter((x) => !x.offscreen);
      return w[0] ?? null;
    }, 15_000).catch(async (e) => {
      child.kill();
      throw e;
    });
    if (!win) {
      return refuse(child.exited() ? "The program handed over to another process (a single-instance or Store application) and left no window of its own. It was not controlled, and nothing running was touched." : "The program opened no window in time, so it was stopped and not controlled.");
    }
    await this.sleep(400);
    const known = new Set((await this.d.bridge.windows(pid)).map((w) => w.handle));
    const s: Session = { id: "s" + randomBytes(6).toString("hex"), appId, name: ident.name, exe, pid, epoch: this.d.bridge.epoch, launched: child, known, ended: false };
    this.sessions.set(s.id, s);
    this.rec("launch", { session: s.id, appId, name: ident.name, pid });
    return { session: s.id, title: win.title };
  }

  async release(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) return;
    s.ended = true;
    try {
      await this.d.bridge.unregister(s.pid);
    } catch {
      /* host gone */
    }
    this.rec("release", { session: s.id, appId: s.appId });
  }

  /** Releases every session (the application keeps running; the engine just stops controlling it). Tests may also end the programs they started. */
  async shutdown(endPrograms = false): Promise<void> {
    for (const s of this.sessions.values()) {
      await this.release(s.id);
      if (endPrograms) s.launched.kill();
    }
  }

  sessionInfo(): { session: string; app: string; name: string }[] {
    return [...this.sessions.values()].filter((s) => !s.ended).map((s) => ({ session: s.id, app: s.appId, name: s.name }));
  }

  // ---------------- looking ----------------
  /** The windows of a session's program; an empty list when the program has ended (a closed program is the expected end of some plans). */
  private async winsOf(pid: number): Promise<WindowInfo[]> {
    try {
      return await this.d.bridge.windows(pid);
    } catch (e) {
      if (e instanceof BridgeError && /has ended|not registered/.test(e.message)) return [];
      throw e;
    }
  }

  private async pickWindow(s: Session, sel?: { titleContains: string }): Promise<WindowInfo> {
    const wins = (await this.d.bridge.windows(s.pid)).filter((w) => !w.offscreen);
    const hit = sel ? wins.find((w) => (w.title ?? "").toLowerCase().includes(sel.titleContains.toLowerCase())) : wins[0];
    if (!hit) throw new DesktopError("failed", sel ? `No window with a title containing "${sel.titleContains}".` : "The application has no visible window.");
    return hit;
  }

  async windows(sessionId: string, appId: string): Promise<{ title: string | null; className: string | null }[]> {
    await this.gate(sessionId, appId, "view");
    const s = this.sessions.get(sessionId)!;
    return (await this.d.bridge.windows(s.pid)).map((w) => ({ title: w.title, className: w.className }));
  }

  /** The control tree WITHOUT field contents (only their lengths): the model learns what can be operated, not what the user typed. */
  async inspect(sessionId: string, window?: { titleContains: string }) {
    const s0 = this.sessions.get(sessionId);
    if (!s0) throw new DesktopError("identity", "That session does not exist or has ended.");
    const { session: s } = await this.gate(sessionId, s0.appId, "view");
    const win = await this.pickWindow(s!, window);
    const tree = await this.d.bridge.tree(win.handle, s!.pid);
    const fileDlg = isFileDialog(win, tree);
    // A file dialog lists the contents of the user's folders. That listing is never returned: only the file name box, the buttons and the type list are.
    const nodes = fileDlg ? tree.nodes.filter((n) => FILE_DIALOG_SAFE.has(n.type) && FILE_DIALOG_SHOWN_IDS.has(n.automationId ?? "")) : tree.nodes;
    return { window: { title: win.title, fileDialog: fileDlg }, controls: nodes.map(pubNode), truncated: tree.truncated };
  }

  // ---------------- running a plan ----------------
  async run(req: RunRequest): Promise<RunResult> {
    const results: StepResult[] = [];
    let sessionId: string | null = req.session ?? null;
    const done = (finished: boolean, why: string | null): RunResult => ({ session: sessionId && !this.sessions.get(sessionId)?.ended ? sessionId : null, results, finished, stoppedBecause: why, summary: this.summarize(results, finished, why) });
    // the whole plan is checked BEFORE anything runs: a destructive step the plan did not allow means nothing at all is started
    const bad = req.steps.findIndex((st) => isDestructive(st) && !req.allowDestructive);
    if (bad >= 0) {
      results.push({ index: bad, step: describeStep(req.steps[bad]!), status: "failed", evidence: "none", detail: "This step can lose or replace data and the plan did not say allowDestructive. Nothing was done." });
      return done(false, "A destructive step was not explicitly allowed.");
    }
    for (const [i, step] of req.steps.entries()) {
      const held = this.d.guardHeld();
      if (held) {
        results.push({ index: i, step: describeStep(step), status: "stopped", evidence: "none", detail: `Stopped by the Guardian before this step: ${held}` });
        this.rec("interrupted", { session: sessionId, step: i, reason: held });
        return done(false, `Guardian: ${held}`);
      }
      try {
        const r = await this.exec(step, i, sessionId);
        if (step.do === "launch" && r.data?.["session"]) sessionId = String(r.data["session"]);
        results.push(r);
        this.rec("step", { session: sessionId, i, do: step.do, status: r.status, evidence: r.evidence });
        if (r.status !== "ok") return done(false, r.detail);
      } catch (e) {
        const code = e instanceof DesktopError ? e.code : e instanceof BridgeError && e.kind === "timeout" ? "interrupted" : "failed";
        const msg = redactSensitive(e instanceof Error ? e.message : "The step failed.");
        results.push({ index: i, step: describeStep(step), status: code === "interrupted" || code === "guardian" ? "stopped" : "failed", evidence: "none", detail: msg });
        this.rec("step", { session: sessionId, i, do: step.do, status: "failed", code, reason: msg.slice(0, 200) });
        return done(false, msg);
      }
    }
    return done(true, null);
  }

  private summarize(results: StepResult[], finished: boolean, why: string | null): string {
    const ok = results.filter((r) => r.status === "ok");
    const proven = ok.filter((r) => r.evidence === "expected_state_confirmed" || r.evidence === "readback_confirmed").length;
    const changed = ok.filter((r) => r.evidence === "state_changed").length;
    const bare = ok.length - proven - changed;
    const parts = `${ok.length} step(s) performed: ${proven} confirmed by an expected state or read-back, ${changed} with an observed change only, ${bare} not independently verified.`;
    if (!finished) return `STOPPED: ${why ?? "a step did not complete"}. ${parts} Later steps were not run.`;
    return bare + changed === 0 ? `All steps performed and confirmed. ${parts}` : `All steps performed, but not all were independently confirmed. ${parts}`;
  }

  private fileDialogOnly(win: WindowInfo, tree: TreeResult, what: string, node?: NodeInfo): void {
    if (!isFileDialog(win, tree)) return;
    if (what === "click" && node && node.automationId === "2") return; // Cancel
    throw new DesktopError("refused", `This is a file dialog. Files are handled only by the "file_dialog" step, which checks the folder permissions. ("${what}" is refused here.)`);
  }

  /** Looks for windows the plan did not know about. A dialog can take a moment to appear, so clicks and keys wait briefly; an EXPECTED dialog is waited for (up to 4 s). */
  private async afterAction(s: Session, _step: Step, _sigBefore: string, expectDialog?: string, settleMs = 0): Promise<{ dialog?: { title: string | null; buttons: string[] }; missing?: boolean }> {
    const t0 = this.d.now();
    let fresh: WindowInfo[] = [];
    for (;;) {
      const wins = await this.winsOf(s.pid);
      fresh = wins.filter((w) => !s.known.has(w.handle));
      const hit = expectDialog ? fresh.some((w) => (w.title ?? "").toLowerCase().includes(expectDialog.toLowerCase())) : fresh.length > 0;
      if (hit) break;
      const waited = this.d.now() - t0;
      if (waited >= (expectDialog ? 4000 : settleMs)) break;
      await this.sleep(100);
    }
    for (const w of fresh) s.known.add(w.handle);
    if (expectDialog) return fresh.some((w) => (w.title ?? "").toLowerCase().includes(expectDialog.toLowerCase())) ? {} : { missing: true };
    if (fresh.length === 0) return {};
    const w = fresh[0]!;
    let buttons: string[] = [];
    try {
      buttons = (await this.d.bridge.tree(w.handle, s.pid)).nodes.filter((n) => n.type === "Button" && n.name).map((n) => n.name!);
    } catch {
      /* the dialog went away */
    }
    return { dialog: { title: w.title, buttons } };
  }

  private async checkExpect(s: Session, win: WindowInfo | null, e: Expect): Promise<boolean> {
    const wins = (await this.winsOf(s.pid)).filter((w) => !w.offscreen);
    if (e.windowTitleContains && !wins.some((w) => (w.title ?? "").toLowerCase().includes(e.windowTitleContains!.toLowerCase()))) return false;
    if (e.windowGone && wins.some((w) => (w.title ?? "").toLowerCase().includes(e.windowGone!.toLowerCase()))) return false;
    if (e.control || e.controlGone) {
      const w = win && wins.some((x) => x.handle === win.handle) ? win : wins[0];
      if (!w) return !!e.controlGone;
      const nodes = (await this.d.bridge.tree(w.handle, s.pid)).nodes;
      if (e.controlGone) return !nodes.some((n) => matches(n, e.controlGone!));
      const hits = nodes.filter((n) => matches(n, e.control!));
      if (hits.length === 0) return false;
      const n = hits[0]!;
      if (e.valueEquals !== undefined && n.value !== redactSensitive(e.valueEquals)) return false;
      if (e.valueContains !== undefined && !(n.value ?? "").includes(redactSensitive(e.valueContains))) return false;
      if (e.toggle !== undefined && n.toggle !== e.toggle) return false;
    }
    return true;
  }

  private async confirm(s: Session, win: WindowInfo | null, e: Expect | undefined): Promise<Evidence | null> {
    if (!e) return null;
    const ok = await this.poll(async () => ((await this.checkExpect(s, win, e)) ? true : null), e.withinMs ?? 3000);
    return ok ? "expected_state_confirmed" : "none";
  }

  private async exec(step: Step, index: number, sessionIn: string | null): Promise<StepResult> {
    const label = describeStep(step);
    const base = { index, step: label };
    if (step.do === "launch") {
      const r = await this.launch(step.app);
      return { ...base, status: "ok", evidence: "state_changed", detail: `Started; its window "${r.title ?? ""}" is open.`, data: { session: r.session } };
    }
    if (!sessionIn) throw new DesktopError("refused", "No application is running under this plan. Start with a launch step.");
    const s0 = this.sessions.get(sessionIn);
    if (!s0) throw new DesktopError("identity", "That session does not exist.");
    const cap: AppCapability = step.do === "wait_window" || step.do === "read" || step.do === "read_screen" ? "view" : step.do === "close_window" ? "close" : step.do === "release" ? "view" : "control";
    const { session: s } = await this.gate(sessionIn, s0.appId, cap);
    const S = s!;

    if (step.do === "release") {
      await this.release(S.id);
      return { ...base, status: "ok", evidence: "none", detail: "The engine no longer controls the application (it keeps running)." };
    }
    if (step.do === "wait_window") {
      const w = await this.poll(async () => ((await this.d.bridge.windows(S.pid)).find((x) => !x.offscreen && (x.title ?? "").toLowerCase().includes(step.titleContains.toLowerCase())) ?? null), step.timeoutMs ?? 5000);
      if (!w) return { ...base, status: "failed", evidence: "none", detail: `No window titled *${step.titleContains}* appeared.` };
      return { ...base, status: "ok", evidence: "expected_state_confirmed", detail: "The window is open." };
    }

    const win = await this.pickWindow(S, "window" in step ? step.window : undefined);
    const tree = await this.d.bridge.tree(win.handle, S.pid);

    if (step.do === "read_screen") return this.readScreen(S, win, tree, base);

    if (step.do === "read") {
      const n = findNode(tree.nodes, step.target);
      if (n.secret) throw new DesktopError("refused", "That field is a password or secret field. It is never read.");
      if (isFileDialog(win, tree) && !FILE_NAME_IDS.has(n.automationId ?? "")) throw new DesktopError("refused", "A file dialog shows the contents of the user's folders. Only its file name box can be read.");
      const text = (n.value ?? n.name ?? "").slice(0, step.maxChars ?? 500);
      return { ...base, status: "ok", evidence: "readback_confirmed", detail: `Read ${text.length} characters.`, data: { text, private: true } };
    }

    if (step.do === "keys") {
      const bad = badKeys(step.keys);
      if (bad) throw new DesktopError("refused", bad);
      this.fileDialogOnly(win, tree, "keys");
      const before = signature(tree, await this.d.bridge.windows(S.pid));
      await this.d.bridge.keys({ handle: win.handle, pid: S.pid, keys: step.keys });
      return this.finish(S, step, base, win, before, step.expect, "Keys sent.");
    }

    if (step.do === "close_window") {
      const wins = await this.d.bridge.windows(S.pid);
      const before = signature(tree, wins);
      await this.d.bridge.close({ handle: win.handle, pid: S.pid, discard: step.discard === true });
      const endedOk = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn();
        } catch (e) {
          if (e instanceof BridgeError && /has ended|not registered/.test(e.message)) return fallback; // the program closed itself: that is the expected end
          throw e;
        }
      };
      const gone = await endedOk(() => this.poll(async () => ((await this.d.bridge.windows(S.pid)).some((w) => w.handle === win.handle) ? null : true), 3000), true as boolean | null);
      const dlg = await endedOk(() => this.afterAction(S, step, before, undefined, 600), {} as { dialog?: { title: string | null; buttons: string[] } });
      if (dlg.dialog) return { ...base, status: "stopped", evidence: "none", detail: `Closing opened a dialog "${dlg.dialog.title ?? ""}". Nothing was closed or discarded. Buttons: ${dlg.dialog.buttons.join(", ")}.`, data: { dialog: dlg.dialog } };
      if (!gone) return { ...base, status: "failed", evidence: "none", detail: "The close was requested but the window is still open." };
      return { ...base, status: "ok", evidence: "expected_state_confirmed", detail: "The window closed." };
    }

    if (step.do === "file_dialog") return this.fileDialog(S, win, tree, step, base);

    // click / toggle / select / focus / type
    const node = findNode(tree.nodes, step.target);
    if (!node.enabled) throw new DesktopError("failed", "That control is disabled.");
    this.fileDialogOnly(win, tree, step.do, node);
    const wins0 = await this.d.bridge.windows(S.pid);
    const before = signature(tree, wins0);
    const common = { handle: win.handle, pid: S.pid, path: node.path, automationId: node.automationId, expectName: node.name, expectType: node.type };
    if (step.do === "type") {
      if (node.secret) throw new DesktopError("refused", "That field is a password or secret field. It is never written.");
      if (node.valueLength > 0 && step.overwrite !== true) throw new DesktopError("refused", "That field already contains text. It is not replaced unless the step says overwrite (a destructive step).");
      const r = await this.d.bridge.act({ ...common, action: "setvalue", value: step.text, overwrite: step.overwrite === true });
      const after = r.after;
      const okLen = !!after && after.valueLength === step.text.length;
      const okVal = !!after && (step.text.length > 600 || after.value === redactSensitive(step.text));
      if (!okLen || !okVal) return { ...base, status: "failed", evidence: "none", detail: "The text was entered but reading it back did not match, so it is NOT confirmed." };
      return { ...base, status: "ok", evidence: "readback_confirmed", detail: `Typed ${step.text.length} characters; read back and matched.` };
    }
    if (step.do === "focus") {
      this.fileDialogOnly(win, tree, "focus", node);
      await this.d.bridge.act({ ...common, action: "focus" });
      return { ...base, status: "ok", evidence: "none", detail: `Moved the keyboard focus to "${node.name ?? node.automationId}".` };
    }
    const action = step.do === "click" ? "invoke" : step.do === "toggle" ? "toggle" : "select";
    const r = await this.d.bridge.act({ ...common, action });
    let ev: Evidence | null = null;
    if (step.do === "toggle" && r.after && node.toggle && r.after.toggle !== node.toggle) ev = "readback_confirmed";
    if (step.do === "select" && r.after?.selected === true) ev = "readback_confirmed";
    return this.finish(S, step, base, win, before, step.expect, `${step.do === "click" ? "Clicked" : step.do === "toggle" ? "Switched" : "Selected"} "${node.name ?? node.automationId}".`, ev, "expectDialog" in step ? step.expectDialog : undefined);
  }

  private async finish(S: Session, step: Step, base: { index: number; step: string }, win: WindowInfo, before: string, expect: Expect | undefined, done: string, intrinsic: Evidence | null = null, expectDialog?: string): Promise<StepResult> {
    const dlg = await this.afterAction(S, step, before, expectDialog, step.do === "click" || step.do === "keys" ? 600 : 0);
    if (dlg.missing) return { ...base, status: "failed", evidence: "none", detail: `${done} But the dialog the plan expected ("${expectDialog}") did not appear, so this step is not confirmed.` };
    if (dlg.dialog) return { ...base, status: "stopped", evidence: "none", detail: `${done} A dialog opened that the plan did not expect: "${dlg.dialog.title ?? ""}". Stopped here. Buttons: ${dlg.dialog.buttons.join(", ")}.`, data: { dialog: dlg.dialog } };
    const confirmed = await this.confirm(S, win, expect);
    if (confirmed === "none") return { ...base, status: "failed", evidence: "none", detail: `${done} But the expected result was NOT seen, so this step is not confirmed.` };
    if (confirmed) return { ...base, status: "ok", evidence: confirmed, detail: `${done} Expected state confirmed.` };
    if (intrinsic) return { ...base, status: "ok", evidence: intrinsic, detail: `${done} Confirmed by reading the control again.` };
    const wins = await this.winsOf(S.pid);
    let after: string;
    try {
      const w2 = wins.find((w) => w.handle === win.handle);
      after = w2 ? signature(await this.d.bridge.tree(w2.handle, S.pid), wins) : "window gone";
    } catch {
      after = "window gone";
    }
    return after !== before ? { ...base, status: "ok", evidence: "state_changed", detail: `${done} The window changed, but no expected result was given, so success is not confirmed.` } : { ...base, status: "ok", evidence: "none", detail: `${done} Nothing observable changed; NOT verified.` };
  }

  // ---------------- screen reading: UI Automation first, OCR second, picture deleted at once ----------------
  private async readScreen(S: Session, win: WindowInfo, tree: TreeResult, base: { index: number; step: string }): Promise<StepResult> {
    if (isFileDialog(win, tree)) throw new DesktopError("refused", "A file dialog shows the contents of the user's folders, so it is never captured or read with OCR.");
    const file = win32.join(this.d.privateDir, `shot-${randomBytes(8).toString("hex")}.png`);
    try {
      await this.d.bridge.capture({ handle: win.handle, pid: S.pid, out: file });
      const ocr = await this.d.bridge.ocr(file);
      const controls = tree.nodes.filter((n) => !n.secret && n.name && !n.offscreen).map((n) => ({ type: n.type, name: n.name, rect: n.rect }));
      const known = new Set(controls.map((c) => (c.name ?? "").toLowerCase()));
      const lines = ocr.lines.map((l) => ({ text: l.text, redacted: l.redacted, rect: unionRect(l.words.map((w) => w.rect)) }));
      const ocrOnly = lines.filter((l) => l.text && !known.has(l.text.toLowerCase()) && ![...known].some((k) => k.includes(l.text.toLowerCase()) || l.text.toLowerCase().includes(k))).map((l) => l.text);
      this.rec("read_screen", { session: S.id, controls: controls.length, ocrLines: lines.length, redactedLines: lines.filter((l) => l.redacted).length });
      return { ...base, status: "ok", evidence: "readback_confirmed", detail: `Read ${controls.length} controls through UI Automation and ${lines.length} lines through OCR (${ocr.language}). The picture was deleted.`, data: { controls, ocrLines: lines, ocrOnly, private: true } };
    } finally {
      rmSync(file, { force: true });
    }
  }

  // ---------------- files: only through the program's file dialog, with a folder check right before Save/Open ----------------
  private async fileDialog(S: Session, win: WindowInfo, tree: TreeResult, step: Extract<Step, { do: "file_dialog" }>, base: { index: number; step: string }): Promise<StepResult> {
    if (!isFileDialog(win, tree)) throw new DesktopError("failed", "No file dialog is open in the application.");
    const p = step.path;
    if (!win32.isAbsolute(p) || /^[\\/]{2}/.test(p) || !/^[a-zA-Z]:\\/.test(p)) throw new DesktopError("refused", "Use the full path starting with a drive letter.");
    const target = win32.normalize(p);
    const exists = existsSync(target);
    const op = step.mode === "open" ? "read" : exists ? "edit" : "create";
    if (step.mode === "save" && exists && step.overwrite !== true) throw new DesktopError("refused", "That file already exists. The step must say overwrite (a destructive step).");
    if (step.mode === "open" && !exists) throw new DesktopError("failed", "That file does not exist.");
    const v1 = this.d.access.folders.authorize({ subject: "workforce", path: target, op });
    if (!v1.allowed) {
      this.rec("file_denied", { session: S.id, op, reason: v1.reason });
      throw new DesktopError("folder", `Folder permission: ${v1.reason}`);
    }
    // Save dialog: ComboBox#1001 with an Edit inside. Open dialog: Edit#1148 (real window, 2026-11-04). Prefer the editable box.
    const nameBox =
      tree.nodes.find((n) => FILE_NAME_IDS.has(n.automationId ?? "") && n.type === "ComboBox") ?? tree.nodes.find((n) => FILE_NAME_IDS.has(n.automationId ?? "") && n.type === "Edit");
    const button = tree.nodes.find((n) => n.automationId === "1" && n.type === "Button");
    if (!nameBox || !button) throw new DesktopError("failed", "The file dialog does not look like a standard Save/Open dialog, so it was not used.");
    const nameEdit = tree.nodes.find((n) => n.type === "Edit" && n.path.startsWith(nameBox.path + ".")) ?? nameBox;
    await this.d.bridge.act({ handle: win.handle, pid: S.pid, path: nameEdit.path, automationId: nameEdit.automationId, expectName: nameEdit.name, expectType: nameEdit.type, action: "setvalue", value: target, overwrite: true });
    // typing can open an auto-complete list and shift the controls: find the button again instead of trusting an old position
    const tree2 = await this.d.bridge.tree(win.handle, S.pid);
    const button2 = tree2.nodes.find((n) => n.automationId === "1" && n.type === "Button");
    if (!button2) throw new DesktopError("failed", "The Save/Open button of the file dialog could not be found again, so nothing was clicked.");
    // permission check again IMMEDIATELY before the click that writes or reads, and honour a revoke made in between
    const held = this.d.guardHeld();
    if (held) throw new DesktopError("guardian", `Stopped by the Guardian: ${held}`);
    const v2 = this.d.access.folders.authorize({ subject: "workforce", path: target, op });
    if (!v2.allowed || !this.d.access.folders.stillValid(v1)) {
      this.rec("file_denied", { session: S.id, op, reason: "revoked or expired before the click" });
      throw new DesktopError("folder", "The folder permission was withdrawn before the file was touched. Nothing was written.");
    }
    await this.gate(S.id, S.appId, "control");
    await this.d.bridge.act({ handle: win.handle, pid: S.pid, path: button2.path, automationId: button2.automationId, expectName: button2.name, expectType: button2.type, action: "invoke" });
    // an "already exists, replace?" question is answered only if the step said overwrite
    const gone = await this.poll(async () => {
      const wins = await this.winsOf(S.pid);
      // The question is recognised by its title (confirm / replace / overwrite) OR, because Windows' own Save dialog asks it in a box that
      // carries the Save dialog's title (seen on a real window 2026-11-04: "Save test file" / "... already exists. Do you want to replace it?"),
      // by being a NEW standard dialog of this program, not the file dialog, whose text says the file already exists or asks to replace it.
      let conf: WindowInfo | undefined = wins.find((w) => !S.known.has(w.handle) && /confirm|replace|overwrite/i.test(w.title ?? ""));
      let confTree: TreeResult | null = null;
      if (!conf) {
        for (const w of wins) {
          if (S.known.has(w.handle) || w.handle === win.handle || w.className !== "#32770") continue;
          const t = await this.d.bridge.tree(w.handle, S.pid);
          if (!isFileDialog(w, t) && t.nodes.some((n) => /already exists|replace it|overwrite/i.test(`${n.name ?? ""} ${n.value ?? ""}`))) {
            conf = w;
            confTree = t;
            break;
          }
        }
      }
      if (conf) {
        S.known.add(conf.handle);
        if (step.overwrite !== true) throw new DesktopError("dialog", "The program asked whether to replace an existing file and the step did not allow it. Nothing was replaced.");
        const t = confTree ?? (await this.d.bridge.tree(conf.handle, S.pid));
        const yes = t.nodes.find((n) => n.type === "Button" && /^(yes|replace|save|ok)$/i.test(n.name ?? ""));
        if (!yes) throw new DesktopError("dialog", "A replace confirmation appeared that could not be answered safely.");
        await this.d.bridge.act({ handle: conf.handle, pid: S.pid, path: yes.path, expectName: yes.name, expectType: yes.type, action: "invoke" });
      }
      return wins.some((w) => w.handle === win.handle) ? null : true;
    }, 8000);
    if (!gone) return { ...base, status: "failed", evidence: "none", detail: "The file dialog is still open after the click. Not confirmed." };
    if (step.mode === "open") return { ...base, status: "ok", evidence: "expected_state_confirmed", detail: "The file dialog closed after choosing the file." };
    const ok = existsSync(target) && statSync(target).size >= 0;
    const v3 = this.d.access.folders.authorize({ subject: "workforce", path: target, op: "edit" });
    if (!ok) return { ...base, status: "failed", evidence: "none", detail: "The dialog closed but no file exists at that path. Not confirmed." };
    if (!v3.allowed) return { ...base, status: "failed", evidence: "none", detail: "A file now exists but its location is not covered by an approved folder; it was not trusted." };
    this.rec("file_saved", { session: S.id, bytes: statSync(target).size, existedBefore: exists });
    return { ...base, status: "ok", evidence: "expected_state_confirmed", detail: `The file exists at the requested path (${statSync(target).size} bytes).`, data: { path: target, bytes: statSync(target).size } };
  }
}

function unionRect(rects: number[][]): number[] | null {
  if (rects.length === 0) return null;
  const x1 = Math.min(...rects.map((r) => r[0]!));
  const y1 = Math.min(...rects.map((r) => r[1]!));
  const x2 = Math.max(...rects.map((r) => r[0]! + r[2]!));
  const y2 = Math.max(...rects.map((r) => r[1]! + r[3]!));
  return [x1, y1, x2 - x1, y2 - y1];
}
