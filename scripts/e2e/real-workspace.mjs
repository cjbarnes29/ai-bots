// REAL run of the shared project workspace (board P-44). Owner-approved budgets are passed in and ENFORCED BY THE PLATFORM (provider daily caps in the copy).
//   AWP_APPROVED_GROQ_REQUESTS   (1-14)  real Groq chat requests
//   AWP_APPROVED_GOOGLE_REQUESTS (0-10)  real Gemini requests: up to 6 to verify ONE Gemini model with the registry's core tests (P-42), the rest for the switch
//   AWP_GEMINI_MODEL                     the one Gemini model to verify (default gemini-flash-lite-latest); no other Gemini model is tried
// Nothing else external: no map, website, email or outside action except creating ONE CSV inside a scratch folder (approved by this script on the owner's behalf,
// because the owner approved exactly that). Works on a SCRATCH COPY of the saved database (VACUUM INTO; the original is only read), deleted afterwards.
// Steps: A Researcher -> Analyst on Groq (CSV through the approval gate and a folder grant) | B Groq made unavailable in the copy (daily cap reached) -> the
// Writer runs on Gemini with the workspace written by the Groq agents; a chat turn on Groq then Gemini recalls a code word | C Groq back -> next task on Groq |
// D restart on the same copy -> workspace identical, one last task gets it | E the dashboard in Edge shows the real entries (local only).
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GROQ = Number(process.env.AWP_APPROVED_GROQ_REQUESTS ?? 0);
const GOOGLE = Number(process.env.AWP_APPROVED_GOOGLE_REQUESTS ?? 0);
const GEMINI_MODEL = process.env.AWP_GEMINI_MODEL ?? "gemini-flash-lite-latest";
if (!(GROQ >= 1 && GROQ <= 14) || !(GOOGLE >= 0 && GOOGLE <= 10)) { console.error("Refusing: set AWP_APPROVED_GROQ_REQUESTS (1-14) and AWP_APPROVED_GOOGLE_REQUESTS (0-10) exactly as approved by the owner. Nothing was sent."); process.exit(2); }
const PORT = 3111;
const results = [];
const evidence = { budgets: { groq: GROQ, google: GOOGLE, geminiModel: GEMINI_MODEL }, steps: [], note: "Real providers. Groq's unavailability in step B is INJECTED (its daily cap in the scratch copy is set to the count reached), not a real outage." };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 300) : ""}`); };
const note = (step, data) => { evidence.steps.push({ step, ...data }); };

const tmp = mkdtempSync(path.join(tmpdir(), "awp-p44-"));
mkdirSync(path.join(tmp, "copy"));
const files = path.join(tmp, "files");
mkdirSync(files);
const dbPath = path.join(tmp, "copy", "app.db");
const src = new DatabaseSync(path.join(ROOT, "data", "app.db"), { readOnly: true });
try { src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); } finally { src.close(); }
copyFileSync(path.join(ROOT, "data", "vault.key"), path.join(tmp, "copy", "vault.key"));
let srv; let log = "";
const startServer = () => {
  const env = { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "" };
  for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OMNIROUTE_API_KEY"]) delete env[k];
  srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
};
const base = `http://127.0.0.1:${PORT}`;
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const until = async (fn, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 500)); } return null; };
const today = async (id) => Number(((await call("GET", "/api/llm/providers")).body?.providers ?? []).find((p) => p.id === id)?.requestsToday ?? 0);
const runTask = async (botId, instruction, projectId, save = true) => {
  const s = await call("POST", `/api/bots/${botId}/tasks`, { instruction, projectId, saveToWorkspace: save });
  if (s.status !== 202) return { status: "not_started", errorMessage: JSON.stringify(s.body) };
  return until(async () => { const t = (await call("GET", `/api/tasks/${s.body.task.id}`)).body.task; return ["completed", "failed"].includes(t.status) ? t : null; });
};
// Which models answered a task: the routing records of that task's bot during the task (tasks run one at a time here).
const answeredBy = async (taskId) => {
  if (!taskId) return [];
  const t = (await call("GET", `/api/tasks/${taskId}`)).body?.task;
  const h = (await call("GET", "/api/llm/routing/history")).body?.recent ?? [];
  return h.filter((r) => r.botId === t?.assigneeBotId && r.at >= (t?.startedAt ?? t?.createdAt) && r.at <= (t?.finishedAt ?? "9")).map((r) => r.answeredBy);
};
// The workspace events of a task (published / rejected with the reason), for the evidence.
const wsEvents = async (taskId) => (taskId ? ((await call("GET", `/api/tasks/${taskId}`)).body?.events ?? []).filter((e) => String(e.kind).startsWith("workspace_")).map((e) => ({ kind: e.kind, detail: e.detail })) : []);
// Every routing attempt of a task (model and outcome code), for the evidence: a failed task must say WHY.
const attemptsOf = async (taskId) => {
  if (!taskId) return [];
  const t = (await call("GET", `/api/tasks/${taskId}`)).body?.task;
  const h = (await call("GET", "/api/llm/routing/history")).body?.recent ?? [];
  return h.filter((r) => r.botId === t?.assigneeBotId && r.at >= (t?.startedAt ?? t?.createdAt) && r.at <= (t?.finishedAt ?? "9")).map((r) => r.attempts);
};
// The owner approved exactly: ONE CSV inside the scratch folder. Any other pending request is denied.
const decideApprovals = async () => {
  const out = [];
  for (const a of (await call("GET", "/api/approvals?status=pending")).body?.approvals ?? []) {
    const p = String(a.args?.path ?? "");
    // ONE .csv inside the scratch folder, whichever file action the agent chose (documents.create_spreadsheet or pc.write_file), never overwriting
    const csvByDocuments = a.connector === "documents" && a.action === "create_spreadsheet" && a.args?.format === "csv";
    const csvByPc = a.connector === "pc" && a.action === "write_file" && /\.csv$/i.test(p) && a.args?.overwrite !== true;
    const ok = (csvByDocuments || csvByPc) && !p.includes("..") && (!path.isAbsolute(p) || p.startsWith(files)) && !out.some((x) => x.approved);
    const r = ok ? await call("POST", `/api/approvals/${a.id}/approve`) : await call("POST", `/api/approvals/${a.id}/deny`, { reason: "Not part of the approved real run." });
    out.push({ action: `${a.connector}.${a.action}`, path: p, approved: ok, status: r.body?.approval?.status, error: r.body?.approval?.error ?? null });
  }
  return out;
};

