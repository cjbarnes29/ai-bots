import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_SCRIPT } from "./host-script.js";
import { redactSensitive } from "./redact.js";

/**
 * The bridge to Windows UI Automation and OCR. `DesktopBridge` is the ONLY way the engine touches Windows: a closed list of methods, none of which takes
 * a command, a script or a program to run. `HostBridge` is the real implementation (a long-lived fixed PowerShell host, see host-script.ts); tests use a fake.
 */
export interface NodeInfo {
  path: string;
  name: string | null;
  type: string;
  automationId: string | null;
  className: string | null;
  enabled: boolean;
  offscreen: boolean;
  focusable: boolean;
  /** Password field or a field named like a secret: its value is never read or written. */
  secret: boolean;
  /** Redacted text of the control's value. The engine decides whether the model may see it. */
  value: string | null;
  valueLength: number;
  toggle: string | null;
  selected: boolean | null;
  patterns: string[];
  rect: number[] | null;
}
export interface WindowInfo {
  handle: number;
  pid: number;
  title: string | null;
  className: string | null;
  rect: number[] | null;
  offscreen: boolean;
}
export interface TreeResult {
  window: NodeInfo;
  nodes: NodeInfo[];
  truncated: boolean;
  foreign: number;
}
export interface OcrWord {
  text: string;
  rect: number[];
}
export interface OcrLine {
  text: string;
  words: OcrWord[];
  redacted: boolean;
}
export interface BridgeStatus {
  uia: boolean;
  ocr: boolean;
  ocrLanguage: string | null;
  ocrLanguages: string[];
  powershell: string;
}
export type ActAction = "invoke" | "toggle" | "select" | "expand" | "collapse" | "setvalue" | "focus";

export interface DesktopBridge {
  /** Increases every time the Windows host is restarted: a restart forgets every registered process, so older sessions must be refused. */
  readonly epoch: number;
  status(): Promise<BridgeStatus>;
  init(privateDir: string): Promise<void>;
  register(p: { pid: number; exe: string; parentPid: number; nowMs: number }): Promise<void>;
  unregister(pid: number): Promise<void>;
  windows(pid: number): Promise<WindowInfo[]>;
  tree(handle: number, pid: number): Promise<TreeResult>;
  act(p: { handle: number; pid: number; path: string; automationId?: string | null; expectName: string | null; expectType: string; action: ActAction; value?: string; overwrite?: boolean }): Promise<{ after: NodeInfo | null }>;
  keys(p: { handle: number; pid: number; keys: string }): Promise<void>;
  focus(p: { handle: number; pid: number }): Promise<boolean>;
  close(p: { handle: number; pid: number; discard: boolean }): Promise<void>;
  capture(p: { handle: number; pid: number; out: string }): Promise<{ width: number; height: number }>;
  ocr(imagePath: string): Promise<{ language: string; lines: OcrLine[] }>;
  stop(): void;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly kind: "refused" | "timeout" | "host_down" = "refused",
  ) {
    super(message);
  }
}

const TIMEOUTS: Record<string, number> = { tree: 25_000, ocr: 35_000, act: 20_000, capture: 15_000, register: 20_000, default: 12_000 };
const MAX_REPLY = 2_000_000;

/** Redacts every string anywhere in a reply (second layer: the host already did it). */
function deepRedact<T>(v: T): T {
  if (typeof v === "string") return redactSensitive(v) as T;
  if (Array.isArray(v)) return v.map(deepRedact) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, deepRedact(x)])) as T;
  return v;
}

/** Everything non-ASCII is written as \uXXXX so the host's console encoding can never garble a request. */
const asciiJson = (o: unknown): string => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

export class HostBridge implements DesktopBridge {
  epoch = 0;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private ready: Promise<void> | null = null;
  private privateDir: string | null = null;

