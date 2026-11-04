import { createHash } from "node:crypto";
import { parseCsv, toCsv, type Cell } from "./csv.js";

/**
 * The lead record: one business, kept as one row of a CSV/Excel file (no database).
 *
 * The website fields keep three different situations APART, because they mean different things and must never be mixed up:
 *   - none_listed    the source lists no website. This is NOT proof there is none: it must be checked by a person.
 *   - confirmed_none the owner confirmed there really is no website.
 *   - not_audited    a website address exists but nobody has looked at it yet.
 *   - audited        the website was reached and assessed (see audit_score and audit_summary).
 *   - audit_failed   a website address exists but the check could not be completed (see audit_failure). This says nothing about quality.
 */
export const LEAD_STATUSES = ["new", "reviewing", "qualified", "proposal_drafted", "contacted", "won", "lost", "discarded"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const WEBSITE_STATES = ["none_listed", "confirmed_none", "not_audited", "audited", "audit_failed"] as const;
export type WebsiteState = (typeof WEBSITE_STATES)[number];

export const AUDIT_FAILURES = [
  "dns_failed",
  "timed_out",
  "connection_failed",
  "tls_certificate_invalid",
  "http_error",
  "not_a_web_page",
  "too_large",
  "blocked_address",
  "bad_address",
  "redirect_loop",
  "limit_reached",
] as const;
export type AuditFailure = (typeof AUDIT_FAILURES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Lead {
  lead_id: string;
  country: string;
  region: string;
  city: string;
  category: string;
  business_name: string;
  business_name_ar: string;
  address: string;
  phone: string;
  website_url: string;
  website_state: WebsiteState;
  audit_failure: AuditFailure | "";
  audit_score: number | null;
  audit_confidence: "normal" | "low" | "";
  audit_summary: string;
  lead_score: number | null;
  priority: Priority | "";
  score_breakdown: string;
  score_reasons: string;
  source: string;
  source_id: string;
  source_url: string;
  lat: number | null;
  lon: number | null;
  found_at: string;
  updated_at: string;
  status: LeadStatus;
  notes: string;
}

export const LEAD_COLUMNS = [
  "lead_id", "country", "region", "city", "category", "business_name", "business_name_ar", "address", "phone", "website_url", "website_state",
  "audit_failure", "audit_score", "audit_confidence", "audit_summary", "lead_score", "priority", "score_breakdown", "score_reasons", "source",
  "source_id", "source_url", "lat", "lon", "found_at", "updated_at", "status", "notes",
] as const satisfies readonly (keyof Lead)[];

/** Only the owner changes these. A new scan never overwrites them. */
export const OWNER_FIELDS = ["status", "notes"] as const;

export const FIELD_LIMITS = { name: 200, address: 300, url: 300, phone: 40, short: 80, summary: 500, breakdown: 600, reasons: 800, notes: 1000 };

/**
 * Text that came from the outside (map data, website pages) is cleaned before it is stored or shown to an agent: control characters
 * are removed, spaces collapsed, and BACKTICKS are removed so a page can never smuggle in a fenced "action" block.
 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const SOCIAL_HOSTS = ["facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "youtube.com", "wa.me", "linktr.ee", "t.me", "snapchat.com", "wa.link"];

/** http(s) address only. Anything else becomes "". A bare "www.example.ae" gets https:// added. */
export function cleanUrl(raw: unknown): string {
  const t = cleanText(raw, FIELD_LIMITS.url);
  if (!t) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".") || u.username || u.password) return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function websiteHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A Facebook or Instagram page is not a website of the business's own. */
export const isSocialHost = (host: string): boolean => SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));

const COMPANY_WORDS = new Set(["llc", "l.l.c", "fze", "fzco", "fz", "est", "establishment", "trading", "co", "company", "ltd", "limited", "the", "and", "&", "group"]);

