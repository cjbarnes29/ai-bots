import type { AuditFailure } from "./leads.js";

/**
 * The website audit: a fixed list of checks on one business's homepage, each worth a visible number of points.
 *
 * Website content is UNTRUSTED. The page is only ever read by code with fixed patterns; it is never executed, never given to a
 * model, and nothing from it is copied into the result except numbers and the address that was parsed. Every sentence in the result
 * comes from a template in this file, so a hostile page has nothing to inject into an agent's prompt.
 *
 * "The audit could not be completed" (a failure) is a different answer from "the website is poor" (a score) and from "there is no
 * website" (no address at all). They are never mixed.
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** Only for https. */
  tls?: { authorized: boolean; validTo?: string };
  /** How long the answer took, in milliseconds. */
  ms: number;
}

export class AuditError extends Error {
  constructor(
    readonly code: AuditFailure,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when outside requests are switched off. It is never turned into an audit result: it stops the whole run. */
export class ExternalDisabledError extends Error {
  constructor() {
    super("Requests to websites are switched off. The owner has to switch them on first.");
  }
}

/** Fetches one address, once (no redirects followed). Throws AuditError. The real one is in netfetch.ts; tests use a fake. */
export type Fetcher = (url: URL) => Promise<HttpResponse>;

export interface AuditDeps {
  fetch: Fetcher;
  now: () => number;
}

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export interface Finding {
  id: string;
  label: string;
  status: CheckStatus;
  weight: number;
  earned: number;
  note: string;
}

export type AuditOutcome =
  | {
      state: "audited";
      url: string;
      finalUrl: string;
      score: number;
      /** "low" when much of the page could not be judged (for example it is built by JavaScript). */
      confidence: "normal" | "low";
      placeholder: boolean;
      /** How many of the 100 points could be judged. */
      coverage: number;
      findings: Finding[];
      summary: string;
    }
  | { state: "failed"; url: string; failure: AuditFailure; detail: string };

export const AUDIT_WEIGHTS = { https: 15, certificate: 10, mobile: 15, title: 5, description: 5, freshness: 10, speed: 10, contact: 15, markup: 10, language: 5 } as const;

const MAX_HOPS = 3;
const MAX_ANALYSED_CHARS = 600_000;
const DAY_MS = 86_400_000;

const FAILURE_TEXT: Record<AuditFailure, string> = {
  dns_failed: "The website name could not be found.",
  timed_out: "The website took too long to answer.",
  connection_failed: "Could not connect to the website.",
  tls_certificate_invalid: "The website's security certificate is not valid, and it has no working plain http version.",
  http_error: "The website answered with an error instead of a page.",
  not_a_web_page: "The address does not lead to a web page.",
  too_large: "The page is larger than the limit.",
  blocked_address: "The address is not a public website (it points at a private or reserved network).",
  bad_address: "The address is not a valid website address.",
  redirect_loop: "The website redirected too many times.",
  limit_reached: "The daily limit for website checks was reached.",
};
export const failureText = (f: AuditFailure): string => FAILURE_TEXT[f];

// ----------------------------------------------------------------------------------------------------- reading the page

const entity = (s: string) =>
  s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&copy;|&#169;|&#xa9;/gi, "©");

const stripToText = (html: string): string =>
  entity(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

const metaByName = (html: string, name: string): string | null => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(m[0], "name")?.toLowerCase() === name) return attr(m[0], "content") ?? "";
  }
  return null;
};

const PLACEHOLDER =
  /(domain (name )?(is |may be )?for sale|buy this domain|this domain (is )?(parked|for sale|may be for sale)|parked (free|domain|by)|website (is )?(coming soon|under construction)|(site|page) (is )?under construction|coming soon|default web ?site page|welcome to nginx|apache2? (ubuntu )?default page|it works!|index of \/|account suspended|future home of)/i;

