/**
 * Numerical checks for the shared project workspace. Pure functions over the entries; nothing here changes an entry, a value or a source.
 * The warnings are computed each time the workspace is read (dashboard, agent context, task results), so they always reflect the current entries.
 *
 * What is flagged (plain, explainable rules; the platform cannot know real-world prices, so it never says a number is right or wrong):
 *  - unsupported: an amount in an entry without a checkable source ("general knowledge", "estimate", none at all);
 *  - large: an unsupported amount of 100,000 or more (a big number nobody can trace);
 *  - wide range: a range whose top is at least twice its bottom;
 *  - arithmetic: a written sum or product ("a + b = c", "a x b = c") that does not add up (more than 1% off);
 *  - derived: an entry that cites an unverified entry (W-...) or reuses one of its amounts, so repeating a number never makes it verified;
 *  - conflict: two live entries about the same specific subject (rent, licence, salary, wage, revenue, price) whose amounts differ three times or more.
 * An entry the owner marked as checked is not flagged as unsupported, and numbers taken from it are not "unverified".
 */
export interface Amount {
  raw: string;
  value: number;
  /** The top of a range, when the text gives one ("750,000-1,250,000"). */
  hi: number | null;
  currency: string | null;
}
export interface CheckableEntry {
  id: string;
  ref: string;
  kind: string;
  title: string;
  text: string;
  source: string | null;
  checkedByOwner: boolean;
  withdrawn: boolean;
  replacedBy: string | null;
  createdAt: string;
  /** The task that saved it: entries of the SAME task are not "derived" from each other (that is not propagation between agents). */
  taskId?: string | null;
}

const CURRENCY = "(AED|USD|EUR|GBP|INR|SAR|Dh|Dhs|\\$|€|£)";
const NUM = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)";
const MULT = "(k|m|bn|million|thousand|billion)?";
const DASH = "\\s*(?:-|–|—|to)\\s*";
const AMOUNT_RE = new RegExp(`${CURRENCY}?\\s?${NUM}\\s?${MULT}\\b(?:${DASH}${CURRENCY}?\\s?${NUM}\\s?${MULT}\\b)?\\s*(%)?`, "gi");
const GENERIC_SOURCE = /general knowledge|own knowledge|my knowledge|estimate|assum|no (?:live|checkable|verified) source|unverified|guess|typical|rough/i;
// Specific subjects only: generic words like "cost" or "budget" would compare unrelated things (a total with one of its parts).
const TOPICS = ["rent", "licen", "salary", "wage", "revenue", "price"];

const mult = (m: string | undefined): number => {
  const k = (m ?? "").toLowerCase();
  return k === "k" || k === "thousand" ? 1e3 : k === "m" || k === "million" ? 1e6 : k === "bn" || k === "billion" ? 1e9 : 1;
};
const num = (s: string, m?: string): number => Number(s.replace(/,/g, "")) * mult(m);
export const fmt = (n: number): string => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 100) / 100));

/** Amounts in a text: money (a currency next to it) or plain numbers of 1,000 or more. Years, percentages and small counts are left out. */
export function amountsIn(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.normalize("NFKC").matchAll(AMOUNT_RE)) {
    if (m[7]) continue; // a percentage
    const currency = m[1] ?? m[4] ?? null;
    const value = num(m[2]!, m[3]);
    const hi = m[5] ? num(m[5], m[6] ?? m[3]) : null;
    const plainYear = !currency && !m[3] && !hi && /^\d{4}$/.test(m[2]!) && value >= 1900 && value <= 2100;
    if (plainYear) continue;
    if (!currency && Math.max(value, hi ?? 0) < 1000) continue;
    out.push({ raw: m[0].trim(), value, hi: hi !== null && hi > value ? hi : null, currency: currency ? currency.toUpperCase().replace(/^DHS?$/, "AED") : null });
  }
  return out;
}

const values = (a: Amount[]): number[] => a.flatMap((x) => (x.hi ? [x.value, x.hi] : [x.value]));
const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
/** Same value AND a compatible unit (P-44 run 7: "15,000 people a day" was taken for "AED 15,000"). */
const sameAmount = (x: Amount, y: Amount): boolean => (x.currency === null) === (y.currency === null) && (x.currency === null || x.currency === y.currency) && values([x]).some((v) => v >= 1000 && values([y]).some((w) => same(v, w)));

/** Written arithmetic that does not add up: "a + b (+ c...) = d" and "a x b = d" (x, ×, *). */
export function arithmeticProblems(text: string): string[] {
  const t = text.normalize("NFKC").replace(/(\d),(?=\d{3}\b)/g, "$1");
  // a term may be preceded by up to two short words ("rent AED 60,000 + licence AED 20,000 = AED 80,000")
  const n = "(?:[A-Za-z]{1,12}\\s+){0,2}(?:[A-Z]{3}\\s?|\\$)?(\\d+(?:\\.\\d+)?)\\s?(k|m)?";
  const out: string[] = [];
  for (const m of t.matchAll(new RegExp(`((?:${n}\\s*\\+\\s*)+${n})\\s*=\\s*${n}`, "gi"))) {
    const terms = [...m[1]!.matchAll(new RegExp(n, "gi"))].map((x) => num(x[1]!, x[2]));
    const total = num(m[m.length - 2]!, m[m.length - 1]);
    const sum = terms.reduce((a, b) => a + b, 0);
    if (terms.length >= 2 && Math.abs(sum - total) > Math.abs(total) * 0.01) out.push(`${terms.map(fmt).join(" + ")} is ${fmt(sum)}, not ${fmt(total)}`);
  }
  for (const m of t.matchAll(new RegExp(`${n}\\s*[x×*]\\s*${n}[^=\\n]{0,20}=\\s*${n}`, "gi"))) {
    const a = num(m[1]!, m[2]);
    const b = num(m[3]!, m[4]);
    const total = num(m[5]!, m[6]);
    if (Math.abs(a * b - total) > Math.abs(total) * 0.01) out.push(`${fmt(a)} x ${fmt(b)} is ${fmt(a * b)}, not ${fmt(total)}`);
  }
  return out;
}

