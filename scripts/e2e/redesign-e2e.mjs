// Real-browser check of the Studio redesign shell (owner decision D-075, phase 1): the REAL app (src/server.ts) on a scratch database and
// a REAL Edge browser. No model, no internet, no keys, never touches data/app.db. Nothing is sent anywhere.
// Checks navigation, section tabs, breadcrumbs, the open-workspace tabs, the sidebar fold, the Creative Studio page, motion (and reduced motion),
// and at six screen sizes: no sideways overflow on any section's pages, and the navigation shape that belongs to that size.
// Usage: npm --prefix web run build && node scripts/e2e/redesign-e2e.mjs      (needs port 3111)
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "awp-redesign-shots");
mkdirSync(SHOTS, { recursive: true });
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 3111;
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

const dir = mkdtempSync(path.join(tmpdir(), "awp-redesign-e2e-"));
mkdirSync(path.join(dir, "data"));
const srv = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(dir, "data", "scratch.db"), GUARDIAN_URL: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + "/api/llm/status")).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 500)); } return false; };

const SIZES = [
  { name: "small phone", width: 360, height: 740, shape: "bottom" },
  { name: "large phone", width: 430, height: 932, shape: "bottom" },
  { name: "tablet portrait", width: 768, height: 1024, shape: "rail" },
  { name: "small laptop", width: 1024, height: 768, shape: "sidebar" },
  { name: "desktop", width: 1440, height: 900, shape: "sidebar" },
  { name: "large desktop", width: 1920, height: 1080, shape: "sidebar" },
];
const PAGES = ["/", "/agents", "/studio", "/groups", "/workforce", "/workflows", "/automation", "/decisions", "/projects", "/models", "/settings/ai-models", "/integrations", "/pc", "/access", "/business", "/creative", "/knowledge", "/monitor", "/tasks", "/approvals", "/inbox", "/settings"];

