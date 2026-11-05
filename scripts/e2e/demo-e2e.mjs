// Scratch end-to-end check of Demo mode: the real app over real HTTP, scratch database, NO network, NO keys.
// Usage: node scripts/e2e/demo-e2e.mjs   (needs free port 3105)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.DEMO_E2E_PORT ?? 3105);
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return null; };

const env = { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(mkdtempSync(path.join(tmpdir(), "awp-demo-")), "s.db"), GUARDIAN_URL: "" };
for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "OMNIROUTE_API_KEY"]) delete env[k];
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

try {
  let r = await call("GET", "/api/demo");
  check("Before setup: demo not ready, nothing created", r.body.ready === false && r.body.bots.every((b) => !b.id) && r.body.workflows.every((w) => !w.id));
  r = await call("GET", "/api/llm/providers");
  const p0 = r.body.providers.find((p) => p.id === "demo");
  check("Demo provider is listed, simulated, off by default", p0?.simulated === true && p0.enabled === false);

  r = await call("POST", "/api/demo/setup");
  check("Setup succeeds", r.status === 200 && r.body.ready === true, `status ${r.status}`);
  const again = await call("POST", "/api/demo/setup");
  check("Setup twice creates no duplicates", (await call("GET", "/api/bots")).body.bots.length === 4 && (await call("GET", "/api/workflows")).body.workflows.length === 2 && again.status === 200);

  const bots = (await call("GET", "/api/bots")).body.bots;
  const writer = bots.find((b) => b.name === "Demo: Writer");
  r = await call("POST", `/api/bots/${writer.id}/chat`, { message: "Explain tides" });
  const text = r.body?.assistantMessage?.content ?? "";
  check("Chat reply is plainly marked as simulated", text.startsWith("[SIMULATED RESPONSE - no real AI was used]"), text.split("\n")[0]);
  check("Reply records provider demo", r.body?.assistantMessage?.providerId === "demo");
  const cid = r.body.conversationId;
  r = await call("POST", `/api/bots/${writer.id}/chat`, { message: "And the moon?", conversationId: cid });
  check("Conversation history reaches the model (2nd reply sees 2 earlier messages)", /Earlier messages in this conversation: 2/.test(r.body?.assistantMessage?.content ?? ""));

  // Workflow: runs to the checkpoint, approve, completes
  const wfs = (await call("GET", "/api/workflows")).body.workflows;
  const pipe = wfs.find((w) => w.name.includes("Research, write, review"));
  const run = (await call("POST", `/api/workflows/${pipe.id}/run`, { input: "tides" })).body.run;
  const waiting = await until(async () => { const x = (await call("GET", `/api/workflows/runs/${run.id}`)).body.run; return x.status === "waiting" ? x : null; });
  check("Pipeline reaches the human checkpoint", !!waiting);
  check("Every AI box output is marked simulated", waiting && waiting.steps.filter((s) => s.type === "bot_task").every((s) => (s.output ?? "").startsWith("[SIMULATED")));
  check("Data flows between boxes ({{research.output}} reached the writer)", waiting && waiting.steps.find((s) => s.nodeId === "write").output.includes("SIMULATED RESPONSE"));
  await call("POST", `/api/workflows/runs/${run.id}/steps/decide/approve`);
  const fin = await until(async () => { const x = (await call("GET", `/api/workflows/runs/${run.id}`)).body.run; return ["completed", "failed"].includes(x.status) ? x : null; });
  check("Approving the checkpoint completes the run", fin?.status === "completed", fin?.status);

  // Failing workflow
  const failing = wfs.find((w) => w.name.includes("Where did it fail"));
  const frun = (await call("POST", `/api/workflows/${failing.id}/run`, { input: "x" })).body.run;
  const ff = await until(async () => { const x = (await call("GET", `/api/workflows/runs/${frun.id}`)).body.run; return ["completed", "failed"].includes(x.status) ? x : null; });
  const broken = ff?.steps.find((s) => s.nodeId === "broken");
  check("Failure run: fails at the intended box, earlier box fine", ff?.status === "failed" && broken?.status === "failed" && ff.steps.find((s) => s.nodeId === "first").status === "completed");
  check("Failure explains itself", /Simulated failure/.test(broken?.error ?? ""), broken?.error?.slice(0, 80));

  // Routing: demo is NOT chosen automatically
  r = await call("POST", "/api/bots", { name: "Auto bot", model: "auto/general" });
  await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" });
  const auto = await call("POST", `/api/bots/${r.body.bot.id}/chat`, { message: "hi" });
  check("Automatic routing refuses to fall back to the simulated provider by itself", auto.status >= 400 && /No eligible free model/.test(JSON.stringify(auto.body)), `status ${auto.status}`);
  await call("PUT", "/api/llm/routing", { allowedProviders: ["demo"] });
  const auto2 = await call("POST", `/api/bots/${r.body.bot.id}/chat`, { message: "hi" });
  check("...but uses it once the owner ticks it, still marked simulated", auto2.status === 200 && auto2.body.assistantMessage.content.startsWith("[SIMULATED"));
  await call("PUT", "/api/llm/routing", { allowedProviders: [] });

  // Manager with the demo AI: must not pretend to succeed
  r = await call("POST", "/api/manager/runs", { goal: "Plan a small project" });
  const mid = r.body?.run?.id;
  const mrun = mid ? await until(async () => { const x = (await call("GET", `/api/manager/runs/${mid}`)).body; const st = (x.run ?? x).status; return ["completed", "failed", "budget_exhausted", "cancelled", "interrupted"].includes(st) ? (x.run ?? x) : null; }, 30000) : null;
  console.log("   manager status:", r.status, mrun?.status, JSON.stringify(mrun?.result ?? mrun?.error ?? r.body).slice(0, 220));
  check("Manager with the Demo AI: no real AI claimed (result, if any, carries the simulated mark or the run failed)", r.status >= 400 || !mrun || mrun.status !== "completed" || String(mrun.result).includes("SIMULATED"), mrun?.status ?? `http ${r.status}`);

} catch (e) { console.log("HARNESS ERROR", e); }
finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  srv.kill(); setTimeout(() => process.exit(0), 300);
}
