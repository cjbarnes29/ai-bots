// Real-browser check of the capability registry page and the Assistant's capability answers (D-082): the REAL app (src/server.ts) on a scratch
// database, ONE FAKE local model server (127.0.0.1) and a REAL Edge browser. Fictional data only. No internet, no keys, never touches data/app.db.
// Usage: npm --prefix web run build && node scripts/e2e/capabilities-e2e.mjs      (needs port 3118)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-capabilities-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3118;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 260) : ""}`); };

const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "llama3.1:8b" }] });
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(404, {});
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const last = body.messages.filter((m) => m.role === "user").map((m) => String(m.content)).at(-1) ?? "";
    let content = "Done. This is a fictional reply.";
    if (last === "Reply with the single word OK.") content = "OK";
    else if (last.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
    else if (last.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;
const dir = mkdtempSync(path.join(tmpdir(), "awp-capabilities-e2e-"));
mkdirSync(path.join(dir, "data"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dir, "data", "scratch.db"), GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };

let browser;
try {
  check("app started on a scratch database", await ready());
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 1, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const mk = async (name, activate = true) => { const r = await call("POST", "/api/bots", { name, role: "Test agent", model: "auto/general", instructions: "Be brief." }); if (activate) await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const atlas = await mk("Atlas");
  const idle = await mk("Idle helper");
  await mk("Sleeper", false);
  const t = await call("POST", `/api/bots/${atlas.id}/tasks`, { instruction: "Say hello.", saveToWorkspace: false });
  await until(async () => (await call("GET", `/api/tasks/${t.body.task.id}`)).body.task.status === "completed");
  const wf = await call("POST", "/api/workflows", { name: "Hello flow", graph: { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 100, kind: "manual" }, { id: "end", type: "end", label: "End", x: 300, y: 100 }], edges: [{ id: "a", from: "start", to: "end", when: "always" }] } });
  check("scratch data created (3 agents, 1 completed task, 1 workflow)", wf.status === 201);

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const card = (name) => page.getByRole("listitem", { name, exact: true });

  // ===== the page
  await page.goto(`${base}/capabilities`);
  check("page opens with exactly one h1", await page.getByRole("heading", { level: 1, name: "Capabilities" }).waitFor({ timeout: 10000 }).then(() => true, () => false) && (await page.getByRole("heading", { level: 1 }).count()) === 1);
  await page.getByRole("region", { name: "Agents" }).waitFor({ timeout: 8000 });
  check("section tabs show Capabilities under Apps & Integrations", await page.getByRole("link", { name: "Capabilities" }).first().isVisible());
  check("the summary line is shown", /working/.test(await page.getByRole("region", { name: "Summary" }).innerText()));
  for (const g of ["Tools and programs", "AI models", "Agents", "Workflows", "Permissions and safety", "This PC and environment"]) check(`group shown: ${g}`, (await page.getByRole("region", { name: g }).count()) === 1);
  const atlasCard = card("Atlas");
  check("an agent that completed a task is 'Working', but not 'verified'", /Working/.test(await atlasCard.innerText()) && /verified: no/.test(await atlasCard.innerText()));
  check("an active agent with no task yet is 'Set up, not proven' (registered is not working)", /Set up, not proven/.test(await card("Idle helper").innerText()) && !/Working/.test(await card("Idle helper").innerText()));
  check("a switched-off agent is 'Needs setting up'", /Needs setting up/.test(await card("Sleeper").innerText()));
  check("the workflow registered itself", (await card("Hello flow").count()) === 1);
  check("all six evidence levels shown on a card", (await atlasCard.getByRole("list", { name: /Evidence levels/ }).getByRole("listitem").count()) === 6);
  check("the real tools are listed (Node.js found on this PC)", (await card("Node.js").count()) === 1);
  check("unbuilt abilities are listed as 'Not available'", /Not available/.test(await card("Image and logo generation").innerText()));
  check("unattended operation is listed as not available (supervised only)", /Not available/.test(await card("Unattended (autonomous) operation").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "1-capabilities.png"), fullPage: true });

  // filter
  await page.getByLabel(/^Show/).selectOption("needs_setup");
  check("the state filter hides everything else", (await card("Atlas").count()) === 0 && (await card("Sleeper").count()) === 1);
  if (!(await card("Sleeper").getByText("What needs you").isVisible())) await card("Sleeper").locator("details.card > summary").click();
  check("details say what needs the owner", await card("Sleeper").getByText("What needs you").isVisible());
  await page.getByLabel(/^Show/).selectOption("all");

  // ===== self-registration and removal, without any edit to a list
  const fresh = await mk("Brand new helper");
  await page.getByRole("button", { name: "Check again now" }).click();
  check("a new agent appears after a re-check, with no list edited", await card("Brand new helper").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await call("DELETE", `/api/bots/${fresh.id}`);
  await call("PATCH", `/api/bots/${idle.id}`, { status: "paused" });
  await page.getByRole("button", { name: "Check again now" }).click();
  check("an archived agent disappears", await card("Brand new helper").waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false));
  check("a paused agent changes state", await until(async () => /Needs setting up/.test(await card("Idle helper").innerText()), 8000));
  const recent = page.getByRole("region", { name: "Recent changes" });
  check("the history lists the new agent, the removal and the configuration change", await until(async () => { const t = await recent.innerText(); return /New: Brand new helper/.test(t) && /Gone: Brand new helper/.test(t) && /Idle helper: configuration/.test(t); }, 10000));
  // the same page also refreshes by itself (15 s global refetch): change something and wait without pressing anything
  await call("PATCH", `/api/bots/${idle.id}`, { status: "active" });
  check("the page updates by itself within about 20 seconds", await until(async () => /Set up, not proven/.test(await card("Idle helper").innerText()), 22000));

  // ===== the Assistant answers from the same list
  await page.goto(`${base}/assistant`);
  const chat = page.getByRole("region", { name: "Assistant chat" });
  await chat.getByLabel("Talk to").waitFor({ timeout: 10000 });
  await chat.getByLabel(/Your message/).fill("what can you do?");
  await chat.getByLabel(/Your message/).press("Control+Enter");
  const results1 = page.getByRole("region", { name: "Assistant results" });
  check("'what can you do?' gets a capability answer with sections", await results1.getByText(/Working now \(/).waitFor({ timeout: 10000 }).then(() => true, () => false));
  check("the answer separates 'partly or unproven' and 'cannot do'", (await results1.getByText(/Partly, or set up but not proven \(/).count()) === 1 && (await results1.getByText(/Cannot do \(and what is missing\)/).count()) === 1);
  check("the answer names a real limit (no image generation)", /Image and logo generation/.test(await results1.innerText()) || await results1.getByText(/Cannot do/).click().then(() => true).then(async () => /Image and logo generation/.test(await results1.innerText())));
  check("the answer links to the Capabilities page", (await results1.getByRole("link", { name: "Open the Capabilities page" }).getAttribute("href")) === "/capabilities");
  await chat.getByLabel(/Your message/).fill("Can you design a logo for my bakery?");
  await chat.getByLabel(/Your message/).press("Control+Enter");
  check("'can you design a logo?' is answered honestly: No, not as asked", await results1.getByText(/^No, not as asked/).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SHOTS, "2-assistant.png"), fullPage: true });

  // ===== six sizes
  for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1024, 768], [1280, 900], [1920, 1080]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await c.newPage();
    await p.goto(`${base}/capabilities`);
    await p.getByRole("heading", { level: 1, name: "Capabilities" }).waitFor({ timeout: 10000 });
    await p.getByRole("region", { name: "Agents" }).waitFor({ timeout: 8000 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${w}px: no sideways scroll`, overflow <= 1, `overflow ${overflow}`);
    check(`${w}px: exactly one h1`, (await p.getByRole("heading", { level: 1 }).count()) === 1);
    if (w < 768) {
      const smalls = await p.evaluate(() => [...document.querySelectorAll("main button, main select, main summary")].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent ?? "").trim().slice(0, 30)));
      check(`${w}px: buttons, selects and Details toggles are at least 44 px`, smalls.length === 0, smalls.join(" / "));
    }
    if (w < 768) {
      const tall = await p.evaluate(() => document.documentElement.scrollHeight);
      check(`${w}px: the page is compact (groups and entries start closed; height under 4000 px)`, tall < 4000, `height ${tall}`);
      check(`${w}px: every group is closed at first`, (await p.locator("section[aria-label] > details[open]").count()) === 0);
      await p.getByRole("region", { name: "Agents" }).getByText("Agents", { exact: true }).click();
      const agentRow = p.getByRole("listitem", { name: "Atlas", exact: true });
      check(`${w}px: an entry shows its name and state in one row while closed`, /Working/.test(await agentRow.locator("details.card > summary").innerText()));
      await agentRow.locator("details.card > summary").click();
      check(`${w}px: tapping an entry opens the six evidence levels`, (await agentRow.getByRole("list", { name: /Evidence levels/ }).getByRole("listitem").count()) === 6);
      await p.getByRole("button", { name: "Expand all" }).click();
      const open = await p.locator("details.card[open]").count();
      check(`${w}px: Expand all opens every entry`, open > 20, `open ${open}`);
      await p.getByRole("button", { name: "Collapse all" }).click();
      check(`${w}px: Collapse all closes them again`, (await p.locator("details.card[open]").count()) === 0);
    }
    if (w === 390) await p.screenshot({ path: path.join(SHOTS, "3-phone.png"), fullPage: true });
    await c.close();
  }
  check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (e) {
  check("script ran to the end", false, String(e).replace(/\s+/g, " ").slice(0, 500));
} finally {
  await browser?.close();
  srv.kill();
  fakeServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((x) => `- ${x.name}: ${x.detail}`).join("\n")); if (/error/i.test(log)) console.log("server log tail:\n" + log.slice(-600)); }
  process.exit(failed.length ? 1 : 0);
}
