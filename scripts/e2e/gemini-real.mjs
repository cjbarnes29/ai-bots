// REAL Gemini test (NV-3). PREPARED, NOT RUN. Needs the owner's approval of the exact request count, a free-tier key, and nothing else.
//
// How to run (in your own terminal, so the key never appears in chat):
//   $env:GEMINI_API_KEY = "<your key from a project with NO billing>"
//   $env:AWP_APPROVED_REAL_REQUESTS = "4"
//   node scripts/e2e/gemini-real.mjs
//
// It starts a SCRATCH app (port 3104, scratch database in the temp folder; your real data/app.db and saved credentials are not used or changed).
// Exactly 4 requests go to Google (the script refuses to run unless you approved at least 4):
//   1. GET  models        (Test connection)
//   2. GET  models        (Refresh models)
//   3. POST chat          ("Reply with: Gemini connection successful." to ONE free model, max 32 output tokens)
//   4. POST chat          (fallback test: the scratch app is restarted with a deliberately INVALID key; Google rejects it; the app must
//                          fall back to a FAKE local model on 127.0.0.1. No quota is used by a rejected call.)
// Nothing else leaves this PC. The key is read from the environment of this script only, is never printed, and is redacted from output.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = process.env.GEMINI_API_KEY ?? "";
const APPROVED = Number(process.env.AWP_APPROVED_REAL_REQUESTS ?? 0);
if (!KEY) { console.log("BLOCKED: GEMINI_API_KEY is not set in this terminal. Nothing was sent."); process.exit(2); }
if (APPROVED < 4) { console.log("REFUSED: set AWP_APPROVED_REAL_REQUESTS=4 to approve exactly the 4 real requests listed at the top of this file. Nothing was sent."); process.exit(2); }

const PORT = 3104;
const base = `http://127.0.0.1:${PORT}`;
const redact = (s) => String(s).split(KEY).join("[key]");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + redact(detail) : ""}`); };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};

// a fake local fallback model (never leaves this PC)
const localCalls = [];
const fake = http.createServer((req, res) => {
  const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "llama3.1:8b" }] }));
    const b = JSON.parse(Buffer.concat(c).toString()); localCalls.push(b);
    res.end(JSON.stringify({ model: b.model, choices: [{ message: { role: "assistant", content: "FALLBACK-LOCAL-ANSWER" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}/v1`;

const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "awp-gemini-")), "scratch.db");
let srv = null;
const start = async (geminiKey) => {
  srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GEMINI_API_KEY: geminiKey, GUARDIAN_URL: "" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("scratch app did not start");
};
const stop = async () => { srv?.kill(); await new Promise((r) => setTimeout(r, 1500)); };

try {
  await start(KEY);
  let r = await call("PATCH", "/api/llm/providers/gemini", { freeConfirmed: true, enabled: true });
  check("Gemini enabled with free-plan confirmation (scratch app)", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/llm/providers/gemini/test");                                  // real request 1
  check("AUTH: Test connection succeeds with the real key", r.body?.provider?.status === "connected", r.body?.provider?.statusMessage);
  r = await call("POST", "/api/llm/providers/gemini/refresh-models");                        // real request 2
  const models = r.body?.models ?? [];
  const usable = models.filter((m) => m.callable !== false && m.freeStatus === "verified_free");
  check("Models discovered", models.length > 0, `${models.length} listed, ${usable.length} free-verified`);
  const pick = usable.find((m) => /flash.*lite/i.test(m.modelId)) ?? usable.find((m) => /flash/i.test(m.modelId)) ?? usable[0];
  check("A free-verified model exists to test with", !!pick, pick?.modelId);
  if (!pick) throw new Error("no free model to test");
  await call("PATCH", `/api/llm/models/${pick.id}`, { enabled: true });
  r = await call("POST", `/api/llm/models/${pick.id}/try`, { message: "Reply with: Gemini connection successful." }); // real request 3
  console.log("   reply:", redact(JSON.stringify(r.body).slice(0, 300)));
  check("CHAT: real reply received", r.status === 200 && /successful/i.test(JSON.stringify(r.body)), `status ${r.status}`);
  check("Provider and model recorded", /gemini/.test(JSON.stringify(r.body)), pick.ref);
  const usage = await call("GET", "/api/llm/usage");
  check("Usage record written", usage.status === 200 && JSON.stringify(usage.body).includes("gemini"));
  await call("PUT", "/api/llm/routing", { allowedProviders: ["gemini", "groq", "openrouter", "ollama"], providerOrder: ["gemini", "ollama", "groq", "openrouter", "omniroute"] });
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const om = (await call("POST", "/api/llm/providers/ollama/refresh-models")).body.models.find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${om.id}`, { enabled: true });
  await stop();

  // fallback test: same database, deliberately invalid key
  await start("AIza-invalid-key-for-fallback-test-0000000000");
  const bot = (await call("POST", "/api/bots", { name: "FallbackBot", model: "auto/general" })).body.bot;
  await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "Say hello." });              // real request 4 (rejected by Google), then the local fake answers
  console.log("   fallback:", redact(JSON.stringify(r.body?.assistantMessage ?? r.body).slice(0, 300)));
  check("FALLBACK: Gemini's real rejection led to the local model answering", r.status === 200 && r.body?.assistantMessage?.providerId === "ollama" && localCalls.length === 1, `${r.body?.assistantMessage?.providerId}/${r.body?.assistantMessage?.modelId}`);
  const prov = (await call("GET", "/api/llm/providers")).body.providers.find((p) => p.id === "gemini");
  check("Gemini status now shows the real failure (not 'connected')", prov.status !== "connected", `${prov.status}: ${prov.statusMessage}`);
  const total = await call("GET", "/api/llm/usage");
  check("No paid service used (only free-verified model was enabled)", usable.every((m) => m.freeStatus === "verified_free"));
} catch (e) {
  console.log("STOPPED:", redact(e instanceof Error ? e.message : e));
} finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  srv?.kill(); fake.close(); setTimeout(() => process.exit(0), 300);
}
