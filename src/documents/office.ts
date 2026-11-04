import { createZip } from "./zip.js";
import { esc, type Block, type Chart, type DocumentSpec, type PresentationSpec, type SheetSpec } from "./spec.js";

/**
 * Word, Excel and PowerPoint files written directly as their standard XML parts (no packages).
 * Text is always stored as text: there are no formulas, macros, links or embedded objects in anything written here.
 */
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const rels = (items: { id: string; type: string; target: string }[]) =>
  `${XML}<Relationships xmlns="${PKG_REL}">${items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join("")}</Relationships>`;

// ---------------------------------------------------------------- Excel
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function writeXlsx(sheets: SheetSpec[]): Buffer {
  const used = new Set<string>();
  const named = sheets.map((s, i) => {
    let name = s.name;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${s.name.slice(0, 28)} ${k}`;
    used.add(name.toLowerCase());
    return { ...s, name, index: i + 1 };
  });
  const sheetXml = (s: SheetSpec) => {
    const rows: string[] = [];
    const cellXml = (v: string | number | boolean | null, r: number, c: number, style: number) => {
      const ref = `${colName(c)}${r}`;
      if (v === null) return "";
      if (typeof v === "number") return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    let r = 1;
    if (s.header.length > 0) rows.push(`<row r="${r++}">${s.header.map((h, c) => cellXml(h, 1, c, 1)).join("")}</row>`);
    for (const row of s.rows) {
      rows.push(`<row r="${r}">${row.map((v, c) => cellXml(v, r, c, 0)).join("")}</row>`);
      r++;
    }
    const width = Math.max(s.header.length, ...s.rows.map((x) => x.length), 1);
    const cols = Array.from({ length: width }, (_, c) => {
      const longest = Math.max((s.header[c] ?? "").length, ...s.rows.slice(0, 200).map((x) => String(x[c] ?? "").length), 4);
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, longest + 3)}" customWidth="1"/>`;
    }).join("");
    const view = s.header.length > 0 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
  };
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((s) => `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    { name: "_rels/.rels", data: rels([{ id: "rId1", type: `${REL}/officeDocument`, target: "xl/workbook.xml" }]) },
    { name: "xl/workbook.xml", data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${named.map((s) => `<sheet name="${esc(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: rels([...named.map((s) => ({ id: `rId${s.index}`, type: `${REL}/worksheet`, target: `worksheets/sheet${s.index}.xml` })), { id: `rId${named.length + 1}`, type: `${REL}/styles`, target: "styles.xml" }]) },
    { name: "xl/styles.xml", data: styles },
    ...named.map((s) => ({ name: `xl/worksheets/sheet${s.index}.xml`, data: sheetXml(s) })),
  ]);
}

