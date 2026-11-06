import { inflateSync } from "node:zlib";
import { readZip } from "../documents/zip.js";

/**
 * Text extraction for the Knowledge Center and chat attachments. No packages: plain text formats are decoded, Office files (.docx, .xlsx) are ZIPs of
 * XML read with the project's own small ZIP reader, and PDFs get a deliberately SIMPLE extractor (text drawn with standard operators in plain or
 * Flate-compressed streams). A PDF that is scanned, encrypted or uses embedded font encodings yields no readable text and is reported as failed with
 * the reason: nothing is guessed. Pictures are stored but not read (no OCR or vision model is verified here).
 * The extracted text is untrusted data. Nothing here executes anything.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;
const MAX_ZIP_ENTRY = 20 * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv", "xlsx", "json", "xml", "png", "jpg", "jpeg", "gif", "webp"] as const;
export type Ext = (typeof SUPPORTED_EXTENSIONS)[number];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type ExtractResult =
  | { status: "ready"; text: string; extractor: string; note: string }
  | { status: "failed"; reason: string; extractor: string }
  | { status: "unsupported"; reason: string; extractor: string };

export const extOf = (filename: string): string => (/\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1] ?? "").toLowerCase();

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&amp;/g, "&");

function decodeText(buf: Buffer): string {
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  return body.toString("utf8");
}

/** True when the text looks like words, not binary noise. */
export function looksReadable(text: string): boolean {
  const sample = text.slice(0, 5000);
  if (sample.length === 0) return false;
  let bad = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  return bad / sample.length < 0.02;
}

/**
 * LINEAR scanning only. A file is untrusted input read on the request thread, so none of the readers below uses a regular expression that can scan to
 * the end of the file from every start position (that made a crafted 800 KB file take 40 seconds). Each scan moves forward and never goes back.
 */
interface Tag {
  attrs: string;
  inner: string;
}
/** Every <name ...>inner</name> (or self-closing <name .../>) in `s`, found with indexOf only. An unclosed tag ends the scan. */
function* tags(s: string, name: string): Generator<Tag> {
  const open = `<${name}`;
  let pos = 0;
  for (;;) {
    const a = s.indexOf(open, pos);
    if (a < 0) return;
    const after = s[a + open.length];
    if (after !== ">" && after !== " " && after !== "/" && after !== "\t" && after !== "\n" && after !== "\r") {
      pos = a + open.length; // e.g. <w:tab when looking for <w:t
      continue;
    }
    const gt = s.indexOf(">", a + open.length);
    if (gt < 0) return;
    const attrs = s.slice(a + open.length, gt);
    if (s[gt - 1] === "/") {
      yield { attrs: attrs.slice(0, -1), inner: "" };
      pos = gt + 1;
      continue;
    }
    const closeTag = `</${name}>`;
    const b = s.indexOf(closeTag, gt + 1);
    if (b < 0) return;
    yield { attrs, inner: s.slice(gt + 1, b) };
    pos = b + closeTag.length;
  }
}
const attr = (attrs: string, key: string): string | undefined => {
  const i = attrs.indexOf(`${key}="`);
  if (i < 0) return undefined;
  const j = attrs.indexOf('"', i + key.length + 2);
  return j < 0 ? undefined : attrs.slice(i + key.length + 2, j);
};
const textRuns = (xml: string): string => {
  let out = "";
  for (const t of tags(xml, "t")) out += t.inner;
  return out;
};

