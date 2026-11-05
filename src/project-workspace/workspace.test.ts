import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { defuse, parsePublications } from "./protocol.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The shared project workspace. All model replies come from a SCRIPTED FAKE provider; each scripted reply reads what the platform really sent to the
 * model (as a real model would), so these tests prove the plumbing: retrieval before work, publication, labels, files, ownership, restart. They say nothing
 * about how a real model behaves with the workspace (not tried with a real provider).
 */
const fence = "```";
const ws = (o: Record<string, unknown>) => `${fence}workspace\n${JSON.stringify(o)}\n${fence}`;
const act = (connector: string, action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 30, outputTokens: 15 });

let t: TestApp;
let dir: string;
let folder: string;
let ref: string;
const sentToModel = (i = -1) => (t.provider.calls.at(i)!.messages as { role: string; content: string }[]);
const userMsg = (i = -1) => sentToModel(i).find((m) => m.role === "user")!.content;
const systemMsg = (i = -1) => sentToModel(i).find((m) => m.role === "system")!.content;

async function start(opts: { dbPath?: string } = {}) {
  t = await createTestApp({ includePc: true, includeMemory: true, ...(opts.dbPath ? { dbPath: opts.dbPath } : {}) });
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  ref = await setupGeminiModel(t);
}
const mkBot = async (name: string, role = "") => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, role, model: ref }))).body.bot as any;
const mkProject = async (name: string) => (await t.call("POST", "/api/projects", { name })).body.project as any;
/** `save`: must the agent save its result to the workspace (the default for a task started in a project)? Tests that are not about that pass false. */
async function runTask(botId: string, instruction: string, projectId?: string, save = false): Promise<any> {
  const res = await t.call("POST", `/api/bots/${botId}/tasks`, { instruction, ...(projectId ? { projectId, saveToWorkspace: save } : {}) });
  expect(res.status).toBe(202);
  return vi.waitFor(async () => {
    const task = (await t.call("GET", `/api/tasks/${res.body.task.id}`)).body.task;
    expect(["completed", "failed"]).toContain(task.status);
    return task;
  }, { timeout: 5000, interval: 10 });
}
const view = async (projectId: string) => (await t.call("GET", `/api/projects/${projectId}/workspace`)).body as any;
const events = async (taskId: string) => ((await t.call("GET", `/api/tasks/${taskId}`)).body.events as any[]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-workspace-"));
  folder = join(dir, "files");
  mkdirSync(folder, { recursive: true });
});
afterEach(async () => {
  await t?.app.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("acceptance: three agents exchange research, findings and files through the project workspace (no manual copying)", () => {
  it("researcher -> analyst (file through the approval gate) -> writer, then the context survives a restart", async () => {
    mkdirSync(join(dir, "data"));
    const dbPath = join(dir, "data", "app.db"); // the app refuses a PC workspace folder that holds its own database, so they are apart
    await start({ dbPath });
    expect((await t.call("POST", "/api/pc/workspaces", { path: folder })).status).toBeLessThan(300);
    const researcher = await mkBot("Researcher", "Finds facts");
    const analyst = await mkBot("Analyst", "Turns facts into numbers and files");
    const writer = await mkBot("Writer", "Writes the final brief");
    await t.call("PUT", `/api/bots/${analyst.id}/pc`, { grants: ["modify"] });
    await t.call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["read"] });
    const project = await mkProject("Dubai cafe market");

    // ---- 1. Researcher: workspace is empty, it publishes a fact (with source), a "fact" without a source, and a finding
    let researcherSaw = "";
    t.provider.script.push(async () => {
      researcherSaw = userMsg();
      return reply([
        "Research done.",
        ws({ kind: "fact", title: "Cafe licence fee", text: "A Dubai cafe trade licence costs about AED 15,000 per year.", source: "Dubai Economy fee table 2026" }),
        ws({ kind: "fact", title: "Evening foot traffic", text: "Dubai Marina has the highest evening foot traffic." }),
        ws({ kind: "finding", title: "Competitor count", text: "There are 42 specialty cafes in Dubai Marina." }),
      ].join("\n"));
    });
    const r1 = await runTask(researcher.id, "Research the cafe market in Dubai Marina: licence fees, foot traffic, competitors.", project.id, true);
    expect(r1.status).toBe("completed");
    expect(researcherSaw).toMatch(/WORKSPACE of project "Dubai cafe market"/);
    expect(researcherSaw).toMatch(/Entries: none yet/);
    expect(systemMsg()).toMatch(/```workspace/); // the agent was told how to publish
    const v1 = await view(project.id);
    expect(v1.entries.map((e: any) => [e.kind, e.title, e.authorName])).toEqual([
      ["finding", "Competitor count", "Researcher"],
      ["assumption", "Evening foot traffic", "Researcher"],
      ["fact", "Cafe licence fee", "Researcher"],
    ]);
    expect(v1.entries[1].platformNote).toMatch(/without a source.*assumption/);
    expect(v1.entries[2]).toMatchObject({ source: "Dubai Economy fee table 2026", taskId: r1.id });
    const fee = v1.entries[2];

    // ---- 2. Analyst: retrieves the researcher's work before acting, asks for a CSV file (waits for the owner), recommends and hands over to Writer
    let analystSaw = "";
    t.provider.script.push(
      async () => {
        analystSaw = userMsg();
        return reply([
          act("documents", "create_spreadsheet", { path: "marina-cafes.csv", format: "csv", sheets: [{ name: "Costs", header: ["Item", "AED per year"], rows: [["Licence", 15000], ["Rent", 180000]] }] }),
          ws({ kind: "recommendation", title: "Open in Marina", text: `Open in Dubai Marina: high traffic and a known licence cost (${fee.ref}).` }),
          ws({ kind: "handover", for: "Writer", title: "Write the brief", text: "Use marina-cafes.csv and the entries above to write the owner's brief." }),
        ].join("\n"));
      },
      async () => reply("The cost table is waiting for the owner's approval."),
    );
    const r2 = await runTask(analyst.id, "Estimate yearly costs for a Marina cafe and recommend a location.", project.id, true);
    expect(r2.status).toBe("completed");
    expect(analystSaw).toContain(`[${fee.ref}] FACT (agent cites a source) by Researcher: Cafe licence fee`);
    expect(analystSaw).toContain("Source: Dubai Economy fee table 2026");
    expect(analystSaw).toMatch(/(ASSUMPTION \(not verified\)|assumption) by Researcher: Evening foot traffic/);
    expect(analystSaw).toMatch(/Earlier finished work:\n- Researcher: .* -> published W-/); // its result is not repeated: its entries carry it
    expect(analystSaw).not.toContain("```workspace"); // earlier results reach other agents without their raw blocks
    // the file is not there yet: it waits for the owner, and the workspace says so
    expect((await view(project.id)).files).toMatchObject([{ status: "waiting_for_approval", ownerName: "Analyst", path: "marina-cafes.csv" }]);
    const pending = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    expect(pending).toHaveLength(1);
    expect((await t.call("POST", `/api/approvals/${pending[0].id}/approve`)).body.approval.status).toBe("executed");
    expect(existsSync(join(folder, "marina-cafes.csv"))).toBe(true);
    const v2 = await view(project.id);
    expect(v2.files).toMatchObject([{ status: "created", ownerName: "Analyst", action: "documents.create_spreadsheet", taskId: r2.id }]);
    expect(v2.files[0].path).toBe(join(folder, "marina-cafes.csv"));
    const recommendation = v2.entries.find((e: any) => e.kind === "recommendation");

    // ---- 3. Writer: sees the handover addressed to it, the file and all findings; reads the file with its normal (read) file action; corrects the recommendation
    let writerSaw = "";
    t.provider.script.push(
      async () => {
        writerSaw = userMsg();
        return reply(act("documents", "summarize_data", { path: "marina-cafes.csv" }));
      },
      async () => {
        const feedback = sentToModel().at(-1)!.content;
        expect(feedback).toMatch(/2 data row\(s\)[\s\S]*sum 195000/); // the real file the analyst produced, read by the writer
        return reply([
          "Brief: open in Dubai Marina; yearly fixed costs about AED 195,000.",
          ws({ kind: "recommendation", replaces: recommendation.ref, title: "Open in Marina (with costs)", text: "Open in Dubai Marina; fixed costs about AED 195,000 per year (licence + rent)." }),
          ws({ kind: "progress", title: "Brief written", text: "The owner's brief is complete." }),
        ].join("\n"));
      },
    );
    const r3 = await runTask(writer.id, "Write the owner's brief for the Marina cafe.", project.id, true);
    expect(r3.status).toBe("completed");
    expect(writerSaw).toMatch(/Handed over to you:\n\[W-[0-9a-f]{8}\] HANDOVER by Analyst: Write the brief/);
    // the CSV named in the handover was READ for the Writer by the platform, with the Writer's own read permission
    expect(writerSaw).toMatch(/REQUIRED FILES:\n=== marina-cafes\.csv \(by Analyst; read by the platform with your read permission; [^)]*marina-cafes\.csv\) ===\nItem,AED per year\nLicence,15000\nRent,180000/);
    expect(writerSaw).toContain(join(folder, "marina-cafes.csv"));
    expect(writerSaw).toContain("Cafe licence fee");
    expect(writerSaw).toContain("Open in Marina");

    // ---- the record: who did what, traceable, nothing copied by hand
    const v3 = await view(project.id);
    const old = v3.entries.find((e: any) => e.id === recommendation.id);
    const fresh = v3.entries.find((e: any) => e.title === "Open in Marina (with costs)");
    expect(old.replacedBy).toBe(fresh.id); // the old entry stays in the record
    expect(fresh).toMatchObject({ replaces: recommendation.id, authorName: "Writer", taskId: r3.id });
    expect(v3.contributions.map((c: any) => [c.name, c.entries, c.files, c.tasksCompleted]).sort()).toEqual([
      ["Analyst", 2, 1, 1],
      ["Researcher", 3, 0, 1],
      ["Writer", 2, 0, 1],
    ]);
    expect(v3.activity.map((a: any) => a.kind)).toEqual(expect.arrayContaining(["entry.fact", "entry.handover", "file.created", "task.completed", "entry.progress"]));
    expect((await events(r3.id)).filter((e: any) => e.kind === "workspace_published")).toHaveLength(2);
    const audit = ((await t.call("GET", "/api/audit?limit=200")).body.events as any[]).filter((e) => e.kind === "workspace.published");
    expect(audit).toHaveLength(7);

    // ---- 4. restart: a new app on the same database file. The workspace and the task context are still there.
    await t.app.close();
    await start({ dbPath });
    let afterRestart = "";
    t.provider.script.push(async () => {
      afterRestart = userMsg();
      return reply("Nothing new to add.");
    });
    const r4 = await runTask(researcher.id, "Check whether the Marina recommendation still holds.", project.id);
    expect(r4.status).toBe("completed");
    expect(afterRestart).toContain("Open in Marina (with costs)");
    expect(afterRestart).not.toMatch(/\] (RECOMMENDATION|recommendation)[^\n]* by Analyst/); // replaced entries are not offered again
    expect(afterRestart).toContain("Cafe licence fee");
    expect(afterRestart).toContain(join(folder, "marina-cafes.csv"));
    expect(afterRestart).toMatch(/Earlier finished work:/);
    expect((await view(project.id)).entries).toHaveLength(7);
    expect(readFileSync(join(folder, "marina-cafes.csv"), "utf8")).toContain("Licence");
  }, 20_000);
});

