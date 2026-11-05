import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The Guardian's own log: one JSON line per event, each line carrying the hash of the line before it.
 * If someone edits or deletes a line in the middle, verify() reports where the chain breaks.
 *
 * LIMIT (Tier A): a process running as the same Windows user can read, edit AND rewrite the whole file with a fresh valid chain,
 * or delete it. So in Tier A this is tamper DETECTION for accidents and careless edits only, not protection against a determined
 * attacker. Tier B keeps the journal where the AI's account cannot write.
 */
export interface JournalEntry {
  seq: number;
  ts: string;
  event: string;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);
const ROTATE_BYTES = 5 * 1024 * 1024;

function digest(prev: string, seq: number, ts: string, event: string, data: Record<string, unknown>): string {
  return createHash("sha256").update(`${prev}\n${seq}\n${ts}\n${event}\n${JSON.stringify(data)}`).digest("hex");
}

export function readEntries(file: string): JournalEntry[] {
  if (!existsSync(file)) return [];
  const out: JournalEntry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      out.push({ seq: -1, ts: "", event: "unreadable_line", data: {}, prev: "", hash: "" });
    }
  }
  return out;
}

/** Checks one file. `expectedPrev` is the hash the first line must continue from (GENESIS for the first file). */
export function verifyEntries(entries: JournalEntry[], expectedPrev = GENESIS): { ok: true; count: number } | { ok: false; at: number; reason: string } {
  let prev = expectedPrev;
  let seq = entries.length > 0 ? entries[0]!.seq : 0;
  for (const [i, e] of entries.entries()) {
    if (e.seq !== seq) return { ok: false, at: i, reason: `line ${i + 1}: sequence number ${e.seq} where ${seq} was expected` };
    if (e.prev !== prev) return { ok: false, at: i, reason: `line ${i + 1}: does not continue from the line before it` };
    if (digest(e.prev, e.seq, e.ts, e.event, e.data) !== e.hash) return { ok: false, at: i, reason: `line ${i + 1}: content was changed` };
    prev = e.hash;
    seq++;
  }
  return { ok: true, count: entries.length };
}

export class Journal {
  private lastHash = GENESIS;
  private nextSeq = 1;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    const entries = readEntries(file);
    const last = entries[entries.length - 1];
    if (last && last.seq > 0) {
      this.lastHash = last.hash;
      this.nextSeq = last.seq + 1;
    }
  }

  append(event: string, data: Record<string, unknown> = {}): JournalEntry {
    this.rotateIfLarge();
    const ts = new Date(this.now()).toISOString();
    const seq = this.nextSeq;
    const hash = digest(this.lastHash, seq, ts, event, data);
    const entry: JournalEntry = { seq, ts, event, data, prev: this.lastHash, hash };
    appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
    this.lastHash = hash;
    this.nextSeq = seq + 1;
    return entry;
  }

  /** The newest entries, oldest first. */
  tail(count: number): JournalEntry[] {
    return readEntries(this.file).slice(-count);
  }

  verify(): ReturnType<typeof verifyEntries> {
    const entries = readEntries(this.file);
    return verifyEntries(entries, entries.length > 0 && entries[0]!.seq > 1 ? entries[0]!.prev : GENESIS);
  }

  /** A big file is renamed and a new one continues the same chain (the first line carries the old last hash). */
  private rotateIfLarge(): void {
    if (!existsSync(this.file) || statSync(this.file).size < ROTATE_BYTES) return;
    renameSync(this.file, this.file.replace(/\.jsonl$/, "") + `.${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}.jsonl`);
  }
}
