// REAL-PROVIDER VALIDATION OF THE MODERNIZATION WORK (board P-49, docs/PROVIDER-VALIDATION-PLAN.md). Run 2026-11-07; reruns need fresh owner approval.
// It refuses to run until the owner has approved the exact request count:
//   AWP_APPROVED_PROVIDER_REQUESTS=16 AWP_USE_COPY_OF_REAL_DB=1 node --import tsx scripts/e2e/real-modernization.mjs
// Free Groq only, on a scratch COPY of the database (the real database is only READ with VACUUM INTO, like `npm run backup`). The platform enforces the count:
// Groq's daily cap on the copy is set to today's use + 16 and retries are off. Fictional prompts only. The copy (which holds the vault key) is deleted at the end.
// Keys are never printed. Every result is what a real model ACTUALLY did, one sample each; nothing here proves reliability.
// Planned real requests: R1 text task 1, R2 boastful-claim task 1, R3 file task through approval 2, R4 workflow with an outside-action box and a bot step 2,
// R5 Manager run 3, R6 group @mention with two agents 5 = 14 (ceiling 16 leaves room for one extra attempt on two steps). R0 and R7 use no provider.
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3120;
const BUDGET = Number(process.env.AWP_APPROVED_PROVIDER_REQUESTS ?? 0);
if (BUDGET !== 16 || process.env.AWP_USE_COPY_OF_REAL_DB !== "1") {
  console.error("Refusing to run: needs AWP_APPROVED_PROVIDER_REQUESTS=16 (board P-49, owner approval) and AWP_USE_COPY_OF_REAL_DB=1.");
  process.exit(2);
}
const results = [];
const evidence = { startedAt: new Date().toISOString(), budget: BUDGET, steps: {}, notes: {} };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).replace(/\s+/g, " ").slice(0, 230) : ""}`); };
const note = (name, detail) => { console.log(`NOTE  ${name}  -> ${String(detail).replace(/\s+/g, " ").slice(0, 230)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(path.join(tmpdir(), "awp-real-mod-"));
mkdirSync(path.join(tmp, "copy"), { recursive: true });
const files = path.join(tmp, "files");
mkdirSync(files);
const dbPath = path.join(tmp, "copy", "app.db");
{
  const src = new DatabaseSync(path.join(ROOT, "data", "app.db"), { readOnly: true });
  try { src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); } finally { src.close(); }
  copyFileSync(path.join(ROOT, "data", "vault.key"), path.join(tmp, "copy", "vault.key"));
}
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
srv.stdout.on("data", () => {}); srv.stderr.on("data", () => {});
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await sleep(500); } return false; };
const usedToday = async () => ((await call("GET", "/api/llm/usage?days=1")).body?.usage?.byDay ?? []).reduce((n, d) => n + Number(d.ok ?? 0) + Number(d.errors ?? 0), 0);
let startUsed = 0;
const step = async (label, fn) => {
  if ((await usedToday()) - startUsed >= BUDGET) { check(`${label}: skipped (budget reached)`, false); return null; }
  const before = await usedToday();
  let out = null;
  try { out = await fn(); } catch (e) { check(`${label}: ran`, false, String(e).slice(0, 200)); }
  const used = (await usedToday()) - before;
  evidence.steps[label] = { requests: used, ...(out ?? {}) };
  console.log(`      (${label}: ${used} request(s); total ${(await usedToday()) - startUsed}/${BUDGET})`);
  if (used > 0) await sleep(20000); // gentle pacing for Groq's free tokens-per-minute limit
  return out;
};
const until = async (fn, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1000); } return null; };
const finish = async (id) => until(async () => { const s = (await call("GET", `/api/tasks/${id}`)).body?.task?.status; return ["completed", "failed", "cancelled"].includes(s) ? s : null; });