describe("membership and isolation", () => {
  beforeEach(async () => start());

  it("a task outside any project gets no workspace and cannot publish; another project's entries stay invisible", async () => {
    const a = await mkBot("Alpha");
    const p1 = await mkProject("One");
    const p2 = await mkProject("Two");
    t.provider.script.push(async () => reply(ws({ kind: "finding", title: "Secret plan of project one", text: "Only for project one." })));
    await runTask(a.id, "Research for project one", p1.id);
    let saw = "";
    t.provider.script.push(async () => {
      saw = userMsg();
      return reply(ws({ kind: "finding", title: "Loose", text: "No project here." }));
    });
    const loose = await runTask(a.id, "Research without a project");
    expect(saw).not.toContain("WORKSPACE");
    expect(systemMsg()).not.toContain("```workspace");
    expect((await events(loose.id)).find((e: any) => e.kind === "workspace_rejected")?.detail).toMatch(/not part of a project/);
    t.provider.script.push(async () => {
      saw = userMsg();
      return reply("ok");
    });
    await runTask(a.id, "Research for project two", p2.id);
    expect(saw).toContain('WORKSPACE of project "Two"');
    expect(saw).not.toContain("Secret plan of project one");
    expect((await view(p2.id)).entries).toHaveLength(0);
    expect((await view(p1.id)).entries).toHaveLength(1);
  });

  it("a teammate's task handed down inside a project chain shares the workspace; the lead cannot re-publish the teammate's entry as its own", async () => {
    const lead = await mkBot("Lead");
    const mate = await mkBot("Mate");
    await t.call("PUT", `/api/bots/${lead.id}/delegation`, { targetBotIds: [mate.id] });
    const p = await mkProject("Chain");
    let mateSaw = "";
    let leadFeedback = "";
    t.provider.script.push(
      async () => reply(`${fence}delegate\n${JSON.stringify({ to: "Mate", task: "Find the opening hours." })}\n${fence}`),
      async () => {
        mateSaw = userMsg();
        return reply(`Hours found.\n${ws({ kind: "finding", title: "Opening hours", text: "7am to 11pm." })}`);
      },
      async () => {
        leadFeedback = sentToModel().at(-1)!.content;
        return reply("Final: 7am to 11pm.");
      },
    );
    await runTask(lead.id, "Plan the cafe", p.id);
    expect(mateSaw).toContain('WORKSPACE of project "Chain"');
    expect(leadFeedback).toContain("Hours found.");
    expect(leadFeedback).not.toContain("```workspace");
    expect((await view(p.id)).entries.map((e: any) => [e.title, e.authorName])).toEqual([["Opening hours", "Mate"]]);
  });

  it("refuses to start a task in an archived or unknown project", async () => {
    const a = await mkBot("Alpha");
    const p = await mkProject("Old");
    await t.call("PUT", `/api/projects/${p.id}/archive`, { on: true });
    expect((await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "x", projectId: p.id })).status).toBe(409);
    expect((await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "x", projectId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await t.call("GET", "/api/tasks")).body.tasks).toHaveLength(0);
  });
});

