import { cpus, totalmem } from "node:os";
import type { ToolInfo } from "../tools/registry.js";
import { assess, type Assessment } from "./feasibility.js";
import { LEVELS, buildCapabilities, summarize, type CapGroup, type CapLevel, type Capability, type CapabilityFacts, type CapState, type Summary } from "./registry.js";

/**
 * Reads the facts the existing services already hold and turns them into the capability list (registry.ts) and task assessments (feasibility.ts).
 *
 * Nothing is registered by hand: every tool, integration, provider, model, agent and workflow appears because the service that owns it reports it,
 * and disappears when that service stops reporting it. Every call rebuilds the list from current facts, so the Assistant, the dashboard, the Manager
 * and the workflow engine all see the same current answer (there is deliberately no time cache; only the program probes keep their own 30-second cache).
 *
 * Change detection: each rebuild is compared with the last snapshot (kept in the existing approval-settings key/value store, so it survives a restart;
 * no migration). Additions, removals and changes of installation, configuration, authentication, operational status, testing or verification are written
 * to the existing audit log as `capability.changed`. The first ever listing only sets the baseline (`capability.baseline`).
 */
export interface CapabilityDeps {
  /** `fresh` re-runs the program probes now instead of using the tool registry's short cache. */
  tools: (fresh?: boolean) => Promise<ToolInfo[]>;
  facts: () => Omit<CapabilityFacts, "tools" | "environment"> & { environment: Omit<CapabilityFacts["environment"], "platform" | "nodeVersion" | "cpuThreads" | "ramGb" | "ffmpeg"> };
  /** A FIXED command, never built from user text. */
  probeFfmpeg: () => Promise<string | null>;
  audit: {
    record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void;
    recent?(kinds: string[], limit: number): { id: number; createdAt: string; kind: string; detail: Record<string, unknown> }[];
  };
  /** The existing key/value settings store. Optional: without it the baseline lives in memory only. */
  kv?: { get(key: string): string | null; set(key: string, value: string): void };
  now: () => number;
}

export type ChangeAspect = "installation" | "configuration" | "authentication" | "operational status" | "testing" | "verification" | "state";
export interface CapabilityChange {
  id: string;
  name: string;
  group: CapGroup;
  kind: "added" | "removed" | "changed";
  from?: CapState;
  to?: CapState;
  aspects: ChangeAspect[];
}

const SNAPSHOT_KEY = "capabilities.snapshot";
const ASPECT: Record<CapLevel, ChangeAspect> = { installed: "installation", configured: "configuration", authenticated: "authentication", operational: "operational status", tested: "testing", verified: "verification" };
const LETTER = { yes: "y", no: "n", unknown: "u", "n/a": "-" } as const;
const MAX_LOGGED = 40;

interface Snap {
  n: string;
  g: CapGroup;
  s: CapState;
  /** One letter per level, in LEVELS order. */
  l: string;
}
type Snapshot = Record<string, Snap>;

const snapOf = (c: Capability): Snap => ({ n: c.name, g: c.group, s: c.state, l: LEVELS.map((k) => LETTER[c.levels[k].state]).join("") });

export function diffSnapshots(before: Snapshot, after: Snapshot): CapabilityChange[] {
  const out: CapabilityChange[] = [];
  for (const [id, a] of Object.entries(after)) {
    const b = before[id];
    if (!b) {
      out.push({ id, name: a.n, group: a.g, kind: "added", to: a.s, aspects: [] });
      continue;
    }
    if (b.s === a.s && b.l === a.l) continue;
    const aspects: ChangeAspect[] = [];
    LEVELS.forEach((k, i) => {
      if (b.l[i] !== a.l[i]) aspects.push(ASPECT[k]);
    });
    if (aspects.length === 0) aspects.push("state");
    out.push({ id, name: a.n, group: a.g, kind: "changed", from: b.s, to: a.s, aspects });
  }
  for (const [id, b] of Object.entries(before)) if (!after[id]) out.push({ id, name: b.n, group: b.g, kind: "removed", from: b.s, aspects: [] });
  return out;
}

