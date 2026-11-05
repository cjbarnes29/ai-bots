// Scratch end-to-end: MCP discovery (no tool run) and n8n webhook through the approval gate. Real app over HTTP, scratch DB, FAKE local servers only.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3103;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };
const listen = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => r({ s, port: s.address().port })); });
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

// --- fake MCP
const mcpSeen = [];
const mcp = await listen(async (req, res) => {
  const raw = await readBody(req); const m = raw ? JSON.parse(raw) : {};
  mcpSeen.push(m.method ?? req.method);
  const send = (s, b, h = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(typeof b === "string" ? b : JSON.stringify(b)); };
  if (req.headers.authorization !== "Bearer mcp-test-token") return send(401, {});
  if (m.method === "initialize") return send(200, { jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }, { "mcp-session-id": "s1" });
  if (m.method === "notifications/initialized") return send(202, "");
  if (m.method === "tools/list") return send(200, { jsonrpc: "2.0", id: m.id, result: { tools: [
    { name: "read_note", description: "Read a note by id", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "delete_everything", description: "Dangerous test tool", inputSchema: { type: "object", properties: {} } } ] } });
  send(200, { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "EXECUTED" }] } });
});
// --- fake n8n webhook
const n8nSeen = [];
const n8n = await listen(async (req, res) => { n8nSeen.push({ url: req.url, body: await readBody(req) }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "Workflow was started" })); });
// --- fake AI (Ollama): says whatever the script says
const fence = "```";
let aiScript = [];
const aiCalls = [];
const ai = await listen(async (req, res) => {
  const raw = await readBody(req);
  const send = (b) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.url.endsWith("/models")) return send({ data: [{ id: "llama3.1:8b" }] });
  const body = JSON.parse(raw); aiCalls.push(body);
  const text = aiScript.shift() ?? "done";
  send({ model: body.model, choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
});

const dbDir = mkdtempSync(path.join(tmpdir(), "awp-e2e2-"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dbDir, "s.db"), GUARDIAN_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };

try {
  // AI model
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: `http://127.0.0.1:${ai.port}/v1`, enabled: true });
  const mr = await call("POST", "/api/llm/providers/ollama/refresh-models");
  const m = mr.body.models.find((x) => x.modelId === "llama3.1:8b"); await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });

  // MCP: before saving anything it is "not set up"
  let r = await call("GET", "/api/integrations");
  check("MCP starts as not set up", r.body.integrations.find((i) => i.id === "mcp").status === "not_set_up");
  r = await call("PUT", "/api/vault/MCP_SERVER_URL", { value: `http://127.0.0.1:${mcp.port}` });
  await call("PUT", "/api/vault/MCP_SERVER_TOKEN", { value: "mcp-test-token" });
  r = await call("POST", "/api/integrations/mcp/verify");
  console.log("   MCP verify:", r.status, JSON.stringify(r.body).slice(0, 300));
  check("MCP Test connection succeeds (initialize + tools/list)", r.status === 200 && JSON.stringify(r.body).includes("2 tools"));
  check("MCP discovery executed NO tool", !mcpSeen.includes("tools/call"), mcpSeen.join(","));
  check("Token never echoed", !JSON.stringify(r.body).includes("mcp-test-token"));

  // MCP: wrong token
  await call("PUT", "/api/vault/MCP_SERVER_TOKEN", { value: "wrong-token" });
  r = await call("POST", "/api/integrations/mcp/verify");
  check("MCP wrong token reported plainly (not 'connected')", JSON.stringify(r.body).includes("did not accept") || (r.body?.ok === false), JSON.stringify(r.body).slice(0, 200));
  await call("PUT", "/api/vault/MCP_SERVER_TOKEN", { value: "mcp-test-token" });

  // Can a bot SEE tool descriptions and SCHEMAS? (list_tools action through a bot)
  const bot = (await call("POST", "/api/bots", { name: "Tester", model: "ollama/llama3.1:8b" })).body.bot;
  await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  await call("PUT", `/api/bots/${bot.id}/integrations`, { connectors: ["mcp", "n8n"] });
  const runTask = async (script) => {
    aiScript = script; aiCalls.length = 0;
    const t = await call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "go" });
    await waitFor(async () => (await call("GET", "/api/tasks")).body.tasks.every((x) => ["completed", "failed"].includes(x.status)));
  };
  const act = (connector, action, args) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
  await runTask([act("mcp", "list_tools", {}), "ok"]);
  const told = JSON.stringify(aiCalls[1]?.messages ?? []);
  console.log("   bot was told:", (aiCalls[1]?.messages?.at(-1)?.content ?? "").slice(0, 300));
  check("Bot can discover MCP tool NAMES and descriptions", told.includes("read_note") && told.includes("Read a note by id"));
  check("Bot can see tool input SCHEMAS", told.includes("arguments: id:string*"), "schemas are not surfaced in list_tools");

  // MCP call_tool is a write: must wait for approval and NOT run
  await runTask([act("mcp", "call_tool", { tool: "delete_everything", arguments: {} }), "waiting"]);
  const pend = (await call("GET", "/api/approvals?status=pending")).body.approvals;
  check("call_tool waits for approval (pending)", pend.some((a) => /MCP|tool/i.test(a.summary)), pend.map((a) => a.summary).join("; ").slice(0, 160));
  check("call_tool did NOT run", !mcpSeen.includes("tools/call"));
  for (const a of pend) await call("POST", `/api/approvals/${a.id}/deny`, {});
  check("Denied call_tool still not executed", !mcpSeen.includes("tools/call"));

  // n8n: not testable without starting
  await call("PUT", "/api/vault/N8N_WEBHOOK_URL", { value: `http://127.0.0.1:${n8n.port}/webhook-test/abc` });
  r = await call("GET", "/api/integrations");
  const ni = r.body.integrations.find((i) => i.id === "n8n");
  check("n8n marked not testable (honest; no verify without firing)", ni.testable === false, `status ${ni.status}`);
  await runTask([act("n8n", "start_workflow", { text: "e2e hello" }), "waiting"]);
  check("n8n start_workflow waits for approval, webhook NOT hit yet", n8nSeen.length === 0);
  const p2 = (await call("GET", "/api/approvals?status=pending")).body.approvals;
  check("approval shown for n8n", p2.length === 1, p2.map((a) => a.summary).join("; ").slice(0, 160));
  r = await call("POST", `/api/approvals/${p2[0].id}/approve`, {});
  const hit = await waitFor(() => n8nSeen.length > 0);
  check("After approval the webhook is called exactly once", n8nSeen.length === 1, JSON.stringify(n8nSeen[0] ?? {}).slice(0, 160));
  const ap = (await call("GET", `/api/approvals/${p2[0].id}`)).body;
  check("Response handled and recorded", /started|executed|ok/i.test(JSON.stringify(ap)), JSON.stringify(ap).slice(0, 250));

  // n8n unsafe address refused
  await call("PUT", "/api/vault/N8N_WEBHOOK_URL", { value: "http://evil.example.com/hook" });
  r = await call("GET", "/api/integrations");
  check("n8n refuses a non-https public address", r.body.integrations.find((i) => i.id === "n8n").status !== "ready", r.body.integrations.find((i) => i.id === "n8n").notReady);
} catch (e) { console.log("HARNESS ERROR", e); }
finally {
  const pass = results.filter((x) => x.ok).length; console.log(`\n${pass}/${results.length} passed`);
  srv.kill(); mcp.s.close(); n8n.s.close(); ai.s.close(); setTimeout(() => process.exit(0), 300);
}
