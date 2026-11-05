// End-to-end check of the shared project workspace in the REAL app (src/server.ts over real HTTP) and a REAL Edge browser.
// Scratch database and scratch folder, ONE FAKE local model server (127.0.0.1). No internet, no keys, never touches data/app.db.
// Covers: Researcher -> Analyst -> Writer through the workspace, the folder permission on file creation (refused without a folder grant, created with one),
// the dashboard's workspace tabs and owner actions, the Tasks form's project choice, a phone-width layout, and a restart on the same database.
// Usage: npm --prefix web run build && node scripts/e2e/workspace-e2e.mjs      (needs port 3110)
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-workspace-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3110;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };
const F = "```";
const block = (kind, o) => `${F}${kind}\n${JSON.stringify(o)}\n${F}`;

// ---- the fake model: answers the registry's probes, and plays the three agents from what the platform really sends
const seen = [];
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
    else {
      const who = /You are "([^"]+)"/.exec(sys)?.[1] ?? "?";
      const second = last.startsWith("Here is what happened");
      seen.push({ who, second, first: users[0] });
      if (who === "Researcher") content = ["Research finished.", block("workspace", { kind: "fact", title: "Cafe licence fee", text: "A Dubai cafe trade licence costs about AED 15,000 per year.", source: "Dubai Economy fee table 2026" }), block("workspace", { kind: "fact", title: "Evening foot traffic", text: "Dubai Marina has the highest evening foot traffic." })].join("\n");
      else if (who === "Analyst" && !second) content = [block("action", { connector: "documents", action: "create_spreadsheet", args: { path: users[0].includes("second try") ? "marina-costs-2.csv" : "marina-costs.csv", format: "csv", sheets: [{ name: "Costs", header: ["Item", "AED per year"], rows: [["Licence", 15000], ["Rent", 180000]] }] } }), block("workspace", { kind: "recommendation", title: "Open in Marina", text: "Open in Dubai Marina." }), block("workspace", { kind: "handover", for: "Writer", title: "Write the brief", text: "Use the cost CSV and the entries." })].join("\n");
      else if (who === "Analyst") content = "The cost table waits for the owner's approval.";
      else if (who === "Writer" && !second) content = block("action", { connector: "documents", action: "summarize_data", args: { path: "marina-costs-2.csv" } });
      else if (who === "Writer") {
        const ref = /\[(W-[0-9a-f]{8})\] recommendation/i.exec(users.join("\n"))?.[1] ?? "W-00000000";
        content = ["Brief: open in Dubai Marina; fixed costs about AED 195,000 a year.", block("workspace", { kind: "recommendation", replaces: ref, title: "Open in Marina (with costs)", text: "Open in Dubai Marina; fixed costs about AED 195,000 per year." }), block("workspace", { kind: "progress", title: "Brief written", text: "The owner's brief is complete." })].join("\n");
      } else content = "Nothing new to add.";
    }
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;

const dir = mkdtempSync(path.join(tmpdir(), "awp-ws-e2e-"));
mkdirSync(path.join(dir, "data"));
const files = path.join(dir, "files");
mkdirSync(files);
const dbPath = path.join(dir, "data", "scratch.db");
let srv;
let log = "";
const startServer = () => {
  srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
};
const base = `http://127.0.0.1:${PORT}`;
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };
const runTask = async (botId, instruction, projectId) => {
  const s = await call("POST", `/api/bots/${botId}/tasks`, { instruction, projectId });
  return until(async () => { const t = (await call("GET", `/api/tasks/${s.body.task.id}`)).body.task; return ["completed", "failed"].includes(t.status) ? t : null; });
};
const ws = async (pid) => (await call("GET", `/api/projects/${pid}/workspace`)).body;

