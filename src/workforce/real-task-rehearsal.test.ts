import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditError, type HttpResponse } from "../business/audit.js";
import type { TransportSpec } from "../business/netfetch.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REHEARSAL of the real-world task (research businesses, inspect their websites, Excel, PDF, email draft with both files), run entirely with
 * SIMULATED parts: a scripted fake model, a fake map service and fake websites. It proves the PLUMBING end to end (Manager plan, delegation to two bots,
 * a read through the business connector, approvals for every file, real files on disk, an email draft carrying the real attachments, nothing sent).
 * It says NOTHING about how a real model performs: that needs the real run (docs/REAL-TASK.md), which is a separate, owner-approved step.
 */
const fence = "```";
const act = (connector: string, action: string, args: Record<string, unknown> = {}) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 40, outputTokens: 20 });

const SITE = (name: string) => `<!doctype html><html lang="en"><head><title>${name} in Dubai</title><meta name="description" content="${name}: friendly local service in Dubai with clear prices, opening hours and a contact form for bookings."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>${name}</h1>${"<p>We serve customers across Dubai every day of the week. </p>".repeat(30)}<a href="mailto:hello@example.com">Contact</a> © ${new Date().getFullYear()}</body></html>`;
const NAMES = ["Palm Fitness", "Marina Yoga", "Creek Dental", "Souk Bakery", "Jumeirah Salon", "Desert Cycles", "Bay Pharmacy", "Gold Tailors", "Zabeel Optics", "Oasis Cafe"];
const MAP = { elements: NAMES.map((n, i) => ({ type: "node", id: i + 1, lat: 25.2, lon: 55.2, tags: { name: n, shop: "yes", website: `https://site${i + 1}.example.ae`, phone: `+971 4 000 00${String(i).padStart(2, "0")}`, "addr:city": "Dubai" } })) };

function fakeNet() {
  const calls = { post: 0, hosts: [] as string[] };
  return {
    calls,
    net: {
      post: async () => (calls.post++, { status: 200, text: JSON.stringify(MAP) }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      sleep: async () => undefined,
      transport: async (spec: TransportSpec): Promise<HttpResponse> => {
        calls.hosts.push(spec.hostname);
        const i = Number(/site(\d+)\./.exec(spec.hostname)?.[1] ?? 0);
        if (i === 7) throw new AuditError("timed_out", "slow"); // one site is down: a recoverable error that must show up honestly
        return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(SITE(NAMES[i - 1] ?? "Unknown")), ms: 200, tls: { authorized: true, validTo: "Jan  1 00:00:00 2028 GMT" } };
      },
    },
  };
}

