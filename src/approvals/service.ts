import { createHash, randomUUID } from "node:crypto";
import type { BotRecord } from "../agent-manager/types.js";
import type { AuditLog } from "../audit/audit.js";
import type { ConnectorDefinition, ConnectorRegistry } from "../connectors/types.js";
import { AppError } from "../errors.js";
import { redactKnownSecrets } from "../llm/plugins/index.js";
import { argNamesOf, type ActionOffer } from "./protocol.js";
import type { ApprovalRecord, ApprovalRepository } from "./repository.js";
import type { VaultService } from "../vault/service.js";

/** Fixed safety limits. Not editable: they are what keeps a confused or manipulated bot from flooding you. */
export const GATE_LIMITS = {
  /** A request you ignore expires after this long and can never run. */
  expiryMs: 24 * 3_600_000,
  maxPendingPerBot: 5,
  maxRequestsPerBotPerDay: 20,
  maxReadsPerBotPerDay: 50,
  executeTimeoutMs: 30_000,
  maxStoredResultChars: 2000,
  maxResultForBotChars: 3000,
  maxArgsJsonChars: 5000,
} as const;

const PAUSED_KEY = "external_paused";

export type ActionOutcome =
  | { status: "done"; text: string }
  | { status: "pending_approval"; approvalId: string }
  | { status: "denied" | "failed"; reason: string };

export interface ApprovalView {
  id: string;
  botId: string;
  botName: string;
  taskId: string | null;
  connector: string;
  connectorLabel: string;
  action: string;
  summary: string;
  /** The exact content that will be used if you approve. */
  args: unknown;
  status: ApprovalRecord["status"];
  result: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  executedAt: string | null;
}

export interface GateDeps {
  repo: ApprovalRepository;
  registry: ConnectorRegistry;
  audit: AuditLog;
  vault: VaultService;
  getBot: (id: string) => BotRecord;
  /** Has the owner switched on READING from this connector for this bot? */
  readEnabled: (botId: string, connector: string) => boolean;
  now?: () => number;
  /** The Guardian: a plain-language reason while nothing new may run (paused, stopped, locked), else null. */
  startGuard?: () => string | null;
  /** An operating-mode ceiling (Bot Studio): why this bot's mode does not allow this connector, or null. It can only forbid, never grant. */
  modeBlock?: (botId: string, connectorId: string, kind: "read" | "write") => string | null;
  /** Called after a request starts waiting for the owner (the inbox uses it). A failure here never affects the request. */
  onPending?: (approvalId: string, botId: string) => void;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The action took longer than ${Math.round(ms / 1000)} seconds and was stopped.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Every outside action passes through here.
 *  - READ actions run only if you switched on reading for that bot and connector.
 *  - WRITE actions never run by themselves: they wait, showing you the exact content, until you approve.
 *    An approved action runs once, with exactly the content you saw. Denied, expired, repeated or edited
 *    requests never run.
 *  - One switch pauses all outside actions.
 */
export class ActionGate {
  private readonly now: () => number;

