import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEAD_COLUMNS, makeLead, rowsHash, type Lead } from "./leads.js";
import { STAGING_LIMITS, Staging } from "./staging.js";
import { LEADS_FILE, LeadStore } from "./store.js";

const clock = { t: Date.UTC(2026, 10, 4, 10) };
const NOW = () => clock.t;
const lead = (name: string, over: Record<string, unknown> = {}): Lead => makeLead({ business_name: name, city: "Dubai", source: "osm", source_id: name, ...over }, new Date(clock.t).toISOString());

describe("staged batches (memory only)", () => {
  it("holds a batch under an id, with a hash of its exact rows", () => {
    const s = new Staging(NOW);
    const b = s.create("dentists in Dubai", [lead("A"), lead("B")]);
    expect(b.id).toMatch(/^B-[0-9a-f]{8}$/);
    expect(s.get(b.id)!.rows).toHaveLength(2);
    expect(s.hash(b.id)).toBe(rowsHash(s.get(b.id)!.rows));
    expect(s.hash("B-nope")).toBeNull();
  });

  it("changing the rows changes the hash, so an old approval can no longer match", () => {
    const s = new Staging(NOW);
    const b = s.create("x", [lead("A")]);
    const before = s.hash(b.id);
    s.replaceRows(b.id, [{ ...b.rows[0]!, lead_score: 99 }]);
    expect(s.hash(b.id)).not.toBe(before);
    expect(() => s.replaceRows("B-nope", [])).toThrow(/not available any more/);
  });

  it("batches expire after a day and the oldest go when there are too many; rows per batch are limited", () => {
    const s = new Staging(NOW);
    const old = s.create("old", [lead("A")]);
    clock.t += STAGING_LIMITS.ttlMs + 1;
    expect(s.get(old.id)).toBeUndefined();
    const ids = Array.from({ length: STAGING_LIMITS.maxBatches + 3 }, (_, i) => s.create(`b${i}`, [lead(`n${i}`)]).id);
    expect(s.list()).toHaveLength(STAGING_LIMITS.maxBatches);
    expect(s.get(ids[0]!)).toBeUndefined();
    expect(s.get(ids.at(-1)!)).toBeDefined();
    const big = s.create("big", Array.from({ length: 200 }, (_, i) => lead(`x${i}`)));
    expect(big.rows).toHaveLength(STAGING_LIMITS.maxRows);
  });
});

describe("the leads file", () => {
  let dir: string;
  let store: LeadStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leads-test-"));
    store = new LeadStore(join(dir, "business-workforce", "leads"), NOW);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const file = () => join(store.dir, LEADS_FILE);

  it("creates the folder and file on the first save: a byte-order mark, the documented header, one row per lead", async () => {
    expect(store.read()).toEqual({ rows: [], skipped: 0 });
    const r = await store.merge([lead("Al Noor"), lead("Smile")]);
    expect(r).toMatchObject({ added: 2, updated: 0, duplicates: [] });
    const text = readFileSync(file(), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split("\r\n")[0]).toBe(LEAD_COLUMNS.join(","));
    expect(store.count()).toBe(2);
    expect(readdirSync(store.dir).sort()).toEqual([LEADS_FILE]); // no temporary file is left behind
  });

  it("a second save adds only what is new, skips duplicates, and keeps the previous version as a backup", async () => {
    await store.merge([lead("Al Noor", { phone: "04 111 2222" })]);
    const first = readFileSync(file(), "utf8");
    const r = await store.merge([lead("Another", { phone: "+971 4 111 2222", source_id: "x" }), lead("Fresh", { source_id: "f" })]);
    expect(r.added).toBe(1);
    expect(r.duplicates).toEqual([expect.objectContaining({ reason: "same_phone" })]);
    expect(store.count()).toBe(2);
    expect(readFileSync(`${file()}.bak`, "utf8")).toBe(first);
  });

  it("text that looks like a spreadsheet formula is stored guarded, and still reads back as it was", async () => {
    await store.merge([lead("=HYPERLINK(\"http://evil\",\"x\")")]);
    expect(readFileSync(file(), "utf8")).toContain("'=HYPERLINK");
    expect(store.read().rows[0]!.business_name).toBe('=HYPERLINK("http://evil","x")');
  });

  it("a file with rows it cannot read is never overwritten: nothing is saved, so nothing is lost", async () => {
    await store.merge([lead("Keep")]);
    const damaged = `${readFileSync(file(), "utf8")}L-1,AE,,,,,,,,,,,,,,,,,,,,,,,,,,\r\n`;
    writeFileSync(file(), damaged, "utf8");
    await expect(store.merge([lead("New", { source_id: "n" })])).rejects.toThrow(/could not be read.*Nothing was saved/);
    expect(readFileSync(file(), "utf8")).toBe(damaged);
  });

  it("two saves at the same moment both land (no lost update)", async () => {
    await Promise.all([store.merge([lead("A", { source_id: "a" })]), store.merge([lead("B", { source_id: "b" })]), store.merge([lead("C", { source_id: "c" })])]);
    expect(store.read().rows.map((l) => l.business_name).sort()).toEqual(["A", "B", "C"]);
  });

  describe("the owner's own changes", () => {
    it("sets status and notes, and a later scan of the same business never overwrites them", async () => {
      await store.merge([lead("Al Noor")]);
      const id = store.read().rows[0]!.lead_id;
      await store.update(id, { status: "qualified", notes: "Spoke to the owner `today`" });
      const row = store.read().rows[0]!;
      expect(row).toMatchObject({ status: "qualified", notes: "Spoke to the owner 'today'" });
      clock.t += 60_000;
      await store.merge([lead("Al Noor", { address: "New address" })]);
      expect(store.read().rows[0]).toMatchObject({ status: "qualified", notes: "Spoke to the owner 'today'", address: "New address" });
    });

    it("confirming 'no website' is allowed only when no address exists, and can be withdrawn", async () => {
      await store.merge([lead("NoSite"), lead("HasSite", { website_url: "https://x.ae" })]);
      const [a, b] = store.read().rows;
      expect((await store.update(a!.lead_id, { confirmNoWebsite: true })).website_state).toBe("confirmed_none");
      await expect(store.update(b!.lead_id, { confirmNoWebsite: true })).rejects.toThrow(/cannot be marked as having no website/);
      expect((await store.update(a!.lead_id, { confirmNoWebsite: false })).website_state).toBe("none_listed");
    });

    it("refuses an unknown lead and an unknown status", async () => {
      await store.merge([lead("A")]);
      await expect(store.update("L-nope", { status: "won" })).rejects.toThrow(/No such lead/);
      await expect(store.update(store.read().rows[0]!.lead_id, { status: "hacked" as never })).rejects.toThrow(/not a valid status/);
    });
  });

  it("exports an Excel file of the same leads", async () => {
    await store.merge([lead("Al Noor"), lead("Smile")]);
    const xlsx = store.exportXlsx();
    expect(xlsx.subarray(0, 2).toString()).toBe("PK"); // an Excel file is a zip
    expect(xlsx.length).toBeGreaterThan(500);
    expect(existsSync(file())).toBe(true);
  });

  it("refuses to grow past the limit instead of writing a file Excel cannot hold", async () => {
    await expect(store.merge(Array.from({ length: 5001 }, (_, i) => lead(`b${i}`, { source_id: `s${i}`, city: `c${i}` })))).rejects.toThrow(/file is full/);
    expect(existsSync(file())).toBe(false);
  });
});