describe("what is accepted, and the owner's controls", () => {
  beforeEach(async () => start());

  it("checks every entry: kinds, limits, secrets, handover targets, replacements, at most three per task", async () => {
    const a = await mkBot("Alpha");
    const p = await mkProject("Rules");
    const r = await (async () => {
      t.provider.script.push(async () =>
        reply([
          ws({ kind: "rumour", title: "x", text: "y" }),
          `${fence}workspace\nnot json\n${fence}`,
          ws({ kind: "note", title: "Key", text: "the key is ghp_abcdefghijklmnopqrstuvwxyz0123456789" }),
          ws({ kind: "handover", for: "Nobody", title: "h", text: "h" }),
          ws({ kind: "note", replaces: "W-ffffffff", title: "r", text: "r" }),
          ws({ kind: "note", title: "One", text: "1" }),
          ws({ kind: "note", title: "Two", text: "2" }),
          ws({ kind: "note", title: "Three", text: "3" }),
          ws({ kind: "note", title: "Four", text: "4" }),
        ].join("\n")),
      );
      return runTask(a.id, "Publish things", p.id);
    })();
    const reasons = (await events(r.id)).filter((e: any) => e.kind === "workspace_rejected").map((e: any) => JSON.parse(e.detail).reason).join(" | ");
    expect(reasons).toMatch(/"kind" must be one of/);
    expect(reasons).toMatch(/not valid JSON/);
    expect(reasons).toMatch(/key, token or password/);
    expect(reasons).toMatch(/no single agent is named "Nobody"/);
    expect(reasons).toMatch(/W-ffffffff, which is not an entry/);
    expect(reasons).toMatch(/at most 3 entries per task/);
    const entries = (await view(p.id)).entries;
    expect(entries.map((e: any) => e.title).sort()).toEqual(["One", "Three", "Two"]);
  });

  it("a re-run that publishes the same entry again does not create a copy (found by the real-browser run)", async () => {
    const a = await mkBot("Alpha");
    const p = await mkProject("Rerun");
    const same = ws({ kind: "recommendation", title: "Open in Marina", text: "Open in Dubai Marina." });
    t.provider.script.push(async () => reply(same));
    await runTask(a.id, "first try", p.id);
    t.provider.script.push(async () => reply(`${same}\n${ws({ kind: "recommendation", title: "Open in Marina", text: "Open in Dubai Marina, near the tram." })}`));
    const second = await runTask(a.id, "second try", p.id);
    expect((await view(p.id)).entries.map((e: any) => e.text)).toEqual(["Open in Dubai Marina, near the tram.", "Open in Dubai Marina."]);
    expect((await events(second.id)).find((e: any) => e.kind === "workspace_rejected")?.detail).toMatch(/already in the workspace \(W-[0-9a-f]{8}\)/);
  });

  it("keeps workspace entries out of the general knowledge store paths (one memory database, separate view)", async () => {
    const a = await mkBot("Alpha");
    await t.call("PUT", `/api/bots/${a.id}/memory`, { useShared: true });
    const p = await mkProject("Mem");
    t.provider.script.push(async () => reply(ws({ kind: "finding", title: "Harbour prices", text: "Harbour rents are high." })));
    await runTask(a.id, "find", p.id);
    const entry = (await view(p.id)).entries[0];
    expect((await t.call("GET", "/api/memory?scope=shared")).body.notes).toHaveLength(0);
    expect((await t.call("PATCH", `/api/memory/${entry.id}`, { title: "edited" })).status).toBe(409);
    expect((await t.call("POST", `/api/memory/${entry.id}/archive`)).status).toBe(409);
    // the owner's own shared notes are unaffected and still counted / listed as before
    expect((await t.call("POST", "/api/memory", { scope: "shared", title: "Owner note", content: "Harbour is busy" })).status).toBe(201);
    expect(((await t.call("GET", "/api/memory?scope=shared")).body.notes as any[]).map((n) => n.title)).toEqual(["Owner note"]);
  });

  it("the owner can mark an entry as checked and withdraw it; withdrawn entries no longer reach agents but stay in the record", async () => {
    const a = await mkBot("Alpha");
    const p = await mkProject("Owner");
    t.provider.script.push(async () => reply([ws({ kind: "fact", title: "Rent", text: "Rent is 180k.", source: "Agent listing" }), ws({ kind: "assumption", title: "Demand", text: "Demand is rising." })].join("\n")));
    await runTask(a.id, "find", p.id);
    const [demand, rent] = (await view(p.id)).entries;
    expect((await t.call("POST", `/api/projects/${p.id}/workspace/entries/${rent.id}/check`)).body.entry.checkedByOwner).toBe(true);
    expect((await t.call("PUT", `/api/projects/${p.id}/workspace/entries/${demand.id}/withdrawn`, { on: true })).body.entry.withdrawn).toBe(true);
    expect((await t.call("POST", `/api/projects/${p.id}/workspace/entries/00000000-0000-4000-8000-000000000000/check`)).status).toBe(404);
    let saw = "";
    t.provider.script.push(async () => {
      saw = userMsg();
      return reply("ok");
    });
    await runTask(a.id, "next", p.id);
    expect(saw).toMatch(/FACT \(agent cites a source\), checked by the owner by Alpha: Rent|fact \(checked\) by Alpha: Rent/);
    expect(saw).not.toContain("Demand is rising");
    const v = await view(p.id);
    expect(v.entries).toHaveLength(2);
    expect(v.activity.map((x: any) => x.kind)).toEqual(expect.arrayContaining(["workspace.checked", "workspace.withdrawn"]));
  });

  it("puts the most relevant entries first", async () => {
    const a = await mkBot("Alpha");
    const p = await mkProject("Rank");
    t.provider.script.push(async () => reply([ws({ kind: "finding", title: "Parking", text: "Parking is free on Fridays." }), ws({ kind: "finding", title: "Coffee beans", text: "Ethiopian beans cost 90 AED per kilo." }), ws({ kind: "finding", title: "Staff", text: "Baristas earn 4000 AED." })].join("\n")));
    await runTask(a.id, "collect", p.id);
    let saw = "";
    t.provider.script.push(async () => {
      saw = userMsg();
      return reply("ok");
    });
    await runTask(a.id, "What do coffee beans cost?", p.id);
    // only the relevant entry is sent in full; the others are one line each (their full text is one workspace.read_entries away)
    expect(/Relevant entries:\n\[W-[0-9a-f]{8}\] FINDING by Alpha: ([^\n]+)\n/.exec(saw)?.[1]).toBe("Coffee beans");
    expect(saw).toMatch(/Other entries \(one line each[^\n]*\n(\[W-[0-9a-f]{8}\] finding by Alpha: (Parking|Staff)[^\n]*\n?){2}/);
    expect(saw).toMatch(/Staff \| numbers: 4000 \| ! Unsupported estimate/); // a one-line entry keeps its numbers and warnings
    expect(saw).not.toContain("Parking is free on Fridays");
  });
});

describe("protocol", () => {
  it("parses blocks and defuses fences and control characters", () => {
    const p = parsePublications(`${ws({ kind: "FACT", title: " T ", text: "x\u0007y", source: "s" })}`);
    expect(p).toEqual([{ ok: true, kind: "fact", title: "T", text: "xy", source: "s", forName: null, replaces: null }]);
    expect(defuse("a ```action b")).toBe("a '''action b");
    expect(parsePublications(ws({ kind: "note", title: "x".repeat(101), text: "y" }))[0]).toMatchObject({ ok: false });
  });
});
