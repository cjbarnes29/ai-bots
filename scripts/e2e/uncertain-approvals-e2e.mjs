// D-125: approved requests whose outcome was never recorded. Synthetic scratch app, fake connector, test-owned headless Edge only.
// No real services, keys or owner database/windows. Screenshots go to the temp folder, not the repository.
// Run: node --import tsx scripts/e2e/uncertain-approvals-e2e.mjs   (after the dashboard build)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const { buildApp } = await import(pathToFileURL(path.join(ROOT, "src/app.ts")).href);
const { z } = await import("zod");
const scratch = mkdtempSync(path.join(tmpdir(), "awp-uncertain-approvals-"));
const shots = path.join(scratch, "shots");
const dbPath = path.join(scratch, "synthetic.db");
const results = [], errors = [], external = [];
let effects = 0, browser, app;
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${String(detail).slice(0, 200)}` : ""}`); };
try {
  app = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 15), dashboardDir: path.join(ROOT, "web/dist"), toolRunner: async () => null,
    connectors: [{ id: "telegram", label: "Synthetic service", actions: { send_message: { kind: "write", resultSupport: [{ operation: "send", objects: ["message"] }], args: z.strictObject({ chat: z.string(), text: z.string() }), summarize: () => "Send a synthetic message", execute: async () => { effects++; return "synthetic receipt"; } } } }],
  });
  const db = new DatabaseSync(dbPath);
  const bot = randomUUID(), lost = randomUUID(), recent = randomUUID(), done = randomUUID();
  try {
    const now = new Date();
    db.prepare("INSERT INTO bots (id,name,created_at,updated_at) VALUES (?, 'Synthetic helper', ?, ?)").run(bot, now.toISOString(), now.toISOString());
    const insert = db.prepare("INSERT INTO approval_requests (id,bot_id,connector,action,summary,args_json,args_hash,status,result,error,created_at,expires_at,decided_at,decided_by,executed_at) VALUES (?,?,'telegram','send_message',?,?,?,?,?,NULL,?,?,?,'owner',?)");
    const rowFor = (id, summary, status, result, decidedMsAgo, executedAt) => {
      const args = JSON.stringify({ chat: "synthetic", text: `exact content for ${summary}` });
      insert.run(id, bot, summary, args, createHash("sha256").update(args).digest("hex"), status, result, new Date(now - 3_600_000).toISOString(), new Date(now.getTime() + 86_400_000).toISOString(), new Date(now - decidedMsAgo).toISOString(), executedAt);
    };
    rowFor(lost, "Lost outcome request", "approved", null, 10 * 60_000, null);
    rowFor(recent, "Just approved request", "approved", null, 10_000, null);
    rowFor(done, "Finished request", "executed", "synthetic receipt", 20 * 60_000, new Date(now - 19 * 60_000).toISOString());
  } finally { db.close(); }
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => { const u = new URL(route.request().url()); if (u.origin === base) return route.continue(); external.push(u.origin); return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const mutations = [];
  page.on("request", r => { if (["POST", "PUT", "DELETE", "PATCH"].includes(r.method())) mutations.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const api = async (p) => (await context.request.get(base + p)).json();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/approvals");
  const section = page.getByRole("region", { name: /Outcome unknown/ });
  await section.waitFor({ timeout: 10000 });
  await section.getByRole("listitem", { name: "Outcome unknown: Lost outcome request" }).waitFor({ timeout: 10000 });
  check("the old approved request with no outcome is listed under Outcome unknown", (await section.getByRole("listitem").count()) === 1);
  check("a just-approved request and a finished request are NOT listed", (await section.innerText()).indexOf("Just approved") === -1 && (await section.innerText()).indexOf("Finished request") === -1);
  const text = await section.innerText();
  check("it says plainly it may or may not have happened and was not sent again", /may or may not have happened/.test(text) && /It was not sent again\./.test(text));
  check("the exact content is shown and there are no Approve/Deny buttons in the card", /exact content for Lost outcome request/.test(text) && (await section.getByRole("button", { name: /Approve|Deny/ }).count()) === 0);
  check("the history marks a stuck approved request honestly", /Approved, but no outcome has been recorded/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: path.join(shots, "1-outcome-unknown-1280.png"), fullPage: true });

  await section.getByRole("button", { name: "It did happen" }).click();
  await section.getByText(/You recorded: it did happen\./).waitFor({ timeout: 8000 });
  check("recording shows the owner's own statement, not platform confirmation", /not checked by the platform/.test(await section.innerText()));
  check("a definite answer removes the answer buttons (it is final)", (await section.getByRole("button", { name: /It did (not )?happen|I cannot tell/ }).count()) === 0);
  check("recording made exactly one request: the reconcile POST", mutations.length === 1 && mutations[0] === `POST /api/approvals/${lost}/reconcile`, mutations.join(", "));
  check("nothing was sent to the connector", effects === 0, `effects=${effects}`);
  const rec = await api(`/api/approvals/${lost}`);
  check("the approval row itself is unchanged (still approved, no result, no error)", rec.approval.status === "approved" && rec.approval.result === null && rec.approval.error === null && rec.approval.executedAt === null);
  const log = await api("/api/audit?limit=50");
  const ev = log.events.filter(e => e.kind === "approval.reconciled");
  check("one permanent audit record was written with the outcome and no arguments", ev.length === 1 && ev[0].detail.outcome === "did_happen" && ev[0].detail.id === lost && !JSON.stringify(ev[0]).includes("exact content"), JSON.stringify(ev[0]?.detail));

  await page.reload();
  await page.getByRole("region", { name: /Outcome unknown/ }).getByText(/You recorded: it did happen\./).waitFor({ timeout: 10000 });
  check("the recorded answer survives a reload", true);

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + "/approvals");
    await page.getByRole("region", { name: /Outcome unknown/ }).getByRole("listitem").first().waitFor({ timeout: 10000 });
    check(`${width}px: one h1 and no sideways page scroll`, (await page.locator("h1").count()) === 1 && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)));
    await page.screenshot({ path: path.join(shots, `2-outcome-unknown-${width}.png`), fullPage: true });
  }
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("no outside browser requests", external.length === 0, external.join(", "));
  await context.close();
} catch (error) { check("script completed", false, String(error)); }
finally {
  await browser?.close(); await app?.close();
  const target = path.resolve(scratch);
  if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-uncertain-approvals-")) throw new Error("Invalid synthetic cleanup target");
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed. Screenshots (deleted with the scratch folder): ${shots}`);
  rmSync(target, { recursive: true, force: true });
  process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}