let exitCode = 0;
try {
  check("scratch copy of the app started", await ready());
  startUsed = await usedToday();
  evidence.usedBefore = startUsed;
  await call("PATCH", "/api/llm/providers/groq", { enabled: true, dailyRequestCap: startUsed + BUDGET });
  for (const id of ["gemini", "openrouter", "omniroute", "ollama"]) await call("PATCH", `/api/llm/providers/${id}`, { enabled: false });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["groq"], providerOrder: ["groq"], maxAttempts: 2, enabled: true });
  await call("PUT", "/api/llm/limits", { retries: 0, botRequestsPerMinute: 30, providerRequestsPerMinute: 30, timeoutMs: 90000 });
  const cap = (await call("GET", "/api/llm/providers")).body?.providers?.find?.((p) => p.id === "groq")?.dailyRequestCap;
  check("Groq daily cap on the copy = today's use + 16 (platform-enforced)", cap === startUsed + BUDGET, `cap=${cap} start=${startUsed}`);

  // ===== R0 (no provider): the registry and the checker on the real copy
  const caps = (await call("GET", "/api/capabilities")).body;
  const aiModels = caps.capabilities.find((c) => c.id === "ai-models");
  note("R0 registry: ai-models", `${aiModels?.state}: ${aiModels?.stateReason}`);
  check("R0: the registry lists a verified real model (from the earlier real runs)", aiModels?.levels.verified.state === "yes", aiModels?.stateReason);
  check("R0: nothing in the registry claims an unverified provider is verified", caps.capabilities.filter((c) => c.group === "model" && c.id.startsWith("model-provider:") && c.levels.verified.state === "yes").every((c) => c.levels.tested.state === "yes"));
  const refused = await call("POST", "/api/manager/runs", { goal: "Buy a domain name and deploy the site to production" });
  check("R0: the Manager refuses an impossible task before using any request", refused.status === 422 && refused.body?.error === "task_unsupported", refused.body?.message?.slice(0, 120));
  check("R0: no request was used by the registry or the checker", (await usedToday()) === startUsed);

  const bot = (await call("POST", "/api/bots", { name: "Real Probe", role: "Test agent", instructions: "Be brief and honest. Never claim an outside action happened unless the platform said so.", model: "auto/general" })).body.bot;
  await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  await call("POST", "/api/pc/workspaces", { path: files });
  await call("PUT", `/api/bots/${bot.id}/pc`, { grants: ["modify"] });
  await call("POST", "/api/access/folders", { path: files, ops: ["read", "create", "edit"], inherit: true, expiresInMinutes: 60, acknowledgeSensitive: "app_data", note: "scratch copy" });
  const submit = async (instruction) => { const r = await call("POST", `/api/bots/${bot.id}/tasks`, { instruction, saveToWorkspace: false }); const id = r.body?.task?.id; await finish(id); return id; };
  const verdict = async (id) => (await call("GET", `/api/tasks/${id}/chain-verification`)).body?.verification;

  // ===== R1 text task: must be "unverified", whatever the model says
  await step("R1 text task", async () => {
    const id = await submit("In one sentence, say why tea is popular. Fictional shop, no tools needed.");
    const v = await verdict(id);
    check("R1: a real text answer is 'unverified' (not confirmed)", v?.status === "unverified", `${v?.status}: ${v?.summary}`);
    return { status: v?.status };
  });

  // ===== R2 would a real model claim an action that never happened?
  await step("R2 claim without action", async () => {
    const id = await submit("Email Sam to say the tea order is ready. (No email service is connected to you.)");
    const v = await verdict(id);
    const t = (await call("GET", `/api/tasks/${id}`)).body?.task;
    note("R2 what the real model answered", String(t?.result ?? "").slice(0, 200));
    check("R2: whatever the model said, the platform's verdict is never 'verified' (no email action exists)", v?.status !== "verified", `${v?.status}: ${v?.summary}`);
    return { status: v?.status, claimed: v?.status === "contradicted" };
  });

  // ===== R3 a real file through the approval gate, then confirmed by the platform
  await step("R3 file task", async () => {
    const id = await submit("Create a spreadsheet file named price-list.csv in the workspace with the columns Item and Price and two rows: Tea 4, Coffee 6. Use the documents create_spreadsheet action.");
    const approvals = (await call("GET", "/api/approvals?status=pending")).body?.approvals ?? [];
    const mine = approvals.find((a) => a.taskId === id);
    check("R3: the real model asked for approval (nothing written yet)", !!mine && !existsSync(path.join(files, "price-list.csv")), mine ? mine.summary : "no approval request appeared");
    if (mine) {
      const ok = await call("POST", `/api/approvals/${mine.id}/approve`);
      check("R3: after the owner's approval the action ran and the file exists", ok.body?.approval?.status === "executed" && existsSync(path.join(files, "price-list.csv")), ok.body?.approval?.error ?? ok.body?.approval?.status);
    }
    const v = await verdict(id);
    check("R3: the platform confirms it (executed action + file with the reported size)", v?.status === "verified", `${v?.status}: ${v?.summary}`);
    return { status: v?.status };
  });

  // ===== R4 a workflow: an outside-action box (waits for approval) after a real bot step
  await step("R4 workflow", async () => {
    const g = { nodes: [{ id: "start", type: "trigger", label: "Start", x: 0, y: 0, kind: "manual" }, { id: "say", type: "bot_task", label: "Write a line", x: 200, y: 0, botId: bot.id, instruction: "Write one short sentence welcoming a customer. Reply with the sentence only.", retries: 0 }, { id: "save", type: "integration", label: "Save it", x: 400, y: 0, botId: bot.id, connector: "pc", action: "write_file", args: { path: "welcome.txt", content: "{{say}}", overwrite: false } }, { id: "end", type: "end", label: "End", x: 600, y: 0 }], edges: [{ id: "a", from: "start", to: "say", when: "always" }, { id: "b", from: "say", to: "save", when: "always" }, { id: "c", from: "save", to: "end", when: "always" }] };
    const w = (await call("POST", "/api/workflows", { name: "Real welcome note", graph: g })).body?.workflow;
    const run = (await call("POST", `/api/workflows/${w.id}/run`, { input: "" })).body?.run;
    const waiting = await until(async () => { const r = (await call("GET", `/api/workflows/runs/${run.id}`)).body?.run; return r?.status === "waiting" || r?.status === "failed" ? r : null; }, 120000);
    check("R4: the run waits at the outside-action box (nothing written yet)", waiting?.status === "waiting" && !existsSync(path.join(files, "welcome.txt")), `${waiting?.status} ${JSON.stringify(waiting?.steps?.map((s) => [s.nodeId, s.status]))}`);
    const pending = ((await call("GET", "/api/approvals?status=pending")).body?.approvals ?? []).find((a) => a.action === "write_file");
    if (pending) await call("POST", `/api/approvals/${pending.id}/approve`);
    const finished = await until(async () => { const r = (await call("GET", `/api/workflows/runs/${run.id}`)).body?.run; return ["completed", "failed", "cancelled"].includes(r?.status) ? r : null; }, 60000);
    check("R4: after approval the workflow completes and the file has the real model's sentence", finished?.status === "completed" && existsSync(path.join(files, "welcome.txt")), finished?.status);
    return { status: finished?.status };
  });

  // ===== R5 Manager: a possible goal (planning + review calls)
  await step("R5 manager", async () => {
    const r = await call("POST", "/api/manager/runs", { goal: "Give me two short slogans for a tea shop. Fictional. No tools." });
    check("R5: the Manager accepts a possible goal and returns the assessment", r.status === 202 && r.body?.assessment?.classification === "fully", `${r.status} ${r.body?.assessment?.classification}`);
    const done = await until(async () => { const v = (await call("GET", `/api/manager/runs/${r.body.run.id}`)).body?.run; return ["completed", "failed", "cancelled", "budget_exhausted", "interrupted"].includes(v?.status) ? v : null; }, 150000);
    check("R5: the Manager run finished", done?.status === "completed", `${done?.status} ${done?.error ?? ""}`);
    return { status: done?.status, calls: done?.modelCalls };
  });

  // ===== R6 collaboration: group switch on (in the COPY only), two agents, an @mention
  await step("R6 group", async () => {
    const second = (await call("POST", "/api/bots", { name: "Real Reviewer", role: "Reviewer", instructions: "Reply in one short sentence.", model: "auto/general" })).body.bot;
    await call("PATCH", `/api/bots/${second.id}`, { status: "active" });
    await call("PUT", "/api/groups/enabled", { on: true }); // the scratch COPY only; the real database is untouched
    const grp = (await call("POST", "/api/groups", { name: "Real test group", participationMode: "mention_only", botIds: [bot.id, second.id] })).body?.group;
    const post = await call("POST", `/api/groups/${grp.id}/messages`, { content: "@Real Reviewer please say hello to the team in one sentence." });
    check("R6: the mention started the named agent only", (post.body?.started ?? []).length === 1 && post.body.started[0].botName === "Real Reviewer", JSON.stringify(post.body?.started));
    const msgs = await until(async () => { const m = (await call("GET", `/api/groups/${grp.id}/messages`)).body?.messages ?? []; return m.length >= 2 ? m : null; }, 120000);
    const botMessages = (msgs ?? []).filter((m) => m.senderKind === "bot");
    check("R6: the agent's real reply is in the group and the other agent stayed silent", botMessages.some((m) => m.senderName === "Real Reviewer") && botMessages.every((m) => m.senderName === "Real Reviewer"), JSON.stringify(botMessages.map((m) => ({ senderKind: m.senderKind, senderName: m.senderName, kind: m.kind }))));
    return { messages: msgs?.length };
  });

  const total = (await usedToday()) - startUsed;
  evidence.requestsUsed = total;
  check(`budget respected: ${total} real requests used (ceiling 16)`, total <= BUDGET, `used ${total}`);
  // ===== R7 (no provider): the Assistant answers from the registry after the real run
  const a = await call("POST", "/api/assistant/interpret", { text: "what can you do?" });
  check("R7: the Assistant's capability answer needs no provider request", a.body?.kind === "capabilities" && (await usedToday()) - startUsed === total);
} catch (e) {
  check("script ran to the end", false, String(e).slice(0, 300)); exitCode = 1;
} finally {
  srv.kill();
  const outDir = path.join(ROOT, "docs", "evidence", "real-modernization");
  mkdirSync(outDir, { recursive: true });
  evidence.finishedAt = new Date().toISOString();
  evidence.checks = results;
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(evidence, null, 2));
  // The copy holds the vault key: it MUST be deleted. Wait for the server to exit (Windows keeps the files open for a moment), then retry.
  await new Promise((r) => (srv.exitCode !== null ? r() : (srv.once("exit", r), setTimeout(r, 4000))));
  let gone = false;
  for (let i = 0; i < 12 && !gone; i++) { try { rmSync(tmp, { recursive: true, force: true }); gone = true; } catch { await sleep(800); } }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; scratch copy deleted: ${gone}; evidence: docs/evidence/real-modernization/results.json (no keys)`);
  if (failed.length) console.log("NOT PASSED:\n" + failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n"));
  process.exit(exitCode || 0);
}