const unsupported = (e: CheckableEntry): boolean => !e.checkedByOwner && (!e.source || GENERIC_SOURCE.test(e.source)) && amountsIn(e.text).length > 0;
/** Is this entry a source of UNVERIFIED numbers for later entries? Owner-checked entries never are. */
export const unverifiedSource = (e: CheckableEntry): boolean => !e.checkedByOwner && amountsIn(e.text).length > 0 && (e.kind === "assumption" || unsupported(e));

/** Warnings per entry id. Entries are expected newest first (as the workspace stores them); "derived" only looks at entries written earlier. */
export function numberWarnings(entries: CheckableEntry[]): Map<string, string[]> {
  const live = entries.filter((e) => !e.withdrawn && !e.replacedBy);
  const out = new Map<string, string[]>();
  for (const e of entries) {
    const w: string[] = [];
    const amounts = amountsIn(e.text);
    if (unsupported(e)) {
      const top = Math.max(...values(amounts));
      const cur = amounts.find((a) => a.currency)?.currency;
      w.push(top >= 100_000 ? `Large unsupported amount (${cur ? `${cur} ` : ""}${fmt(top)}): no checkable source; check it before relying on it` : "Unsupported estimate: numbers without a checkable source");
    }
    for (const a of amounts) if (a.hi && a.hi >= a.value * 2) w.push(`Wide range (${fmt(a.value)}-${fmt(a.hi)}): very uncertain`);
    for (const p of arithmeticProblems(e.text)) w.push(`Calculation does not add up: ${p}`);
    for (const p of entries) {
      if (p.id === e.id || p.createdAt > e.createdAt || !unverifiedSource(p)) continue;
      if (p.taskId && p.taskId === e.taskId) continue; // written together by one task: not propagation
      if (p.createdAt === e.createdAt && entries.indexOf(p) < entries.indexOf(e)) continue; // same instant: only the earlier-stored one counts as earlier
      const cites = e.text.includes(p.ref) || (e.source ?? "").includes(p.ref);
      const reuses = amounts.some((a) => amountsIn(p.text).some((b) => sameAmount(a, b)));
      if (cites || reuses) w.push(`Uses unverified numbers from ${p.ref} (${p.kind}${unsupported(p) ? ", unsupported" : ""})`);
    }
    if (!e.withdrawn && !e.replacedBy && amounts.length > 0) {
      const topic = TOPICS.find((k) => e.title.toLowerCase().includes(k));
      if (topic) {
        for (const o of live) {
          if (o.id === e.id || !o.title.toLowerCase().includes(topic)) continue;
          const oa = amountsIn(o.text);
          const cur = amounts[0]!.currency;
          const x = Math.max(...values(amounts.filter((a) => a.currency === cur)), 0);
          const y = Math.max(...values(oa.filter((a) => a.currency === cur)), 0);
          if (x > 0 && y > 0 && Math.max(x, y) >= Math.min(x, y) * 3) w.push(`Conflicts with ${o.ref} on "${topic}": ${fmt(x)} here, ${fmt(y)} there`);
        }
      }
    }
    if (w.length) out.set(e.id, [...new Set(w)]);
  }
  return out;
}

/**
 * Amounts in an agent's text that come from unverified workspace entries (same value as an amount of an assumption or an unsupported entry).
 * Used to make uncertainty visible in downstream results, in the platform's own words.
 */
export function unverifiedAmountsUsed(text: string, entries: CheckableEntry[]): { amount: string; ref: string }[] {
  // oldest first: a number is attributed to the entry it came from, not to a later entry that repeated it
  const sources = entries.filter((e) => !e.withdrawn && unverifiedSource(e)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const out: { amount: string; ref: string }[] = [];
  for (const a of amountsIn(text)) {
    for (const v of values([a])) {
      if (v < 1000) continue;
      const src = sources.find((s) => amountsIn(s.text).some((b) => (a.currency === null || b.currency === null || a.currency === b.currency) && values([b]).some((x) => same(v, x))));
      if (src && !out.some((o) => o.ref === src.ref && o.amount === fmt(v))) out.push({ amount: `${a.currency ? `${a.currency} ` : ""}${fmt(v)}`, ref: src.ref });
    }
  }
  return out.slice(0, 8);
}

/** A "fact" may not rest on a workspace assumption or on a generic source: repeating an estimate does not verify it. Returns the reason, or null. */
export function factProblem(source: string | null, entries: CheckableEntry[]): string | null {
  if (!source) return "Sent as a fact without a source, so the platform stored it as an assumption.";
  if (GENERIC_SOURCE.test(source)) return `Sent as a fact, but its source ("${source.slice(0, 60)}") is not checkable, so the platform stored it as an assumption.`;
  const cited = entries.find((e) => source.includes(e.ref) && e.kind !== "fact" && !e.checkedByOwner);
  if (cited) return `Sent as a fact, but its source is ${cited.ref}, which is a ${cited.kind}; repeating it does not verify it, so the platform stored it as an assumption.`;
  return null;
}
