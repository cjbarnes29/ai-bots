import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ActionOutcome } from "../approvals/service.js";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";

/**
 * Inbound messages (Phase 12). A source checks Telegram or Gmail every so often and turns each NEW message into a text event,
 * which the owner's triggers can react to. Rules that cannot be bypassed:
 *  - Every source is created OFF, and only the owner on the PC can create, change or switch one on.
 *  - Reading goes through the same approval gate as a bot asking: the bot named on the source must have that connector's READ permission,
 *    and each check counts against that bot's daily outside-read limit (so at most one check per 30 minutes).
 *  - The first check only notes what is already there; old messages never become events.
 *  - At most 3 new messages per check become events. Everything else is noted as seen and dropped.
 *  - Paused outside actions or paused automation stop all checking. Three failures in a row switch a source off.
 *  - Message text is untrusted: it only reaches triggers as text, exactly like an event typed by hand.
 */
export const INBOUND_LIMITS = { minIntervalMinutes: 30, maxSources: 5, maxEventsPerPoll: 3, maxFailures: 3, keepSeen: 500, maxEventChars: 500 };

type Connector = "telegram" | "gmail";
const PRESETS: Record<Connector, { action: string; args: Record<string, unknown>; empty: string; defaultEvent: string; label: string }> = {
  telegram: { action: "read_messages", args: {}, empty: "No recent messages.", defaultEvent: "telegram_message", label: "Telegram" },
  gmail: { action: "search_messages", args: { query: "is:unread newer_than:1d", max: 10 }, empty: "No messages found.", defaultEvent: "gmail_message", label: "Gmail" },
};

export interface InboundSource {
  id: string;
  connector: Connector;
  botId: string;
  botName: string;
  eventName: string;
  intervalMinutes: number;
  enabled: boolean;
  lastPollAt: string | null;
  lastNewCount: number;
  consecutiveFailures: number;
  disabledReason: string | null;
}

export interface InboundDeps {
  db: DatabaseSync;
  audit: AuditLog;
  now: () => number;
  /** Reads through the approval gate, as the named bot. */
  read(botId: string, connector: string, action: string, args: Record<string, unknown>): Promise<ActionOutcome>;
  readEnabled(botId: string, connector: string): boolean;
  botName(botId: string): string;
  botArchived(botId: string): boolean;
  fireEvent(name: string, text: string): unknown;
  paused(): string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** The lines of a read result, each with a stable key (Gmail: its message id; otherwise a fingerprint of the line). */
export function parseItems(connector: Connector, text: string): { key: string; line: string }[] {
  const items: { key: string; line: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line === PRESETS[connector].empty) continue;
    const id = connector === "gmail" ? /^\[([A-Za-z0-9]+)\]/.exec(line)?.[1] : undefined;
    items.push({ key: id ? `gmail:${id}` : sha(line), line });
  }
  return items;
}

export class InboundService {
  private polling = false;

  constructor(private readonly d: InboundDeps) {}

  private toSource(r: Record<string, unknown>): InboundSource {
    let botName = "(unknown)";
    try {
      botName = this.d.botName(String(r["bot_id"]));
    } catch {
      /* keep placeholder */
    }
    return {
      id: String(r["id"]),
      connector: String(r["connector"]) as Connector,
      botId: String(r["bot_id"]),
      botName,
      eventName: String(r["event_name"]),
      intervalMinutes: Number(r["interval_minutes"]),
      enabled: Number(r["enabled"]) === 1,
      lastPollAt: r["last_poll_ms"] === null ? null : new Date(Number(r["last_poll_ms"])).toISOString(),
      lastNewCount: Number(r["last_new_count"]),
      consecutiveFailures: Number(r["consecutive_failures"]),
      disabledReason: r["disabled_reason"] === null ? null : String(r["disabled_reason"]),
    };
  }

  list(): InboundSource[] {
    return this.d.db.prepare("SELECT * FROM inbound_sources ORDER BY created_at").all().map((r) => this.toSource(r));
  }

