import { writeFileSync } from "node:fs";
import { BridgeError, type ActAction, type BridgeStatus, type DesktopBridge, type NodeInfo, type OcrLine, type TreeResult, type WindowInfo } from "./bridge.js";
import { redactSensitive } from "./redact.js";

/**
 * TEST SUPPORT ONLY. A pretend Windows that follows the same rules as the real host script (registered processes only, no global window list,
 * password fields untouched, no overwrite or close of content without say-so), so the engine's own logic can be tested without any real window.
 * Tests that use this are MOCKED tests; the real Windows host is tested in real-windows.test.ts.
 */
export interface FakeWin {
  handle: number;
  title: string;
  className: string;
  offscreen?: boolean;
  nodes: NodeInfo[];
}
export const node = (path: string, type: string, name: string | null, over: Partial<NodeInfo> = {}): NodeInfo => ({
  path, name, type, automationId: null, className: null, enabled: true, offscreen: false, focusable: true, secret: false, value: null, valueLength: 0, toggle: null, selected: null, patterns: ["Invoke"], rect: [0, 0, 10, 10], ...over,
});

export class FakeBridge implements DesktopBridge {
  epoch = 1;
  calls: string[] = [];
  registered = new Map<number, string>();
  worlds = new Map<number, FakeWin[]>();
  registerError: string | null = null;
  ocrLines: OcrLine[] = [];
  ocrError: string | null = null;
  lastCapture: string | null = null;
  /** Called after a control is invoked; tests use it to open dialogs or change fields. */
  onInvoke: (pid: number, win: FakeWin, n: NodeInfo) => void = () => undefined;
  onAct: (action: string) => void = () => undefined;

  private need(pid: number): void {
    if (!this.registered.has(pid)) throw new BridgeError("That process is not registered. The desktop engine controls only programs it started itself.");
  }
  private win(handle: number, pid: number): FakeWin {
    this.need(pid);
    const w = (this.worlds.get(pid) ?? []).find((x) => x.handle === handle);
    if (!w) throw new BridgeError("That window does not belong to the registered program. Refusing.");
    return w;
  }
  async status(): Promise<BridgeStatus> {
    return { uia: true, ocr: true, ocrLanguage: "en-US", ocrLanguages: ["en-US"], powershell: "fake" };
  }
  async init(): Promise<void> {
    this.calls.push("init");
  }
  async register(p: { pid: number; exe: string; parentPid: number; nowMs: number }): Promise<void> {
    this.calls.push(`register:${p.pid}`);
    if (this.registerError) throw new BridgeError(this.registerError);
    this.registered.set(p.pid, p.exe);
  }
  async unregister(pid: number): Promise<void> {
    this.calls.push(`unregister:${pid}`);
    this.registered.delete(pid);
  }
  async windows(pid: number): Promise<WindowInfo[]> {
    this.need(pid);
    return (this.worlds.get(pid) ?? []).map((w) => ({ handle: w.handle, pid, title: redactSensitive(w.title), className: w.className, rect: [0, 0, 100, 100], offscreen: w.offscreen === true }));
  }
  async tree(handle: number, pid: number): Promise<TreeResult> {
    const w = this.win(handle, pid);
    return { window: node("", "Window", w.title), nodes: structuredClone(w.nodes).map((n) => ({ ...n, value: n.secret ? null : n.value === null ? null : redactSensitive(n.value) })), truncated: false, foreign: 0 };
  }
  async act(p: { handle: number; pid: number; path: string; automationId?: string | null; expectName: string | null; expectType: string; action: ActAction; value?: string; overwrite?: boolean }): Promise<{ after: NodeInfo | null }> {
    this.calls.push(`act:${p.action}:${p.path}`);
    this.onAct(p.action);
    const w = this.win(p.handle, p.pid);
    const n = w.nodes.find((x) => x.path === p.path);
    if (!n) throw new BridgeError("The control is no longer where it was (the window changed).");
    if (n.name !== p.expectName || n.type !== p.expectType) throw new BridgeError("The control changed since it was read.");
    if (!n.enabled) throw new BridgeError("The control is disabled.");
    if (p.action === "setvalue") {
      if (n.secret) throw new BridgeError("Password and secret fields are never written by the desktop engine.");
      if (n.valueLength > 0 && p.overwrite !== true) throw new BridgeError("This field already contains text. It is not replaced unless the task explicitly allows overwriting.");
      n.value = p.value ?? "";
      n.valueLength = (p.value ?? "").length;
    } else if (p.action === "toggle") n.toggle = n.toggle === "On" ? "Off" : "On";
    else if (p.action === "select") n.selected = true;
    else if (p.action === "invoke") this.onInvoke(p.pid, w, n);
    return { after: structuredClone({ ...n, value: n.secret || n.value === null ? null : redactSensitive(n.value) }) };
  }
  async keys(p: { handle: number; pid: number; keys: string }): Promise<void> {
    this.calls.push(`keys:${p.keys}`);
    this.win(p.handle, p.pid);
  }
  async focus(p: { handle: number; pid: number }): Promise<boolean> {
    this.win(p.handle, p.pid);
    return true;
  }
  async close(p: { handle: number; pid: number; discard: boolean }): Promise<void> {
    this.calls.push(`close:${p.discard}`);
    const w = this.win(p.handle, p.pid);
    if (!p.discard && (/^\*|modified|unsaved/i.test(w.title) || w.nodes.some((n) => (n.type === "Edit" || n.type === "Document") && n.valueLength > 0))) throw new BridgeError("This window holds text in an editable field. It is not closed unless the task explicitly allows discarding.");
    this.worlds.set(p.pid, (this.worlds.get(p.pid) ?? []).filter((x) => x.handle !== p.handle));
  }
  async capture(p: { handle: number; pid: number; out: string }): Promise<{ width: number; height: number }> {
    this.win(p.handle, p.pid);
    this.lastCapture = p.out;
    writeFileSync(p.out, "fake image bytes");
    return { width: 10, height: 10 };
  }
  async ocr(): Promise<{ language: string; lines: OcrLine[] }> {
    if (this.ocrError) throw new BridgeError(this.ocrError);
    return { language: "en-US", lines: this.ocrLines.map((l) => ({ ...l, text: redactSensitive(l.text) })) };
  }
  stop(): void {
    this.calls.push("stop");
  }
}
