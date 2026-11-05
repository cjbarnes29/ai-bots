import type { FastifyInstance } from "fastify";
import type { AuditLog } from "../audit/audit.js";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "../security.js";
import type { Device, DeviceService } from "./devices.js";

/**
 * Who is asking? (Phase 11: Windows PC and Android phone.)
 *
 *  - "local":  the browser on this PC, reaching the app by 127.0.0.1 / localhost. Works exactly as before.
 *  - "remote": your phone, reaching the app through Tailscale Serve at a *.ts.net name that YOU listed in REMOTE_HOSTS.
 *              Every API call needs a paired device (a protected cookie); the secret is checked against the stored hash.
 *  - anything else is refused (this also stops DNS-rebinding attacks).
 *
 * The app itself still listens on 127.0.0.1 only. Tailscale Serve (running on the PC) is the only thing that connects the tailnet to it.
 * A request that arrives under a local name but carries proxy headers is refused: it means a proxy is rewriting the host, and
 * trusting it as "local" would let a remote caller skip the pairing.
 */
export const DEVICE_COOKIE = "awp_device";
/** The owner's decision-window token, obtained by typing the passphrase at the Guardian. */
export const PROOF_HEADER = "x-awp-proof";
export const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "tailscale-user-login", "tailscale-user-name"];
const TAILNET_NAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/;

export interface Access {
  mode: "local" | "remote";
  device: Device | null;
}

declare module "fastify" {
  interface FastifyRequest {
    access: Access;
  }
}

/** Remote names must be Tailscale names (*.ts.net). Anything else is ignored (and reported by the caller). */
export function parseRemoteHosts(value: string | undefined): { hosts: string[]; rejected: string[] } {
  const hosts: string[] = [];
  const rejected: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const h = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!h) continue;
    (TAILNET_NAME.test(h) ? hosts : rejected).push(h);
  }
  return { hosts, rejected };
}

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return (hostHeader.split(":")[0] ?? "").toLowerCase();
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Things only the owner at the PC may change: secrets, provider and limit settings, safety permissions, and who may connect. */
const OWNER_ONLY_ROUTES: RegExp[] = [
  /^\/api\/vault/,
  /^\/api\/inbound/,
  /^\/api\/manager\/settings/,
  /^\/api\/skills/,
  /^\/api\/demo\/setup/,
  /^\/api\/recommendations\/(apply|restore)/,
  /^\/api\/workflows$/,
  /^\/api\/workflows\/:id$/,
  /^\/api\/workflows\/:id\/(enable|disable|archive|unarchive|duplicate)$/,
  /^\/api\/workflows\/runs\/:id\/steps\/:nodeId\/retry$/,
  /^\/api\/bots\/:id\/(skills|tools|pc|integrations|memory)/,
  /^\/api\/memory/,
  // Inbox notification preferences (they decide how often bots may write) and hiding a project are owner acts. Reading, pinning, muting and renaming stay open.
  /^\/api\/inbox\/preferences/,
  // Running a model evaluation sends real requests to a provider: an owner act.
  /^\/api\/llm\/registry\/evaluate/,
  /^\/api\/projects\/:id$/,
  // A project's shared workspace: marking an entry as checked by the owner, and withdrawing or restoring it, are owner acts. Reading stays open.
  /^\/api\/projects\/:id\/workspace\/entries\//,
  // Groups: the switch, creating, editing, archiving, members and responsibilities are owner acts. Writing in a group and handing work over work like chat and stay open.
  /^\/api\/workforce\/bots\/:botId$/,
  /^\/api\/groups\/enabled/,
  /^\/api\/groups$/,
  /^\/api\/groups\/:id$/,
  /^\/api\/groups\/:id\/(archive|members|responsibilities)/,
  /^\/api\/pc\/(workspaces|resume)/,
  /^\/api\/devices\/pairing/,
  /^\/api\/(gmail|gworkspace)\/oauth\/start/,
  /^\/api\/gmail\/test-email/,
  /^\/api\/integrations\/:id\/verify/,
  /^\/api\/business\/external/,
  // Choosing the map service and sending a status request to it are owner acts.
  /^\/api\/business\/map/,
  /^\/api\/business\/leads\/:id/,
  /^\/api\/business\/team/,
  /^\/api\/llm\/(providers|models|limits|routing)/,
  /^\/api\/(delegation|automation)\/limits/,
  /^\/api\/bots\/:id\/permissions\//,
  /^\/api\/bots\/:id\/delegation/,
  // Application and folder approvals: creating or changing them. Revoking, looking, previewing and scanning stay open (taking access away is safe).
  /^\/api\/desktop\/settings/,
  /^\/api\/bot-studio\/(templates\/:id\/create|import|draft|bots\/:id\/mode)/,
  /^\/api\/access\/(applications\/:id(\/session)?|folders(\/:id)?|reset)$/,
];
/** Besides the owner-only list: deciding on an approval is also an owner act that needs the proof when this PC is asked. */
const STEP_UP_ONLY_ROUTES: RegExp[] = [/^\/api\/approvals\/:id\/approve/, /^\/api\/decisions\/:id\/(approve|choice|reject|assignments(\/:botId\/(start|repair))?$)/];
/** Stopping things is allowed from the phone; switching them back on is not. */
const PAUSE_ROUTES = new Set(["/api/llm/pause", "/api/external/pause", "/api/automation/pause"]);

