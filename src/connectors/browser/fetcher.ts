import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { BlockedAddressError, parseTarget, resolvePublicAddress, type LookupAll } from "./netguard.js";

/**
 * Fetches one web page safely. Every step re-checks the rules in netguard.ts, including each redirect.
 * No cookies, no logins, no scripts are run, and nothing is saved. The answer is capped in size and time.
 */
export const FETCH_LIMITS = { timeoutMs: 15_000, maxBytes: 1_000_000, maxRedirects: 3 };
const USER_AGENT = "AIWorkforcePlatform/1.0 (personal assistant; reads public pages only)";
const TEXT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml|application\/json|text\/xml|application\/xml)\b/i;

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface RequestSpec {
  hostname: string;
  address: string;
  family: number;
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export type Requester = (spec: RequestSpec) => Promise<RawResponse>;

/** The real network call. It connects to the address we already checked (not to a fresh lookup) and still verifies the certificate. */
export const realRequest: Requester = (spec) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: spec.hostname,
        servername: spec.hostname,
        port: 443,
        path: spec.path,
        method: spec.method,
        headers: spec.headers,
        timeout: FETCH_LIMITS.timeoutMs,
        // Pin the connection to the vetted address.
        lookup: ((_h: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          options?.all ? cb(null, [{ address: spec.address, family: spec.family }]) : cb(null, spec.address, spec.family)) as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > FETCH_LIMITS.maxBytes) {
            req.destroy(new Error("too big"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (spec.body !== undefined) req.write(spec.body);
    req.end();
  });

const defaultLookup: LookupAll = async (host) => dnsLookup(host, { all: true, verbatim: true });

export interface Page {
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
  redirectedNotFollowed?: string;
}

export interface FetchDeps {
  request?: Requester;
  lookup?: LookupAll;
}

export async function fetchPublicPage(
  startUrl: string,
  options: { method?: "GET" | "POST"; formBody?: string } = {},
  deps: FetchDeps = {},
): Promise<Page> {
  const request = deps.request ?? realRequest;
  const lookup = deps.lookup ?? defaultLookup;
  const method = options.method ?? "GET";
  let current = startUrl;
  for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop++) {
    const target = parseTarget(current);
    const where = await resolvePublicAddress(target.hostname, lookup);
    const headers: Record<string, string> = {
      host: target.url.host,
      "user-agent": USER_AGENT,
      accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
      "accept-encoding": "identity", // no compressed answers: nothing to "unzip bomb"
    };
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers["content-length"] = String(Buffer.byteLength(options.formBody ?? ""));
    }
    let res: RawResponse;
    try {
      res = await request({ hostname: target.hostname, ...where, path: `${target.url.pathname}${target.url.search}`, method, headers, ...(method === "POST" ? { body: options.formBody ?? "" } : {}) });
    } catch (e) {
      if (e instanceof BlockedAddressError) throw e;
      const why = e instanceof Error && e.message === "too big" ? "The page is larger than the 1 MB limit." : e instanceof Error && e.message === "timeout" ? "The website took too long to answer." : "Could not reach that website.";
      throw new Error(why);
    }
    const location = typeof res.headers["location"] === "string" ? res.headers["location"] : null;
    if (res.status >= 300 && res.status < 400 && location) {
      if (method === "POST") return { finalUrl: target.url.toString(), status: res.status, contentType: "", text: "", redirectedNotFollowed: location };
      try {
        current = new URL(location, target.url).toString(); // checked again at the top of the loop
      } catch {
        throw new Error("The website sent a broken redirect.");
      }
      continue;
    }
    const contentType = String(res.headers["content-type"] ?? "");
    if (res.body.length > 0 && !TEXT_TYPES.test(contentType)) throw new Error(`That is not a text page (${contentType.split(";")[0] || "unknown type"}), so it was not read.`);
    return { finalUrl: target.url.toString(), status: res.status, contentType, text: res.body.toString("utf8") };
  }
  throw new Error("The website redirected too many times.");
}