export function normalizeName(name: string): string {
  // Full stops are dropped first so "L.L.C." becomes "llc" (one word), then other punctuation becomes a space.
  const cleaned = name.normalize("NFKC").toLowerCase().replace(/\./g, "").replace(/[,'"()/\\-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.split(" ").filter((w) => w && !COMPANY_WORDS.has(w)).join(" ");
}

export function phoneDigits(phone: string, countryPrefix = "+971"): string {
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  const prefixDigits = countryPrefix.replace(/\D/g, "");
  d = d.replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 8) d = `${prefixDigits}${d.slice(1)}`;
  return d.length >= 7 ? d : "";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A stable id: the same place from the same source always gets the same id, so a rescan updates instead of duplicating. */
export function leadIdFor(source: string, sourceId: string, fallbackName = "", fallbackWhere = ""): string {
  const basis = sourceId ? `${source}:${sourceId}` : `${source}:${normalizeName(fallbackName)}|${fallbackWhere.toLowerCase()}`;
  return `L-${sha(basis).slice(0, 12)}`;
}

export const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s);

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Builds a clean lead from loose input. Every text field is cleaned and limited; unknown words fall back to safe defaults. */
export function makeLead(input: Partial<Record<keyof Lead, unknown>> & { business_name: unknown }, nowIso: string): Lead {
  const name = cleanText(input.business_name, FIELD_LIMITS.name);
  if (!name) throw new Error("A lead needs a business name.");
  const website = cleanUrl(input.website_url);
  const source = cleanText(input.source, 20) || "manual";
  const sourceId = cleanText(input.source_id, FIELD_LIMITS.short);
  const address = cleanText(input.address, FIELD_LIMITS.address);
  const requested = oneOf(WEBSITE_STATES, input.website_state, website ? "not_audited" : "none_listed");
  // A state that needs a website address cannot exist without one, and the other way round.
  const state: WebsiteState = website ? (requested === "none_listed" || requested === "confirmed_none" ? "not_audited" : requested) : requested === "confirmed_none" ? "confirmed_none" : "none_listed";
  return {
    lead_id: cleanText(input.lead_id, 40) || leadIdFor(source, sourceId, name, address),
    country: cleanText(input.country, 4).toUpperCase() || "AE",
    region: cleanText(input.region, FIELD_LIMITS.short),
    city: cleanText(input.city, FIELD_LIMITS.short),
    category: cleanText(input.category, FIELD_LIMITS.short) || "other",
    business_name: name,
    business_name_ar: cleanText(input.business_name_ar, FIELD_LIMITS.name),
    address,
    phone: cleanText(input.phone, FIELD_LIMITS.phone),
    website_url: website,
    website_state: state,
    audit_failure: state === "audit_failed" ? oneOf(AUDIT_FAILURES, input.audit_failure, "connection_failed") : "",
    audit_score: state === "audited" ? num(input.audit_score, 0, 100) : null,
    audit_confidence: state === "audited" ? oneOf(["normal", "low"] as const, input.audit_confidence, "normal") : "",
    audit_summary: cleanText(input.audit_summary, FIELD_LIMITS.summary),
    lead_score: num(input.lead_score, 0, 100),
    priority: input.lead_score === null || input.lead_score === undefined || input.lead_score === "" ? "" : oneOf(PRIORITIES, input.priority, "low"),
    score_breakdown: cleanText(input.score_breakdown, FIELD_LIMITS.breakdown),
    score_reasons: cleanText(input.score_reasons, FIELD_LIMITS.reasons),
    source,
    source_id: sourceId,
    source_url: cleanUrl(input.source_url),
    lat: num(input.lat, -90, 90),
    lon: num(input.lon, -180, 180),
    found_at: typeof input.found_at === "string" && isIso(input.found_at) ? input.found_at : nowIso,
    updated_at: typeof input.updated_at === "string" && isIso(input.updated_at) ? input.updated_at : nowIso,
    status: oneOf(LEAD_STATUSES, input.status, "new"),
    notes: cleanText(input.notes, FIELD_LIMITS.notes),
  };
}

/** The things two records share when they are the same business seen twice. */
export function duplicateKeys(l: Lead, phonePrefix = "+971"): string[] {
  const keys: string[] = [];
  const host = websiteHost(l.website_url);
  if (host && !isSocialHost(host)) keys.push(`site:${host}`);
  const tel = phoneDigits(l.phone, phonePrefix);
  if (tel) keys.push(`tel:${tel}`);
  const name = normalizeName(l.business_name);
  if (name) keys.push(`name:${name}|${l.city.toLowerCase()}`);
  return keys;
}

export interface MergeResult {
  rows: Lead[];
  added: number;
  updated: number;
  duplicates: { name: string; matchedId: string; reason: "same_id" | "same_website" | "same_phone" | "same_name_and_city" }[];
}

const reasonOf = (key: string): MergeResult["duplicates"][number]["reason"] => (key.startsWith("site:") ? "same_website" : key.startsWith("tel:") ? "same_phone" : "same_name_and_city");

/**
 * Adds new leads to the existing ones without creating duplicates.
 * - Same id: the machine-found fields are refreshed; the owner's status and notes, and a confirmed "no website", are kept.
 * - Same website, phone, or name in the same city: counted as a duplicate and NOT added.
 */
export function mergeLeads(existing: Lead[], incoming: Lead[], nowIso: string): MergeResult {
  const rows = existing.map((l) => ({ ...l }));
  const byId = new Map(rows.map((l) => [l.lead_id, l]));
  const byKey = new Map<string, string>();
  for (const l of rows) for (const k of duplicateKeys(l)) if (!byKey.has(k)) byKey.set(k, l.lead_id);
  let added = 0;
  let updated = 0;
  const duplicates: MergeResult["duplicates"] = [];
  for (const raw of incoming) {
    const cur = byId.get(raw.lead_id);
    if (cur) {
      const keepNone = cur.website_state === "confirmed_none" && !raw.website_url;
      // A fresh discovery scan knows nothing about the website. It must not wipe an audit that was already done for the same address.
      const keepAudit = (cur.website_state === "audited" || cur.website_state === "audit_failed") && raw.website_state === "not_audited" && raw.website_url === cur.website_url;
      const audit = keepAudit
        ? {
            website_state: cur.website_state,
            audit_failure: cur.audit_failure,
            audit_score: cur.audit_score,
            audit_confidence: cur.audit_confidence,
            audit_summary: cur.audit_summary,
            lead_score: cur.lead_score,
            priority: cur.priority,
            score_breakdown: cur.score_breakdown,
            score_reasons: cur.score_reasons,
          }
        : {};
      const keep = { status: cur.status, notes: cur.notes, found_at: cur.found_at };
      Object.assign(cur, raw, audit, keep, { updated_at: nowIso });
      if (keepNone) cur.website_state = "confirmed_none";
      updated++;
      continue;
    }
    const hitKey = duplicateKeys(raw).find((k) => byKey.has(k));
    if (hitKey) {
      duplicates.push({ name: raw.business_name, matchedId: byKey.get(hitKey)!, reason: reasonOf(hitKey) });
      continue;
    }
    const fresh = { ...raw };
    rows.push(fresh);
    byId.set(fresh.lead_id, fresh);
    for (const k of duplicateKeys(fresh)) if (!byKey.has(k)) byKey.set(k, fresh.lead_id);
    added++;
  }
  return { rows, added, updated, duplicates };
}

/** Canonical text of the rows: the same rows always give the same text, whatever order their fields were built in. */
export function canonicalRows(rows: Lead[]): string {
  return JSON.stringify(rows.map((l) => LEAD_COLUMNS.map((c) => l[c])));
}
export const rowsHash = (rows: Lead[]): string => sha(canonicalRows(rows));

export function leadsToCsv(rows: Lead[]): string {
  return toCsv([...LEAD_COLUMNS], rows.map((l) => LEAD_COLUMNS.map((c): Cell => l[c] as Cell)));
}

/** Reads a leads file. Rows that cannot be understood are counted and skipped, never guessed at. */
export function leadsFromCsv(text: string, nowIso: string): { rows: Lead[]; skipped: number } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0 };
  const header = table[0]!;
  const rows: Lead[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const raw: Record<string, unknown> = {};
    header.forEach((h, i) => {
      raw[h] = cells[i] ?? "";
    });
    try {
      rows.push(makeLead(raw as Parameters<typeof makeLead>[0], nowIso));
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}