let browser;
try {
  startServer();
  check("app started on a scratch database", await ready());
  // ---- the fake local model, verified by the registry's own core tests (local requests only)
  await call("PATCH", "/api/llm/providers/ollama", { baseUrl: fakeUrl, enabled: true });
  const local = ((await call("POST", "/api/llm/providers/ollama/refresh-models")).body?.models ?? []).find((m) => m.modelId === "llama3.1:8b");
  await call("PATCH", `/api/llm/models/${local.id}`, { enabled: true });
  const ev = await call("POST", "/api/llm/registry/evaluate", { ref: local.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  check("fake local model verified", ev.status === 200 && ev.body.result.results.every((x) => x.result === "pass"));
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 2, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const mk = async (name) => { const r = await call("POST", "/api/bots", { name, model: "auto/general", instructions: "Be brief." }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const researcher = await mk("Researcher");
  const analyst = await mk("Analyst");
  const writer = await mk("Writer");
  check("PC workspace folder accepted (database is elsewhere)", (await call("POST", "/api/pc/workspaces", { path: files })).status < 300);
  await call("PUT", `/api/bots/${analyst.id}/pc`, { grants: ["modify"] });
  await call("PUT", `/api/bots/${writer.id}/pc`, { grants: ["read"] });
  const project = (await call("POST", "/api/projects", { name: "Dubai cafe market" })).body.project;

  // ---- the three agents
  const r1 = await runTask(researcher.id, "Research the cafe market in Dubai Marina.", project.id);
  check("Researcher task completed", r1?.status === "completed");
  check("Researcher saw an empty workspace first", seen.find((s) => s.who === "Researcher")?.first.includes("Entries: none yet"));
  const r2 = await runTask(analyst.id, "Estimate yearly costs and recommend a location.", project.id);
  const analystFirst = seen.find((s) => s.who === "Analyst")?.first ?? "";
  check("Analyst received the Researcher's fact (with source) and the downgraded assumption before working", r2?.status === "completed" && /FACT \(agent cites a source\) by Researcher|fact by Researcher/.test(analystFirst) && /(ASSUMPTION \(not verified\)|assumption) by Researcher/.test(analystFirst));
  // file permission: approved, but the folder has no grant yet -> the platform refuses to write
  const p1 = (await call("GET", "/api/approvals?status=pending")).body.approvals[0];
  const a1 = (await call("POST", `/api/approvals/${p1.id}/approve`)).body.approval;
  check("FILE PERMISSION: an approved file is NOT written without a folder grant", a1?.status === "failed" && !existsSync(path.join(files, "marina-costs.csv")), a1?.error);
  const g = await call("POST", "/api/access/folders", { path: files, ops: ["read", "create", "edit"], inherit: true, expiresInMinutes: 120, acknowledgeSensitive: "app_data", note: "e2e scratch" });
  check("owner grants the scratch folder", g.status === 200, g.status === 200 ? "" : JSON.stringify(g.body).slice(0, 200));
  const r2b = await runTask(analyst.id, "Estimate yearly costs again (second try).", project.id);
  const p2 = (await call("GET", "/api/approvals?status=pending")).body.approvals[0];
  const a2 = (await call("POST", `/api/approvals/${p2.id}/approve`)).body.approval;
  check("with the folder grant the approved CSV is created", r2b?.status === "completed" && a2?.status === "executed" && existsSync(path.join(files, "marina-costs-2.csv")), a2?.error ?? "");
  const r3 = await runTask(writer.id, "Write the owner's brief.", project.id);
  const writerFirst = seen.find((s) => s.who === "Writer")?.first ?? "";
  check("Writer got the handover addressed to it and the created file", r3?.status === "completed" && /Handed over to you:\n\[W-[0-9a-f]{8}\] HANDOVER by Analyst/.test(writerFirst) && writerFirst.includes("marina-costs-2.csv"));
  check("Writer read the real CSV through its read permission", /sum 195000/.test(r3?.result ?? "") || seen.some((s) => s.who === "Writer" && s.second));
  let v = await ws(project.id);
  check("workspace: 6 entries from three agents (the re-run added no copies), one created file, the failed one not listed as a file", v.entries.length === 6 && v.files.filter((f) => f.status === "created").length === 1 && new Set(v.entries.map((e) => e.authorName)).size === 3, `${v.entries.length} entries, files ${JSON.stringify(v.files.map((f) => f.status))}`);

  // ---- the dashboard in a real browser
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base + "/projects");
  await page.getByRole("button", { name: "Open Dubai cafe market" }).click();
  const panel = page.getByRole("region", { name: "Shared workspace" });
  await panel.waitFor();
  check("browser: Research tab shows a fact with its source", await panel.getByRole("listitem", { name: "Entry Cafe licence fee" }).getByText("Source given by the agent: Dubai Economy fee table 2026").isVisible());
  check("browser: the source-less 'fact' is shown as an assumption with the platform's note", (await panel.getByRole("listitem", { name: "Entry Evening foot traffic" }).innerText()).match(/Assumption \(not verified\)[\s\S]*stored it as an assumption/) !== null);
  check("browser: the replaced recommendation is hidden, the correction shown", (await panel.getByRole("listitem", { name: "Entry Open in Marina", exact: true }).count()) === 0 && (await panel.getByRole("listitem", { name: "Entry Open in Marina (with costs)" }).isVisible()));
  await page.screenshot({ path: path.join(SHOTS, "1-research.png"), fullPage: true });
  await panel.getByRole("button", { name: "Mark Cafe licence fee as checked" }).click();
  check("browser: Mark as checked shows 'Checked by you'", await until(async () => (await panel.getByRole("listitem", { name: "Entry Cafe licence fee" }).getByText("Checked by you").count()) === 1, 5000));
  await panel.getByRole("button", { name: "Withdraw Evening foot traffic" }).click();
  check("browser: Withdraw hides the entry", await until(async () => (await panel.getByRole("listitem", { name: "Entry Evening foot traffic" }).count()) === 0, 5000));
  await panel.getByLabel("Show withdrawn and replaced entries").check();
  check("browser: 'show withdrawn and replaced' brings back both, labelled", (await panel.getByRole("listitem", { name: "Entry Evening foot traffic" }).getByText("Withdrawn", { exact: true }).isVisible()) && (await panel.getByRole("listitem", { name: "Entry Open in Marina", exact: true }).innerText()).includes("Replaced by"));
  await panel.getByRole("button", { name: "Restore Evening foot traffic" }).click();
  check("browser: Restore puts it back", await until(async () => (await panel.getByRole("button", { name: "Withdraw Evening foot traffic" }).count()) === 1, 5000));
  await panel.getByRole("tab", { name: /Task notes/ }).click();
  check("browser: Task notes tab shows the handover (for Writer) and the progress note", (await panel.getByRole("listitem", { name: "Entry Write the brief" }).innerText()).includes("For: Writer") && (await panel.getByRole("listitem", { name: "Entry Brief written" }).isVisible()));
  await panel.getByRole("tab", { name: /Shared files/ }).click();
  const fileRow = panel.getByRole("listitem", { name: `File ${path.join(files, "marina-costs-2.csv")}` });
  check("browser: Shared files tab shows the created CSV with its owner", (await fileRow.innerText()).includes("Created · owner: Analyst"));
  await page.screenshot({ path: path.join(SHOTS, "2-files.png"), fullPage: true });
  await panel.getByRole("tab", { name: /Agent contributions/ }).click();
  check("browser: Agent contributions lists all three agents", (await panel.getByRole("row", { name: /^Contribution / }).count()) === 3);
  await panel.getByRole("tab", { name: /Recent updates/ }).click();
  const upd = await panel.getByRole("tabpanel").innerText();
  check("browser: Recent updates show entries, the file, finished tasks and the owner's acts", /file created/.test(upd) && /task completed/.test(upd) && /workspace checked/.test(upd) && /workspace withdrawn/.test(upd), upd.slice(0, 200));
  await panel.getByRole("tab", { name: /Research and findings/ }).click();
  await panel.getByRole("listitem", { name: "Entry Cafe licence fee" }).getByRole("link", { name: "task" }).click();
  check("browser: an entry's task link opens that task", await until(async () => page.url().includes(`/tasks/${r1.id}`), 5000), page.url());
  // the Tasks form: start a task in the project from the dashboard
  await page.goto(base + "/tasks");
  await page.getByLabel("Project (optional)").selectOption({ label: "Dubai cafe market" });
  await page.getByLabel("Which bot").selectOption({ label: "Researcher" });
  await page.getByLabel("What should it do?").fill("Check the licence fee once more.");
  await page.getByRole("button", { name: "Start task" }).click();
  await until(async () => /\/tasks\/[0-9a-f-]{36}/.test(page.url()), 5000);
  const uiTask = page.url().split("/tasks/")[1];
  const items = (await call("GET", `/api/projects/${project.id}`)).body.items;
  check("browser: a task started from the Tasks form joins the chosen project", items.some((i) => i.kind === "task" && i.id === uiTask));
  await until(async () => (await call("GET", `/api/tasks/${uiTask}`)).body.task.status === "completed");
  check("that task's agent received the workspace (checked fact shown as checked)", /checked by the owner|\(checked\)/.test(seen.at(-1)?.first ?? ""));
  // phone width
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(base + "/projects");
  await page.getByRole("button", { name: "Open Dubai cafe market" }).click();
  await panel.waitFor();
  check("phone width: no sideways scrolling on the project workspace", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
  await page.screenshot({ path: path.join(SHOTS, "3-phone.png"), fullPage: true });

  // ---- restart on the same database
  const before = await ws(project.id);
  const errorsBeforeRestart = errors.length;
  srv.kill();
  await new Promise((r) => setTimeout(r, 1500));
  startServer();
  check("app restarted on the same database", await ready());
  // While the server is deliberately down, the open page's background refresh cannot connect: those errors are the restart itself, not a page fault.
  const restartNoise = errors.splice(errorsBeforeRestart).filter((x) => !/ERR_CONNECTION_REFUSED/.test(x));
  errors.push(...restartNoise);
  const after = await ws(project.id);
  const strip = (x) => JSON.stringify({ e: x.entries, f: x.files, c: x.contributions });
  check("after restart: the workspace (entries, files, contributions) is identical", strip(before) === strip(after), `${after.entries.length} entries`);
  const r5 = await runTask(researcher.id, "Does the Marina recommendation still hold?", project.id);
  const ctx = seen.at(-1)?.first ?? "";
  check("after restart: a new task receives the workspace (correction, checked fact, file, earlier work)", r5?.status === "completed" && ctx.includes("Open in Marina (with costs)") && /checked by the owner|\(checked\)/.test(ctx) && ctx.includes("marina-costs-2.csv") && ctx.includes("Earlier finished work"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/projects");
  await page.getByRole("button", { name: "Open Dubai cafe market" }).click();
  check("browser after restart: the workspace shows the checked fact", await until(async () => (await panel.getByRole("listitem", { name: "Entry Cafe licence fee" }).getByText("Checked by you").count()) === 1, 8000));
  check("no page or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("script completed", false, String(e?.stack ?? e).slice(0, 500));
} finally {
  await browser?.close();
  srv?.kill(); fakeServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (fake local model only; screenshots in ${SHOTS})`);
  if (failed.length) console.log("server log tail:", log.slice(-600));
  process.exit(failed.length ? 1 : 0);
}