export interface AccessOptions {
  remoteHosts: string[];
  devices: DeviceService;
  audit: AuditLog;
  /**
   * When given (a Guardian is configured), every owner-only change made from THIS PC also needs a valid owner proof. Without it, anything on
   * this PC that sends the dashboard header is treated as the owner, including a script an agent ran. See docs/GUARDIAN.md (S-13).
   */
  stepUp?: { check: (token: string) => Promise<boolean> };
}

export function registerAccess(app: FastifyInstance, options: AccessOptions): void {
  const remoteHosts = new Set(options.remoteHosts);
  app.decorateRequest("access", undefined as unknown as Access);

  app.addHook("onRequest", async (req, reply) => {
    const host = hostnameOf(req.headers.host);
    const safe = SAFE_METHODS.has(req.method);
    const path = req.url.split("?")[0] ?? "";
    let mode: Access["mode"];

    if (LOCAL_HOSTNAMES.has(host)) {
      if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) {
        return reply.code(403).send({ error: "proxied_local_host", message: "A proxy is rewriting the address. Remote access must use its own *.ts.net name." });
      }
      mode = "local";
    } else if (remoteHosts.has(host)) {
      mode = "remote";
    } else {
      return reply.code(403).send({ error: "forbidden_host", message: "Host not allowed" });
    }

    if (!safe && req.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      return reply.code(403).send({ error: "missing_client_header", message: "Missing required client header" });
    }

    if (mode === "local") {
      req.access = { mode, device: null };
      return;
    }

    // ---- remote ----
    if (!safe) {
      // Browsers always send Origin on a change request. It must be this very site.
      const origin = req.headers.origin;
      if (origin !== `https://${req.headers.host}`) {
        return reply.code(403).send({ error: "bad_origin", message: "Request did not come from the dashboard." });
      }
    }
    const device = options.devices.authenticate(cookieValue(req.headers.cookie, DEVICE_COOKIE));
    req.access = { mode, device };
    const isApi = path.startsWith("/api/");
    const publicApi = (req.method === "GET" && path === "/api/session") || (req.method === "POST" && path === "/api/devices/pair");
    if (isApi && !device && !publicApi) {
      return reply.code(401).send({ error: "device_not_paired", message: "This device is not paired. Pair it using a code from the PC." });
    }
  });

  // After the body has been read: the rules that depend on the route and on what is being asked.
  app.addHook("preHandler", async (req, reply) => {
    // On this PC, owner acts need the passphrase proof when a Guardian is configured. Stopping, pausing and denying never do.
    if (options.stepUp && req.access.mode === "local" && !SAFE_METHODS.has(req.method)) {
      const route = req.routeOptions.url ?? "";
      const switchesOn = PAUSE_ROUTES.has(route) && (req.body as { paused?: unknown } | undefined)?.paused !== true;
      if (switchesOn || OWNER_ONLY_ROUTES.some((r) => r.test(route)) || STEP_UP_ONLY_ROUTES.some((r) => r.test(route))) {
        const token = req.headers[PROOF_HEADER];
        if (typeof token !== "string" || !(await options.stepUp.check(token))) {
          options.audit.record("owner_proof.refused", { route, method: req.method }, { actor: "local" });
          return reply.code(403).send({ error: "proof_required", message: "Enter your owner passphrase to do this. It is checked by the Guardian, not by the app." });
        }
      }
    }
    if (req.access.mode !== "remote" || SAFE_METHODS.has(req.method)) return;
    const route = req.routeOptions.url ?? "";
    if (OWNER_ONLY_ROUTES.some((r) => r.test(route))) {
      return reply.code(403).send({ error: "owner_only", message: "This can only be changed on the PC." });
    }
    if (PAUSE_ROUTES.has(route) && (req.body as { paused?: unknown } | undefined)?.paused !== true) {
      return reply.code(403).send({ error: "owner_only", message: "A phone can pause things, but only the PC can switch them back on." });
    }
  });

  // Every change made from a remote device is written to the permanent security log, with the device's name.
  app.addHook("onResponse", async (req, reply) => {
    if (req.access?.mode !== "remote" || !req.access.device || SAFE_METHODS.has(req.method) || reply.statusCode >= 400) return;
    options.audit.record("remote.action", { device: req.access.device.name, method: req.method, route: req.routeOptions.url, status: reply.statusCode }, { actor: `device:${req.access.device.name}` });
  });
}
