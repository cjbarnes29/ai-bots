// REAL-WORLD TASK RUN. PREPARED, NOT RUN. It needs the owner's approval of the exact request counts below (CLAUDE.md section 5).
//
//   "Research 10 businesses in Dubai, inspect their websites, organize findings in Excel, generate a PDF report and prepare an email with the files attached."
//
// What leaves this PC (hard caps, enforced by the platform itself, not only by this script):
//   * AI provider requests (free tiers only):  at most AWP_APPROVED_PROVIDER_REQUESTS   (the provider's daily cap is set to that number)
//   * ONE map-data request to overpass-api.de (the business module's own limit; the script refuses to run unless AWP_APPROVED_MAP_REQUESTS >= 1)
//   * at most TEN home-page requests to the businesses' own websites (limit 10 results; the module's per-run and per-day limits apply)
//   * NO email is sent: the "email" is a .eml draft FILE that the owner opens in a mail program. No mail service is contacted.
// Everything else stays on this PC. It starts a SCRATCH app (port 3107, scratch database and workspace in the temp folder); your real data/app.db,
// vault and settings are never touched. Keys are read from this script's environment only and are never printed.
//
// How to run (in your own terminal, so keys never appear in chat):
//   $env:GROQ_API_KEY = "<free key>"            # and/or  $env:GEMINI_API_KEY = "<key from a project with NO billing>"
//   $env:AWP_APPROVED_PROVIDER_REQUESTS = "60"
//   $env:AWP_APPROVED_MAP_REQUESTS = "1"
//   $env:AWP_APPROVED_SITE_REQUESTS = "10"
//   node scripts/e2e/real-task.mjs
//
// The script plays the OWNER on the scratch app for the three FILE approvals only (Excel, PDF, email-draft file, in that order). Any other
// approval request is DENIED and reported. Evidence (JSON, the real files, the email draft) is copied to docs/evidence/real-task/.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3107;
const GROQ = process.env.GROQ_API_KEY ?? "";
const GEMINI = process.env.GEMINI_API_KEY ?? "";
const PROVIDER_BUDGET = Number(process.env.AWP_APPROVED_PROVIDER_REQUESTS ?? 0);
const MAP_BUDGET = Number(process.env.AWP_APPROVED_MAP_REQUESTS ?? 0);
const SITE_BUDGET = Number(process.env.AWP_APPROVED_SITE_REQUESTS ?? 0);
const GOAL = "Research 10 businesses in Dubai, inspect their websites, organize findings in Excel, generate a PDF report and prepare an email with the files attached.";
if (!(GROQ || GEMINI)) { console.error("Set GROQ_API_KEY and/or GEMINI_API_KEY (free tier) in this terminal first. Nothing was sent."); process.exit(2); }
if (PROVIDER_BUDGET < 10 || MAP_BUDGET < 1 || SITE_BUDGET < 1) { console.error("Refusing to run: the owner has not approved request counts (AWP_APPROVED_PROVIDER_REQUESTS >= 10, AWP_APPROVED_MAP_REQUESTS >= 1, AWP_APPROVED_SITE_REQUESTS >= 1). Nothing was sent."); process.exit(2); }

