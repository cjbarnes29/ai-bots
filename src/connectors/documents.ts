import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { LIMITS, blockSchema, chartSchema, diagramSchema, documentSchema, presentationSchema, sheetSchema } from "../documents/spec.js";
import { writeDocx, writePptx, writeXlsx } from "../documents/office.js";
import { writePdf } from "../documents/pdf.js";
import { parseCsv, summarizeTable, writeCsv, writeHtml, writeMarkdown } from "../documents/render.js";
import { chartSvg, diagramSvg } from "../documents/svg.js";
import { resolveInRoots } from "./pc/paths.js";
import type { PcService } from "./pc/service.js";
import type { ActionSpec, ConnectorDefinition } from "./types.js";

/**
 * Deliverables (Stage 5): real files a bot can produce inside a workspace folder: Word, PDF, web page, Markdown, Excel, CSV, PowerPoint,
 * SVG charts and diagrams. It uses the PC agent's workspace folders and permissions (MODIFY to create a file, READ to summarise a CSV), and every
 * file creation waits for your approval, showing the file name and what it contains. Nothing here runs code, uses formulas, or fetches anything.
 */
const FORMATS = {
  document: ["docx", "pdf", "html", "md"],
  spreadsheet: ["xlsx", "csv"],
} as const;

const pathArgFor = (pc: PcService) =>
  z.string().min(1).max(400).superRefine((v, ctx) => {
    const r = resolveInRoots(pc.roots(), v, pc.roots()[0] ?? ".");
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.reason });
  });