let browser;
try {
  check("app started on a scratch database", await ready());
  browser = await chromium.launch({ executablePath: EDGE, headless: true });

  // ---- every page at every size: no sideways overflow, and the right navigation shape
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.width < 1024, isMobile: size.width < 768 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const overflow = [];
    const h1issues = [];
    const smallIssues = [];
    for (const p of PAGES) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForSelector("h1", { timeout: 8000 }).catch(() => {});
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (o.sw > o.iw + 1) overflow.push(`${p} (${o.sw}>${o.iw})`);
      // phase 6: one h1 per page; on phones every button, field, tab and section toggle is at least 44px tall
      // (switches get an invisible 44px extension, and inline underlined text buttons sit inside sentences: neither is measured by its box)
      const a11y = await page.evaluate(() => {
        const skipEl = (e) => e.getAttribute("role") === "switch" || (e.tagName === "BUTTON" && String(e.className).split(" ").includes("underline"));
        const small = [];
        for (const e of document.querySelectorAll("button, a.btn-primary, a.btn-secondary, input:not([type=checkbox]):not([type=radio]):not([type=file]), select, [role=tab], summary")) {
          const b = e.getBoundingClientRect();
          if (b.width === 0 || b.height === 0 || skipEl(e)) continue;
          if (b.height < 43.5) small.push(`${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)}" ${Math.round(b.height)}px`);
        }
        return { h1: document.querySelectorAll("h1").length, small };
      });
      if (a11y.h1 !== 1) h1issues.push(`${p} (${a11y.h1} h1)`);
      if (size.width < 768 && a11y.small.length) smallIssues.push(`${p}: ${a11y.small.slice(0, 2).join("; ")}`);
    }
    check(`${size.name}: every page has exactly one h1`, h1issues.length === 0, h1issues.join(", "));
    if (size.width < 768) check(`${size.name}: no button, field, tab or toggle under 44px tall on ${PAGES.length} pages`, smallIssues.length === 0, smallIssues.slice(0, 3).join(" | "));
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), href: document.activeElement?.getAttribute("href"), visible: (() => { const b = document.activeElement.getBoundingClientRect(); return b.width > 0 && b.top >= 0; })() }));
    check(`${size.name}: the first Tab stop is a visible skip link to the content`, first.href === "#main" && first.visible, JSON.stringify(first));
    check(`${size.name} ${size.width}px: no sideways overflow on ${PAGES.length} pages`, overflow.length === 0, overflow.join(", "));
    // navigation shape
    await page.goto(base + "/workflows", { waitUntil: "networkidle" });
    const nav = await page.evaluate(() => {
      const n = document.querySelector('nav[aria-label="Main"]');
      const r = n.getBoundingClientRect();
      const items = [...n.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().width > 0);
      return { atBottom: Math.abs(r.bottom - window.innerHeight) < 2 && r.width >= window.innerWidth - 2, atLeft: r.left <= 0 && r.height >= window.innerHeight - 2, width: Math.round(r.width), minH: Math.min(...items.map((a) => a.getBoundingClientRect().height)), minW: Math.min(...items.map((a) => a.getBoundingClientRect().width)) };
    });
    if (size.shape === "bottom") check(`${size.name}: navigation is a bar along the bottom with touch-sized items`, nav.atBottom && nav.minH >= 44 && nav.minW >= 44, JSON.stringify(nav));
    if (size.shape === "rail") check(`${size.name}: navigation is a slim rail`, nav.atLeft && nav.width <= 70, JSON.stringify(nav));
    if (size.shape === "sidebar") check(`${size.name}: navigation is the full sidebar`, nav.atLeft && nav.width >= 220, JSON.stringify(nav));
    // section tabs reachable (scrollable on small screens) and every tab target big enough on touch sizes
    const tabs = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Workflows sections"] a')].map((a) => ({ t: a.textContent, h: Math.round(a.getBoundingClientRect().height) })));
    check(`${size.name}: the Workflows section shows its 4 tabs${size.width < 768 ? " with touch-sized height" : ""}`, tabs.length === 4 && (size.width >= 768 || tabs.every((x) => x.h >= 44)), JSON.stringify(tabs));
    // phase 2: Dashboard boxes and every Monitoring tab, no overflow, tabs reachable by touch-sized buttons
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const boxes = await page.evaluate(() => ["Task execution (24 h)", "Application connections", "Your AI right now"].map((n) => !![...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === n)));
    check(`${size.name}: the Dashboard shows the task, application and AI boxes`, boxes.every(Boolean), JSON.stringify(boxes));
    await page.goto(base + "/monitor", { waitUntil: "networkidle" });
    const tabOverflow = [];
    for (const t of ["Overview", "Activity log", "Running work", "Resources"]) {
      await page.click(`[role=tab]:has-text("${t}")`);
      await page.waitForTimeout(350);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.querySelector("[role=tab][aria-selected=true]").getBoundingClientRect().height }));
      if (o.sw > o.iw + 1) tabOverflow.push(`${t} (${o.sw}>${o.iw})`);
      if (size.width < 768 && o.h < 44) tabOverflow.push(`${t} tab only ${o.h}px tall`);
    }
    check(`${size.name}: the four Monitoring tabs fit and are touch-sized`, tabOverflow.length === 0, tabOverflow.join(", "));
    // phase 3: the AI Models workspace tabs
    await page.goto(base + "/models", { waitUntil: "networkidle" });
    const modelIssues = [];
    for (const t of ["Providers", "Models & testing", "Routing & fallback", "Usage", "Limits & safety"]) {
      await page.click(`[role=tab]:has-text("${t}")`);
      await page.waitForTimeout(350);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.querySelector("[role=tab][aria-selected=true]").getBoundingClientRect().height }));
      if (o.sw > o.iw + 1) modelIssues.push(`${t} (${o.sw}>${o.iw})`);
      if (size.width < 768 && o.h < 44) modelIssues.push(`${t} tab ${o.h}px`);
    }
    check(`${size.name}: the five AI Models tabs fit and are touch-sized`, modelIssues.length === 0, modelIssues.join(", "));
    await page.screenshot({ path: path.join(SHOTS, `monitor-resources-${size.width}.png`) });
    // phase 4: the workflow editor chooses list view on phones, shows the resize divider from 1024 px, and never overflows sideways
    await page.goto(base + "/workflows", { waitUntil: "networkidle" });
    await page.click("button:has-text('New workflow')");
    await page.waitForSelector('[aria-label="Workflow editor"]');
    const ed = await page.evaluate(() => ({ list: !!document.querySelector('ol[aria-label="Boxes in running order"]'), toggle: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Show as a drawing"), sep: (() => { const e = document.querySelector('[role=separator]'); return !!e && e.getBoundingClientRect().width > 0; })(), sw: document.documentElement.scrollWidth, iw: window.innerWidth, minBtn: Math.min(...[...document.querySelectorAll('ol[aria-label="Boxes in running order"] button')].map((b) => b.getBoundingClientRect().height), 999) }));
    check(`${size.name}: the workflow editor opens in ${size.width < 768 ? "list" : "drawing"} view`, ed.list === (size.width < 768) && ed.toggle === (size.width < 768), JSON.stringify(ed));
    check(`${size.name}: resize divider ${size.width >= 1024 ? "visible" : "hidden"}, no sideways overflow in the editor`, ed.sep === (size.width >= 1024) && ed.sw <= ed.iw + 1, JSON.stringify(ed));
    if (size.width < 768) check(`${size.name}: list-view buttons are touch-sized`, ed.minBtn >= 44, String(ed.minBtn));
    // phase 5: Knowledge and Creative tabs, and every Settings category, fit at this size
    const tabIssues = [];
    for (const [url, tabs] of [["/knowledge", ["Shared notes", "Agent knowledge", "Files & documents"]], ["/creative", ["Overview", "Documents", "Content drafting", "Image, video & audio"]]]) {
      await page.goto(base + url, { waitUntil: "networkidle" });
      for (const t of tabs) {
        await page.click(`[role=tab]:has-text("${t}")`);
        await page.waitForTimeout(300);
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.querySelector("[role=tab][aria-selected=true]").getBoundingClientRect().height }));
        if (o.sw > o.iw + 1) tabIssues.push(`${url} ${t} (${o.sw}>${o.iw})`);
        if (size.width < 768 && o.h < 44) tabIssues.push(`${url} ${t} tab ${o.h}px`);
      }
    }
    for (const c of ["general", "recommended", "ai-models", "integrations", "agents", "workflows", "pc", "security", "notifications", "advanced"]) {
      await page.goto(base + `/settings/${c}`, { waitUntil: "networkidle" });
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (o.sw > o.iw + 1) tabIssues.push(`settings/${c} (${o.sw}>${o.iw})`);
    }
    check(`${size.name}: Knowledge and Creative tabs and all 10 Settings categories fit, tabs touch-sized`, tabIssues.length === 0, tabIssues.join(", "));
    check(`${size.name}: no console errors across the pages`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, `dashboard-${size.width}.png`) });
    await page.goto(base + "/creative", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, `creative-${size.width}.png`) });
    await ctx.close();
  }

  // ---- behaviour on a desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const mainLinks = await page.$$eval('nav[aria-label="Main"] > a', (as) => as.map((a) => a.getAttribute("title") ?? a.textContent));
  check("the sidebar lists the 9 sections (and the logo link)", mainLinks.length === 10, mainLinks.join(", "));
  await page.click('nav[aria-label="Main"] a[title="Workflows"]');
  await page.waitForSelector('h1:has-text("Workflow Studio")');
  await page.click('nav[aria-label="Workflows sections"] a:has-text("Schedules")');
  await page.waitForSelector('h1:has-text("Schedules and triggers")');
  check("a section tab opens its page and the breadcrumb follows", (await page.textContent('nav[aria-label="Breadcrumb"]')).replace(/\s+/g, "").includes("Home/Workflows/Schedules"));
  check("the open-workspaces strip shows both pages", (await page.$$eval('nav[aria-label="Open workspaces"] a', (as) => as.map((a) => a.textContent.trim()))).join("|") === "Dashboard|Workflow Studio|Schedules");
  await page.reload({ waitUntil: "networkidle" });
  check("open workspaces survive a reload of the same browser tab", (await page.$$('nav[aria-label="Open workspaces"] a')).length === 3);
  const stored = await page.evaluate(() => ({ s: sessionStorage.getItem("awp-open-workspaces"), l: localStorage.getItem("awp-open-workspaces") }));
  check("they are stored for the session only, as addresses and names", stored.l === null && JSON.parse(stored.s).every((o) => Object.keys(o).sort().join() === "label,path"));
  const w0 = (await page.locator('nav[aria-label="Main"]').boundingBox()).width;
  await page.click('button[aria-label="Collapse the sidebar"]');
  await page.waitForTimeout(450);
  const w1 = (await page.locator('nav[aria-label="Main"]').boundingBox()).width;
  check("the sidebar folds to icons and its width animates", w0 >= 220 && w1 <= 70, `${w0} -> ${w1}`);
  await page.reload({ waitUntil: "networkidle" });
  check("the fold is remembered", (await page.locator('nav[aria-label="Main"]').boundingBox()).width <= 70);
  await page.click('button[aria-label="Expand the sidebar"]');
  // phase 4: the divider really drags, and the keyboard moves it
  await page.goto(base + "/workflows", { waitUntil: "networkidle" });
  await page.click("button:has-text('New workflow')");
  await page.waitForSelector("[role=separator]");
  const sepBox = await page.locator("[role=separator]").boundingBox();
  const v0 = Number(await page.getAttribute("[role=separator]", "aria-valuenow"));
  await page.mouse.move(sepBox.x + 4, sepBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(sepBox.x - 200, sepBox.y + 40, { steps: 5 });
  await page.mouse.up();
  const v1 = Number(await page.getAttribute("[role=separator]", "aria-valuenow"));
  await page.focus("[role=separator]");
  await page.keyboard.press("ArrowRight");
  const v2 = Number(await page.getAttribute("[role=separator]", "aria-valuenow"));
  check("the editor divider follows a real mouse drag and the arrow keys", v1 < v0 && v2 === v1 + 5, `${v0} -> ${v1} -> ${v2}`);
  // approvals still work from the Monitoring section
  await page.click('nav[aria-label="Main"] a[title="Monitoring"]');
  await page.click('nav[aria-label="Monitoring sections"] a:has-text("Approvals")');
  check("Approvals is reachable from Monitoring", await page.waitForSelector('h1:has-text("Approvals")').then(() => true, () => false));
  // creative studio honesty
  await page.goto(base + "/creative", { waitUntil: "networkidle" });
  const cards = await page.$$eval("li.card", (lis) => lis.map((li) => ({ t: li.querySelector("span")?.textContent, notConnected: li.textContent.includes("Not connected"), actions: li.querySelectorAll("a,button").length })));
  check("Creative Studio: image, video and audio are 'Not connected' with no button", ["Image generation", "Video editing", "Audio and music"].every((n) => { const c = cards.find((x) => x.t?.includes(n)); return c && c.notConnected && c.actions === 0; }), JSON.stringify(cards.map((c) => c.t)));
  // motion: the page change animation runs; with reduced motion it is off
  const anim = await page.evaluate(() => { const el = document.querySelector(".awp-workspace-in"); const s = getComputedStyle(el); return { name: s.animationName, dur: s.animationDuration }; });
  check("page change animation runs at 300 ms", anim.name === "awp-workspace-in" && anim.dur === "0.3s", JSON.stringify(anim));
  await ctx.close();
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const rpage = await rctx.newPage();
  await rpage.goto(base + "/creative", { waitUntil: "networkidle" });
  const ranim = await rpage.evaluate(() => { const s = getComputedStyle(document.querySelector(".awp-workspace-in")); return { dur: s.animationDuration }; });
  check("with 'reduce motion' on, animations last 0.01 ms (effectively off)", ranim.dur === "0.00001s" || ranim.dur === "1e-05s", JSON.stringify(ranim));
  await rctx.close();
} catch (e) {
  check("script finished without an error", false, String(e).slice(0, 300));
} finally {
  await browser?.close();
  srv.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
if (failed.length) { console.log(log.slice(-600)); process.exit(1); }
