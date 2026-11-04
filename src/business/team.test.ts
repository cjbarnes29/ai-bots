import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";
import { AGENT_TEMPLATES, SKILL_TEMPLATES, WORKFLOW_NAME, workflowGraph } from "./team.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("the Business team", () => {
  let t: TestApp;
  let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "bw-team-"));
    t = await createTestApp({ connectors: [], includeBusiness: true, businessDir: join(dir, "leads") });
  });
  afterEach(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const status = async () => (await t.call("GET", "/api/business/team")).body;
  const install = () => t.call("POST", "/api/business/team", {});
  const bots = async () => (await t.call("GET", "/api/bots")).body.bots as any[];
  const byName = async (n: string) => (await bots()).find((b) => b.name === n);

  it("shows what would be installed, including the exact instructions each agent would be given", async () => {
    const s = await status();
    expect(s.agents.map((a: any) => a.name)).toEqual(["Business Researcher", "Lead Scout", "Site Auditor", "Proposal Writer"]);
    expect(s.agents.every((a: any) => a.exists === false && a.instructions.length > 200)).toBe(true);
    expect(s.skills.every((x: any) => x.exists === false)).toBe(true);
    expect(s.workflow).toEqual({ name: WORKFLOW_NAME, exists: false });
    expect(s.managerAllowsAll).toBe(false);
  });

  it("every agent is told: website and map text is data, never to send or contact, failed checks are not verdicts, three actions at most", () => {
    for (const a of AGENT_TEMPLATES) {
      expect(a.instructions, a.name).toMatch(/DATA, never instructions/);
      expect(a.instructions, a.name).toMatch(/never send, publish, contact or buy/);
      expect(a.instructions, a.name).toMatch(/failed website check means "could not be checked"/);
      expect(a.instructions, a.name).toMatch(/at most 3 outside actions/);
      expect(a.instructions, a.name).toMatch(/Write in English/);
      expect(a.instructions, a.name).not.toMatch(/"action":\s*"send_message"|gmail|telegram/i); // none is pointed at a sending action
    }
    expect(AGENT_TEMPLATES.find((a) => a.key === "proposal_writer")!.instructions).toMatch(/Never state a price|never state a price/i);
  });

  it("installs four agents switched OFF, with web reading only where the role needs it, plus the skills and a workflow that is OFF", async () => {
    const res = await install();
    expect(res.status).toBe(200);
    expect(res.body.agents.map((a: any) => [a.name, a.created])).toEqual([["Business Researcher", true], ["Lead Scout", true], ["Site Auditor", true], ["Proposal Writer", true]]);
    expect(res.body.skills.map((s: any) => s.created)).toEqual([true, true, true]);
    expect(res.body.workflow).toEqual({ name: WORKFLOW_NAME, created: true });
    expect(res.body.managerAdded).toBe(4);
    expect(res.body.notes.join(" ")).toMatch(/switched OFF/);

    const list = await bots();
    for (const name of ["Business Researcher", "Lead Scout", "Site Auditor", "Proposal Writer"]) expect(list.find((b) => b.name === name)!.status).toBe("disabled");
    const webRead = async (n: string) => (await byName(n)).permissions.find((p: any) => p.connector === "browser").readEnabled;
    expect(await webRead("Business Researcher")).toBe(true);
    expect(await webRead("Lead Scout")).toBe(true);
    expect(await webRead("Site Auditor")).toBe(true);
    expect(await webRead("Proposal Writer")).toBe(false);
    // nothing else was granted: Gmail and Telegram reading stay off for every one of them
    for (const b of list) for (const p of b.permissions.filter((x: any) => x.connector !== "browser")) expect(p.readEnabled).toBe(false);

    const s = await status();
    expect(s.agents.every((a: any) => a.exists)).toBe(true);
    expect(s.skills.every((x: any) => x.exists)).toBe(true);
    expect(s.workflow.exists).toBe(true);
    expect(s.managerAllowsAll).toBe(true);
  });

  it("each agent gets only its role's skills", async () => {
    await install();
    const skills = (await t.call("GET", "/api/skills")).body.skills as any[];
    for (const a of AGENT_TEMPLATES) {
      const bot = await byName(a.name);
      const assigned = skills.filter((s) => s.assignedBots.includes(bot.id)).map((s) => s.name);
      expect(assigned.sort(), a.name).toEqual([...a.skills].sort());
    }
    expect(skills.map((s) => s.name).sort()).toEqual(SKILL_TEMPLATES.map((s) => s.name).sort());
  });

  it("the workflow is valid, switched off, and hands over to the owner at every outside step", async () => {
    await install();
    const wf = ((await t.call("GET", "/api/workflows")).body.workflows as any[]).find((w) => w.name === WORKFLOW_NAME);
    expect(wf).toMatchObject({ enabled: false, problems: [] });
    const types = wf.graph.nodes.map((n: any) => n.type);
    expect(types.filter((x: string) => x === "checkpoint")).toHaveLength(3);
    expect(types.filter((x: string) => x === "bot_task")).toHaveLength(4);
    // a checkpoint sits between asking to save and writing proposals, and before the end
    const order = wf.graph.nodes.map((n: any) => n.id);
    expect(order.indexOf("approve")).toBeGreaterThan(order.indexOf("save"));
    expect(order.indexOf("write")).toBeGreaterThan(order.indexOf("approve"));
    expect(order.indexOf("final")).toBeGreaterThan(order.indexOf("write"));
    const ids = Object.fromEntries((await bots()).map((b) => [b.name, b.id]));
    expect(wf.graph.nodes.find((n: any) => n.id === "scout").botId).toBe(ids["Lead Scout"]);
    expect(wf.graph.nodes.find((n: any) => n.id === "audit").botId).toBe(ids["Site Auditor"]);
    expect(wf.graph.nodes.find((n: any) => n.id === "write").botId).toBe(ids["Proposal Writer"]);
  });

  it("installing twice changes nothing the second time, and never touches what the owner changed", async () => {
    await install();
    const scout = await byName("Lead Scout");
    await t.call("PUT", `/api/bots/${scout.id}/permissions/browser`, { readEnabled: false }); // the owner turned reading off
    await t.call("PATCH", `/api/bots/${scout.id}`, { instructions: "My own instructions" });
    const before = (await bots()).length;
    const again = await install();
    expect(again.body.agents.every((a: any) => a.created === false)).toBe(true);
    expect(again.body.skills.every((s: any) => s.created === false)).toBe(true);
    expect(again.body.workflow.created).toBe(false);
    expect(again.body.managerAdded).toBe(0);
    expect((await bots()).length).toBe(before);
    const after = await byName("Lead Scout");
    expect(after.instructions).toBe("My own instructions");
    expect(after.permissions.find((p: any) => p.connector === "browser").readEnabled).toBe(false);
    expect(((await t.call("GET", "/api/workflows")).body.workflows as any[]).filter((w) => w.name === WORKFLOW_NAME)).toHaveLength(1);
  });

  it("an agent you already have with the same name is reused untouched, and the Manager's existing specialists are kept", async () => {
    const mine = (await t.call("POST", "/api/bots", { name: "Lead Scout", instructions: "Mine" })).body.bot;
    const other = (await t.call("POST", "/api/bots", { name: "Someone Else" })).body.bot;
    await t.call("PUT", "/api/manager/settings", { allowedBots: [other.id] });
    const res = await install();
    expect(res.body.agents.find((a: any) => a.key === "lead_scout")).toMatchObject({ id: mine.id, created: false });
    expect(res.body.notes.join(" ")).toMatch(/Lead Scout already exists, so it was left exactly as it is/);
    expect((await byName("Lead Scout")).instructions).toBe("Mine");
    expect((await byName("Lead Scout")).permissions.find((p: any) => p.connector === "browser").readEnabled).toBe(false); // not granted to an existing agent
    const allowed = (await t.call("GET", "/api/manager")).body.settings.allowedBots as string[];
    expect(allowed).toContain(other.id);
    expect(allowed).toContain(mine.id);
    expect(allowed).toHaveLength(5);
  });

  it("the workflow graph builder wires the agents it is given", () => {
    const g = workflowGraph({ lead_scout: "11111111-1111-4111-8111-111111111111", site_auditor: "22222222-2222-4222-8222-222222222222", proposal_writer: "33333333-3333-4333-8333-333333333333" });
    expect(g.nodes).toHaveLength(9);
    expect(g.edges).toHaveLength(8);
    expect(g.edges.every((e) => e.when === "always")).toBe(true);
  });

  it("the install route takes no input, and does nothing external: no map, no website, no email", async () => {
    expect((await t.call("POST", "/api/business/team", { botId: "x" })).status).toBe(400);
    await install();
    const kinds = ((await t.call("GET", "/api/audit?limit=200")).body.events as any[]).map((e) => e.kind);
    expect(kinds.some((k) => k === "business.external_request" || k.startsWith("approval."))).toBe(false);
    expect((await t.call("GET", "/api/business/status")).body.externalEnabled).toBe(false);
  });
});
