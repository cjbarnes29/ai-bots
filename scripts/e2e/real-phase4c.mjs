// REAL-MODEL FOLLOW-UP (board P-48, inside its remaining ceiling: 22 - 18 used = 4; this script plans 2). Run:
//   AWP_APPROVED_PROVIDER_REQUESTS=4 AWP_USE_COPY_OF_REAL_DB=1 node --import tsx scripts/e2e/real-phase4c.mjs
// Checks the fixed workflow-REVISE prompt against the real model with two different fixed fictional drafts (no checkpoint to start with).
// Same protections as real-phase4b.mjs: scratch COPY of the database (read-only on the original, deleted at the end), Groq daily cap = today's use + 4,
// retries off, gpt-oss-120b only, fictional data, no key printed. Evidence: docs/evidence/real-phase4/results-round2c.json
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3117;
const BUDGET = Number(process.env.AWP_APPROVED_PROVIDER_REQUESTS ?? 0);
if (BUDGET !== 4 || process.env.AWP_USE_COPY_OF_REAL_DB !== "1") { console.error("Refusing to run: needs AWP_APPROVED_PROVIDER_REQUESTS=4 and AWP_USE_COPY_OF_REAL_DB=1."); process.exit(2); }
const results = [];
const evidence = { startedAt: new Date().toISOString(), budget: BUDGET, steps: {} };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).replace(/\s+/g, " ").slice(0, 260) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(path.join(tmpdir(), "awp-real-p4c-"));
mkdirSync(path.join(tmp, "copy"), { recursive: true });
const dbPath = path.join(tmp, "copy", "app.db");
{ const src = new DatabaseSync(path.join(ROOT, "data", "app.db"), { readOnly: true }); try { src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); } finally { src.close(); } copyFileSync(path.join(ROOT, "data", "vault.key"), path.join(tmp, "copy", "vault.key")); }
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
srv.stdout.on("data", () => {}); srv.stderr.on("data", () => {});
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await sleep(500); } return false; };
const usedToday = async () => ((await call("GET", "/api/llm/usage?days=1")).body?.usage?.byDay ?? []).reduce((n, d) => n + Number(d.ok ?? 0) + Number(d.errors ?? 0), 0);
let exitCode = 0;
try {
  check("scratch copy started", await ready());
  const start = await usedToday();
  await call("PATCH", "/api/llm/providers/groq", { enabled: true, dailyRequestCap: start + BUDGET });
  for (const id of ["gemini", "openrouter", "omniroute", "ollama"]) await call("PATCH", `/api/llm/providers/${id}`, { enabled: false });
  await call("PUT", "/api/llm/limits", { retries: 0, botRequestsPerMinute: 30, providerRequestsPerMinute: 30, timeoutMs: 90000 });
  const bot = (await call("POST", "/api/bots", { name: "Probe Writer", role: "Test agent", instructions: "Write short notes.", model: "groq/openai/gpt-oss-120b" })).body.bot;
  await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  const node = (id, type, extra = {}) => ({ id, type, label: type === "bot_task" ? "Probe Writer" : id, x: 40, y: 200, ...extra });
  const mk = (steps) => { const nodes = [node("start", "trigger", { label: "Start", kind: "manual" }), ...steps.map((s, i) => node(`s${i + 1}`, "bot_task", { botId: bot.id, instruction: s, retries: 0 })), node("end", "end", { label: "End" })]; return { name: "Fixed draft", graph: { nodes, edges: nodes.slice(0, -1).map((n, i) => ({ id: `e${i}`, from: n.id, to: nodes[i + 1].id, when: "always" })) } }; };
  const drafts = [
    ["A", mk(["Collect competitor prices", "Write a short summary of the prices"]), "Add a question for me at the very end asking whether to archive the result"],
    ["B", mk(["Write a thank-you note for a customer"]), "Before the note is written, ask me whether the customer prefers a formal tone"],
  ];
  for (const [key, draft, change] of drafts) {
    const before = await usedToday();
    const r = await call("POST", "/api/workflows/draft", { description: change, revise: draft, modelRef: "groq/openai/gpt-oss-120b" });
    const nodes = r.body?.draft?.graph?.nodes ?? [];
    const cps = nodes.filter((n) => n.type === "checkpoint");
    const agents = nodes.filter((n) => n.type === "bot_task");
    const ok = r.status === 200 && agents.length >= draft.graph.nodes.filter((n) => n.type === "bot_task").length && cps.length >= 1;
    check(`revise ${key}: the requested question was added as a checkpoint, the agent steps were kept`, ok, `${r.status} ${nodes.map((n) => n.type).join(">")} | ${cps.map((c) => c.message).join(" | ")} ${r.body?.message ?? ""}`);
    if (key === "A") check("revise A: the new checkpoint is the LAST step before End, and asks about archiving", /archive/i.test(cps.at(-1)?.message ?? "") && nodes.at(-2)?.type === "checkpoint");
    if (key === "B") check("revise B: the new checkpoint comes BEFORE the writing step, and asks about tone", nodes.findIndex((n) => n.type === "checkpoint") < nodes.findIndex((n) => n.type === "bot_task") && /tone|formal/i.test(cps[0]?.message ?? ""));
    evidence.steps[`revise ${key}`] = { requests: (await usedToday()) - before, types: nodes.map((n) => n.type), checkpoints: cps.map((c) => c.message), message: r.body?.message };
    await sleep(20000);
  }
  evidence.requestsUsed = (await usedToday()) - start;
  check(`budget respected: ${evidence.requestsUsed} real requests (ceiling 4)`, evidence.requestsUsed <= BUDGET);
} catch (e) { check("script ran to the end", false, String(e).slice(0, 300)); exitCode = 1; }
finally {
  srv.kill();
  const out = path.join(ROOT, "docs", "evidence", "real-phase4");
  mkdirSync(out, { recursive: true });
  evidence.finishedAt = new Date().toISOString(); evidence.checks = results;
  writeFileSync(path.join(out, "results-round2c.json"), JSON.stringify(evidence, null, 2));
  await new Promise((r) => (srv.exitCode !== null ? r() : (srv.once("exit", r), setTimeout(r, 4000))));
  let gone = false;
  for (let i = 0; i < 12 && !gone; i++) { try { rmSync(tmp, { recursive: true, force: true }); gone = true; } catch { await sleep(800); } }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; scratch copy deleted: ${gone}`);
  if (failed.length) console.log("NOT PASSED:\n" + failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n"));
  process.exit(exitCode);
}