function docxText(buf: Buffer): string {
  const parts = readZip(buf, MAX_ZIP_ENTRY);
  const doc = parts.get("word/document.xml");
  if (!doc) throw new Error("This does not look like a Word document (word/document.xml is missing).");
  const xml = doc.toString("utf8");
  const paragraphs = xml.split("</w:p>").map((p) => {
    const runs = p.split("<w:tab/>").join("<w:t>\t</w:t>").split("<w:br/>").join("<w:t>\n</w:t>");
    let out = "";
    for (const t of tags(runs, "w:t")) out += t.inner;
    return decodeEntities(out);
  });
  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xlsxText(buf: Buffer): string {
  const parts = readZip(buf, MAX_ZIP_ENTRY);
  const wb = parts.get("xl/workbook.xml");
  if (!wb) throw new Error("This does not look like a spreadsheet (xl/workbook.xml is missing).");
  const shared: string[] = [];
  const ss = parts.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) for (const si of ss.split("</si>")) shared.push(decodeEntities(textRuns(si)));
  const names: string[] = [];
  for (const sh of tags(wb.toString("utf8"), "sheet")) names.push(decodeEntities(attr(sh.attrs, "name") ?? ""));
  const out: string[] = [];
  let rowsLeft = 5000;
  for (let i = 0; i < names.length && rowsLeft > 0; i++) {
    const sheet = parts.get(`xl/worksheets/sheet${i + 1}.xml`)?.toString("utf8");
    if (!sheet) continue;
    out.push(`Sheet: ${names[i]}`);
    for (const row of tags(sheet, "row")) {
      if (rowsLeft-- <= 0) break;
      const cells: string[] = [];
      for (const c of tags(row.inner, "c")) {
        const ref = attr(c.attrs, "r") ?? "A1";
        const type = attr(c.attrs, "t");
        const a = c.inner.indexOf("<v>");
        const b = a < 0 ? -1 : c.inner.indexOf("</v>", a + 3);
        let value = a >= 0 && b > a ? c.inner.slice(a + 3, b) : "";
        if (type === "s") value = shared[Number(value)] ?? "";
        else if (type === "inlineStr") value = textRuns(c.inner);
        else value = decodeEntities(value);
        const idx = colIndex(ref);
        if (idx >= 0 && idx < 200) cells[idx] = value;
      }
      out.push(Array.from(cells, (v) => v ?? "").join("\t"));
    }
  }
  return out.join("\n");
}

function unescapePdfString(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
}

/** Reads a PDF string starting at the "(" at `j`; returns its raw text and the index after the closing ")". One forward pass. */
function readPdfString(s: string, j: number): [string, number] {
  let depth = 0;
  let out = "";
  for (let k = j; k < s.length; k++) {
    const c = s[k]!;
    if (c === "\\") {
      out += s.slice(k, k + 2);
      k++;
    } else if (c === "(") {
      if (depth > 0) out += c;
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return [out, k + 1];
      out += c;
    } else out += c;
  }
  return [out, s.length];
}
const isWs = (c: string | undefined) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";

/** The text drawn by the text operators (Tj, TJ, ', ") inside one BT...ET block, in one forward pass. */
function pdfBlockText(b: string): string {
  let out = "";
  const n = b.length;
  let i = 0;
  const followedBy = (j: number, ...ops: string[]) => {
    while (j < n && isWs(b[j])) j++;
    return ops.some((o) => b.startsWith(o, j) && (j + o.length >= n || !/[A-Za-z]/.test(b[j + o.length]!)) ) || ((b[j] === "'" || b[j] === '"') && ops.includes("Tj"));
  };
  while (i < n) {
    const c = b[i]!;
    if (c === "(") {
      const [s, next] = readPdfString(b, i);
      if (followedBy(next, "Tj")) out += unescapePdfString(s);
      i = next;
    } else if (c === "[") {
      let k = i + 1;
      let arr = "";
      while (k < n && b[k] !== "]") {
        if (b[k] === "(") {
          const [s, next] = readPdfString(b, k);
          arr += unescapePdfString(s);
          k = next;
        } else k++;
      }
      if (followedBy(k + 1, "TJ")) out += arr;
      i = k + 1;
    } else if (c === "<" && b[i + 1] !== "<") {
      const gt = b.indexOf(">", i + 1);
      if (gt < 0) break;
      const hex = b.slice(i + 1, gt).replace(/\s+/g, "");
      if (/^[0-9A-Fa-f]*$/.test(hex) && followedBy(gt + 1, "Tj")) out += Buffer.from(hex, "hex").toString("latin1");
      i = gt + 1;
    } else if (c === "T" && (b[i + 1] === "*" || b[i + 1] === "d" || b[i + 1] === "D") && !/[A-Za-z]/.test(b[i + 2] ?? " ")) {
      out += "\n";
      i += 2;
    } else i++;
  }
  return out;
}

