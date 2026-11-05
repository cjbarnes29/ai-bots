import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { buildEml } from "./eml.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SIMULATED model only. The .eml files and attachments are REAL files written to a temporary workspace.

/** A tiny reader for what buildEml writes: headers, then each MIME part with its decoded body. */
function parseEml(buf: Buffer) {
  const text = buf.toString("utf8");
  const [head] = text.split("\r\n\r\n");
  const boundary = /boundary="([^"]+)"/.exec(head!)![1]!;
  const parts = text.split(`--${boundary}`).slice(1, -1).map((p) => {
    const [h, ...rest] = p.replace(/^\r\n/, "").split("\r\n\r\n");
    return { headers: h!, body: Buffer.from(rest.join("\r\n\r\n").replace(/\r\n/g, ""), "base64") };
  });
  return { head: head!, parts };
}

describe("the .eml builder", () => {
  it("writes a draft with a text body and attachments that decode to the exact bytes; non-ASCII subjects are encoded", () => {
    const pdf = Buffer.from("%PDF-1.4 fake pdf bytes \u0000\u0001ÿ", "binary");
    const out = buildEml({ to: ["owner@example.com"], subject: "Dubai report – التقرير", body: "Hello,\nreport attached.", attachments: [{ filename: "report.pdf", data: pdf }], date: new Date("2026-11-06T10:00:00Z") });
    const m = parseEml(out);
    expect(m.head).toMatch(/^X-Unsent: 1\r\n/);
    expect(m.head).toContain("To: owner@example.com");
    expect(m.head).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0]!.body.toString("utf8")).toBe("Hello,\nreport attached.");
    expect(m.parts[1]!.headers).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(m.parts[1]!.headers).toContain("application/pdf");
    expect(m.parts[1]!.body.equals(pdf)).toBe(true);
  });

  it("refuses a subject with a line break and a bad address, so no extra header can be injected", () => {
    expect(() => buildEml({ to: [], subject: "Hi\r\nBcc: attacker@evil.test", body: "x", attachments: [] })).toThrow(/one line/);
    expect(() => buildEml({ to: ["not an address"], subject: "Hi", body: "x", attachments: [] })).toThrow(/not an email address/);
    const out = buildEml({ to: [], subject: "Hi", body: "x", attachments: [{ filename: 'a"\r\nX-Evil: 1.pdf', data: Buffer.from("x") }] }).toString("utf8");
    expect(out).not.toMatch(/\r\nX-Evil:/);
  });
});

describe("the create_email_draft action through the approval gate", () => {
  const fence = "```";
  const act = (connector: string, action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
  let t: TestApp;
  let ws: string;
  let ref: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchSpy = vi.fn(async () => {
      throw new Error("An email draft must never make a network request");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const base = mkdtempSync(join(tmpdir(), "awp-eml-"));
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
    vi.unstubAllGlobals();
  });
  const bot = async () => {
    const b = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Writer", model: ref }))).body.bot as any;
    await t.call("PUT", `/api/bots/${b.id}/pc`, { grants: ["modify"] });
    return b;
  };
  const run = async (botId: string, ...blocks: string[]) => {
    t.provider.script.push({ ...OK_RESULT, text: blocks.join("\n") }, { ...OK_RESULT, text: "done" });
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
  };
  const pending = async () => ((await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const approve = async (id: string) => (await t.call("POST", `/api/approvals/${id}/approve`)).body.approval;
  const sheet = { path: "leads.xlsx", format: "xlsx", sheets: [{ name: "Leads", header: ["Business", "Website"], rows: [["Acme Gym", "https://acme.example"]] }] };
  const pdf = { path: "report.pdf", format: "pdf", title: "Report", blocks: [{ type: "heading", text: "Findings" }, { type: "paragraph", text: "One business was reviewed." }] };

  it("creates the spreadsheet and the PDF after approval, then a draft with BOTH attached; nothing is sent", async () => {
    const b = await bot();
    await run(b.id, act("documents", "create_spreadsheet", sheet), act("documents", "create_document", pdf), act("documents", "create_email_draft", { path: "draft.eml", to: ["owner@example.com"], subject: "Dubai findings", body: "Please find the files attached.", attachments: ["leads.xlsx", "report.pdf"] }));
    const reqs = await pending();
    expect(reqs).toHaveLength(3);
    // created in the same millisecond: order them the way the owner would, files first, then the draft that needs them
    reqs.sort((a, b) => Number(/email draft/.test(a.summary)) - Number(/email draft/.test(b.summary)));
    expect(reqs[2].summary).toMatch(/Prepare the email draft draft\.eml "Dubai findings" to owner@example\.com with 2 attachment\(s\): leads\.xlsx, report\.pdf\. It is not sent\./);
    expect(existsSync(join(ws, "draft.eml"))).toBe(false); // nothing exists before approval
    for (const r of reqs) expect((await approve(r.id)).status).toBe("executed");
    const eml = parseEml(readFileSync(join(ws, "draft.eml")));
    expect(eml.parts.map((p) => /filename="([^"]+)"/.exec(p.headers)?.[1] ?? "body")).toEqual(["body", "leads.xlsx", "report.pdf"]);
    expect(eml.parts[1]!.body.equals(readFileSync(join(ws, "leads.xlsx")))).toBe(true); // the real files, byte for byte
    expect(eml.parts[2]!.body.equals(readFileSync(join(ws, "report.pdf")))).toBe(true);
    expect(eml.parts[2]!.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a draft that names a file that does not exist yet fails with that reason and writes nothing", async () => {
    const b = await bot();
    await run(b.id, act("documents", "create_email_draft", { path: "draft.eml", subject: "Too early", body: "x", attachments: ["missing.pdf"] }));
    const [req] = await pending();
    const res = await approve(req.id);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/does not exist yet/);
    expect(existsSync(join(ws, "draft.eml"))).toBe(false);
  });

  it("is refused before asking the owner for a wrong extension, a path outside the workspace, a secrets file, a multi-line subject or a bad address", async () => {
    const b = await bot();
    await run(
      b.id,
      act("documents", "create_email_draft", { path: "d.txt", subject: "x", body: "x", attachments: ["a.pdf"] }),
      act("documents", "create_email_draft", { path: "../out.eml", subject: "x", body: "x", attachments: ["a.pdf"] }),
      act("documents", "create_email_draft", { path: "d.eml", subject: "x", body: "x", attachments: [".env"] }),
      act("documents", "create_email_draft", { path: "d.eml", subject: "x\nBcc: a@b.co", body: "x", attachments: ["a.pdf"] }),
      act("documents", "create_email_draft", { path: "d.eml", to: ["nope"], subject: "x", body: "x", attachments: ["a.pdf"] }),
    );
    expect(await pending()).toEqual([]);
    expect(((await t.call("GET", "/api/tasks")).body.tasks as any[])[0].status).toBe("completed");
  });

  it("an executable cannot be attached", async () => {
    const b = await bot();
    await run(b.id, act("documents", "create_document", { path: "x.html", format: "html", title: "T", blocks: [{ type: "paragraph", text: "hi" }] }));
    for (const r of await pending()) await approve(r.id);
    await run(b.id, act("documents", "create_email_draft", { path: "d.eml", subject: "x", body: "x", attachments: ["tool.exe"] }));
    const [req] = await pending();
    expect((await approve(req.id)).error).toMatch(/cannot be attached/);
  });
});
