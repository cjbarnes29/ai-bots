import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../errors.js";
import type { DecisionService } from "./service.js";

/**
 * Collaboration on top of the Decisions records that already exist (no new tables):
 *  - versions of an option's text, derived from the append-only decision_revisions the database writes itself (the original, then each owner edit);
 *  - the execution record: what each bot was ACTUALLY told (the stored task instruction), and what came back;
 *  - the consensus check: computed ONLY from the views the bots really gave; nothing here is a bot view and nothing here decides;
 *  - collaborate(): the Manager's loop (review, evaluate, at most the two rounds the database allows, then escalate to the owner).
 * The owner alone chooses, approves and rejects (DecisionService). The consensus check can recommend; it cannot choose.
 */

type Row = Record<string, unknown>;
const FIELDS = ["title", "details", "pros", "cons"] as const;
type Field = (typeof FIELDS)[number];
type Text = Record<Field, string>;

export interface OptionVersion {
  version: number;
  at: string;
  by: "owner" | "bot";
  botName: string | null;
  text: Text;
  changes: { field: Field; before: string; after: string }[];
  /** sha256 of the text. An approval names this hash, so it is clear exactly which wording was approved. */
  hash: string;
}

export interface Consensus {
  state: "consensus" | "unresolved" | "insufficient";
  /** The option all participating bots stand behind (only when state is "consensus"). */
  optionId: string | null;
  optionTitle: string | null;
  supporters: string[];
  objectors: { bot: string; stance: string; reasoning: string; optionId: string }[];
  /** Participants who gave no view and proposed nothing: nobody is assumed to agree. */
  missing: string[];
  roundsDone: number;
  /** The rules-based summary the Manager shows the owner. It is NOT a bot's view and NOT a decision. */
  recommendation: { optionId: string; title: string; reason: string } | null;
  note: string;
}

const hashOf = (t: Text) => createHash("sha256").update(JSON.stringify([t.title, t.details, t.pros, t.cons])).digest("hex");

export class DecisionInsights {
  constructor(
    private readonly db: DatabaseSync,
    private readonly decisions: DecisionService,
    private readonly now: () => number = Date.now,
  ) {}
  private all(sql: string, ...a: (string | number | null)[]): Row[] {
    return this.db.prepare(sql).all(...a) as Row[];
  }
  private one(sql: string, ...a: (string | number | null)[]): Row | undefined {
    return this.db.prepare(sql).get(...a) as Row | undefined;
  }
  private botName(id: string | null): string | null {
    return id ? String(this.one("SELECT name FROM bots WHERE id = ?", id)?.["name"] ?? "?") : null;
  }

  // ---------------------------------------------------------------- versions
  /** The original wording first, then one entry per owner edit, each with the exact changes. Built from the history the database keeps; nothing is stored twice. */
  optionVersions(decisionId: string, optionId: string): OptionVersion[] {
    this.decisions.get(decisionId); // 404 for an unknown decision
    const rows = this.all(
      "SELECT * FROM decision_revisions WHERE decision_id = ? AND action IN ('option_added', 'option_edited') AND json_extract(detail, '$.option') = ? ORDER BY id",
      decisionId,
      optionId,
    );
    const out: OptionVersion[] = [];
    for (const r of rows) {
      const d = JSON.parse(String(r["detail"])) as Record<string, unknown>;
      const textOf = (src: Record<string, unknown>): Text => ({ title: String(src["title"] ?? ""), details: String(src["details"] ?? ""), pros: String(src["pros"] ?? ""), cons: String(src["cons"] ?? "") });
      if (String(r["action"]) === "option_added") {
        const text = textOf(d);
        out.push({ version: 1, at: String(r["created_at"]), by: String(r["actor"]) === "bot" ? "bot" : "owner", botName: this.botName(r["bot_id"] === null ? null : String(r["bot_id"])), text, changes: [], hash: hashOf(text) });
      } else {
        const before = textOf(d["before"] as Record<string, unknown>);
        const after = textOf(d["after"] as Record<string, unknown>);
        out.push({
          version: out.length + 1,
          at: String(r["created_at"]),
          by: "owner",
          botName: null,
          text: after,
          changes: FIELDS.filter((f) => before[f] !== after[f]).map((f) => ({ field: f, before: before[f], after: after[f] })),
          hash: hashOf(after),
        });
      }
    }
    return out;
  }

