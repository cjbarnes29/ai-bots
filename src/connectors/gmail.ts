import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import type { VaultService } from "../vault/service.js";
import type { ConnectorDefinition } from "./types.js";

/**
 * Gmail, behind the approval gate (Phase 7).
 *
 * - search_messages and read_message are READS: they only work for a bot whose Gmail read permission the owner switched on.
 * - send_message is a WRITE: it always waits for the owner's approval and runs once.
 *
 * Sign-in is Google's standard OAuth "installed app" flow with PKCE. The owner creates their own Google client (free) and
 * pastes its ID and secret into the vault; pressing "Connect Gmail" sends them to Google, and Google sends them back to
 * THIS PC (127.0.0.1) with a one-time code. Only the long-lived refresh token is stored (encrypted, in the vault). Short-lived
 * access tokens live in memory only. Only two permissions are requested: read mail and send mail. Nothing can delete,
 * label, or change mail. All addresses are fixed to Google's own servers; only tests can point them at a fake one.
 */
export const GOOGLE_URLS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  api: "https://gmail.googleapis.com",
};
export type GoogleUrls = typeof GOOGLE_URLS;

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"] as const;
export const GMAIL_CLIENT_ID = "GOOGLE_CLIENT_ID";
export const GMAIL_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET";
export const GMAIL_REFRESH_TOKEN = "GMAIL_REFRESH_TOKEN";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 10;
const MAX_BODY_READ_CHARS = 4000;
const MAX_SEND_CHARS = 10_000;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

async function googleFetch(url: string, init: RequestInit): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Error("Could not reach Google. Check the internet connection and try again.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, data };
}

const NEEDS_RECONNECT = "Gmail did not accept the saved sign-in. Press Connect Gmail in Settings to sign in again.";

/** Gets (and caches, in memory only) a short-lived access token. The cache is tied to the refresh token it came from. */
function makeTokenSource(urls: GoogleUrls, secret: (name: string) => string | null, now: () => number) {
  let cache: { refresh: string; access: string; expiresAt: number } | null = null;
  return async (): Promise<string> => {
    const clientId = secret(GMAIL_CLIENT_ID);
    const clientSecret = secret(GMAIL_CLIENT_SECRET);
    const refresh = secret(GMAIL_REFRESH_TOKEN);
    if (!clientId || !clientSecret || !refresh) throw new Error("Gmail is not connected yet.");
    if (cache && cache.refresh === refresh && cache.expiresAt - 60_000 > now()) return cache.access;
    const { status, data } = await googleFetch(urls.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }),
    });
    if (status !== 200 || typeof data?.access_token !== "string") {
      cache = null;
      if (status === 400 || status === 401) throw new Error(NEEDS_RECONNECT);
      throw new Error(`Google refused the sign-in request (status ${status}).`);
    }
    cache = { refresh, access: data.access_token, expiresAt: now() + (Number(data.expires_in) || 300) * 1000 };
    return cache.access;
  };
}

