import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import type { TLSSocket } from "node:tls";
import { BlockedAddressError, parseTarget, resolvePublicAddress, type LookupAll } from "../connectors/browser/netguard.js";
import { AuditError, ExternalDisabledError, type Fetcher, type HttpResponse } from "./audit.js";

/**
 * The only code in the Business Workforce that talks to a business's own website. It is READ-ONLY by construction:
 * one GET of the home page, nothing sent, no cookies, no login, no scripts run.
 *
 * Every request passes the same public-address guard the browser connector uses (no private or internal networks, no IP numbers,
 * no credentials, no odd ports), and the connection is made to the exact address that was checked. It is also behind an
 * on/off lock that is OFF until the owner switches it on.
 */
export const NET_LIMITS = { timeoutMs: 10_000, maxBytes: 1_000_000 };
const USER_AGENT = "Mozilla/5.0 (compatible; AIWorkforceSiteCheck/1.0; read-only homepage check)";

export interface TransportSpec {
  tls: boolean;
  hostname: string;
  address: string;
  family: number;
  port: number;
  path: string;
  timeoutMs: number;
  maxBytes: number;
}
/** One request to an already-vetted address. The real one is below; tests use a fake or a local server. */
export type Transport = (spec: TransportSpec) => Promise<HttpResponse>;

const TLS_CODES = new Set(["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID", "CERT_UNTRUSTED", "CERT_REVOKED", "HOSTNAME_MISMATCH"]);

export function mapNetworkError(err: unknown): AuditError {
  const e = err as { code?: string; message?: string };
  if (e?.message === "timeout" || e?.code === "ETIMEDOUT" || e?.code === "ESOCKETTIMEDOUT") return new AuditError("timed_out", "The website took too long to answer.");
  if (e?.message === "too big") return new AuditError("too_large", "The page is larger than the limit.");
  if (e?.code === "ENOTFOUND" || e?.code === "EAI_AGAIN") return new AuditError("dns_failed", "The website name could not be found.");
  if (e?.code && TLS_CODES.has(e.code)) return new AuditError("tls_certificate_invalid", "The website's security certificate is not valid.");
  return new AuditError("connection_failed", "Could not connect to the website.");
}

export const nodeTransport: Transport = (spec) =>
  new Promise<HttpResponse>((resolve, reject) => {
    const started = Date.now();
    const mod = spec.tls ? https : http;
    let overall: NodeJS.Timeout | undefined;
    const req = mod.request(
      {
        host: spec.hostname,
        ...(spec.tls ? { servername: spec.hostname } : {}),
        port: spec.port,
        path: spec.path,
        method: "GET",
        headers: { host: spec.hostname, "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "accept-encoding": "identity", connection: "close" },
        timeout: spec.timeoutMs,
        // Connect to the address that was checked, not to a fresh lookup of the name.
        lookup: ((_h: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          options?.all ? cb(null, [{ address: spec.address, family: spec.family }]) : cb(null, spec.address, spec.family)) as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        res.on("data", (c: Buffer) => {
          if (tooBig) return;
          size += c.length;
          if (size > spec.maxBytes) {
            tooBig = true;
            clearTimeout(overall);
            reject(new AuditError("too_large", "The page is larger than the limit."));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          clearTimeout(overall);
          if (tooBig) return; // already rejected: a page over the limit is never a success, even if its last chunk arrived with the headers
          const socket = res.socket as TLSSocket;
          const cert = spec.tls && typeof socket.getPeerCertificate === "function" ? socket.getPeerCertificate() : null;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            ...(spec.tls ? { tls: { authorized: socket.authorized === true, ...(cert?.valid_to ? { validTo: cert.valid_to } : {}) } } : {}),
            ms: Date.now() - started,
          });
        });
        res.on("error", (e) => reject(mapNetworkError(e)));
      },
    );
    // A server that trickles bytes forever must not hold a check open: the whole answer has a deadline too.
    overall = setTimeout(() => req.destroy(new Error("timeout")), spec.timeoutMs * 2);
    overall.unref();
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => {
      clearTimeout(overall);
      reject(mapNetworkError(e));
    });
    req.end();
  });

const defaultLookup: LookupAll = async (host) => dnsLookup(host, { all: true, verbatim: true });

export interface GuardedFetcherDeps {
  /** The on/off lock. While it returns false, nothing is requested. */
  allowed: () => boolean;
  transport?: Transport;
  lookup?: LookupAll;
  /** Called once per real request, with the host only (for the audit log and the daily limit). */
  onRequest?: (host: string) => void;
}

export function createGuardedFetcher(deps: GuardedFetcherDeps): Fetcher {
  const transport = deps.transport ?? nodeTransport;
  const lookup = deps.lookup ?? defaultLookup;
  return async (url: URL): Promise<HttpResponse> => {
    if (!deps.allowed()) throw new ExternalDisabledError();
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new AuditError("bad_address", "The address is not a valid website address.");
    if (url.username || url.password) throw new AuditError("blocked_address", "Addresses with a username or password are not allowed.");
    const tls = url.protocol === "https:";
    try {
      // The same name/port/IP-number rules as the browser connector (an explicit port makes this fail, which is intended).
      parseTarget(`https://${url.host}${url.pathname}${url.search}`);
    } catch (e) {
      if (e instanceof BlockedAddressError) throw new AuditError("blocked_address", e.message);
      throw new AuditError("bad_address", "The address is not a valid website address.");
    }
    let where: { address: string; family: number };
    try {
      where = await resolvePublicAddress(url.hostname.toLowerCase().replace(/\.$/, ""), lookup);
    } catch (e) {
      if (e instanceof BlockedAddressError) throw new AuditError(/could not be found/.test(e.message) ? "dns_failed" : "blocked_address", e.message);
      throw new AuditError("connection_failed", "Could not connect to the website.");
    }
    deps.onRequest?.(url.hostname.toLowerCase());
    return transport({ tls, hostname: url.hostname, ...where, port: tls ? 443 : 80, path: `${url.pathname}${url.search}`, timeoutMs: NET_LIMITS.timeoutMs, maxBytes: NET_LIMITS.maxBytes });
  };
}
