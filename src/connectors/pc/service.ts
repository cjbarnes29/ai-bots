import { cpus, freemem, platform, release, totalmem, uptime } from "node:os";
import { statfsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../../audit/audit.js";
import { AppError } from "../../errors.js";
import { validateRoot } from "./paths.js";
import { PC_GRANTS, type PcGrant } from "./policy.js";
import { RUN_LIMITS, startProcess, type PcProcess, type RunResult, type RunSpec } from "./runner.js";

/**
 * The PC agent's state: which folders are workspaces, who holds which of the five permissions, the emergency stop, programs that are running,
 * and the permanent log. The actions themselves are in connector.ts and always go through the approval gate.
 */
export interface Execution {
  id: number;
  startedAt: string;
  botId: string | null;
  botName: string | null;
  action: string;
  cwd: string | null;
  command: string;
  status: "ok" | "failed" | "timeout" | "stopped" | "refused";
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
}

export interface RunningServer {
  id: string;
  command: string;
  cwd: string;
  startedAt: string;
  expiresAt: string;
  botId: string | null;
}

export interface PcDeps {
  db: DatabaseSync;
  audit: AuditLog;
  now: () => number;
  /** Folders that must never be offered as a workspace (this app's data and project folders). */
  forbiddenRoots: () => string[];
  botName: (id: string) => string | null;
  botExists: (id: string) => boolean;
  /** Starting programs (tests supply a fake). */
  start?: (spec: RunSpec) => PcProcess;
  ollama?: () => { enabled: boolean; usableModels: number };
}

const ROOTS_KEY = "roots";
const STOPPED_KEY = "stopped";
const MAX_ROOTS = 5;

export class PcService {
  private readonly servers = new Map<string, { info: RunningServer; proc: PcProcess; timer: NodeJS.Timeout }>();
  private readonly running = new Set<PcProcess>();

  constructor(private readonly d: PcDeps) {}

  private iso(): string {
    return new Date(this.d.now()).toISOString();
  }

  // ---------------- settings ----------------
  private getSetting(key: string): string | null {
    const r = this.d.db.prepare("SELECT value FROM pc_settings WHERE key = ?").get(key);
    return r ? String(r["value"]) : null;
  }

  private setSetting(key: string, value: string): void {
    this.d.db.prepare("INSERT INTO pc_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value, this.iso());
  }

  roots(): string[] {
    try {
      const parsed = JSON.parse(this.getSetting(ROOTS_KEY) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  addRoot(input: string): string[] {
    const check = validateRoot(input, this.d.forbiddenRoots());
    if (!check.ok) throw new AppError(400, "bad_workspace", check.reason);
    const roots = this.roots();
    if (roots.length >= MAX_ROOTS) throw new AppError(409, "too_many_workspaces", `At most ${MAX_ROOTS} workspace folders.`);
    if (!roots.some((r) => r.toLowerCase() === check.abs.toLowerCase())) roots.push(check.abs);
    this.setSetting(ROOTS_KEY, JSON.stringify(roots));
    this.d.audit.record("pc.workspace_added", { path: check.abs }, { actor: "owner" });
    return roots;
  }

  removeRoot(input: string): string[] {
    const roots = this.roots().filter((r) => r.toLowerCase() !== input.toLowerCase());
    this.setSetting(ROOTS_KEY, JSON.stringify(roots));
    this.d.audit.record("pc.workspace_removed", { path: input }, { actor: "owner" });
    return roots;
  }

  isStopped(): boolean {
    return this.getSetting(STOPPED_KEY) === "true";
  }

  // ---------------- the five permissions ----------------
  grantsOf(botId: string): PcGrant[] {
    return this.d.db.prepare("SELECT permission FROM pc_grants WHERE bot_id = ?").all(botId).map((r) => String(r["permission"]) as PcGrant);
  }

  hasGrant(botId: string, grant: PcGrant): boolean {
    return this.d.db.prepare("SELECT 1 AS x FROM pc_grants WHERE bot_id = ? AND permission = ?").get(botId, grant) !== undefined;
  }

  setGrants(botId: string, grants: string[]): PcGrant[] {
    if (!this.d.botExists(botId)) throw new AppError(404, "bot_not_found", "Bot not found");
    const unique = [...new Set(grants)];
    for (const g of unique) if (!(PC_GRANTS as readonly string[]).includes(g)) throw new AppError(400, "bad_permission", `Unknown permission: ${g}.`);
    if (unique.includes("admin")) throw new AppError(409, "admin_not_available", "Administrator access is not available in this version. Nothing here can raise its own privileges.");
    this.d.db.exec("BEGIN");
    try {
      this.d.db.prepare("DELETE FROM pc_grants WHERE bot_id = ?").run(botId);
      const ins = this.d.db.prepare("INSERT INTO pc_grants (bot_id, permission, granted_at) VALUES (?, ?, ?)");
      for (const g of unique) ins.run(botId, g, this.iso());
      this.d.db.exec("COMMIT");
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      throw e;
    }
    this.d.audit.record("pc.permissions_changed", { grants: unique }, { actor: "owner", botId });
    return unique as PcGrant[];
  }

  // ---------------- log ----------------
  log(entry: { botId?: string | null; action: string; cwd?: string | null; command: string; status: Execution["status"]; exitCode?: number | null; durationMs?: number | null; output?: string | null }): void {
    this.d.db
      .prepare("INSERT INTO pc_executions (started_at, bot_id, action, cwd, command, status, exit_code, duration_ms, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(this.iso(), entry.botId ?? null, entry.action, entry.cwd ?? null, entry.command, entry.status, entry.exitCode ?? null, entry.durationMs ?? null, entry.output ? entry.output.slice(0, 4000) : null);
  }

  executions(limit = 50): Execution[] {
    return this.d.db
      .prepare("SELECT * FROM pc_executions ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((r) => ({
        id: Number(r["id"]),
        startedAt: String(r["started_at"]),
        botId: r["bot_id"] === null ? null : String(r["bot_id"]),
        botName: r["bot_id"] === null ? null : this.d.botName(String(r["bot_id"])),
        action: String(r["action"]),
        cwd: r["cwd"] === null ? null : String(r["cwd"]),
        command: String(r["command"]),
        status: String(r["status"]) as Execution["status"],
        exitCode: r["exit_code"] === null ? null : Number(r["exit_code"]),
        durationMs: r["duration_ms"] === null ? null : Number(r["duration_ms"]),
        output: r["output"] === null ? null : String(r["output"]),
      }));
  }

  // ---------------- running programs ----------------
  /** Runs a program to the end (with a time limit). The emergency stop ends it early. */
  async run(spec: RunSpec): Promise<RunResult> {
    if (this.isStopped()) throw new AppError(409, "pc_stopped", "The PC agent is stopped (emergency stop). Resume it in Settings first.");
    const proc = (this.d.start ?? startProcess)(spec);
    this.running.add(proc);
    try {
      return await proc.done;
    } finally {
      this.running.delete(proc);
    }
  }

  startServer(spec: RunSpec, command: string, botId: string | null): RunningServer {
    if (this.isStopped()) throw new AppError(409, "pc_stopped", "The PC agent is stopped (emergency stop). Resume it in Settings first.");
    if (this.servers.size >= RUN_LIMITS.maxServers) throw new AppError(409, "too_many_servers", `At most ${RUN_LIMITS.maxServers} programs can be kept running. Stop one first.`);
    const proc = (this.d.start ?? startProcess)({ ...spec, timeoutMs: RUN_LIMITS.maxServerMs });
    const id = `srv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const info: RunningServer = { id, command, cwd: spec.cwd, startedAt: this.iso(), expiresAt: new Date(this.d.now() + RUN_LIMITS.maxServerMs).toISOString(), botId };
    const timer = setTimeout(() => this.stopServer(id), RUN_LIMITS.maxServerMs);
    timer.unref();
    this.servers.set(id, { info, proc, timer });
    void proc.done.then((r) => {
      clearTimeout(timer);
      this.servers.delete(id);
      this.log({ botId, action: "start_server", cwd: spec.cwd, command, status: r.stopped ? "stopped" : r.timedOut ? "timeout" : r.exitCode === 0 ? "ok" : "failed", exitCode: r.exitCode, durationMs: r.durationMs, output: r.output });
    });
    return info;
  }

  servers_(): RunningServer[] {
    return [...this.servers.values()].map((s) => s.info);
  }

  stopServer(id: string): boolean {
    const s = this.servers.get(id);
    if (!s) return false;
    s.proc.stop();
    return true;
  }

  /** The emergency stop: everything that is running is killed, and nothing new can start until the owner resumes. */
  emergencyStop(by: string): number {
    this.setSetting(STOPPED_KEY, "true");
    let n = 0;
    for (const p of this.running) {
      p.stop();
      n++;
    }
    for (const s of this.servers.values()) {
      s.proc.stop();
      n++;
    }
    this.d.audit.record("pc.emergency_stop", { stopped: n }, { actor: by });
    return n;
  }

  resume(): void {
    this.setSetting(STOPPED_KEY, "false");
    this.d.audit.record("pc.resumed", {}, { actor: "owner" });
  }

  /** Called when the app closes: nothing is left running. */
  shutdown(): void {
    for (const p of this.running) p.stop();
    for (const s of this.servers.values()) {
      clearTimeout(s.timer);
      s.proc.stop();
    }
  }

  // ---------------- facts for the dashboard and bots ----------------
  async resources(): Promise<{ cpuPercent: number; memoryUsedPercent: number; memoryGb: number; cpuThreads: number; disk: { path: string; freeGb: number; totalGb: number }[]; uptimeHours: number; os: string; localAi: { enabled: boolean; usableModels: number } | null }> {
    const sample = () => cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
    const a = sample();
    await new Promise((r) => setTimeout(r, 150));
    const b = sample();
    const cpuPercent = b.total === a.total ? 0 : Math.round(100 * (1 - (b.idle - a.idle) / (b.total - a.total)));
    const disk = this.roots().flatMap((p) => {
      try {
        const s = statfsSync(p);
        return [{ path: p, freeGb: Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3), totalGb: Math.round((Number(s.blocks) * Number(s.bsize)) / 1024 ** 3) }];
      } catch {
        return [];
      }
    });
    return {
      cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
      memoryUsedPercent: Math.round(100 * (1 - freemem() / totalmem())),
      memoryGb: Math.round(totalmem() / 1024 ** 3),
      cpuThreads: cpus().length,
      disk,
      uptimeHours: Math.round(uptime() / 3600),
      os: `${platform()} ${release()}`,
      localAi: this.d.ollama?.() ?? null,
    };
  }

  status() {
    return { roots: this.roots(), stopped: this.isStopped(), servers: this.servers_(), limits: { ...RUN_LIMITS, maxRoots: MAX_ROOTS } };
  }
}