  constructor(private readonly deps: GateDeps) {
    this.now = deps.now ?? Date.now;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  // ---- the kill switch ----
  isPaused(): boolean {
    return this.deps.repo.getSetting(PAUSED_KEY) === "true";
  }

  setPaused(paused: boolean): void {
    this.deps.repo.setSetting(PAUSED_KEY, paused ? "true" : "false", this.iso());
    this.deps.audit.record(paused ? "external.paused" : "external.resumed", {}, { actor: "owner" });
  }

  status() {
    this.expireOld();
    return {
      paused: this.isPaused(),
      pendingCount: this.deps.repo.countPending(),
      connectors: this.deps.registry.list().map((c) => ({
        id: c.id,
        label: c.label,
        notReady: this.notReadyReason(c),
        actions: Object.entries(c.actions).map(([name, a]) => ({ name, kind: a.kind, description: a.description })),
      })),
      limits: { ...GATE_LIMITS },
    };
  }

  private notReadyReason(c: ConnectorDefinition): string | null {
    return c.notReady ? c.notReady({ secret: (n) => this.deps.vault.resolve(n) }) : null;
  }

  /** What this bot may ask for right now. A read action is only offered if reading is switched on for the bot. */
  offersFor(botId: string): ActionOffer[] {
    if (this.isPaused()) return [];
    const offers: ActionOffer[] = [];
    for (const connector of this.deps.registry.list()) {
      if (this.notReadyReason(connector)) continue;
      for (const [action, spec] of Object.entries(connector.actions)) {
        if (spec.kind === "read" && !this.deps.readEnabled(botId, connector.id)) continue;
        if (this.deps.modeBlock?.(botId, connector.id, spec.kind)) continue; // the bot's operating mode does not include this
        if (connector.authorize?.(botId, action, {}) != null) continue; // the bot lacks the permission this action needs
        offers.push({ connector: connector.id, connectorLabel: connector.label, action, kind: spec.kind, description: spec.description, argNames: argNamesOf(spec.args) });
      }
    }
    return offers;
  }

  // ---- a bot asks ----
  async request(botId: string, taskId: string | null, req: { connector: string; action: string; args: Record<string, unknown> }): Promise<ActionOutcome> {
    const { registry, repo, audit } = this.deps;
    const label = `${req.connector}.${req.action}`;
    const deny = (reason: string, kind = "external.denied"): ActionOutcome => {
      audit.record(kind, { action: label, reason }, { botId, actor: "bot" });
      return { status: "denied", reason };
    };

    const spec = registry.action(req.connector, req.action);
    if (!spec) return deny(`"${label}" is not an action that exists.`);
    const connector = registry.get(req.connector)!;

    let bot: BotRecord;
    try {
      bot = this.deps.getBot(botId);
    } catch {
      return deny("The bot does not exist.");
    }
    if (bot.archived) return deny("The bot is archived.");
    if (this.isPaused()) return deny("All outside actions are paused by the owner.");
    const held = this.deps.startGuard?.();
    if (held) return deny(held);
    const notReady = this.notReadyReason(connector);
    if (notReady) return deny(`${connector.label} is not set up yet: ${notReady}`);

    const parsed = spec.args.safeParse(req.args);
    if (!parsed.success) {
      const problem = parsed.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ");
      return deny(`The arguments are not valid: ${clip(problem, 300)}`);
    }
    const notAllowed = connector.authorize?.(botId, req.action, parsed.data) ?? null;
    if (notAllowed) return deny(notAllowed, "external.read_denied");
    const modeNo = this.deps.modeBlock?.(botId, req.connector, spec.kind) ?? null;
    if (modeNo) return deny(modeNo, "external.read_denied");
    const argsJson = JSON.stringify(parsed.data);
    if (argsJson.length > GATE_LIMITS.maxArgsJsonChars) return deny("The arguments are too large.");
    const summary = clip(spec.summarize(parsed.data), 300);

    if (spec.kind === "read") {
      if (!this.deps.readEnabled(botId, req.connector)) {
        return deny(`${connector.label} reading is not switched on for this bot. The owner must allow it on the bot's Permissions tab.`, "external.read_denied");
      }
      const startOfDay = new Date(this.now());
      startOfDay.setHours(0, 0, 0, 0);
      if (audit.countSince("external.read", botId, startOfDay.getTime()) >= GATE_LIMITS.maxReadsPerBotPerDay) {
        return deny(`This bot has reached today's limit of ${GATE_LIMITS.maxReadsPerBotPerDay} outside reads.`);
      }
      try {
        const text = await withTimeout(spec.execute(parsed.data, { secret: (n) => this.deps.vault.resolve(n), botId, taskId }), spec.timeoutMs ?? GATE_LIMITS.executeTimeoutMs);
        audit.record("external.read", { action: label, summary, ok: true }, { botId, actor: "bot" });
        return { status: "done", text: clip(redactKnownSecrets(text), GATE_LIMITS.maxResultForBotChars) };
      } catch (err) {
        const reason = clip(redactKnownSecrets(err instanceof Error ? err.message : "The action failed."), 300);
        audit.record("external.read", { action: label, summary, ok: false, error: reason }, { botId, actor: "bot" });
        return { status: "failed", reason };
      }
    }

    // A write: it only ever waits for the owner.
    this.expireOld();
    if (repo.countPending(botId) >= GATE_LIMITS.maxPendingPerBot) {
      return deny(`This bot already has ${GATE_LIMITS.maxPendingPerBot} requests waiting for approval. They must be decided first.`);
    }
    const dayAgo = new Date(this.now() - 24 * 3_600_000).toISOString();
    if (repo.countCreatedSince(botId, dayAgo) >= GATE_LIMITS.maxRequestsPerBotPerDay) {
      return deny(`This bot reached its limit of ${GATE_LIMITS.maxRequestsPerBotPerDay} approval requests in a day.`);
    }
    const id = randomUUID();
    repo.insert({
      id,
      botId,
      taskId,
      connector: req.connector,
      action: req.action,
      summary,
      argsJson,
      argsHash: sha256(argsJson),
      createdAt: this.iso(),
      expiresAt: new Date(this.now() + GATE_LIMITS.expiryMs).toISOString(),
    });
    audit.record("approval.requested", { id, action: label, summary }, { botId, actor: "bot" });
    try {
      this.deps.onPending?.(id, botId);
    } catch {
      /* telling the inbox must never change what the gate decided */
    }
    return { status: "pending_approval", approvalId: id };
  }

  // ---- the owner decides ----
  private view(a: ApprovalRecord): ApprovalView {
    let botName = "(unknown)";
    try {
      botName = this.deps.getBot(a.botId).name;
    } catch {
      /* keep the placeholder */
    }
    return {
      id: a.id,
      botId: a.botId,
      botName,
      taskId: a.taskId,
      connector: a.connector,
      connectorLabel: this.deps.registry.get(a.connector)?.label ?? a.connector,
      action: a.action,
      summary: a.summary,
      args: JSON.parse(a.argsJson),
      status: a.status,
      result: a.result,
      error: a.error,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
      decidedAt: a.decidedAt,
      decidedBy: a.decidedBy,
      executedAt: a.executedAt,
    };
  }

  private expireOld(): void {
    for (const id of this.deps.repo.expireOld(this.iso())) this.deps.audit.record("approval.expired", { id });
  }

  list(onlyPending: boolean, limit = 100): ApprovalView[] {
    this.expireOld();
    return this.deps.repo.list(onlyPending, limit).map((a) => this.view(a));
  }

  get(id: string): ApprovalView {
    this.expireOld();
    const found = this.deps.repo.get(id);
    if (!found) throw new AppError(404, "approval_not_found", "Approval request not found");
    return this.view(found);
  }

  /** The owner approves: the action runs now, once, with exactly the content that was shown. */
  async approve(id: string): Promise<ApprovalView> {
    const { repo, audit, registry } = this.deps;
    this.expireOld();
    const existing = repo.get(id);
    if (!existing) throw new AppError(404, "approval_not_found", "Approval request not found");
    if (this.isPaused()) throw new AppError(409, "external_paused", "All outside actions are paused. Switch them back on before approving.");
    const held = this.deps.startGuard?.();
    if (held) throw new AppError(409, "guardian_paused", held);
    if (!repo.claimApproval(id, this.iso(), "owner")) {
      throw new AppError(409, "approval_not_pending", `This request is already ${repo.get(id)?.status}. It cannot be approved now.`);
    }
    audit.record("approval.approved", { id, action: `${existing.connector}.${existing.action}` }, { botId: existing.botId, actor: "owner" });

    const fail = (message: string): ApprovalView => {
      const clean = clip(redactKnownSecrets(message), 500);
      repo.finish(id, "failed", this.iso(), { error: clean });
      audit.record("approval.failed", { id, error: clean }, { botId: existing.botId });
      return this.get(id);
    };

    // Safety checks right before running: the stored content must be exactly what was shown and approved.
    if (sha256(existing.argsJson) !== existing.argsHash) return fail("Safety check failed: the stored request was changed. Nothing was run.");
    const spec = registry.action(existing.connector, existing.action);
    if (!spec) return fail("That action no longer exists. Nothing was run.");
    const args = spec.args.safeParse(JSON.parse(existing.argsJson));
    if (!args.success) return fail("The request no longer passes its checks. Nothing was run.");
    const notReadyNow = this.notReadyReason(registry.get(existing.connector)!);
    if (notReadyNow) return fail(`${registry.get(existing.connector)!.label} is not ready: ${notReadyNow} Nothing was run.`);
    const stillAllowed = registry.get(existing.connector)?.authorize?.(existing.botId, existing.action, args.data) ?? null;
    if (stillAllowed) return fail(`${stillAllowed} Nothing was run.`);
    const modeNowNo = this.deps.modeBlock?.(existing.botId, existing.connector, spec.kind) ?? null;
    if (modeNowNo) return fail(`${modeNowNo} Nothing was run.`);

    try {
      const result = await withTimeout(spec.execute(args.data, { secret: (n) => this.deps.vault.resolve(n), botId: existing.botId, taskId: existing.taskId }), spec.timeoutMs ?? GATE_LIMITS.executeTimeoutMs);
      repo.finish(id, "executed", this.iso(), { result: clip(redactKnownSecrets(result), GATE_LIMITS.maxStoredResultChars) });
      audit.record("approval.executed", { id, action: `${existing.connector}.${existing.action}` }, { botId: existing.botId });
      return this.get(id);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The action failed.");
    }
  }

  deny(id: string, reason: string | null): ApprovalView {
    const { repo, audit } = this.deps;
    this.expireOld();
    const existing = repo.get(id);
    if (!existing) throw new AppError(404, "approval_not_found", "Approval request not found");
    if (!repo.claimDenial(id, this.iso(), "owner", reason ? clip(reason.trim(), 300) : null)) {
      throw new AppError(409, "approval_not_pending", `This request is already ${repo.get(id)?.status}. It cannot be denied now.`);
    }
    audit.record("approval.denied", { id, action: `${existing.connector}.${existing.action}` }, { botId: existing.botId, actor: "owner" });
    return this.get(id);
  }
}