  constructor(private readonly dir: string) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      if (process.platform !== "win32") return reject(new BridgeError("Desktop control is only available on Windows.", "host_down"));
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, "host.ps1");
      writeFileSync(file, "﻿" + HOST_SCRIPT, "utf8");
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      this.epoch += 1;
      this.buf = "";
      const timer = setTimeout(() => {
        this.killHost("The Windows host did not start in time.");
        reject(new BridgeError("The Windows host did not start in time.", "host_down"));
      }, 30_000);
      child.stdout.on("data", (d: Buffer) => {
        this.buf += d.toString("utf8");
        if (this.buf.length > MAX_REPLY * 2) this.killHost("The Windows host sent too much data.");
        let i: number;
        while ((i = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, i).replace(/^﻿/, "").trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (msg["ready"] === true) {
            clearTimeout(timer);
            resolve();
            continue;
          }
          const w = this.waiting.get(Number(msg["id"]));
          if (w) {
            this.waiting.delete(Number(msg["id"]));
            w.resolve(msg);
          }
        }
      });
      child.stderr.on("data", () => undefined); // never logged: stderr could echo screen text
      child.on("exit", () => {
        clearTimeout(timer);
        this.failAll(new BridgeError("The Windows host stopped.", "host_down"));
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new BridgeError(`The Windows host could not start: ${e.message}`, "host_down"));
      });
    });
    return this.ready.catch((e) => {
      this.ready = null;
      throw e;
    });
  }

  private failAll(err: Error): void {
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  private killHost(why: string): void {
    const c = this.child;
    this.child = null;
    this.ready = null;
    this.failAll(new BridgeError(why, "host_down"));
    try {
      c?.kill();
    } catch {
      /* already gone */
    }
  }

  private initEpoch = -1;

  /** Every request goes through here. After the host was restarted its private-folder setting is gone, so it is sent again before anything else. */
  private async call(op: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await this.start();
    if (op !== "init" && this.privateDir && this.initEpoch !== this.epoch) {
      this.initEpoch = this.epoch;
      await this.rawCall("init", { privateDir: this.privateDir });
    }
    return this.rawCall(op, params);
  }

  private async rawCall(op: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await this.start();
    const child = this.child;
    if (!child) throw new BridgeError("The Windows host is not running.", "host_down");
    const id = this.nextId++;
    const timeout = TIMEOUTS[op] ?? TIMEOUTS["default"]!;
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        // a stuck host cannot be trusted: end it. Everything it knew (registered processes) is forgotten, so every session is refused afterwards.
        this.killHost(`The Windows host did not answer "${op}" in time and was restarted.`);
        reject(new BridgeError(`The operation "${op}" did not finish in time. The Windows host was restarted, so the current sessions are no longer trusted.`, "timeout"));
      }, timeout);
      this.waiting.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(asciiJson({ id, op, ...params }) + "\n");
    });
    if (reply["ok"] !== true) throw new BridgeError(redactSensitive(String(reply["error"] ?? "The Windows host refused the request.")));
    return deepRedact(reply);
  }

  async status(): Promise<BridgeStatus> {
    const r = await this.call("status");
    return { uia: r["uia"] === true, ocr: r["ocr"] === true, ocrLanguage: (r["ocrLanguage"] as string | null) ?? null, ocrLanguages: (r["ocrLanguages"] as string[]) ?? [], powershell: String(r["powershell"] ?? "") };
  }
  async init(privateDir: string): Promise<void> {
    this.privateDir = privateDir;
    this.initEpoch = -1;
    await this.call("status");
  }
  async register(p: { pid: number; exe: string; parentPid: number; nowMs: number }): Promise<void> {
    await this.call("register", p);
  }
  async unregister(pid: number): Promise<void> {
    await this.call("unregister", { pid });
  }
  async windows(pid: number): Promise<WindowInfo[]> {
    const r = await this.call("windows", { pid });
    return (Array.isArray(r["windows"]) ? r["windows"] : r["windows"] ? [r["windows"]] : []) as WindowInfo[];
  }
  async tree(handle: number, pid: number): Promise<TreeResult> {
    const r = await this.call("tree", { handle, pid });
    const nodes = (Array.isArray(r["nodes"]) ? r["nodes"] : r["nodes"] ? [r["nodes"]] : []) as NodeInfo[];
    return { window: r["window"] as NodeInfo, nodes, truncated: r["truncated"] === true, foreign: Number(r["foreign"] ?? 0) };
  }
  async act(p: Parameters<DesktopBridge["act"]>[0]): Promise<{ after: NodeInfo | null }> {
    const r = await this.call("act", p);
    return { after: (r["after"] as NodeInfo | null) ?? null };
  }
  async keys(p: { handle: number; pid: number; keys: string }): Promise<void> {
    await this.call("keys", p);
  }
  async focus(p: { handle: number; pid: number }): Promise<boolean> {
    return (await this.call("focus", p))["foreground"] === true;
  }
  async close(p: { handle: number; pid: number; discard: boolean }): Promise<void> {
    await this.call("close", p);
  }
  async capture(p: { handle: number; pid: number; out: string }): Promise<{ width: number; height: number }> {
    const r = await this.call("capture", p);
    return { width: Number(r["width"]), height: Number(r["height"]) };
  }
  async ocr(imagePath: string): Promise<{ language: string; lines: OcrLine[] }> {
    const r = await this.call("ocr", { image: imagePath });
    const lines = (Array.isArray(r["lines"]) ? r["lines"] : r["lines"] ? [r["lines"]] : []) as OcrLine[];
    return { language: String(r["language"] ?? ""), lines: lines.map((l) => ({ ...l, words: Array.isArray(l.words) ? l.words : l.words ? [l.words as unknown as OcrWord] : [] })) };
  }
  stop(): void {
    this.killHost("The desktop bridge was stopped.");
  }
}
