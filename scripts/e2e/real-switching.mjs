// P-41: REAL model switching with real Groq as the fallback. Owner-approved budget: at most 8 Groq requests, 0 Google, nothing else external.
//
// The PREFERRED model is a local stand-in provider on 127.0.0.1 (SIMULATED: this script makes it fail or answer on purpose, so a switch can be shown
// without waiting for a real outage). The FALLBACK is real Groq, chosen by the app's own automatic routing among its verified free models.
// It works on a SCRATCH COPY of the saved database (made with VACUUM INTO, read-only on the original) so the saved Groq key is available; the copy
// is deleted afterwards. Google is switched OFF in the copy, so no Google request can be made. Groq's daily cap in the copy is set to today's
// count + 8, so the PLATFORM refuses a ninth Groq request.
// Refuses to run unless AWP_APPROVED_GROQ_REQUESTS is set (max 8).
import http from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUDGET = Number(process.env.AWP_APPROVED_GROQ_REQUESTS ?? 0);
if (!(BUDGET >= 1 && BUDGET <= 8)) { console.error("Refusing: set AWP_APPROVED_GROQ_REQUESTS (1-8) as approved by the owner. Nothing was sent."); process.exit(2); }
const PORT = 3109;
const results = [];
const evidence = { simulatedPart: "the preferred provider is a local stand-in on 127.0.0.1 whose failures are injected by this script", realPart: "Groq answers as the fallback, chosen by the app's automatic routing", steps: [] };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

