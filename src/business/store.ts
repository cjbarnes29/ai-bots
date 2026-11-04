import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeXlsx } from "../documents/office.js";
import { applyScore } from "./scoring.js";
import { LEAD_COLUMNS, LEAD_STATUSES, cleanText, FIELD_LIMITS, leadsFromCsv, leadsToCsv, mergeLeads, type Lead, type LeadStatus, type MergeResult } from "./leads.js";

/**
 * The leads file: one CSV (and an Excel export of it), no database.
 *
 * - One fixed folder and one fixed file name: nothing a bot or a website says can choose a path.
 * - Every write goes to a temporary file first and is renamed into place, and the previous version is kept as leads.csv.bak,
 *   so a crash or a bad batch cannot destroy the list.
 * - Written with a byte-order mark so Excel shows Arabic correctly; formula-looking text is guarded (see csv.ts).
 */
export const STORE_LIMITS = { maxLeads: 5000 };
export const LEADS_FILE = "leads.csv";

export class LeadStore {
  private readonly file: string;
  /** Serialises writes inside this process so two saves can never interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dir, LEADS_FILE);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  read(): { rows: Lead[]; skipped: number } {
    if (!existsSync(this.file)) return { rows: [], skipped: 0 };
    return leadsFromCsv(readFileSync(this.file, "utf8"), this.iso());
  }

  count(): number {
    return this.read().rows.length;
  }

  private write(rows: Lead[]): void {
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `﻿${leadsToCsv(rows)}`, "utf8");
    renameSync(tmp, this.file);
  }

  /** Runs one change at a time. */
  private exclusive<T>(work: () => T): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  merge(incoming: Lead[]): Promise<MergeResult> {
    return this.exclusive(() => {
      const { rows, skipped } = this.read();
      if (skipped > 0) throw new Error(`The leads file has ${skipped} row(s) that could not be read. Nothing was saved so they are not lost: open ${LEADS_FILE} and fix or remove them.`);
      const result = mergeLeads(rows, incoming, this.iso());
      if (result.rows.length > STORE_LIMITS.maxLeads) throw new Error(`The leads file is full (${STORE_LIMITS.maxLeads} leads). Export it and start a new one.`);
      this.write(result.rows);
      return result;
    });
  }

  /** The owner's own changes: status, notes, and confirming that a business really has no website. */
  update(id: string, patch: { status?: LeadStatus; notes?: string; confirmNoWebsite?: boolean }): Promise<Lead> {
    return this.exclusive(() => {
      const { rows } = this.read();
      const lead = rows.find((l) => l.lead_id === id);
      if (!lead) throw new Error("No such lead.");
      if (patch.status !== undefined) {
        if (!(LEAD_STATUSES as readonly string[]).includes(patch.status)) throw new Error("That is not a valid status.");
        lead.status = patch.status;
      }
      if (patch.notes !== undefined) lead.notes = cleanText(patch.notes, FIELD_LIMITS.notes);
      if (patch.confirmNoWebsite !== undefined) {
        if (patch.confirmNoWebsite) {
          if (lead.website_url) throw new Error("This lead has a website address, so it cannot be marked as having no website.");
          lead.website_state = "confirmed_none";
        } else if (lead.website_state === "confirmed_none") lead.website_state = "none_listed";
      }
      lead.updated_at = this.iso();
      // A change to the website situation changes the score, so the stored score is recomputed (never left stale).
      const rescored = applyScore(lead);
      rows[rows.indexOf(lead)] = rescored;
      this.write(rows);
      return rescored;
    });
  }

  exportXlsx(): Buffer {
    const { rows } = this.read();
    return writeXlsx([
      { name: "Leads", header: [...LEAD_COLUMNS], rows: rows.map((l) => LEAD_COLUMNS.map((c) => (l[c] === null ? null : (l[c] as string | number)))) },
    ]);
  }
}
