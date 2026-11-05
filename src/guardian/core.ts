import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { NetAdapter, VmAdapter } from "./adapters.js";
import type { Journal } from "./journal.js";
import { signLease } from "./lease.js";
import { parsePassphraseRecord, verifyPassphrase } from "./passphrase.js";
import type { PresenceSource } from "./presence.js";
import type { TreeStopper } from "./process-tree.js";

/**
 * The Guardian's brain. It knows four states and a CLOSED list of commands. There is no command that takes a program name, a file path
 * or a script: the only free text it ever receives is the owner's passphrase.
 *
 *   RUN      the AI Workforce may start tasks (leases are issued).
 *   PAUSED   nothing new starts: no tasks, retries, leases or scheduled runs. Running tasks stop at their next safe point. Only the owner resumes.
 *   STOPPED  PAUSED + the programs the AI Workforce started are ended and a VM (if configured) is suspended.
 *   LOCKED   STOPPED + the VM is shut down and its network is blocked. Needs the passphrase to unlock, then to resume.
 *
 * The Guardian never imports or calls the Manager. Tier A (this build) runs as the same Windows user as everything else and is for
 * development and supervised testing only; see docs/GUARDIAN.md.
 */
export const STATES = ["RUN", "PAUSED", "STOPPED", "LOCKED"] as const;
export type GuardianState = (typeof STATES)[number];

const pass = z.string().min(1).max(200);
export const commandSchema = z.discriminatedUnion("cmd", [
  z.strictObject({ cmd: z.literal("status") }),
  z.strictObject({ cmd: z.literal("pause") }),
  z.strictObject({ cmd: z.literal("stop") }),
  z.strictObject({ cmd: z.literal("lockdown") }),
  z.strictObject({ cmd: z.literal("resume"), passphrase: pass }),
  z.strictObject({ cmd: z.literal("unlock"), passphrase: pass }),
  z.strictObject({ cmd: z.literal("proof"), passphrase: pass }),
  z.strictObject({ cmd: z.literal("check_proof"), token: z.string().min(10).max(100) }),
  z.strictObject({ cmd: z.literal("lease") }),
]);
export type Command = z.infer<typeof commandSchema>;

export type Result = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };

export const PROOF_WINDOW_MS = 10 * 60_000;
export const IDLE_LIMIT_MS = 15 * 60_000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60_000;
const LOCKOUT_MS = 15 * 60_000;
const PRESENCE_GRACE_MS = 60_000;

export interface CoreDeps {
  dir: string;
  now: () => number;
  journal: Journal;
  tree: TreeStopper;
  vm: VmAdapter | null;
  net: NetAdapter | null;
  presence: PresenceSource | null;
  /** If true (the default), a missing or silent presence monitor pauses everything. Only the owner can switch it off, in the settings file. */
  presenceRequired: boolean;
  leaseKey: Buffer;
  idleLimitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Persisted {
  state: GuardianState;
  reason: string;
  since: string;
  netBlocked: boolean;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class GuardianCore {
  private p: Persisted;
  private proofs = new Map<string, number>();
  private fails: number[] = [];
  private lockedUntil = 0;
  private silentSince: number | null = null;
  private readonly idleLimit: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly stateFile: string;
  private readonly passFile: string;

  constructor(private readonly d: CoreDeps) {
    mkdirSync(d.dir, { recursive: true });
    this.stateFile = join(d.dir, "state.json");
    this.passFile = join(d.dir, "passphrase.json");
    this.idleLimit = d.idleLimitMs ?? IDLE_LIMIT_MS;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const loaded = this.load();
    // After any restart the Guardian starts PAUSED: only the owner can say the AI Workforce may run again.
    this.p = loaded && loaded.state !== "RUN" ? loaded : { state: "PAUSED", reason: loaded ? "restart" : "first_start", since: this.iso(), netBlocked: loaded?.netBlocked ?? false };
    this.save();
    d.journal.append("guardian_started", { state: this.p.state, reason: this.p.reason });
  }

  private iso(): string {
    return new Date(this.d.now()).toISOString();
  }

  private load(): Persisted | null {
    try {
      if (!existsSync(this.stateFile)) return null;
      const o = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<Persisted>;
      if (o.state && (STATES as readonly string[]).includes(o.state)) return { state: o.state, reason: String(o.reason ?? ""), since: String(o.since ?? ""), netBlocked: o.netBlocked === true };
    } catch {
      /* a damaged state file is treated like a first start: PAUSED */
    }
    return null;
  }

  private save(): void {
    const tmp = this.stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.p), "utf8");
    renameSync(tmp, this.stateFile);
  }