// ---------------------------------------------------------------- Word
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = (t: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (inner: string, o: { before?: number; after?: number; left?: number; hanging?: number; keepNext?: boolean } = {}) =>
  `<w:p><w:pPr>${o.keepNext ? "<w:keepNext/>" : ""}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 120}"/>${o.left ? `<w:ind w:left="${o.left}" w:hanging="${o.hanging ?? 0}"/>` : ""}</w:pPr>${inner}</w:p>`;

function tableXml(header: string[], rows: (string | number | boolean | null)[][]): string {
  const border = ["top", "left", "bottom", "right", "insideH", "insideV"].map((e) => `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>`).join("");
  const tc = (t: string, bold: boolean) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${bold ? '<w:shd w:val="clear" w:color="auto" w:fill="E5E7EB"/>' : ""}</w:tcPr>${para(run(t, { bold }), { after: 40 })}</w:tc>`;
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const fit = (r: (string | number | boolean | null)[]) => Array.from({ length: width }, (_, i) => String(r[i] ?? ""));
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: width }, () => '<w:gridCol w:w="2000"/>').join("")}</w:tblGrid>${[`<w:tr>${fit(header).map((h) => tc(h, true)).join("")}</w:tr>`, ...rows.map((r) => `<w:tr>${fit(r).map((v) => tc(v, false)).join("")}</w:tr>`)].join("")}</w:tbl>${para("", { after: 80 })}`;
}

function chartAsTable(c: Chart): Block {
  return { type: "table", header: ["", ...c.series.map((s) => s.name)], rows: c.labels.map((l, i) => [l, ...c.series.map((s) => s.values[i] ?? null)]) };
}

export function writeDocx(spec: DocumentSpec): Buffer {
  const body: string[] = [para(run(spec.title, { bold: true, size: 44, color: "1F2937" }), { after: 240 })];
  const walk = (b: Block) => {
    switch (b.type) {
      case "heading":
        body.push(para(run(b.text, { bold: true, size: b.level === 1 ? 34 : b.level === 2 ? 28 : 24, color: "1F2937" }), { before: 240, after: 100, keepNext: true }));
        break;
      case "paragraph":
        body.push(para(run(b.text)));
        break;
      case "bullets":
        for (const item of b.items) body.push(para(run(`•\t${item}`), { left: 480, hanging: 280, after: 60 }));
        break;
      case "numbered":
        b.items.forEach((item, i) => body.push(para(run(`${i + 1}.\t${item}`), { left: 480, hanging: 380, after: 60 })));
        break;
      case "table":
        body.push(tableXml(b.header, b.rows));
        break;
      case "chart":
        // A chart is a picture; Word gets its numbers as a table (the same chart is available as an SVG file).
        if (b.chart.title) body.push(para(run(b.chart.title, { bold: true }), { keepNext: true }));
        {
          const t = chartAsTable(b.chart) as Extract<Block, { type: "table" }>;
          body.push(tableXml(t.header, t.rows));
        }
        break;
      case "pagebreak":
        body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
    }
  };
  spec.blocks.forEach(walk);
  return createZip([
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: rels([{ id: "rId1", type: `${REL}/officeDocument`, target: "word/document.xml" }]) },
    { name: "word/document.xml", data: `${XML}<w:document xmlns:w="${W_NS}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
}

// ---------------------------------------------------------------- PowerPoint
const EMU = 12700; // points to EMU
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const SW = 960 * EMU; // 13.33in x 7.5in, 16:9
const SH = 540 * EMU;

let shapeId = 1;
const textBox = (x: number, y: number, w: number, h: number, paras: { text: string; size: number; bold?: boolean; bullet?: boolean; color?: string }[], name = "Text") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="${esc(name)} ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras
    .map((p) => `<a:p><a:pPr${p.bullet ? ' marL="342900" indent="-342900"' : ""}>${p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "<a:buNone/>"}</a:pPr><a:r><a:rPr lang="en-US" sz="${p.size * 100}"${p.bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${p.color ?? "1F2937"}"/></a:solidFill></a:rPr><a:t>${esc(p.text)}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, name = "Bar") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++shapeId}" name="${name} ${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.max(1, Math.round(w * EMU))}" cy="${Math.max(1, Math.round(h * EMU))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

/** A simple bar picture made of rectangles, so it needs no chart engine and always opens. Line and pie charts are shown as bars of their values. */
function chartShapes(c: Chart, x: number, y: number, w: number, h: number): string[] {
  const colors = ["4F46E5", "0EA5E9", "10B981", "F59E0B", "EF4444", "8B5CF6"];
  const out: string[] = [];
  const max = Math.max(1e-9, ...c.series.flatMap((s) => s.values));
  const n = c.labels.length;
  const slot = w / n;
  const group = slot * 0.7;
  const barW = group / c.series.length;
  const plotH = h - 50;
  c.series.forEach((s, si) =>
    s.values.slice(0, n).forEach((v, i) => {
      const bh = (Math.max(0, v) / max) * plotH;
      const bx = x + slot * i + (slot - group) / 2 + barW * si;
      out.push(rect(bx, y + plotH - bh + 20, barW - 2, bh, colors[si % colors.length]!), textBox(bx - 10, y + plotH - bh, barW + 18, 20, [{ text: String(Math.round(v * 100) / 100), size: 10 }]));
    }),
  );
  c.labels.forEach((l, i) => out.push(textBox(x + slot * i, y + plotH + 22, slot, 26, [{ text: l.length > 16 ? `${l.slice(0, 15)}…` : l, size: 11 }])));
  if (c.series.length > 1) out.push(textBox(x, y + h - 4, w, 22, [{ text: c.series.map((s) => s.name).join("   |   "), size: 10, color: "6B7280" }]));
  return out;
}

export function writePptx(spec: PresentationSpec): Buffer {
  const slides = [{ title: spec.title, bullets: [] as string[], notes: undefined as string | undefined, chart: undefined as Chart | undefined, cover: true }, ...spec.slides.map((s) => ({ ...s, cover: false }))];
  const slideXml = (s: (typeof slides)[number]) => {
    shapeId = 1;
    const shapes: string[] = [];
    if (s.cover) {
      shapes.push(textBox(60, 190, 840, 110, [{ text: s.title, size: 44, bold: true }], "Title"));
    } else {
      shapes.push(textBox(40, 24, 880, 70, [{ text: s.title, size: 32, bold: true }], "Title"));
      if (s.bullets.length > 0) shapes.push(textBox(40, 104, s.chart ? 400 : 880, 380, s.bullets.map((b) => ({ text: b, size: s.bullets.length > 7 ? 16 : 20, bullet: true })), "Content"));
      if (s.chart) {
        if (s.chart.title) shapes.push(textBox(s.bullets.length ? 470 : 40, 100, 450, 28, [{ text: s.chart.title, size: 16, bold: true }], "Chart title"));
        shapes.push(...chartShapes(s.chart, s.bullets.length ? 470 : 40, 134, s.bullets.length ? 450 : 880, 350));
      }
    }
    return `${XML}<p:sld ${P_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  };
  const theme = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="0EA5E9"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
  const notesMissing = true; // speaker notes are kept out of the file on purpose: a notes master adds a lot of parts for little value
  void notesMissing;
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
    },
    { name: "_rels/.rels", data: rels([{ id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" }]) },
    {
      name: "ppt/presentation.xml",
      data: `${XML}<p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    { name: "ppt/_rels/presentation.xml.rels", data: rels([{ id: "rId1", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" }, ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: `${REL}/slide`, target: `slides/slide${i + 1}.xml` })), { id: `rId${slides.length + 2}`, type: `${REL}/theme`, target: "theme/theme1.xml" }]) },
    { name: "ppt/theme/theme1.xml", data: theme },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `${XML}<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${emptyTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels([{ id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" }]) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: `${XML}<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: rels([{ id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" }]) },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(s) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels([{ id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }]) },
    ]),
  ]);
}