export function createDocumentsConnector(pc: PcService): ConnectorDefinition {
  const pathArg = pathArgFor(pc);
  const extOk = (path: string, ext: string) => path.toLowerCase().endsWith(`.${ext}`);
  const withExt = <T extends z.ZodType<{ path: string }>>(schema: T, ext: (v: z.infer<T>) => string) =>
    schema.superRefine((v, ctx) => {
      const e = ext(v);
      if (!extOk(v.path, e)) ctx.addIssue({ code: "custom", message: `The file name must end in .${e}` });
    });

  const save = (path: string, data: Buffer | string, overwrite: boolean | undefined, action: string, botId: string | null, summary: string): string => {
    const r = resolveInRoots(pc.roots(), path, pc.roots()[0] ?? ".");
    if (!r.ok) throw new Error(r.reason);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    if (bytes.length > LIMITS.fileBytes) throw new Error(`The file would be larger than ${LIMITS.fileBytes / 1_000_000} MB.`);
    if (existsSync(r.abs) && (!overwrite || statSync(r.abs).isDirectory())) throw new Error("That file already exists. Ask again with overwrite set to true if you really want to replace it.");
    mkdirSync(dirname(r.abs), { recursive: true });
    writeFileSync(r.abs, bytes);
    pc.log({ botId, action, command: `${summary} -> ${r.abs}`, status: "ok", output: `${bytes.length} bytes` });
    return `Created ${r.abs} (${bytes.length.toLocaleString()} bytes). ${summary}`;
  };

  const docSchema = withExt(z.strictObject({ path: pathArg, format: z.enum(FORMATS.document), title: documentSchema.shape.title, blocks: z.array(blockSchema).min(1).max(LIMITS.blocks), overwrite: z.boolean().optional() }), (v) => v.format);
  const sheetsSchema = withExt(z.strictObject({ path: pathArg, format: z.enum(FORMATS.spreadsheet), sheets: z.array(sheetSchema).min(1).max(LIMITS.sheets), overwrite: z.boolean().optional() }), (v) => v.format);
  const slidesSchema = withExt(z.strictObject({ path: pathArg, ...presentationSchema.shape, overwrite: z.boolean().optional() }), () => "pptx");
  const chartFile = withExt(z.strictObject({ path: pathArg, chart: chartSchema, overwrite: z.boolean().optional() }), () => "svg");
  const diagramFile = withExt(z.strictObject({ path: pathArg, ...diagramSchema.shape, overwrite: z.boolean().optional() }), () => "svg");

  const actions: Record<string, ActionSpec> = {
    create_document: {
      kind: "write",
      description: "Create a report/document file in a workspace: format docx (Word), pdf, html or md. Blocks: heading, paragraph, bullets, numbered, table, chart, pagebreak",
      args: docSchema as unknown as ActionSpec["args"],
      summarize: (a) => `Create the ${String(a["format"]).toUpperCase()} document ${String(a["path"])} titled "${String(a["title"]).slice(0, 80)}" (${(a["blocks"] as unknown[]).length} blocks)`,
      execute: async (a, ctx) => {
        const spec = { title: String(a["title"]), blocks: a["blocks"] as z.infer<typeof documentSchema>["blocks"] };
        const data = a["format"] === "docx" ? writeDocx(spec) : a["format"] === "pdf" ? writePdf(spec) : a["format"] === "html" ? writeHtml(spec) : writeMarkdown(spec);
        return save(String(a["path"]), data, a["overwrite"] as boolean | undefined, "create_document", ctx.botId, `${String(a["format"]).toUpperCase()} document "${spec.title.slice(0, 60)}"`);
      },
    },
    create_spreadsheet: {
      kind: "write",
      description: "Create a spreadsheet in a workspace: format xlsx (Excel, one or more sheets) or csv (first sheet). Cells are text, numbers or true/false; formulas are never written",
      args: sheetsSchema as unknown as ActionSpec["args"],
      summarize: (a) => {
        const sheets = a["sheets"] as { name: string; rows: unknown[] }[];
        return `Create the ${String(a["format"]).toUpperCase()} file ${String(a["path"])} (${sheets.length} sheet(s), ${sheets.reduce((n, s) => n + s.rows.length, 0)} rows)`;
      },
      execute: async (a, ctx) => {
        const sheets = a["sheets"] as z.infer<typeof sheetSchema>[];
        const data = a["format"] === "xlsx" ? writeXlsx(sheets) : writeCsv(sheets[0]!.header, sheets[0]!.rows);
        return save(String(a["path"]), data, a["overwrite"] as boolean | undefined, "create_spreadsheet", ctx.botId, `${String(a["format"]).toUpperCase()} spreadsheet`);
      },
    },
    create_presentation: {
      kind: "write",
      description: "Create a PowerPoint presentation (.pptx): a title slide, then slides with a title, bullets and optionally a bar chart",
      args: slidesSchema as unknown as ActionSpec["args"],
      summarize: (a) => `Create the PowerPoint ${String(a["path"])} titled "${String(a["title"]).slice(0, 80)}" (${(a["slides"] as unknown[]).length + 1} slides)`,
      execute: async (a, ctx) => save(String(a["path"]), writePptx({ title: String(a["title"]), slides: a["slides"] as z.infer<typeof presentationSchema>["slides"] }), a["overwrite"] as boolean | undefined, "create_presentation", ctx.botId, "PowerPoint presentation"),
    },
    create_chart: {
      kind: "write",
      description: "Create a chart picture (.svg): kind bar, line or pie with labels and one or more series of numbers",
      args: chartFile as unknown as ActionSpec["args"],
      summarize: (a) => `Create the ${String((a["chart"] as { kind: string }).kind)} chart ${String(a["path"])}`,
      execute: async (a, ctx) => save(String(a["path"]), chartSvg(a["chart"] as z.infer<typeof chartSchema>), a["overwrite"] as boolean | undefined, "create_chart", ctx.botId, "SVG chart"),
    },
    create_diagram: {
      kind: "write",
      description: "Create a flow diagram picture (.svg) from nodes (id, label) and edges (from, to, optional label)",
      args: diagramFile as unknown as ActionSpec["args"],
      summarize: (a) => `Create the diagram ${String(a["path"])} (${(a["nodes"] as unknown[]).length} boxes)`,
      execute: async (a, ctx) => save(String(a["path"]), diagramSvg({ title: String(a["title"] ?? ""), nodes: a["nodes"] as z.infer<typeof diagramSchema>["nodes"], edges: a["edges"] as z.infer<typeof diagramSchema>["edges"] }), a["overwrite"] as boolean | undefined, "create_diagram", ctx.botId, "SVG diagram"),
    },
    summarize_data: {
      kind: "read",
      description: "Summarise a CSV file in a workspace: row and column counts and, for each number column, sum, average, smallest and largest. Exact arithmetic, no guessing",
      args: z.strictObject({ path: pathArg }),
      summarize: (a) => `Summarise the data file ${String(a["path"])}`,
      execute: async (a, ctx) => {
        const r = resolveInRoots(pc.roots(), String(a["path"]), pc.roots()[0] ?? ".");
        if (!r.ok) throw new Error(r.reason);
        if (!/\.csv$/i.test(r.abs)) throw new Error("Only .csv files can be summarised.");
        if (!existsSync(r.abs) || statSync(r.abs).size > 5_000_000) throw new Error("That file does not exist or is larger than 5 MB.");
        const text = summarizeTable(parseCsv(readFileSync(r.abs, "utf8")));
        pc.log({ botId: ctx.botId, action: "summarize_data", command: `summarise ${r.abs}`, status: "ok" });
        return text;
      },
    },
  };

  return {
    id: "documents",
    label: "Documents (Word, Excel, PowerPoint, PDF, charts)",
    actions,
    notReady: () => (pc.isStopped() ? "the PC agent is stopped (emergency stop)." : pc.roots().length === 0 ? "choose a workspace folder in the PC Control Center first." : null),
    authorize: (botId, action) => {
      const need = action === "summarize_data" ? "read" : "modify";
      return pc.hasGrant(botId, need) ? null : `This bot does not have the PC "${need}" permission, which documents use. The owner can give it on the bot's Permissions tab.`;
    },
  };
}