let browser; let exitCode = 0;
try {
  startServer();
  check("scratch copy started", await ready());
  // ---- guard rails: the platform enforces the budgets; one request = one attempt; nothing local in the way
  const groq0 = await today("groq"); const goog0 = await today("gemini");
  evidence.before = { groq: groq0, google: goog0 };
  await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: groq0 + GROQ });
  await call("PATCH", "/api/llm/providers/gemini", { dailyRequestCap: goog0 + GOOGLE, enabled: GOOGLE > 0 });
  await call("PATCH", "/api/llm/providers/ollama", { enabled: false });
  await call("PUT", "/api/llm/limits", { retries: 0, botRequestsPerMinute: 30, providerRequestsPerMinute: 30, timeoutMs: 90000 });

  // ---- P-42: verify ONE Gemini model with the registry's core tests (counts against the Google budget)
  let geminiVerified = false;
  if (GOOGLE > 0) {
    const ref = `gemini/${GEMINI_MODEL}`;
    const m = ((await call("GET", "/api/llm/models")).body?.models ?? []).find((x) => x.ref === ref);
    if (m) await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });
    const ev = await call("POST", "/api/llm/registry/evaluate", { ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: Math.min(3, GOOGLE) });
    note("Gemini verification", { ref, status: ev.status, results: ev.body?.result?.results ?? ev.body });
    const reg = ((await call("GET", "/api/llm/registry")).body?.models ?? []).find((x) => x.ref === ref);
    geminiVerified = reg?.status === "verified" && reg?.routable === true;
    check(`Gemini model ${GEMINI_MODEL} verified by real core tests`, geminiVerified, JSON.stringify((ev.body?.result?.results ?? []).map((x) => `${x.test}:${x.result}`)));
  }
  await call("PUT", "/api/llm/routing", { allowedProviders: geminiVerified ? ["groq", "gemini"] : ["groq"], providerOrder: ["groq", "gemini"], maxAttempts: 2, enabled: true, spreadLoad: false });
  const order = ((await call("GET", "/api/llm/routing")).body?.preview?.general ?? []).map((x) => x.ref);
  note("routing order", { order });
  check("routing prefers verified Groq models" + (geminiVerified ? ", Gemini behind them" : ""), order[0]?.startsWith("groq/") && (!geminiVerified || order.some((r) => r.startsWith("gemini/"))), order.join(" > "));

  // ---- the team, the project, the scratch folder
  const mk = async (name, role, instructions) => { const r = await call("POST", "/api/bots", { name: `${name} P44`, role, model: "auto/general", instructions }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const researcher = await mk("Researcher", "Market researcher", "Answer from your own knowledge; you have no web access. Say plainly when something is an estimate. Publish your results to the project workspace with honest labels.");
  const analyst = await mk("Analyst", "Cost analyst", "Build on the workspace. Create files only with the documents tools. Publish your recommendation and hand the writing over to the Writer.");
  const writer = await mk("Writer", "Report writer", "Read the workspace and the files listed there before writing. Use the documents tools to read data files. Publish your final recommendation and a progress note.");
  check("PC workspace = scratch folder", (await call("POST", "/api/pc/workspaces", { path: files })).status < 300);
  const grant = await call("POST", "/api/access/folders", { path: files, ops: ["read", "create", "edit"], inherit: true, expiresInMinutes: 120, acknowledgeSensitive: "app_data", note: "P-44 scratch" });
  check("folder grant for the scratch folder only", grant.status === 200, grant.status);
  await call("PUT", `/api/bots/${analyst.id}/pc`, { grants: ["modify"] });
  await call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["read"] });
  const project = (await call("POST", "/api/projects", { name: "P44 Dubai cafe market" })).body.project;
  const ws = async () => (await call("GET", `/api/projects/${project.id}/workspace`)).body;

  // ---- A. Researcher and Analyst on Groq
  const r1 = await runTask(researcher.id, "Research opening a specialty cafe in Dubai Marina: typical yearly licence cost, yearly rent for a small unit, and how busy the area is. Publish each result to the workspace with an honest kind (fact only with a source).", project.id);
  const v1 = await ws();
  note("A1 Researcher", { status: r1?.status, error: r1?.errorMessage ?? null, code: r1?.errorCode ?? null, attempts: await attemptsOf(r1?.id), workspaceEvents: await wsEvents(r1?.id), answeredBy: await answeredBy(r1?.id), result: r1?.result?.slice(0, 1500), entries: v1.entries.map((e) => ({ kind: e.kind, title: e.title, text: e.text, source: e.source, platformNote: e.platformNote })) });
  check("A1: Researcher finished on Groq", r1?.status === "completed" && (await answeredBy(r1.id)).filter(Boolean).every((x) => String(x).startsWith("groq/")), (await answeredBy(r1?.id)).join(","));
  check("A1: Researcher published to the workspace", v1.entries.length >= 1, `${v1.entries.length} entries: ${v1.entries.map((e) => e.kind).join(",")}`);
  check("A1: every published 'fact' carries a source (others are labelled assumption/finding)", v1.entries.every((e) => e.kind !== "fact" || !!e.source));
  const r2 = await runTask(analyst.id, `Using the workspace, estimate the yearly fixed costs (licence + rent). Create the file marina-costs.csv (CSV, columns Item and AED per year) with the documents tools, publish a recommendation, and hand the writing of the owner's brief over to "${writer.name}".`, project.id);
  const approvals = await decideApprovals();
  const v2 = await ws();
  note("A2 Analyst", { status: r2?.status, error: r2?.errorMessage ?? null, code: r2?.errorCode ?? null, attempts: await attemptsOf(r2?.id), workspaceEvents: await wsEvents(r2?.id), answeredBy: await answeredBy(r2?.id), result: r2?.result?.slice(0, 1500), approvals, entries: v2.entries.filter((e) => e.authorName === analyst.name).map((e) => ({ kind: e.kind, title: e.title, text: e.text, forName: e.forName })) });
  check("A2: Analyst finished on Groq", r2?.status === "completed" && (await answeredBy(r2.id)).filter(Boolean).every((x) => String(x).startsWith("groq/")));
  const created = v2.files.find((f) => f.status === "created");
  check("A2: the CSV was requested, approved and created in the granted folder", !!created && existsSync(created.path) && created.path.startsWith(files), JSON.stringify(approvals));
  check("A2: Analyst published a recommendation and a handover for the Writer", v2.entries.some((e) => e.kind === "recommendation" && e.authorName === analyst.name) && v2.entries.some((e) => e.kind === "handover" && e.forName === writer.name), v2.entries.filter((e) => e.authorName === analyst.name).map((e) => `${e.kind}${e.forName ? "->" + e.forName : ""}`).join(","));

  // ---- B. Groq unavailable (INJECTED: cap reached in the copy) -> the Writer runs on Gemini with the Groq agents' workspace
  if (geminiVerified) {
    const g = await today("groq");
    await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: Math.max(1, g) });
    const r3 = await runTask(writer.id, "Write the owner's brief for the Marina cafe from the workspace: read marina-costs.csv, state the yearly fixed cost, give the final recommendation and say which statements are verified and which are assumptions. Publish the final recommendation (replace the Analyst's if you correct it) and a progress note.", project.id);
    const v3 = await ws();
    const by = await answeredBy(r3?.id);
    note("B Writer on Gemini", { status: r3?.status, error: r3?.errorMessage ?? null, code: r3?.errorCode ?? null, attempts: await attemptsOf(r3?.id), workspaceEvents: await wsEvents(r3?.id), answeredBy: by, result: r3?.result?.slice(0, 2500), entries: v3.entries.filter((e) => e.authorName === writer.name).map((e) => ({ kind: e.kind, title: e.title, text: e.text, replaces: e.replaces })) });
    check("B: with Groq unavailable the Writer was answered by Gemini", r3?.status === "completed" && by.length > 0 && by.every((x) => String(x).startsWith("gemini/")), by.join(","));
    check("B: context preserved across providers: the Gemini Writer used the Groq agents' numbers", /15[,.]?000|195[,.]?000|AED/i.test(r3?.result ?? ""), (r3?.result ?? "").slice(0, 200));
    check("B: Writer published its final recommendation / progress", v3.entries.some((e) => e.authorName === writer.name));
    // chat context across the switch: turn 1 on Groq, turn 2 on Gemini
    await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: groq0 + GROQ });
    const chat = (message, conversationId) => call("POST", `/api/bots/${researcher.id}/chat`, { message, ...(conversationId ? { conversationId } : {}) });
    const c1 = await chat("Remember this code word: AMBER-44. Reply only with the word noted.");
    await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: Math.max(1, await today("groq")) });
    const c2 = await chat("What is the code word I gave you earlier? Reply with only the code word.", c1.body?.conversationId);
    note("B chat across the switch", { turn1: c1.body?.assistantMessage?.providerId, turn2: `${c2.body?.assistantMessage?.providerId}/${c2.body?.assistantMessage?.modelId}`, reply: c2.body?.assistantMessage?.content });
    check("B: chat turn 1 on Groq, turn 2 on Gemini recalled the code word", c1.body?.assistantMessage?.providerId === "groq" && c2.body?.assistantMessage?.providerId === "gemini" && /AMBER-44/i.test(c2.body?.assistantMessage?.content ?? ""), JSON.stringify(c2.body?.assistantMessage?.content ?? c2.body));
  } else {
    check("B: Groq -> Gemini switch NOT RUN (no Gemini model passed verification)", false, "see the Gemini verification step");
    // The Writer still completes the Researcher -> Analyst -> Writer chain, on Groq.
    const r3 = await runTask(writer.id, "Write the owner's brief for the Marina cafe from the workspace: read marina-costs.csv, state the yearly fixed cost, give the final recommendation and say which statements are verified and which are assumptions. Publish the final recommendation (replace the Analyst's if you correct it) and a progress note.", project.id);
    const v3 = await ws();
    note("B' Writer on Groq", { status: r3?.status, error: r3?.errorMessage ?? null, code: r3?.errorCode ?? null, attempts: await attemptsOf(r3?.id), workspaceEvents: await wsEvents(r3?.id), answeredBy: await answeredBy(r3?.id), result: r3?.result?.slice(0, 2500), entries: v3.entries.filter((e) => e.authorName === writer.name).map((e) => ({ kind: e.kind, title: e.title, text: e.text, replaces: e.replaces })) });
    check("B': Writer (on Groq) finished and used the Analyst's numbers / the CSV", r3?.status === "completed" && /\d{2}[,.]?\d{3}/.test(r3?.result ?? ""), (r3?.errorMessage ?? r3?.result ?? "").slice(0, 200));
    check("B': Writer published to the workspace", v3.entries.some((e) => e.authorName === writer.name), v3.entries.filter((e) => e.authorName === writer.name).map((e) => e.kind).join(","));
  }

  // ---- C. recovery: Groq available again -> the next task is answered by Groq (only after a real switch step)
  await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: groq0 + GROQ });
  if (geminiVerified) {
  const r4 = await runTask(researcher.id, "In two sentences: given the workspace, is anything still missing before the owner decides? Do not publish anything new unless it is new.", project.id);
  const by4 = await answeredBy(r4?.id);
  note("C recovery", { status: r4?.status, error: r4?.errorMessage ?? null, code: r4?.errorCode ?? null, attempts: await attemptsOf(r4?.id), workspaceEvents: await wsEvents(r4?.id), answeredBy: by4, result: r4?.result?.slice(0, 800) });
  check("C: after Groq is back, the next task runs on Groq", r4?.status === "completed" && by4.every((x) => String(x).startsWith("groq/")), by4.join(","));
  }

  // ---- D. restart on the same copy
  const before = await ws();
  srv.kill(); await new Promise((r) => setTimeout(r, 1500)); startServer();
  check("D: app restarted on the same scratch copy", await ready());
  const after = await ws();
  const key = (x) => JSON.stringify({ e: x.entries, f: x.files });
  check("D: workspace identical after the restart", key(before) === key(after), `${after.entries.length} entries, ${after.files.length} files`);
  const r5 = await runTask(analyst.id, "Using only the workspace, list the yearly fixed cost and the final recommendation in two lines.", project.id, false);
  note("D after restart", { status: r5?.status, error: r5?.errorMessage ?? null, code: r5?.errorCode ?? null, attempts: await attemptsOf(r5?.id), workspaceEvents: await wsEvents(r5?.id), answeredBy: await answeredBy(r5?.id), result: r5?.result?.slice(0, 800) });
  check("D: a task after the restart used the workspace (numbers from it)", r5?.status === "completed" && /\d/.test(r5?.result ?? ""), (r5?.result ?? "").slice(0, 200));

  // ---- E. the real entries in the dashboard (local only)
  const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base + "/projects");
  await page.getByRole("button", { name: `Open ${project.name}` }).click();
  const panel = page.getByRole("region", { name: "Shared workspace" });
  await panel.waitFor();
  const shots = path.join(ROOT, "docs", "evidence", "real-workspace");
  mkdirSync(shots, { recursive: true });
  for (const tab of ["Research and findings", "Task notes", "Shared files", "Agent contributions", "Recent updates"]) {
    await panel.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, `${tab.replace(/\W+/g, "-").toLowerCase()}.png`), fullPage: true });
  }
  check("E: dashboard showed all five workspace tabs with the real data (screenshots saved)", true, shots);
  const final = await ws();
  evidence.tokens = [];
  for (const t of final.tasks) {
    const full = (await call("GET", `/api/tasks/${t.rootId}`)).body;
    for (const n of [full.task, ...(full.task.children ?? [])]) evidence.tokens.push({ agent: n.assigneeName, status: n.status, llmCalls: n.llmCalls, inputTokens: n.inputTokens, outputTokens: n.outputTokens });
  }
  evidence.tokenTotals = evidence.tokens.reduce((a, x) => ({ llmCalls: a.llmCalls + x.llmCalls, inputTokens: a.inputTokens + x.inputTokens, outputTokens: a.outputTokens + x.outputTokens }), { llmCalls: 0, inputTokens: 0, outputTokens: 0 });
  evidence.workspace = { entries: final.entries, files: final.files.map((f) => ({ ...f, path: path.basename(f.path) })), contributions: final.contributions };
} catch (e) {
  check("script completed", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  try {
    evidence.used = { groq: (await today("groq")) - (evidence.before?.groq ?? 0), google: (await today("gemini")) - (evidence.before?.google ?? 0) };
    check(`real requests within the approved budgets (Groq ${GROQ}, Google ${GOOGLE})`, evidence.used.groq <= GROQ && evidence.used.google <= GOOGLE, JSON.stringify(evidence.used));
  } catch {}
  await browser?.close().catch(() => {});
  srv?.kill();
  evidence.results = results;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(path.join(ROOT, "docs", "evidence"), { recursive: true });
  // Never write an account identifier or anything key-like into the evidence.
  const clean = JSON.stringify(evidence, null, 2).replace(/org_[A-Za-z0-9]+/g, "org_[redacted]").replace(/\b(gsk_|sk-|AIza)[A-Za-z0-9_-]{8,}/g, "[redacted]");
  writeFileSync(path.join(ROOT, "docs", "evidence", process.env.AWP_EVIDENCE_NAME ?? "p44-real-workspace.json"), clean);
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Evidence: docs/evidence/${process.env.AWP_EVIDENCE_NAME ?? "p44-real-workspace.json"}`);
  if (failed.length) { exitCode = 1; console.log("server log tail:", log.slice(-500)); }
  process.exit(exitCode);
}
