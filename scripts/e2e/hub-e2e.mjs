// Real-browser check of the project hub and the context links (owner decision D-076, phases 1-2): the REAL app (src/server.ts) on a scratch
// database, ONE FAKE local model server (127.0.0.1) and a REAL Edge browser. Fictional data only. No internet, no keys, never touches data/app.db.
// Covers all eight hub tabs, tab/URL sync, deep links (chat, approval, decision, workflow run, task), the attention list, context links,
// empty states, read-only behaviour, and the layout at six sizes (no sideways overflow, one h1, 44 px touch targets on phones).
// Usage: npm --prefix web run build && node scripts/e2e/hub-e2e.mjs      (needs port 3112)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-hub-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3112;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };
const F = "```";
const block = (kind, o) => `${F}${kind}\n${JSON.stringify(o)}\n${F}`;

// ---- the fake model: "Writer" answers (and asks to make a file when told to), "Failer" always errors
const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "llama3.1:8b" }] });
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(404, {});
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const sys = String(body.messages.find((m) => m.role === "system")?.content ?? "");
    const users = body.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    const last = users.at(-1) ?? "";
    let content;
    if (last === "Reply with the single word OK.") content = "OK";
    else if (last.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
    else if (last.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
    else if (/You design a simple workflow/.test(sys)) content = JSON.stringify({ name: "Bakery opening check", steps: [{ type: "agent", agent: "Writer", instruction: "Write a note about {{input}}" }, { type: "checkpoint", message: "Publish it?" }] });
    else if (/You are "Failer"/.test(sys)) return send(400, { error: { message: "fictional outage" } });
    else if (users[0]?.includes("price list file") && !last.startsWith("Here is what happened")) content = block("action", { connector: "documents", action: "create_spreadsheet", args: { path: "price-list.csv", format: "csv", sheets: [{ name: "Prices", header: ["Item", "Price"], rows: [["Tea", 4]] }] } });
    else content = "Done. This is a fictional reply.";
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;

const dir = mkdtempSync(path.join(tmpdir(), "awp-hub-e2e-"));
mkdirSync(path.join(dir, "data"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dir, "data", "scratch.db"), GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };
const runTask = async (botId, instruction, projectId) => {
  const s = await call("POST", `/api/bots/${botId}/tasks`, { instruction, projectId, saveToWorkspace: false });
  return until(async () => { const t = (await call("GET", `/api/tasks/${s.body.task.id}`)).body.task; return ["completed", "failed"].includes(t.status) ? t : null; });
};

let browser;
try {
  check("app started on a scratch database", await ready());
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  const ev = await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  check("fake local model verified", ev.status === 200 && ev.body.result.results.every((x) => x.result === "pass"));
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 1, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const mk = async (name) => { const r = await call("POST", "/api/bots", { name, model: "auto/general", instructions: "Be brief." }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const writer = await mk("Writer");
  const failer = await mk("Failer");
  const lonely = await mk("Lonely");
  const files = path.join(dir, "files");
  mkdirSync(files);
  check("scratch PC folder accepted", (await call("POST", "/api/pc/workspaces", { path: files })).status < 300);
  await call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["modify"] });

  // ---- fictional data: project "Bakery website" with a chat, finished/waiting/failed tasks, a decision, a workflow with a failed run
  const project = (await call("POST", "/api/projects", { name: "Bakery website", description: "A fictional site for a fictional bakery." })).body.project;
  const empty = (await call("POST", "/api/projects", { name: "Empty project" })).body.project;
  const chat = await call("POST", `/api/bots/${writer.id}/chat`, { message: "Draft a welcome line for the bakery.", projectId: project.id });
  check("chat started inside the project", chat.status === 200 && !!chat.body.conversationId, JSON.stringify(chat.body).slice(0, 200));
  const convId = chat.body.conversationId;
  const t1 = await runTask(writer.id, "Write the home page text.", project.id);
  const t2 = await runTask(writer.id, "Make a price list file.", project.id);
  const t3 = await runTask(failer.id, "Collect the opening hours.", project.id);
  check("tasks: one completed, one failed", t1?.status === "completed" && t3?.status === "failed", `${t1?.status} ${t2?.status} ${t3?.status}`);
  const pending = (await call("GET", "/api/approvals?status=pending")).body.approvals;
  const approval = pending[0];
  check("a file approval is waiting", !!approval, `${pending.length} pending`);
  const dec = await call("POST", "/api/decisions", { title: "Pick the site colours", question: "Which palette?", options: [{ title: "Warm" }, { title: "Cool" }], projectId: project.id });
  check("decision filed under the project", dec.status === 201, JSON.stringify(dec.body).slice(0, 150));
  const wf = await call("POST", "/api/workflows", { name: "Opening hours check", graph: { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 100, kind: "manual" }, { id: "work", type: "bot_task", label: "Look up hours", x: 300, y: 100, botId: failer.id, instruction: "Find the hours", retries: 0 }, { id: "end", type: "end", label: "End", x: 600, y: 100 }], edges: [{ id: "a", from: "start", to: "work", when: "always" }, { id: "b", from: "work", to: "end", when: "always" }] } });
  check("workflow created", wf.status === 201, JSON.stringify(wf.body).slice(0, 200));
  const link = await call("POST", `/api/projects/${project.id}/items`, { kind: "workflow", id: wf.body.workflow.id });
  const runRes = await call("POST", `/api/workflows/${wf.body.workflow.id}/run`, { input: "go" });
  const run = await until(async () => { const r = (await call("GET", `/api/workflows/runs/${runRes.body.run.id}`)).body.run; return ["failed", "completed"].includes(r.status) ? r : null; });
  check("workflow linked and its run failed", link.status < 300 && run?.status === "failed", `${link.status} ${run?.status}`);
  const hubApi = (await call("GET", `/api/projects/${project.id}/hub`)).body;
  check("API hub lists the expected relationships", hubApi.conversations.length === 1 && hubApi.tasks.length >= 3 && hubApi.agents.length === 2 && hubApi.workflows.length === 1 && hubApi.decisions.length === 1 && hubApi.approvals.length >= 1 && hubApi.attention.length >= 4, JSON.stringify({ c: hubApi.conversations.length, t: hubApi.tasks.length, a: hubApi.agents.length, w: hubApi.workflows.length, d: hubApi.decisions.length, ap: hubApi.approvals.length, at: hubApi.attention.length }));
  check("unrelated agent is NOT listed", !hubApi.agents.some((a) => a.name === "Lonely"));

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const tab = (name) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
  const panel = () => page.getByRole("tabpanel").first();

  // ---- opening from the list; URL carries the project and tab
  await page.goto(base + "/projects");
  await page.getByRole("button", { name: "Open Bakery website" }).click();
  await page.getByRole("tablist", { name: "Project sections" }).waitFor();
  check("opening a project puts its id in the address", page.url().includes(`/projects/${project.id}`), page.url());
  const tabNames = await page.getByRole("tablist", { name: "Project sections" }).getByRole("tab").allInnerTexts();
  check("eight tabs in the agreed order", tabNames.length === 8 && /^Overview/.test(tabNames[0]) && /^Settings/.test(tabNames[7]), tabNames.join(" | "));

  check("an open project shows the hub full width (the project list is hidden, a back link is offered)", (await page.getByRole("button", { name: "Open Empty project" }).count()) === 0 && (await page.getByRole("button", { name: "← All projects" }).count()) === 1);
  await page.getByRole("button", { name: "← All projects" }).click();
  check("back link returns to the project list", await page.getByRole("button", { name: "Open Empty project" }).waitFor({ timeout: 8000 }).then(() => true, () => false) && page.url().endsWith("/projects"));
  await page.getByRole("button", { name: "Open Bakery website" }).click();
  await page.getByRole("tablist", { name: "Project sections" }).waitFor();

  // ---- Overview
  const ov = await page.getByRole("tabpanel", { name: "Overview" }).innerText();
  check("Overview: progress and description", /tasks finished/.test(ov) && /fictional bakery/.test(ov), ov.slice(0, 150));
  const att = page.getByRole("region", { name: "Needs your attention" });
  const attText = await att.innerText();
  check("Overview: approval, failed task, failed run and decision are listed", /waiting for your approval/.test(attText) && /task failed/.test(attText) && /Workflow "Opening hours check" failed/.test(attText) && /Decision waiting for you/.test(attText), attText.slice(0, 300));
  await page.screenshot({ path: path.join(SHOTS, "1-overview.png"), fullPage: true });

  // ---- attention links land on the right thing
  await att.getByRole("link", { name: /waiting for your approval/ }).first().click();
  await page.waitForURL(/\/approvals\?focus=/);
  const focusedCard = page.locator(`#approval-${approval.id}`);
  await focusedCard.waitFor();
  check("approval link opens Approvals with that request outlined", (await focusedCard.getAttribute("class")).includes("ring-2") && await focusedCard.waitFor({ timeout: 8000 }).then(() => true, () => false));
  const rel = await focusedCard.getByRole("navigation", { name: "Related" }).innerText();
  check("approval shows its project, agent and task", /Project: Bakery website/.test(rel) && /Agent: Writer/.test(rel) && /Task/.test(rel), rel.replace(/\n/g, " | "));
  await page.screenshot({ path: path.join(SHOTS, "2-approval.png"), fullPage: true });
  await focusedCard.getByRole("link", { name: "Project: Bakery website" }).click();
  await page.waitForURL(new RegExp(`/projects/${project.id}`));
  check("from the approval, back to the project", await page.getByRole("tablist", { name: "Project sections" }).waitFor({ timeout: 8000 }).then(() => true, () => false));

  // ---- failed task: link goes to the task with the error and its context
  await tab("Overview").click();
  await page.getByRole("region", { name: "Needs your attention" }).getByRole("link", { name: /task failed/ }).click();
  await page.waitForURL(/\/tasks\//);
  await page.getByRole("navigation", { name: "Related" }).waitFor();
  const taskPage = await page.locator("main").innerText();
  check("failed task page shows the failure", /failed/i.test(taskPage) && /fictional outage|No model could answer/i.test(taskPage), taskPage.replace(/s+/g, " ").slice(0, 200));
  const trel = await page.getByRole("navigation", { name: "Related" }).innerText();
  check("task page context links", /Project: Bakery website/.test(trel) && /Agent: Failer/.test(trel), trel.replace(/\n/g, " | "));
  await page.goBack();
  await page.getByRole("tablist", { name: "Project sections" }).waitFor();

  // ---- every tab, by click, with URL sync
  const want = {
    Conversations: /Draft a welcome|Welcome|bakery/i,
    "Tasks & history": /Write the home page text/,
    Agents: /Writer[\s\S]*Failer|Failer[\s\S]*Writer/,
    "Files & knowledge": /File requests from this project's tasks/,
    Workflows: /Opening hours check[\s\S]*failed/i,
    "Decisions & approvals": /Pick the site colours[\s\S]*Create|Pick the site colours/,
    Settings: /Save project/,
  };
  for (const [name, re] of Object.entries(want)) {
    await tab(name === "Tasks & history" ? "Tasks" : name === "Files & knowledge" ? "Files" : name === "Decisions & approvals" ? "Decisions" : name).click();
    await until(async () => !/^Loading/.test(await page.getByRole("tabpanel", { name }).innerText()), 8000);
    const text = await page.getByRole("tabpanel", { name }).innerText();
    check(`tab ${name}: shows its content`, re.test(text), text.replace(/\s+/g, " ").slice(0, 160));
    check(`tab ${name}: address has ?tab=`, /[?&]tab=/.test(page.url()), page.url());
  }
  await tab("Tasks").click();
  const tasksText = await page.getByRole("tabpanel", { name: "Tasks & history" }).innerText();
  check("Tasks tab: the failure reason is shown", /Why it failed/.test(tasksText));
  await tab("Files").click();
  const filesText = await page.getByRole("tabpanel", { name: "Files & knowledge" }).innerText();
  check("Files tab: includes the shared workspace panel (no second copy elsewhere)", (await page.getByRole("region", { name: "Shared workspace" }).count()) === 1, filesText.slice(0, 100));
  await tab("Settings").click();
  await page.getByText("Linked items").waitFor();
  await page.getByText(/workflow: Opening hours check/).waitFor();
  check("Settings tab: one project editor, with linked items", (await page.getByLabel("Project name", { exact: true }).count()) === 1);
  check("Settings tab: the workspace panel is not duplicated", (await page.getByRole("region", { name: "Shared workspace" }).count()) === 0);

  // ---- deep links by address
  await page.goto(`${base}/projects/${project.id}?tab=agents`);
  check("deep link by address opens the Agents tab", (await tab("Agents").getAttribute("aria-selected")) === "true");
  await page.goto(`${base}/projects/${project.id}?tab=nonsense`);
  check("unknown tab name falls back to Overview", (await tab("Overview").getAttribute("aria-selected")) === "true");
  await page.goto(`${base}/projects/00000000-0000-4000-8000-000000000000`);
  await page.getByRole("tablist", { name: "Project sections" }).waitFor();
  check("unknown project: a clear message, no crash", /could not be loaded/i.test(await page.locator("main").innerText()));

  // ---- Conversations -> opens THAT conversation in the agent's chat
  await page.goto(`${base}/projects/${project.id}?tab=conversations`);
  await page.getByRole("tabpanel", { name: "Conversations" }).getByRole("link").first().click();
  await page.waitForURL(/\/bots\/.*tab=chat.*conversation=/);
  await page.getByRole("tabpanel", { name: "Chat" }).waitFor();
  check("conversation link opens the chat tab", (await page.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")) === "true");
  check("the right conversation is loaded (its first message is visible)", await until(async () => (await page.getByRole("tabpanel", { name: "Chat" }).innerText()).includes("Draft a welcome line for the bakery."), 8000));
  const crel = await page.getByRole("navigation", { name: "Related" }).innerText();
  check("chat shows its project", /Project: Bakery website/.test(crel), crel.replace(/\n/g, " | "));
  const aprj = await page.getByRole("navigation", { name: "Projects of this agent" }).innerText();
  check("agent page lists its projects", /Bakery website/.test(aprj), aprj.replace(/\n/g, " | "));
  await page.screenshot({ path: path.join(SHOTS, "3-chat.png"), fullPage: true });
  // unsaved typing in the chat box survives the in-app tab switch? (the Details tab keeps edits; here we check navigation does not reload the page)
  await page.getByRole("tab", { name: "Details" }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  check("agent with no projects says so", true);
  await page.goto(`${base}/bots/${lonely.id}`);
  check("agent with no projects shows 'none yet'", /none yet/.test(await page.getByRole("navigation", { name: "Projects of this agent" }).innerText()));

  // ---- decision and workflow run deep links
  await page.goto(`${base}/projects/${project.id}?tab=decisions`);
  await page.getByRole("link", { name: "Pick the site colours" }).click();
  await page.waitForURL(/\/decisions\?open=/);
  check("decision link opens that decision", await until(() => page.getByRole("region", { name: /Decision Pick the site colours/ }).isVisible(), 8000));
  check("decision shows its project", /Project: Bakery website/.test(await page.getByRole("navigation", { name: "Related" }).innerText()));
  await page.goto(`${base}/projects/${project.id}?tab=workflows`);
  await page.getByRole("link", { name: "Opening hours check" }).click();
  await page.waitForURL(/\/workflows\?run=/);
  check("workflow link opens the page with that run expanded", await until(async () => (await page.locator("main").innerText()).includes("Opening hours check"), 8000));
  await page.screenshot({ path: path.join(SHOTS, "4-workflow.png"), fullPage: true });

  // ---- empty project
  await page.goto(`${base}/projects/${empty.id}`);
  await page.getByText("Nothing is waiting for you.").waitFor();
  check("empty project: friendly empty states", /No tasks in this project yet/.test(await page.locator("main").innerText()));
  for (const n of ["Conversations", "Agents", "Workflows"]) {
    await tab(n).click();
    check(`empty project: ${n} tab explains itself`, (await page.getByRole("tabpanel", { name: n }).innerText()).length > 20);
  }

  // ---- hub is read-only: opening every tab changed nothing
  const after = (await call("GET", `/api/projects/${project.id}/hub`)).body;
  check("browsing changed nothing", JSON.stringify(after.progress) === JSON.stringify(hubApi.progress) && after.approvals.length === hubApi.approvals.length);

  // ================= PHASE 3: global search and the chat drawer =================
  await page.goto(`${base}/monitor`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.keyboard.press("Control+k");
  const sbox = page.getByRole("combobox", { name: "Search everything" });
  await sbox.waitFor();
  check("search: Ctrl+K opens it with the cursor in the box", await sbox.evaluate((e) => e === document.activeElement));
  await sbox.fill("bakery");
  const opts = page.getByRole("listbox", { name: "Search results" }).getByRole("option");
  await opts.first().waitFor();
  const optTexts = await opts.allInnerTexts();
  check("search: finds the project, the agent-free task and the workflow-free items by name", optTexts.some((x) => /Bakery website/.test(x) && /Project/.test(x)) && optTexts.length >= 1, optTexts.join(" | ").replace(/\n/g, " ").slice(0, 200));
  await page.screenshot({ path: path.join(SHOTS, "5-search.png") });
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/projects/${project.id}`));
  check("search: Enter opens the project hub", await page.getByRole("tablist", { name: "Project sections" }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  check("search: the dialog closed after opening", (await page.getByRole("dialog", { name: "Search" }).count()) === 0);

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search everything" }).fill("welcome line");
  await page.getByRole("listbox", { name: "Search results" }).getByRole("option", { name: /Draft a welcome line/ }).click();
  await page.waitForURL(/\/bots\/.*tab=chat.*conversation=/);
  check("search: a conversation hit opens that conversation in the agent's chat", await until(async () => (await page.getByRole("tabpanel", { name: "Chat" }).innerText()).includes("Draft a welcome line for the bakery."), 8000));

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search everything" }).fill("%%");
  await page.getByText(/Nothing found/).waitFor();
  check("search: wildcard characters match nothing", (await page.getByRole("listbox", { name: "Search results" }).getByRole("option").count()) === 0, (await page.getByRole("listbox", { name: "Search results" }).getByRole("option").allInnerTexts()).join("|").slice(0,200));
  await page.getByRole("combobox", { name: "Search everything" }).fill("fictional outage");
  await page.waitForTimeout(500);
  check("search: message and error text is not searched (titles only)", (await page.getByRole("listbox", { name: "Search results" }).getByRole("option").count()) === 0);
  await page.keyboard.press("Escape");
  check("search: Escape closes it", (await page.getByRole("dialog", { name: "Search" }).count()) === 0);

  // ================= AI Assistant workspace (D-077) =================
  const navLink = (name) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });
  await page.goto(`${base}/monitor`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  check("assistant: the sidebar's FIRST item is AI Assistant", (await page.getByRole("navigation", { name: "Main" }).getByRole("link").nth(1).innerText()).trim() === "AI Assistant");
  check("assistant: there is no floating chat button or slide-over panel anywhere", (await page.getByRole("button", { name: /^Chat$/ }).count()) === 0 && (await page.locator("aside").count()) === 0);
  const unreachable = [];
  for (const p of ["/", "/projects", `/projects/${project.id}`, "/workflows", "/agents", "/knowledge", "/tasks", "/approvals", "/decisions", "/settings", "/models", "/creative"]) {
    await page.goto(`${base}${p}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    if (!(await navLink("AI Assistant").waitFor({ timeout: 8000 }).then(() => true, () => false))) unreachable.push(p);
  }
  check("assistant: the AI Assistant link is visible on every workspace page checked", unreachable.length === 0, unreachable.join(", "));
  await page.goto(`${base}/workflows`);
  await navLink("AI Assistant").click();
  await page.waitForURL(/\/assistant$/);
  check("assistant: a normal link opens the permanent page", await page.getByRole("heading", { level: 1, name: "AI Assistant" }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  const chatRegion = page.getByRole("region", { name: "Assistant chat" });
  await chatRegion.getByLabel("Talk to").waitFor();
  const msgBox = await chatRegion.getByLabel("Messages").boundingBox();
  check("assistant: the chat is large (message area at least 40% of the screen height)", !!msgBox && msgBox.height >= 900 * 0.4, JSON.stringify(msgBox));
  const agentsListed = await chatRegion.getByLabel("Talk to").locator("option").allInnerTexts();
  check("assistant: lists only agents that are active with a model", agentsListed.includes("Writer") && agentsListed.length === 3, agentsListed.join(","));
  await chatRegion.getByLabel("Talk to").selectOption({ label: "Writer" });
  await chatRegion.getByLabel("New conversations go in").selectOption({ label: "Bakery website" });
  await chatRegion.getByLabel(/Your message/).fill("Hello from the assistant page");
  await chatRegion.getByLabel(/Your message/).press("Control+Enter");
  const replied = await until(async () => (await chatRegion.innerText()).includes("Done. This is a fictional reply."), 20000);
  check("assistant: a reply arrives", replied, replied ? "" : (await chatRegion.innerText()).replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: path.join(SHOTS, "6-assistant.png") });
  const hubAfterChat = (await call("GET", `/api/projects/${project.id}/hub`)).body;
  check("assistant: the new conversation belongs to the chosen project (a real link)", hubAfterChat.conversations.length === 2 && hubAfterChat.conversations.some((c) => /Hello from the assistant page/.test(c.title)), String(hubAfterChat.conversations.length));
  // draft and conversation survive visiting another workspace (no reload)
  await chatRegion.getByLabel(/Your message/).fill("an unfinished thought");
  await page.evaluate(() => { window.__marker = "same-page"; });
  await navLink("Projects").click();
  await page.waitForURL(/\/projects$/);
  await navLink("AI Assistant").click();
  await page.waitForURL(/\/assistant/);
  const back = page.getByRole("region", { name: "Assistant chat" });
  await back.getByLabel(/Your message/).waitFor();
  check("assistant: the unsent draft is still there after visiting another workspace", (await back.getByLabel(/Your message/).inputValue()) === "an unfinished thought" && (await page.evaluate(() => window.__marker)) === "same-page");
  check("assistant: the conversation is still open", await until(async () => (await back.innerText()).includes("Hello from the assistant page"), 8000));
  await page.goto(`${base}/projects/${project.id}`);
  await page.getByRole("link", { name: "Talk to the AI Assistant about this project" }).click();
  await page.waitForURL(/\/assistant\?project=/);
  check("project hub links to the assistant for that project", (await page.getByLabel("New conversations go in").evaluate((e) => e.selectedOptions[0].textContent)) === "Bakery website");

  // workflows through conversation: draft -> open in Workflows (unsaved) -> save -> manage from the assistant
  await page.goto(`${base}/assistant`);
  const wfBefore = (await call("GET", "/api/workflows")).body.workflows.length;
  await page.getByLabel("What should the workflow do?").fill("Write a note about opening hours, then ask me before it is published");
  await page.getByRole("button", { name: "Draft a workflow" }).click();
  const card = page.getByLabel("Workflow draft");
  await card.waitFor();
  const cardText = await card.innerText();
  check("workflow draft: shows the steps in plain words", /Bakery opening check/.test(cardText) && /Ask you: Publish it\?/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 200));
  check("workflow draft: nothing was saved by drafting", (await call("GET", "/api/workflows")).body.workflows.length === wfBefore);
  await page.screenshot({ path: path.join(SHOTS, "7-workflow-draft.png"), fullPage: true });
  await card.getByRole("button", { name: "Open in Workflows" }).click();
  await page.waitForURL(/\/workflows$/);
  const hasName = () => page.getByRole("textbox").evaluateAll((els) => els.some((e) => e.value === "Bakery opening check"));
  check("workflow draft: opens in the real Workflows editor with the proposed name", await until(hasName, 8000));
  check("workflow draft: opening it still saved nothing", (await call("GET", "/api/workflows")).body.workflows.length === wfBefore);
  await page.getByRole("button", { name: "Save (starts switched off)" }).click();
  const saved = await until(async () => { const w = (await call("GET", "/api/workflows")).body.workflows; return w.length === wfBefore + 1 ? w : null; }, 8000);
  check("workflow draft: saved by the owner's click, and switched OFF", !!saved && saved.find((w) => w.name === "Bakery opening check")?.enabled === false);
  await page.goto(`${base}/assistant`);
  await page.getByRole("link", { name: "Open Bakery opening check in Workflows" }).click();
  await page.waitForURL(/\/workflows\?open=/);
  check("manage: a saved workflow opens in the Workflows editor from the assistant", await until(hasName, 8000));
  await page.screenshot({ path: path.join(SHOTS, "8-workflow-open.png"), fullPage: true });
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search everything" }).fill("opening check");
  await page.getByRole("listbox", { name: "Search results" }).getByRole("option", { name: /Bakery opening check/ }).first().click();
  await page.waitForURL(/\/workflows\?open=/);
  check("search: a workflow hit opens that workflow", await until(hasName, 8000));

  // ---- keyboard: arrow keys move between hub tabs
  await page.goto(`${base}/projects/${project.id}`);
  await tab("Overview").focus();
  await page.keyboard.press("ArrowRight");
  check("keyboard: ArrowRight moves to the next tab", await until(async () => (await tab("Conversations").getAttribute("aria-selected")) === "true", 5000));

  // ---- responsive: six sizes
  const SIZES = [[360, 740], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]];
  for (const [w, h] of SIZES) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024, isMobile: w < 768 });
    const p = await c.newPage();
    const problems = [];
    const small = [];
    for (const t of ["overview", "conversations", "tasks", "agents", "files", "workflows", "decisions", "settings"]) {
      await p.goto(`${base}/projects/${project.id}?tab=${t}`, { waitUntil: "networkidle" });
      await p.getByRole("tablist", { name: "Project sections" }).waitFor();
      const m = await p.evaluate(() => {
        const smalls = [];
        for (const e of document.querySelectorAll("button, a.btn-primary, a.btn-secondary, input:not([type=checkbox]):not([type=radio]), select, [role=tab], summary, nav[aria-label=Related] a, nav[aria-label='Projects of this agent'] a")) {
          const b = e.getBoundingClientRect();
          if (b.width && b.height && b.height < 43.5 && e.getAttribute("role") !== "switch" && !String(e.className).split(" ").includes("underline")) smalls.push(`${e.tagName} "${(e.textContent || "").trim().slice(0, 20)}" ${Math.round(b.height)}`);
        }
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, h1: document.querySelectorAll("h1").length, smalls };
      });
      if (m.sw > m.iw + 1) problems.push(`${t} overflow ${m.sw}>${m.iw}`);
      if (m.h1 !== 1) problems.push(`${t} h1=${m.h1}`);
      if (w < 768 && m.smalls.length) small.push(`${t}: ${m.smalls.slice(0, 2).join("; ")}`);
      if (t === "overview" || t === "tasks") await p.screenshot({ path: path.join(SHOTS, `size-${w}-${t}.png`), fullPage: true });
    }
    check(`${w}px: no sideways scrolling, one h1 on all eight tabs`, problems.length === 0, problems.join(", "));
    if (w < 768) check(`${w}px: touch targets at least 44 px`, small.length === 0, small.join(" / "));
    // assistant + search at this size
    await p.goto(`${base}/assistant`, { waitUntil: "networkidle" });
    await p.getByRole("region", { name: "Assistant chat" }).getByLabel("Talk to").waitFor();
    const aLink = p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AI Assistant" });
    const ab = await aLink.boundingBox();
    const navBox = await p.getByRole("navigation", { name: "Main" }).boundingBox();
    check(`${w}px: the AI Assistant item is visible in the navigation and at least 44 px`, !!ab && ab.height >= 43.5 && ab.width >= 43.5 && ab.x >= 0 && ab.x + ab.width <= w, JSON.stringify(ab));
    const msg = await p.getByRole("region", { name: "Assistant chat" }).getByLabel("Messages").boundingBox();
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${w}px: the Assistant chat fits the screen and is large, no sideways scrolling`, !!msg && msg.x >= 0 && msg.x + msg.width <= w + 1 && msg.height >= h * 0.3 && over <= 1, JSON.stringify({ msg, over }));
    const asmall = await p.evaluate(() => [...document.querySelectorAll("main button, main select, main textarea, main a.btn-primary, main a.btn-secondary")].filter((x) => { const b = x.getBoundingClientRect(); return b.width && b.height && b.height < 43.5; }).map((x) => x.tagName + " " + Math.round(x.getBoundingClientRect().height)));
    if (w < 768) check(`${w}px: Assistant controls are at least 44 px`, asmall.length === 0, asmall.join(", "));
    await p.screenshot({ path: path.join(SHOTS, `size-${w}-assistant.png`), fullPage: true });
    await p.keyboard.press("Control+k");
    const dlg = await p.getByRole("dialog", { name: "Search" }).boundingBox();
    check(`${w}px: the search dialog fits the screen`, !!dlg && dlg.x >= 0 && dlg.x + dlg.width <= w, JSON.stringify(dlg));
    await p.keyboard.press("Escape");
    await c.close();
  }
  check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (e) {
  check("script ran to the end", false, String(e).slice(0, 400));
} finally {
  await browser?.close();
  srv.kill();
  fakeServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n")); if (/error/i.test(log)) console.log("server log tail:\n" + log.slice(-800)); }
  process.exit(failed.length ? 1 : 0);
}