  private set(state: GuardianState, reason: string): void {
    this.p = { ...this.p, state, reason, since: this.iso() };
    if (state !== "RUN") this.proofs.clear(); // a pause ends every decision window
    this.save();
  }

  passphraseSet(): boolean {
    return this.record() !== null;
  }

  private record() {
    try {
      return existsSync(this.passFile) ? parsePassphraseRecord(readFileSync(this.passFile, "utf8")) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- reading

  status() {
    const s = this.d.presence?.sample() ?? null;
    return {
      tier: "A" as const,
      state: this.p.state,
      reason: this.p.reason,
      since: this.p.since,
      passphraseSet: this.passphraseSet(),
      netBlocked: this.p.netBlocked,
      presence: {
        monitoring: this.d.presence !== null,
        required: this.d.presenceRequired,
        healthy: s !== null && this.d.now() - s.at < 20_000,
        locked: s?.locked ?? null,
        idleMinutes: s ? Math.floor(s.idleMs / 60_000) : null,
        idleLimitMinutes: Math.round(this.idleLimit / 60_000),
      },
      limits: "Tier A: development and supervised testing only. Not protection against a hostile process of the same Windows user.",
      now: this.iso(),
    };
  }

  // ---------------------------------------------------------------- commands

  async handle(cmd: Command, caller = "local"): Promise<Result> {
    switch (cmd.cmd) {
      case "status":
        return { ok: true, ...this.status() };
      case "pause":
        return this.pause("owner", caller);
      case "stop":
        return this.halt("stop", caller);
      case "lockdown":
        return this.halt("lockdown", caller);
      case "resume":
        return this.resume(cmd.passphrase, caller);
      case "unlock":
        return this.unlock(cmd.passphrase, caller);
      case "proof":
        return this.proof(cmd.passphrase, caller);
      case "check_proof":
        return { ok: true, valid: this.checkProof(cmd.token) };
      case "lease":
        if (this.p.state !== "RUN") return { ok: false, code: "not_running", message: `No lease: the AI Workforce is ${this.p.state}.` };
        return { ok: true, lease: signLease(this.d.leaseKey, this.d.now()) };
    }
  }

  /** Stopping direction: always allowed, no passphrase. */
  pause(reason: string, by: string): Result {
    if (this.p.state === "RUN") {
      this.set("PAUSED", reason);
      this.d.journal.append("pause", { reason, by });
    }
    return { ok: true, ...this.status() };
  }

  private async halt(level: "stop" | "lockdown", by: string): Promise<Result> {
    if (this.p.state === "LOCKED" || (level === "stop" && this.p.state === "STOPPED")) return { ok: true, ...this.status() };
    this.set(level === "stop" ? "STOPPED" : "LOCKED", level === "stop" ? "owner_stop" : "owner_lockdown");
    this.d.journal.append(level, { by });
    const steps: Record<string, unknown> = {};
    try {
      const r = await this.d.tree.stop();
      steps["programs"] = { managerFound: r.managerFound, killed: r.killed.length, skipped: r.skipped.length, failed: r.failed.length };
      this.d.journal.append("programs_stopped", { managerFound: r.managerFound, killed: r.killed, skipped: r.skipped, failed: r.failed });
    } catch (e) {
      steps["programs"] = { error: true };
      this.d.journal.append("programs_stop_error", { message: errText(e) });
    }
    if (this.d.vm) {
      try {
        if (level === "stop") {
          const r = await this.d.vm.suspend();
          steps["vm"] = r;
          this.d.journal.append("vm_suspend", { ...r });
        } else {
          const soft = await this.d.vm.stop(false);
          this.d.journal.append("vm_stop_soft", { ...soft });
          let r = soft;
          if (!soft.ok) {
            await this.sleep(2000);
            r = await this.d.vm.stop(true);
            this.d.journal.append("vm_stop_hard", { ...r });
          }
          steps["vm"] = r;
        }
      } catch (e) {
        steps["vm"] = { error: true };
        this.d.journal.append("vm_error", { message: errText(e) });
      }
    } else {
      this.d.journal.append("vm_skipped", { reason: "no VM is configured" });
    }
    if (this.d.net) {
      try {
        const r = await this.d.net.block();
        if (r.ok) {
          this.p.netBlocked = true;
          this.save();
        }
        steps["network"] = r;
        this.d.journal.append("network_block", { ...r });
      } catch (e) {
        steps["network"] = { error: true };
        this.d.journal.append("network_error", { message: errText(e) });
      }
    }
    return { ok: true, ...this.status(), steps };
  }

  private async resume(passphrase: string, by: string): Promise<Result> {
    if (this.p.state === "RUN") return { ok: true, ...this.status() };
    if (this.p.state === "LOCKED") return { ok: false, code: "locked", message: "Locked down. Unlock it first." };
    const bad = this.verify(passphrase, "resume", by);
    if (bad) return bad;
    if (this.p.netBlocked && this.d.net) {
      const r = await this.d.net.unblock();
      this.d.journal.append("network_unblock", { ...r });
      if (r.ok) this.p.netBlocked = false;
    }
    this.set("RUN", "owner_resumed");
    this.silentSince = null;
    this.d.journal.append("resume", { by });
    return { ok: true, ...this.status(), ...this.issueProof() };
  }

  private unlock(passphrase: string, by: string): Result {
    if (this.p.state !== "LOCKED") return { ok: false, code: "not_locked", message: "It is not locked down." };
    const bad = this.verify(passphrase, "unlock", by);
    if (bad) return bad;
    this.set("PAUSED", "unlocked");
    this.d.journal.append("unlock", { by });
    return { ok: true, ...this.status() };
  }

  private proof(passphrase: string, by: string): Result {
    if (this.p.state !== "RUN") return { ok: false, code: "not_running", message: `Resume first: the AI Workforce is ${this.p.state}.` };
    const bad = this.verify(passphrase, "proof", by);
    if (bad) return bad;
    return { ok: true, ...this.issueProof() };
  }

  /** Opens a 10-minute decision window. The token is returned once and only a hash of it is kept. */
  private issueProof() {
    const token = randomBytes(32).toString("base64url");
    const expires = this.d.now() + PROOF_WINDOW_MS;
    this.proofs.set(sha(token), expires);
    this.d.journal.append("proof_window_opened", { until: new Date(expires).toISOString() });
    return { token, expiresAt: new Date(expires).toISOString() };
  }

  checkProof(token: string): boolean {
    if (this.p.state !== "RUN") return false;
    const key = sha(token);
    const until = this.proofs.get(key);
    if (until === undefined) return false;
    if (this.d.now() >= until) {
      this.proofs.delete(key);
      return false;
    }
    return true;
  }

  /** Returns an error result if the passphrase is not accepted, otherwise null. Failed tries are limited and logged (never the text). */
  private verify(passphrase: string, purpose: string, by: string): Result | null {
    const t = this.d.now();
    if (t < this.lockedUntil) return { ok: false, code: "too_many_attempts", message: `Too many wrong tries. Wait ${Math.ceil((this.lockedUntil - t) / 60_000)} minute(s).` };
    const rec = this.record();
    if (!rec) return { ok: false, code: "no_passphrase", message: "No owner passphrase is set. Run: npm run guardian:passphrase" };
    if (verifyPassphrase(passphrase, rec)) {
      this.fails = [];
      return null;
    }
    this.fails = this.fails.filter((x) => t - x < FAIL_WINDOW_MS);
    this.fails.push(t);
    this.d.journal.append("wrong_passphrase", { purpose, by, recentFailures: this.fails.length });
    if (this.fails.length >= MAX_FAILS) {
      this.lockedUntil = t + LOCKOUT_MS;
      this.fails = [];
      this.d.journal.append("passphrase_lockout", { minutes: LOCKOUT_MS / 60_000 });
    }
    return { ok: false, code: "wrong_passphrase", message: "That passphrase is not correct." };
  }

  // ---------------------------------------------------------------- the clock

  /** Called every few seconds: looks at presence and keeps the process scan fresh. */
  async tick(): Promise<void> {
    await this.d.tree.scan().catch(() => undefined);
    if (this.p.state !== "RUN") return;
    if (!this.d.presence) {
      if (this.d.presenceRequired) this.pause("presence_unavailable", "guardian");
      return;
    }
    const t = this.d.now();
    const s = this.d.presence.sample();
    if (!s || t - s.at > 20_000) {
      this.silentSince ??= t;
      if (this.d.presenceRequired && t - this.silentSince > PRESENCE_GRACE_MS) this.pause("presence_unavailable", "guardian");
      return;
    }
    this.silentSince = null;
    if (s.locked) this.pause("session_locked", "guardian");
    else if (s.idleMs >= this.idleLimit) this.pause("idle_15_minutes", "guardian");
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : "unknown error";
}
