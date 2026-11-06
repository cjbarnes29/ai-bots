// REAL-MODEL VALIDATION, ROUND 2 (board P-48). Run:
//   AWP_APPROVED_PROVIDER_REQUESTS=22 AWP_USE_COPY_OF_REAL_DB=1 node --import tsx scripts/e2e/real-phase4b.mjs
// The owner directed free-Groq testing without a count; 22 is the assistant's conservative ceiling (about 20 planned), enforced by the platform: the Groq
// daily cap on a scratch COPY of the database is set to today's use + 22, retries are off. Groq only (three chat models), fictional documents and prompts only.
// Your real database is only READ (VACUUM INTO, like `npm run backup`); the copy (which holds the vault key) is deleted at the end. Keys are never printed.
// Evidence (fictional text only): docs/evidence/real-phase4/results-round2.json
// Planned requests: M1 multi-model 6, M2 auto routing 1, M3 fallback 1, M4 provider failure 1, M5 propose+Apply+use 4, M6 Word/Excel/PDF/CSV Q&A 4, M7 restore 1, M8 workflow revise 2 = 20.
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDocx, writeXlsx } from "../../src/documents/office.ts";
import { writePdf } from "../../src/documents/pdf.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 3116;
const BUDGET = Number(process.env.AWP_APPROVED_PROVIDER_REQUESTS ?? 0);
if (BUDGET !== 22 || process.env.AWP_USE_COPY_OF_REAL_DB !== "1") {
  console.error("Refusing to run: needs AWP_APPROVED_PROVIDER_REQUESTS=22 (P-48) and AWP_USE_COPY_OF_REAL_DB=1.");
  process.exit(2);
}
const results = [];
const evidence = { startedAt: new Date().toISOString(), budget: BUDGET, steps: {}, notes: {} };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).replace(/\s+/g, " ").slice(0, 230) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64");

