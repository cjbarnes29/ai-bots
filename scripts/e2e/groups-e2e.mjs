// End-to-end check of groups, the Workforce Board, collaboration and model switching inside a group.
// The real app (src/server.ts) over real HTTP and a real Edge browser, scratch database, FAKE local model servers only.
// No internet, no keys, never touches data/app.db.  Usage: node scripts/e2e/groups-e2e.mjs   (needs port 3106; builds web/dist first)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-groups-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3106;
const KEY = "omni-scratch-key-0123456789abcdef";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

/** A fake OpenAI-compatible server. mode: ok | 500 | 429. It answers the registry's probes, the decision prompts and ordinary tasks. */
function fake({ name, needKey, models }) {
  const st = { mode: "ok", calls: [], name };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const send = (s, b, h = {}) => { res.writeHead(s, { "content-type": "application/json", ...h }); res.end(JSON.stringify(b)); };
      if (needKey && req.headers.authorization !== `Bearer ${needKey}`) return send(401, { error: { message: "bad key" } });
      if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: models });
      if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const lastUser = String(body.messages.at(-1).content);
        const all = body.messages.map((m) => m.content).join("\n");
        const probe = lastUser === "Reply with the single word OK." || lastUser.startsWith("Reply with only this JSON") || lastUser.startsWith("Who are you");
        if (!probe) st.calls.push({ messages: body.messages });
        if (!probe && st.mode === "500") return send(500, { error: { message: "boom" } });
        if (!probe && st.mode === "429") return send(429, { error: { message: "rate limited" } }, { "retry-after": "1" });
        let content;
        if (lastUser === "Reply with the single word OK.") content = "OK";
        else if (lastUser.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
        else if (lastUser.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
        else if (all.includes('"views":[')) content = JSON.stringify({ views: all.includes('You are "Ravi"') ? [{ option: 1, stance: "oppose", reasoning: "It is slow and the cost is high for a first step." }] : [{ option: 1, stance: "support", reasoning: "This is the cheapest way to learn quickly." }] });
        else if (all.includes('"options":[')) { const who = all.includes('You are "Ravi"') ? "Ravi" : "Sara"; content = JSON.stringify({ options: [{ title: `${who}: desk research first`, details: "Start with public data.", pros: "Cheap", cons: "Less detail" }, { title: `${who}: paid survey`, details: "Ask 200 people.", pros: "Fresh data", cons: "Slow and costly" }] }); }
        else content = `Reply from ${st.name}: finished. (saw ${body.messages.length} messages)`;
        return send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
      }
      send(404, {});
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ st, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}
const zero = { prompt: "0", completion: "0" };
const A = await fake({ name: "LOCAL-A", models: [{ id: "llama3.1:8b" }] });
const B = await fake({ name: "GATEWAY-B", needKey: KEY, models: [{ id: "free-prov/Llama-3.3-70B-Instruct", pricing: zero }, { id: "paid/gpt-x", pricing: { prompt: "0.000002", completion: "0.00001" } }] });

const dbDir = mkdtempSync(path.join(tmpdir(), "awp-groups-"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dbDir, "scratch.db"), OMNIROUTE_API_KEY: KEY, GUARDIAN_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };

