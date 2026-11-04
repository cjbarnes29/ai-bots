import { randomBytes } from "node:crypto";
import { rowsHash, type Lead } from "./leads.js";

/**
 * Staged batches: what an agent found, held IN MEMORY ONLY until the owner approves saving it.
 *
 * Nothing here touches the disk. An approval is bound to the batch id and to the hash of its exact rows, so what the owner approved
 * is exactly what gets saved: if the rows change afterwards (more audits, new scores), the old approval no longer matches and
 * nothing is written. A restart empties the staging area, which also makes an old approval fail safely.
 */
export const STAGING_LIMITS = { maxBatches: 10, maxRows: 60, ttlMs: 24 * 3_600_000 };

export interface Batch {
  id: string;
  createdAt: number;
  /** Human words describing the search, for display only. */
  label: string;
  rows: Lead[];
}

export class Staging {
  private readonly batches = new Map<string, Batch>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const cutoff = this.now() - STAGING_LIMITS.ttlMs;
    for (const [id, b] of this.batches) if (b.createdAt < cutoff) this.batches.delete(id);
    while (this.batches.size > STAGING_LIMITS.maxBatches) this.batches.delete(this.batches.keys().next().value as string);
  }

  create(label: string, rows: Lead[]): Batch {
    this.prune();
    const batch: Batch = { id: `B-${randomBytes(4).toString("hex")}`, createdAt: this.now(), label: label.slice(0, 120), rows: rows.slice(0, STAGING_LIMITS.maxRows).map((r) => ({ ...r })) };
    this.batches.set(batch.id, batch);
    this.prune();
    return batch;
  }

  get(id: string): Batch | undefined {
    this.prune();
    return this.batches.get(id);
  }

  replaceRows(id: string, rows: Lead[]): Batch {
    const b = this.get(id);
    if (!b) throw new Error("That batch is not available any more. Run the search again.");
    b.rows = rows.map((r) => ({ ...r }));
    return b;
  }

  remove(id: string): void {
    this.batches.delete(id);
  }

  list(): Batch[] {
    this.prune();
    return [...this.batches.values()].reverse();
  }

  hash(id: string): string | null {
    const b = this.get(id);
    return b ? rowsHash(b.rows) : null;
  }
}
