import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { writeDocx, writePptx, writeXlsx } from "./office.js";
import { writePdf } from "./pdf.js";
import { parseCsv, summarizeTable, writeCsv, writeHtml, writeMarkdown } from "./render.js";
import { diagramSvg, chartSvg } from "./svg.js";
import { LIMITS, esc, neutralize, type Chart, type DocumentSpec } from "./spec.js";
import { createZip, crc32, readZip } from "./zip.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A strict little XML checker: every tag closed in order, attributes quoted, no stray < or &. */
function assertWellFormed(xml: string, label = "xml"): void {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    expect(m.index, `${label}: unexpected text at ${pos}`).toBe(pos);
    pos = re.lastIndex;
    if (m[5] !== undefined) {
      expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[5]), `${label}: bad & in text`).toBe(false);
      continue;
    }
    if (m[1]) expect(stack.pop(), `${label}: closing ${m[2]} out of order`).toBe(m[2]);
    else if (!m[4]) stack.push(m[2]!);
  }
  expect(pos, `${label}: trailing junk`).toBe(body.length);
  expect(stack, `${label}: unclosed tags`).toEqual([]);
  // eslint-disable-next-line no-control-regex
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), `${label}: control characters`).toBe(false);
}

const parts = (zip: Buffer) => readZip(zip);
const str = (m: Map<string, Buffer>, name: string) => {
  const b = m.get(name);
  expect(b, `missing part ${name}`).toBeDefined();
  return b!.toString("utf8");
};
const allXmlOk = (m: Map<string, Buffer>) => {
  for (const [name, data] of m) if (/\.(xml|rels)$/.test(name)) assertWellFormed(data.toString("utf8"), name);
};
/** Every part must be declared (by default or override) and every relationship must point at a part that exists. */
function packageIsConsistent(m: Map<string, Buffer>) {
  const ct = str(m, "[Content_Types].xml");
  const defaults = new Set([...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((x) => x[1]));
  const overrides = new Set([...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((x) => x[1]!.slice(1)));
  for (const name of m.keys()) if (name !== "[Content_Types].xml") expect(overrides.has(name) || defaults.has(name.split(".").pop()!), `${name} has no content type`).toBe(true);
  for (const o of overrides) expect(m.has(o!), `override for missing part ${o}`).toBe(true);
  for (const [name, data] of m) {
    if (!name.endsWith(".rels")) continue;
    const dir = name.replace(/_rels\/[^/]*$/, "");
    for (const t of data.toString("utf8").matchAll(/Target="([^"]+)"/g)) {
      const resolved = t[1]!.startsWith("/") ? t[1]!.slice(1) : new URL(t[1]!, `http://x/${dir}`).pathname.slice(1);
      expect(m.has(resolved), `${name} points at missing ${resolved}`).toBe(true);
    }
    expect(data.toString("utf8")).not.toContain("TargetMode"); // nothing points outside the file
  }
}

const chart: Chart = { kind: "bar", title: "Sales <2026> & more", labels: ["Q1", "Q2", "Q3"], series: [{ name: "North", values: [10, 25, 18] }, { name: "South", values: [7, 12, 30] }] };
const doc: DocumentSpec = {
  title: 'Quarterly "report" <b>&</b>',
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", text: "Revenue grew 12% — café résumé naïve. Emoji 😀 and 中文 are handled." },
    { type: "bullets", items: ["First", "Second <point>"] },
    { type: "numbered", items: ["One", "Two"] },
    { type: "table", header: ["Region", "Sales"], rows: [["North", 10], ["South", 7.5], ["=HYPERLINK(\"http://evil\")", true]] },
    { type: "chart", chart },
    { type: "pagebreak" },
    { type: "heading", level: 2, text: "Appendix" },
    { type: "paragraph", text: "word ".repeat(400) },
  ],
};

