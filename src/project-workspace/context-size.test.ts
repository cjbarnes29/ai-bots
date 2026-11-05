import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { RUN2 } from "./fixtures.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MEASURES the prompt the Writer receives in the P-44 run-2 scenario (real model text from that run, replayed by a scripted fake model).
 * Prints characters and an approximate token count (characters / 4; real tokenisers differ by model, so this is an estimate) and pins a ceiling,
 * so the workspace context cannot quietly grow back.
 */
const fence = "```";
const ws = (o: Record<string, unknown>) => `${fence}workspace\n${JSON.stringify(o)}\n${fence}`;
const act = (connector: string, action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 30, outputTokens: 15 });

let t: TestApp;
let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "awp-ctx-"));
  mkdirSync(join(dir, "files"));
  t = await createTestApp({ includePc: true, includeMemory: true, includeWorkspace: true } as any);
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
});
afterEach(async () => {
  await t.app.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

export async function run2Scenario(tt: TestApp, folder: string): Promise<{ writerFirst: { role: string; content: string }[]; analystFirst: { role: string; content: string }[] }> {
  const ref = await setupGeminiModel(tt);
  await tt.call("POST", "/api/pc/workspaces", { path: folder });
  const mk = async (name: string) => (await switchOn(tt.call, await tt.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;
  const researcher = await mk("Researcher");
  const analyst = await mk("Analyst");
  const writer = await mk("Writer");
  await tt.call("PUT", `/api/bots/${analyst.id}/pc`, { grants: ["modify"] });
  await tt.call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["read"] });
  const p = (await tt.call("POST", "/api/projects", { name: "Dubai cafe market" })).body.project;
  const run = async (botId: string, instruction: string) => {
    const s = await tt.call("POST", `/api/bots/${botId}/tasks`, { instruction, projectId: p.id });
    return vi.waitFor(async () => {
      const x = (await tt.call("GET", `/api/tasks/${s.body.task.id}`)).body.task;
      expect(["completed", "failed"]).toContain(x.status);
      return x;
    }, { timeout: 5000, interval: 10 });
  };
  tt.provider.script.push(async () => reply([RUN2.researcher.result, ...RUN2.researcher.entries.map((e: any) => ws({ kind: e.kind, title: e.title, text: e.text, source: e.source }))].join("\n")));
  await run(researcher.id, "Research opening a specialty cafe in Dubai Marina: typical yearly licence cost, yearly rent for a small unit, and how busy the area is.");
  let analystFirst: any[] = [];
  tt.provider.script.push(
    async () => {
      analystFirst = tt.provider.calls.at(-1)!.messages as any[];
      return reply([act("documents", "create_spreadsheet", { path: "marina-costs.csv", format: "csv", sheets: [{ name: "Costs", header: ["Item", "AED per year"], rows: [["Rent", 1000000], ["Licence", 25000]] }] }), ...RUN2.analyst.entries.map((e: any) => ws(e.kind === "handover" ? { kind: e.kind, title: e.title, text: e.text, for: "Writer" } : { kind: e.kind, title: e.title, text: e.text }))].join("\n"));
    },
    async () => reply(RUN2.analyst.result),
  );
  await run(analyst.id, "Using the workspace, estimate the yearly fixed costs (licence + rent). Create the file marina-costs.csv and hand the writing over to Writer.");
  const pending = (await tt.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
  for (const a of pending) await tt.call("POST", `/api/approvals/${a.id}/approve`);
  let writerFirst: any[] = [];
  tt.provider.script.push(async () => {
    writerFirst = tt.provider.calls.at(-1)!.messages as any[];
    return reply("Brief written.");
  });
  await run(writer.id, "Write the owner's brief from the workspace: read marina-costs.csv, state the yearly fixed cost and the final recommendation.");
  return { writerFirst, analystFirst };
}

const size = (msgs: { role: string; content: string }[]) => {
  const sys = msgs.filter((m) => m.role === "system").map((m) => m.content).join("");
  const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("");
  return { systemChars: sys.length, userChars: user.length, approxTokens: Math.round((sys.length + user.length) / 4) };
};

describe("workspace context size (measured on the P-44 run-2 text)", () => {
  it("prints the Writer's and Analyst's first prompt sizes and keeps them under a ceiling", async () => {
    const { writerFirst, analystFirst } = await run2Scenario(t, join(dir, "files"));
    const w = size(writerFirst);
    const a = size(analystFirst);
    // The workspace's OWN share: its instruction block in the system message and the WORKSPACE section of the task message.
    const share = (msgs: { role: string; content: string }[]) => {
      const sys = msgs.find((m) => m.role === "system")!.content;
      const from = sys.indexOf('Project workspace "');
      const to = sys.indexOf("\n\nOutside actions", from);
      const addendum = from < 0 ? 0 : (to < 0 ? sys.length : to) - from;
      const user = msgs.find((m) => m.role === "user")!.content;
      const ctx = user.includes("\n---\n") ? user.length - user.indexOf("\n---\n") : 0;
      return { addendumChars: addendum, contextChars: ctx, approxTokens: Math.round((addendum + ctx) / 4) };
    };
    const all = t.provider.calls.map((c) => c.messages as { role: string; content: string }[]).filter((m) => !String(m.at(-1)?.content).startsWith("Reply with"));
    const total = all.reduce((n, m) => n + m.reduce((k, x) => k + String(x.content).length, 0), 0);
    console.log(`CONTEXT-SIZE analyst first prompt: ${JSON.stringify(a)} workspace share ${JSON.stringify(share(analystFirst))}`);
    console.log(`CONTEXT-SIZE writer first prompt: ${JSON.stringify(w)} workspace share ${JSON.stringify(share(writerFirst))}`);
    console.log(`CONTEXT-SIZE whole workflow: ${all.length} model calls, ${total} prompt characters, about ${Math.round(total / 4)} tokens`);
    if (process.env.SHOW_PROMPT) console.log("PROMPT-DUMP", JSON.stringify(writerFirst, null, 1));
    // Ceilings measured on this text after the 2026-11-05 optimisation (with a little room): the workspace may not quietly grow back.
    expect(share(writerFirst).approxTokens).toBeLessThan(1000);
    expect(share(analystFirst).approxTokens).toBeLessThan(700);
    expect(writerFirst.find((m) => m.role === "user")!.content).toContain("Rent,1000000"); // the Writer received the CSV contents
  });
});