  /** Which version the owner approved: the last one that existed when the decision was approved. An approved decision's options can no longer change. */
  approvedVersion(decisionId: string): { optionId: string; version: number; hash: string; approvedAt: string } | null {
    const d = this.decisions.get(decisionId);
    if (!d.approvedAt || !d.chosenOptionId) return null;
    const versions = this.optionVersions(decisionId, d.chosenOptionId).filter((v) => v.at <= d.approvedAt!);
    const last = versions.at(-1);
    return last ? { optionId: d.chosenOptionId, version: last.version, hash: last.hash, approvedAt: d.approvedAt } : null;
  }

  // ---------------------------------------------------------------- execution record
  /** What each assigned bot was really told (the task instruction as stored), whether it matches the approved wording, and the recorded result. */
  executionRecord(decisionId: string) {
    const d = this.decisions.get(decisionId);
    const approved = this.approvedVersion(decisionId);
    const chosen = d.options.find((o) => o.id === d.chosenOptionId);
    return d.assignments.map((a) => {
      const t = a.taskId ? this.one("SELECT instruction, status, result, error_message, finished_at FROM tasks WHERE id = ?", a.taskId) : undefined;
      const instruction = t ? String(t["instruction"]) : null;
      return {
        botId: a.botId,
        botName: a.botName,
        duty: a.duty,
        startState: a.startState,
        taskId: a.taskId,
        /** The words the bot received. Empty until the task has been started. */
        instructionSent: instruction,
        /** True when the bot received the approved wording of the chosen option (title and details), not an older or newer text. */
        matchesApprovedVersion: instruction !== null && !!chosen && !!approved && instruction.includes(chosen.title) && (chosen.details === "" || instruction.includes(chosen.details.slice(0, 200))),
        approvedVersion: approved?.version ?? null,
        approvedHash: approved?.hash ?? null,
        status: t ? String(t["status"]) : null,
        result: t && t["result"] !== null ? String(t["result"]) : null,
        error: t && t["error_message"] !== null ? String(t["error_message"]) : null,
        finishedAt: t && t["finished_at"] !== null ? String(t["finished_at"]) : null,
      };
    });
  }

  // ---------------------------------------------------------------- consensus
  /**
   * Evaluates agreement from the recorded views alone.
   *  - A bot's position on an option is its newest view of it; a bot that proposed an option stands behind it unless its own newer view says otherwise.
   *  - "alternative" counts against the viewed option and for the preferred one.
   *  - Consensus needs at least two bots, every participant to have a position somewhere, and nobody against the option. Otherwise it is "unresolved".
   *  - Silence is never agreement: a participant with no view and no proposal is listed as missing and blocks consensus.
   */
  evaluate(decisionId: string): Consensus {
    const d = this.decisions.get(decisionId);
    const participants = d.participants.map((p) => ({ id: p.botId, name: p.botName }));
    const roundsDone = Number(this.one("SELECT COALESCE(MAX(round), 0) AS r FROM decision_views WHERE decision_id = ?", decisionId)!["r"]);
    const optionIds = d.options.map((o) => o.id);
    // stance[bot][option] = +1 / -1 (+ the reason), from the newest view or the proposal
    const stance = new Map<string, Map<string, { v: 1 | -1; stance: string; reasoning: string }>>();
    const set = (bot: string, opt: string, v: 1 | -1, s: string, reasoning: string) => {
      if (!stance.has(bot)) stance.set(bot, new Map());
      stance.get(bot)!.set(opt, { v, stance: s, reasoning });
    };
    for (const o of d.options) if (o.proposedBy) set(o.proposedBy.botId, o.id, 1, "proposed", "Proposed this option.");
    const views = this.all("SELECT * FROM decision_views WHERE decision_id = ? ORDER BY round, id", decisionId);
    for (const v of views) {
      const bot = String(v["bot_id"]);
      const opt = String(v["option_id"]);
      const s = String(v["stance"]);
      const reasoning = String(v["reasoning"]);
      if (s === "support") set(bot, opt, 1, s, reasoning);
      else if (s === "alternative") {
        set(bot, opt, -1, s, reasoning);
        if (v["alternative_option_id"] !== null) set(bot, String(v["alternative_option_id"]), 1, "preferred", reasoning);
      } else set(bot, opt, -1, s, reasoning);
    }
    const missing = participants.filter((p) => !stance.has(p.id)).map((p) => p.name);
    const tally = optionIds.map((optionId) => {
      let plus = 0;
      let minus = 0;
      const objectors: Consensus["objectors"] = [];
      const supporters: string[] = [];
      for (const p of participants) {
        const s = stance.get(p.id)?.get(optionId);
        if (!s) continue;
        if (s.v === 1) (plus++, supporters.push(p.name));
        else (minus++, objectors.push({ bot: p.name, stance: s.stance, reasoning: s.reasoning, optionId }));
      }
      return { optionId, plus, minus, objectors, supporters, title: d.options.find((o) => o.id === optionId)!.title };
    });
    const best = [...tally].sort((a, b) => b.plus - b.minus - (a.plus - a.minus) || b.plus - a.plus)[0];
    const recommendation = best && best.plus > 0 ? { optionId: best.optionId, title: best.title, reason: `${best.plus} bot(s) back it${best.minus ? ` and ${best.minus} object` : ""}. This is a rules-based count of the recorded views, not a bot's opinion and not a decision.` } : null;
    const base = { roundsDone, missing, recommendation };
    if (participants.length < 2) return { ...base, state: "insufficient", optionId: null, optionTitle: null, supporters: [], objectors: [], note: "Fewer than two bots took part, so there is nothing to agree on. The owner decides." };
    const agreed = tally.find((t) => t.minus === 0 && t.plus >= 2 && missing.length === 0);
    if (agreed) return { ...base, state: "consensus", optionId: agreed.optionId, optionTitle: agreed.title, supporters: agreed.supporters, objectors: [], note: `All ${participants.length} participating bots stand behind "${agreed.title}". This is recorded; the owner still chooses and approves.` };
    const objectors = tally.flatMap((t) => t.objectors);
    const why = missing.length ? `${missing.join(", ")} gave no view, and silence is not agreement. ` : "";
    return { ...base, state: "unresolved", optionId: null, optionTitle: null, supporters: best?.supporters ?? [], objectors, note: `${why}${objectors.length ? `${objectors.length} objection(s) remain unanswered.` : "No single option has everyone's support."} The owner decides.` };
  }

