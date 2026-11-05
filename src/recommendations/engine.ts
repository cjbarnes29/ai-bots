import { randomUUID } from "node:crypto";

/**
 * The shared Recommended Settings engine.
 *
 * A feature registers a RecDef (what the setting is, how to read and write it, and how to judge what is recommended RIGHT NOW from the real
 * environment). The engine does everything else the same way for every feature: compares current and recommended, decides the label, refuses
 * to recommend what is unavailable, applies one setting at a time, records every change with its previous value, and restores it.
 *
 * Rules the engine enforces (not left to each feature):
 *  - Nothing is ever applied by itself: only apply() writes, and only for ids the caller names.
 *  - A recommendation that cannot be made (provider not connected, nothing verified) has recommended === null and can never be applied.
 *  - A paid setting can never be applied here (it needs its own explicit authorization elsewhere).
 *  - Applying changes only that one setting; the new value is read back and checked.
 *  - Restoring refuses if the value was changed again since, so it can never undo something the owner did later.
 */
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);

export type Status = "recommended" | "current" | "custom" | "not_configured" | "requires_connection" | "requires_attention";
export const STATUS_LABEL: Record<Status, string> = {
  recommended: "Recommended",
  current: "Current",
  custom: "Custom",
  not_configured: "Not configured",
  requires_connection: "Requires connection",
  requires_attention: "Requires attention",
};

export interface Evaluation<V> {
  /** Why a recommendation cannot be made, when it cannot (no recommendation). */
  unavailable?: { state: "requires_connection" | "not_configured"; note: string };
  /** The value to recommend. ABSENT (not null: null can be a real value) when nothing verified can be recommended. */
  recommended?: V;
  /** Set when the CURRENT configuration is a problem (wrong, incompatible, wasteful). */
  attention?: string;
  why: string;
  benefits: string[];
  tradeoffs: string[];
  /** What was checked about this PC and the connected services. Only checked facts belong here. */
  compatibility: string[];
}

export interface RecDef<V = unknown> {
  id: string;
  /** Group shown in the assistant: "AI models", "Model routing", "Usage limits", "Desktop", "Security", "Integrations"... */
  area: string;
  title: string;
  /** The lowest mode that shows it (beginner shows only "beginner"; intermediate adds "intermediate"; advanced shows all). */
  level: Level;
  kind: "setting" | "advice";
  /** What an untouched install holds. Used to tell "Current" (still the default) from "Custom" (the owner changed it). */
  defaultValue: V;
  cost: "free" | "paid";
  /** Where the owner changes it by hand. */
  customizeAt: string;
  read(): V;
  evaluate(): Evaluation<V>;
  /** Absent for advice. */
  write?(value: V): void;
  format?(value: V): string;
  /** Compare two values (default: JSON equality). Use for sets where order does not matter. */
  equals?(a: V, b: V): boolean;
}

export interface Item {
  id: string;
  area: string;
  title: string;
  level: Level;
  kind: "setting" | "advice";
  status: Status;
  label: string;
  current: string;
  recommended: string | null;
  why: string;
  benefits: string[];
  tradeoffs: string[];
  compatibility: string[];
  /** Plain explanation of a problem or of why nothing can be recommended. */
  note: string | null;
  canApply: boolean;
  cost: "free" | "paid";
  customizeAt: string;
  /** The latest recorded change to this setting that can still be undone. */
  lastChange: { historyId: string; at: string } | null;
}

export interface HistoryEntry {
  id: string;
  at: string;
  recId: string;
  title: string;
  before: unknown;
  after: unknown;
  beforeText: string;
  afterText: string;
  restoredAt: string | null;
}

export interface ApplyResult {
  id: string;
  title: string;
  result: "applied" | "unchanged" | "refused";
  reason?: string;
  before?: string;
  after?: string;
  historyId?: string;
}

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const HISTORY_KEY = "recommendations.history";
const MODE_KEY = "recommendations.mode";
const HISTORY_MAX = 100;