const tmp = mkdtempSync(path.join(tmpdir(), "awp-real-"));
const ws = path.join(tmp, "workspace");
mkdirSync(ws, { recursive: true });
const env = { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(tmp, "scratch.db"), GUARDIAN_URL: "", ...(GROQ ? { GROQ_API_KEY: GROQ } : {}), ...(GEMINI ? { GEMINI_API_KEY: GEMINI } : {}) };
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const secret = (s) => String(s).split(GROQ || "\u0000").join("[key]").split(GEMINI || "\u0000").join("[key]");
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const evidence = { startedAt: new Date().toISOString(), simulated: false, budgets: { PROVIDER_BUDGET, MAP_BUDGET, SITE_BUDGET }, steps: [], errors: [] };
const note = (what, data) => { evidence.steps.push({ at: new Date().toISOString(), what, ...(data !== undefined ? { data } : {}) }); console.log(`- ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1500); } return null; };
// requests that actually reached a provider (ok + error); "blocked" ones were stopped by the platform before any request
const providerRequests = async () => ((await call("GET", "/api/llm/usage?days=1")).body?.usage?.byDay ?? []).reduce((n, d) => n + Number(d.ok ?? 0) + Number(d.errors ?? 0), 0);

let exitCode = 0;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) break; } catch {} await sleep(500); }
  // providers: enable what the owner gave a key for; the platform's own daily cap enforces the approved count
  const active = [];
  for (const [id, key] of [["groq", GROQ], ["gemini", GEMINI]]) {
    if (!key) continue;
    await call("PATCH", `/api/llm/providers/${id}`, { enabled: true, dailyRequestCap: PROVIDER_BUDGET });
    const t = await call("POST", `/api/llm/providers/${id}/test`);
    note(`connection test ${id}`, { status: t.body?.provider?.status, message: secret(t.body?.provider?.statusMessage ?? "") });
    const r = await call("POST", `/api/llm/providers/${id}/refresh-models`);
    const models = r.body?.models ?? [];
    note(`models listed by ${id}`, { total: models.length, usable: models.filter((m) => m.callable && m.routable).map((m) => m.ref) });
    for (const m of models.filter((x) => x.callable && x.verification === "verified")) await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });
    if (t.body?.provider?.status === "connected") active.push(id);
  }
  if (active.length === 0) throw new Error("No provider connected. Nothing further was attempted.");
  await call("PUT", "/api/llm/routing", { allowedProviders: active, providerOrder: active, maxAttempts: 3, enabled: true });
  const routing = (await call("GET", "/api/llm/routing")).body;
  const candidates = routing?.preview?.general ?? [];
  note("models automatic routing may use (verified, free)", candidates.map((c) => c.ref));
  if (candidates.length === 0) throw new Error("No verified free model is available. The registry only routes to models that passed its core tests (docs/MODEL-REGISTRY.md). Stopped before any task.");

  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 30, providerRequestsPerMinute: 30 });
  const mk = async (name, role, instructions) => { const r = await call("POST", "/api/bots", { name, role, model: "auto/general", instructions }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const researcher = await mk("Researcher", "Finds and checks businesses", "Use the business tools. Report only what the tool results say. Never invent a business, a website or a fact.");
  const writer = await mk("Writer", "Produces Excel, PDF and email drafts", "Use the documents tools to create files exactly as asked. Put real values from the research in the files. Never invent data.");
  await call("PUT", `/api/bots/${researcher.id}/permissions/browser`, { readEnabled: true });
  await call("POST", "/api/pc/workspaces", { path: ws });
  await call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["modify"] });
  await call("PUT", "/api/business/external", { enabled: true });
  await call("PUT", "/api/manager/settings", { allowedBots: [researcher.id, writer.id], defaultBudget: { maxModelCalls: 20, maxTokens: 120000, maxSteps: 5 } });
  note("workforce set up (scratch)", { researcher: researcher.id, writer: writer.id, workspace: ws });

  const started = await call("POST", "/api/manager/runs", { goal: GOAL });
  if (started.status !== 202) throw new Error(`The Manager refused: ${JSON.stringify(started.body)}`);
  const runId = started.body.run.id;
  note("Manager run started", { runId });
  const approved = [];
  const order = ["create_spreadsheet", "create_document", "create_email_draft"];
  let guard = 0;
  const final = await until(async () => {
    if (++guard > 400) return { status: "timeout" };
    if ((await providerRequests()) > PROVIDER_BUDGET) return { status: "budget_stop" };
    const pending = (await call("GET", "/api/approvals?status=pending")).body?.approvals ?? [];
    for (const p of pending) {
      const isFile = p.connector === "documents" && order.includes(p.action);
      const mayNow = isFile && order.slice(0, order.indexOf(p.action)).every((a) => approved.includes(a) || !pending.concat([]).some((q) => q.action === a));
      if (!isFile) { await call("POST", `/api/approvals/${p.id}/deny`); evidence.errors.push(`denied unexpected approval ${p.connector}.${p.action}`); note("DENIED an approval that is not a file for this task", { connector: p.connector, action: p.action, summary: p.summary }); continue; }
      if (!mayNow) continue;
      const r = await call("POST", `/api/approvals/${p.id}/approve`);
      approved.push(p.action);
      note(`owner approved ${p.action}`, { summary: p.summary, result: r.body?.approval?.status, error: r.body?.approval?.error ?? null });
    }
    const run = (await call("GET", `/api/manager/runs/${runId}`)).body?.run;
    if (run && ["completed", "failed", "budget_exhausted", "cancelled", "interrupted"].includes(run.status)) {
      const left = (await call("GET", "/api/approvals?status=pending")).body?.approvals ?? [];
      return left.length === 0 ? run : null;
    }
    return null;
  }, 25 * 60 * 1000);
  evidence.run = final;
  note("Manager run finished", { status: final?.status, steps: (final?.steps ?? []).map((s) => ({ id: s.id, specialist: s.specialistName, status: s.status, error: s.error ?? null })) });

  // ---- evidence: real requests, tasks, usage, errors, files
  evidence.usage = (await call("GET", "/api/llm/usage")).body;
  evidence.tasks = (await call("GET", "/api/tasks")).body?.tasks;
  evidence.audit = ((await call("GET", "/api/audit?limit=500")).body?.events ?? []).filter((e) => /^(business\.external_request|llm\.|approval|manager|model)/.test(e.kind)).map((e) => ({ kind: e.kind, detail: e.detail }));
  evidence.providerRequests = await providerRequests();
  evidence.mapRequests = evidence.audit.filter((e) => e.kind === "business.external_request" && e.detail?.service === "map").length;
  evidence.siteRequests = evidence.audit.filter((e) => e.kind === "business.external_request" && e.detail?.service === "website").length;
  evidence.files = readdirSync(ws).map((f) => { const p = path.join(ws, f); const b = readFileSync(p); return { file: f, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex"), magic: b.subarray(0, 5).toString("latin1") }; });
  const eml = existsSync(path.join(ws, "email-to-owner.eml")) ? readFileSync(path.join(ws, "email-to-owner.eml"), "utf8") : "";
  evidence.emailDraft = { attachments: [...eml.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]), sent: false };
  evidence.gmailApprovals = ((await call("GET", "/api/approvals")).body?.approvals ?? []).filter((a) => a.connector === "gmail").length;
  const overBudget = evidence.providerRequests > PROVIDER_BUDGET || evidence.mapRequests > MAP_BUDGET || evidence.siteRequests > SITE_BUDGET;
  note("budget check", { providerRequests: evidence.providerRequests, mapRequests: evidence.mapRequests, siteRequests: evidence.siteRequests, overBudget });
  if (final?.status !== "completed") exitCode = 1;
} catch (e) {
  evidence.errors.push(secret(e instanceof Error ? e.message : String(e)));
  console.error("STOPPED:", secret(e instanceof Error ? e.message : e));
  exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  const out = path.join(ROOT, "docs", "evidence", "real-task");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "evidence.json"), secret(JSON.stringify(evidence, null, 2)));
  for (const f of existsSync(ws) ? readdirSync(ws) : []) if (statSync(path.join(ws, f)).isFile()) cpSync(path.join(ws, f), path.join(out, f));
  console.log(`Evidence and the real files were copied to ${out}`);
  srv.kill();
  process.exit(exitCode);
}
