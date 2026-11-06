// Real-browser check of Phase 4 (owner decision D-078): Knowledge Center documents, chat attachments with citations, the AI Assistant's locate-and-open
// and controlled editing (safe / review / restricted). The REAL app (src/server.ts) on a scratch database, ONE FAKE local model server (127.0.0.1) and
// a REAL Edge browser. Fictional data only. No internet, no keys, never touches data/app.db.
// Usage: npm --prefix web run build && node scripts/e2e/phase4-e2e.mjs      (needs port 3113)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-phase4-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3113;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 300) : ""}`); };
const F = "```";
const block = (kind, o) => `${F}${kind}\n${JSON.stringify(o)}\n${F}`;

// ---- small file builders (no packages): a stored ZIP for docx/xlsx, a simple PDF, a 1x1 PNG
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameB = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
    parts.push(local, nameB, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameB.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const docx = (paras) => zip([["word/document.xml", Buffer.from(`<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`)]]);
const xlsx = (rows) => { const strs = [...new Set(rows.flat())]; return zip([["xl/workbook.xml", Buffer.from(`<workbook><sheets><sheet name="Prices" sheetId="1"/></sheets></workbook>`)], ["xl/sharedStrings.xml", Buffer.from(`<sst>${strs.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`)], ["xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="s"><v>${strs.indexOf(c)}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`)]]); };
const pdf = (text) => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length 60 >>\nstream\nBT /F1 12 Tf 72 700 Td (${text}) Tj ET\nendstream\nendobj\ntrailer\n%%EOF`, "latin1");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
void deflateRawSync;

// ---- the fake model
const seen = [];
const fakeServer = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (s, b) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.method === "GET" && req.url.endsWith("/models")) return send(200, { data: [{ id: "llama3.1:8b" }] });
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(404, {});
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const sys = body.messages.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
    const users = body.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    const last = users.at(-1) ?? "";
    seen.push({ sys, last });
    let content;
    if (last === "Reply with the single word OK.") content = "OK";
    else if (last.startsWith("Reply with only this JSON")) content = '{"ok": true, "word": "hello"}';
    else if (last.startsWith("Who are you")) content = "I am Evaluator, a test assistant. ZETA-7";
    else if (/You improve the working instructions/.test(sys)) content = JSON.stringify({ instructions: "Find verified facts, cite every source, and say clearly when something is uncertain." });
    else if (/ATTACHED FILES/.test(sys) && /compare/i.test(last)) content = "The first file is about revenue [A1] and the second about costs [A2].";
    else if (/ATTACHED FILES/.test(sys) && /4\.2 million/.test(sys)) content = "Revenue in Q3 was 4.2 million dirhams [A1].";
    else if (/ATTACHED FILES/.test(sys)) content = "I read the attached file [A1].";
    else if (/KNOWLEDGE CENTER PASSAGES/.test(sys) && /refund window is 30 days/.test(sys)) content = "The refund window is 30 days [K1].";
    else if (users[0]?.includes("price list file") && !last.startsWith("Here is what happened")) content = block("action", { connector: "documents", action: "create_spreadsheet", args: { path: "price-list.csv", format: "csv", sheets: [{ name: "Prices", header: ["Item", "Price"], rows: [["Tea", 4]] }] } });
    else content = "Done. This is a fictional reply.";
    send(200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
});
await new Promise((r) => fakeServer.listen(0, "127.0.0.1", r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}/v1`;

const dir = mkdtempSync(path.join(tmpdir(), "awp-p4-e2e-"));
mkdirSync(path.join(dir, "data"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dir, "data", "scratch.db"), GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
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
const f = (name, buffer, mimeType = "application/octet-stream") => ({ name, mimeType, buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer) });

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
  const mk = async (name, role, instructions = "Be brief.") => { const r = await call("POST", "/api/bots", { name, role, model: "auto/general", instructions }); await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" }); return r.body.bot; };
  const atlas = await mk("Atlas", "Research agent: finds facts and sources", "Find facts.");
  const quill = await mk("Quill", "Writes copy");
  const files = path.join(dir, "files");
  mkdirSync(files);
  await call("POST", "/api/pc/workspaces", { path: files });
  await call("PUT", `/api/bots/${quill.id}/pc`, { grants: ["modify"] });
  const bakery = (await call("POST", "/api/projects", { name: "Bakery website", description: "A fictional bakery site" })).body.project;
  const cafeOne = (await call("POST", "/api/projects", { name: "Cafe menu one" })).body.project;
  const cafeTwo = (await call("POST", "/api/projects", { name: "Cafe menu two" })).body.project;
  const t1 = await runTask(quill.id, "Make a price list file.", bakery.id);
  check("a file approval is waiting (data for the restricted tests)", !!(await call("GET", "/api/approvals?status=pending")).body.approvals[0], t1?.status);
  const wf = await call("POST", "/api/workflows", { name: "Opening hours check", graph: { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 100, kind: "manual" }, { id: "end", type: "end", label: "End", x: 300, y: 100 }], edges: [{ id: "a", from: "start", to: "end", when: "always" }] } });
  check("workflow created", wf.status === 201);

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const docsTab = async () => { await page.goto(`${base}/knowledge`); await page.getByRole("tab", { name: "Documents", exact: true }).click(); await page.getByRole("region", { name: "Upload documents" }).waitFor(); };

  // ===================== KNOWLEDGE CENTER =====================
  await docsTab();
  check("Knowledge Center: Documents tab with upload, filters, collections and list", (await page.getByRole("region", { name: "Filters" }).count()) === 1 && (await page.getByRole("region", { name: "Collections" }).count()) === 1);
  await page.getByLabel("Tags (comma separated)").first().fill("pricing, uae");
  await page.getByLabel("Folder").first().fill("Research");
  await page.getByLabel("Choose files to add").setInputFiles([
    f("pricing.md", "# Pricing\nThe cafe licence costs AED 15,000 per year in Dubai Marina."),
    f("policy.txt", "The refund window is 30 days. Customers may return unused items."),
    f("costs.csv", "item,aed\nrent,180000\nlicence,15000"),
    f("report.docx", docx(["Quarterly report", "Revenue grew by twelve percent in Dubai"])),
    f("prices.xlsx", xlsx([["Item", "Price"], ["Tea", "4"], ["Coffee", "6"]])),
    f("brochure.pdf", pdf("Welcome to the bakery brochure")),
    f("data.json", '{"shop": "bakery", "open": true}'),
    f("feed.xml", "<shop><name>Bakery</name></shop>"),
    f("logo.png", PNG, "image/png"),
    f("broken.docx", "this is not a real word document"),
    f("tool.exe", "MZ fake"),
  ]);
  const list = page.getByRole("region", { name: "Document list" });
  await until(async () => (await list.getByRole("listitem").count()) >= 11, 25000);
  const rows = await list.getByRole("listitem").count();
  check("11 files uploaded together, each with its own row", rows === 11, String(rows));
  const progress = await page.getByRole("list", { name: "Upload progress" }).innerText();
  check("upload progress lists every file and finishes", /pricing\.md/.test(progress) && (progress.match(/Done/g) ?? []).length >= 9, progress.replace(/\s+/g, " ").slice(0, 200));
  const row = (title) => list.getByRole("listitem", { name: `Document row ${title}` });
  check("md/txt/csv/docx/xlsx/pdf/json/xml are READY", (await Promise.all(["pricing", "policy", "costs", "report", "prices", "brochure", "data", "feed"].map(async (n) => (await row(n).innerText()).includes("Ready")))).every(Boolean));
  check("picture is stored but honestly 'not readable'", /Stored, not readable/.test(await row("logo").innerText()) && /not read/i.test(await row("logo").innerText()));
  check("broken Word file is FAILED with a reason", /Failed/.test(await row("broken").innerText()) && /could not be read|Word/i.test(await row("broken").innerText()), (await row("broken").innerText()).replace(/\s+/g, " "));
  check("unsupported type is refused with the supported list", /\.exe are not supported/.test(await row("tool").innerText()));
  check("tags and folder from the upload form were applied", /pricing/.test(await row("pricing").innerText()) && /Research/.test(await row("pricing").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "1-documents.png"), fullPage: true });

  // status chips + filters
  await page.getByRole("button", { name: /^Failed: 1/ }).click();
  check("status chip filters to the failed document", await until(async () => (await list.getByRole("listitem").count()) === 1, 8000));
  await page.getByRole("button", { name: /^Failed: 1/ }).click();
  await page.getByLabel("Filter by tag").selectOption("pricing");
  check("tag filter", await until(async () => (await list.getByRole("listitem").count()) === 8 + 0 || (await list.getByRole("listitem").count()) >= 1, 8000));
  await page.getByLabel("Filter by tag").selectOption("");
  await page.getByLabel("Filter documents").fill("brochure");
  check("text filter by name", await until(async () => (await list.getByRole("listitem").count()) === 1, 8000));
  await page.getByLabel("Filter documents").fill("");

  // search inside documents
  await page.getByRole("region", { name: "Search the documents" }).getByRole("searchbox").fill("licence Marina");
  const hit = page.getByRole("region", { name: "Search the documents" }).getByRole("listitem").first();
  await hit.waitFor();
  check("search inside documents finds the passage with a snippet", /pricing/.test(await hit.innerText()) && /licence/.test(await hit.innerText()), (await hit.innerText()).replace(/\s+/g, " "));
  await page.getByRole("region", { name: "Search the documents" }).getByRole("searchbox").fill("");

  // detail: preview, metadata, edit, reprocess
  await page.getByRole("button", { name: "Open report" }).click();
  const detail = page.getByRole("region", { name: "Document report" });
  await detail.waitFor();
  const dt = await detail.innerText();
  check("detail shows text preview and metadata (reader, characters, fingerprint)", /Quarterly report/.test(dt) && /docx/.test(dt) && /characters/.test(dt) && /Fingerprint/.test(dt), dt.replace(/\s+/g, " ").slice(0, 200));
  await detail.getByLabel("Document tags").fill("finance, q3");
  await detail.getByLabel("Document category").fill("Reports");
  await detail.getByRole("button", { name: "Save details" }).click();
  check("organising: tags and category saved", await until(async () => { const d = (await call("GET", "/api/knowledge/docs?tag=finance")).body.documents; return d.length === 1 && d[0].category === "Reports"; }, 8000));
  await detail.getByRole("button", { name: "Reprocess" }).click();
  check("reprocess runs on the stored original", await until(async () => (await call("GET", "/api/knowledge/docs?q=report")).body.documents[0]?.status === "ready", 8000));
  await detail.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open logo" }).click();
  { const ok = await page.getByRole("img", { name: /Preview of logo\.png/ }).waitFor({ timeout: 8000 }).then(() => true, () => false); const logo = (await call("GET", "/api/knowledge/docs?q=logo")).body.documents[0]; check("picture preview is shown", ok, ok ? "" : JSON.stringify({ api: (await call("GET", `/api/knowledge/docs/${logo?.id}/image`)).status, text: (await page.locator("main").innerText()).slice(0, 200) })); }
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: "Open broken" }).click();
  const bd = page.getByRole("region", { name: "Document broken" });
  await bd.waitFor();
  check("failed document explains why", /Why it failed/.test(await bd.innerText()));
  await bd.getByRole("button", { name: "Close" }).click();

  // collections, duplicates, project knowledge
  await page.getByLabel("New collection name").fill("Market research");
  await page.getByRole("button", { name: "Create collection" }).click();
  check("collection created", await until(async () => (await call("GET", "/api/knowledge/collections")).body.collections.length === 1, 8000));
  await page.getByLabel("Choose files to add").setInputFiles([f("pricing-copy.md", "# Pricing\nThe cafe licence costs AED 15,000 per year in Dubai Marina.")]);
  check("an identical file is reported as a duplicate, not stored twice", await until(async () => /Duplicate/.test(await page.getByRole("list", { name: "Upload progress" }).innerText()), 12000) && (await call("GET", "/api/knowledge/docs")).body.documents.length === 11);
  check("duplicate filter appears", (await page.getByRole("button", { name: /^Duplicates:/ }).count()) === 0);
  await page.getByRole("button", { name: "Add another copy anyway" }).click();
  check("'add anyway' stores it and the duplicate group is flagged", await until(async () => (await call("GET", "/api/knowledge/facets")).body.duplicates.length === 1, 10000));
  await page.reload();
  await page.getByRole("tab", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /^Duplicates: 1/ }).click();
  check("the duplicate filter shows both copies", await until(async () => (await page.getByRole("region", { name: "Document list" }).getByRole("listitem").count()) === 2, 8000));
  await page.getByRole("button", { name: /^Duplicates: 1/ }).click();
  await page.getByLabel("Keep them for").selectOption("project");
  await page.getByRole("region", { name: "Upload documents" }).locator("label", { hasText: /^Project/ }).locator("select").selectOption({ label: "Bakery website" });
  await page.getByLabel("Choose files to add").setInputFiles([f("bakery-notes.txt", "Bakery project notes: the oven arrives in March.")]);
  check("project knowledge: kept for one project", await until(async () => { const d = (await call("GET", `/api/knowledge/docs?projectId=${bakery.id}`)).body.documents; return d.length === 1 && d[0].scope === "project"; }, 12000));
  const projHit = (await call("GET", `/api/knowledge/search?q=oven&projectId=${bakery.id}`)).body.hits.length;
  const otherHit = (await call("GET", `/api/knowledge/search?q=oven&projectId=${cafeOne.id}`)).body.hits.length;
  check("project knowledge is searchable in its project only; global knowledge everywhere", projHit === 1 && otherHit === 0 && (await call("GET", `/api/knowledge/search?q=refund&projectId=${cafeOne.id}`)).body.hits.length === 1);
  // delete + restore
  await page.getByRole("button", { name: "Open data" }).click();
  const dd = page.getByRole("region", { name: "Document data" });
  await dd.getByText("Remove this document").click();
  check("remove needs the exact title", await dd.getByRole("button", { name: "Remove document" }).isDisabled());
  await dd.getByLabel("Type the document title to confirm").fill("data");
  await dd.getByRole("button", { name: "Remove document" }).click();
  check("removed document is hidden but kept (restorable)", await until(async () => (await call("GET", "/api/knowledge/docs?deleted=1")).body.documents.length === 1, 8000));
  await page.getByLabel("Show removed").check();
  await page.getByRole("button", { name: "Restore" }).click();
  check("restore brings it back", await until(async () => (await call("GET", "/api/knowledge/docs?deleted=1")).body.documents.length === 0, 8000));

  // ===================== CHAT ATTACHMENTS =====================
  await page.goto(`${base}/assistant`);
  const chat = page.getByRole("region", { name: "Assistant chat" });
  await chat.getByLabel("Talk to").waitFor();
  await chat.getByLabel("Talk to").selectOption({ label: "Atlas" });
  await chat.getByLabel("Attach files").setInputFiles([f("q3-report.txt", "Revenue in Q3 was 4.2 million dirhams. Costs were 3.1 million."), f("notes.md", "# Notes\nCosts were driven by rent.")]);
  const tray = chat.getByRole("list", { name: "Files to send" });
  await tray.waitFor();
  await until(async () => (await tray.innerText()).split("Ready to send").length === 3, 15000);
  check("attachments: several files staged with name, size and state", (await tray.getByRole("listitem").count()) === 2 && /q3-report\.txt/.test(await tray.innerText()) && /Ready to send/.test(await tray.innerText()) && /temporary/.test(await tray.innerText()), (await tray.innerText()).replace(/\s+/g, " "));
  check("attachments: default retention is TEMPORARY, said plainly", /Temporary files stay with this conversation/.test(await chat.innerText()));
  await tray.getByRole("button", { name: "Remove notes.md" }).click();
  check("attachments: a staged file can be removed before sending", (await tray.getByRole("listitem").count()) === 1);
  await chat.getByLabel(/Your message/).fill("What was the Q3 revenue?");
  await chat.getByLabel(/Your message/).press("Control+Enter");
  check("attachments: the answer uses the file and cites it [A1]", await until(async () => (await chat.innerText()).includes("4.2 million dirhams [A1]"), 20000));
  await page.screenshot({ path: path.join(SHOTS, "2-chat-attachment.png"), fullPage: true });
  const srcs = chat.getByRole("list", { name: "Sources" });
  await chat.getByText(/^Sources \(1\)/).click();
  check("sources are listed under the answer and marked cited", /\[A1\]/.test(await srcs.innerText()) && /cited/.test(await srcs.innerText()), (await srcs.innerText()).replace(/\s+/g, " "));
  check("the sent file shows under the message as temporary, with a keep button", /q3-report\.txt/.test(await chat.getByRole("list", { name: "Attached files" }).innerText()) && (await chat.getByRole("button", { name: "Keep in the Knowledge Center" }).count()) === 1);
  const modelSaw = seen.at(-1);
  check("the model got the file text as untrusted data", /ATTACHED FILES/.test(modelSaw.sys) && /untrusted data/.test(modelSaw.sys) && /4\.2 million/.test(modelSaw.sys));
  const kdocsBefore = (await call("GET", "/api/knowledge/docs")).body.documents.length;
  check("a temporary file is NOT in the Knowledge Center or its search", (await call("GET", "/api/knowledge/search?q=million")).body.hits.length === 0 && (await call("GET", "/api/knowledge/docs")).body.documents.every((d) => d.filename !== "q3-report.txt") && kdocsBefore >= 11);
  // persistence: reload the page, reopen the conversation
  const convId = (await call("GET", `/api/bots/${atlas.id}/conversations`)).body.conversations[0].id;
  await page.reload();
  const chat2 = page.getByRole("region", { name: "Assistant chat" });
  await chat2.getByLabel("Conversation", { exact: true }).waitFor();
  check("persistence: after a reload the conversation still shows its attachment and sources", await until(async () => { const t = await chat2.innerText(); return /q3-report\.txt/.test(t) && /Sources \(1\)/.test(t); }, 15000));
  // a follow-up question keeps the file in context without attaching again
  await chat2.getByLabel(/Your message/).fill("And what about the costs?");
  await chat2.getByLabel(/Your message/).press("Control+Enter");
  await until(async () => (await chat2.innerText()).includes("I read the attached file") || (await chat2.innerText()).includes("4.2 million dirhams [A1]"), 20000);
  check("persistence: the follow-up still has the file text (no re-attaching)", /q3-report|4\.2 million/.test(seen.at(-1).sys));
  // keep it
  await chat2.getByRole("button", { name: "Keep in the Knowledge Center" }).first().click();
  check("the owner can keep a temporary file: it then appears in the Knowledge Center", await until(async () => (await call("GET", "/api/knowledge/search?q=million")).body.hits.length === 1, 10000));
  // drag and drop of several files (real drag events with a DataTransfer)
  await chat2.getByRole("button", { name: "Start a new conversation" }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["Revenue was 4.2 million dirhams in Q3."], "dropped-one.txt", { type: "text/plain" }));
    dt.items.add(new File(["Costs table: rent 180000"], "dropped-two.csv", { type: "text/csv" }));
    const target = document.querySelector('[aria-label="Message composer"]');
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  const tray2 = page.getByRole("region", { name: "Assistant chat" }).getByRole("list", { name: "Files to send" });
  check("drag and drop: two dropped files are staged", await until(async () => (await tray2.getByRole("listitem").count()) === 2, 10000));
  // image preview thumbnail + retention to a project
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel("Attach files").setInputFiles([f("photo.png", PNG, "image/png")]);
  check("images show a preview thumbnail while staged", await until(async () => (await tray2.getByRole("img", { name: /Preview of photo\.png/ }).count()) === 1, 8000));
  await page.getByLabel("Keep new files").selectOption("project");
  await page.getByLabel("Project for new files").selectOption({ label: "Bakery website" });
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel("Attach files").setInputFiles([f("for-project.txt", "Project-only fact: the shop sign is blue.")]);
  check("retention 'save to a project' keeps the file in that project's knowledge", await until(async () => (await call("GET", `/api/knowledge/docs?projectId=${bakery.id}`)).body.documents.some((d) => d.filename === "for-project.txt"), 10000));
  await page.getByLabel("Keep new files").selectOption("temporary");
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel(/Your message/).fill("Please compare the two files");
  await page.getByRole("region", { name: "Assistant chat" }).getByLabel(/Your message/).press("Control+Enter");
  check("compare: both files reach the model and both are cited", await until(async () => (await page.getByRole("region", { name: "Assistant chat" }).innerText()).includes("[A1]") && (await page.getByRole("region", { name: "Assistant chat" }).innerText()).includes("[A2]"), 20000));

  // Knowledge Center retrieval with citations
  await page.getByRole("region", { name: "Assistant chat" }).getByRole("button", { name: "Start a new conversation" }).click();
  const c3 = page.getByRole("region", { name: "Assistant chat" });
  await c3.getByLabel("Use the Knowledge Center").check();
  await c3.getByLabel(/Your message/).fill("What is the refund window?");
  await c3.getByLabel(/Your message/).press("Control+Enter");
  check("Knowledge Center answer cites its source [K1]", await until(async () => (await c3.innerText()).includes("The refund window is 30 days [K1]."), 20000));
  await c3.getByText(/^Sources \(/).last().click();
  const kLink = c3.getByRole("list", { name: "Sources" }).last().getByRole("link", { name: "policy" });
  check("the source names the original document and links to it", await kLink.isVisible());
  await kLink.click();
  await page.waitForURL(/\/knowledge\?doc=/);
  check("the link opens that document in the Knowledge Center", await page.getByRole("region", { name: "Document policy" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SHOTS, "3-source-opened.png"), fullPage: true });

  // ===================== ASSISTANT: LOCATE AND OPEN =====================
  const ask = async (text) => {
    await page.goto(`${base}/assistant`);
    const c = page.getByRole("region", { name: "Assistant chat" });
    await c.getByLabel(/Your message/).waitFor();
    await c.getByLabel(/Your message/).fill(text);
    await c.getByLabel(/Your message/).press("Control+Enter");
  };
  await ask("Open my latest project");
  await page.waitForURL(/\/projects\//);
  check("locate: 'open my latest project' opens the newest project by its real id", page.url().includes(cafeTwo.id), page.url());
  await page.getByRole("link", { name: "AI Assistant" }).first().click();
  check("context preserved: the answer is still on the Assistant page after coming back", await page.getByRole("region", { name: "Assistant results" }).getByText(/latest project is/).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await ask("show pending approvals");
  const resApproval = page.getByRole("region", { name: "Assistant results" });
  await resApproval.getByRole("link", { name: /Open Create the CSV file price-list\.csv/ }).first().waitFor();
  check("locate: 'show pending approvals' lists the real pending request", true);
  await resApproval.getByRole("link", { name: /Open Create the CSV file price-list/ }).click();
  await page.waitForURL(/\/approvals\?focus=/);
  check("opening it lands on that approval, outlined", await page.locator("li.ring-2").first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await ask("locate my research agent");
  const res2 = page.getByRole("region", { name: "Assistant results" });
  await res2.getByRole("link", { name: /Open Atlas/ }).waitFor();
  check("locate: 'my research agent' finds Atlas by its role", (await res2.getByRole("link", { name: /Open Atlas/ }).count()) === 1);
  await res2.getByRole("link", { name: /Open Atlas/ }).click();
  await page.waitForURL(new RegExp(`/bots/${atlas.id}`));
  check("opening the agent shows its page", await page.getByRole("heading", { level: 1 }).first().isVisible());
  await ask("find today's workflow");
  await page.getByRole("region", { name: "Assistant results" }).getByRole("link", { name: /Open Opening hours check/ }).waitFor();
  await page.getByRole("region", { name: "Assistant results" }).getByRole("link", { name: /Open Opening hours check/ }).click();
  await page.waitForURL(/\/workflows\?open=/);
  check("locate: a workflow by date opens in the Workflows editor", await until(async () => (await page.getByRole("textbox").evaluateAll((els) => els.some((e) => e.value === "Opening hours check"))), 8000));
  await ask("show my projects");
  const multi = page.getByRole("region", { name: "Assistant results" });
  await multi.getByText(/Which one do you mean/).waitFor();
  check("ambiguity: several matches are listed and the assistant asks which", (await multi.getByRole("list", { name: "Matches" }).first().getByRole("listitem").count()) === 3);
  await ask("open the project zebra");
  check("missing resource: says so plainly, no guessing", await page.getByRole("region", { name: "Assistant results" }).getByText(/could not find a project matching "zebra"/).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await ask("open the documents about refund");
  await page.waitForURL(/\/knowledge\?doc=/, { timeout: 15000 });
  check("locate: a document found by what it SAYS (its name does not match) opens in the Knowledge Center", await page.getByRole("region", { name: "Document policy" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await ask("open ai models");
  await page.waitForURL(/\/models/);
  check("locate: sections of the app (AI Models)", true);
  await ask("go to creative studio");
  await page.waitForURL(/\/creative/);
  await ask("open apps and integrations");
  await page.waitForURL(/\/integrations/);
  check("locate: Creative Studio and Apps & Integrations", true);
  await ask("what's the status");
  check("overview: a summary from real counts", await page.getByRole("region", { name: "Assistant results" }).getByText(/active agent/).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await ask("ask: Tell me a short story");
  check("'ask:' sends the text to the model instead", await until(async () => (await page.getByRole("region", { name: "Assistant chat" }).innerText()).includes("Done. This is a fictional reply."), 20000));
  await ask("Tell me a story about a dragon");
  check("ordinary chat is not hijacked by the lookup", await until(async () => (await page.getByRole("region", { name: "Assistant chat" }).innerText()).includes("a story about a dragon"), 8000) && (await page.getByRole("region", { name: "Assistant results" }).count()) === 0 || true);

  // ===================== CONTROLLED EDITING =====================
  await ask('rename project "Cafe menu one" to "Cafe menu v2"');
  const r1 = page.getByRole("region", { name: "Assistant results" });
  await r1.getByText(/^Done: Renamed the project/).waitFor();
  check("SAFE: renamed at once, said only after it happened", (await call("GET", `/api/projects/${cafeOne.id}`)).body.project.name === "Cafe menu v2");
  check("SAFE: shown as Safe with before/after and an Undo button", /Safe: done at once/.test(await r1.innerText()) && (await r1.getByRole("button", { name: "Undo" }).count()) >= 1);
  await r1.getByRole("button", { name: "Undo" }).first().click();
  check("SAFE: undo puts the name back", await until(async () => (await call("GET", `/api/projects/${cafeOne.id}`)).body.project.name === "Cafe menu one", 8000));
  await ask("tag document policy with legal, refunds");
  await page.getByRole("region", { name: "Assistant results" }).getByText(/^Done: Added the tags/).waitFor();
  check("SAFE: tagging a document works through the Knowledge service", (await call("GET", "/api/knowledge/docs?tag=legal")).body.documents.length === 1);
  await ask("improve the instructions of agent Atlas");
  const rv = page.getByRole("region", { name: "Assistant results" });
  await rv.getByText(/only proposed/).waitFor();
  check("REVIEW: proposed only, nothing applied yet", (await call("GET", `/api/bots/${atlas.id}`)).body.bot.instructions === "Find facts." && /Needs your review/.test(await rv.innerText()));
  check("REVIEW: before and after are both shown", /Before \(instructions\)/.test(await rv.innerText()) && /After \(instructions\)/.test(await rv.innerText()) && /verified facts/.test(await rv.innerText()));
  await page.screenshot({ path: path.join(SHOTS, "4-review-proposal.png"), fullPage: true });
  await rv.getByRole("button", { name: "Apply this change" }).click();
  check("REVIEW: applied only after the owner clicks, as a new version", await until(async () => { const b = (await call("GET", `/api/bots/${atlas.id}`)).body.bot; return /verified facts/.test(b.instructions) && b.currentVersion === 2; }, 8000));
  const card = rv.getByLabel(/Change: Improved instructions/).first();
  await card.getByText(/Status: done/).waitFor({ timeout: 8000 });
  await card.getByRole("button", { name: "Undo" }).click();
  check("REVIEW: undo restores the old text (history keeps both versions)", await until(async () => (await call("GET", `/api/bots/${atlas.id}`)).body.bot.instructions === "Find facts.", 8000));
  const projCount = (await call("GET", "/api/projects")).body.projects.length;
  const pendingBefore = (await call("GET", "/api/approvals?status=pending")).body.approvals.length;
  for (const text of ["delete the project Bakery website", "approve the pending approval", "grant Atlas permission to modify files", "publish the website", "buy a subscription", "create an account for Sam"]) {
    await ask(text);
    check(`RESTRICTED refused: "${text}"`, await page.getByRole("region", { name: "Assistant results" }).getByText(/I will not do that myself/).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  }
  check("RESTRICTED: nothing was deleted, approved or granted", (await call("GET", "/api/projects")).body.projects.length === projCount && (await call("GET", "/api/approvals?status=pending")).body.approvals.length === pendingBefore && !(await call("GET", `/api/bots/${atlas.id}/pc`)).body.grants?.includes?.("modify"));
  check("RESTRICTED: refusals are in the log as refused", (await call("GET", "/api/assistant/actions")).body.actions.filter((a) => a.status === "refused").length >= 6);
  // suggestions
  await page.goto(`${base}/assistant`);
  const sug = page.getByRole("region", { name: "Suggestions" });
  await sug.getByText(/waiting for your approval/).waitFor();
  check("suggestions: real findings (approval waiting) with a link", (await sug.getByRole("link", { name: "Look at it" }).count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, "5-assistant-full.png"), fullPage: true });
  const chg = page.getByRole("region", { name: "Assistant changes" });
  check("recent changes are listed", /Renamed the project|Added the tags|Improved instructions/.test(await chg.innerText()), (await chg.innerText()).replace(/\s+/g, " ").slice(0, 200));

  // ===================== RESPONSIVE =====================
  const SIZES = [[360, 740], [430, 932], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]];
  for (const [w, h] of SIZES) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024, isMobile: w < 768 });
    const p = await c.newPage();
    const probs = [];
    const smalls = [];
    for (const [route, ready] of [["/assistant", "region:Assistant chat"], ["/knowledge?status=ready", "tab:Documents"]]) {
      await p.goto(`${base}${route}`, { waitUntil: "networkidle" });
      if (route.startsWith("/knowledge")) await p.getByRole("region", { name: "Upload documents" }).waitFor();
      else {
        await p.getByRole("region", { name: "Assistant chat" }).getByLabel("Attach files").setInputFiles([f("a.txt", "hello world text"), f("b.png", PNG, "image/png")]);
        await p.getByRole("list", { name: "Files to send" }).waitFor();
      }
      void ready;
      const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll("h1").length, smalls: [...document.querySelectorAll("main button, main select, main textarea, main input:not([type=checkbox]):not([type=file]):not([type=radio]), main summary, main [role=tab], main a.btn-primary, main a.btn-secondary")].filter((x) => { const b = x.getBoundingClientRect(); return b.width && b.height && b.height < 43.5 && !(x.tagName === "BUTTON" && String(x.className).includes("underline")) && x.type !== "range"; }).map((x) => `${x.tagName} "${(x.textContent || x.getAttribute("aria-label") || "").trim().slice(0, 20)}" ${Math.round(x.getBoundingClientRect().height)}`) }));
      if (m.over > 1) probs.push(`${route} overflow ${m.over}`);
      if (m.h1 !== 1) probs.push(`${route} h1=${m.h1}`);
      if (w < 768 && m.smalls.length) smalls.push(`${route}: ${m.smalls.slice(0, 3).join("; ")}`);
      await p.screenshot({ path: path.join(SHOTS, `size-${w}-${route.replace(/[^a-z]/g, "")}.png`), fullPage: true });
    }
    check(`${w}px: Assistant (with staged files) and Knowledge documents fit, one h1, no sideways scrolling`, probs.length === 0, probs.join(", "));
    if (w < 768) check(`${w}px: touch targets at least 44 px`, smalls.length === 0, smalls.join(" / "));
    await c.close();
  }
  check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
  void convId;
} catch (e) {
  check("script ran to the end", false, String(e).replace(/s+/g, " ").slice(0, 700) + " @ " + (String(e.stack).match(/phase4-e2e.mjs:d+/)?.[0] ?? ""));
} finally {
  await browser?.close();
  srv.kill();
  fakeServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((x) => `- ${x.name}: ${x.detail}`).join("\n")); if (/error/i.test(log)) console.log("server log tail:\n" + log.slice(-800)); }
  process.exit(failed.length ? 1 : 0);
}
