// Real-browser check of the modernization work (D-081 to D-083): independent result verification (M4), outside-action workflow boxes behind the approval gate (M6)
// and the seven menu headings (M7). The REAL app (src/server.ts) on a scratch database, ONE FAKE local model server (127.0.0.1), a REAL Edge browser.
// Fictional data only. No internet, no keys, never touches data/app.db.
// Usage: npm --prefix web run build && node scripts/e2e/modernization-e2e.mjs      (needs port 3119)
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-modernization-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3119;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 260) : ""}`); };
const F = "```";
const block = (kind, o) => `${F}${kind}\n${JSON.stringify(o)}\n${F}`;
const sheet = (name) => ({ connector: "documents", action: "create_spreadsheet", args: { path: name, format: "csv", sheets: [{ name: "Prices", header: ["Item", "Price"], rows: [["Tea", 4]] }] } });

const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "llama3.1:8b" }] });
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(404, {});
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const users = body.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    const first = users[0] ?? "";
    const last = users.at(-1) ?? "";
    let content = "Done. This is a fictional reply.";
    if (last === "Reply with the single word OK.") content = "OK";
    else if (last.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
    else if (last.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
    else if (first.includes("Email Sam") && !last.startsWith("Here is what happened")) content = "I have sent the email to Sam. All done.";
    else if (first.includes("Make a price list file") && !last.startsWith("Here is what happened")) content = block("action", sheet("price-list.csv"));
    else if (first.includes("Make a price list file")) content = "I asked for approval to create the price list file. Nothing has been created yet.";
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;
const dir = mkdtempSync(path.join(tmpdir(), "awp-modernization-e2e-"));
mkdirSync(path.join(dir, "data"));
const files = path.join(dir, "files");
mkdirSync(files);
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
const done = async (id) => until(async () => { const s = (await call("GET", `/api/tasks/${id}`)).body.task.status; return ["completed", "failed", "cancelled"].includes(s) ? s : null; });

let browser;
try {
  check("app started on a scratch database", await ready());
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 1, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const atlas = (await call("POST", "/api/bots", { name: "Atlas", role: "Test agent", model: "auto/general", instructions: "Be brief." })).body.bot;
  await call("PATCH", `/api/bots/${atlas.id}`, { status: "active" });
  await call("POST", "/api/pc/workspaces", { path: files });
  await call("PUT", `/api/bots/${atlas.id}/pc`, { grants: ["modify"] });
  const g = await call("POST", "/api/access/folders", { path: files, ops: ["read", "create", "edit"], inherit: true, expiresInMinutes: 120, acknowledgeSensitive: "app_data", note: "e2e scratch" });
  check("folder permission granted for the scratch folder only", g.status === 201 || g.status === 200, JSON.stringify(g.body).slice(0, 120));
  const submit = async (instruction) => { const r = await call("POST", `/api/bots/${atlas.id}/tasks`, { instruction, saveToWorkspace: false }); await done(r.body.task.id); return r.body.task.id; };

  const textTask = await submit("Say hi to the team.");
  const boastTask = await submit("Email Sam the news.");
  const fileTask = await submit("Make a price list file.");

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const resultCheck = async (id) => { await page.goto(`${base}/tasks/${id}`); const r = page.getByRole("region", { name: "Result check" }); await r.waitFor({ timeout: 10000 }); return r; };

  // ===== M4: independent result verification
  let r = await resultCheck(textTask);
  check("M4: a text-only answer is labelled 'Not checked: the agent's own words' (never confirmed)", /Not checked: the agent's own words/.test(await r.innerText()) && !/Confirmed by the platform/.test(await r.innerText()));
  r = await resultCheck(boastTask);
  check("M4: a reply that claims an email was sent, with no action on record, is 'Contradicted: do not rely on it'", /Contradicted: do not rely on it/.test(await r.innerText()), (await r.innerText()).replace(/\s+/g, " "));
  await r.getByText(/What was checked/).click();
  check("M4: the check says what failed", /no send action was recorded/.test(await r.innerText()));
  r = await resultCheck(fileTask);
  check("M4: a task whose file is still waiting for approval says 'Waiting for your approval'", /Waiting for your approval/.test(await r.innerText()), (await r.innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: path.join(SHOTS, "1-result-check-waiting.png"), fullPage: true });
  check("M4: nothing was created before approval", !existsSync(path.join(files, "price-list.csv")));
  await page.goto(`${base}/approvals`);
  const card = page.getByRole("listitem", { name: /Approval request: Create the CSV file price-list/ });
  await card.waitFor({ timeout: 10000 });
  await card.getByRole("button", { name: /Approve/ }).first().click();
  await page.getByRole("button", { name: "Yes, do it once" }).click();
  const fileThere = await until(() => existsSync(path.join(files, "price-list.csv")), 10000);
  check("M4: after the owner approves, the file really exists", fileThere, JSON.stringify(((await call("GET", "/api/approvals")).body.approvals ?? []).map((x) => [x.action, x.status, x.error ?? x.result])).slice(0, 400));
  r = await resultCheck(fileTask);
  check("M4: the same task becomes 'Confirmed by the platform' (action ran + file exists with the reported size)", await until(async () => { await page.reload(); await page.getByRole("region", { name: "Result check" }).waitFor({ timeout: 8000 }); return /Confirmed by the platform/.test(await page.getByRole("region", { name: "Result check" }).innerText()); }, 20000), (await page.getByRole("region", { name: "Result check" }).innerText()).replace(/\s+/g, " "));
  await page.getByRole("region", { name: "Result check" }).getByText(/What was checked/).click();
  check("M4: the file check names the file", /The file exists with the reported size/.test(await page.getByRole("region", { name: "Result check" }).innerText()));
  await page.screenshot({ path: path.join(SHOTS, "2-result-check-verified.png"), fullPage: true });
  const caps = (await call("GET", "/api/capabilities")).body.capabilities;
  const atlasCap = caps.find((c) => c.id === `agent:${atlas.id}`);
  check("M4: the capability registry now marks the agent verified (one confirmed result) but lists the contradicted one", atlasCap.levels.verified.state === "yes" && /contradicted/.test(atlasCap.limits.join(" ")), JSON.stringify(atlasCap.levels.verified));

  // ===== M6: outside action box behind the approval gate
  const graph = { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 100, kind: "manual" }, { id: "save", type: "integration", label: "Write the note", x: 280, y: 100, botId: atlas.id, connector: "pc", action: "write_file", args: { path: "note-from-workflow.txt", content: "Hello {{input}}", overwrite: false } }, { id: "end", type: "end", label: "End", x: 560, y: 100 }], edges: [{ id: "a", from: "start", to: "save", when: "always" }, { id: "b", from: "save", to: "end", when: "always" }] };
  const wfCreated = await call("POST", "/api/workflows", { name: "Write a note", graph });
  check("M6: a workflow with an outside-action box can be saved (switched off)", wfCreated.status === 201, JSON.stringify(wfCreated.body).slice(0, 200));
  const wfId = wfCreated.body.workflow.id;
  check("M6: the server's checks find no problem with it", (wfCreated.body.workflow.problems ?? []).length === 0, JSON.stringify(wfCreated.body.workflow.problems));
  await page.goto(`${base}/workflows`);
  const sec = page.getByRole("region", { name: "Workflows" });
  await sec.getByRole("button", { name: "New workflow" }).click();
  const ed = page.getByRole("group", { name: "Workflow editor" }).first();
  await ed.waitFor({ timeout: 8000 });
  await ed.getByRole("button", { name: "Add Outside action" }).click();
  await ed.getByLabel("Service").waitFor({ timeout: 8000 });
  check("M6: the editor offers 'Add Outside action' with service and action pickers", (await ed.getByLabel("Service").locator("option").count()) > 1);
  await ed.getByLabel("Service").selectOption("pc");
  await ed.getByLabel("Action", { exact: true }).selectOption("write_file");
  check("M6: the editor says a write waits for approval", /stops here until you approve this on the Approvals page/.test(await ed.getByRole("note").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "4-outside-action-editor.png"), fullPage: true });
  await ed.getByRole("button", { name: "Close" }).click();

  const started = await call("POST", `/api/workflows/${wfId}/run`, { input: "world" });
  check("M6: the run starts", started.status === 202, JSON.stringify(started.body).slice(0, 160));
  const runId = started.body.run.id;
  const waiting = await until(async () => { const run = (await call("GET", `/api/workflows/runs/${runId}`)).body.run; return run.status === "waiting" ? run : null; }, 15000);
  check("M6: the run WAITS at the box (status waiting)", !!waiting, waiting ? "" : JSON.stringify((await call("GET", `/api/workflows/runs/${runId}`)).body.run.steps));
  check("M6: nothing was written before approval", !existsSync(path.join(files, "note-from-workflow.txt")));
  const bypass = await call("POST", `/api/workflows/runs/${runId}/steps/save/approve`);
  check("M6: the checkpoint route cannot approve it (409 needs_approval)", bypass.status === 409 && bypass.body?.error === "needs_approval", JSON.stringify(bypass.body));
  check("M6: the file is still not there after that attempt", !existsSync(path.join(files, "note-from-workflow.txt")));
  await page.goto(`${base}/workflows`);
  check("M6: the Workflows screen does not offer a checkpoint button for it", (await page.getByLabel("Waiting for you").getByRole("button", { name: /Approve Write a note/ }).count()) === 0);
  await page.goto(`${base}/approvals`);
  const wfCard = page.getByRole("listitem", { name: /Approval request: .*note-from-workflow/ });
  await wfCard.waitFor({ timeout: 10000 });
  check("M6: the approval request appears on the Approvals page", true);
  await wfCard.getByRole("button", { name: /Approve/ }).first().click();
  await page.getByRole("button", { name: "Yes, do it once" }).click();
  check("M6: after the owner approves, the file is written", await until(() => existsSync(path.join(files, "note-from-workflow.txt")), 10000));
  const finished = await until(async () => { const run = (await call("GET", `/api/workflows/runs/${runId}`)).body.run; return run.status === "completed" ? run : null; }, 20000);
  check("M6: the workflow then continues and completes by itself", !!finished, finished ? "" : JSON.stringify((await call("GET", `/api/workflows/runs/${runId}`)).body.run));
  check("M6: the file holds the filled-in text", existsSync(path.join(files, "note-from-workflow.txt")) && /Hello world/.test(readFileSync(path.join(files, "note-from-workflow.txt"), "utf8")));
  const wfCap = (await call("GET", "/api/capabilities")).body.capabilities.find((c) => c.id === `workflow:${wfId}`);
  check("M6: the registry shows the workflow with its completed run", wfCap?.levels.operational.state === "yes", JSON.stringify(wfCap?.levels.operational));

  // ===== M7: the seven headings
  const headings = async (p = page) => p.locator("nav[aria-label=Main] [data-heading]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await page.goto(`${base}/projects`);
  await page.getByRole("heading", { level: 1, name: "Projects" }).waitFor();
  const all7 = ["Global Assistant", "Inbox", "Projects", "Workflow Studio", "Business Workforce", "Activity", "Settings"];
  check("M7: at Advanced the menu shows all seven headings, in order", JSON.stringify(await headings()) === JSON.stringify(all7), (await headings()).join(" | "));
  const names = async () => (await page.getByRole("navigation", { name: "Main" }).getByRole("link").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent).replace(/,?\s*\d+ waiting\d*$/, "").trim()))).filter((n) => n !== "AI Workforce Studio home");
  const entries = await names();
  check("M7: all 12 entries are still listed and the AI Assistant is first", entries.length === 12 && entries[0] === "AI Assistant", entries.join(", "));
  await page.getByRole("button", { name: "Simple level" }).click();
  check("M7: at Simple only headings with listed entries appear (no empty heading)", JSON.stringify(await headings()) === JSON.stringify(["Global Assistant", "Inbox", "Projects", "Activity"]), (await headings()).join(" | "));
  await page.getByRole("button", { name: "Advanced level" }).click();
  check("M7: one h1 and nothing removed after switching back", (await page.getByRole("heading", { level: 1 }).count()) === 1 && (await names()).length === 12);
  await page.screenshot({ path: path.join(SHOTS, "3-menu-headings.png"), fullPage: false });
  for (const [w, h] of [[1024, 768], [390, 844]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await c.newPage();
    await p.goto(`${base}/projects`);
    await p.getByRole("heading", { level: 1, name: "Projects" }).waitFor({ timeout: 10000 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`M7: ${w}px has no sideways scroll`, overflow <= 1);
    if (w < 768) {
      await p.getByRole("button", { name: /More/ }).first().click().catch(() => undefined);
      check("M7: the phone's More sheet lists the headings", (await p.locator("[role=presentation]").filter({ hasText: /Business Workforce|Settings|Activity/ }).count()) >= 1);
    }
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
