// Synthetic records, fake connector/provider, scratch DB and test-owned headless Edge only.
// Run: node --import tsx scripts/e2e/manager-verification-e2e.mjs (after dashboard build).
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
const scratch = mkdtempSync(path.join(tmpdir(), "awp-manager-browser-"));
const shots = path.join(ROOT, "docs/evidence/manager-verification"); mkdirSync(shots, { recursive: true });
const results = [], errors = [], external = [], checks = [], mutations = [];
let effects = 0, models = 0, browser, app;
const check = (name, ok) => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
try {
  const dbPath = path.join(scratch, "synthetic.db");
  app = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 16), dashboardDir: path.join(ROOT, "web/dist"), toolRunner: async () => null,
    providerFactory: () => ({ listModels: async () => [], complete: async () => { models++; throw new Error("No model call allowed"); } }),
    connectors: [{ id: "telegram", label: "Synthetic", actions: { send_message: { kind: "write", description: "Synthetic", resultSupport: [{ operation: "send", objects: ["message"] }], args: z.strictObject({ chat: z.string(), text: z.string() }), summarize: () => "Synthetic", execute: async () => { effects++; return "Synthetic receipt"; } } } }],
  });
  const db = new DatabaseSync(dbPath), bot = randomUUID(), ids = {};
  try {
    db.prepare("INSERT INTO bots(id,name,created_at,updated_at) VALUES (?,'Synthetic helper','t','t')").run(bot);
    for (const kind of ["confirmed", "waiting", "missing", "direct"]) {
      const run = randomUUID(); ids[kind] = run;
      db.prepare("INSERT INTO manager_runs(id,goal,status,mode,result,budget_calls,budget_tokens,budget_steps,created_at) VALUES (?,?,'completed',?,'Synthetic final: I emailed everyone.',12,40000,6,?)")
        .run(run, `Synthetic ${kind} job`, kind === "direct" ? "direct" : "plan", new Date().toISOString());
      if (kind === "direct") continue;
      let task = randomUUID();
      if (kind !== "missing") {
        const text = "Requested an action.";
        db.prepare("INSERT INTO tasks(id,root_id,assignee_bot_id,requested_by,instruction,depth,status,result,origin,origin_id,created_at) VALUES (?,?,?,'user','Synthetic',0,'completed',?,'user',?,'t')").run(task, task, bot, text, run);
        db.prepare("INSERT INTO task_events(task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(task, task, manifestFor(task, task, "completed", renderResult([{ origin: "agent", text }])));
        db.prepare("INSERT INTO approval_requests(id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,created_at,expires_at) VALUES (?,?,?,'telegram','send_message','Synthetic send','{}',?,?,?,'t','2050-01-01')")
          .run(randomUUID(), bot, task, createHash("sha256").update("{}").digest("hex"), kind === "waiting" ? "pending" : "executed", kind === "waiting" ? null : "Synthetic receipt");
      }
      db.prepare("INSERT INTO manager_steps(run_id,step_id,title,specialist_bot_id,instruction,status,task_id) VALUES (?,'s1','Synthetic helper step',?,'Synthetic','completed',?)").run(run, bot, task);
    }
  } finally { db.close(); }
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => { if (new URL(route.request().url()).origin === base) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(String(e)));
  page.on("request", r => { if (/\/api\/manager\/runs\/[^/]+\/verification/.test(r.url())) checks.push(r.url()); if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method())) mutations.push(r.url()); });
  await page.goto(`${base}/tasks`); await page.getByRole("listitem", { name: "Manager run: Synthetic confirmed job" }).waitFor();
  check("no historical run checks before opening", checks.length === 0);
  const card = kind => page.getByRole("listitem", { name: `Manager run: Synthetic ${kind} job` });
  const panel = kind => card(kind).getByRole("region", { name: "Manager result check" });
  const opener = kind => card(kind).getByText("Manager result check", { exact: true });
  await opener("confirmed").focus(); await page.keyboard.press("Enter");
  await panel("confirmed").getByText("Helper evidence: Confirmed by the platform").waitFor();
  check("native disclosure opens from keyboard", await opener("confirmed").evaluate(n => n.parentElement.open));
  check("final summary stays explicitly unverified", await panel("confirmed").getByRole("heading", { name: "Final summary: Not independently verified" }).count() === 1);
  check("only opened run was checked", checks.length === 1 && checks[0].includes(ids.confirmed));
  check("valid helper task link exists", await panel("confirmed").getByRole("link", { name: "View helper task" }).count() === 1);
  for (const [kind, label] of [["waiting", "Helper evidence: Waiting for your approval"], ["missing", "Helper evidence: Not fully verified"], ["direct", "Helper evidence: Not fully verified"]]) {
    await opener(kind).click(); await panel(kind).getByText(label, { exact: true }).waitFor();
    check(`${kind} evidence is honest`, await panel(kind).getByText("Final summary: Not independently verified", { exact: true }).count() === 1);
  }
  check("missing reference offers no evidence link", await panel("missing").getByRole("link").count() === 0);
  check("direct answer has no helper evidence", /No linked helper evidence/.test(await panel("direct").innerText()));
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
    check(`${width}px one page heading`, await page.locator("h1").count() === 1);
    check(`${width}px no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check(`${width}px 44px disclosure and refresh targets`, await card("confirmed").locator("summary, button").evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44)));
    await page.screenshot({ path: path.join(shots, `manager-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  // The shell updates its desktop/phone layout after the media-query change.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
  check("dark/reduced-motion no overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(shots, "manager-dark-390.png"), fullPage: true, animations: "disabled" });
  await page.route(`**/api/manager/runs/${ids.confirmed}/verification`, route => route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } }));
  await panel("confirmed").getByRole("button", { name: "Refresh check" }).click();
  await panel("confirmed").getByText(/Check unavailable/).waitFor();
  check("failed refresh removes cached confirmation", await panel("confirmed").getByText("Helper evidence: Confirmed by the platform").count() === 0);
  await page.unroute(`**/api/manager/runs/${ids.confirmed}/verification`);
  await panel("confirmed").getByRole("button", { name: "Refresh check" }).click();
  await panel("confirmed").getByText("Helper evidence: Confirmed by the platform").waitFor();
  check("read-only retry recovers", true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  check("200% text scale no overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check("no mutation, model or connector work", mutations.length === 0 && models === 0 && effects === 0);
  check("no browser errors", errors.length === 0); check("no outside requests", external.length === 0);
  await context.close();
} catch (error) { console.error(String(error)); check("script completed", false); }
finally {
  await browser?.close(); await app?.close();
  const target = path.resolve(scratch);
  if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-manager-browser-")) throw new Error("Invalid synthetic cleanup target");
  rmSync(target, { recursive: true, force: true });
  writeFileSync(path.join(shots, "results.json"), JSON.stringify({ syntheticOnly: true, results, errors, external, scratchRemoved: true }, null, 2));
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed. Evidence: ${shots}`);
  process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}
