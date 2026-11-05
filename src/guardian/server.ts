import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { commandSchema, type GuardianCore, type Result } from "./core.js";
import type { Journal } from "./journal.js";

/**
 * The Guardian's only door: a small web server on 127.0.0.1. It has its own page (so you can stop everything even when the dashboard
 * is down) and one JSON endpoint that accepts only the fixed commands in core.ts.
 *
 * Safety rules of the door:
 *  - Only local host names are accepted (stops DNS rebinding).
 *  - A change request must carry the header "x-awp-guardian: 1" (a website cannot add it to a cross-origin request unless allowed below).
 *  - A browser request from another site is refused unless that site is on the allowed list (the dashboard).
 *  - Bodies are limited to 4 KB. Nothing from a request is ever run, opened or written to disk.
 */
export const GUARDIAN_HEADER = "x-awp-guardian";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_BODY = 4096;

function hostnameOf(h: string | undefined): string {
  if (!h) return "";
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : (h.split(":")[0] ?? "").toLowerCase();
}

function statusFor(r: Result): number {
  if (r.ok) return 200;
  switch (r.code) {
    case "too_many_attempts":
      return 429;
    case "wrong_passphrase":
      return 401;
    default:
      return 409;
  }
}

export interface GuardianServerOptions {
  core: GuardianCore;
  journal: Journal;
  /** Sites (for example the dashboard) whose pages may talk to the Guardian. */
  allowedOrigins: string[];
}

export function createGuardianServer(o: GuardianServerOptions): Server {
  const origins = new Set(o.allowedOrigins);
  return createServer((req, res) => {
    void handle(o, origins, req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, code: "error", message: "The Guardian could not handle that request." });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(o: GuardianServerOptions, origins: Set<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host))) return send(res, 403, { ok: false, code: "forbidden_host", message: "Host not allowed." });
  const origin = req.headers.origin;
  const sameSite = origin === undefined || origin === `http://${req.headers.host}`;
  if (!sameSite && !origins.has(String(origin))) return send(res, 403, { ok: false, code: "forbidden_origin", message: "That site may not talk to the Guardian." });
  const cors: Record<string, string> = origin && origins.has(String(origin)) ? { "access-control-allow-origin": String(origin), vary: "Origin", "access-control-allow-headers": `content-type, ${GUARDIAN_HEADER}`, "access-control-allow-methods": "GET, POST, OPTIONS" } : {};
  const url = (req.url ?? "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return void res.end();
  }
  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'", "x-content-type-options": "nosniff" });
    return void res.end(PAGE);
  }
  if (req.method === "GET" && url === "/v1/status") return send(res, 200, { ok: true, ...o.core.status() }, cors);
  if (req.method === "GET" && url === "/v1/journal") return send(res, 200, { ok: true, chain: o.journal.verify(), entries: o.journal.tail(50) }, cors);
  if (req.method === "POST" && url === "/v1/command") {
    if (req.headers[GUARDIAN_HEADER] !== "1") return send(res, 403, { ok: false, code: "missing_header", message: `Missing the ${GUARDIAN_HEADER} header.` }, cors);
    const body = await readBody(req);
    if (body === null) return send(res, 413, { ok: false, code: "too_large", message: "Request too large." }, cors);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return send(res, 400, { ok: false, code: "bad_json", message: "The request was not valid JSON." }, cors);
    }
    const parsed = commandSchema.safeParse(json);
    if (!parsed.success) return send(res, 400, { ok: false, code: "unknown_command", message: "Not a command the Guardian accepts." }, cors);
    const result = await o.core.handle(parsed.data, `http:${req.socket.remotePort ?? "?"}`);
    return send(res, statusFor(result), result, cors);
  }
  send(res, 404, { ok: false, code: "not_found", message: "Not found." }, cors);
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Workforce Guardian</title>
<style>body{font:16px system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}button{font:inherit;padding:.6rem 1rem;margin:.25rem;border-radius:.4rem;border:1px solid #888;cursor:pointer}
.stop{background:#b00020;color:#fff;border-color:#b00020}.box{border:1px solid #888;border-radius:.5rem;padding:1rem;margin:1rem 0}input{font:inherit;padding:.5rem;width:100%;box-sizing:border-box}#msg{min-height:1.5rem}</style></head><body>
<h1>AI Workforce Guardian</h1><p>Tier A: development and supervised testing only.</p>
<div class="box"><p>State: <strong id="state">...</strong></p><p id="detail"></p></div>
<div><button id="pause">Pause</button><button id="stop" class="stop">STOP everything</button><button id="lockdown" class="stop">Lock down</button></div>
<div class="box"><label for="pass">Owner passphrase (to resume or unlock)</label><input id="pass" type="password" autocomplete="off">
<button id="resume">Resume</button><button id="unlock">Unlock</button></div><p id="msg" role="status"></p>
<script>
const $=id=>document.getElementById(id);
async function call(body){const r=await fetch('/v1/command',{method:'POST',headers:{'content-type':'application/json','x-awp-guardian':'1'},body:JSON.stringify(body)});return r.json();}
async function refresh(){try{const s=await (await fetch('/v1/status')).json();$('state').textContent=s.state;
const p=s.presence||{};$('detail').textContent='Reason: '+s.reason+'. Presence: '+(p.monitoring?(p.healthy?('idle '+p.idleMinutes+' of '+p.idleLimitMinutes+' min, '+(p.locked?'locked':'unlocked')):'monitor not responding'):'off')+'. Passphrase set: '+(s.passphraseSet?'yes':'NO');}catch(e){$('state').textContent='unreachable';}}
for(const c of ['pause','stop','lockdown']){$(c).onclick=async()=>{$('msg').textContent=(await call({cmd:c})).ok?'Done.':'Failed.';refresh();};}
for(const c of ['resume','unlock']){$(c).onclick=async()=>{const r=await call({cmd:c,passphrase:$('pass').value});$('pass').value='';$('msg').textContent=r.ok?'Done.':r.message;refresh();};}
refresh();setInterval(refresh,3000);
</script></body></html>`;
