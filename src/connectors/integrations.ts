import { z } from "zod";
import { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GOOGLE_URLS, NEEDS_RECONNECT, googleFetch, makeTokenSource, type GoogleUrls } from "./gmail.js";
import type { ConnectorDefinition } from "./types.js";

/**
 * Stage 7 integrations: GitHub, Notion, n8n, MCP servers and Google Workspace (Drive, Docs/Sheets/Slides as text, Calendar, Tasks).
 *
 * Every one of them sits behind the same approval gate as Telegram and Gmail:
 * - reads only work for a bot whose read switch for that connector the owner turned on;
 * - every write waits for the owner's approval and runs once;
 * - tokens live in the vault and are only used inside this file; they are never put into an error message or result;
 * - addresses are fixed to the real services (n8n and MCP use an address the OWNER saved, and only https or this PC are accepted).
 * Nothing here can delete anything, share anything, invite anyone, or change permissions.
 */
const TIMEOUT_MS = 15_000;
const MAX_TEXT = 4000;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}...` : t);
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

async function http(label: string, url: string, init: RequestInit): Promise<{ status: number; data: any; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // The real reason can contain the address (and with it a token). Say only what happened.
    throw new Error(`Could not reach ${label}. Check the internet connection and try again.`);
  }
  const text = (await res.text().catch(() => "")).slice(0, 200_000);
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, data, text };
}

function expectOk(label: string, r: { status: number; data: any }): void {
  if (r.status === 401) throw new Error(`${label} did not accept the saved token. Check it in the Integrations Center.`);
  if (r.status === 403) throw new Error(`${label} says this token is not allowed to do that.`);
  if (r.status === 404) throw new Error(`${label} could not find that (or the token cannot see it).`);
  if (r.status < 200 || r.status >= 300) {
    const why = typeof r.data?.message === "string" ? clip(r.data.message, 200) : typeof r.data?.error?.message === "string" ? clip(r.data.error.message, 200) : `status ${r.status}`;
    throw new Error(`${label} refused the request: ${why}`);
  }
}

/** An address the owner saved (n8n, MCP). Only https, or http to this very PC, and never with a name/password inside. */
export function safeEndpoint(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u;
  return null;
}

const repoName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, "must look like owner/name");
const textField = z.string().min(1).max(MAX_TEXT);

// ---------------------------------------------------------------------------------------------------------------- GitHub
export const GITHUB_API = "https://api.github.com";
export const GITHUB_TOKEN = "GITHUB_TOKEN";

export function createGithubConnector(base: string = GITHUB_API): ConnectorDefinition {
  const call = async (token: string, path: string, init: RequestInit = {}) => {
    const r = await http("GitHub", `${base}${path}`, {
      ...init,
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "ai-workforce-platform", authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    expectOk("GitHub", r);
    return r.data;
  };
  const tok = (ctx: { secret(n: string): string | null }) => {
    const t = ctx.secret(GITHUB_TOKEN);
    if (!t) throw new Error("No GitHub token is saved.");
    return t;
  };
  return {
    id: "github",
    label: "GitHub",
    secrets: [{ name: GITHUB_TOKEN, description: "GitHub fine-grained personal access token (give it only the repositories and permissions you want bots to use)" }],
    notReady: (ctx) => (ctx.secret(GITHUB_TOKEN) ? null : "paste a GitHub token in the Integrations Center first."),
    verify: async (ctx) => {
      const me = await call(tok(ctx), "/user");
      const login = typeof me?.login === "string" ? me.login : "";
      return { ok: true, summary: login ? `GitHub accepted the token for ${login}` : "GitHub accepted the token", ...(login ? { account: login } : {}) };
    },
    actions: {
      search_issues: {
        kind: "read",
        description: "Search issues and pull requests in one repository",
        args: z.strictObject({ repo: repoName, query: z.string().max(200).default("") }),
        summarize: (a) => `Search GitHub issues in ${String(a["repo"])}`,
        execute: async (a, ctx) => {
          const q = encodeURIComponent(`repo:${String(a["repo"])} ${String(a["query"])}`.trim());
          const data = await call(tok(ctx), `/search/issues?q=${q}&per_page=10`);
          const items = (Array.isArray(data?.items) ? data.items : []).map((i: any) => `#${i.number} [${i.state}] ${oneLine(String(i.title ?? ""))}`);
          return items.length ? items.join("\n") : "No matching issues.";
        },
      },
      get_issue: {
        kind: "read",
        description: "Read one issue or pull request (title and description)",
        args: z.strictObject({ repo: repoName, number: z.number().int().min(1).max(10_000_000) }),
        summarize: (a) => `Read GitHub issue ${String(a["repo"])}#${String(a["number"])}`,
        execute: async (a, ctx) => {
          const i = await call(tok(ctx), `/repos/${String(a["repo"])}/issues/${String(a["number"])}`);
          return clip(`#${i.number} [${i.state}] ${oneLine(String(i.title ?? ""))}\n${String(i.body ?? "")}`, MAX_TEXT);
        },
      },
      read_file: {
        kind: "read",
        description: "Read a text file from a repository",
        args: z.strictObject({ repo: repoName, path: z.string().min(1).max(300).regex(/^[^\0]+$/).refine((p) => !p.split("/").includes(".."), "no .."), ref: z.string().regex(/^[A-Za-z0-9_./-]{1,100}$/).optional() }),
        summarize: (a) => `Read ${String(a["path"])} from GitHub ${String(a["repo"])}`,
        execute: async (a, ctx) => {
          const path = String(a["path"]).split("/").map(encodeURIComponent).join("/");
          const d = await call(tok(ctx), `/repos/${String(a["repo"])}/contents/${path}${a["ref"] ? `?ref=${encodeURIComponent(String(a["ref"]))}` : ""}`);
          if (Array.isArray(d) || d?.type !== "file" || typeof d.content !== "string") throw new Error("That is not a file.");
          return clip(Buffer.from(d.content, "base64").toString("utf8"), MAX_TEXT * 2);
        },
      },
      create_issue: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["issue"] }],
        description: "Open a new issue in a repository",
        args: z.strictObject({ repo: repoName, title: z.string().min(1).max(200), body: z.string().max(MAX_TEXT).default("") }),
        summarize: (a) => `Open a GitHub issue in ${String(a["repo"])}: "${clip(String(a["title"]), 100)}"`,
        execute: async (a, ctx) => {
          const d = await call(tok(ctx), `/repos/${String(a["repo"])}/issues`, { method: "POST", body: JSON.stringify({ title: a["title"], body: a["body"] }) });
          return `Opened issue #${d?.number ?? "?"} in ${String(a["repo"])}`;
        },
      },
      comment_issue: {
        kind: "write",
        resultSupport: [{ operation: "post_comment", objects: ["comment"] }, { operation: "append", objects: ["comment"] }],
        description: "Add a comment to an issue or pull request",
        args: z.strictObject({ repo: repoName, number: z.number().int().min(1).max(10_000_000), body: textField }),
        summarize: (a) => `Comment on GitHub ${String(a["repo"])}#${String(a["number"])}: "${clip(String(a["body"]), 100)}"`,
        execute: async (a, ctx) => {
          await call(tok(ctx), `/repos/${String(a["repo"])}/issues/${String(a["number"])}/comments`, { method: "POST", body: JSON.stringify({ body: a["body"] }) });
          return `Commented on ${String(a["repo"])}#${String(a["number"])}`;
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- Notion
export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_TOKEN = "NOTION_TOKEN";
const pageId = z.string().regex(/^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/, "must be a Notion page id");

const richText = (t: string) => [{ type: "text", text: { content: t.slice(0, 2000) } }];
const paragraphs = (t: string) =>
  t
    .split(/\n{1,}/)
    .filter((x) => x.trim())
    .slice(0, 50)
    .map((x) => ({ object: "block", type: "paragraph", paragraph: { rich_text: richText(x) } }));

export function createNotionConnector(base: string = NOTION_API): ConnectorDefinition {
  const call = async (token: string, path: string, init: RequestInit = {}) => {
    const r = await http("Notion", `${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "notion-version": "2022-06-28", ...(init.body ? { "content-type": "application/json" } : {}) } });
    expectOk("Notion", r);
    return r.data;
  };
  const tok = (ctx: { secret(n: string): string | null }) => {
    const t = ctx.secret(NOTION_TOKEN);
    if (!t) throw new Error("No Notion token is saved.");
    return t;
  };
  const titleOf = (p: any): string => {
    const props = p?.properties ?? {};
    for (const k of Object.keys(props)) if (props[k]?.type === "title") return oneLine((props[k].title ?? []).map((t: any) => t?.plain_text ?? "").join(""));
    return "";
  };
  return {
    id: "notion",
    label: "Notion",
    secrets: [{ name: NOTION_TOKEN, description: "Notion internal integration secret (share only the pages you want bots to see with that integration)" }],
    notReady: (ctx) => (ctx.secret(NOTION_TOKEN) ? null : "paste a Notion integration secret in the Integrations Center first."),
    verify: async (ctx) => {
      const me = await call(tok(ctx), "/users/me");
      const name = typeof me?.name === "string" && me.name ? me.name : "the integration";
      return { ok: true, summary: `Notion accepted the secret for ${name}` };
    },
    actions: {
      search: {
        kind: "read",
        description: "Search the Notion pages shared with the integration",
        args: z.strictObject({ query: z.string().max(200).default("") }),
        summarize: (a) => `Search Notion for "${clip(String(a["query"]), 80)}"`,
        execute: async (a, ctx) => {
          const d = await call(tok(ctx), "/search", { method: "POST", body: JSON.stringify({ query: a["query"], page_size: 10, filter: { property: "object", value: "page" } }) });
          const rows = (Array.isArray(d?.results) ? d.results : []).map((p: any) => `${p.id} ${titleOf(p) || "(untitled)"}`);
          return rows.length ? rows.join("\n") : "No pages found.";
        },
      },
      read_page: {
        kind: "read",
        description: "Read the text of a Notion page",
        args: z.strictObject({ pageId }),
        summarize: (a) => `Read Notion page ${String(a["pageId"])}`,
        execute: async (a, ctx) => {
          const d = await call(tok(ctx), `/blocks/${String(a["pageId"])}/children?page_size=100`);
          const lines = (Array.isArray(d?.results) ? d.results : []).map((b: any) => (b?.[b.type]?.rich_text ?? []).map((t: any) => t?.plain_text ?? "").join("")).filter((l: string) => l.trim());
          return lines.length ? clip(lines.join("\n"), MAX_TEXT * 2) : "The page has no text.";
        },
      },
      create_page: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["page"] }, { operation: "save", objects: ["page"] }],
        description: "Create a new Notion page under an existing page",
        args: z.strictObject({ parentPageId: pageId, title: z.string().min(1).max(200), text: z.string().max(MAX_TEXT).default("") }),
        summarize: (a) => `Create a Notion page "${clip(String(a["title"]), 100)}"`,
        execute: async (a, ctx) => {
          const d = await call(tok(ctx), "/pages", { method: "POST", body: JSON.stringify({ parent: { page_id: a["parentPageId"] }, properties: { title: { title: richText(String(a["title"])) } }, children: paragraphs(String(a["text"])) }) });
          return `Created Notion page ${d?.id ?? ""}`.trim();
        },
      },
      append_text: {
        kind: "write",
        resultSupport: [{ operation: "append", objects: ["page"] }, { operation: "write", objects: ["page"] }],
        description: "Add text to the end of a Notion page",
        args: z.strictObject({ pageId, text: textField }),
        summarize: (a) => `Add text to Notion page ${String(a["pageId"])}: "${clip(String(a["text"]), 100)}"`,
        execute: async (a, ctx) => {
          await call(tok(ctx), `/blocks/${String(a["pageId"])}/children`, { method: "PATCH", body: JSON.stringify({ children: paragraphs(String(a["text"])) }) });
          return `Added text to Notion page ${String(a["pageId"])}`;
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- n8n
export const N8N_WEBHOOK = "N8N_WEBHOOK_URL";

/** Starts ONE n8n workflow through the webhook address the owner saved. The address is a secret (it contains the path n8n checks). */
export function createN8nConnector(): ConnectorDefinition {
  return {
    id: "n8n",
    label: "n8n",
    secrets: [{ name: N8N_WEBHOOK, description: "The n8n webhook address to start (https, or http://localhost). It is the only thing bots can start." }],
    notReady: (ctx) => {
      const u = ctx.secret(N8N_WEBHOOK);
      if (!u) return "paste the n8n webhook address in the Integrations Center first.";
      return safeEndpoint(u) ? null : "the saved n8n address must be https, or http on this PC (localhost), with no name or password inside.";
    },
    actions: {
      start_workflow: {
        kind: "write",
        description: "Start the saved n8n workflow and send it a short text",
        args: z.strictObject({ text: z.string().max(MAX_TEXT).default("") }),
        summarize: (a) => `Start the n8n workflow with: "${clip(String(a["text"]), 120)}"`,
        timeoutMs: 60_000,
        execute: async (a, ctx) => {
          const u = safeEndpoint(ctx.secret(N8N_WEBHOOK) ?? "");
          if (!u) throw new Error("The saved n8n address is not usable.");
          const r = await http("n8n", u.toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: a["text"], source: "ai-workforce-platform" }) });
          if (r.status < 200 || r.status >= 300) throw new Error(`n8n refused the request (status ${r.status}).`);
          return `n8n started. ${clip(oneLine(r.text), 500)}`.trim();
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- MCP
export const MCP_URL = "MCP_SERVER_URL";
export const MCP_TOKEN = "MCP_SERVER_TOKEN";

/** One JSON-RPC message over MCP "streamable HTTP". The reply is plain JSON or a short event stream. */
async function mcpPost(u: URL, token: string | null, body: Record<string, unknown>, session: string | null): Promise<{ data: any; session: string | null }> {
  let res: Response;
  try {
    res = await fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
  } catch {
    throw new Error("Could not reach the MCP server.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("The MCP server did not accept the saved token.");
  if (!res.ok) throw new Error(`The MCP server refused the request (status ${res.status}).`);
  const text = (await res.text().catch(() => "")).slice(0, 500_000);
  const sid = res.headers.get("mcp-session-id") ?? session;
  if (!text.trim()) return { data: null, session: sid };
  let data: any = null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) { try { const m = JSON.parse(line.slice(5)); if (m && (m.result !== undefined || m.error !== undefined)) data = m; } catch { /* skip */ } }
  } else {
    try { data = JSON.parse(text); } catch { /* not JSON */ }
  }
  if (data?.error) throw new Error(`The MCP server reported: ${clip(String(data.error.message ?? "an error"), 200)}`);
  return { data, session: sid };
}

async function mcpRun<T>(u: URL, token: string | null, method: string, params: Record<string, unknown>): Promise<T> {
  const init = await mcpPost(u, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ai-workforce-platform", version: "1" } } }, null);
  await mcpPost(u, token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
  const r = await mcpPost(u, token, { jsonrpc: "2.0", id: 2, method, params }, init.session);
  return r.data?.result as T;
}

/** A short, read-only summary of a tool's declared arguments, such as " (arguments: id:string*, limit:number)" (* = required). Untrusted text from the server, so names and types are cut down to plain words. */
function mcpArgsSummary(schema: { properties?: Record<string, { type?: unknown }>; required?: unknown } | undefined): string {
  const props = schema && typeof schema.properties === "object" && schema.properties !== null ? Object.entries(schema.properties).slice(0, 12) : [];
  if (props.length === 0) return "";
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  const parts = props.map(([name, p]) => `${name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40)}:${typeof p?.type === "string" ? p.type.replace(/[^a-z]/g, "").slice(0, 10) || "any" : "any"}${required.has(name) ? "*" : ""}`);
  return ` (arguments: ${parts.join(", ")})`;
}

/** HTTP MCP servers only: starting a local program for a bot would be a PC-agent action, so stdio servers are not supported. */
export function createMcpConnector(): ConnectorDefinition {
  const endpoint = (ctx: { secret(n: string): string | null }) => {
    const u = safeEndpoint(ctx.secret(MCP_URL) ?? "");
    if (!u) throw new Error("The saved MCP address is not usable.");
    return u;
  };
  return {
    id: "mcp",
    label: "MCP server",
    secrets: [
      { name: MCP_URL, description: "Address of ONE MCP server (https, or http://localhost). Local-program (stdio) servers are not supported." },
      { name: MCP_TOKEN, description: "Optional bearer token for that MCP server" },
    ],
    notReady: (ctx) => {
      const u = ctx.secret(MCP_URL);
      if (!u) return "paste the MCP server address in the Integrations Center first.";
      return safeEndpoint(u) ? null : "the saved MCP address must be https, or http on this PC (localhost), with no name or password inside.";
    },
    // "Test connection" (owner-pressed only): the same read-only handshake + tools/list a bot's list_tools uses. It runs no tool and changes nothing.
    verify: async (ctx) => {
      const r = await mcpRun<{ tools?: unknown[] }>(endpoint(ctx), ctx.secret(MCP_TOKEN), "tools/list", {});
      const n = Array.isArray(r?.tools) ? r.tools.length : 0;
      return { ok: true, summary: `The MCP server answered and offers ${n} tool${n === 1 ? "" : "s"}` };
    },
    actions: {
      list_tools: {
        kind: "read",
        description: "List the tools the MCP server offers",
        args: z.strictObject({}),
        summarize: () => "List the MCP server's tools",
        execute: async (_a, ctx) => {
          const r = await mcpRun<{ tools?: { name?: string; description?: string; inputSchema?: { properties?: Record<string, { type?: unknown }>; required?: unknown } }[] }>(endpoint(ctx), ctx.secret(MCP_TOKEN), "tools/list", {});
          const rows = (r?.tools ?? []).slice(0, 50).map((t) => `${String(t.name)}: ${clip(oneLine(String(t.description ?? "")), 120)}${mcpArgsSummary(t.inputSchema)}`);
          return rows.length ? rows.join("\n") : "The server offers no tools.";
        },
      },
      call_tool: {
        kind: "write",
        description: "Run one tool on the MCP server (always needs approval, because the tool may do anything the server allows)",
        args: z.strictObject({ tool: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), arguments: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 20, "at most 20 arguments").default({}) }),
        summarize: (a) => `Run MCP tool "${String(a["tool"])}" with ${JSON.stringify(a["arguments"]).slice(0, 150)}`,
        timeoutMs: 60_000,
        execute: async (a, ctx) => {
          const r = await mcpRun<{ content?: { type?: string; text?: string }[]; isError?: boolean }>(endpoint(ctx), ctx.secret(MCP_TOKEN), "tools/call", { name: a["tool"], arguments: a["arguments"] });
          const text = (r?.content ?? []).filter((c) => c?.type === "text").map((c) => String(c.text ?? "")).join("\n");
          if (r?.isError) throw new Error(`The tool reported an error: ${clip(text, 300)}`);
          return clip(text || "The tool finished with no text.", MAX_TEXT);
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- Google Workspace
export const GWS_REFRESH_TOKEN = "GOOGLE_WORKSPACE_REFRESH_TOKEN";
/** Smallest permissions that cover the actions below: read Drive files, create files this app makes, add calendar events, use tasks. */
export const GWS_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
] as const;

const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const fileId = z.string().regex(/^[A-Za-z0-9_-]{10,100}$/, "must be a Drive file id");
const isoTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, "must look like 2026-05-01T14:00:00Z");

export function createGoogleWorkspaceConnector(options: { urls?: GoogleUrls; now?: () => number } = {}): ConnectorDefinition {
  const urls: GoogleUrls = options.urls ?? GOOGLE_URLS;
  const now = options.now ?? Date.now;
  const drive = urls.workspace ?? "https://www.googleapis.com";
  const tasksBase = urls.tasks ?? "https://tasks.googleapis.com";
  let latest: (n: string) => string | null = () => null;
  const source = makeTokenSource(urls, (n) => latest(n), now, GWS_REFRESH_TOKEN, "Google Workspace");
  const token = (secret: (n: string) => string | null) => {
    latest = secret;
    return source();
  };
  const api = async (secret: (n: string) => string | null, url: string, init: RequestInit = {}, raw = false): Promise<any> => {
    const t = await token(secret);
    const r = await googleFetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}`, ...(init.body && !(init.headers as any)?.["content-type"] ? { "content-type": "application/json" } : {}) } });
    if (r.status === 401) throw new Error(NEEDS_RECONNECT.replaceAll("Gmail", "Google Workspace"));
    if (r.status === 403) throw new Error("Google says this sign-in is not allowed to do that. Press Connect Google Workspace in the Integrations Center and accept every permission.");
    if (r.status < 200 || r.status >= 300) throw new Error(`Google refused the request: ${typeof r.data?.error?.message === "string" ? clip(r.data.error.message, 200) : `status ${r.status}`}`);
    return raw ? r : r.data;
  };
  return {
    id: "gworkspace",
    label: "Google Workspace",
    secrets: [
      { name: GMAIL_CLIENT_ID, description: "Google OAuth client ID (from your own Google Cloud project; shared with Gmail)" },
      { name: GMAIL_CLIENT_SECRET, description: "Google OAuth client secret (shared with Gmail)" },
      { name: GWS_REFRESH_TOKEN, description: "Google Workspace sign-in (set automatically by 'Connect Google Workspace', do not paste)" },
    ],
    notReady: (ctx) => {
      if (!ctx.secret(GMAIL_CLIENT_ID) || !ctx.secret(GMAIL_CLIENT_SECRET)) return "save the Google client ID and secret in the Integrations Center first (the same ones Gmail uses).";
      return ctx.secret(GWS_REFRESH_TOKEN) ? null : "press Connect Google Workspace in the Integrations Center to sign in.";
    },
    verify: async (ctx) => {
      const about = await api(ctx.secret, `${drive}/drive/v3/about?fields=user`);
      const email = typeof about?.user?.emailAddress === "string" ? about.user.emailAddress : "";
      return { ok: true, summary: email ? `Signed in as ${email}` : "Google accepted the sign-in", ...(email ? { account: email } : {}) };
    },
    actions: {
      drive_search: {
        kind: "read",
        description: "Search Google Drive by file name or words inside",
        args: z.strictObject({ query: z.string().min(1).max(200) }),
        summarize: (a) => `Search Google Drive for "${clip(String(a["query"]), 80)}"`,
        execute: async (a, ctx) => {
          const safe = String(a["query"]).replace(/[\\']/g, " ");
          const q = encodeURIComponent(`fullText contains '${safe}' and trashed = false`);
          const d = await api(ctx.secret, `${drive}/drive/v3/files?q=${q}&pageSize=10&fields=files(id,name,mimeType,modifiedTime)`);
          const rows = (Array.isArray(d?.files) ? d.files : []).map((f: any) => `${f.id} ${oneLine(String(f.name))} (${String(f.mimeType).replace("application/vnd.google-apps.", "")})`);
          return rows.length ? rows.join("\n") : "No files found.";
        },
      },
      drive_read: {
        kind: "read",
        description: "Read a Google Doc, Sheet (as CSV), Slides deck (as text) or a plain text file",
        args: z.strictObject({ fileId }),
        summarize: (a) => `Read Google Drive file ${String(a["fileId"])}`,
        execute: async (a, ctx) => {
          const id = encodeURIComponent(String(a["fileId"]));
          const meta = await api(ctx.secret, `${drive}/drive/v3/files/${id}?fields=id,name,mimeType,size`);
          const mime = String(meta?.mimeType ?? "");
          const exp = EXPORT_AS[mime];
          if (!exp && !mime.startsWith("text/")) throw new Error("That file type cannot be read as text.");
          if (!exp && Number(meta?.size) > 1_000_000) throw new Error("That file is too large.");
          const r = await googleFetchText(ctx.secret, token, exp ? `${drive}/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exp)}` : `${drive}/drive/v3/files/${id}?alt=media`);
          return clip(r, MAX_TEXT * 2);
        },
      },
      calendar_events: {
        kind: "read",
        description: "List upcoming events on the primary calendar",
        args: z.strictObject({ days: z.number().int().min(1).max(30).default(7) }),
        summarize: (a) => `List calendar events for the next ${String(a["days"])} days`,
        execute: async (a, ctx) => {
          const from = new Date(now());
          const to = new Date(now() + Number(a["days"]) * 86_400_000);
          const d = await api(ctx.secret, `${drive}/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`);
          const rows = (Array.isArray(d?.items) ? d.items : []).map((e: any) => `${String(e.start?.dateTime ?? e.start?.date ?? "?")} ${oneLine(String(e.summary ?? "(no title)"))}`);
          return rows.length ? rows.join("\n") : "No events.";
        },
      },
      tasks_list: {
        kind: "read",
        description: "List open tasks from the default task list",
        args: z.strictObject({}),
        summarize: () => "List Google Tasks",
        execute: async (_a, ctx) => {
          const d = await api(ctx.secret, `${tasksBase}/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=30`);
          const rows = (Array.isArray(d?.items) ? d.items : []).map((t: any) => `${t.id} ${oneLine(String(t.title ?? ""))}`);
          return rows.length ? rows.join("\n") : "No open tasks.";
        },
      },
      drive_create_doc: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["document"] }, { operation: "save", objects: ["document"] }],
        description: "Create a new Google Doc from text (in the owner's Drive; cannot change existing files)",
        args: z.strictObject({ name: z.string().min(1).max(200), text: z.string().max(MAX_TEXT * 5) }),
        summarize: (a) => `Create the Google Doc "${clip(String(a["name"]), 100)}"`,
        execute: async (a, ctx) => {
          const boundary = `b${Math.random().toString(36).slice(2)}`;
          const meta = JSON.stringify({ name: a["name"], mimeType: "application/vnd.google-apps.document" });
          const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: text/plain; charset=UTF-8\r\n\r\n${String(a["text"])}\r\n--${boundary}--`;
          const d = await api(ctx.secret, `${drive}/upload/drive/v3/files?uploadType=multipart&fields=id,name`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body });
          return `Created Google Doc "${String(d?.name ?? a["name"])}" (${String(d?.id ?? "")})`;
        },
      },
      calendar_create_event: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["event"] }, { operation: "schedule", objects: ["event"] }],
        description: "Add an event to the primary calendar (no guests, so no invitations are sent)",
        args: z.strictObject({ title: z.string().min(1).max(200), start: isoTime, end: isoTime, notes: z.string().max(1000).default("") }),
        summarize: (a) => `Add calendar event "${clip(String(a["title"]), 100)}" at ${String(a["start"])}`,
        execute: async (a, ctx) => {
          if (Date.parse(String(a["end"])) <= Date.parse(String(a["start"]))) throw new Error("The event must end after it starts.");
          const d = await api(ctx.secret, `${drive}/calendar/v3/calendars/primary/events?sendUpdates=none`, { method: "POST", body: JSON.stringify({ summary: a["title"], description: a["notes"], start: { dateTime: a["start"] }, end: { dateTime: a["end"] } }) });
          return `Added calendar event "${String(a["title"])}" (${String(d?.id ?? "")})`;
        },
      },
      tasks_create: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["task"] }],
        description: "Add a task to the default task list",
        args: z.strictObject({ title: z.string().min(1).max(200), notes: z.string().max(1000).default("") }),
        summarize: (a) => `Add Google Task "${clip(String(a["title"]), 100)}"`,
        execute: async (a, ctx) => {
          const d = await api(ctx.secret, `${tasksBase}/tasks/v1/lists/@default/tasks`, { method: "POST", body: JSON.stringify({ title: a["title"], notes: a["notes"] }) });
          return `Added task "${String(a["title"])}" (${String(d?.id ?? "")})`;
        },
      },
    },
  };
}

/** Plain-text download (the export endpoints return text, not JSON). */
async function googleFetchText(secret: (n: string) => string | null, token: (s: (n: string) => string | null) => Promise<string>, url: string): Promise<string> {
  const t = await token(secret);
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error("Could not reach Google. Check the internet connection and try again.");
  }
  if (!res.ok) throw new Error(`Google refused the request (status ${res.status}).`);
  return (await res.text()).slice(0, 100_000);
}