async function gmailApi(urls: GoogleUrls, token: string, path: string, init: RequestInit = {}): Promise<any> {
  const { status, data } = await googleFetch(`${urls.api}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (status === 401) throw new Error(NEEDS_RECONNECT);
  if (status === 403) throw new Error("Google says this sign-in is not allowed to do that. Press Connect Gmail in Settings and accept both permissions.");
  if (status < 200 || status >= 300) {
    const why = typeof data?.error?.message === "string" ? clip(data.error.message, 200) : `status ${status}`;
    throw new Error(`Gmail refused the request: ${why}`);
  }
  return data;
}

function header(message: any, name: string): string {
  const found = (message?.payload?.headers ?? []).find((h: any) => String(h?.name).toLowerCase() === name.toLowerCase());
  return typeof found?.value === "string" ? oneLine(found.value) : "";
}

const b64urlToText = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** The readable text of a message: the plain-text part if there is one, otherwise the HTML part with tags removed. */
function bodyText(part: any): string {
  const found: { plain?: string; html?: string } = {};
  const walk = (p: any, depth: number) => {
    if (!p || depth > 6) return;
    const data = p.body?.data;
    if (typeof data === "string") {
      if (p.mimeType === "text/plain" && found.plain === undefined) found.plain = b64urlToText(data);
      else if (p.mimeType === "text/html" && found.html === undefined) found.html = b64urlToText(data);
    }
    for (const child of Array.isArray(p.parts) ? p.parts : []) walk(child, depth + 1);
  };
  walk(part, 0);
  return found.plain ?? (found.html !== undefined ? htmlToText(found.html) : "");
}

/** Non-ASCII subjects are encoded the standard way (RFC 2047). Line breaks are impossible here, so no header can be injected. */
const encodeSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

export function buildRawEmail(to: string[], subject: string, body: string): string {
  const lines = [
    `To: ${to.join(", ")}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function createGmailConnector(options: { urls?: GoogleUrls; now?: () => number } = {}): ConnectorDefinition {
  const urls = options.urls ?? GOOGLE_URLS;
  const now = options.now ?? Date.now;
  let tokenSource: (() => Promise<string>) | null = null;
  const access = (secret: (n: string) => string | null) => (tokenSource ??= makeTokenSource(urls, secret, now))();

  return {
    id: "gmail",
    label: "Gmail",
    secrets: [
      { name: GMAIL_CLIENT_ID, description: "Google OAuth client ID (from your own Google Cloud project)" },
      { name: GMAIL_CLIENT_SECRET, description: "Google OAuth client secret" },
      { name: GMAIL_REFRESH_TOKEN, description: "Gmail sign-in (set automatically by 'Connect Gmail', do not paste)" },
    ],
    notReady: (ctx) => {
      if (!ctx.secret(GMAIL_CLIENT_ID) || !ctx.secret(GMAIL_CLIENT_SECRET)) return "paste the Google client ID and client secret in Settings first.";
      if (!ctx.secret(GMAIL_REFRESH_TOKEN)) return "press Connect Gmail in Settings to sign in.";
      return null;
    },
    actions: {
      search_messages: {
        kind: "read",
        description: `Search the mailbox with Gmail search words (query), newest first; shows sender, subject, date and a snippet (up to ${MAX_SEARCH_RESULTS})`,
        args: z.strictObject({ query: z.string().max(200).default(""), max: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(5) }),
        summarize: (a) => `Search Gmail for "${clip(String(a["query"] ?? ""), 80)}"`,
        execute: async (a, ctx) => {
          const token = await access(ctx.secret);
          const list = await gmailApi(urls, token, `/gmail/v1/users/me/messages?${new URLSearchParams({ q: String(a["query"] ?? ""), maxResults: String(a["max"] ?? 5) })}`);
          const ids: string[] = (Array.isArray(list?.messages) ? list.messages : []).map((m: any) => String(m?.id)).filter((id: string) => /^[A-Za-z0-9]{6,40}$/.test(id));
          if (ids.length === 0) return "No messages found.";
          const lines: string[] = [];
          for (const id of ids) {
            const m = await gmailApi(urls, token, `/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
            lines.push(`[${id}] ${clip(header(m, "Date"), 40)} | from ${clip(header(m, "From"), 100)} | ${clip(header(m, "Subject"), 150)} | ${clip(oneLine(String(m?.snippet ?? "")), 200)}`);
          }
          return lines.join("\n");
        },
      },
      read_message: {
        kind: "read",
        description: "Read one message by its id (from a search): sender, subject, date and the text",
        args: z.strictObject({ id: z.string().regex(/^[A-Za-z0-9]{6,40}$/, "must be a message id from a search") }),
        summarize: (a) => `Read Gmail message ${String(a["id"])}`,
        execute: async (a, ctx) => {
          const token = await access(ctx.secret);
          const m = await gmailApi(urls, token, `/gmail/v1/users/me/messages/${String(a["id"])}?format=full`);
          const text = oneLine(bodyText(m?.payload)) || oneLine(String(m?.snippet ?? ""));
          return `From: ${clip(header(m, "From"), 150)}\nTo: ${clip(header(m, "To"), 150)}\nDate: ${clip(header(m, "Date"), 40)}\nSubject: ${clip(header(m, "Subject"), 200)}\n\n${clip(text, MAX_BODY_READ_CHARS)}`;
        },
      },
      send_message: {
        kind: "write",
        description: `Send a plain-text email (to: 1 to 5 addresses; subject up to 200 characters; body up to ${MAX_SEND_CHARS})`,
        args: z.strictObject({
          to: z.array(z.string().max(254).regex(EMAIL, "must be an email address")).min(1).max(5),
          subject: z.string().min(1).max(200).regex(/^[^\r\n]*$/, "must be one line"),
          body: z.string().min(1).max(MAX_SEND_CHARS),
        }),
        summarize: (a) => `Send an email to ${(a["to"] as string[]).join(", ")}: "${clip(String(a["subject"]), 100)}"`,
        execute: async (a, ctx) => {
          const token = await access(ctx.secret);
          const sent = await gmailApi(urls, token, "/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ raw: buildRawEmail(a["to"] as string[], String(a["subject"]), String(a["body"])) }),
          });
          return `Sent email ${String(sent?.id ?? "")} to ${(a["to"] as string[]).join(", ")}`.replace("  ", " ");
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The sign-in ("Connect Gmail") routes
// ---------------------------------------------------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING_SIGNINS = 5;

const page = (title: string, message: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`;

export interface GmailOAuthOptions {
  app: FastifyInstance;
  vault: VaultService;
  audit: AuditLog;
  urls?: GoogleUrls;
  /** Where Google sends the owner back to: this PC. */
  redirectBase?: string;
  now?: () => number;
}

export async function registerGmailOAuthRoutes(o: GmailOAuthOptions): Promise<void> {
  const urls = o.urls ?? GOOGLE_URLS;
  const now = o.now ?? Date.now;
  const redirectUri = `${o.redirectBase ?? `http://127.0.0.1:${process.env["PORT"] ?? 3000}`}/api/gmail/oauth/callback`;
  const pending = new Map<string, { verifier: string; expiresAt: number }>(); // in memory only; each entry works once

  const sweep = () => {
    for (const [k, v] of pending) if (v.expiresAt <= now()) pending.delete(k);
  };

  o.app.get("/api/gmail/status", async () => {
    const has = (n: string) => Boolean(o.vault.resolve(n));
    return { hasClient: has(GMAIL_CLIENT_ID) && has(GMAIL_CLIENT_SECRET), connected: has(GMAIL_REFRESH_TOKEN), redirectUri, scopes: [...GMAIL_SCOPES] };
  });

  o.app.post("/api/gmail/oauth/start", async () => {
    const clientId = o.vault.resolve(GMAIL_CLIENT_ID);
    if (!clientId || !o.vault.resolve(GMAIL_CLIENT_SECRET)) throw new AppError(409, "gmail_no_client", "Save the Google client ID and client secret first.");
    sweep();
    if (pending.size >= MAX_PENDING_SIGNINS) throw new AppError(429, "gmail_busy", "Too many sign-in attempts. Wait a few minutes and try again.");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    pending.set(state, { verifier, expiresAt: now() + STATE_TTL_MS });
    const url = `${urls.auth}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })}`;
    o.audit.record("gmail.signin_started", {}, { actor: "owner" });
    return { url };
  });

  // Google sends the browser back here. The one-time "state" proves this sign-in was started by this app moments ago.
  o.app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/gmail/oauth/callback", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    const { code, state, error } = req.query;
    sweep();
    const entry = typeof state === "string" ? pending.get(state) : undefined;
    if (typeof state === "string") pending.delete(state); // single use, whatever happens next
    if (!entry) {
      o.audit.record("gmail.signin_rejected", { reason: "unknown or expired state" });
      return reply.code(400).send(page("Sign-in not accepted", "This sign-in link was not started from this app, or it has expired. Go back to Settings and press Connect Gmail again."));
    }
    if (error || typeof code !== "string" || code.length === 0 || code.length > 2048) {
      o.audit.record("gmail.signin_failed", { reason: error ? "denied at Google" : "no code" });
      return reply.code(400).send(page("Gmail was not connected", "Google did not give permission. Nothing was saved. You can try again from Settings."));
    }
    const clientId = o.vault.resolve(GMAIL_CLIENT_ID);
    const clientSecret = o.vault.resolve(GMAIL_CLIENT_SECRET);
    if (!clientId || !clientSecret) return reply.code(400).send(page("Gmail was not connected", "The Google client ID or secret is missing."));
    let res: { status: number; data: any };
    try {
      res = await googleFetch(urls.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: entry.verifier }),
      });
    } catch {
      return reply.code(502).send(page("Gmail was not connected", "Could not reach Google. Try again from Settings."));
    }
    const granted = typeof res.data?.scope === "string" ? res.data.scope.split(" ") : [];
    const refresh = res.data?.refresh_token;
    if (res.status !== 200 || typeof refresh !== "string" || !GMAIL_SCOPES.every((s) => granted.includes(s))) {
      o.audit.record("gmail.signin_failed", { reason: res.status !== 200 ? `token exchange status ${res.status}` : typeof refresh !== "string" ? "no refresh token" : "permissions not all accepted" });
      return reply.code(400).send(page("Gmail was not connected", "Google did not return the sign-in, or not every permission was accepted. Nothing was saved. Try again and accept both permissions."));
    }
    o.vault.set(GMAIL_REFRESH_TOKEN, refresh);
    o.audit.record("gmail.connected", { scopes: granted }, { actor: "owner" });
    return reply.send(page("Gmail is connected", "You can close this tab and go back to the dashboard. Bots still need your permission to read, and your approval to send."));
  });
}
