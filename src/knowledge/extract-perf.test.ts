import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip } from "../documents/zip.js";
import { extractText } from "./extract.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A file is untrusted input read on the request thread. An earlier version of the PDF and spreadsheet readers used regular expressions that rescanned the
 * rest of the file from every start position: a crafted 800 KB PDF took 40 seconds. These inputs are shaped to trigger exactly that, and each must finish quickly.
 */
const LIMIT_MS = 1500;
const time = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}`, "latin1");
const MB = 1024 * 1024;

describe("hostile files finish quickly (linear scanning)", () => {
  it.each([
    ["thousands of 'stream' words with no end", () => pdf("stream\n".repeat(Math.floor((2 * MB) / 7)))],
    ["a huge run of 'BT' with no 'ET' inside a stream", () => pdf(`1 0 obj\n<< >>\nstream\n${"BT ".repeat(Math.floor(MB / 3))}\nendstream`)],
    ["a huge run of '[' inside a text block", () => pdf(`1 0 obj\n<< >>\nstream\nBT ${"[".repeat(MB)} ET\nendstream`)],
    ["a huge run of '(' inside a text block", () => pdf(`1 0 obj\n<< >>\nstream\nBT ${"(".repeat(MB)} ET\nendstream`)],
    ["a huge run of '<' inside a text block", () => pdf(`1 0 obj\n<< >>\nstream\nBT ${"<a".repeat(MB / 2)} ET\nendstream`)],
    ["a deflate stream that expands past the limit", () => pdf(`1 0 obj\n<< /Filter /FlateDecode >>\nstream\n${deflateSync(Buffer.alloc(40 * MB, 0x42)).toString("latin1")}\nendstream`)],
  ])("PDF: %s", (_name, make) => {
    const buf = make();
    expect(time(() => extractText("x.pdf", buf))).toBeLessThan(LIMIT_MS);
  });

  it.each([
    ["<w:t  repeated with no '>'", "<w:t ".repeat(MB / 5)],
    ["<w:t> repeated with no close", "<w:t>".repeat(MB / 5)],
    ["<w:p> without end", "<w:p>".repeat(MB / 5)],
  ])("DOCX: %s", (_name, body) => {
    const buf = createZip([{ name: "word/document.xml", data: Buffer.from(`<w:document><w:body>${body}</w:body></w:document>`) }] as any);
    expect(time(() => extractText("x.docx", buf))).toBeLessThan(LIMIT_MS);
  });

  it.each([
    ["<row  repeated with no '>'", "<row ".repeat(MB / 5)],
    ["<row> repeated with no close", "<row>".repeat(MB / 5)],
    ["<c  repeated inside one row", `<row r="1">${"<c ".repeat(MB / 3)}</row>`],
    ["<c> repeated with no close", `<row r="1">${"<c>".repeat(MB / 3)}</row>`],
  ])("XLSX: %s", (_name, body) => {
    const buf = createZip([
      { name: "xl/workbook.xml", data: Buffer.from(`<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>`) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(`<worksheet><sheetData>${body}</sheetData></worksheet>`) },
    ] as any);
    expect(time(() => extractText("x.xlsx", buf))).toBeLessThan(LIMIT_MS);
  });

  it("still reads ordinary files correctly after the rewrite (text order, tabs, numbers, escapes, arrays)", () => {
    const d = createZip([{ name: "word/document.xml", data: Buffer.from(`<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:tab/><w:t>World</w:t></w:r></w:p><w:p><w:r><w:t>Line &amp; two</w:t></w:r></w:p></w:body></w:document>`) }] as any);
    expect((extractText("a.docx", d) as any).text).toBe("Hello \tWorld\nLine & two");
    const x = createZip([
      { name: "xl/workbook.xml", data: Buffer.from(`<workbook><sheets><sheet name="A &amp; B" sheetId="1"/><sheet name="Two" sheetId="2"/></sheets></workbook>`) },
      { name: "xl/sharedStrings.xml", data: Buffer.from(`<sst><si><t>Item</t></si><si><t xml:space="preserve">Tea </t></si></sst>`) },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>inline</t></is></c></row></sheetData></worksheet>`) },
      { name: "xl/worksheets/sheet2.xml", data: Buffer.from(`<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`) },
    ] as any);
    expect((extractText("a.xlsx", x) as any).text).toBe("Sheet: A & B\nItem\t\t42\nTea \tinline\nSheet: Two\n7");
    const p = pdf(`1 0 obj\n<< /Length 200 >>\nstream\nBT /F1 12 Tf 72 700 Td (Hello \\(world\\)) Tj 0 -14 Td [(Ab) -20 (cd)] TJ T* <48656c6c6f> Tj ET\nBT (second block) Tj ET\nendstream\nendobj`);
    const text = (extractText("a.pdf", p) as any).text as string;
    expect(text).toContain("Hello (world)");
    expect(text).toContain("Abcd");
    expect(text).toContain("Hello");
    expect(text).toContain("second block");
  });
});