function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("%PDF-")) throw new Error("This does not look like a PDF file.");
  if (raw.includes("/Encrypt")) throw new Error("This PDF is encrypted, so its text cannot be read.");
  const lines: string[] = [];
  let pos = 0;
  let streams = 0;
  for (;;) {
    const a = raw.indexOf("stream", pos);
    if (a < 0 || streams > 20000) break;
    pos = a + 6;
    if (raw.startsWith("end", a - 3)) continue; // the word "endstream"
    let start = a + 6;
    if (raw[start] === "\r") start++;
    if (raw[start] !== "\n") continue;
    start++;
    const e = raw.indexOf("endstream", start);
    if (e < 0) break;
    streams++;
    const head = raw.slice(Math.max(0, a - 300), a);
    let data = Buffer.from(raw.slice(start, e).replace(/\r?\n$/, ""), "latin1");
    pos = e + 9;
    if (head.includes("/FlateDecode")) {
      try {
        data = inflateSync(data, { maxOutputLength: MAX_ZIP_ENTRY });
      } catch {
        continue;
      }
    }
    const content = data.toString("latin1");
    let p = 0;
    for (;;) {
      const bt = content.indexOf("BT", p);
      if (bt < 0) break;
      if (/[A-Za-z]/.test(content[bt - 1] ?? " ") || /[A-Za-z]/.test(content[bt + 2] ?? " ")) {
        p = bt + 2;
        continue;
      }
      const et = content.indexOf("ET", bt + 2);
      if (et < 0) break;
      const line = pdfBlockText(content.slice(bt + 2, et)).trim();
      if (line) lines.push(line);
      p = et + 2;
    }
  }
  return lines.join("\n").trim();
}

/** Reads text from a file's bytes. Never throws: a problem is returned as a status with a plain reason. */
export function extractText(filename: string, bytes: Buffer): ExtractResult {
  const ext = extOf(filename);
  if (IMAGE_EXTENSIONS.includes(ext)) {
    return { status: "unsupported", extractor: "none", reason: "Stored as a picture. Text in pictures is not read here (no OCR or vision model is set up), so the assistant cannot describe it." };
  }
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { status: "unsupported", extractor: "none", reason: `Files ending in .${ext || "?"} are not supported. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.` };
  }
  try {
    let text: string;
    let extractor: string;
    if (ext === "docx") (text = docxText(bytes)), (extractor = "docx");
    else if (ext === "xlsx") (text = xlsxText(bytes)), (extractor = "xlsx");
    else if (ext === "pdf") (text = pdfText(bytes)), (extractor = "pdf-simple");
    else (text = decodeText(bytes)), (extractor = "text");
    if (ext !== "pdf" && !looksReadable(text)) return { status: "failed", extractor, reason: "The file does not contain readable text (it may be binary or damaged)." };
    if (text.trim().length === 0) {
      return {
        status: "failed",
        extractor,
        reason: ext === "pdf" ? "No readable text was found. The PDF may be scanned pictures or use fonts this simple reader cannot decode." : "The file has no text in it.",
      };
    }
    if (ext === "pdf" && !looksReadable(text)) return { status: "failed", extractor, reason: "The text in this PDF could not be decoded (it uses embedded font encodings)." };
    let note = "";
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      note = `Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were kept.`;
    }
    return { status: "ready", text, extractor, note };
  } catch (e) {
    return { status: "failed", extractor: ext, reason: e instanceof Error && /too large|bomb|maxOutputLength|Cannot create a Buffer/.test(e.message) ? "The file expands to more than is allowed, so it was refused." : `The file could not be read: ${e instanceof Error ? e.message.slice(0, 120) : "unknown problem"}` };
  }
}

/** Splits text into pieces of about `size` characters at paragraph or sentence breaks (a small overlap keeps context across pieces). */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