describe("zip", () => {
  it("round-trips names and content, checks checksums, and handles empty and unicode parts", () => {
    const z = createZip([{ name: "a.txt", data: "hello" }, { name: "dir/b é.txt", data: "ünïcode ✓".repeat(1000) }, { name: "empty.txt", data: "" }]);
    const m = readZip(z);
    expect([...m.keys()]).toEqual(["a.txt", "dir/b é.txt", "empty.txt"]);
    expect(m.get("a.txt")!.toString()).toBe("hello");
    expect(m.get("dir/b é.txt")!.toString()).toBe("ünïcode ✓".repeat(1000));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(() => readZip(Buffer.from("not a zip"))).toThrow();
    const bad = Buffer.from(z);
    bad[40] = bad[40]! ^ 0xff; // damage a stored byte
    expect(() => readZip(bad)).toThrow();
  });
});

describe("Excel", () => {
  const book = writeXlsx([{ name: "Sales", header: ["Region", "Amount", "Note"], rows: [["North", 10.5, "ok"], ["South", -3, null], ["=cmd|' /C calc'!A0", 7, 'say "hi" & <b>']] }, { name: "Sales", header: [], rows: [[true, false]] }]);

  it("is a consistent package of well-formed XML", () => {
    const m = parts(book);
    allXmlOk(m);
    packageIsConsistent(m);
    expect([...m.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
  });

  it("stores numbers as numbers, text as text, skips empty cells, and renames a duplicate sheet name", () => {
    const m = parts(book);
    const s1 = str(m, "xl/worksheets/sheet1.xml");
    expect(s1).toContain('<c r="B2"><v>10.5</v></c>');
    expect(s1).toContain('<c r="B3"><v>-3</v></c>');
    expect(s1).not.toContain('r="C3"');
    expect(s1).toContain('<c r="A1" t="inlineStr" s="1">'); // bold header
    expect(s1).toContain('state="frozen"');
    expect(str(m, "xl/worksheets/sheet2.xml")).toContain('t="b"><v>1</v>');
    expect(str(m, "xl/workbook.xml")).toMatch(/name="Sales".*name="Sales 2"/s);
  });

  it("never writes a formula: text that looks like one stays text", () => {
    const s1 = str(parts(book), "xl/worksheets/sheet1.xml");
    expect(s1).not.toMatch(/<f[ >]/);
    expect(s1).toContain("=cmd|&#39; /C calc&#39;!A0");
    expect(s1).toContain("say &quot;hi&quot; &amp; &lt;b&gt;");
  });

  it("column letters go past Z", () => {
    const wide = writeXlsx([{ name: "W", header: [], rows: [Array.from({ length: 30 }, (_, i) => i)] }]);
    const s = str(parts(wide), "xl/worksheets/sheet1.xml");
    expect(s).toContain('r="Z1"');
    expect(s).toContain('r="AA1"');
    expect(s).toContain('r="AD1"');
  });
});

describe("Word", () => {
  const file = writeDocx(doc);
  it("is a consistent package of well-formed XML with the text, escaped", () => {
    const m = parts(file);
    allXmlOk(m);
    packageIsConsistent(m);
    const xml = str(m, "word/document.xml");
    expect(xml).toContain("Quarterly &quot;report&quot; &lt;b&gt;&amp;&lt;/b&gt;");
    expect(xml).toContain("café résumé naïve");
    expect(xml).toContain("中文");
    expect(xml).toContain("Second &lt;point&gt;");
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).not.toContain("<b>"); // nothing the document text said became markup
    expect(xml).not.toMatch(/<w:fldChar|<w:instrText|<w:hyperlink|<w:object/); // no fields, links or embedded objects
  });
  it("has a real table (header + rows) and the chart as a table of its numbers", () => {
    const xml = str(parts(file), "word/document.xml");
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    expect(xml).toContain("North");
    expect(xml).toContain("=HYPERLINK(&quot;http://evil&quot;)"); // visible as plain text
    expect(xml).toContain("Sales &lt;2026&gt; &amp; more");
  });
});

describe("PowerPoint", () => {
  const deck = writePptx({ title: "Plan & <Goals>", slides: [{ title: "Overview", bullets: ["One", "Two <b>"], chart }, { title: "Only bullets", bullets: ["A"] }, { title: "Empty", bullets: [] }] });
  it("is a consistent package: master, layout, theme and four slides all wired together", () => {
    const m = parts(deck);
    allXmlOk(m);
    packageIsConsistent(m);
    const pres = str(m, "ppt/presentation.xml");
    const ids = [...pres.matchAll(/<p:sldId id="\d+" r:id="(rId\d+)"/g)].map((x) => x[1]);
    expect(ids).toHaveLength(4); // cover + 3
    const rels = str(m, "ppt/_rels/presentation.xml.rels");
    for (const id of ids) expect(rels).toContain(`Id="${id}"`);
    expect(str(m, "ppt/slideMasters/_rels/slideMaster1.xml.rels")).toContain("slideLayout1.xml");
    expect(str(m, "ppt/slides/_rels/slide2.xml.rels")).toContain("slideLayout1.xml");
  });
  it("puts the text on the slides (escaped) and draws chart bars as shapes", () => {
    const m = parts(deck);
    expect(str(m, "ppt/slides/slide1.xml")).toContain("Plan &amp; &lt;Goals&gt;");
    const s2 = str(m, "ppt/slides/slide2.xml");
    expect(s2).toContain("Two &lt;b&gt;");
    expect((s2.match(/name="Bar /g) ?? []).length).toBe(6); // 3 labels x 2 series
    expect(s2).toContain("Sales &lt;2026&gt; &amp; more");
    const ids = [...s2.matchAll(/<p:cNvPr id="(\d+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length); // every shape has its own id
    expect(Object.keys(Object.fromEntries(m)).some((n) => /embeddings|activeX|vba/i.test(n))).toBe(false);
  });
});

describe("PDF", () => {
  const pdf = writePdf(doc);
  const text = pdf.toString("latin1");

  it("has a valid structure: header, cross-reference table that points at every object, trailer", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const entries = [...text.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((x) => Number(x[1]));
    expect(entries.length).toBeGreaterThan(8);
    entries.forEach((off, i) => expect(text.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(text).toMatch(/\/Size \d+ \/Root 1 0 R/);
  });

  it("has several pages (the page break and long text), and the words are in the page streams", () => {
    const pageCount = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pageCount).toBeGreaterThanOrEqual(2);
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(pageCount);
    const streams = [...pdf.toString("binary").matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => inflateSync(Buffer.from(m[1]!, "binary")).toString("latin1"));
    expect(streams).toHaveLength(pageCount);
    const all = streams.join("\n");
    expect(all).toContain("(Summary) Tj");
    expect(all).toContain("Revenue grew 12%");
    expect(all).toContain("caf\\351 r\\351sum\\351"); // accents encoded in the standard way
    expect(all).toContain("Emoji ? and ??"); // what the standard fonts cannot draw becomes ?
    expect(all).toContain("Second <point>");
    expect(all).toMatch(/ re f/); // chart bars
    expect(all).not.toMatch(/\(\s*\)\s*Tj.*\(\s*\)\s*Tj.*\(\s*\)\s*Tj.*\(\s*\)\s*Tj.*\(\s*\)\s*Tj/s);
  });

  it("escapes parentheses and backslashes in text, so nothing can break out of a string", () => {
    const t = writePdf({ title: "a) (b \\ c", blocks: [{ type: "paragraph", text: ") Tj ET 0 0 m 999 999 l S (" }] }).toString("binary");
    const stream = inflateSync(Buffer.from(/stream\n([\s\S]*?)\nendstream/.exec(t)![1]!, "binary")).toString("latin1");
    expect(stream).toContain("\\) Tj ET 0 0 m 999 999 l S \\(");
    expect(t).toContain("/Title (a\\) \\(b \\\\ c)");
  });

  it("long unbroken words and big tables do not crash or run off the page", () => {
    const big = writePdf({ title: "T", blocks: [{ type: "paragraph", text: "x".repeat(3000) }, { type: "table", header: ["a", "b", "c"], rows: Array.from({ length: 120 }, (_, i) => [i, "row ".repeat(12), true]) }] });
    expect(big.length).toBeGreaterThan(1000);
    expect(Number(/\/Count (\d+)/.exec(big.toString("latin1"))![1])).toBeGreaterThan(2);
  });

  it("draws every chart kind", () => {
    for (const kind of ["bar", "line", "pie"] as const) {
      const p = writePdf({ title: kind, blocks: [{ type: "chart", chart: { ...chart, kind } }] });
      expect(p.toString("latin1")).toContain("%%EOF");
    }
  });
});

describe("web page, Markdown, CSV, SVG", () => {
  it("the web page escapes everything, has no scripts, and forbids loading anything from outside", () => {
    const html = writeHtml({ title: "<script>alert(1)</script>", blocks: [{ type: "paragraph", text: '<img src=x onerror="alert(1)">' }, { type: "chart", chart }] });
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<svg");
  });
  it("Markdown keeps table pipes safe", () => {
    const md = writeMarkdown({ title: "T", blocks: [{ type: "table", header: ["a|b", "c"], rows: [["x|y", "line\nbreak"]] }] });
    expect(md).toContain("| a\\|b | c |");
    expect(md).toContain("| x\\|y | line break |");
  });
  it("CSV quotes properly and makes spreadsheet formulas harmless", () => {
    const csv = writeCsv(["name", "note"], [["a,b", 'say "hi"'], ["=1+1", "+cmd"], ["-5x", "@SUM(A1)"], [3, null]]);
    expect(csv).toContain('"a,b","say ""hi"""');
    expect(csv).toContain("'=1+1,'+cmd");
    expect(csv).toContain("'-5x,'@SUM(A1)");
    expect(csv).toContain("3,");
    expect(neutralize(-5)).toBe("'-5"); // as text; numbers in CSV are written separately
    expect(parseCsv(csv.replace(/'/g, ""))).toHaveLength(5);
  });
  it("SVG charts are well-formed, escaped, script-free and cope with zeros, one point and every kind", () => {
    for (const kind of ["bar", "line", "pie"] as const) {
      const svg = chartSvg({ kind, title: "<x>", labels: ["a", "b"], series: [{ name: "s&", values: [0, 0] }] });
      assertWellFormed(svg, kind);
      expect(svg).not.toMatch(/<script|onload|href=/);
      expect(svg).toContain("&lt;x&gt;");
    }
    assertWellFormed(chartSvg({ kind: "pie", title: "", labels: ["only"], series: [{ name: "s", values: [5] }] }));
    assertWellFormed(chartSvg({ ...chart, kind: "line" }));
  });
  it("diagrams are well-formed, ignore edges to unknown boxes, and survive loops", () => {
    const svg = diagramSvg({ title: "Flow", nodes: [{ id: "a", label: "Start" }, { id: "b", label: "Middle <step>" }, { id: "c", label: "End" }], edges: [{ from: "a", to: "b", label: "go" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "ghost" }, { from: "b", to: "b" }] });
    assertWellFormed(svg);
    expect(svg).toContain("Middle &lt;step&gt;");
    expect(svg).not.toContain("ghost");
  });
  it("esc removes characters XML cannot hold", () => {
    expect(esc("a\u0000b\u0008c\u000Bd\u001Fe")).toBe("abcde");
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("summarising data exactly", () => {
  it("reads quoted CSV and computes real statistics for number columns and counts for the rest", () => {
    const rows = parseCsv('name,amount,city\n"Smith, J",10,Paris\nLee,"1,250.5",Paris\nKim,7,Rome\n\nPat,4,Paris\n');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(["Smith, J", "10", "Paris"]);
    const s = summarizeTable(rows);
    expect(s).toContain("4 data row(s), 3 column(s).");
    expect(s).toContain("city: 4 values, 2 different; most common: Paris (3), Rome (1)");
    expect(s).toContain("amount: 4 numbers, sum 1271.5, average 317.875, smallest 4, largest 1250.5");
  });
  it("handles an empty file and very long files", () => {
    expect(summarizeTable([])).toBe("The file is empty.");
    expect(parseCsv("a\n".repeat(10000), 100).length).toBeLessThanOrEqual(101);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("through the approval gate", () => {
  const fence = "```";
  const act = (action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector: "documents", action, args })}\n${fence}`;
  let t: TestApp;
  let ws: string;
  let ref: string;

  beforeEach(async () => {
    const base = mkdtempSync(join(tmpdir(), "awp-docs-"));
    ws = join(base, "workspace");
    mkdirSync(ws, { recursive: true });
    t = await createTestApp({ connectors: [], includePc: true });
    ref = await setupGeminiModel(t);
    await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
    await t.call("POST", "/api/pc/workspaces", { path: ws });
  });
  afterEach(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
  });

  const bot = async (grants: string[]) => {
    const b = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Writer", model: ref }))).body.bot as any;
    await t.call("PUT", `/api/bots/${b.id}/pc`, { grants });
    return b;
  };
  const run = async (botId: string, ...blocks: string[]) => {
    t.provider.calls.length = 0;
    t.provider.script.push({ ...OK_RESULT, text: blocks.join("\n") }, { ...OK_RESULT, text: "done" });
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
  };
  const pending = async () => (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
  const approve = async (id: string) => (await t.call("POST", `/api/approvals/${id}/approve`)).body.approval;
  const told = () => t.provider.calls[1]!.messages[3]!.content as string;

  it("a Word document is created only after approval, is a valid package, and can be opened again by name", async () => {
    const b = await bot(["modify"]);
    await run(b.id, act("create_document", { path: "reports/q1.docx", format: "docx", title: "Q1 report", blocks: doc.blocks }));
    expect(existsSync(join(ws, "reports", "q1.docx"))).toBe(false);
    const [req] = await pending();
    expect(req.summary).toBe('Create the DOCX document reports/q1.docx titled "Q1 report" (9 blocks)');
    const res = await approve(req.id);
    expect(res.status).toBe("executed");
    expect(res.result).toMatch(/Created .*q1\.docx \([\d,]+ bytes\)/);
    const m = readZip(readFileSync(join(ws, "reports", "q1.docx")));
    allXmlOk(m);
    packageIsConsistent(m);
    expect((await t.call("GET", "/api/pc")).body.executions[0]).toMatchObject({ action: "create_document", status: "ok" });
  });

  it.each([
    ["create_document", { path: "a.pdf", format: "pdf", title: "T", blocks: [{ type: "paragraph", text: "hi" }] }, "a.pdf", (b: Buffer) => b.toString("latin1").startsWith("%PDF-1.4")],
    ["create_document", { path: "a.html", format: "html", title: "T", blocks: [{ type: "paragraph", text: "hi" }] }, "a.html", (b: Buffer) => b.toString().includes("<!doctype html>")],
    ["create_document", { path: "a.md", format: "md", title: "T", blocks: [{ type: "paragraph", text: "hi" }] }, "a.md", (b: Buffer) => b.toString().startsWith("# T")],
    ["create_spreadsheet", { path: "a.xlsx", format: "xlsx", sheets: [{ name: "S", header: ["a"], rows: [[1]] }] }, "a.xlsx", (b: Buffer) => readZip(b).has("xl/workbook.xml")],
    ["create_spreadsheet", { path: "a.csv", format: "csv", sheets: [{ name: "S", header: ["a"], rows: [["=1"]] }] }, "a.csv", (b: Buffer) => b.toString().includes("'=1")],
    ["create_presentation", { path: "a.pptx", title: "Deck", slides: [{ title: "S1", bullets: ["x"] }] }, "a.pptx", (b: Buffer) => readZip(b).has("ppt/slides/slide2.xml")],
    ["create_chart", { path: "a.svg", chart }, "a.svg", (b: Buffer) => b.toString().startsWith("<svg")],
    ["create_diagram", { path: "d.svg", nodes: [{ id: "a", label: "A" }], edges: [] }, "d.svg", (b: Buffer) => b.toString().includes("<svg")],
  ])("%s makes a real %s file after approval", async (action, args, file, check) => {
    const b = await bot(["modify"]);
    await run(b.id, act(action, args as any));
    const [req] = await pending();
    expect((await approve(req.id)).status).toBe("executed");
    expect(check(readFileSync(join(ws, file)))).toBe(true);
  });

  it("refuses a wrong file extension, a path outside the workspace, secrets files and oversized specs before asking you", async () => {
    const b = await bot(["modify"]);
    const blocks = [{ type: "paragraph", text: "x" }];
    await run(b.id, act("create_document", { path: "a.docx", format: "pdf", title: "T", blocks }), act("create_document", { path: "../out.pdf", format: "pdf", title: "T", blocks }), act("create_document", { path: ".env.pdf", format: "pdf", title: "T", blocks }), act("create_spreadsheet", { path: "big.xlsx", format: "xlsx", sheets: [{ name: "S", header: [], rows: Array.from({ length: LIMITS.rows + 1 }, () => [1]) }] }), act("create_spreadsheet", { path: "bad.xlsx", format: "xlsx", sheets: [{ name: "a/b", header: [], rows: [] }] }));
    expect(await pending()).toHaveLength(0);
    expect(told()).toMatch(/must end in \.pdf/);
  });

  it("will not replace a file unless told to, and never writes outside the folder", async () => {
    const b = await bot(["modify"]);
    writeFileSync(join(ws, "exists.md"), "OLD");
    await run(b.id, act("create_document", { path: "exists.md", format: "md", title: "New", blocks: [{ type: "paragraph", text: "x" }] }));
    expect((await approve((await pending())[0].id))).toMatchObject({ status: "failed", error: expect.stringMatching(/already exists/) });
    expect(readFileSync(join(ws, "exists.md"), "utf8")).toBe("OLD");
    await run(b.id, act("create_document", { path: "exists.md", format: "md", title: "New", blocks: [{ type: "paragraph", text: "x" }], overwrite: true }));
    await approve((await pending())[0].id);
    expect(readFileSync(join(ws, "exists.md"), "utf8")).toContain("# New");
  });

  it("needs the MODIFY permission to create and READ to summarise; a bot without them cannot even ask", async () => {
    const reader = await bot(["read"]);
    await run(reader.id, act("create_chart", { path: "c.svg", chart }));
    expect(told()).toContain('does not have the PC "modify" permission');
    writeFileSync(join(ws, "data.csv"), "item,qty\napple,3\npear,5\n");
    await run(reader.id, act("summarize_data", { path: "data.csv" }));
    expect(told()).toContain("qty: 2 numbers, sum 8, average 4, smallest 3, largest 5");
    const writer = await bot(["modify"]);
    await run(writer.id, act("summarize_data", { path: "data.csv" }));
    expect(told()).toContain('does not have the PC "read" permission');
  });

  it("only .csv can be summarised, and secrets or outside files cannot", async () => {
    const b = await bot(["read"]);
    writeFileSync(join(ws, "notes.txt"), "x");
    writeFileSync(join(ws, ".env"), "a,b");
    await run(b.id, act("summarize_data", { path: "notes.txt" }), act("summarize_data", { path: ".env" }), act("summarize_data", { path: "../x.csv" }));
    expect(told()).toMatch(/Only \.csv files/);
    expect(told()).toMatch(/holds secrets/);
  });

  it("is not offered until a workspace exists, and the emergency stop switches it off", async () => {
    const b = await bot(["modify"]);
    await t.call("POST", "/api/pc/stop");
    expect((await t.call("GET", "/api/external/status")).body.connectors.find((c: any) => c.id === "documents").notReady).toMatch(/emergency stop/);
    await t.call("POST", "/api/pc/resume");
    expect((await t.call("GET", "/api/tools")).body.tools.find((x: any) => x.id === "documents")).toMatchObject({ status: "available" });
    void b;
  });
});
