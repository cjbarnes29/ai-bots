import { describe, expect, it } from "vitest";
import { writeDocx, writeXlsx } from "../documents/office.js";
import { writePdf } from "../documents/pdf.js";
import { extractText } from "./extract.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Round trip with the application's OWN document writers (the same ones agents use to create Word, Excel and PDF files). These files have real structure
 * (styles, headings, tables, several sheets, page content streams), unlike the tiny hand-built fixtures in knowledge.test.ts. They are NOT made by Microsoft
 * Office or a PDF printer; files from those programs are still untested (PHASE4-AUDIT.md R6).
 */
const spec = {
  title: "Quarterly report",
  blocks: [
    { type: "heading", level: 1, text: "Revenue summary" },
    { type: "paragraph", text: "Revenue in the third quarter was 4.2 million dirhams, up 12 percent." },
    { type: "bullets", items: ["Best month: September", "Customers: 1,200"] },
    { type: "table", header: ["Item", "AED"], rows: [["Rent", 180000], ["Staff", 2100000]] },
  ],
} as any;

describe("files written by the application's own writers are read back correctly", () => {
  it("DOCX: headings, paragraphs, bullets and table cells come back as text", () => {
    const r = extractText("report.docx", writeDocx(spec)) as any;
    expect(r.status).toBe("ready");
    for (const s of ["Revenue summary", "4.2 million dirhams", "Best month: September", "Customers: 1,200", "Rent", "180000", "Staff", "2100000"]) expect(r.text, s).toContain(s);
  });
  it("XLSX: every sheet, header and number comes back, one row per line", () => {
    const r = extractText("prices.xlsx", writeXlsx([{ name: "Prices", header: ["Item", "AED"], rows: [["Tea", 4], ["Coffee", 6]] }, { name: "Costs", header: ["Item", "AED"], rows: [["Rent", 180000]] }] as any)) as any;
    expect(r.status).toBe("ready");
    expect(r.text).toContain("Sheet: Prices");
    expect(r.text).toContain("Tea\t4");
    expect(r.text).toContain("Sheet: Costs");
    expect(r.text).toContain("Rent\t180000");
  });
  it("PDF: the text of a PDF the application wrote is read back (status ready, title, heading, paragraph and table cells)", () => {
    const r = extractText("report.pdf", writePdf(spec)) as any;
    expect(r.status).toBe("ready");
    for (const s of ["Quarterly report", "Revenue summary", "4.2 million dirhams", "Rent", "Staff"]) expect(r.text, s).toContain(s);
  });
});