// ---- the local stand-in (SIMULATED). It also answers the registry's probes so the app may route to it.
const stand = { mode: "ok", calls: 0 };
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "stand-in:1b" }] });
    if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const last = String(body.messages.at(-1).content);
      const probe = last === "Reply with the single word OK." || last.startsWith("Reply with only this JSON") || last.startsWith("Who are you");
      if (!probe) stand.calls++;
      if (!probe && stand.mode === "500") return send(500, { error: { message: "stand-in made to fail" } });
      const content = last === "Reply with the single word OK." ? "OK" : last.startsWith("Reply with only this JSON") ? '{"ok": true, "word": "hello"}' : last.startsWith("Who are you") ? "I am Evaluator, a test assistant. ZETA-7" : last.includes("code word") && last.startsWith("Remember") ? "noted" : "hello (from the local stand-in)";
      return send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    }
    send(404, {});
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}/v1`;

// ---- scratch copy of the saved database
const tmp = mkdtempSync(path.join(tmpdir(), "awp-p41-"));
mkdirSync(path.join(tmp, "copy"));
const dbPath = path.join(tmp, "copy", "app.db");
const src = new DatabaseSync(path.join(ROOT, "data", "app.db"), { readOnly: true });
try { src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); } finally { src.close(); }
copyFileSync(path.join(ROOT, "data", "vault.key"), path.join(tmp, "copy", "vault.key"));
const env = { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "" };
for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OMNIROUTE_API_KEY"]) delete env[k];
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const groqToday = async () => Number(((await call("GET", "/api/llm/providers")).body?.providers ?? []).find((p) => p.id === "groq")?.requestsToday ?? 0);

let exitCode = 0;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  // ---- guard rails first: Google off, Groq capped by the platform, no retries (one request = one attempt)
  await call("PATCH", "/api/llm/providers/gemini", { enabled: false });
  const geminiStart = Number(((await call("GET", "/api/llm/providers")).body?.providers ?? []).find((p) => p.id === "gemini")?.requestsToday ?? 0);
  const groqStart = await groqToday();
  await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: groqStart + BUDGET });
  await call("PUT", "/api/llm/limits", { retries: 0, botRequestsPerMinute: 60, providerRequestsPerMinute: 30 });
  evidence.groqRequestsBefore = groqStart;
  // ---- the local stand-in becomes the preferred model (local only: no outside request)
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "stand-in:1b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  const ev = await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  check("local stand-in verified (local probes only)", ev.status === 200 && ev.body.result.results.every((x) => x.result === "pass"));
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama", "groq"], providerOrder: ["ollama", "groq"], preferLocal: true, maxAttempts: 3, enabled: true });
  const preview = (await call("GET", "/api/llm/routing")).body.preview.general.map((m) => m.ref);
  evidence.routingOrder = preview;
  check("routing order: stand-in first, real Groq models behind it", preview[0] === local.ref && preview.slice(1).some((r) => r.startsWith("groq/")), preview.join(" > "));
  const bot = (await call("POST", "/api/bots", { name: "P41 Tester", model: "auto/general", instructions: "Answer briefly and exactly as asked." })).body.bot;
  await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  const chat = (message, conversationId) => call("POST", `/api/bots/${bot.id}/chat`, { message, ...(conversationId ? { conversationId } : {}) });

  // ---- A. a real task, answered by real Groq after the preferred model fails
  stand.mode = "500";
  const a = await chat("In exactly three short bullet points, give three practical tips for writing a clear business email.");
  const am = a.body?.assistantMessage;
  evidence.steps.push({ step: "A real task after a switch", status: a.status, providerId: am?.providerId, modelId: am?.modelId, reply: am?.content?.slice(0, 600) });
  check("A: the preferred (stand-in) model failed and real Groq answered", a.status === 200 && am?.providerId === "groq", `${am?.providerId}/${am?.modelId}`);
  check("A: the real answer does the task (three bullet points)", (am?.content?.match(/^\s*([-*•]|\d+\.)\s+/gm) ?? []).length >= 3, JSON.stringify(am?.content?.slice(0, 160)));

  // ---- B. context survives the switch: turn 1 by the stand-in, turn 2 by real Groq must recall it
  stand.mode = "ok";
  const b1 = await chat("Remember this code word: AMBER-42. Reply only with the word noted.");
  const cid = b1.body?.conversationId;
  check("B1: turn 1 answered by the preferred stand-in (simulated)", b1.body?.assistantMessage?.providerId === "ollama", b1.body?.assistantMessage?.content);
  stand.mode = "500";
  const b2 = await chat("What is the code word I gave you earlier? Reply with only the code word.", cid);
  const bm = b2.body?.assistantMessage;
  evidence.steps.push({ step: "B context across a switch", turn1By: b1.body?.assistantMessage?.providerId, turn2By: `${bm?.providerId}/${bm?.modelId}`, reply: bm?.content });
  check("B2: after the switch, real Groq recalled the code word from turn 1", b2.status === 200 && bm?.providerId === "groq" && /AMBER-42/i.test(bm?.content ?? ""), JSON.stringify(bm?.content));

  // ---- C. recovery: the preferred model is healthy again and answers the next request
  stand.mode = "ok";
  const c = await chat("Say hello in one word.");
  evidence.steps.push({ step: "C recovery", providerId: c.body?.assistantMessage?.providerId });
  check("C: back on the preferred model once it is healthy", c.body?.assistantMessage?.providerId === "ollama");

  // ---- evidence: routing history (what the dashboard shows), usage, switches in the audit log, the Groq count
  const h = (await call("GET", "/api/llm/routing/history")).body;
  evidence.routingHistory = h.recent;
  evidence.switchesInAudit = h.switches;
  check("dashboard data: two switches recorded with their reasons", h.recent.filter((r) => r.switched).length === 2 && h.recent.filter((r) => r.switched).every((r) => r.attempts[0].outcome !== "answered" && r.answeredBy?.startsWith("groq/")));
  check("dashboard data: 'answering now' shows the preferred model again", h.current.general?.ref === local.ref, h.current.general?.ref);
  const groqUsed = (await groqToday()) - groqStart;
  evidence.groqRequestsUsed = groqUsed;
  evidence.googleRequestsUsed = 0;
  check(`real Groq requests within the approved ${BUDGET}`, groqUsed >= 2 && groqUsed <= BUDGET, `${groqUsed}`);
  check("Google was never called (switched off in the copy)", Number(((await call("GET", "/api/llm/providers")).body?.providers ?? []).find((p) => p.id === "gemini")?.requestsToday ?? 0) === geminiStart);
  evidence.usage = (await call("GET", "/api/llm/usage?days=1")).body?.usage?.recentProblems;
} catch (e) {
  check("script completed", false, String(e).slice(0, 300));
} finally {
  srv.kill(); fake.close();
  evidence.results = results;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(path.join(ROOT, "docs", "evidence"), { recursive: true });
  writeFileSync(path.join(ROOT, "docs", "evidence", "p41-switching.json"), JSON.stringify(evidence, null, 2));
  await new Promise((r) => setTimeout(r, 800));
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Evidence: docs/evidence/p41-switching.json`);
  if (failed.length) { exitCode = 1; console.log("server log tail:", log.slice(-400)); }
  process.exit(exitCode);
}