const defaultFormat = (v: unknown): string => (v === null || v === undefined ? "none" : typeof v === "string" ? v : JSON.stringify(v));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class RecommendationEngine {
  private readonly defs = new Map<string, RecDef<never>>();

  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  /** Future features call this to add their own recommendations. The id must be unique. */
  register<V>(def: RecDef<V>): void {
    if (this.defs.has(def.id)) throw new Error(`Recommendation "${def.id}" is already registered.`);
    this.defs.set(def.id, def as unknown as RecDef<never>);
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }

  // ---------------------------------------------------------------- mode
  mode(): Level {
    const v = this.store.get(MODE_KEY);
    return isLevel(v) ? v : "intermediate";
  }

  /** Only changes which recommendations and details are shown. It never touches any configuration. */
  setMode(mode: Level): Level {
    this.store.set(MODE_KEY, mode);
    return mode;
  }

  // ---------------------------------------------------------------- history
  history(): HistoryEntry[] {
    try {
      const v = JSON.parse(this.store.get(HISTORY_KEY) ?? "[]") as unknown;
      return Array.isArray(v) ? (v as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private saveHistory(list: HistoryEntry[]): void {
    this.store.set(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)));
  }

  // ---------------------------------------------------------------- evaluation
  private fmt<V>(def: RecDef<V>, v: V): string {
    return def.format ? def.format(v) : defaultFormat(v);
  }
  private eq<V>(def: RecDef<V>, a: V, b: V): boolean {
    return def.equals ? def.equals(a, b) : sameJson(a, b);
  }

  private itemOf(def: RecDef<never>, history: HistoryEntry[]): Item {
    const d = def as unknown as RecDef<unknown>;
    let current: unknown;
    let ev: Evaluation<unknown>;
    try {
      current = d.read();
      ev = d.evaluate();
    } catch {
      // A broken check must never break the page or invent a recommendation.
      return this.base(d, "requires_attention", "unknown", null, "This could not be checked right now.", history);
    }
    const currentText = this.fmt(d, current);
    const base = { why: ev.why, benefits: ev.benefits, tradeoffs: ev.tradeoffs, compatibility: ev.compatibility };
    if (!("recommended" in ev)) {
      const u = ev.unavailable ?? { state: "not_configured" as const, note: "Nothing can be recommended yet." };
      return { ...this.base(d, u.state, currentText, null, u.note, history), ...base };
    }
    const recommendedText = this.fmt(d, ev.recommended as unknown);
    const same = this.eq(d, current, ev.recommended as unknown);
    let status: Status;
    if (d.kind === "advice") status = ev.attention ? "requires_attention" : "current";
    else if (same) status = "recommended";
    else if (ev.attention) status = "requires_attention";
    else if (this.eq(d, current, d.defaultValue)) status = "current";
    else status = "custom";
    const applicable = d.kind === "setting" && !!d.write && d.cost === "free" && !same;
    return { ...this.base(d, status, currentText, recommendedText, ev.attention ?? null, history), ...base, canApply: applicable };
  }

  private base(d: RecDef<unknown>, status: Status, current: string, recommended: string | null, note: string | null, history: HistoryEntry[]): Item {
    const last = [...history].reverse().find((h) => h.recId === d.id && h.restoredAt === null);
    return {
      id: d.id,
      area: d.area,
      title: d.title,
      level: d.level,
      kind: d.kind,
      status,
      label: STATUS_LABEL[status],
      current,
      recommended,
      why: "",
      benefits: [],
      tradeoffs: [],
      compatibility: [],
      note,
      canApply: false,
      cost: d.cost,
      customizeAt: d.customizeAt,
      lastChange: last ? { historyId: last.id, at: last.at } : null,
    };
  }

  /** What to show for a mode. `hidden` counts what a higher mode would add. */
  list(mode: Level = this.mode()): { items: Item[]; hidden: number } {
    const history = this.history();
    const rank = LEVELS.indexOf(mode);
    const all = [...this.defs.values()].map((d) => this.itemOf(d, history));
    const items = all.filter((i) => LEVELS.indexOf(i.level) <= rank);
    return { items, hidden: all.length - items.length };
  }

  get(id: string): Item | undefined {
    const def = this.defs.get(id);
    return def ? this.itemOf(def, this.history()) : undefined;
  }

  // ---------------------------------------------------------------- applying
  /** Applies exactly the named recommendations, one at a time. Anything not named is not touched. */
  apply(ids: string[]): ApplyResult[] {
    const out: ApplyResult[] = [];
    for (const id of [...new Set(ids)]) {
      const def = this.defs.get(id) as unknown as RecDef<unknown> | undefined;
      if (!def) {
        out.push({ id, title: id, result: "refused", reason: "There is no such recommendation." });
        continue;
      }
      out.push(this.applyOne(def));
    }
    return out;
  }

  private applyOne(def: RecDef<unknown>): ApplyResult {
    const refuse = (reason: string): ApplyResult => ({ id: def.id, title: def.title, result: "refused", reason });
    if (def.cost === "paid") return refuse("This setting could cost money. It is never applied automatically; it needs your own explicit authorization.");
    if (def.kind !== "setting" || !def.write) return refuse("This is advice only; there is nothing to apply.");
    let ev: Evaluation<unknown>;
    let before: unknown;
    try {
      before = def.read();
      ev = def.evaluate();
    } catch {
      return refuse("It could not be checked right now, so nothing was changed.");
    }
    if (!("recommended" in ev)) return refuse(ev.unavailable?.note ?? "Nothing verified can be recommended yet, so nothing was changed.");
    if (this.eq(def, before, ev.recommended as unknown)) return { id: def.id, title: def.title, result: "unchanged", before: this.fmt(def, before), after: this.fmt(def, before) };
    try {
      def.write(ev.recommended as unknown);
    } catch (e) {
      return refuse(`The setting could not be changed: ${e instanceof Error ? e.message : "unknown problem"}.`);
    }
    const after = def.read();
    if (!this.eq(def, after, ev.recommended as unknown)) {
      // Put it back rather than leave something half-applied.
      try {
        def.write?.(before);
      } catch {
        /* nothing more can be done */
      }
      return refuse("The change did not take effect, so it was undone.");
    }
    const entry: HistoryEntry = {
      id: randomUUID(),
      at: new Date(this.now()).toISOString(),
      recId: def.id,
      title: def.title,
      before,
      after,
      beforeText: this.fmt(def, before),
      afterText: this.fmt(def, after),
      restoredAt: null,
    };
    this.saveHistory([...this.history(), entry]);
    return { id: def.id, title: def.title, result: "applied", before: entry.beforeText, after: entry.afterText, historyId: entry.id };
  }

  // ---------------------------------------------------------------- restoring
  restore(historyId: string): ApplyResult {
    const list = this.history();
    const entry = list.find((h) => h.id === historyId);
    const def = entry ? (this.defs.get(entry.recId) as unknown as RecDef<unknown> | undefined) : undefined;
    const refuse = (title: string, reason: string): ApplyResult => ({ id: entry?.recId ?? historyId, title, result: "refused", reason });
    if (!entry || !def || !def.write) return refuse(entry?.title ?? "Unknown change", "That change is not in the history.");
    if (entry.restoredAt !== null) return refuse(entry.title, "That change was already restored.");
    const nowValue = def.read();
    if (!this.eq(def, nowValue, entry.after)) return refuse(entry.title, "This setting was changed again after the recommendation was applied, so it was left alone.");
    def.write(entry.before);
    const back = def.read();
    if (!this.eq(def, back, entry.before)) {
      try {
        def.write(entry.after);
      } catch {
        /* nothing more can be done */
      }
      return refuse(entry.title, "The previous value could not be put back, so nothing was changed.");
    }
    this.saveHistory(list.map((h) => (h.id === entry.id ? { ...h, restoredAt: new Date(this.now()).toISOString() } : h)));
    return { id: def.id, title: def.title, result: "applied", before: entry.afterText, after: entry.beforeText, historyId: entry.id };
  }
}
