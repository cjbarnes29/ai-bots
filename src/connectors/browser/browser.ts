import { z } from "zod";
import type { ConnectorDefinition } from "../types.js";
import { fetchPublicPage, type FetchDeps, type Page } from "./fetcher.js";
import { BlockedAddressError, parseTarget } from "./netguard.js";

/**
 * The browser connector (Phase 8): public web pages over HTTPS, reached through the approval gate.
 *
 * - read_page is a READ: it only works for a bot whose Browser read permission the owner switched on.
 * - submit_form is a WRITE: it always waits for the owner's approval and shows the exact address and fields.
 *
 * It is a safe page reader, not a full browser: it does not run scripts, keep cookies or log in, so it cannot "click" through
 * a site that needs JavaScript. Network rules (public https only, no private networks, no local files) are in netguard.ts and
 * apply to every request and every redirect.
 */
const MAX_TEXT_CHARS = 6000;
const MAX_LINKS = 15;
const MAX_FIELDS = 20;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text);
const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const squash = (s: string) => decode(s).replace(/\s+/g, " ").trim();

const addressArg = z.string().max(2000).superRefine((value, ctx) => {
  try {
    parseTarget(value);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: e instanceof BlockedAddressError ? e.message : "not an allowed web address" });
  }
});

/** Reduces a page to readable text plus a few absolute https links. Scripts and styles are dropped. */
export function summarisePage(page: Page): string {
  const isHtml = /html|xml/i.test(page.contentType);
  let text = page.text;
  let title = "";
  const links: string[] = [];
  if (isHtml) {
    title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] ?? "");
    for (const m of text.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (links.length >= MAX_LINKS) break;
      try {
        const abs = new URL(decode(m[1]!), page.finalUrl);
        if (abs.protocol === "https:") links.push(`${clip(squash(m[2]!.replace(/<[^>]+>/g, " ")), 60) || "(no text)"} -> ${clip(abs.toString(), 200)}`);
      } catch {
        /* skip broken links */
      }
    }
    text = text.replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  }
  const body = clip(squash(text), MAX_TEXT_CHARS);
  return [`URL: ${page.finalUrl}`, `Status: ${page.status}`, title ? `Title: ${clip(title, 200)}` : "", "", body || "(no text on the page)", links.length ? `\nLinks:\n${links.join("\n")}` : ""]
    .filter((l, i) => l !== "" || i === 3)
    .join("\n");
}

export function createBrowserConnector(deps: FetchDeps = {}): ConnectorDefinition {
  return {
    id: "browser",
    label: "Browser",
    actions: {
      read_page: {
        kind: "read",
        description: "Read a public web page (https only): its text and a few links. No logins, no scripts. Private networks are blocked",
        args: z.strictObject({ url: addressArg }),
        summarize: (a) => `Read the web page ${clip(String(a["url"]), 150)}`,
        execute: async (a) => summarisePage(await fetchPublicPage(String(a["url"]), {}, deps)),
      },
      submit_form: {
        kind: "write",
        description: `Submit form fields to a public https address (POST). The owner sees the exact address and every field first (up to ${MAX_FIELDS} fields)`,
        args: z.strictObject({
          url: addressArg,
          fields: z.record(z.string().regex(/^[A-Za-z0-9_.\-[\]]{1,60}$/, "field names are letters, numbers and _-.[]"), z.string().max(2000)).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= MAX_FIELDS, `between 1 and ${MAX_FIELDS} fields`),
        }),
        summarize: (a) => `Submit ${Object.keys(a["fields"] as object).length} form field(s) to ${clip(String(a["url"]), 150)}`,
        execute: async (a) => {
          const page = await fetchPublicPage(String(a["url"]), { method: "POST", formBody: new URLSearchParams(a["fields"] as Record<string, string>).toString() }, deps);
          if (page.redirectedNotFollowed) return `The website answered with status ${page.status} and a redirect to ${clip(page.redirectedNotFollowed, 200)} (not followed).`;
          return `The website answered with status ${page.status}.\n${clip(squash(page.text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")), 1500)}`;
        },
      },
    },
  };
}