  /** Writes the outcome into the decision's permanent history (once per distinct outcome), so the record shows how it was reached. */
  record(decisionId: string): Consensus {
    const c = this.evaluate(decisionId);
    const kind = c.state === "consensus" ? "consensus" : "escalated_to_owner";
    const last = this.one("SELECT detail FROM decision_revisions WHERE decision_id = ? AND action = 'note' AND (json_extract(detail, '$.collaboration') IS NOT NULL) ORDER BY id DESC LIMIT 1", decisionId);
    const sig = JSON.stringify([kind, c.optionId, c.roundsDone, c.objectors.length, c.missing.length]);
    if (last && (JSON.parse(String(last["detail"])) as { sig?: string }).sig === sig) return c;
    this.db
      .prepare("INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at) VALUES (?, 'system', 'note', ?, ?)")
      .run(decisionId, JSON.stringify({ collaboration: kind, sig, state: c.state, option: c.optionId, rounds: c.roundsDone, supporters: c.supporters, objections: c.objectors.length, missing: c.missing, note: c.note }), new Date(this.now()).toISOString());
    return c;
  }

  /** The latest recorded collaboration outcome ("consensus" or "escalated_to_owner"), if any. */
  lastOutcome(decisionId: string): { kind: string; note: string; at: string } | null {
    const r = this.one("SELECT detail, created_at FROM decision_revisions WHERE decision_id = ? AND action = 'note' AND json_extract(detail, '$.collaboration') IS NOT NULL ORDER BY id DESC LIMIT 1", decisionId);
    if (!r) return null;
    const d = JSON.parse(String(r["detail"])) as { collaboration: string; note: string };
    return { kind: d.collaboration, note: d.note, at: String(r["created_at"]) };
  }

  // ---------------------------------------------------------------- the Manager's loop
  /**
   * Collaborate first, escalate what stays unresolved. Runs the review rounds the decision still has (at most two in total, by database rule), checks for
   * consensus after each, stops as soon as there is agreement, and otherwise records that the disagreement goes to the owner. It never chooses or approves.
   * Each round is one model call per bot (the usual free-only limits and pause switches apply), and the owner starts this; it never runs by itself.
   */
  async collaborate(decisionId: string): Promise<{ rounds: number; consensus: Consensus; outcome: "consensus" | "escalated_to_owner" }> {
    const d = this.decisions.get(decisionId);
    if (d.status !== "open" && d.status !== "chosen") throw new AppError(409, "wrong_state", `This decision is ${d.status}; discussion is closed.`);
    let ran = 0;
    let c = this.evaluate(decisionId);
    // c.roundsDone already counts the rounds run here; the second condition also stops a round that produced no usable view from looping
    while (c.state !== "consensus" && c.roundsDone < 2 && ran < 2) {
      await this.decisions.reviewRound(decisionId);
      ran++;
      c = this.evaluate(decisionId);
    }
    const recorded = this.record(decisionId);
    return { rounds: ran, consensus: recorded, outcome: recorded.state === "consensus" ? "consensus" : "escalated_to_owner" };
  }
}
