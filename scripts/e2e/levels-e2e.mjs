// Real-browser acceptance check of the interface levels (owner decision D-079, Phase 5; brief sections F and G): the REAL app (src/server.ts) on a scratch
// database, ONE FAKE local model server (127.0.0.1) and a REAL Edge browser. Fictional data only. No internet, no keys, never touches data/app.db.
// Usage: npm --prefix web run build && node scripts/e2e/levels-e2e.mjs      (needs port 3115)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-levels-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3115;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 260) : ""}`); };
const F = "```";
const block = (kind, o) => `${F}${kind}\n${JSON.stringify(o)}\n${F}`;

const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "llama3.1:8b" }] });
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(404, {});
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const users = body.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    const sys = body.messages.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
    const last = users.at(-1) ?? "";
    let content;
    if (/You are "Failer"/.test(sys) && last !== "Reply with the single word OK." && !last.startsWith("Reply with only this JSON") && !last.startsWith("Who are you")) return send(400, { error: { message: "fictional outage" } });
    if (last === "Reply with the single word OK.") content = "OK";
    else if (last.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
    else if (last.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
    else if (users[0]?.includes("price list file") && !last.startsWith("Here is what happened")) content = block("action", { connector: "documents", action: "create_spreadsheet", args: { path: "price-list.csv", format: "csv", sheets: [{ name: "Prices", header: ["Item", "Price"], rows: [["Tea", 4]] }] } });
    else if (/You design a simple workflow/.test(sys)) content = JSON.stringify({ name: "Thank-you note", steps: [{ type: "checkpoint", message: "Write the note now?" }, { type: "agent", agent: "Atlas", instruction: "Write a short thank-you note" }] });
    else if (/ATTACHED FILES/.test(sys) && /4\.2 million/.test(sys)) content = "Revenue in Q3 was 4.2 million dirhams [A1].";
    else content = "Done. This is a fictional reply.";
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;
const dir = mkdtempSync(path.join(tmpdir(), "awp-levels-e2e-"));
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

const SIMPLE = ["AI Assistant", "Dashboard", "Projects", "Decisions & approvals"];
const MID = [...SIMPLE.slice(0, 3), "Workflows", "AI Agents", "Knowledge Center", "Tasks & history", "Decisions & approvals"];
const ALL = ["AI Assistant", "Dashboard", "Projects", "Workflows", "AI Agents", "Knowledge Center", "Tasks & history", "Decisions & approvals", "AI Models", "Apps & Integrations", "Creative Studio", "Settings"];

let browser;
try {
  check("app started on a scratch database", await ready());
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 1, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const mk = async (name) => { const r = await call("POST", "/api/bots", { name, role: "Test agent", model: "auto/general", instructions: "Be brief." }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const atlas = await mk("Atlas");
  const failer = await mk("Failer");
  const files = path.join(dir, "files");
  mkdirSync(files);
  await call("POST", "/api/pc/workspaces", { path: files });
  await call("PUT", `/api/bots/${atlas.id}/pc`, { grants: ["modify"] });
  const project = (await call("POST", "/api/projects", { name: "Bakery website", description: "A fictional site" })).body.project;
  const t = await call("POST", `/api/bots/${atlas.id}/tasks`, { instruction: "Make a price list file.", projectId: project.id, saveToWorkspace: false });
  await until(async () => (await call("GET", `/api/tasks/${t.body.task.id}`)).body.task.status === "completed");
  const failedTask = await call("POST", `/api/bots/${failer.id}/tasks`, { instruction: "Collect the opening hours.", projectId: project.id, saveToWorkspace: false });
  await until(async () => (await call("GET", `/api/tasks/${failedTask.body.task.id}`)).body.task.status === "failed");
  check("an approval is waiting (data for the safety checks)", (await call("GET", "/api/approvals?status=pending")).body.approvals.length === 1);
  const wf = await call("POST", "/api/workflows", { name: "Opening hours check", graph: { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 100, kind: "manual" }, { id: "end", type: "end", label: "End", x: 300, y: 100 }], edges: [{ id: "a", from: "start", to: "end", when: "always" }] } });
  check("workflow created", wf.status === 201);

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const menu = (p = page) => p.getByRole("navigation", { name: "Main" });
  // The waiting badge adds ", 1 waiting" (for screen readers) and a visible "1" to a link's text: take it off so only the section's name is compared.
  const clean = (s) => s.replace(/,?\s*\d+ waiting\d*$/, "").trim();
  const names = async (p = page) => (await menu(p).getByRole("link").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent)))).map(clean).filter((n) => n !== "AI Workforce Studio home");
  const level = (l, p = page) => p.getByRole("button", { name: `${l} level` }).click();
  const pressed = async (l, p = page) => (await p.getByRole("button", { name: `${l} level` }).getAttribute("aria-pressed")) === "true";
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ===== defaults and the three levels
  await page.goto(`${base}/projects`);
  await page.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
  check("default is ADVANCED: all 12 sections are listed, exactly as before", same(await names(), ALL), (await names()).join(", "));
  check("no plain-language guide at Advanced", (await page.getByRole("note", { name: "Plain-language guide" }).count()) === 0);
  await level("Simple");
  check("SIMPLE lists only the four essentials", same(await names(), SIMPLE), (await names()).join(", "));
  check("the guide for the screen appears at Simple", await page.getByRole("note", { name: "Plain-language guide" }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SHOTS, "1-simple.png"), fullPage: true });
  await level("Intermediate");
  check("INTERMEDIATE adds workflows, agents, knowledge and tasks", same(await names(), MID), (await names()).join(", "));
  await level("Simple");
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
  check("the level is remembered after a reload (this browser)", (await pressed("Simple")) && same(await names(), SIMPLE));
  check("the Recommended Settings detail level follows (Simple = beginner)", await until(async () => (await call("GET", "/api/recommendations")).body?.mode === "beginner", 8000));

  // ===== nothing removed
  await page.goto(`${base}/models`);
  await page.getByRole("note", { name: "Hidden screen" }).waitFor({ timeout: 8000 });
  check("a screen the level does not list still opens by address, with a notice", /AI Models.*Advanced level/.test(await page.getByRole("note", { name: "Hidden screen" }).innerText()));
  check("the section you are in stays in the menu (you can see where you are)", (await names()).includes("AI Models"));
  await page.getByRole("button", { name: "Show it in the menu" }).click();
  check("'Show it in the menu' switches to the level that lists it", (await pressed("Advanced")) && (await page.getByRole("note", { name: "Hidden screen" }).count()) === 0);
  await level("Simple");

  // ===== safety controls at every level
  for (const l of ["Simple", "Intermediate", "Advanced"]) {
    await level(l);
    await page.goto(`${base}/approvals`);
    await page.getByRole("heading", { level: 1, name: "Approvals" }).waitFor();
    const card = page.getByRole("listitem", { name: /Approval request: Create the CSV file price-list/ });
    await card.waitFor({ timeout: 8000 });
    check(`${l}: the waiting approval shows its Approve and Deny controls`, (await card.getByRole("button", { name: /Approve/ }).count()) >= 1 && (await card.getByRole("button", { name: /Deny/ }).count()) >= 1);
    check(`${l}: the sidebar shows the waiting count on Decisions & approvals`, await menu().getByRole("link", { name: /Decisions & approvals.*1 waiting/ }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  }
  await level("Simple");

  // ===== work is not lost, and the assistant / search still reach hidden screens at Simple
  await page.goto(`${base}/assistant`);
  const chat = page.getByRole("region", { name: "Assistant chat" });
  await chat.getByLabel(/Your message/).waitFor();
  await chat.getByLabel(/Your message/).fill("an unfinished thought");
  await page.evaluate(() => { window.__marker = "same-page"; });
  await level("Intermediate"); await level("Advanced"); await level("Simple");
  check("switching levels keeps an unsent message and does not reload the page", (await chat.getByLabel(/Your message/).inputValue()) === "an unfinished thought" && (await page.evaluate(() => window.__marker)) === "same-page");
  await chat.getByLabel(/Your message/).fill("open ai models");
  await chat.getByLabel(/Your message/).press("Control+Enter");
  await page.waitForURL(/\/models/);
  check("at Simple the assistant still opens a screen that is not in the menu", await page.getByRole("note", { name: "Hidden screen" }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search everything" }).fill("opening hours");
  await page.getByRole("listbox", { name: "Search results" }).getByRole("option", { name: /Opening hours check/ }).first().click();
  await page.waitForURL(/\/workflows\?open=/);
  check("at Simple search still finds and opens a workflow in its editor", await until(async () => (await page.getByRole("textbox").evaluateAll((els) => els.some((e) => e.value === "Opening hours check"))), 8000));
  await page.goto(`${base}/assistant`);
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel(/Your message/).fill("delete the project Bakery website");
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel(/Your message/).press("Control+Enter");
  check("at Simple a restricted request is still refused, and nothing is deleted", await page.getByRole("region", { name: "Assistant results" }).getByText(/I will not do that myself/).first().waitFor({ timeout: 8000 }).then(() => true, () => false) && (await call("GET", `/api/projects/${project.id}`)).status === 200);

  // ===== a beginner's seven tasks, done at SIMPLE with only what Simple shows (no level switch, no address typing)
  await level("Simple");
  const onlyMenu = async (name) => { await menu().getByRole("link", { name: new RegExp("^" + name) }).first().click(); };
  const box = () => page.getByRole("region", { name: "Assistant chat" }).getByLabel(/Your message/);
  await onlyMenu("AI Assistant");
  await box().waitFor();
  await box().fill("Hello, what can you do?");
  await box().press("Control+Enter");
  check("beginner task 1: ask the assistant a question and get a reply", await page.getByRole("region", { name: "Assistant chat" }).getByText("Done. This is a fictional reply.").first().waitFor({ timeout: 20000 }).then(() => true, () => false));
  await box().fill("why did my last task fail");
  await box().press("Control+Enter");
  const why = page.getByRole("region", { name: "Assistant results" });
  check("beginner task 2: 'why did my last task fail' gives the real reason in plain words, with a link", await why.getByText(/fictional outage/).first().waitFor({ timeout: 10000 }).then(() => true, () => false) && (await why.getByRole("link", { name: "Open the task" }).count()) >= 1);
  await onlyMenu("Decisions & approvals");
  const wait = page.getByRole("listitem", { name: /Approval request: Create the CSV file price-list/ });
  await wait.waitFor({ timeout: 8000 });
  await wait.getByRole("button", { name: /Approve/ }).click();
  await page.getByRole("button", { name: /Yes, do it once/ }).click();
  check("beginner task 3: approve a waiting request from the menu (it is decided and leaves the waiting list)", await until(async () => (await call("GET", "/api/approvals?status=pending")).body.approvals.length === 0, 10000));
  await onlyMenu("Projects");
  await page.getByRole("button", { name: "Open Bakery website" }).click();
  await page.getByRole("tablist", { name: "Project sections" }).waitFor();
  const simpleTabs = await page.getByRole("tablist", { name: "Project sections" }).getByRole("tab").evaluateAll((els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
  check("beginner task 4: open a project; at Simple it has five tabs, not eight", same(simpleTabs, ["Overview", "Conversations", "Tasks & history", "Files & knowledge", "Decisions & approvals"]), simpleTabs.join(", "));
  check("beginner task 4b: the project Overview says what needs attention, with a link to the failed task", await page.getByRole("region", { name: "Needs your attention" }).getByRole("link", { name: /task failed/ }).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await onlyMenu("AI Assistant");
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel("Attach files").setInputFiles([{ name: "q3-report.txt", mimeType: "text/plain", buffer: Buffer.from("Revenue in Q3 was 4.2 million dirhams.") }]);
  await page.getByRole("list", { name: "Files to send" }).getByText(/Ready to send/).waitFor({ timeout: 15000 });
  await box().fill("What was the Q3 revenue?");
  await box().press("Control+Enter");
  check("beginner task 5: attach a file and ask about it; the answer shows where it came from", await page.getByRole("region", { name: "Assistant chat" }).getByText(/Sources \(1\)/).first().waitFor({ timeout: 20000 }).then(() => true, () => false) && /\[A1\]/.test(await page.getByRole("region", { name: "Assistant chat" }).innerText()));
  check("beginner task 5b: the file is temporary by default and is NOT in the Knowledge Center", (await call("GET", "/api/knowledge/docs")).body.documents.length === 0);
  await page.getByLabel("What should the workflow do?").fill("Ask me first, then write a short thank-you note");
  await page.getByRole("button", { name: "Draft a workflow" }).click();
  const draftCard = page.getByLabel("Workflow draft");
  await draftCard.waitFor({ timeout: 15000 });
  await draftCard.getByRole("button", { name: "Open in Workflows" }).click();
  await page.waitForURL(/\/workflows$/);
  check("beginner task 6: draft a workflow with the assistant and open it in the editor (the hidden screen explains itself)", await page.getByRole("note", { name: "Hidden screen" }).waitFor({ timeout: 8000 }).then(() => true, () => false) && (await until(async () => (await page.getByRole("textbox").evaluateAll((els) => els.some((e) => e.value === "Thank-you note"))), 8000)));
  check("beginner task 6b: that draft was not saved by opening it", (await call("GET", "/api/workflows")).body.workflows.every((w) => w.name !== "Thank-you note"));
  await onlyMenu("Dashboard");
  await until(async () => /AI brain/.test(await page.getByRole("note", { name: "Plain-language guide" }).innerText().catch(() => "")), 8000);
  check("beginner task 7: the Dashboard explains itself with a guide that defines 'model'", /AI brain/.test(await page.getByRole("note", { name: "Plain-language guide" }).innerText()));
  await page.screenshot({ path: path.join(SHOTS, "2-beginner-dashboard.png"), fullPage: true });
  await level("Intermediate");
  await onlyMenu("Projects");
  await page.getByRole("button", { name: "Open Bakery website" }).click();
  await until(async () => (await page.getByRole("tablist", { name: "Project sections" }).getByRole("tab").count()) === 8, 8000);
  check("Intermediate: the same project page lists all eight tabs", (await page.getByRole("tablist", { name: "Project sections" }).getByRole("tab").count()) === 8);
  await level("Simple");

  // ===== every screen loads at Simple, and at six sizes for each level
  const PAGES = ["/", "/assistant", "/projects", "/workflows", "/agents", "/knowledge", "/tasks", "/approvals", "/decisions", "/monitor", "/inbox", "/models", "/integrations", "/creative", "/settings"];
  const bad = [];
  for (const p of PAGES) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 8000 }).catch(() => {});
    const m = await page.evaluate(() => ({ h1: document.querySelectorAll("h1").length, over: document.documentElement.scrollWidth - window.innerWidth }));
    if (m.h1 !== 1 || m.over > 1) bad.push(`${p} h1=${m.h1} over=${m.over}`);
  }
  check("at Simple every one of 15 screens still loads with one h1 and no sideways scrolling", bad.length === 0, bad.join(", "));

  const SIZES = [[360, 740], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]];
  for (const [w, h] of SIZES) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024, isMobile: w < 768 });
    const p = await c.newPage();
    const probs = [];
    const smalls = [];
    for (const l of ["simple", "intermediate", "advanced"]) {
      await p.addInitScript((lv) => localStorage.setItem("awp-interface-level", lv), l);
    }
    for (const l of ["Simple", "Intermediate", "Advanced"]) {
      await p.goto(`${base}/projects`, { waitUntil: "networkidle" });
      await p.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
      await level(l, p);
      const m = await p.evaluate(() => ({
        over: document.documentElement.scrollWidth - window.innerWidth,
        h1: document.querySelectorAll("h1").length,
        smalls: [...document.querySelectorAll("main button, main select, main textarea, main [role=tab], header button")].filter((x) => { const b = x.getBoundingClientRect(); return b.width && b.height && b.height < 43.5 && !(x.tagName === "BUTTON" && String(x.className).includes("underline")); }).map((x) => `${x.tagName} "${(x.getAttribute("aria-label") || x.textContent || "").trim().slice(0, 18)}" ${Math.round(x.getBoundingClientRect().height)}`),
      }));
      if (m.over > 1) probs.push(`${l} overflow ${m.over}`);
      if (m.h1 !== 1) probs.push(`${l} h1=${m.h1}`);
      if (w < 768 && m.smalls.length) smalls.push(`${l}: ${m.smalls.slice(0, 2).join("; ")}`);
      const expected = l === "Simple" ? SIMPLE : l === "Intermediate" ? MID : ALL;
      if (w >= 768) { const got = await names(p); if (!same(got, expected)) probs.push(`${l} menu ${got.length} != ${expected.length}`); }
      if (w < 768) {
        // phone: bottom bar keeps its four essentials and More; the More sheet lists what the level shows
        const bar = (await menu(p).getByRole("link").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0).map((e) => e.getAttribute("aria-label") ?? e.textContent))).map(clean).filter((n) => n !== "AI Workforce Studio home");
        if (!same(bar, ["AI Assistant", "Dashboard", "Projects", "Decisions & approvals"])) probs.push(`${l} bottom bar: ${bar.join("|")}`);
        await p.getByRole("button", { name: "More" }).click();
        const sheet = p.getByRole("dialog", { name: "More" });
        await sheet.waitFor();
        const links = await sheet.getByRole("link").allInnerTexts();
        const want = expected.filter((n) => !["AI Assistant", "Dashboard", "Projects", "Decisions & approvals"].includes(n));
        if (!same(links.map((s) => s.replace(/\s*\d+$/, "").trim()), want)) probs.push(`${l} More sheet: ${links.join("|")}`);
        if (l === "Simple" && !(await sheet.getByText(/hidden at this interface level/).count())) probs.push("Simple More sheet lacks the hidden-screens note");
        await sheet.getByRole("button", { name: "Close", exact: true }).click();
      }
      if (l === "Simple") await p.screenshot({ path: path.join(SHOTS, `size-${w}-simple.png`), fullPage: true });
    }
    check(`${w}px: each level shows the right menu${w < 768 ? " and More sheet" : ""}, one h1, no sideways scrolling`, probs.length === 0, probs.join(" ; "));
    if (w < 768) check(`${w}px: the level switch and page controls are at least 44 px`, smalls.length === 0, smalls.join(" / "));
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
