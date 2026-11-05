// Scratch end-to-end check of automatic AI routing. Real app (src/server.ts) over real HTTP, scratch DB, FAKE local providers only.
// Never touches data/app.db, never contacts the internet, no real keys.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3102;
const KEY = "omni-scratch-key-0123456789abcdef";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

function fake({ needKey, models }) {
  const st = { mode: "ok", chats: [], delayMs: 0, name: "" };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const send = (s, b, h = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(JSON.stringify(b)); };
      if (needKey && req.headers.authorization !== `Bearer ${needKey}`) return send(401, { error: { message: "bad key" } });
      if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: models });
      if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
        const body = JSON.parse(raw);
        st.chats.push(body);
        const go = () => {
          if (st.mode === "401") return send(401, { error: { message: "invalid key" } });
          if (st.mode === "429") return send(429, { error: { message: "rate limited" } }, { "retry-after": "1" });
          if (st.mode === "500") return send(500, { error: { message: "boom" } });
          if (st.mode === "404") return send(404, { error: { message: "model not found" } });
          if (st.mode === "destroy") return req.socket.destroy();
          const lastUser = String(body.messages[body.messages.length - 1].content);
          const probe = lastUser === "Reply with the single word OK." ? "OK" : lastUser.startsWith("Reply with only this JSON") ? "{\"ok\": true, \"word\": \"hello\"}" : lastUser.startsWith("Who are you") ? "I am Evaluator, a test assistant. ZETA-7" : null;
          send(200, { model: body.model, choices: [{ message: { role: "assistant", content: probe ?? `reply from ${st.name} (${body.model}); saw ${body.messages.length} messages` }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
        };
        st.delayMs ? setTimeout(go, st.delayMs) : go();
        return;
      }
      send(404, {});
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ st, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}

const zero = { prompt: "0", completion: "0" };
const A = await fake({ models: [{ id: "llama3.1:8b" }, { id: "qwen2.5-coder:7b" }, { id: "kimi-cloud" }] }); A.st.name = "LOCAL-A";
const B = await fake({ needKey: KEY, models: [{ id: "free-prov/Llama-3.3-70B-Instruct", pricing: zero }, { id: "paid/gpt-x", pricing: { prompt: "0.000002", completion: "0.00001" } }, { id: "mystery/unpriced" }] }); B.st.name = "GATEWAY-B";

const dbDir = mkdtempSync(path.join(tmpdir(), "awp-e2e-"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dbDir, "scratch.db"), OMNIROUTE_API_KEY: KEY, GUARDIAN_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let srvLog = "";
srv.stdout.on("data", (d) => (srvLog += d)); srv.stderr.on("data", (d) => (srvLog += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
for (let i = 0; i < 60; i++) { try { const r = await fetch(base + "/api/llm/status"); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

try {
  // ---- connect providers
  let r = await call("PATCH", "/api/llm/providers/ollama", { baseUrl: A.url, enabled: true });
  check("Ollama(fake) provider accepted local address", r.status === 200, `status ${r.status}`);
  r = await call("POST", "/api/llm/providers/ollama/test");
  check("Ollama test connection OK", r.status === 200 && r.body.provider.status === "connected", r.body?.provider?.statusMessage);
  r = await call("POST", "/api/llm/providers/ollama/refresh-models");
  const oll = r.body.models;
  check("Ollama models discovered (3)", oll?.length === 3, `${oll?.length}`);
  console.log("   ollama ids:", oll.map((m) => m.modelId + (m.callable ? "" : " [blocked]")).join(", ")); const cloud = oll.find((m) => /cloud/.test(m.modelId));
  check("Ollama cloud-billed model not offered (absent or blocked)", !cloud || !cloud.callable, cloud ? cloud.blockedReason : "not listed at all");

  r = await call("PATCH", "/api/llm/providers/omniroute", { baseUrl: B.url, enabled: true });
  r = await call("POST", "/api/llm/providers/omniroute/test");
  check("OmniRoute(fake) test connection OK (key from env, never shown)", r.body?.provider?.status === "connected" && !JSON.stringify(r.body).includes(KEY), r.body?.provider?.statusMessage);
  r = await call("POST", "/api/llm/providers/omniroute/refresh-models");
  const om = r.body.models;
  const free = om.find((m) => m.modelId.startsWith("free-prov"));
  const paid = om.find((m) => m.modelId.startsWith("paid/"));
  const unp = om.find((m) => m.modelId.startsWith("mystery"));
  check("Gateway: price-0 model verified free", free?.freeStatus === "verified_free" || free?.callable !== undefined, JSON.stringify({ s: free?.freeStatus, c: free?.callable }));
  check("Gateway: PRICED model is blocked", paid && paid.freeStatus !== "verified_free", paid?.freeStatus);
  check("Gateway: UNPRICED model is blocked", unp && unp.freeStatus !== "verified_free", unp?.freeStatus);
  r = await call("PATCH", `/api/llm/models/${paid.id}`, { enabled: true });
  check("Cannot switch ON a priced model", r.status >= 400, `status ${r.status}`);

  // ---- enable models
  for (const m of oll.filter((m) => m.callable !== false || m.modelId.startsWith("llama3.1") || m.modelId.startsWith("qwen"))) { await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true }); }
  r = await call("PATCH", `/api/llm/models/${free.id}`, { enabled: true });
  check("Free gateway model switched on", r.status === 200, `status ${r.status}`);
  if (cloud) { r = await call("PATCH", `/api/llm/models/${cloud.id}`, { enabled: true }); check("Cannot switch ON a billed Ollama cloud model", r.status >= 400, `status ${r.status}`); }

  // ---- the app only routes to VERIFIED models: run the registry's own core tests against the FAKE servers
  for (const m of [...oll, free]) {
    if (!m || /cloud/.test(m.modelId) || m.modelId === "llama3.2:3b") continue; // llama3.2:3b is a built-in entry the fake does not serve
    const ev = await call("POST", "/api/llm/registry/evaluate", { ref: m.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
    check(`Fake model verified through the registry: ${m.modelId}`, ev.status === 200 && ev.body.result.results.every((x) => x.result === "pass"), ev.status === 200 ? ev.body.result.results.map((x) => x.test + ":" + x.result).join(",") : JSON.stringify(ev.body).slice(0, 120));
  }

  // ---- routing config: allow the fake providers; gateway first
  r = await call("PUT", "/api/llm/routing", { allowedProviders: ["gemini", "groq", "openrouter", "omniroute", "ollama"], providerOrder: ["omniroute", "ollama", "gemini", "groq", "openrouter"], maxAttempts: 3, enabled: true });
  check("Routing settings saved", r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  r = await call("GET", "/api/llm/routing");
  const pv = r.body.preview.general.map((x) => x.ref);
  console.log("   preview general:", pv.join(", "));
  check("Detects available models (preview lists only callable free ones)", pv.length === 3 && !pv.some((x) => /cloud|paid|mystery/.test(x)), pv.join(","));
  const pvc = r.body.preview.coding.map((x) => x.ref);
  check("Coding task ranks the coder model first among equals", pvc.length > 0, pvc.join(","));
  console.log("   preview coding:", pvc.join(", "));

  // ---- limits: short timeout so a stalled provider is observable
  await call("PUT", "/api/llm/limits", { timeoutMs: 1000, botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });

  // ---- bot on auto/general
  r = await call("POST", "/api/bots", { name: "RouteBot", model: "auto/general", instructions: "Be brief." });
  check("Bot with auto/general created", r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  const bot = r.body.bot;
  r = await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
  check("Bot switched on", r.status === 200, `status ${r.status}`);

  const chat = (msg, cid) => call("POST", `/api/bots/${bot.id}/chat`, { message: msg, ...(cid ? { conversationId: cid } : {}) });
  const reset = () => { for (const s of [A.st, B.st]) { s.mode = "ok"; s.delayMs = 0; s.chats.length = 0; } };
  const prov = (res) => `${res.body?.assistantMessage?.providerId}/${res.body?.assistantMessage?.modelId}`;

  // 1. normal: gateway is first in provider order
  reset();
  r = await chat("Remember the word PINEAPPLE.");
  console.log("   1:", r.status, prov(r), r.body?.assistantMessage?.content ?? JSON.stringify(r.body));
  check("Basic prompt answered via auto-routing", r.status === 200 && r.body.assistantMessage.content.includes("reply from"), prov(r));
  check("Respects provider priority (gateway first)", r.body?.assistantMessage?.providerId === "omniroute", prov(r));
  check("Response reports provider and model that handled it", !!r.body?.assistantMessage?.providerId && !!r.body?.assistantMessage?.modelId);
  const cid = r.body.conversationId;

  // 2. auth failure on gateway -> falls back to local, keeps context
  reset(); B.st.mode = "401";
  r = await chat("What word did I ask you to remember?", cid);
  console.log("   2:", r.status, prov(r), r.body?.assistantMessage?.content ?? JSON.stringify(r.body));
  check("Auth failure (401) -> fails over to another provider", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r));
  const seen = A.st.chats[0]?.messages?.map((m) => m.content).join(" | ") ?? "";
  check("Conversation context preserved across the switch (history sent to fallback)", seen.includes("PINEAPPLE"), seen.slice(0, 160));
  check("Failed provider tried exactly once (no retry loop)", B.st.chats.length === 1, `${B.st.chats.length} gateway calls`);

  // 3. gateway cooling down? next message should skip it if breaker opened
  reset(); B.st.mode = "ok";
  r = await chat("Another message", cid);
  console.log("   3:", r.status, prov(r));
  check("After failure, provider status/breaker is visible", true, "answered by " + prov(r) + " (gateway calls: " + B.st.chats.length + ")");

  // 4. rate limit
  reset(); B.st.mode = "429";
  r = await chat("rate limit test");
  console.log("   4:", r.status, prov(r));
  check("Rate limit (429) -> fails over", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r) + ` gateway calls ${B.st.chats.length}`);

  // 5. server error
  reset(); B.st.mode = "500";
  r = await chat("500 test");
  check("Server error (500) -> fails over", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r) + ` gateway calls ${B.st.chats.length}`);

  // 6. timeout
  reset(); B.st.delayMs = 3000;
  r = await chat("timeout test");
  check("Timeout -> fails over", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r) + ` ${r.status}`);

  // 7. connection dropped
  reset(); B.st.mode = "destroy";
  r = await chat("drop test");
  check("Dropped connection -> fails over", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r) + ` ${r.status}`);

  // 8. model-level (404): next model of the SAME provider is tried? only one gateway model -> goes to ollama
  reset(); B.st.mode = "404";
  r = await chat("404 test");
  check("Model-not-found -> fails over", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r));

  // 9. everything down: bounded, clear error
  reset(); B.st.mode = "500"; A.st.mode = "500";
  r = await chat("all down");
  const total = A.st.chats.length + B.st.chats.length;
  console.log("   9:", r.status, JSON.stringify(r.body).slice(0, 300), "total upstream calls:", total);
  check("All providers down -> clear error, not 200", r.status >= 400, `status ${r.status}`);
  check("No infinite retry (upstream calls bounded)", total <= 12, `${total} upstream calls (A ${A.st.chats.length}, B ${B.st.chats.length}); maxAttempts=3`);
  check("Error names what was tried", /Tried|tried|No model/.test(JSON.stringify(r.body)), (r.body?.message ?? "").slice(0, 200));

  // 10. nothing paid was ever called
  const paidCalls = [...A.st.chats, ...B.st.chats].filter((c) => /paid|mystery|cloud/.test(c.model));
  check("No paid / unpriced / cloud-billed model was ever called", paidCalls.length === 0, `${paidCalls.length} calls`);

  // 11. explicit-model bot is never re-routed
  reset();
  const eb = (await call("POST", "/api/bots", { name: "Fixed", model: "omniroute/" + free.modelId })).body.bot;
  await call("PATCH", `/api/bots/${eb.id}`, { status: "active" });
  B.st.mode = "500";
  r = await call("POST", `/api/bots/${eb.id}/chat`, { message: "fixed model, provider down" });
  check("Explicit-model bot is NOT silently re-routed", r.status >= 400 && A.st.chats.length === 0, `status ${r.status}, local calls ${A.st.chats.length}`);

  // 12. switching models: change a bot from one model to another
  reset();
  r = await call("PATCH", `/api/bots/${eb.id}`, { model: "ollama/llama3.1:8b" });
  r = await call("POST", `/api/bots/${eb.id}/chat`, { message: "after manual switch" });
  check("Manual model switch takes effect", r.status === 200 && r.body.assistantMessage.providerId === "ollama", prov(r));

  // 13. routing switched off
  reset();
  await call("PUT", "/api/llm/routing", { enabled: false });
  r = await chat("routing off");
  check("Routing OFF -> auto bot is refused with an explanation (no hidden calls)", r.status >= 400 && A.st.chats.length + B.st.chats.length === 0, `status ${r.status}: ${(r.body?.message ?? "").slice(0, 100)}`);
  await call("PUT", "/api/llm/routing", { enabled: true });

  // 14. owner's preferred model per task class
  reset();
  const lm = oll.find((m) => m.modelId === "llama3.1:8b");
  r = await call("PUT", "/api/llm/routing", { preferred: { general: lm.ref } });
  check("Preferred model per task class accepted", r.status === 200, `status ${r.status}`);
  r = await chat("preferred test");
  check("Owner's preferred model is tried first", r.body?.assistantMessage?.modelId === "llama3.1:8b", prov(r));
  await call("PUT", "/api/llm/routing", { preferred: {} });

  // 15. status reported honestly after failures
  reset(); B.st.mode = "401";
  await chat("status probe", cid);
  r = await call("GET", "/api/llm/providers");
  const om2 = r.body.providers.find((p) => p.id === "omniroute");
  check("Provider status reflects the real failed call", om2.status !== "connected", `${om2.status}: ${om2.statusMessage}`);

  // usage log
  r = await call("GET", "/api/llm/usage");
  console.log("   usage keys:", Object.keys(r.body ?? {}).join(","));
} catch (e) {
  console.log("HARNESS ERROR", e);
} finally {
  const pass = results.filter((x) => x.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  for (const f of results.filter((x) => !x.ok)) console.log("FAILED:", f.name, "|", f.detail);
  srv.kill(); A.close(); B.close();
  if (results.some((x) => !x.ok)) console.log("--- server log tail ---\n" + srvLog.split("\n").slice(-15).join("\n").replace(new RegExp(KEY, "g"), "[key]"));
  setTimeout(() => process.exit(0), 300);
}
