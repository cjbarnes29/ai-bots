// D-104: observed daily-use walkthrough. Fresh synthetic DB, injected fake provider, scratch-only file and test-owned Edge.
// No product changes, real services, owner data/key copy, dependency or commit. Run: node --import tsx scripts/e2e/daily-use-e2e.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
for (const key of ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GUARDIAN_URL", "OLLAMA_BASE_URL"]) delete process.env[key];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const { buildApp } = await import(pathToFileURL(path.join(ROOT, "src/app.ts")).href);
const { OK_RESULT, modelInfo } = await import(pathToFileURL(path.join(ROOT, "src/llm/test-helpers.ts")).href);
const { manifestFor, renderResult } = await import(pathToFileURL(path.join(ROOT, "src/delegation/result-provenance.ts")).href);
const scratch = mkdtempSync(path.join(tmpdir(), "awp-daily-use-"));
const data = path.join(scratch, "data"), files = path.join(scratch, "files"); mkdirSync(data); mkdirSync(files);
const dbPath = path.join(data, "synthetic.db"), output = path.join(files, "launch-checklist.csv");
const evidence = path.join(ROOT, "docs/evidence/daily-use"); mkdirSync(evidence, { recursive: true });
const attempt = String(Date.now()), results = [], issues = [], scenarios = [], blocked = [], fakeCalls = [], pageErrors = [], ids = {}, seeded = [];
let app, browser, context, page, base, active = "setup", fatal = null;
let fixtureNow = Date.now();
const advanceMinute = () => { fixtureNow += 61_000; }; // Simulated owner pacing; real/default limits are unchanged.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!base || url.origin !== base) { blocked.push(url.origin); throw new Error("Outside request refused by synthetic harness"); }
  return nativeFetch(input, { ...options, redirect: "error" });
};
const F = "```", block = (kind, obj) => `${F}${kind}\n${JSON.stringify(obj)}\n${F}`;
const publication = tag => block("workspace", { kind: "finding", title: `Demo result ${tag}`, text: "Synthetic checklist requested; owner decision remains separate.", source: "Fictional walkthrough fixture; not a real source" });
const provider = {
  listModels: async () => [modelInfo("demo-local")],
  complete: async req => {
    if (fakeCalls.length >= 32) throw new Error("Fake completion ceiling reached");
    const sys = req.messages.filter(m => m.role === "system").map(m => String(m.content)).join("\n");
    const users = req.messages.filter(m => m.role === "user").map(m => String(m.content)), last = users.at(-1) ?? "";
    let text, kind;
    if (last === "Reply with the single word OK.") { text = "OK"; kind = "registry-connectivity"; }
    else if (last.startsWith("Reply with only this JSON")) { text = '{"ok":true,"word":"hello"}'; kind = "registry-json"; }
    else if (last.startsWith("Who are you")) { text = "I am Evaluator, a test assistant. ZETA-7"; kind = "registry-identity"; }
    else if (/You write a short, plain description/.test(sys)) { text = JSON.stringify({ description: "Demo Launch collects fictional launch notes and checklist tasks." }); kind = "description-review"; }
    else if (/You design a simple workflow/.test(sys)) { text = JSON.stringify({ name: "Demo launch review", steps: [{ type: "agent", agent: "Demo Writer", instruction: "Write a fictional launch note." }, { type: "checkpoint", message: "Review the fictional launch note?" }] }); kind = "workflow-draft"; }
    else if (/You are the Manager of a small AI workforce/.test(sys)) { text = JSON.stringify({ mode: "direct", answer: "Fictional Manager summary; no outside action was performed." }); kind = "manager-direct"; }
    else if (users.some(s => /DW_FILE_(DENY|APPROVE)/.test(s))) {
      const tag = users.some(s => s.includes("DW_FILE_APPROVE")) ? "approve" : "deny";
      text = last.startsWith("Here is what happened") ? `The checklist request is recorded for owner review.\n${publication(tag)}`
        : `${block("action", { connector: "documents", action: "create_spreadsheet", args: { path: "launch-checklist.csv", format: "csv", sheets: [{ name: "Launch", header: ["Item", "State"], rows: [["DEMO-ONLY-73", "Fictional"]] }] } })}\n${publication(tag)}`;
      kind = `task-file-${tag}`;
    } else if (/DW_CHAT/.test(last)) { text = "Fictional chat reply DEMO-ONLY-73."; kind = "ordinary-chat"; }
    else if (/ATTACHED FILES/.test(sys) && /DEMO-ONLY-73/.test(sys)) { text = "The fictional brief marker is DEMO-ONLY-73 [A1]."; kind = "attachment-answer"; }
    else throw new Error("Unexpected fake-provider request; no fallback to a real provider");
    fakeCalls.push({ index: fakeCalls.length + 1, kind }); return { ...OK_RESULT, text };
  },
};
const check = (name, ok, detail = "", severity = "S1") => {
  results.push({ scenario: active, name, status: ok ? "pass" : "fail", detail }); console.log(`${ok ? "PASS" : "FAIL"} ${active}: ${name}`);
  if (!ok) { issues.push({ id: `DU-${String(issues.length + 1).padStart(2, "0")}`, severity, name, detail }); throw new Error(`${severity}: ${name}`); }
};
const observe = (name, good, detail, id) => {
  results.push({ scenario: active, name, status: good ? "pass" : "finding", detail }); console.log(`${good ? "PASS" : "FINDING"} ${active}: ${name}`);
  if (!good) issues.push({ id, severity: "S2", name, detail });
};
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const answer = await r.json(); if (r.status >= 400) throw new Error(`Synthetic API ${method} ${url} returned ${r.status}: ${answer.error ?? "error"}`); return answer;
};
const until = async (fn, ms = 15000) => { const start = Date.now(); while (Date.now() - start < ms) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); } throw new Error("Synthetic state wait expired"); };
const startApp = async () => {
  app = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 23), dashboardDir: path.join(ROOT, "web/dist"), providerFactory: () => provider, toolRunner: async () => null,
    connectors: [], includePc: true, includeWorkspace: true, enforceFolderGrants: true, businessDir: path.join(scratch, "business"), managerPollMs: 5, clock: () => fixtureNow });
  await app.listen({ host: "127.0.0.1", port: base ? Number(new URL(base).port) : 0 }); base = `http://127.0.0.1:${app.server.address().port}`;
};
const chat = () => page.getByRole("region", { name: "Assistant chat" });
const goAssistant = async () => { await page.goto(`${base}/assistant?project=${ids.project}`); await chat().getByLabel(/Your message/).waitFor(); };
const ask = async text => { advanceMinute(); await goAssistant(); await chat().getByLabel(/Your message/).fill(text); await chat().getByLabel(/Your message/).press("Control+Enter"); };
const shot = async name => page.screenshot({ path: path.join(evidence, `${attempt}-${name}.png`), fullPage: true, animations: "disabled" });
const scenario = async (id, fn) => { active = id; await fn(); scenarios.push({ id, status: "observed" }); };
const taskDone = async instruction => {
  advanceMinute();
  const r = await call("POST", `/api/bots/${ids.bot}/tasks`, { instruction, projectId: ids.project });
  const id = r.task.id; const task = await until(async () => { const t = (await call("GET", `/api/tasks/${id}`)).task; return ["completed", "failed", "cancelled"].includes(t.status) ? t : null; });
  check("project task completes with a saved result", task.status === "completed", task.errorMessage ?? ""); return id;
};
try {
  await startApp();
  await call("PATCH", "/api/llm/providers/ollama", { enabled: true, dailyRequestCap: 32 });
  const model = (await call("POST", "/api/llm/providers/ollama/refresh-models")).models.find(m => m.modelId === "demo-local");
  await call("PATCH", `/api/llm/models/${model.id}`, { enabled: true });
  await call("POST", "/api/llm/registry/evaluate", { ref: model.ref, tests: ["connectivity", "json_output", "identity_instruction"], approvedRequests: 3 });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["ollama"], providerOrder: ["ollama"], maxAttempts: 1, enabled: true });
  ids.bot = (await call("POST", "/api/bots", { name: "Demo Writer", role: "Fictional walkthrough helper", model: model.ref, instructions: "Use fictional data only." })).bot.id;
  await call("PATCH", `/api/bots/${ids.bot}`, { status: "active" });
  ids.project = (await call("POST", "/api/projects", { name: "Demo Launch", description: "Fictional launch project." })).project.id;
  ids.otherProject = (await call("POST", "/api/projects", { name: "Demo Launch Backup", description: "Separate fictional project." })).project.id;
  await call("POST", "/api/pc/workspaces", { path: files }); await call("PUT", `/api/bots/${ids.bot}/pc`, { grants: ["modify"] });
  const grant = await call("POST", "/api/access/folders", { path: files, ops: ["read", "create", "edit"], inherit: true, expiresInMinutes: 120, acknowledgeSensitive: "app_data", note: "Synthetic daily walkthrough only" });
  ids.folder = grant.grant?.id ?? grant.id;
  ids.failed = randomUUID(); const db = new DatabaseSync(dbPath);
  try { db.prepare("INSERT INTO tasks(id,root_id,assignee_bot_id,requested_by,instruction,depth,status,error_code,error_message,created_at,finished_at) VALUES (?,?,?,'user','Synthetic prior task',0,'failed','synthetic_failure','fictional outage in seeded prior task',?,?)").run(ids.failed, ids.failed, ids.bot, new Date().toISOString(), new Date().toISOString()); } finally { db.close(); }
  await call("POST", `/api/projects/${ids.project}/items`, { kind: "task", id: ids.failed }); seeded.push("projects/helper/folder grant", "prior failed task (not executed)");
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => { if (new URL(route.request().url()).origin === base) return route.continue(); blocked.push(new URL(route.request().url()).origin); return route.abort(); });
  page = await context.newPage(); page.on("pageerror", error => pageErrors.push(String(error))); page.setDefaultTimeout(12000);
  await page.goto(base + "/projects"); await page.evaluate(() => localStorage.setItem("awp-interface-level", "simple")); await page.reload();
  await page.getByRole("button", { name: "Simple level" }).click();
  await scenario("1-find-project", async () => {
    await page.getByLabel("Search projects").fill("Demo Launch"); await page.getByRole("button", { name: "Open Demo Launch", exact: true }).click();
    check("correct project opens with one h1", page.url().includes(ids.project) && await page.locator("h1").count() === 1);
    check("Simple project retains five sections", await page.getByRole("tablist", { name: "Project sections" }).getByRole("tab").count() === 5);
    await ask("show my projects"); await page.getByRole("region", { name: "Assistant results" }).getByText(/Which one do you mean/).first().waitFor(); check("ambiguous lookup asks which project", true);
    check("navigation and lookup made no passive model request", fakeCalls.length === 3);
    await shot("01-project-context");
  });
  await scenario("2-attachment", async () => {
    await goAssistant(); const fresh = chat().getByRole("button", { name: "Start a new conversation" }); if (await fresh.count()) await fresh.click();
    await chat().getByLabel("Attach files").setInputFiles({ name: "demo-brief.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional project marker DEMO-ONLY-73.") });
    await chat().getByRole("list", { name: "Files to send" }).getByText("demo-brief.txt", { exact: false }).first().waitFor();
    await until(async () => !(await chat().getByRole("button", { name: /Uploading/ }).count()));
    await chat().getByLabel(/Your message/).fill("What is the marker in the attached fictional brief?"); await chat().getByLabel(/Your message/).press("Control+Enter");
    await chat().getByText("The fictional brief marker is DEMO-ONLY-73 [A1].", { exact: true }).waitFor();
    check("attachment answer cites the scripted source", true);
    check("temporary attachment is absent from Knowledge Center", (await call("GET", "/api/knowledge/docs")).documents.length === 0);
    ids.conversation = (await call("GET", `/api/bots/${ids.bot}/conversations`)).conversations[0].id;
    check("new conversation belongs to the chosen project", (await call("GET", `/api/related/conversation/${ids.conversation}`)).project?.id === ids.project);
    await shot("02-attachment-source");
  });
  await scenario("3-draft-and-context", async () => {
    const callsBefore = fakeCalls.length;
    await chat().getByLabel(/Your message/).fill("Unsent DEMO-DRAFT"); await page.goto(base + "/projects"); await goAssistant();
    check("unsent draft survives navigation", await chat().getByLabel(/Your message/).inputValue() === "Unsent DEMO-DRAFT");
    await page.getByRole("button", { name: "Intermediate level" }).click(); check("level switch keeps the draft", await chat().getByLabel(/Your message/).inputValue() === "Unsent DEMO-DRAFT");
    await page.getByRole("button", { name: "Advanced level" }).click(); await page.getByRole("button", { name: "Simple level" }).click();
    await chat().getByLabel("New conversations go in").selectOption(ids.otherProject);
    check("project selection does not reassign an existing conversation", (await call("GET", `/api/related/conversation/${ids.conversation}`)).project?.id === ids.project);
    const visible = await chat().innerText(); observe("existing conversation context is distinguishable", visible.includes("Demo Launch") && visible.includes("New conversations go in"), visible.slice(0, 550), "DU-CONTEXT");
    check("context and level changes made no passive model request", fakeCalls.length === callsBefore);
    await shot("03-conversation-context"); await chat().getByLabel(/Your message/).fill("");
  });
  await scenario("4-safe-and-review", async () => {
    await ask('rename project "Demo Launch" to "Demo Launch Updated"'); await page.getByRole("region", { name: "Assistant results" }).getByText(/^Done: Renamed the project/).first().waitFor();
    check("safe rename uses saved server state", (await call("GET", `/api/projects/${ids.project}`)).project.name === "Demo Launch Updated");
    await page.getByRole("region", { name: "Assistant results" }).getByRole("button", { name: "Undo", exact: true }).first().click();
    await until(async () => (await call("GET", `/api/projects/${ids.project}`)).project.name === "Demo Launch"); check("safe rename is undoable", true);
    for (const decision of ["Reject", "Apply this change"]) {
      const before = (await call("GET", `/api/projects/${ids.project}`)).project.description;
      await ask('draft a description for project "Demo Launch"'); const region = page.getByRole("region", { name: "Assistant results" });
      await region.getByText(/only proposed/).first().waitFor();
      check("review draft does not change stored description", (await call("GET", `/api/projects/${ids.project}`)).project.description === before);
      check("review has before and after", /Before \(description\)/.test(await region.innerText()) && /After \(description\)/.test(await region.innerText()));
      await region.getByRole("button", { name: decision, exact: true }).first().click();
      await until(async () => (await call("GET", "/api/assistant/actions")).actions.some(a => a.kind === "project.describe_draft" && a.status === (decision === "Reject" ? "rejected" : "applied")));
      check(`review ${decision} uses owner control`, (await call("GET", `/api/projects/${ids.project}`)).project.description === (decision === "Reject" ? before : "Demo Launch collects fictional launch notes and checklist tasks."));
    }
    await shot("04-review");
  });
  await scenario("5-restricted", async () => {
    const before = (await call("GET", "/api/projects")).projects.length;
    for (const text of ['delete the project "Demo Launch"', "approve the pending approval", "publish the website"]) {
      await ask(text); await page.getByRole("region", { name: "Assistant results" }).getByText(/I will not do that myself/).first().waitFor(); check(`restricted request refused: ${text}`, true, "", "S0");
    }
    check("restricted requests caused no project deletion or file effect", (await call("GET", "/api/projects")).projects.length === before && !existsSync(output), "", "S0");
  });
  await scenario("6-project-task-file", async () => {
    ids.deniedTask = await taskDone("DW_FILE_DENY: prepare the fictional launch checklist CSV and save your result.");
    let pending = (await call("GET", "/api/approvals?status=pending")).approvals.find(a => a.taskId === ids.deniedTask); check("first file request waits without creating a file", !!pending && !existsSync(output), "", "S0");
    await page.goto(`${base}/approvals?focus=${pending.id}`); let card = page.getByRole("listitem", { name: /Approval request:/ }); await card.getByRole("button", { name: /Deny/ }).click();
    const denyDialog = page.getByRole("dialog"); if (await denyDialog.count()) await denyDialog.getByRole("button", { name: /Yes|Deny/ }).last().click();
    await until(async () => (await call("GET", `/api/approvals/${pending.id}`)).approval.status === "denied"); check("denied request never created the CSV", !existsSync(output), "", "S0");
    ids.fileTask = await taskDone("DW_FILE_APPROVE: owner requests a NEW fictional launch checklist CSV; save your result.");
    pending = (await call("GET", "/api/approvals?status=pending")).approvals.find(a => a.taskId === ids.fileTask); ids.approval = pending.id;
    await page.goto(`${base}/approvals?focus=${pending.id}`); card = page.getByRole("listitem", { name: /Approval request:/ }); await card.getByRole("button", { name: /Approve/ }).first().click(); await page.getByRole("button", { name: "Yes, do it once" }).click();
    await until(() => existsSync(output)); check("exactly one approved scratch file exists", readdirSync(files).length === 1 && readFileSync(output, "utf8").includes("DEMO-ONLY-73"), "", "S0");
    check("project shared result entries are saved", (await call("GET", `/api/projects/${ids.project}/workspace`)).entries.length >= 2);
  });
  await scenario("7-result-checks", async () => {
    await page.goto(`${base}/tasks/${ids.fileTask}`); await page.getByRole("region", { name: "Result check" }).getByText("Confirmed by the platform", { exact: true }).waitFor(); check("task shows action/file evidence separately", true);
    const m = await call("POST", "/api/manager/runs", { goal: "Write a fictional launch summary", proceedAnyway: true }); ids.manager = m.run.id; await app.manager.idle();
    check("Manager final summary stays unverified", (await call("GET", `/api/manager/runs/${ids.manager}/verification`)).verification.finalSummary.status === "unverified");
    const graph = { nodes: [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 }, { id: "manager", type: "manager", goal: "Write a fictional launch summary", x: 100, y: 0 }, { id: "end", type: "end", x: 300, y: 0 }], edges: [{ id: "a", from: "start", to: "manager", when: "always" }, { id: "b", from: "manager", to: "end", when: "always" }] };
    const wf = (await call("POST", "/api/workflows", { name: "Demo Manager flow", graph })).workflow;
    ids.workflow = (await call("POST", `/api/workflows/${wf.id}/run`, { input: "Fictional", proceedAnyway: true })).run.id;
    await until(async () => (await call("GET", `/api/workflows/runs/${ids.workflow}`)).run.status === "completed");
    const v = (await call("GET", `/api/workflows/runs/${ids.workflow}/verification`)).verification; check("weak workflow Manager link supplies zero inherited evidence", v.steps.some(s => s.binding === "unbound") && v.supporting.evidence === 0 && v.outputAssessment.status === "unverified");
    // Seeded receipt corners reuse the one created scratch CSV; no additional action is executed.
    const graphFile = { nodes: [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 }, { id: "file", type: "integration", botId: ids.bot, connector: "documents", action: "create_spreadsheet", args: {}, x: 100, y: 0 }, { id: "end", type: "end", x: 300, y: 0 }], edges: [{ id: "a", from: "start", to: "file", when: "always" }, { id: "b", from: "file", to: "end", when: "always" }] };
    const fileWf = (await call("POST", "/api/workflows", { name: "SEEDED file-evidence fixture", graph: graphFile })).workflow;
    ids.seedManager = randomUUID(); ids.seedWorkflow = randomUUID(); const seedTask = randomUUID();
    const seedDb = new DatabaseSync(dbPath);
    try {
      seedDb.prepare("INSERT INTO manager_runs(id,goal,status,mode,result,budget_calls,budget_tokens,budget_steps,created_at) VALUES (?,'SEEDED file-evidence fixture','completed','plan','Synthetic summary',12,40000,6,'t')").run(ids.seedManager);
      const text = "Synthetic answer; file execution evidence is a separate fixture.";
      seedDb.prepare("INSERT INTO tasks(id,root_id,assignee_bot_id,requested_by,instruction,depth,status,result,origin,origin_id,created_at) VALUES (?,?,?,'user','SEEDED fixture',0,'completed',?,'user',?,'t')").run(seedTask, seedTask, ids.bot, text, ids.seedManager);
      seedDb.prepare("INSERT INTO task_events(task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(seedTask, seedTask, manifestFor(seedTask, seedTask, "completed", renderResult([{ origin: "agent", text }])));
      seedDb.prepare("INSERT INTO manager_steps(run_id,step_id,title,specialist_bot_id,instruction,status,task_id) VALUES (?,'s1','SEEDED file step',?,'SEEDED fixture','completed',?)").run(ids.seedManager, ids.bot, seedTask);
      const clone = seedDb.prepare("INSERT INTO approval_requests(id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,created_at,expires_at) SELECT ?,bot_id,?,connector,action,'SEEDED receipt for existing scratch file',args_json,args_hash,status,result,created_at,expires_at FROM approval_requests WHERE id=?");
      clone.run(randomUUID(), seedTask, ids.approval); const wfApproval = randomUUID(); clone.run(wfApproval, null, ids.approval);
      seedDb.prepare("INSERT INTO workflow_runs(id,workflow_id,workflow_version,graph,status,trigger,created_at) VALUES (?,?,1,?,'completed','manual','t')").run(ids.seedWorkflow, fileWf.id, JSON.stringify(fileWf.graph));
      for (const node of fileWf.graph.nodes) seedDb.prepare("INSERT INTO workflow_steps(run_id,node_id,status,ref_kind,ref_id) VALUES (?,?,'completed',?,?)").run(ids.seedWorkflow, node.id, node.id === "file" ? "approval" : null, node.id === "file" ? wfApproval : null);
    } finally { seedDb.close(); }
    seeded.push("Manager/workflow file-evidence corners: copied synthetic receipt for existing scratch CSV; no new execution");
    check("seeded Manager file evidence is initially checkable", (await call("GET", `/api/manager/runs/${ids.seedManager}/verification`)).verification.supporting.status === "verified");
    check("seeded workflow file evidence is initially checkable", (await call("GET", `/api/workflows/runs/${ids.seedWorkflow}/verification`)).verification.supporting.status === "verified");
    const folder = (await call("GET", "/api/access/folders")).grants.find(g => g.path === files); check("scratch folder grant identity is available", !!folder);
    await call("POST", `/api/access/folders/${folder.id}/revoke`);
    const checked = (await call("GET", `/api/tasks/${ids.fileTask}/chain-verification`)).verification;
    check("revoked file access is reported as unchecked", checked.checks.some(c => c.kind === "file_unchecked") && !checked.checks.some(c => c.kind === "file_exists"));
    check("Manager does not retain full file confirmation after revoke", (await call("GET", `/api/manager/runs/${ids.seedManager}/verification`)).verification.supporting.status === "unverified");
    check("workflow does not retain full file confirmation after revoke", (await call("GET", `/api/workflows/runs/${ids.seedWorkflow}/verification`)).verification.supporting.status === "unverified");
    await shot("07-task-evidence");
  });
  await scenario("8-explain-and-draft", async () => {
    await ask("why did my last task fail"); await page.getByRole("region", { name: "Assistant results" }).getByText(/fictional outage/).first().waitFor(); check("failure explanation links recorded seeded task", true);
    await goAssistant(); const before = (await call("GET", "/api/workflows")).workflows.length;
    await page.getByLabel("What should the workflow do?").fill("Write a fictional launch note then ask me to review it."); await page.getByRole("button", { name: "Draft a workflow", exact: true }).click();
    const draft = page.getByLabel("Workflow draft", { exact: true }); await draft.getByText("Demo launch review", { exact: true }).waitFor(); check("draft is not automatically saved", (await call("GET", "/api/workflows")).workflows.length === before);
    await draft.getByRole("button", { name: /Open.*Workflows/ }).click(); await page.waitForURL(/\/workflows/); check("opening draft still does not save it", (await call("GET", "/api/workflows")).workflows.length === before);
    await shot("08-unsaved-draft");
  });
  await scenario("9-controlled-restart", async () => {
    const before = { tasks: (await call("GET", "/api/tasks")).tasks.length, approvals: (await call("GET", "/api/approvals")).approvals.length, workspace: JSON.stringify((await call("GET", `/api/projects/${ids.project}/workspace`)).entries) };
    const count = fakeCalls.length; await page.goto("about:blank"); await app.close(); app = undefined; await startApp();
    check("scratch restart does not call a model or create task/approval duplicates", fakeCalls.length === count && (await call("GET", "/api/tasks")).tasks.length === before.tasks && (await call("GET", "/api/approvals")).approvals.length === before.approvals);
    check("shared entries persist on scratch reopen", JSON.stringify((await call("GET", `/api/projects/${ids.project}/workspace`)).entries) === before.workspace);
    check("conversation still belongs to its original project", (await call("GET", `/api/related/conversation/${ids.conversation}`)).project?.id === ids.project);
    check("temporary attachment remains absent from Knowledge Center", (await call("GET", "/api/knowledge/docs")).documents.length === 0);
    await goAssistant(); await until(async () => await chat().getByLabel("Conversation", { exact: true }).inputValue() === ids.conversation); check("browser restores the same conversation after scratch restart", true);
  });
  await scenario("10-failures-and-phone", async () => {
    for (const [name, pattern, url, misleading, issue] of [
      ["project list", "**/api/projects?*", "/projects", /No projects here/, "DU-READ-PROJECTS"],
      ["project hub", `**/api/projects/${ids.project}/hub`, `/projects/${ids.project}`, /Nothing is waiting for you/, "DU-READ-HUB"],
      ["helper list", "**/api/bots?*", "/assistant", /No active|No agents|No.*agent.*model|no.*bot/i, "DU-READ-HELPERS"],
      ["suggestions", "**/api/assistant/suggestions", "/assistant", /Nothing needs attention|No suggestions/i, "DU-READ-SUGGESTIONS"],
    ]) {
      let failedRead = false;
      await page.route(pattern, route => { failedRead = true; return route.fulfill({ status: 503, json: { error: "synthetic_unavailable", message: "Synthetic read unavailable" } }); });
      await page.goto(base + url); await page.getByRole("heading", { level: 1 }).waitFor();
      await until(() => failedRead); await until(async () => await page.getByText("Loading…", { exact: true }).count() === 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // A read-error response is an observation, not an injected product success.
      const scope = name === "suggestions" ? page.getByRole("region", { name: "Suggestions" }) : name === "helper list" ? chat() : name === "project hub" ? page.getByRole("region", { name: "Project hub" }) : page.getByRole("main");
      const text = await scope.innerText();
      observe(`${name} failure has explicit error state`, /could not|unavailable|failed to|couldn't|error/i.test(text) && !misleading.test(text), text.slice(-1800), issue);
      await shot(`10-${name.replaceAll(" ", "-")}-failure`); await page.unroute(pattern);
    }
    for (const width of [1440, 390, 360, 768]) {
      advanceMinute();
      await page.setViewportSize({ width, height: 900 }); await goAssistant();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 5000 });
      check(`${width}px layout has one h1 and no page overflow`, await page.locator("h1").count() === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await until(async () => await chat().getByText("Loading messages…", { exact: true }).count() === 0);
      const replies = chat().getByText("Fictional chat reply DEMO-ONLY-73.", { exact: true });
      const beforeReplies = await replies.count(), beforeCalls = fakeCalls.length;
      const box = chat().getByLabel(/Your message/); await box.fill("DW_CHAT keyboard phone check"); await box.press("Control+Enter");
      await until(async () => fakeCalls.length === beforeCalls + 1 && await replies.count() === beforeReplies + 1 && await chat().getByRole("button", { name: "Send", exact: true }).isEnabled() === false);
      check(`${width}px keyboard message receives a NEW fake reply`, fakeCalls.length === beforeCalls + 1);
      if (width === 390 || width === 1440) await shot(`10-assistant-${width}`);
    }
  });
  active = "final"; check("all ten scenarios observed", scenarios.length === 10); check("no outside request attempted", blocked.length === 0, "", "S0"); check("fake calls stayed within 32", fakeCalls.length <= 32);
  check("no uncaught browser errors", pageErrors.length === 0);
} catch (error) {
  fatal = { scenario: active, message: String(error) }; console.error(String(error)); if (page && !page.isClosed()) await shot("stopped").catch(() => {});
} finally {
  await browser?.close(); await app?.close(); globalThis.fetch = nativeFetch;
  const target = path.resolve(scratch); if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-daily-use-")) throw new Error("Unsafe synthetic cleanup target");
  rmSync(target, { recursive: true, force: true });
  const report = { syntheticOnly: true, attempt, scenarios, results, issues, fatal, fakeCalls, pageErrors, blockedOrigins: blocked, seeded, ids, scratchRemoved: true, productChanges: false, pacing: "Injected scratch clock advances one logical minute between owner requests; default per-minute limits unchanged" };
  writeFileSync(path.join(evidence, `${attempt}-results.json`), JSON.stringify(report, null, 2)); writeFileSync(path.join(evidence, "results.json"), JSON.stringify(report, null, 2));
  console.log(`${results.filter(r => r.status === "pass").length} passed; ${issues.length} findings; ${scenarios.length}/10 scenarios; ${fakeCalls.length}/32 fake calls. Evidence: ${evidence}`);
  process.exitCode = fatal || blocked.length ? 1 : 0;
}