export class CapabilityService {
  private last: Snapshot | null = null;
  private inflight: Promise<Capability[]> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly d: CapabilityDeps) {}

  /** Builds the list now from current facts. Calls that overlap share one build. */
  list(force = false): Promise<Capability[]> {
    if (this.inflight && !force) return this.inflight;
    const run = this.build(force).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async build(fresh: boolean): Promise<Capability[]> {
    const [tools, ffmpeg] = await Promise.all([this.d.tools(fresh), this.d.probeFfmpeg().catch(() => null)]);
    const f = this.d.facts();
    const caps = buildCapabilities({
      ...f,
      tools,
      environment: { ...f.environment, platform: process.platform, nodeVersion: process.version, cpuThreads: cpus().length, ramGb: Math.round(totalmem() / 1024 ** 3), ffmpeg },
    });
    this.noteChanges(caps);
    return caps;
  }

  async view(force = false): Promise<{ capabilities: Capability[]; summary: Summary; checkedAt: string; supervisedOnly: true }> {
    const capabilities = await this.list(force);
    return { capabilities, summary: summarize(capabilities), checkedAt: new Date(this.d.now()).toISOString(), supervisedOnly: true };
  }

  async assess(goal: string): Promise<Assessment> {
    return assess(goal, await this.list());
  }

  /** One capability by id, or undefined when it does not exist (any more). */
  async get(id: string): Promise<Capability | undefined> {
    return (await this.list()).find((c) => c.id === id);
  }

  /** For the Manager's planning prompt, drawn from the same list as everything else. Unproven things are never listed as working. */
  async planningSummary(): Promise<{ available: string[]; notAvailable: string[] }> {
    const caps = (await this.list()).filter((c) => c.group === "tool" || c.group === "integration");
    return {
      available: caps.filter((c) => c.state === "available").map((c) => c.name),
      notAvailable: caps.filter((c) => c.state !== "available").map((c) => (c.state === "unverified" || c.state === "partial" ? `${c.name} (set up but unproven: do not rely on it)` : c.name)),
    };
  }

  /** The recent change history, newest first, read from the audit log. */
  changes(limit = 30): { id: number; at: string; kind: string; detail: Record<string, unknown> }[] {
    const rows = this.d.audit.recent?.(["capability.changed", "capability.baseline"], Math.min(Math.max(limit, 1), 200)) ?? [];
    return rows.map((r) => ({ id: r.id, at: r.createdAt, kind: r.kind, detail: r.detail }));
  }

  /** Background rescan, so a change is noticed and logged even when nobody has the dashboard open. The server turns it on; tests call list() by hand. */
  start(everyMs: number): void {
    this.stop();
    this.timer = setInterval(() => void this.list().catch(() => undefined), everyMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private loadBaseline(): Snapshot | null {
    if (this.last) return this.last;
    const raw = this.d.kv?.get(SNAPSHOT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Snapshot;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null; // a damaged snapshot is treated as "no baseline": it is rebuilt, nothing is lost
    }
  }

  private noteChanges(caps: Capability[]): void {
    const after: Snapshot = {};
    for (const c of caps) after[c.id] = snapOf(c);
    const before = this.loadBaseline();
    this.last = after;
    if (before === null) {
      this.d.kv?.set(SNAPSHOT_KEY, JSON.stringify(after));
      this.d.audit.record("capability.baseline", { count: caps.length }, { actor: "system" });
      return;
    }
    const changes = diffSnapshots(before, after);
    if (changes.length === 0) return;
    this.d.kv?.set(SNAPSHOT_KEY, JSON.stringify(after));
    this.d.audit.record(
      "capability.changed",
      {
        added: changes.filter((c) => c.kind === "added").length,
        removed: changes.filter((c) => c.kind === "removed").length,
        changed: changes.filter((c) => c.kind === "changed").length,
        changes: changes.slice(0, MAX_LOGGED),
      },
      { actor: "system" },
    );
  }
}
