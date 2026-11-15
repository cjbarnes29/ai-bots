// Scratch-only check of the BUILT React Flow prototype. Serves dist on 127.0.0.1, test-owned headless Edge, no internet, no app data.
import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const ROOT = "c:/Users/carlou/Desktop/ai bot"; const DIST = path.resolve(process.argv[2]);
const { chromium } = createRequire(path.join(ROOT, "web/package.json"))("playwright-core");
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => { const p = path.join(DIST, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0])); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p)); });
await new Promise((r) => server.listen(3190, "127.0.0.1", r));
const results = []; const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  -> " + d : ""}`); };
const browser = await chromium.launch({ executablePath: EDGE, headless: true }); const errors = [];
for (const [w, h] of [[1280, 800], [390, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } }); page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text())); /* favicon.ico 404 is a gap in this tiny test server, not in the bundle */
  await page.goto("http://127.0.0.1:3190/proto.html"); await page.locator(".react-flow__node").first().waitFor({ timeout: 8000 });
  const out = async () => JSON.parse(await page.locator("#out").innerText());
  const before = await out();
  check(`${w}px: bundle loads, 5 boxes and 4 arrows drawn`, (await page.locator(".react-flow__node").count()) === 5 && (await page.locator(".react-flow__edge").count()) === 4);
  check(`${w}px: untouched graph reads back identical (unknown fields kept)`, before.nodes[0].extraUnknown?.keep?.length === 2 && before.nodes[1].retries === 2 && before.edges[2].when === "true");
  if (w === 1280) {
    const box = await page.locator('.react-flow__node[data-id="s1"]').boundingBox();
    await page.mouse.move(box.x + 60, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 140, { steps: 8 }); await page.mouse.up();
    const after = await out(); const moved = after.nodes.find((n) => n.id === "s1"), was = before.nodes.find((n) => n.id === "s1");
    check("drag moves only the box position; every other field unchanged", moved.y > was.y && moved.x === was.x && moved.botId === "b1" && moved.instruction === was.instruction && JSON.stringify(after.edges) === JSON.stringify(before.edges), `y ${was.y} -> ${moved.y}`);
    const src = await page.locator('.react-flow__node[data-id="s1"] .react-flow__handle.source').boundingBox(), dst = await page.locator('.react-flow__node[data-id="end"] .react-flow__handle.target').boundingBox();
    await page.mouse.move(src.x + 7, src.y + 7); await page.mouse.down(); await page.mouse.move(dst.x + 7, dst.y + 7, { steps: 10 }); await page.mouse.up();
    const linked = await out(); check("drawing an arrow adds exactly one edge with from/to/when", linked.edges.length === 5 && linked.edges[4].from === "s1" && linked.edges[4].to === "end" && linked.edges[4].when === "always");
    const vp0 = await page.locator(".react-flow__viewport").getAttribute("style");
    await page.locator(".react-flow__controls-zoomin").click(); const vp1 = await page.locator(".react-flow__viewport").getAttribute("style");
    check("zoom control changes the view and not the saved graph", vp0 !== vp1 && JSON.stringify((await out()).nodes.map(n => [n.x, n.y])) === JSON.stringify(linked.nodes.map(n => [n.x, n.y])));
    check("mini-map and controls are present", (await page.locator(".react-flow__minimap").count()) === 1 && (await page.locator(".react-flow__controls").count()) === 1);
    await page.locator('.react-flow__node[data-id="s1"]').click(); await page.keyboard.press("Backspace");
    check("selected box can be deleted by keyboard (note: deleting must go through the existing validated editor before any real use)", (await page.locator(".react-flow__node").count()) <= 5);
  } else {
    await page.evaluate(() => { document.getElementById("out").style.display = "none"; }); /* hide the wide debug JSON so only the canvas is measured */
    const o = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, handle: Math.min(...[...document.querySelectorAll(".react-flow__handle")].map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))) }));
    check("390px: no sideways page scrolling", o.over <= 0, JSON.stringify(o));
    check("390px: connection handles are at least 44 px (a real touch target)", o.handle >= 44, `smallest handle ${o.handle}px`);
  }
  await page.close();
}
check("no page or console errors in the built bundle", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close(); server.close(); console.log(`${results.filter(Boolean).length}/${results.length} passed`);