let browser;
try {
  // ---- providers: a local fake and a gateway fake, both verified through the registry's own core tests
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: A.url, enabled: true });
  await call("POST", "/api/llm/providers/ollama/test");
  const oll = (await call("POST", "/api/llm/providers/ollama/refresh-models")).body.models;
  await call("PATCH", "/api/llm/providers/omniroute", { baseUrl: B.url, enabled: true });
  await call("POST", "/api/llm/providers/omniroute/test");
  const om = (await call("POST", "/api/llm/providers/omniroute/refresh-models")).body.models;
  const local = oll.find((m) => m.modelId === "llama3.1:8b");
  const free = om.find((m) => m.modelId.startsWith("free-prov"));
  const paid = om.find((m) => m.modelId.startsWith("paid/"));
  for (const m of [local, free]) { await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true }); const ev = await call("POST", "/api/llm/registry/evaluate", { ref: m.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 }); check(`fake model verified: ${m.modelId}`, ev.status === 200 && ev.body.result.results.every((x) => x.result === "pass")); }
  check("a priced gateway model cannot be switched on", (await call("PATCH", `/api/llm/models/${paid.id}`, { enabled: true })).status >= 400);
  await call("PUT", "/api/llm/routing", { allowedProviders: ["omniroute", "ollama"], providerOrder: ["ollama", "omniroute"], maxAttempts: 3, enabled: true });
  await call("PUT", "/api/llm/limits", { timeoutMs: 5000, botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const mk = async (name, role, resp) => { const r = await call("POST", "/api/bots", { name, role, responsibilities: resp, model: "auto/general", instructions: "Be brief." }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const sara = await mk("Sara", "Market researcher", ["market research", "competitor analysis"]);
  const ravi = await mk("Ravi", "Survey analyst", ["market research surveys", "customer research"]);
  check("two bots on automatic routing", !!sara && !!ravi);

  // ---- groups are OFF by default
  check("groups are off on a fresh database", (await call("GET", "/api/groups")).body?.error === "groups_disabled");

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/groups")) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(base, "")}`); });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  const vis = async (loc, t = 10000) => { try { await loc.first().waitFor({ state: "visible", timeout: t }); return true; } catch { return false; } };

  // ---- Groups page: switch on, create, add members, set responsibilities
  await page.goto(base + "/groups");
  check("Groups page shows the off state", await vis(page.getByText("Groups are switched off.")));
  await page.getByRole("button", { name: "Switch groups on" }).click();
  check("owner switches groups on", await vis(page.getByLabel("New group name")) && (await call("GET", "/api/groups/status")).body.enabled === true);
  await page.getByLabel("New group name").fill("Research crew");
  await page.getByRole("button", { name: "Create group" }).click();
  check("group created and listed", await vis(page.getByRole("button", { name: "Open group Research crew" })));
  await page.getByRole("button", { name: "Open group Research crew" }).click();
  for (const b of [sara, ravi]) { await page.getByLabel("Bot to add").selectOption(b.id); await page.getByRole("button", { name: "Add to group" }).click(); await vis(page.getByLabel(`Member ${b.name}`)); }
  check("both bots are members", (await page.getByRole("listitem", { name: /^Member / }).count()) === 2);
  await page.getByRole("textbox", { name: "Responsibility of Sara" }).fill("Owns competitor analysis");
  await page.getByRole("button", { name: "Save responsibility of Sara" }).click();
  check("responsibility saved", await vis(page.getByText("Responsible for: Owns competitor analysis")));
  const grp = (await call("GET", "/api/groups")).body.groups[0];
  const perms = (await call("GET", `/api/bots/${sara.id}`)).body.bot.permissions;
  check("joining granted no permission", perms.every((p) => p.readEnabled === false && p.writePolicy === "approval_required"));
  await call("PATCH", `/api/groups/${grp.id}`, { participationMode: "all_invited" });
  await shot("groups-detail");

  // ---- model switching inside a group: the local provider fails, the gateway answers, context and usage are kept
  B.st.mode = "500"; // automatic routing prefers the gateway; when it fails the local provider must take over
  const before = { a: A.st.calls.length, b: B.st.calls.length };
  await page.reload();
  await page.getByRole("button", { name: "Open group Research crew" }).click();
  await page.getByLabel("Group message").fill("Everyone: summarise the competitor landscape.");
  await page.getByRole("button", { name: "Send" }).click();
  const gotResults = await until(async () => { const m = (await call("GET", `/api/groups/${grp.id}/messages`)).body.messages; return m.filter((x) => x.kind === "task_result").length >= 2 ? m : null; });
  check("both bots answered in the group although the first provider failed", !!gotResults);
  check("the answers came from the local provider after the gateway failed", gotResults?.filter((x) => x.kind === "task_result").every((x) => /LOCAL-A/.test(x.content)), gotResults?.filter((x) => x.kind === "task_result").map((x) => x.content.slice(0, 40)).join(" | "));
  check("the failing provider was tried, then the other one", A.st.calls.length > before.a && B.st.calls.length > before.b, `A+${A.st.calls.length - before.a} B+${B.st.calls.length - before.b}`);
  const ctx = JSON.stringify(A.st.calls.at(-1).messages);
  check("the group conversation reached the fallback model", ctx.includes("summarise the competitor landscape") && /DATA from the group/.test(ctx));
  check("the paid model was never called", !B.st.calls.some((c) => JSON.stringify(c).includes("paid/gpt-x")));
  const usage = await call("GET", "/api/llm/usage");
  check("usage is recorded for the switch (failure and success)", JSON.stringify(usage.body).includes("omniroute") && JSON.stringify(usage.body).includes("ollama"));
  await page.reload();
  await page.getByRole("button", { name: "Open group Research crew" }).click();
  check("group page shows the bots' results", await vis(page.getByText(/LOCAL-A: finished/)));
  B.st.mode = "ok";

  // ---- handoff needs the allow-list
  await page.getByLabel("Handoff from").selectOption(sara.id);
  await page.getByLabel("Handoff to").selectOption(ravi.id);
  await page.getByLabel("Handoff instruction").fill("Please survey 20 customers");
  await page.getByRole("button", { name: "Hand over" }).click();
  check("handoff refused without a delegation entry, with the reason", await vis(page.getByRole("alert").filter({ hasText: /not allowed to hand work/ })));
  await call("PUT", `/api/bots/${sara.id}/delegation`, { targetBotIds: [ravi.id] });
  await page.getByRole("button", { name: "Hand over" }).click();
  check("handoff works once the allow-list allows it", await until(async () => (await call("GET", `/api/groups/${grp.id}/activity`)).body.events.some((e) => e.kind === "transfer")));

  // ---- disagreement -> Decisions -> Manager loop -> escalation to the owner; versions; approval; execution
  await page.getByLabel("Question for recommendations").fill("Which market research approach should we use for competitor analysis?");
  await page.getByRole("button", { name: "Ask members (one call each)" }).click();
  check("members' recommendations shown (not saved)", await vis(page.getByLabel("Recommendations")));
  await page.getByRole("button", { name: "Send to Decisions" }).click();
  const dec = await until(async () => (await call("GET", "/api/decisions")).body.decisions[0]);
  check("a decision was created from the group's options", !!dec && dec.status === "open");
  await page.goto(base + "/decisions");
  await page.getByRole("button", { name: new RegExp("Open " + dec.title.slice(0, 20).replace(/[?]/g, "\\?")) }).click();
  check("agreement panel is shown", await vis(page.getByRole("region", { name: "Agreement between the bots" })));
  await page.getByRole("button", { name: "Let the Manager run the discussion" }).click();
  check("the Manager's loop ended in a recorded hand-over to the owner", await vis(page.getByText(/sent to you to decide/), 40000));
  check("the disagreement and its reason are visible", await vis(page.getByText(/slow and the cost is high/)));
  check("nothing was chosen for the owner", (await call("GET", `/api/decisions/${dec.id}`)).body.decision.chosenOptionId === null);
  await shot("decision-escalated");
  // edit the wording of the option the owner prefers, see the versions, choose, approve with a duty
  const d0 = (await call("GET", `/api/decisions/${dec.id}`)).body.decision;
  const opt = d0.options.find((o) => o.title.startsWith("Sara"));
  await page.getByRole("button", { name: `Edit wording of ${opt.title}` }).click();
  await page.getByLabel("Option details").fill("Use public data only and report in 5 bullet points.");
  await page.getByRole("button", { name: "Save as a new version" }).click();
  await page.getByRole("button", { name: `Versions of ${opt.title}` }).click();
  check("the new version shows the exact change", await vis(page.getByRole("list", { name: `Versions of ${opt.title}` }).getByText("Start with public data.", { exact: true })));
  await page.getByRole("button", { name: `Choose ${opt.title}` }).click();
  const planner = page.getByRole("region", { name: "Approve and assign" });
  check("approval planner appears after choosing", await vis(planner));
  await planner.getByLabel("Duty of Sara").fill("Stay inside the owner's budget.");
  await planner.getByRole("button", { name: "Approve with these assignments" }).click();
  const exec = await until(async () => { const e = (await call("GET", `/api/decisions/${dec.id}/execution`)).body; return e.execution?.[0]?.status === "completed" ? e : null; });
  check("the approved work ran and its result is recorded", !!exec);
  check("the bot received the approved wording, the duty, and not the original text", exec?.execution[0].instructionSent.includes("5 bullet points") && exec.execution[0].instructionSent.includes("Stay inside the owner's budget.") && !exec.execution[0].instructionSent.includes("Start with public data.") && exec.execution[0].matchesApprovedVersion === true);
  check("the execution record is shown in the dashboard", await vis(page.getByText("The bot received the approved wording."), 15000));
  await shot("decision-executed");

  // ---- organisation and Workforce Board
  const fx = await call("PUT", `/api/workforce/bots/${sara.id}`, { kind: "dedicated", divisions: ["research_innovation"] });
  await call("PUT", `/api/workforce/bots/${ravi.id}`, { kind: "shared", divisions: ["research_innovation", "business_operations"] });
  check("bots placed in divisions", fx.status === 200);
  await page.goto(base + "/workforce");
  const svg = page.getByRole("img", { name: "Workforce board graph" });
  check("the board renders", await vis(svg));
  const bd = (await call("GET", "/api/workforce/board")).body;
  check("every real bot is a node", bd.nodes.filter((n) => n.kind === "bot").length === 2);
  check("the decision, the group and the tasks are the real records", bd.nodes.some((n) => n.id === `decision:${dec.id}`) && bd.nodes.some((n) => n.id === `group:${grp.id}`) && bd.nodes.filter((n) => n.kind === "task").length >= 3);
  check("delegation and project/decision lines are present", bd.edges.some((e) => e.kind === "delegation") && bd.edges.some((e) => e.kind === "decision") && bd.edges.some((e) => e.kind === "dedicated"));
  check("task statuses are true (completed work, no invented failures)", bd.counts.completed >= 3 && bd.counts.failed === 0, JSON.stringify(bd.counts));
  await page.getByRole("button", { name: /^Bot Sara/ }).click();
  check("inspector shows history from the real records", await vis(page.getByRole("complementary", { name: "Inspector Sara" }).getByLabel("Node history").getByText(/Task completed/)));
  await page.getByLabel("Layout name").fill("Review");
  await page.getByRole("button", { name: "Save layout" }).click();
  check("a layout is saved", await until(async () => (await call("GET", "/api/workforce/layouts")).body.layouts["Review"]));
  await shot("workforce-board");
  await page.setViewportSize({ width: 393, height: 800 });
  await page.reload();
  check("phone view shows the list instead of the graph", await vis(page.getByLabel("Workforce list")) && !(await svg.isVisible()));
  for (const u of ["/groups", "/workforce", "/decisions"]) { await page.goto(base + u); await page.waitForTimeout(500); check(`phone width ${u}: no sideways scrolling`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2))); }
  check("no page errors or failed requests", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("script completed", false, String(e).slice(0, 400));
} finally {
  await browser?.close();
  srv.kill(); A.close(); B.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (fake providers only; screenshots in ${SHOTS})`);
  if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log(" - " + f.name + " " + f.detail)); console.log("server log tail:", log.slice(-500)); }
  process.exit(failed.length ? 1 : 0);
}
