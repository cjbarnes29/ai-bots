// Scratch DB, synthetic records, fake connector/provider, and a test-owned headless Edge only.
// Run: node --import tsx scripts/e2e/workflow-verification-e2e.mjs (after dashboard build).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const { buildApp } = await import(pathToFileURL(path.join(ROOT, "src/app.ts")).href);
const { manifestFor, renderResult } = await import(pathToFileURL(path.join(ROOT, "src/delegation/result-provenance.ts")).href);
const { z } = await import("zod");
const scratch = mkdtempSync(path.join(tmpdir(), "awp-workflow-browser-"));
const shots = path.join(ROOT, "docs/evidence/workflow-verification"); mkdirSync(shots, { recursive: true });
const results = [], errors = [], external = [], checks = [], mutations = [], ids = {};
let effects = 0, models = 0, browser, app;
const check = (name, ok) => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
try {
  const dbPath = path.join(scratch, "synthetic.db");
  app = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 18), dashboardDir: path.join(ROOT, "web/dist"), toolRunner: async () => null,
    providerFactory: () => ({ listModels: async () => [], complete: async () => { models++; throw new Error("No model work allowed"); } }),
    connectors: [{ id: "telegram", label: "Synthetic", actions: { send_message: { kind: "write", description: "Synthetic", resultSupport: [{ operation: "send", objects: ["message"] }], args: z.strictObject({ text: z.string() }), summarize: () => "Synthetic", execute: async () => { effects++; return "Synthetic receipt"; } } } }],
  });
  const db = new DatabaseSync(dbPath), bot = randomUUID();
  const addApproval = (run, node, status, taskId = null, damaged = false) => {
    const id = randomUUID(), args = '{"text":"Synthetic only"}';
    db.prepare("INSERT INTO approval_requests(id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,created_at,expires_at) VALUES (?,?,?,'telegram','send_message','Synthetic send',?,?,?,?, 't','2050-01-01')")
      .run(id, bot, taskId, args, damaged ? "damaged" : createHash("sha256").update(args).digest("hex"), status, status === "executed" ? "Synthetic receipt" : null);
    if (!taskId) db.prepare("UPDATE workflow_steps SET ref_kind='approval',ref_id=? WHERE run_id=? AND node_id=?").run(id, run, node);
    return id;
  };
  try {
    db.prepare("INSERT INTO bots(id,name,created_at,updated_at) VALUES (?,'Synthetic helper','t','t')").run(bot);
    for (const kind of ["confirmed", "waiting", "invalid", "manager", "skipped", "uncertain", "task"]) {
      const run = randomUUID(), workflow = randomUUID(); ids[kind] = run;
      const node = kind === "manager" ? { id: "work", type: "manager", goal: "Synthetic", x: 100, y: 0 }
        : kind === "task" || kind === "skipped" ? { id: "work", type: "bot_task", botId: bot, instruction: "Synthetic", retries: 0, x: 100, y: 0 }
          : { id: "work", type: "integration", botId: bot, connector: "telegram", action: "send_message", args: { text: "Synthetic only" }, x: 100, y: 0 };
      const graph = { nodes: [{ id: "start", type: "trigger", kind: "manual", label: "Start", x: 0, y: 0 }, { ...node, label: "Synthetic work" }, { id: "end", type: "end", label: "End", x: 300, y: 0 }], edges: [{ id: "a", from: "start", to: "work", when: "always" }, { id: "b", from: "work", to: "end", when: "always" }] };
      db.prepare("INSERT INTO workflows(id,name,version,graph,created_at,updated_at) VALUES (?,?,1,?,'t','t')").run(workflow, `Synthetic ${kind}`, JSON.stringify(graph));
      db.prepare("INSERT INTO workflow_runs(id,workflow_id,workflow_version,graph,status,trigger,input,created_at) VALUES (?,?,1,?,?,'manual','Synthetic input',?)")
        .run(run, workflow, JSON.stringify(graph), kind === "waiting" ? "waiting" : kind === "uncertain" ? "failed" : "completed", new Date().toISOString());
      for (const n of graph.nodes) db.prepare("INSERT INTO workflow_steps(run_id,node_id,status,output) VALUES (?,?,?,'Synthetic output')")
        .run(run, n.id, n.id === "work" ? kind === "waiting" ? "waiting" : kind === "uncertain" ? "failed" : kind === "skipped" ? "skipped" : "completed" : "completed");
      if (["confirmed", "waiting", "invalid"].includes(kind)) ids[`${kind}Approval`] = addApproval(run, "work", kind === "waiting" ? "pending" : "executed", null, kind === "invalid");
      if (kind === "uncertain") db.prepare("UPDATE workflow_steps SET ref_kind='integration_uncertain' WHERE run_id=? AND node_id='work'").run(run);
      if (kind === "manager") {
        const managerId = randomUUID();
        db.prepare("INSERT INTO manager_runs(id,goal,status,mode,result,budget_calls,budget_tokens,budget_steps,requested_by,created_at) VALUES (?,'Synthetic','completed','direct','Synthetic final',12,40000,6,'workflow','t')").run(managerId);
        db.prepare("UPDATE workflow_steps SET ref_kind='manager',ref_id=? WHERE run_id=? AND node_id='work'").run(managerId, run);
      }
      if (kind === "task") {
        const id = randomUUID(), text = "Requested an action.";
        db.prepare("INSERT INTO tasks(id,root_id,assignee_bot_id,requested_by,instruction,depth,status,result,origin,origin_id,created_at) VALUES (?,?,?,'user','Synthetic',0,'completed',?,'user',?,'t')").run(id, id, bot, text, run);
        db.prepare("INSERT INTO task_events(task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(id, id, manifestFor(id, id, "completed", renderResult([{ origin: "agent", text }])));
        db.prepare("UPDATE workflow_steps SET ref_kind='task',ref_id=? WHERE run_id=? AND node_id='work'").run(id, run); addApproval(run, "work", "executed", id);
      }
    }
  } finally { db.close(); }
  await app.listen({ host: "127.0.0.1", port: 0 }); const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => { if (new URL(route.request().url()).origin === base) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(String(e)));
  page.on("request", r => { if (/\/api\/workflows\/runs\/[^/]+\/verification/.test(r.url())) checks.push(r.url()); if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method())) mutations.push(r.url()); });
  await page.goto(`${base}/workflows`); await page.getByRole("button", { name: "Synthetic confirmed (v1)", exact: true }).waitFor();
  check("no workflow evidence requests before opening a run", checks.length === 0);
  const row = kind => page.getByRole("button", { name: `Synthetic ${kind} (v1)`, exact: true }).locator("..").locator("..");
  const panel = kind => row(kind).getByRole("region", { name: "Workflow result check" });
  const openRun = async kind => { await page.getByRole("button", { name: `Synthetic ${kind} (v1)`, exact: true }).click(); await row(kind).getByText("Workflow result check", { exact: true }).waitFor(); };
  await openRun("confirmed"); check("expanding a run alone makes no evidence request", checks.length === 0);
  const disclosure = row("confirmed").getByText("Workflow result check", { exact: true }); await disclosure.focus(); await page.keyboard.press("Enter");
  await panel("confirmed").getByText("Recorded step evidence: Confirmed within the recorded scope", { exact: true }).waitFor();
  check("keyboard opens native result disclosure", await disclosure.evaluate(n => n.parentElement.open));
  check("workflow output remains independently unverified", await panel("confirmed").getByRole("heading", { name: "Workflow output: Not independently verified" }).count() === 1);
  check("only the selected check was fetched", checks.length === 1 && checks[0].includes(ids.confirmed));
  check("valid approval link focuses the exact record", await panel("confirmed").getByRole("link", { name: "View approval record" }).getAttribute("href") === `/approvals?focus=${ids.confirmedApproval}`);
  check("saved version and lifecycle are distinct", /Saved version 1.*Run state: completed/.test(await panel("confirmed").innerText()));
  for (const kind of ["waiting", "invalid", "manager", "skipped", "uncertain", "task"]) {
    await openRun(kind); await row(kind).getByText("Workflow result check", { exact: true }).click();
    const label = kind === "waiting" ? "Recorded step evidence: Waiting for a decision or action" : kind === "task" ? "Recorded step evidence: Confirmed within the recorded scope" : "Recorded step evidence: Not fully verified";
    await panel(kind).getByText(label, { exact: true }).waitFor(); check(`${kind} scoped state displayed`, true);
    check(`${kind} output still unverified`, await panel(kind).getByRole("heading", { name: "Workflow output: Not independently verified" }).count() === 1);
    if (kind === "manager") check("Manager's weak link inherits no evidence", /no exact workflow-run\/node backlink/.test(await panel(kind).innerText()) && await panel(kind).getByRole("link").count() === 0);
    if (kind === "invalid") check("invalid approval has no proof link", await panel(kind).getByRole("link").count() === 0);
    if (kind === "waiting") check("waiting run's cancel control preserved", await row(kind).getByRole("button", { name: "Cancel the run of Synthetic waiting" }).count() === 1);
    if (kind === "task") check("valid task evidence link exists", await panel(kind).getByRole("link", { name: "View task evidence" }).count() === 1);
  }
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
    check(`${width}px one page heading`, await page.locator("h1").count() === 1);
    check(`${width}px no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${width}px new interactive targets at least 44px`, await panel("task").locator("button,summary,a").evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44)));
    await page.screenshot({ path: path.join(shots, `workflow-${width}.png`), fullPage: true, animations: "disabled" });
    if (width === 390 || width === 1440) await row("task").screenshot({ path: path.join(shots, `workflow-check-${width}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
  check("dark/reduced-motion no overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(shots, "workflow-dark-390.png"), fullPage: true, animations: "disabled" });
  await page.route(`**/api/workflows/runs/${ids.task}/verification`, route => route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } }));
  await panel("task").getByRole("button", { name: "Refresh check" }).click(); await panel("task").getByText(/Check unavailable/).waitFor();
  check("failed refresh removes cached confirmation", await panel("task").getByText("Recorded step evidence: Confirmed within the recorded scope", { exact: true }).count() === 0);
  await page.unroute(`**/api/workflows/runs/${ids.task}/verification`); await panel("task").getByRole("button", { name: "Refresh check" }).click();
  await panel("task").getByText("Recorded step evidence: Confirmed within the recorded scope", { exact: true }).waitFor(); check("read-only refresh recovers", true);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
  check("200% text scale no page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check("checking made no mutation, model or connector calls", mutations.length === 0 && models === 0 && effects === 0);
  check("no browser errors", errors.length === 0); check("no outside browser requests", external.length === 0); await context.close();
} catch (error) { console.error(String(error)); check("script completed", false); }
finally {
  await browser?.close(); await app?.close(); const target = path.resolve(scratch);
  if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-workflow-browser-")) throw new Error("Invalid synthetic cleanup target");
  rmSync(target, { recursive: true, force: true });
  writeFileSync(path.join(shots, "results.json"), JSON.stringify({ syntheticOnly: true, results, errors, external, scratchRemoved: true }, null, 2));
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed. Evidence: ${shots}`); process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}