  private row(id: string): Record<string, unknown> {
    const r = this.d.db.prepare("SELECT * FROM inbound_sources WHERE id = ?").get(id);
    if (!r) throw new AppError(404, "inbound_not_found", "That message source does not exist.");
    return r;
  }

  create(input: { connector: Connector; botId: string; eventName?: string | undefined; intervalMinutes?: number | undefined }): InboundSource {
    if (!PRESETS[input.connector]) throw new AppError(400, "bad_connector", "Only Telegram and Gmail can be watched.");
    const count = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM inbound_sources").get() as { n: number }).n);
    if (count >= INBOUND_LIMITS.maxSources) throw new AppError(409, "too_many_sources", `At most ${INBOUND_LIMITS.maxSources} message sources.`);
    this.d.botName(input.botId); // throws if the bot does not exist
    const interval = this.interval(input.intervalMinutes ?? 60);
    const id = randomUUID();
    try {
      this.d.db
        .prepare("INSERT INTO inbound_sources (id, connector, bot_id, event_name, interval_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, input.connector, input.botId, (input.eventName ?? PRESETS[input.connector].defaultEvent).toLowerCase(), interval, new Date(this.d.now()).toISOString());
    } catch {
      throw new AppError(409, "duplicate_source", "That bot already has a source for this connector.");
    }
    this.d.audit.record("inbound.created", { id, connector: input.connector }, { actor: "owner", botId: input.botId });
    return this.toSource(this.row(id));
  }

  private interval(minutes: number): number {
    if (!Number.isInteger(minutes) || minutes < INBOUND_LIMITS.minIntervalMinutes || minutes > 1440) {
      throw new AppError(400, "bad_interval", `Check every ${INBOUND_LIMITS.minIntervalMinutes} to 1440 minutes.`);
    }
    return minutes;
  }

  update(id: string, patch: { enabled?: boolean | undefined; intervalMinutes?: number | undefined; eventName?: string | undefined }): InboundSource {
    const r = this.row(id);
    const connector = String(r["connector"]) as Connector;
    if (patch.intervalMinutes !== undefined) this.d.db.prepare("UPDATE inbound_sources SET interval_minutes = ? WHERE id = ?").run(this.interval(patch.intervalMinutes), id);
    if (patch.eventName !== undefined) this.d.db.prepare("UPDATE inbound_sources SET event_name = ? WHERE id = ?").run(patch.eventName.toLowerCase(), id);
    if (patch.enabled === true) {
      const botId = String(r["bot_id"]);
      if (this.d.botArchived(botId)) throw new AppError(409, "bot_archived", "That bot is archived.");
      if (!this.d.readEnabled(botId, connector)) {
        throw new AppError(409, "read_not_allowed", `Switch on ${PRESETS[connector].label} reading on this bot's Permissions tab first. Reading is what allows messages to be checked.`);
      }
      // Starting fresh: forget what was seen so the next check only notes what is there now (no old messages become events).
      this.d.db.prepare("DELETE FROM inbound_seen WHERE source_id = ?").run(id);
      this.d.db.prepare("UPDATE inbound_sources SET enabled = 1, last_poll_ms = NULL, consecutive_failures = 0, disabled_reason = NULL WHERE id = ?").run(id);
      this.d.audit.record("inbound.enabled", { id, connector }, { actor: "owner", botId });
    } else if (patch.enabled === false) {
      this.d.db.prepare("UPDATE inbound_sources SET enabled = 0, disabled_reason = NULL WHERE id = ?").run(id);
      this.d.audit.record("inbound.disabled", { id, connector }, { actor: "owner" });
    }
    return this.toSource(this.row(id));
  }

  remove(id: string): void {
    this.row(id);
    this.d.db.prepare("DELETE FROM inbound_sources WHERE id = ?").run(id);
    this.d.audit.record("inbound.removed", { id }, { actor: "owner" });
  }

  private switchOff(id: string, botId: string, reason: string): void {
    this.d.db.prepare("UPDATE inbound_sources SET enabled = 0, disabled_reason = ? WHERE id = ?").run(reason, id);
    this.d.audit.record("inbound.auto_disabled", { id, reason }, { botId });
  }

  /** Checks every source that is due. Returns how many events were created. Never throws. */
  async tick(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    let emitted = 0;
    try {
      const nowMs = this.d.now();
      const rows = this.d.db.prepare("SELECT * FROM inbound_sources WHERE enabled = 1").all();
      for (const r of rows) {
        const id = String(r["id"]);
        const last = r["last_poll_ms"] === null ? null : Number(r["last_poll_ms"]);
        if (last !== null && nowMs - last < Number(r["interval_minutes"]) * 60_000) continue;
        const pause = this.d.paused();
        if (pause) continue; // nothing is checked while paused; it simply waits
        emitted += await this.poll(r, nowMs, last === null);
      }
    } catch {
      /* a failure here must never crash the app */
    } finally {
      this.polling = false;
    }
    return emitted;
  }

  private async poll(r: Record<string, unknown>, nowMs: number, baseline: boolean): Promise<number> {
    const id = String(r["id"]);
    const botId = String(r["bot_id"]);
    const connector = String(r["connector"]) as Connector;
    const preset = PRESETS[connector];
    if (this.d.botArchived(botId)) {
      this.switchOff(id, botId, "The bot was archived.");
      return 0;
    }
    this.d.db.prepare("UPDATE inbound_sources SET last_poll_ms = ? WHERE id = ?").run(nowMs, id);

    let outcome: ActionOutcome;
    try {
      outcome = await this.d.read(botId, connector, preset.action, preset.args);
    } catch {
      outcome = { status: "failed", reason: "The check failed." } as ActionOutcome;
    }
    if (outcome.status !== "done") {
      const reason = "reason" in outcome ? String((outcome as { reason: string }).reason) : "The check did not run.";
      const failures = Number(r["consecutive_failures"]) + 1;
      // Not allowed to read any more (permission removed, connector not ready, bot gone): switch off straight away.
      const hard = /not switched on|not set up|does not exist|archived/i.test(reason);
      this.d.db.prepare("UPDATE inbound_sources SET consecutive_failures = ? WHERE id = ?").run(failures, id);
      if (hard || failures >= INBOUND_LIMITS.maxFailures) this.switchOff(id, botId, clip(reason, 200));
      this.d.audit.record("inbound.failed", { id, connector, reason: clip(reason, 200) }, { botId });
      return 0;
    }

    const items = parseItems(connector, outcome.text);
    const seen = new Set(this.d.db.prepare("SELECT item_key FROM inbound_seen WHERE source_id = ?").all(id).map((x) => String(x["item_key"])));
    const fresh = items.filter((i) => !seen.has(i.key));
    const mark = this.d.db.prepare("INSERT OR IGNORE INTO inbound_seen (source_id, item_key, seen_ms) VALUES (?, ?, ?)");
    for (const i of fresh) mark.run(id, i.key, nowMs);
    this.d.db
      .prepare("DELETE FROM inbound_seen WHERE source_id = ? AND item_key NOT IN (SELECT item_key FROM inbound_seen WHERE source_id = ? ORDER BY seen_ms DESC, rowid DESC LIMIT ?)")
      .run(id, id, INBOUND_LIMITS.keepSeen);

    // The first check only learns what is already there.
    const toEmit = baseline ? [] : fresh.slice(0, INBOUND_LIMITS.maxEventsPerPoll);
    for (const i of toEmit) {
      try {
        this.d.fireEvent(String(r["event_name"]), clip(i.line, INBOUND_LIMITS.maxEventChars));
      } catch {
        /* an event the automation refused is already in its own log */
      }
    }
    this.d.db.prepare("UPDATE inbound_sources SET consecutive_failures = 0, last_new_count = ? WHERE id = ?").run(toEmit.length, id);
    this.d.audit.record("inbound.polled", { id, connector, found: items.length, new: fresh.length, events: toEmit.length, baseline, dropped: baseline ? 0 : Math.max(0, fresh.length - toEmit.length) }, { botId });
    return toEmit.length;
  }
}
