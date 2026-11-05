import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { createGithubConnector, createGoogleWorkspaceConnector, createMcpConnector, createN8nConnector, createNotionConnector, GWS_SCOPES, safeEndpoint } from "./integrations.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const GH = "github_pat_FakeTokenForTestsOnly_0123456789";
const NT = "ntn_FakeNotionTokenForTestsOnly0123456789";
const ACCESS = "ya29.FakeWorkspaceAccessTokenForTestsOnly";
const REFRESH = "1//0gFakeWorkspaceRefreshTokenForTestsOnly";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** One pretend internet on this PC. Each test says how it answers. */
async function startFake(handler: (req: Seen, send: (status: number, payload: unknown, headers?: Record<string, string>) => void) => void) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(s);
      handler(s, (status, payload, headers = {}) => {
        res.writeHead(status, { "content-type": typeof payload === "string" ? "text/plain" : "application/json", ...headers });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const fence = "```";
const act = (connector: string, action: string, args: Record<string, unknown> = {}) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const ctx = (secrets: Record<string, string>) => ({ secret: (n: string) => secrets[n] ?? null, botId: null });
const run = (c: ReturnType<typeof createGithubConnector>, action: string, args: Record<string, unknown>, secrets: Record<string, string>) => {
  const spec = c.actions[action]!;
  return spec.execute(spec.args.parse(args), ctx(secrets));
};

describe("safeEndpoint (n8n and MCP addresses)", () => {
  it("accepts https and http only on this PC, never with a name or password", () => {
    expect(safeEndpoint("https://n8n.example.com/webhook/abc")).not.toBeNull();
    expect(safeEndpoint("http://localhost:5678/webhook/abc")).not.toBeNull();
    expect(safeEndpoint("http://127.0.0.1:5678/x")).not.toBeNull();
    expect(safeEndpoint("http://example.com/x")).toBeNull();
    expect(safeEndpoint("http://192.168.1.5/x")).toBeNull();
    expect(safeEndpoint("https://user:pw@example.com/x")).toBeNull();
    expect(safeEndpoint("file:///c:/secrets")).toBeNull();
    expect(safeEndpoint("not a url")).toBeNull();
  });
});

describe("GitHub", () => {
  it("searches, reads, opens issues and comments, sending the token only as a header", async () => {
    const f = await startFake((req, send) => {
      if (req.headers.authorization !== `Bearer ${GH}`) return send(401, { message: "Bad credentials" });
      if (req.url.startsWith("/search/issues")) return send(200, { items: [{ number: 7, state: "open", title: "Bug\nin parser" }] });
      if (req.url === "/repos/me/app/issues/7") return send(200, { number: 7, state: "open", title: "Bug", body: "Details" });
      if (req.url.startsWith("/repos/me/app/contents/docs/a.md")) return send(200, { type: "file", content: Buffer.from("# Hello").toString("base64") });
      if (req.url === "/repos/me/app/issues" && req.method === "POST") return send(201, { number: 8 });
      if (req.url === "/repos/me/app/issues/7/comments") return send(201, {});
      send(404, { message: "Not Found" });
    });
    try {
      const c = createGithubConnector(f.base);
      const s = { GITHUB_TOKEN: GH };
      expect(await run(c, "search_issues", { repo: "me/app", query: "parser" }, s)).toBe("#7 [open] Bug in parser");
      expect(await run(c, "get_issue", { repo: "me/app", number: 7 }, s)).toContain("Details");
      expect(await run(c, "read_file", { repo: "me/app", path: "docs/a.md" }, s)).toBe("# Hello");
      expect(await run(c, "create_issue", { repo: "me/app", title: "T", body: "B" }, s)).toContain("#8");
      expect(await run(c, "comment_issue", { repo: "me/app", number: 7, body: "Thanks" }, s)).toContain("me/app#7");
      expect(f.seen.every((r) => !r.url.includes(GH))).toBe(true);
      expect(f.seen[0]!.headers["user-agent"]).toBeTruthy();
    } finally {
      await f.close();
    }
  });

  it("refuses odd arguments, a wrong token, and never leaks the token in an error", async () => {
    const f = await startFake((_req, send) => send(401, { message: "Bad credentials" }));
    try {
      const c = createGithubConnector(f.base);
      expect(c.actions["read_file"]!.args.safeParse({ repo: "me/app", path: "../../etc/passwd" }).success).toBe(false);
      expect(c.actions["search_issues"]!.args.safeParse({ repo: "me/app/extra" }).success).toBe(false);
      expect(c.actions["search_issues"]!.args.safeParse({ repo: "me/app", extra: 1 }).success).toBe(false);
      const err = await run(c, "get_issue", { repo: "me/app", number: 1 }, { GITHUB_TOKEN: GH }).catch((e) => String(e.message));
      expect(err).toMatch(/did not accept the saved token/);
      expect(err).not.toContain(GH);
      expect(c.notReady!({ secret: () => null })).toMatch(/paste a GitHub token/);
    } finally {
      await f.close();
    }
  });
});

describe("Notion", () => {
  it("searches, reads text, creates a page and appends text", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const f = await startFake((req, send) => {
      if (req.headers.authorization !== `Bearer ${NT}` || req.headers["notion-version"] !== "2022-06-28") return send(401, {});
      if (req.url === "/search") return send(200, { results: [{ id, properties: { Name: { type: "title", title: [{ plain_text: "Plan" }] } } }] });
      if (req.url.startsWith(`/blocks/${id}/children`) && req.method === "GET") return send(200, { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Line one" }] } }] });
      if (req.url === "/pages") return send(200, { id: "newpage" });
      if (req.url === `/blocks/${id}/children` && req.method === "PATCH") return send(200, {});
      send(404, {});
    });
    try {
      const c = createNotionConnector(f.base);
      const s = { NOTION_TOKEN: NT };
      expect(await run(c, "search", { query: "plan" }, s)).toBe(`${id} Plan`);
      expect(await run(c, "read_page", { pageId: id }, s)).toBe("Line one");
      expect(await run(c, "create_page", { parentPageId: id, title: "New", text: "a\nb" }, s)).toContain("newpage");
      expect(JSON.parse(f.seen.find((r) => r.url === "/pages")!.body).children).toHaveLength(2);
      await run(c, "append_text", { pageId: id, text: "more" }, s);
      expect(c.actions["read_page"]!.args.safeParse({ pageId: "../x" }).success).toBe(false);
    } finally {
      await f.close();
    }
  });
});

describe("n8n", () => {
  it("starts only the saved webhook, only over a safe address", async () => {
    const f = await startFake((_req, send) => send(200, { message: "Workflow was started" }));
    try {
      const c = createN8nConnector();
      expect(c.notReady!({ secret: () => null })).toMatch(/paste the n8n/);
      expect(c.notReady!({ secret: () => "http://evil.example.com/hook" })).toMatch(/must be https/);
      expect(c.notReady!({ secret: () => `${f.base}/webhook/abc` })).toBeNull();
      const out = await run(c, "start_workflow", { text: "hi" }, { N8N_WEBHOOK_URL: `${f.base}/webhook/abc` });
      expect(out).toContain("n8n started");
      expect(JSON.parse(f.seen[0]!.body)).toMatchObject({ text: "hi" });
      await expect(run(c, "start_workflow", { text: "hi" }, { N8N_WEBHOOK_URL: "http://evil.example.com/hook" })).rejects.toThrow(/not usable/);
      expect(c.actions["start_workflow"]!.kind).toBe("write");
    } finally {
      await f.close();
    }
  });
});

describe("MCP", () => {
  it("lists tools (plain JSON and event-stream replies) and runs a tool", async () => {
    let stream = false;
    const f = await startFake((req, send) => {
      const m = req.body ? JSON.parse(req.body) : {};
      if (req.headers.authorization !== "Bearer mcp-secret") return send(401, {});
      if (m.method === "initialize") return send(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess1" });
      if (m.method === "notifications/initialized") return send(202, "");
      if (req.headers["mcp-session-id"] !== "sess1") return send(400, {});
      const result = m.method === "tools/list" ? { tools: [{ name: "echo", description: "Echo back" }] } : { content: [{ type: "text", text: `got ${JSON.stringify(m.params.arguments)}` }] };
      if (stream) return send(200, `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result })}\n\n`, { "content-type": "text/event-stream" });
      send(200, { jsonrpc: "2.0", id: 2, result });
    });
    try {
      const c = createMcpConnector();
      const s = { MCP_SERVER_URL: f.base, MCP_SERVER_TOKEN: "mcp-secret" };
      expect(await run(c, "list_tools", {}, s)).toBe("echo: Echo back");
      stream = true;
      expect(await run(c, "list_tools", {}, s)).toBe("echo: Echo back");
      expect(await run(c, "call_tool", { tool: "echo", arguments: { text: "hi" } }, s)).toBe('got {"text":"hi"}');
      expect(c.actions["call_tool"]!.kind).toBe("write"); // running a tool always needs approval
      expect(c.actions["call_tool"]!.args.safeParse({ tool: "rm -rf /" }).success).toBe(false);
      expect(c.notReady!({ secret: () => "file:///c:/x" })).toMatch(/must be https/);
    } finally {
      await f.close();
    }
  });

  it("list_tools shows each tool's declared arguments (names, types, required) and runs nothing", async () => {
    const methods: string[] = [];
    const f = await startFake((req, send) => {
      const m = req.body ? JSON.parse(req.body) : {};
      methods.push(String(m.method));
      if (m.method === "initialize") return send(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "s" });
      if (m.method === "notifications/initialized") return send(202, "");
      send(200, { jsonrpc: "2.0", id: 2, result: { tools: [
        { name: "read_note", description: "Read a note", inputSchema: { type: "object", properties: { id: { type: "string" }, "bad name!<x>": { type: "number" } }, required: ["id"] } },
        { name: "ping", description: "No arguments", inputSchema: { type: "object", properties: {} } },
      ] } });
    });
    try {
      const out = await run(createMcpConnector(), "list_tools", {}, { MCP_SERVER_URL: f.base });
      expect(out).toBe("read_note: Read a note (arguments: id:string*, badnamex:number)\nping: No arguments");
      expect(methods).not.toContain("tools/call");
    } finally {
      await f.close();
    }
  });

  it("Test connection lists the tools only (no tool runs) and reports a refused token plainly", async () => {
    const methods: string[] = [];
    const f = await startFake((req, send) => {
      const m = req.body ? JSON.parse(req.body) : {};
      methods.push(String(m.method));
      if (req.headers.authorization !== "Bearer mcp-secret") return send(401, {});
      if (m.method === "initialize") return send(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "s" });
      if (m.method === "notifications/initialized") return send(202, "");
      send(200, { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a" }, { name: "b" }] } });
    });
    try {
      const c = createMcpConnector();
      const ok = await c.verify!({ secret: (n) => ({ MCP_SERVER_URL: f.base, MCP_SERVER_TOKEN: "mcp-secret" })[n] ?? null });
      expect(ok.summary).toBe("The MCP server answered and offers 2 tools");
      expect(methods).not.toContain("tools/call");
      await expect(c.verify!({ secret: (n) => ({ MCP_SERVER_URL: f.base, MCP_SERVER_TOKEN: "wrong" })[n] ?? null })).rejects.toThrow(/did not accept the saved token/);
    } finally {
      await f.close();
    }
  });
});

describe("Google Workspace", () => {
  it("reads Drive/Calendar/Tasks and creates a doc, an event and a task with the least permissions", async () => {
    const f = await startFake((req, send) => {
      if (req.url === "/token") return send(200, { access_token: ACCESS, expires_in: 3600 });
      if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, {});
      if (req.url.startsWith("/drive/v3/files?q=")) return send(200, { files: [{ id: "doc12345678", name: "Notes", mimeType: "application/vnd.google-apps.document" }] });
      if (req.url.startsWith("/drive/v3/files/doc12345678?fields")) return send(200, { mimeType: "application/vnd.google-apps.document", name: "Notes" });
      if (req.url.startsWith("/drive/v3/files/doc12345678/export")) return send(200, "Exported text");
      if (req.url.startsWith("/drive/v3/files/img12345678?fields")) return send(200, { mimeType: "image/png" });
      if (req.url.startsWith("/calendar/v3/calendars/primary/events?singleEvents")) return send(200, { items: [{ summary: "Standup", start: { dateTime: "2026-06-16T09:00:00Z" } }] });
      if (req.url.startsWith("/calendar/v3/calendars/primary/events?sendUpdates=none")) return send(200, { id: "ev1" });
      if (req.url.startsWith("/tasks/v1/lists/@default/tasks?")) return send(200, { items: [{ id: "t1", title: "Buy milk" }] });
      if (req.url === "/tasks/v1/lists/@default/tasks") return send(200, { id: "t2" });
      if (req.url.startsWith("/upload/drive/v3/files")) return send(200, { id: "newdoc", name: "Report" });
      send(404, {});
    });
    try {
      const urls = { auth: `${f.base}/auth`, token: `${f.base}/token`, api: f.base, workspace: f.base, tasks: f.base };
      const c = createGoogleWorkspaceConnector({ urls, now: () => 0 });
      const s = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_WORKSPACE_REFRESH_TOKEN: REFRESH };
      expect(await run(c, "drive_search", { query: "it's notes" }, s)).toContain("Notes (document)");
      expect(decodeURIComponent(f.seen.find((r) => r.url.startsWith("/drive/v3/files?q="))!.url)).not.toContain("it's"); // quote removed so the query cannot be broken out of
      expect(await run(c, "drive_read", { fileId: "doc12345678" }, s)).toBe("Exported text");
      await expect(run(c, "drive_read", { fileId: "img12345678" }, s)).rejects.toThrow(/cannot be read as text/);
      expect(await run(c, "calendar_events", { days: 7 }, s)).toContain("Standup");
      expect(await run(c, "tasks_list", {}, s)).toContain("Buy milk");
      expect(await run(c, "drive_create_doc", { name: "Report", text: "Body" }, s)).toContain("newdoc");
      expect(await run(c, "calendar_create_event", { title: "Lunch", start: "2026-06-16T12:00:00Z", end: "2026-06-16T13:00:00Z" }, s)).toContain("ev1");
      expect(JSON.parse(f.seen.find((r) => r.url.includes("sendUpdates=none"))!.body)).not.toHaveProperty("attendees");
      await expect(run(c, "calendar_create_event", { title: "Bad", start: "2026-06-16T13:00:00Z", end: "2026-06-16T12:00:00Z" }, s)).rejects.toThrow(/end after/);
      expect(await run(c, "tasks_create", { title: "Call" }, s)).toContain("t2");
      expect(f.seen.filter((r) => r.url === "/token")).toHaveLength(1); // the short-lived token was reused
      expect(c.notReady!({ secret: () => null })).toMatch(/client ID/);
      expect(c.notReady!({ secret: (n) => (n === "GOOGLE_WORKSPACE_REFRESH_TOKEN" ? null : "x") })).toMatch(/Connect Google Workspace/);
      for (const scope of GWS_SCOPES) expect(scope).not.toMatch(/gmail|mail\.google|spreadsheets|documents|calendar$|drive$|admin/);
      for (const name of ["drive_create_doc", "calendar_create_event", "tasks_create"]) expect(c.actions[name]!.kind).toBe("write");
      for (const name of ["drive_search", "drive_read", "calendar_events", "tasks_list"]) expect(c.actions[name]!.kind).toBe("read");
    } finally {
      await f.close();
    }
  });
});

describe("through the approval gate", () => {
  let t: TestApp;
  let f: Awaited<ReturnType<typeof startFake>>;
  let ref: string;
  beforeEach(async () => {
    f = await startFake((req, send) => {
      if (req.url === "/token") return send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: GWS_SCOPES.join(" ") });
      if (req.url.startsWith("/search/issues")) return send(200, { items: [{ number: 1, state: "open", title: "Open bug" }] });
      if (req.url === "/repos/me/app/issues" && req.method === "POST") return send(201, { number: 9 });
      send(404, {});
    });
    const urls = { auth: `${f.base}/auth`, token: `${f.base}/token`, api: f.base, workspace: f.base, tasks: f.base };
    t = await createTestApp({ connectors: [createGithubConnector(f.base), createGoogleWorkspaceConnector({ urls })], googleUrls: urls });
    ref = await setupGeminiModel(t);
    await t.call("PUT", "/api/vault/GITHUB_TOKEN", { value: GH });
  });
  afterEach(async () => {
    await t.app.close();
    await f.close();
    vi.unstubAllEnvs();
  });
  const mkBot = async () => (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Dev", model: ref }))).body.bot as any;
  const runTask = async (botId: string) => {
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
  };
  const toldBot = () => t.provider.calls[1]!.messages[3]!.content;

  it("a read is refused until the owner switches that integration on for that bot only", async () => {
    const bot = await mkBot();
    const other = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Other", model: ref }))).body.bot as any;
    t.provider.script.push(reply(act("github", "search_issues", { repo: "me/app" })), reply("no"));
    await runTask(bot.id);
    expect(toldBot()).toContain("reading is not switched on for this bot");
    expect((await t.call("PUT", `/api/bots/${bot.id}/integrations`, { connectors: ["github"] })).body.enabled).toEqual(["github"]);
    expect((await t.call("GET", `/api/bots/${other.id}/integrations`)).body.enabled).toEqual([]);
    t.provider.calls.length = 0;
    t.provider.script.push(reply(act("github", "search_issues", { repo: "me/app" })), reply("ok"));
    await runTask(bot.id);
    expect(toldBot()).toContain("Open bug");
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).toContain("integration.access_changed");
  });

  it("a write always waits for approval, even when reading is on, and runs once after the owner approves", async () => {
    const bot = await mkBot();
    await t.call("PUT", `/api/bots/${bot.id}/integrations`, { connectors: ["github"] });
    t.provider.script.push(reply(act("github", "create_issue", { repo: "me/app", title: "Hi", body: "B" })), reply("done"));
    await runTask(bot.id);
    expect(f.seen.some((r) => r.method === "POST" && r.url === "/repos/me/app/issues")).toBe(false);
    const pending = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0].summary).toContain("Open a GitHub issue in me/app");
    await t.call("POST", `/api/approvals/${pending[0].id}/approve`, {});
    await vi.waitFor(() => expect(f.seen.filter((r) => r.method === "POST" && r.url === "/repos/me/app/issues")).toHaveLength(1));
  });

  it("is not ready (and says why) until the token is saved", async () => {
    await t.call("DELETE", "/api/vault/GITHUB_TOKEN");
    const status = (await t.call("GET", "/api/external/status")).body;
    expect(status.connectors.find((c: any) => c.id === "github").notReady).toMatch(/paste a GitHub token/);
    expect(status.connectors.find((c: any) => c.id === "gworkspace").notReady).toMatch(/client ID/);
  });

  it("Google Workspace sign-in asks for the least permissions and saves only its own refresh token", async () => {
    await t.call("PUT", "/api/vault/GOOGLE_CLIENT_ID", { value: "client-id" });
    await t.call("PUT", "/api/vault/GOOGLE_CLIENT_SECRET", { value: "client-secret" });
    const url = new URL((await t.call("POST", "/api/gworkspace/oauth/start")).body.url);
    expect(url.searchParams.get("scope")).toBe(GWS_SCOPES.join(" "));
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/gworkspace\/oauth\/callback$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // the fake token server does not check PKCE, so this only proves routing, scopes and where the token is stored
    const res = await t.app.inject({ method: "GET", url: `/api/gworkspace/oauth/callback?code=c&state=${url.searchParams.get("state")}` });
    expect(res.statusCode).toBe(200);
    const vault = (await t.call("GET", "/api/vault")).body.secrets;
    expect(vault.find((s: any) => s.name === "GOOGLE_WORKSPACE_REFRESH_TOKEN").inVault).toBe(true);
    expect(vault.find((s: any) => s.name === "GMAIL_REFRESH_TOKEN")?.inVault ?? false).toBe(false);
    expect(JSON.stringify(vault)).not.toContain(REFRESH);
    expect((await t.call("GET", "/api/gworkspace/status")).body).toMatchObject({ hasClient: true, connected: true });
  });

  it("rejects integration switches for unknown connectors or bots", async () => {
    const bot = await mkBot();
    expect((await t.call("PUT", `/api/bots/${bot.id}/integrations`, { connectors: ["gmail"] })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/${bot.id}/integrations`, { connectors: ["github"], extra: 1 })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/00000000-0000-4000-8000-000000000000/integrations`, { connectors: [] })).status).toBe(404);
  });
});