describe("rehearsal: Manager -> researcher -> writer -> approvals -> real files -> email draft (SIMULATED model, map and websites)", () => {
  let t: TestApp;
  let dir: string;
  let ws: string;
  let fx: ReturnType<typeof fakeNet>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    fetchSpy = vi.fn(async () => {
      throw new Error("no real network in the rehearsal");
    });
    vi.stubGlobal("fetch", fetchSpy);
    dir = mkdtempSync(join(tmpdir(), "awp-rehearsal-"));
    ws = join(dir, "workspace");
    mkdirSync(ws, { recursive: true });
    fx = fakeNet();
    t = await createTestApp({ connectors: [], includePc: true, includeBusiness: true, businessDir: join(dir, "leads"), businessNet: fx.net });
    await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
    await t.call("POST", "/api/pc/workspaces", { path: ws });
  });
  afterEach(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("completes the whole task, with every file approved by the owner and nothing sent", async () => {
    const ref = await setupGeminiModel(t);
    const mk = async (name: string, role: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, role, model: ref }))).body.bot as any;
    const researcher = await mk("Researcher", "Finds and checks businesses");
    const writer = await mk("Writer", "Produces files and email drafts");
    await t.call("PUT", `/api/bots/${researcher.id}/permissions/browser`, { readEnabled: true }); // web reading, the owner's per-bot switch
    await t.call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["modify"] });
    await t.call("PUT", "/api/business/external", { enabled: true }); // the owner's global lock for outside requests
    await t.call("PUT", "/api/manager/settings", { allowedBots: [researcher.id, writer.id] });

    const lastText = () => JSON.stringify(t.provider.calls.at(-1)!.messages);
    const field = (re: RegExp) => re.exec(lastText())?.[1] ?? "";
    // Dynamic replies: each reads what the platform actually sent to the model, as a real model would.
    const seq: (() => Promise<any>)[] = [
      // 1. the Manager's plan
      async () => reply(JSON.stringify({ mode: "plan", steps: [
        { id: "s1", title: "Find 10 businesses in Dubai", specialist: researcher.id, instruction: "Look up 10 businesses in Dubai in the public map data.", dependsOn: [] },
        { id: "s2", title: "Inspect their websites", specialist: researcher.id, instruction: "Check the websites of the staged batch and report what you found.", dependsOn: ["s1"] },
        { id: "s3", title: "Produce Excel, PDF and an email draft", specialist: writer.id, instruction: "Create leads.xlsx, report.pdf and an email draft with both attached.", dependsOn: ["s2"] },
      ] })),
      // 2-3. s1: asks the map service, then reports
      async () => reply(act("business", "find_businesses", { market: "AE", region: "AE-DU", category: "all", limit: 10 })),
      async () => reply(`Found the businesses. ${field(/(Batch B-[0-9a-f]{8})/)}`),
      // 4-5. s2: audits that batch (id taken from the earlier step's output the Manager handed over), then reports
      async () => reply(act("business", "audit_batch", { batchId: field(/(B-[0-9a-f]{8})/) })),
      async () => reply("Audit finished: nine sites reachable, one timed out. Details are in the audit lines."),
      // 6-7. s3: three file actions (all wait for the owner), then an honest report
      async () => reply([
        act("documents", "create_spreadsheet", { path: "dubai-leads.xlsx", format: "xlsx", sheets: [{ name: "Businesses", header: ["Business", "Website", "Reachable"], rows: NAMES.map((n, i) => [n, `https://site${i + 1}.example.ae`, i === 6 ? "no (timed out)" : "yes"]) }] }),
        act("documents", "create_document", { path: "dubai-report.pdf", format: "pdf", title: "Dubai business review", blocks: [{ type: "heading", text: "Summary" }, { type: "paragraph", text: "Ten businesses were looked up and nine websites could be reached." }, { type: "table", header: ["Business", "Reachable"], rows: NAMES.map((n, i) => [n, i === 6 ? "no" : "yes"]) }] }),
        act("documents", "create_email_draft", { path: "email-to-owner.eml", to: ["owner@example.com"], subject: "Dubai business review", body: "Hello,\n\nthe review is attached as Excel and PDF.", attachments: ["dubai-leads.xlsx", "dubai-report.pdf"] }),
      ].join("\n")),
      async () => reply("The three files and the email draft are waiting for the owner's approval; none of them exists yet."),
      // 8. the Manager's review and the final answer
      async () => reply(JSON.stringify({ verdict: "pass", issues: "", fixSteps: [], final: "Done: 10 businesses researched, 9 websites inspected (1 unreachable), Excel, PDF and an email draft are ready for approval." })),
    ];
    t.provider.script.push(...seq);

    const started = await t.call("POST", "/api/manager/runs", { goal: "Research 10 businesses in Dubai, inspect their websites, organize findings in Excel, generate a PDF report and prepare an email with the files attached." });
    expect(started.status).toBe(202);
    const runId = started.body.run.id;
    const run = await vi.waitFor(async () => {
      const r = (await t.call("GET", `/api/manager/runs/${runId}`)).body.run;
      expect(["completed", "failed", "budget_exhausted"]).toContain(r.status);
      return r;
    }, { timeout: 8000, interval: 25 });

    // ---- the Manager delegated, coordinated and reviewed
    expect(run.status).toBe("completed");
    expect(run.steps.map((s: any) => [s.id, s.specialistName, s.status])).toEqual([["s1", "Researcher", "completed"], ["s2", "Researcher", "completed"], ["s3", "Writer", "completed"]]);
    expect(run.result).toMatch(/10 businesses researched/);
    // each specialist step was a normal task of that bot (one task registry)
    const tasks = (await t.call("GET", "/api/tasks")).body.tasks as any[];
    expect(tasks.filter((x) => x.assigneeBotId === researcher.id)).toHaveLength(2);
    expect(tasks.filter((x) => x.assigneeBotId === writer.id)).toHaveLength(1);
    // the dependency output was handed on: the audit step was told the batch the first step produced
    expect(JSON.stringify(t.provider.calls[3]!.messages)).toMatch(/B-[0-9a-f]{8}/);

    // ---- outside requests really made (to the FAKES): exactly one map search and ten website checks; the reads need no approval
    expect(fx.calls.post).toBe(1);
    expect(fx.calls.hosts).toHaveLength(10);
    expect(new Set(fx.calls.hosts).size).toBe(10);
    const audit = (await t.call("GET", "/api/audit?limit=200")).body.events as any[];
    expect(audit.filter((e) => e.kind === "business.external_request")).toHaveLength(11);

    // ---- nothing exists until the owner approves; the owner approves the files first, then the draft that needs them
    for (const f of ["dubai-leads.xlsx", "dubai-report.pdf", "email-to-owner.eml"]) expect(existsSync(join(ws, f))).toBe(false);
    const pending = ((await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[]);
    expect(pending.map((p) => p.action).sort()).toEqual(["create_document", "create_email_draft", "create_spreadsheet"]);
    const order = ["create_spreadsheet", "create_document", "create_email_draft"];
    for (const action of order) {
      const a = pending.find((p) => p.action === action);
      expect((await t.call("POST", `/api/approvals/${a.id}/approve`)).body.approval.status).toBe("executed");
    }

    // ---- real files on disk
    const xlsx = readFileSync(join(ws, "dubai-leads.xlsx"));
    const pdf = readFileSync(join(ws, "dubai-report.pdf"));
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const eml = readFileSync(join(ws, "email-to-owner.eml")).toString("utf8");
    expect(eml).toContain("Subject: Dubai business review");
    expect(eml).toContain('filename="dubai-leads.xlsx"');
    expect(eml).toContain('filename="dubai-report.pdf"');
    expect(eml).toContain(xlsx.toString("base64").slice(0, 60)); // the attachment carries the real file
    // ---- nothing was sent anywhere
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(((await t.call("GET", "/api/approvals")).body.approvals as any[]).some((a) => a.connector === "gmail")).toBe(false);
    // ---- usage was tracked for every model call
    const usage = (await t.call("GET", "/api/llm/usage")).body;
    expect(JSON.stringify(usage)).toMatch(/gemini/);
    expect(t.provider.calls.length).toBe(8);
  });
});
