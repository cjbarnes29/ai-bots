import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";
import { leadsToCsv, makeLead, type Lead } from "./leads.js";
import { applyScore } from "./scoring.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const NOW = "2026-11-04T10:00:00.000Z";
const L = (name: string, over: Record<string, unknown> = {}): Lead => applyScore(makeLead({ business_name: name, city: "Dubai", source: "osm", source_id: name, ...over }, NOW));

const FIXTURE: Lead[] = [
  L("Old Salon", { website_url: "http://old.ae", website_state: "audited", audit_score: 10, audit_summary: "Problems: works on phones.", category: "beauty", phone: "04 111 2222" }),
  L("No Site Dental", { category: "health", phone: "04 333 4444", address: "Main St" }),
  L("Fine Cafe", { website_url: "https://fine.ae", website_state: "audited", audit_score: 95, category: "food" }),
  L("Unreachable Gym", { website_url: "https://gym.ae", website_state: "audit_failed", audit_failure: "timed_out", category: "fitness" }),
];

describe("Business Workforce dashboard routes", () => {
  let t: TestApp;
  let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "bw-routes-"));
    mkdirSync(join(dir, "leads"), { recursive: true });
    writeFileSync(join(dir, "leads", "leads.csv"), `﻿${leadsToCsv(FIXTURE)}`, "utf8");
    t = await createTestApp({ connectors: [], includeBusiness: true, businessDir: join(dir, "leads") });
  });
  afterEach(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const leads = async (query = "") => (await t.call("GET", `/api/business/leads${query}`)).body as { total: number; leads: any[] };

  it("status describes the market, the categories, the rubric and the limits, and says the lock is off", async () => {
    const s = (await t.call("GET", "/api/business/status")).body;
    expect(s.externalEnabled).toBe(false);
    expect(s.storage).toMatchObject({ file: "leads.csv", count: 4, max: 5000 });
    expect(s.markets[0]).toMatchObject({ code: "AE", proposalLanguage: "en" });
    expect(s.markets[0].regions).toHaveLength(7);
    expect(s.categories.length).toBeGreaterThan(15);
    expect(s.rubric.rows.reduce((n: number, r: any) => n + r.max, 0)).toBe(100);
    expect(s.rubric.priorityRule).toMatch(/High: 60 or more/);
    expect(s.limits).toMatchObject({ maxQueriesPerDay: 20, siteRequestsPerDay: 300 });
    expect(s.statuses).toContain("qualified");
  });

  it("lists leads best first, each with the explanation of its score", async () => {
    const r = await leads();
    expect(r.total).toBe(4);
    expect(r.leads.map((l) => l.business_name)).toEqual(["Old Salon", "No Site Dental", "Fine Cafe", "Unreachable Gym"]);
    const gym = r.leads.find((l) => l.business_name === "Unreachable Gym");
    expect(gym).toMatchObject({ website_state: "audit_failed", audit_failure: "timed_out", confidence: "needs_check" });
    expect(gym.criteria[0]).toMatchObject({ id: "website", points: 0 });
    expect(gym.criteria.reduce((n: number, c: any) => n + c.points, 0)).toBe(gym.lead_score);
  });

  it("filters by priority, status and words, and limits the number returned; nonsense is a 400", async () => {
    expect((await leads("?priority=high")).leads.map((l) => l.business_name)).toEqual(["Old Salon", "No Site Dental"]);
    expect((await leads("?q=gym")).total).toBe(1);
    expect((await leads("?q=%D8%B9")).total).toBe(0);
    expect((await leads("?limit=2")).leads).toHaveLength(2);
    expect((await leads("?status=new")).total).toBe(4);
    expect((await leads("?status=won")).total).toBe(0);
    expect((await t.call("GET", "/api/business/leads?priority=urgent")).status).toBe(400);
    expect((await t.call("GET", "/api/business/leads?limit=100000")).status).toBe(400);
    expect((await t.call("GET", "/api/business/leads?evil=1")).status).toBe(400);
  });

  it("the owner can set a status and notes; they are saved to the file and survive", async () => {
    const id = (await leads("?q=salon")).leads[0].lead_id;
    const res = await t.call("PUT", `/api/business/leads/${id}`, { status: "qualified", notes: "Call on Sunday" });
    expect(res.status).toBe(200);
    expect(res.body.lead).toMatchObject({ status: "qualified", notes: "Call on Sunday" });
    expect((await leads("?status=qualified")).leads.map((l) => l.business_name)).toEqual(["Old Salon"]);
  });

  it("'confirm there is no website' works only for a lead with no website address", async () => {
    const noSite = (await leads("?q=no site")).leads[0];
    const res = await t.call("PUT", `/api/business/leads/${noSite.lead_id}`, { confirmNoWebsite: true });
    expect(res.body.lead).toMatchObject({ website_state: "confirmed_none", lead_score: 100 });
    const withSite = (await leads("?q=fine")).leads[0];
    const refused = await t.call("PUT", `/api/business/leads/${withSite.lead_id}`, { confirmNoWebsite: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("lead_change_refused");
  });

  it("rejects unknown leads, odd ids, unknown statuses and extra fields", async () => {
    expect((await t.call("PUT", "/api/business/leads/L-000000000000", { status: "won" })).status).toBe(404);
    expect((await t.call("PUT", "/api/business/leads/..%2F..%2Fetc", { status: "won" })).status).toBe(404);
    const id = (await leads()).leads[0].lead_id;
    expect((await t.call("PUT", `/api/business/leads/${id}`, { status: "hacked" })).status).toBe(400);
    expect((await t.call("PUT", `/api/business/leads/${id}`, { website_url: "https://evil.example" })).status).toBe(400);
    expect((await t.call("PUT", `/api/business/leads/${id}`, { lead_score: 100 })).status).toBe(400);
  });

  it("exports the same leads as an Excel file", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/business/leads.xlsx" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
    expect(res.headers["content-disposition"]).toContain("leads.xlsx");
    expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("an unknown staged batch is a clear 404", async () => {
    expect((await t.call("GET", "/api/business/batches")).body.batches).toEqual([]);
    expect((await t.call("GET", "/api/business/batches/B-00000000")).status).toBe(404);
    expect((await t.call("GET", "/api/business/batches/nope")).status).toBe(404);
  });

  it("appears in the Integrations Center, where Test connection never contacts anything and says the lock is off", async () => {
    const entry = ((await t.call("GET", "/api/integrations")).body.integrations as any[]).find((e) => e.id === "business");
    expect(entry).toMatchObject({ label: "Business Workforce", group: "Business Workforce", status: "ready", testable: true });
    expect(entry.actions.map((a: any) => `${a.name}:${a.kind}`).sort()).toEqual(["audit_batch:read", "find_businesses:read", "list_leads:read", "proposal_facts:read", "save_leads:write", "show_batch:read"]);
    const check = await t.call("POST", "/api/integrations/business/verify");
    expect(check.body).toMatchObject({ result: "verified" });
    expect(check.body.summary).toMatch(/switched off until you switch them on/);
  });
});