const tmp = mkdtempSync(path.join(tmpdir(), "awp-real-p4b-"));
mkdirSync(path.join(tmp, "copy"), { recursive: true });
const dbPath = path.join(tmp, "copy", "app.db");
{
  const src = new DatabaseSync(path.join(ROOT, "data", "app.db"), { readOnly: true });
  try { src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`); } finally { src.close(); }
  copyFileSync(path.join(ROOT, "data", "vault.key"), path.join(tmp, "copy", "vault.key"));
}
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
srv.stdout.on("data", () => {}); srv.stderr.on("data", () => {});
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-awp-client": "dashboard" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await sleep(500); } return false; };
const usedToday = async () => ((await call("GET", "/api/llm/usage?days=1")).body?.usage?.byDay ?? []).reduce((n, d) => n + Number(d.ok ?? 0) + Number(d.errors ?? 0), 0);
let startUsed = 0;
const step = async (label, fn) => {
  if ((await usedToday()) - startUsed >= BUDGET) { check(`${label}: skipped (budget reached)`, false); return null; }
  const before = await usedToday();
  let out = null;
  try { out = await fn(); } catch (e) { check(`${label}: ran`, false, String(e).slice(0, 200)); }
  const used = (await usedToday()) - before;
  evidence.steps[label] = { requests: used, ...(out ?? {}) };
  console.log(`      (${label}: ${used} request(s); total ${(await usedToday()) - startUsed}/${BUDGET})`);
  if (used > 0) await sleep(20000); // gentle pacing for Groq's free tokens-per-minute limit
  return out;
};
const text = (r) => String(r?.assistantMessage?.content ?? r?.message ?? "");
const cites = (s) => /\[\s*[AK]\s*\d+/.test(s);
const lastRouting = async () => ((await call("GET", "/api/llm/routing/history")).body?.recent ?? [])[0] ?? null;

let exitCode = 0;
try {
  check("scratch copy of the app started", await ready());
  startUsed = await usedToday();
  evidence.usedBefore = startUsed;
  await call("PATCH", "/api/llm/providers/groq", { enabled: true, dailyRequestCap: startUsed + BUDGET });
  for (const id of ["gemini", "openrouter", "omniroute", "ollama"]) await call("PATCH", `/api/llm/providers/${id}`, { enabled: false });
  await call("PUT", "/api/llm/routing", { allowedProviders: ["groq"], providerOrder: ["groq"], maxAttempts: 2, enabled: true });
  await call("PUT", "/api/llm/limits", { retries: 0, botRequestsPerMinute: 30, providerRequestsPerMinute: 30, timeoutMs: 90000 });
  const cap = (await call("GET", "/api/llm/providers")).body?.providers?.find?.((p) => p.id === "groq")?.dailyRequestCap;
  check("Groq daily cap on the copy = today's use + 22 (platform-enforced)", cap === startUsed + BUDGET, `cap=${cap} start=${startUsed}`);
  const registry = (await call("GET", "/api/llm/models")).body.models.filter((m) => m.providerId === "groq");
  evidence.notes.groqModels = registry.map((m) => ({ ref: m.ref, verification: m.verification, routable: m.routable, callable: m.callable, kind: m.kind }));
  evidence.notes.autoOrderGeneral = ((await call("GET", "/api/llm/routing")).body?.preview?.general ?? []).map((x) => x.ref);

  const MODELS = { qwen: "groq/qwen/qwen3.8-27b", oss120: "groq/openai/gpt-oss-120b", oss20: "groq/openai/gpt-oss-20b" };
  const mkBot = async (name, model, instructions = "Answer from the sources you are given.") => {
    const r = await call("POST", "/api/bots", { name, role: "Test agent", instructions, model });
    if (r.status >= 300) return { error: r.body?.message ?? `HTTP ${r.status}`, status: r.status };
    await call("PATCH", `/api/bots/${r.body.bot.id}`, { status: "active" });
    return r.body.bot;
  };
  const bots = { qwen: await mkBot("Probe Qwen", MODELS.qwen), oss120: await mkBot("Probe 120b", MODELS.oss120), oss20: await mkBot("Probe 20b", MODELS.oss20), auto: await mkBot("Probe Auto", "auto/general") };
  check("three pinned-model agents and one automatic agent were created", Object.values(bots).every((b) => b.id), JSON.stringify(Object.fromEntries(Object.entries(bots).map(([k, b]) => [k, b.id ? "ok" : b.error]))));
  const project = (await call("POST", "/api/projects", { name: "P4B Probe Project" })).body.project;

  // fictional documents: plain text for the model comparison; the app's own writers (Word, Excel, PDF) for the format tests
  const up = (filename, bytes) => call("POST", "/api/knowledge/docs", { filename, contentBase64: (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).toString("base64"), tags: ["p4b-test"] });
  await up("shop-policy.txt", "Refund policy. The refund window is 30 days from purchase. Customers must keep the receipt.");
  const docx = writeDocx({ title: "Staff handbook", blocks: [{ type: "heading", level: 1, text: "Holidays" }, { type: "paragraph", text: "Every employee receives 25 days of paid holiday each year." }, { type: "table", header: ["Role", "Notice period"], rows: [["Baker", "30 days"], ["Cashier", "14 days"]] }] });
  const xlsx = writeXlsx([{ name: "Prices", header: ["Item", "AED"], rows: [["Tea", 4], ["Coffee", 6], ["Cake", 18]] }, { name: "Costs", header: ["Item", "AED"], rows: [["Rent", 180000]] }]);
  const pdf = writePdf({ title: "Supplier letter", blocks: [{ type: "heading", level: 1, text: "Delivery terms" }, { type: "paragraph", text: "Deliveries arrive every Tuesday before noon. Orders must be placed by Friday." }] });
  const csv = "supplier,city\nNour Flour,Dubai\nGulf Dairy,Sharjah";
  const docs = { docx: await up("staff-handbook.docx", docx), xlsx: await up("price-list.xlsx", xlsx), pdf: await up("supplier-letter.pdf", pdf), csv: await up("suppliers.csv", csv) };
  check("Word, Excel, PDF and CSV files (written by the app's own writers) are processed with no model", Object.entries(docs).every(([, r]) => r.body?.document?.status === "ready"), Object.entries(docs).map(([k, r]) => `${k}:${r.body?.document?.status}`).join(" "));
  evidence.notes.documentStatuses = Object.fromEntries(Object.entries(docs).map(([k, r]) => [k, { status: r.body?.document?.status, chars: r.body?.document?.textChars, chunks: r.body?.document?.chunkCount }]));
  const ask = (botId, message, extra = {}) => call("POST", `/api/bots/${botId}/chat`, { message, useKnowledge: true, ...extra }).then((r) => r.body);

  // ===== M1: the same two tasks on each of the three Groq models
  for (const [key, ref] of Object.entries(MODELS)) {
    await step(`M1 ${key} workflow draft`, async () => {
      const r = await call("POST", "/api/workflows/draft", { description: "Collect competitor prices with the Probe Auto agent, then ask me before the summary is shared.", modelRef: ref });
      const types = r.body?.draft?.graph?.nodes?.map((n) => n.type) ?? [];
      check(`M1 ${key} (${ref}): workflow draft`, r.status === 200 && types.includes("bot_task") && types.includes("checkpoint"), `${r.status} ${types.join(">")} ${r.body?.message ?? ""}`);
      return { status: r.status, types, message: r.body?.message };
    });
  }
  for (const [key] of Object.entries(MODELS)) {
    await step(`M1 ${key} cited answer`, async () => {
      const bot = bots[key];
      if (!bot.id) { check(`M1 ${key}: answer`, false, `agent not created: ${bot.error}`); return { skipped: bot.error }; }
      const r = await ask(bot.id, "What is the refund window?");
      const a = text(r);
      check(`M1 ${key}: right answer (30 days) with a citation`, /30/.test(a) && cites(a), a.slice(0, 200));
      check(`M1 ${key}: the source is marked cited`, (r.sources ?? []).some((s) => s.cited), JSON.stringify((r.sources ?? []).map((s) => [s.title, s.cited])));
      return { answer: a, status: r.error ?? "ok" };
    });
  }
  // ===== M2: automatic routing
  await step("M2 automatic routing", async () => {
    const r = await ask(bots.auto.id, "When do deliveries arrive?");
    const a = text(r);
    const route = await lastRouting();
    check("M2: the automatic agent was answered by a verified Groq model (the registry's first choice)", !!route?.answeredBy && evidence.notes.autoOrderGeneral.includes(route.answeredBy), `answeredBy=${route?.answeredBy} order=${evidence.notes.autoOrderGeneral.join(">")}`);
    check("M2: the answer is right (Tuesday) with a citation", /tuesday/i.test(a) && cites(a), a.slice(0, 200));
    return { answeredBy: route?.answeredBy, attempts: route?.attempts, answer: a };
  });
  // ===== M3: fallback. A failing first choice, then real Groq
  await step("M3 fallback", async () => {
    const set = await call("PUT", "/api/llm/routing", { allowedProviders: ["demo", "groq"], providerOrder: ["demo", "groq"], maxAttempts: 2, enabled: true });
    const preview = ((await call("GET", "/api/llm/routing")).body?.preview?.general ?? []).map((x) => x.ref);
    evidence.notes.fallbackPreview = { status: set.status, preview, message: set.body?.message };
    if (!preview.some((p) => p.startsWith("demo/simulated-failing"))) {
      check("M3: a failing first choice can be placed ahead of Groq (so fallback can be observed)", false, `routing preview: ${preview.join(" > ")} (the registry does not route simulated models; fallback between two real models cannot be forced without a real outage)`);
      await call("PUT", "/api/llm/routing", { allowedProviders: ["groq"], providerOrder: ["groq"], maxAttempts: 2, enabled: true });
      return { preview, forced: false };
    }
    const r = await ask(bots.auto.id, "How much is a cup of tea?");
    const route = await lastRouting();
    check("M3: the first choice failed and the next one answered (fallback), with both attempts recorded", (route?.attempts ?? []).length >= 2 && /groq/.test(route?.answeredBy ?? ""), JSON.stringify({ answeredBy: route?.answeredBy, attempts: route?.attempts }));
    await call("PUT", "/api/llm/routing", { allowedProviders: ["groq"], providerOrder: ["groq"], maxAttempts: 2, enabled: true });
    return { preview, answeredBy: route?.answeredBy, attempts: route?.attempts, answer: text(r) };
  });
  // ===== M4: a real provider failure (a 4,000-token model given an oversized prompt)
  await step("M4 provider failure", async () => {
    const small = await mkBot("Probe Small", "groq/allam-2-7b");
    if (!small.id) { check("M4: the small-context agent could be created", false, small.error); return { skipped: small.error }; }
    const big = "Customers may return unused goods within thirty days with a receipt. ".repeat(450); // about 31,000 characters
    const att = await call("POST", "/api/chat-attachments", { filename: "long-policy.txt", contentBase64: b64(big), retention: "temporary" });
    const before = (await call("GET", `/api/bots/${small.id}/conversations`)).body?.conversations?.length ?? 0;
    const r = await call("POST", `/api/bots/${small.id}/chat`, { message: "Summarise the attached policy.", attachmentIds: [att.body.document.id] });
    const after = (await call("GET", `/api/bots/${small.id}/conversations`)).body?.conversations?.length ?? 0;
    check("M4: a real provider failure is reported in plain words (not a crash), with a status the owner can act on", r.status >= 400 && String(r.body?.message ?? "").length > 20, `${r.status} ${String(r.body?.message ?? "").slice(0, 200)}`);
    check("M4: a failed call leaves NO half-finished conversation behind", after === before, `${before} -> ${after}`);
    return { status: r.status, message: r.body?.message };
  });
  // the all-providers-fail path costs no real request: only the simulated failing provider is allowed
  {
    await call("PUT", "/api/llm/routing", { allowedProviders: ["demo"], providerOrder: ["demo"], maxAttempts: 2, enabled: true });
    const r = await call("POST", `/api/bots/${bots.auto.id}/chat`, { message: "hello" });
    check("M4b: when every allowed provider fails, the owner gets a clear message (no real request)", r.status >= 400 && String(r.body?.message ?? "").length > 20, `${r.status} ${String(r.body?.message ?? "").slice(0, 200)}`);
    await call("PUT", "/api/llm/routing", { allowedProviders: ["groq"], providerOrder: ["groq"], maxAttempts: 2, enabled: true });
  }
  // ===== M5: propose, APPLY, use, undo (the improved rewrite prompt)
  const target = bots.oss120;
  let proposal = null;
  await step("M5a propose rewrite", async () => {
    const r = (await call("POST", "/api/assistant/interpret", { text: "improve the instructions of agent Probe 120b" })).body;
    proposal = r.action;
    const after = String(proposal?.after?.instructions ?? "");
    evidence.notes.rewriteV2 = after;
    check("M5a: a review proposal came back (new prompt)", proposal?.level === "review" && proposal?.status === "proposed", r.message);
    check("M5a: the role text was NOT copied in, no 'verify from memory', second person, mentions sources", !/test agent/i.test(after) && !/(your own|reliable) knowledge|from memory/i.test(after) && /\bYou\b/.test(after) && /source/i.test(after), after.slice(0, 300));
    return { instructions: after };
  });
  if (proposal) {
    const applied = await call("POST", `/api/assistant/actions/${proposal.id}/confirm`);
    const now = (await call("GET", `/api/bots/${target.id}`)).body.bot;
    check("M5b: pressing Apply applied it as a NEW VERSION (old text kept in history)", applied.status === 200 && now.instructions === proposal.after.instructions && now.currentVersion === (target.currentVersion ?? 1) + 1, `status ${applied.status} v${now.currentVersion}`);
    await step("M5c use the improved agent", async () => {
      const r = await ask(target.id, "What are the shop's opening hours?");
      const a = text(r);
      check("M5c: the improved agent, asked something the documents do NOT contain, says so plainly instead of guessing", !/\b\d{1,2}\s?(am|pm|a\.m\.|p\.m\.)/i.test(a) && /(not|no|n't|cannot|can't).{0,60}(contain|say|mention|provide|include|find|information|source)|do(es)? not (say|contain)/i.test(a), a.slice(0, 260));
      return { answer: a };
    });
    const undone = await call("POST", `/api/assistant/actions/${proposal.id}/undo`);
    check("M5d: Undo restores the old instructions (as another version)", undone.status === 200 && (await call("GET", `/api/bots/${target.id}`)).body.bot.instructions === "Answer from the sources you are given.", `status ${undone.status}`);
  }
  await step("M5e propose description", async () => {
    const r = (await call("POST", "/api/assistant/interpret", { text: "write a description for project P4B Probe Project" })).body;
    const d = String(r.action?.after?.description ?? "");
    evidence.notes.descriptionV2 = d;
    check("M5e: with nothing linked, the description says so instead of guessing a purpose", r.action?.status === "proposed" && /nothing|no (items|work|tasks)|not yet|empty|no linked/i.test(d) && !/development effort|probing|monitoring/i.test(d), d);
    if (r.action) {
      const ok = await call("POST", `/api/assistant/actions/${r.action.id}/confirm`);
      check("M5f: Apply on the description changes the project", ok.status === 200 && (await call("GET", `/api/projects/${project.id}`)).body.project.description === d);
    }
    return { description: d };
  });
  // ===== M6: Word / Excel / PDF / CSV facts, answered with citations
  const asks = [["docx", "How many days of paid holiday does each employee get, and what is the baker's notice period?", (a) => /25/.test(a) && /30/.test(a)], ["xlsx", "How much does a cake cost?", (a) => /18/.test(a)], ["pdf", "By when must orders be placed?", (a) => /friday/i.test(a)], ["csv", "In which city is Gulf Dairy?", (a) => /sharjah/i.test(a)]];
  for (const [kind, q, ok] of asks) {
    await step(`M6 ${kind}`, async () => {
      const r = await ask(bots.oss120.id, q);
      const a = text(r);
      const src = (r.sources ?? []).find((s) => s.cited);
      check(`M6 ${kind}: the right fact from the ${kind.toUpperCase()} file, cited, and the cited source is that file`, ok(a) && cites(a) && !!src && new RegExp({ docx: "handbook", xlsx: "price", pdf: "supplier-letter|letter", csv: "suppliers" }[kind], "i").test(src.title), `${a.slice(0, 160)} | cited: ${src?.title}`);
      return { answer: a, cited: src?.title };
    });
  }
  // ===== M7: reprocess, remove, restore, then ask again
  {
    const id = docs.pdf.body.document.id;
    const re = await call("POST", `/api/knowledge/docs/${id}/reprocess`);
    check("M7a: reprocess rebuilds the PDF from its stored original (status ready, same text length)", re.body?.document?.status === "ready" && re.body.document.textChars === docs.pdf.body.document.textChars);
    await call("DELETE", `/api/knowledge/docs/${id}`, { confirmTitle: "supplier-letter" });
    check("M7b: removed, the PDF is no longer searched", (await call("GET", "/api/knowledge/search?q=Tuesday")).body.hits.length === 0);
    const back = await call("POST", `/api/knowledge/docs/${id}/restore`);
    check("M7c: restored, the PDF is ready and searchable again", back.body?.document?.status === "ready" && (await call("GET", "/api/knowledge/search?q=Tuesday")).body.hits.length >= 1);
  }
  await step("M7d answer after restore", async () => {
    const r = await ask(bots.oss120.id, "On which day do deliveries arrive?");
    const a = text(r);
    check("M7d: after restore the answer is right and cites the restored file", /tuesday/i.test(a) && cites(a) && (r.sources ?? []).some((s) => s.cited && /supplier-letter|letter/i.test(s.title)), a.slice(0, 200));
    return { answer: a };
  });
  // ===== M8: workflow revise, with a draft that has NO checkpoint to start with
  let d1 = null;
  await step("M8a draft", async () => {
    const r = await call("POST", "/api/workflows/draft", { description: "Have the Probe Auto agent collect competitor prices and write a summary.", modelRef: MODELS.oss120 });
    d1 = r.body?.draft;
    const types = d1?.graph?.nodes?.map((n) => n.type) ?? [];
    check("M8a: a draft without a checkpoint", r.status === 200 && !types.includes("checkpoint"), `${r.status} ${types.join(">")} ${r.body?.message ?? ""}`);
    return { types };
  });
  await step("M8b revise", async () => {
    if (!d1) return { skipped: true };
    const r = await call("POST", "/api/workflows/draft", { description: "Add a question for me at the very end asking whether to archive the result", revise: d1, modelRef: MODELS.oss120 });
    const nodes = r.body?.draft?.graph?.nodes ?? [];
    const cps = nodes.filter((n) => n.type === "checkpoint");
    check("M8b: the revision keeps the agent steps and ADDS a checkpoint that asks about archiving", r.status === 200 && nodes.some((n) => n.type === "bot_task") && cps.length >= 1 && cps.some((c) => /archive/i.test(c.message ?? "")), `${r.status} ${nodes.map((n) => n.type).join(">")} ${cps.map((c) => c.message).join(" | ")} ${r.body?.message ?? ""}`);
    return { types: nodes.map((n) => n.type), checkpoints: cps.map((c) => c.message) };
  });

  const total = (await usedToday()) - startUsed;
  evidence.requestsUsed = total;
  check(`budget respected: ${total} real requests used (ceiling 22)`, total <= BUDGET, `used ${total}`);
} catch (e) {
  check("script ran to the end", false, String(e).slice(0, 300)); exitCode = 1;
} finally {
  srv.kill();
  const outDir = path.join(ROOT, "docs", "evidence", "real-phase4");
  mkdirSync(outDir, { recursive: true });
  evidence.finishedAt = new Date().toISOString();
  evidence.checks = results;
  writeFileSync(path.join(outDir, "results-round2.json"), JSON.stringify(evidence, null, 2));
  // The copy holds the vault key: it MUST be deleted. Wait for the server to exit (Windows keeps the files open for a moment), then retry.
  await new Promise((r) => (srv.exitCode !== null ? r() : (srv.once("exit", r), setTimeout(r, 4000))));
  let gone = false;
  for (let i = 0; i < 12 && !gone; i++) { try { rmSync(tmp, { recursive: true, force: true }); gone = true; } catch { await sleep(800); } }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; scratch copy deleted: ${gone}; evidence: docs/evidence/real-phase4/results-round2.json (no keys)`);
  if (failed.length) console.log("NOT PASSED:\n" + failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n"));
  process.exit(exitCode || 0);
}
