import { ExternalDisabledError } from "./audit.js";
import { cleanText, cleanUrl, makeLead, websiteHost, isSocialHost, type Lead } from "./leads.js";
import { categoryOf, type Category, type Market, type Region } from "./markets.js";

/**
 * Business discovery from OpenStreetMap map data (read-only, free, no key).
 *
 * The question sent to the map service is built ONLY from the fixed tables in markets.ts (an emirate's code, a category's tags,
 * a number): nothing an agent or a website says can reach it. The service address is a constant. Map data can be edited by
 * anyone, so every field that comes back is treated as untrusted and cleaned before it is stored or shown.
 *
 * Nothing here runs unless the owner has switched outside requests on.
 */
/**
 * The map services this app may ask. A FIXED list: nothing an agent or a website says can add an address. The owner chooses one (default "main");
 * the app never switches by itself, so a request always goes to the address the owner chose and counts against the same allowance and daily limit.
 * "kumi" is a public mirror proposed after the main service did not answer this PC (P-36, D-069). It has NOT been contacted or verified yet.
 */
export const OVERPASS_ENDPOINTS = {
  main: { id: "main", label: "overpass-api.de (default)", host: "overpass-api.de", interpreter: "https://overpass-api.de/api/interpreter", status: "https://overpass-api.de/api/status", verified: false },
  kumi: { id: "kumi", label: "overpass.kumi.systems (public mirror, not verified)", host: "overpass.kumi.systems", interpreter: "https://overpass.kumi.systems/api/interpreter", status: "https://overpass.kumi.systems/api/status", verified: false },
} as const;
export type EndpointId = keyof typeof OVERPASS_ENDPOINTS;
export type OverpassEndpoint = (typeof OVERPASS_ENDPOINTS)[EndpointId];
export const DEFAULT_ENDPOINT: EndpointId = "main";
export const isEndpointId = (v: unknown): v is EndpointId => typeof v === "string" && Object.prototype.hasOwnProperty.call(OVERPASS_ENDPOINTS, v);
/** Kept for older callers and tests: the default service. */
export const OVERPASS_URL = OVERPASS_ENDPOINTS.main.interpreter;
export const OVERPASS_HOST = OVERPASS_ENDPOINTS.main.host;
export const MAP_TIMEOUTS = { searchMs: 40_000, statusMs: 15_000 };

/** Why a request did not reach the map service, from a fixed vocabulary only (never raw error text). "" when unknown. */
export function reachReason(e: unknown, timeoutMs: number): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string } } | null;
  const code = String(err?.cause?.code ?? err?.code ?? "");
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `no answer within ${Math.round(timeoutMs / 1000)} seconds`;
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "the address could not be looked up (DNS)";
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT)$/.test(code)) return `the connection failed (${code})`;
  if (/CERT|TLS|SSL/i.test(code)) return "the secure connection failed";
  return "";
}

/** What is known about one map service. Kept in memory; never used to switch services automatically. */
export interface EndpointHealth {
  endpoint: EndpointId;
  at: string;
  kind: "status" | "search";
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  reason: string;
  /** For a status check: the first lines of the service's own status text (cleaned, capped). */
  detail: string;
}
export const DISCOVERY_LIMITS = {
  maxResults: 60,
  defaultResults: 25,
  serverTimeoutSeconds: 25,
  /** Minimum wait between two questions to the map service (it is a shared public service). */
  minGapMs: 6_000,
  cacheMs: 6 * 3_600_000,
  maxQueriesPerDay: 20,
  maxResponseBytes: 3_000_000,
};

export class DiscoveryLimitError extends Error {}

const WORD = /^[a-z_]+$/;
const ISO = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export interface Search {
  market: Market;
  region: Region | null;
  categories: Category[];
  limit: number;
}

/** The question to the map service. Throws if anything is not from the fixed tables. */
export function buildOverpassQuery(s: Search): string {
  const iso = s.region ? s.region.iso : s.market.countryIso;
  if (!ISO.test(iso)) throw new Error("Internal error: the area code is not valid.");
  const limit = Math.max(1, Math.min(DISCOVERY_LIMITS.maxResults, Math.floor(s.limit)));
  const areaKey = s.region ? "ISO3166-2" : "ISO3166-1";
  const lines: string[] = [];
  for (const c of s.categories) {
    for (const [k, v] of c.tags) {
      if (!WORD.test(k) || !WORD.test(v)) throw new Error("Internal error: a category tag is not valid.");
      lines.push(`  nwr["${k}"="${v}"]["name"](area.a);`);
    }
  }
  if (lines.length === 0) throw new Error("No category was chosen.");
  return [`[out:json][timeout:${DISCOVERY_LIMITS.serverTimeoutSeconds}];`, `area["${areaKey}"="${iso}"]->.a;`, "(", ...lines, ");", `out center tags ${limit};`].join("\n");
}

interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

const ARABIC = /[؀-ۿ]/;

function addressOf(t: Record<string, string>): string {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return [street, t["addr:suburb"], t["addr:city"], t["addr:postcode"]].filter(Boolean).join(", ");
}

/** Map-service answer to leads. Places without a name are skipped; a social-media page is not counted as a website. */
export function parseOverpass(json: unknown, search: Pick<Search, "market" | "region" | "limit">, nowIso: string): Lead[] {
  const elements = (json as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error("The map service answered in a form that was not understood.");
  const out: Lead[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const type = typeof el.type === "string" && /^(node|way|relation)$/.test(el.type) ? el.type : null;
    if (!type || typeof el.id !== "number") continue;
    const sourceId = `${type}/${el.id}`;
    if (seen.has(sourceId)) continue;
    const nameEn = cleanText(tags["name:en"], 200);
    const nameAny = cleanText(tags["name"], 200);
    const name = nameEn || nameAny;
    if (!name) continue;
    const arabic = cleanText(tags["name:ar"], 200) || (ARABIC.test(nameAny) ? nameAny : "");
    const rawWebsite = tags["website"] ?? tags["contact:website"] ?? tags["url"] ?? "";
    const website = cleanUrl(rawWebsite);
    const social = website && isSocialHost(websiteHost(website));
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lon = typeof el.lon === "number" ? el.lon : el.center?.lon;
    try {
      out.push(
        makeLead(
          {
            business_name: name,
            business_name_ar: arabic === name ? "" : arabic,
            country: search.market.code,
            region: search.region?.name ?? cleanText(tags["addr:state"], 80),
            city: cleanText(tags["addr:city"], 80) || (search.region?.name ?? ""),
            category: categoryOf(tags),
            address: addressOf(tags),
            phone: tags["phone"] ?? tags["contact:phone"] ?? tags["contact:mobile"] ?? "",
            website_url: social ? "" : website,
            audit_summary: social ? `Only a social-media page is listed (${websiteHost(website)}): no website of its own.` : "",
            source: "osm",
            source_id: sourceId,
            source_url: `https://www.openstreetmap.org/${sourceId}`,
            lat,
            lon,
          },
          nowIso,
        ),
      );
      seen.add(sourceId);
    } catch {
      /* a record that cannot be made into a clean lead is skipped */
    }
    if (out.length >= search.limit) break;
  }
  return out;
}

export interface DiscoveryDeps {
  /** One POST to the map service. The real one can only ever name an address from OVERPASS_ENDPOINTS. */
  post: (url: string, body: string) => Promise<{ status: number; text: string }>;
  /** One GET of a status page (the real one can only name a status address from OVERPASS_ENDPOINTS). */
  get?: (url: string) => Promise<{ status: number; text: string }>;
  /** The service the owner chose. Default: main. */
  endpoint?: () => OverpassEndpoint;
  allowed: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How many map questions were already asked today (from the audit log, so it survives a restart). */
  usedToday: () => number;
  onRequest?: (host: string) => void;
}

export class DiscoveryClient {
  private readonly cache = new Map<string, { at: number; leads: Lead[] }>();
  private lastAt = 0;
  private readonly healthBy = new Map<EndpointId, EndpointHealth>();

  constructor(private readonly d: DiscoveryDeps) {}

  private ep(): OverpassEndpoint {
    return this.d.endpoint?.() ?? OVERPASS_ENDPOINTS[DEFAULT_ENDPOINT];
  }
  health(): EndpointHealth[] {
    return [...this.healthBy.values()];
  }
  private note(h: Omit<EndpointHealth, "at">): void {
    this.healthBy.set(h.endpoint, { ...h, at: new Date(this.d.now()).toISOString() });
  }

  /**
   * ONE read-only GET of the chosen service's status page: is it reachable at all? It needs the same switch, counts as one map request against the
   * owner's allowance and the daily limit (it is a request to the same host), and is never retried.
   */
  async statusCheck(): Promise<EndpointHealth> {
    if (!this.d.allowed()) throw new ExternalDisabledError();
    if (this.d.usedToday() >= DISCOVERY_LIMITS.maxQueriesPerDay) throw new DiscoveryLimitError(`The daily limit of ${DISCOVERY_LIMITS.maxQueriesPerDay} map requests was reached. Try again tomorrow.`);
    const ep = this.ep();
    this.d.onRequest?.(ep.host);
    const t0 = this.d.now();
    try {
      const res = await (this.d.get ?? overpassGetStatus)(ep.status);
      const detail = res.text.replace(/[^\x20-\x7e\n]/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6).join(" | ").slice(0, 400);
      this.note({ endpoint: ep.id, kind: "status", ok: res.status >= 200 && res.status < 300, httpStatus: res.status, ms: this.d.now() - t0, reason: res.status >= 200 && res.status < 300 ? "" : `status ${res.status}`, detail });
    } catch (e) {
      this.note({ endpoint: ep.id, kind: "status", ok: false, httpStatus: null, ms: this.d.now() - t0, reason: reachReason(e, MAP_TIMEOUTS.statusMs) || "the request failed", detail: "" });
    }
    return this.healthBy.get(ep.id)!;
  }

  async find(search: Search): Promise<{ leads: Lead[]; fromCache: boolean }> {
    if (!this.d.allowed()) throw new ExternalDisabledError();
    const query = buildOverpassQuery(search);
    const ep = this.ep();
    const cacheKey = `${ep.id}\n${query}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.d.now() - hit.at < DISCOVERY_LIMITS.cacheMs) return { leads: hit.leads.map((l) => ({ ...l })), fromCache: true };
    if (this.d.usedToday() >= DISCOVERY_LIMITS.maxQueriesPerDay) throw new DiscoveryLimitError(`The daily limit of ${DISCOVERY_LIMITS.maxQueriesPerDay} map searches was reached. Try again tomorrow.`);
    const wait = this.lastAt + DISCOVERY_LIMITS.minGapMs - this.d.now();
    if (this.lastAt > 0 && wait > 0) await this.d.sleep(wait);
    this.lastAt = this.d.now();
    this.d.onRequest?.(ep.host);
    let res: { status: number; text: string };
    const t0 = this.d.now();
    try {
      res = await this.d.post(ep.interpreter, `data=${encodeURIComponent(query)}`);
    } catch (e) {
      this.note({ endpoint: ep.id, kind: "search", ok: false, httpStatus: null, ms: this.d.now() - t0, reason: reachReason(e, MAP_TIMEOUTS.searchMs) || "the request failed", detail: "" });
      const why = reachReason(e, MAP_TIMEOUTS.searchMs);
      throw new Error(`Could not reach the map service${why ? ` (${why})` : ""}. Check the internet connection and try again.`);
    }
    this.note({ endpoint: ep.id, kind: "search", ok: res.status >= 200 && res.status < 300, httpStatus: res.status, ms: this.d.now() - t0, reason: res.status >= 200 && res.status < 300 ? "" : `status ${res.status}`, detail: "" });
    if (res.status === 429) throw new DiscoveryLimitError("The map service is busy and asked us to slow down. Try again later.");
    if (res.status < 200 || res.status >= 300) throw new Error(`The map service did not answer properly (status ${res.status}).`);
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error("The map service answered in a form that was not understood.");
    }
    const remark = (json as { remark?: unknown } | null)?.remark;
    if (typeof remark === "string" && /timed out|out of memory|runtime error/i.test(remark)) throw new Error("The map service could not finish the search in time. Try a smaller area or one category.");
    const leads = parseOverpass(json, search, new Date(this.d.now()).toISOString());
    this.cache.set(cacheKey, { at: this.d.now(), leads });
    return { leads: leads.map((l) => ({ ...l })), fromCache: false };
  }
}

/** The real POST: one fixed address, a short timeout, a size limit, and an honest user agent. */
export async function overpassPost(url: string, body: string): Promise<{ status: number; text: string }> {
  if (!Object.values(OVERPASS_ENDPOINTS).some((e) => e.interpreter === url)) throw new Error("Only the map service address is allowed.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "AIWorkforceDiscovery/1.0 (read-only business lookup)", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(MAP_TIMEOUTS.searchMs),
  });
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > DISCOVERY_LIMITS.maxResponseBytes) {
      await reader.cancel();
      throw new Error("too big");
    }
    chunks.push(value);
  }
  return { status: res.status, text: Buffer.concat(chunks).toString("utf8") };
}

/** The real status GET: only a status address from the fixed list, a short timeout, a tiny size limit. */
export async function overpassGetStatus(url: string): Promise<{ status: number; text: string }> {
  if (!Object.values(OVERPASS_ENDPOINTS).some((e) => e.status === url)) throw new Error("Only a map service status address is allowed.");
  const res = await fetch(url, { method: "GET", headers: { "user-agent": "AIWorkforceDiscovery/1.0 (read-only status check)", accept: "text/plain" }, signal: AbortSignal.timeout(MAP_TIMEOUTS.statusMs) });
  const text = (await res.text()).slice(0, 4000);
  return { status: res.status, text };
}