const PHONE = /(\+?971[\s-]?\(?0?\)?[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}|\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b)/;
const CONTACT_LINK = /href\s*=\s*["']\s*(tel:|mailto:|https?:\/\/(wa\.me|api\.whatsapp\.com|wa\.link)\b)/i;
const OLD_MARKUP = /<(font|marquee|blink|frameset|frame|applet|bgsound)\b|\.swf\b/i;

interface Signals {
  titleLen: number | null;
  descLen: number | null;
  viewport: "good" | "other" | "none";
  lang: boolean;
  visibleChars: number;
  jsBuilt: boolean;
  copyrightYear: number | null;
  contact: boolean;
  oldMarkup: boolean;
  tableLayout: boolean;
  placeholder: boolean;
}

function readSignals(htmlIn: string): Signals {
  const html = htmlIn.slice(0, MAX_ANALYSED_CHARS);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = title ? entity(title[1]!).replace(/\s+/g, " ").trim() : "";
  const desc = metaByName(html, "description");
  const viewport = metaByName(html, "viewport");
  const text = stripToText(html);
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const jsBuilt = text.length < 300 && (/<noscript\b/i.test(html) || scripts >= 3 || /<div[^>]+id\s*=\s*["'](app|root|__next|__nuxt)["']/i.test(html));
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\(c\))?\s*(?:(?:19|20)\d{2}\s*[-–—]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  return {
    titleLen: titleText ? titleText.length : null,
    descLen: desc === null ? null : desc.trim().length,
    viewport: viewport === null ? "none" : /width\s*=\s*device-width/i.test(viewport) ? "good" : "other",
    lang: /<html\b[^>]*\slang\s*=\s*["']?[a-z]{2}/i.test(html),
    visibleChars: text.length,
    jsBuilt,
    copyrightYear: years.length ? Math.max(...years) : null,
    contact: CONTACT_LINK.test(html) || PHONE.test(text),
    oldMarkup: OLD_MARKUP.test(html),
    tableLayout: (html.match(/<table\b/gi) ?? []).length >= 6 && (html.match(/<div\b/gi) ?? []).length <= 2,
    placeholder: PLACEHOLDER.test(text.slice(0, 3000)) || (text.length < 80 && !jsBuilt),
  };
}

// ----------------------------------------------------------------------------------------------------- the checks

const f = (id: string, label: string, status: CheckStatus, weight: number, earned: number, note: string): Finding => ({ id, label, status, weight, earned: status === "unknown" ? 0 : earned, note });

interface Context {
  startedHttps: boolean;
  finalUrl: URL;
  tlsAuthorized: boolean | null;
  tlsValidTo: string | null;
  httpsBroken: boolean;
  ms: number;
  bytes: number;
  year: number;
  nowMs: number;
}

export function runChecks(s: Signals, c: Context): Finding[] {
  const W = AUDIT_WEIGHTS;
  const out: Finding[] = [];

  const https = c.finalUrl.protocol === "https:";
  out.push(
    https
      ? f("https", "Secure connection (HTTPS)", "pass", W.https, W.https, "The site is served over HTTPS.")
      : f("https", "Secure connection (HTTPS)", "fail", W.https, 0, c.httpsBroken ? "HTTPS is broken, so visitors see a browser warning or the plain version." : "The site is only served over plain http, so browsers mark it \"not secure\"."),
  );

  if (c.tlsAuthorized === null) out.push(f("certificate", "Security certificate", "unknown", W.certificate, 0, "Not applicable: the site has no HTTPS to check."));
  else if (!c.tlsAuthorized) out.push(f("certificate", "Security certificate", "fail", W.certificate, 0, "The security certificate is not valid."));
  else {
    const days = c.tlsValidTo ? Math.floor((Date.parse(c.tlsValidTo) - c.nowMs) / DAY_MS) : null;
    if (days !== null && Number.isFinite(days) && days < 14) out.push(f("certificate", "Security certificate", "warn", W.certificate, Math.round(W.certificate / 2), `The certificate expires in ${Math.max(days, 0)} day(s).`));
    else out.push(f("certificate", "Security certificate", "pass", W.certificate, W.certificate, "The certificate is valid."));
  }

  out.push(
    s.viewport === "good"
      ? f("mobile", "Works on phones", "pass", W.mobile, W.mobile, "The page declares a phone-friendly layout.")
      : s.viewport === "other"
        ? f("mobile", "Works on phones", "warn", W.mobile, Math.round(W.mobile / 2), "The page has a viewport setting, but not the standard phone-friendly one.")
        : f("mobile", "Works on phones", "fail", W.mobile, 0, "The page does not declare a phone-friendly layout, so it likely looks tiny on a phone."),
  );

  out.push(
    s.titleLen === null
      ? f("title", "Page title", "fail", W.title, 0, "The page has no title, so search results show nothing useful.")
      : s.titleLen >= 10 && s.titleLen <= 70
        ? f("title", "Page title", "pass", W.title, W.title, `The title is ${s.titleLen} characters.`)
        : f("title", "Page title", "warn", W.title, 2, `The title is ${s.titleLen} characters (10 to 70 works best).`),
  );

  out.push(
    s.descLen === null || s.descLen === 0
      ? f("description", "Search description", "fail", W.description, 0, "The page has no search description.")
      : s.descLen >= 50 && s.descLen <= 170
        ? f("description", "Search description", "pass", W.description, W.description, `The description is ${s.descLen} characters.`)
        : f("description", "Search description", "warn", W.description, 2, `The description is ${s.descLen} characters (50 to 170 works best).`),
  );

  if (s.copyrightYear === null || s.jsBuilt) out.push(f("freshness", "Looks up to date", "unknown", W.freshness, 0, s.jsBuilt ? "Could not judge: the content is built by JavaScript." : "No copyright year was found to judge by."));
  else if (s.copyrightYear >= c.year - 1) out.push(f("freshness", "Looks up to date", "pass", W.freshness, W.freshness, `The copyright year is ${s.copyrightYear}.`));
  else if (s.copyrightYear >= c.year - 3) out.push(f("freshness", "Looks up to date", "warn", W.freshness, 5, `The copyright year is ${s.copyrightYear}, a few years old.`));
  else out.push(f("freshness", "Looks up to date", "fail", W.freshness, 0, `The copyright year is ${s.copyrightYear}, which suggests the site is not maintained.`));

  out.push(
    c.ms <= 1500 && c.bytes <= 300_000
      ? f("speed", "Loads quickly", "pass", W.speed, W.speed, `The page answered in ${c.ms} ms and is ${Math.round(c.bytes / 1000)} KB.`)
      : c.ms <= 4000 && c.bytes <= 800_000
        ? f("speed", "Loads quickly", "warn", W.speed, 5, `The page answered in ${c.ms} ms and is ${Math.round(c.bytes / 1000)} KB.`)
        : f("speed", "Loads quickly", "fail", W.speed, 0, `The page is slow or heavy (${c.ms} ms, ${Math.round(c.bytes / 1000)} KB).`),
  );

  if (s.jsBuilt && !s.contact) out.push(f("contact", "Easy to contact", "unknown", W.contact, 0, "Could not judge: the content is built by JavaScript."));
  else out.push(s.contact ? f("contact", "Easy to contact", "pass", W.contact, W.contact, "A phone number, email or WhatsApp link is visible.") : f("contact", "Easy to contact", "fail", W.contact, 0, "No phone number, email or WhatsApp link was found on the page."));

  if (s.jsBuilt) out.push(f("markup", "Modern page build", "unknown", W.markup, 0, "Could not judge: the content is built by JavaScript."));
  else if (s.oldMarkup) out.push(f("markup", "Modern page build", "fail", W.markup, 0, "The page uses outdated technology (for example Flash, frames or font tags)."));
  else if (s.tableLayout) out.push(f("markup", "Modern page build", "warn", W.markup, 5, "The page layout looks table-based, an old way of building sites."));
  else out.push(f("markup", "Modern page build", "pass", W.markup, W.markup, "No outdated technology was found."));

  out.push(s.lang ? f("language", "Language declared", "pass", W.language, W.language, "The page declares its language.") : f("language", "Language declared", "warn", W.language, 2, "The page does not declare its language."));

  return out;
}

const SUMMARY_ORDER = ["https", "certificate", "mobile", "contact", "freshness", "markup", "speed", "title", "description", "language"];

function summarise(findings: Finding[], placeholder: boolean, low: boolean): string {
  if (placeholder) return "Placeholder or parked page: there is no real website yet.";
  const bad = SUMMARY_ORDER.map((id) => findings.find((x) => x.id === id)).filter((x): x is Finding => !!x && (x.status === "fail" || x.status === "warn"));
  const head = bad.length === 0 ? "No problems found in the checks that could be made." : `Problems: ${bad.slice(0, 5).map((x) => x.label.toLowerCase()).join("; ")}.`;
  return low ? `${head} Low confidence: part of the page could not be judged.` : head;
}

// ----------------------------------------------------------------------------------------------------- the audit

const isTlsFailure = (e: unknown) => e instanceof AuditError && e.code === "tls_certificate_invalid";

/** Follows up to three redirects, one checked request at a time. */
async function load(start: URL, deps: AuditDeps): Promise<{ res: HttpResponse; final: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await deps.fetch(current);
    const location = typeof res.headers["location"] === "string" ? res.headers["location"] : null;
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        current = new URL(location, current);
      } catch {
        throw new AuditError("http_error", "The website sent a broken redirect.");
      }
      continue;
    }
    return { res, final: current };
  }
  throw new AuditError("redirect_loop", FAILURE_TEXT.redirect_loop);
}

export async function auditSite(rawUrl: string, deps: AuditDeps): Promise<AuditOutcome> {
  let start: URL;
  try {
    start = new URL(rawUrl);
    if (start.protocol !== "https:" && start.protocol !== "http:") throw new Error("scheme");
  } catch {
    return { state: "failed", url: rawUrl, failure: "bad_address", detail: FAILURE_TEXT.bad_address };
  }

  let httpsBroken = false;
  let loaded: { res: HttpResponse; final: URL };
  try {
    loaded = await load(start, deps);
  } catch (first) {
    if (first instanceof ExternalDisabledError) throw first;
    // A broken certificate does not mean the site does not exist: try the plain version once, and report both facts.
    if (start.protocol === "https:" && (isTlsFailure(first) || (first instanceof AuditError && first.code === "connection_failed"))) {
      const plain = new URL(start.toString());
      plain.protocol = "http:";
      try {
        loaded = await load(plain, deps);
        httpsBroken = true;
      } catch (second) {
        if (second instanceof ExternalDisabledError) throw second;
        const e = isTlsFailure(first) ? first : second;
        const code = e instanceof AuditError ? e.code : "connection_failed";
        return { state: "failed", url: rawUrl, failure: code, detail: FAILURE_TEXT[code] };
      }
    } else {
      const code = first instanceof AuditError ? first.code : "connection_failed";
      return { state: "failed", url: rawUrl, failure: code, detail: FAILURE_TEXT[code] };
    }
  }

  const { res, final } = loaded;
  if (res.status >= 400 || res.status < 200 || res.status >= 300) return { state: "failed", url: rawUrl, failure: "http_error", detail: `${FAILURE_TEXT.http_error} (status ${res.status})` };
  const type = String(res.headers["content-type"] ?? "").toLowerCase();
  if (!/text\/html|application\/xhtml/.test(type)) return { state: "failed", url: rawUrl, failure: "not_a_web_page", detail: FAILURE_TEXT.not_a_web_page };

  const signals = readSignals(res.body.toString("utf8"));
  const nowMs = deps.now();
  const findings = runChecks(signals, {
    startedHttps: start.protocol === "https:",
    finalUrl: final,
    tlsAuthorized: httpsBroken ? false : final.protocol === "https:" ? (res.tls ? res.tls.authorized : true) : null,
    tlsValidTo: res.tls?.validTo ?? null,
    httpsBroken,
    ms: res.ms,
    bytes: res.body.length,
    year: new Date(nowMs).getUTCFullYear(),
    nowMs,
  });
  const coverage = findings.filter((x) => x.status !== "unknown").reduce((n, x) => n + x.weight, 0);
  const earned = findings.filter((x) => x.status !== "unknown").reduce((n, x) => n + x.earned, 0);
  const placeholder = signals.placeholder;
  const score = placeholder ? 0 : coverage === 0 ? 0 : Math.round((100 * earned) / coverage);
  const low = coverage < 60 || signals.jsBuilt;
  return {
    state: "audited",
    url: rawUrl,
    finalUrl: final.toString(),
    score,
    confidence: low ? "low" : "normal",
    placeholder,
    coverage,
    findings,
    summary: summarise(findings, placeholder, low && !placeholder),
  };
}
