// Synthetic scratch app, fake connector, test-owned headless Edge only. No real services, keys or owner database/windows.
// Run: node --import tsx scripts/e2e/dashboard-approvals-e2e.mjs (after dashboard build).
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
const { z } = await import("zod");
const scratch = mkdtempSync(path.join(tmpdir(), "awp-dashboard-approvals-"));
const dbPath = path.join(scratch, "synthetic.db");
const shots = path.join(ROOT, "docs/evidence/dashboard-approvals"); mkdirSync(shots, { recursive: true });
const results = [], errors = [], external = [];
let effects = 0, browser, app;
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`); };
try {
  app = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 14), dashboardDir: path.join(ROOT, "web/dist"), toolRunner: async () => null,
    connectors: [{ id: "telegram", label: "Synthetic service", actions: { send_message: { kind: "write", resultSupport: [{ operation: "send", objects: ["message"] }], args: z.strictObject({ chat: z.string(), text: z.string() }), description: "Synthetic send only", summarize: () => "Synthetic long request", execute: async () => { effects++; return "Synthetic execution receipt"; } } } }],
  });
  const db = new DatabaseSync(dbPath);
  const bot = randomUUID(), pendingId = randomUUID();
  try {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO bots (id,name,created_at,updated_at) VALUES (?, 'Synthetic helper', ?, ?)").run(bot, now, now);
    const insert = db.prepare("INSERT INTO approval_requests (id,bot_id,connector,action,summary,args_json,args_hash,status,result,error,created_at,expires_at) VALUES (?,?,'telegram','send_message',?,?,?,?,?,?,?,?)");
    for (const status of ["pending", "approved", "executed", "denied", "expired", "failed"]) {
      const args = JSON.stringify({ chat: "synthetic", text: "مرحبا — synthetic exact content\n" + "LONGWORD".repeat(status === "pending" ? 450 : 5) });
      insert.run(status === "pending" ? pendingId : randomUUID(), bot, `Synthetic ${status} request`, args, createHash("sha256").update(args).digest("hex"), status, status === "executed" ? "Synthetic recorded result" : null, status === "failed" ? "Synthetic service refusal" : null, now, "2050-01-01T00:00:00.000Z");
    }
  } finally { db.close(); }
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address(); const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => { const u = new URL(route.request().url()); if (u.origin === base) return route.continue(); external.push(u.origin); return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const mutations = [];
  page.on("request", r => { if (["POST", "PUT", "DELETE"].includes(r.method())) mutations.push(r.url()); });
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/approvals"]) {
      await page.goto(base + route);
      await page.getByRole("heading", { level: 1, name: route === "/" ? "Dashboard" : "Approvals" }).waitFor();
      if (route === "/approvals") await page.getByRole("button", { name: "Approve…" }).waitFor();
      else await page.getByText("Last updated", { exact: false }).first().waitFor();
      check(`${route} ${width}px one h1`, await page.locator("h1").count() === 1);
      check(`${route} ${width}px no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(shots, `${route === "/" ? "dashboard" : "approvals"}-${width}.png`), animations: "disabled" });
    }
    const opener = page.getByRole("button", { name: "Approve…" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Approve this outside action?" });
    await dialog.waitFor();
    const confirm = dialog.getByRole("button", { name: "Yes, do it once" });
    const b = await confirm.boundingBox();
    check(`dialog ${width}px footer in viewport`, !!b && b.y >= 0 && b.y + b.height <= 900);
    const targets = await dialog.locator("button").evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44));
    check(`dialog ${width}px 44px buttons`, targets);
    await confirm.focus(); await page.keyboard.press("Tab");
    check(`dialog ${width}px focus stays inside`, await dialog.evaluate(n => n.contains(document.activeElement)));
    await page.keyboard.press("Escape");
    check(`dialog ${width}px focus returns`, await opener.evaluate(n => n === document.activeElement));
  }
  check("opening/cancelling made no mutation or fake effect", mutations.length === 0 && effects === 0);
  // Simulate a capped batch but let the existing single-ID read reach the real synthetic app.
  await page.route("**/api/approvals?*", route => route.fulfill({ json: { approvals: [] } }));
  await page.goto(`${base}/approvals?focus=${pendingId}`);
  await page.getByRole("listitem", { name: "Approval request: Synthetic pending request" }).waitFor();
  check("older focused ID shown once", await page.locator(`#approval-${pendingId}`).count() === 1);
  check("capped list disclosed", await page.getByText(/Showing 0 latest requests; 1 waiting in total/).count() === 1);
  await page.unroute("**/api/approvals?*");
  await page.goto(`${base}/approvals?focus=${pendingId}`);
  await page.getByRole("button", { name: "Approve…" }).click();
  await page.getByRole("button", { name: "Yes, do it once" }).click();
  await page.getByRole("listitem", { name: "Past request: Synthetic pending request" }).waitFor();
  check("confirmed request executes one fake effect", effects === 1 && mutations.filter(u => u.endsWith(`/${pendingId}/approve`)).length === 1);
  for (const level of ["simple", "intermediate", "advanced"]) {
    await page.evaluate(level => localStorage.setItem("awp-interface-level", level), level); await page.reload();
    check(`${level} keeps outside-action pause control`, await page.getByRole("button", { name: "Pause all outside actions" }).count() === 1);
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shots, "approvals-dark-reduced-motion.png"), animations: "disabled" });
  check("dark/reduced-motion no overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ["/", "/approvals"]) {
    await page.goto(base + route);
    await page.getByRole("heading", { level: 1, name: route === "/" ? "Dashboard" : "Approvals" }).waitFor();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    check(`${route} 200% text scale no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("no outside browser requests", external.length === 0);
  await context.close();
} catch (error) { check("script completed", false, String(error)); }
finally {
  await browser?.close(); await app?.close();
  const target = path.resolve(scratch);
  if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-dashboard-approvals-")) throw new Error("Invalid synthetic cleanup target");
  rmSync(target, { recursive: true, force: true });
  writeFileSync(path.join(shots, "results.json"), JSON.stringify({ syntheticOnly: true, results, errors, external, scratchRemoved: true }, null, 2));
  console.log(`${results.filter(r => r.ok).length}/${results.length} passed. Evidence: ${shots}`);
  process.exitCode = results.some(r => !r.ok) ? 1 : 0;
}
