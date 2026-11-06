/**
 * Independent task-result verification (M4).
 *
 * An agent's reply is its own words. This module never trusts them: it compares what the reply CLAIMS with what the platform itself recorded
 * (approval requests and their outcomes, files that really exist with the size the action reported). It only reads; it cannot approve, run, retry
 * or change anything, and it never uses a model, so a result can not talk its way into "verified".
 *
 *   verified      at least one independent piece of evidence confirmed, nothing contradicted, nothing waiting
 *   unverified    the task finished but there is nothing the platform can check (a text answer): the words are the agent's, not confirmed
 *   waiting       an outside action is still waiting for the owner's approval; nothing is confirmed yet
 *   contradicted  the reply claims something the record does not support, an action failed, or a file the action reported is missing
 *   not_applicable the task did not finish with a result (failed, cancelled, still running)
 */
export type VerificationStatus = "verified" | "unverified" | "waiting" | "contradicted" | "not_applicable";

export interface TaskFact {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result: string | null;
}
export interface ActionFact {
  id: string;
  taskId: string | null;
  connector: string;
  action: string;
  status: "pending" | "approved" | "executed" | "failed" | "denied" | "expired";
  result: string | null;
  error: string | null;
  summary: string;
}
export type FileProbe = (absPath: string) => { state: "ok"; size: number } | { state: "missing" } | { state: "unreadable"; reason: string };

export interface Check {
  kind: "result_present" | "action_executed" | "action_failed" | "action_waiting" | "action_denied" | "file_exists" | "file_missing" | "file_size_differs" | "file_unchecked" | "claim_supported" | "claim_unsupported";
  /** "pass" = independent evidence, "fail" = contradiction, "note" = information only (never counts as evidence). */
  outcome: "pass" | "fail" | "note";
  detail: string;
}
export interface Verification {
  status: VerificationStatus;
  /** One plain sentence for the owner. */
  summary: string;
  checks: Check[];
  /** How many independent pieces of evidence were confirmed. */
  evidence: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

type ClaimKind = "send" | "save" | "publish" | "remove";
const VERB_KIND: Record<string, ClaimKind> = { sent: "send", emailed: "send", messaged: "send", saved: "save", created: "save", wrote: "save", published: "publish", posted: "publish", uploaded: "publish", submitted: "publish", deleted: "remove", renamed: "remove", scheduled: "save", booked: "save" };
/** Which connectors could honestly back each kind of claim. */
const BACKING: Record<ClaimKind, string[]> = {
  send: ["gmail", "telegram", "gworkspace"],
  save: ["documents", "pc", "gworkspace", "notion", "github", "memory", "gmail"],
  publish: ["browser", "github", "notion", "gworkspace", "telegram", "n8n", "mcp"],
  remove: ["pc", "gworkspace", "notion", "github"],
};
// "I have sent", "I've saved", "we created", "has been sent", "was published". Plain alternations only (linear time on any input).
const CLAIM = /\b(?:(?:i|we)(?:'ve|\s+have)?\s+(?:just\s+|already\s+|successfully\s+)?(sent|emailed|messaged|saved|created|wrote|published|posted|uploaded|deleted|renamed|scheduled|submitted|booked)|(?:has|have|was|were|is|are)\s+(?:now\s+|been\s+|successfully\s+)*(sent|emailed|saved|created|published|posted|uploaded|deleted|submitted))\b/gi;
const OBJECT = /\b(file|files|document|documents|spreadsheet|excel|word|pdf|csv|report|e-?mail|emails|message|messages|post|presentation|slides|draft|folder|page|issue|event|invite|invitation|note|workbook|sheet)\b/i;
const NEGATION = /(?:\bnot\b|n't\b|\bnever\b|\bunable\b|\bcannot\b|\bno\b|\bnothing\b|\bwill\b|\bwould\b|\bcould\b|\bshould\b|\bcan\b|\bto\b|\bif\b|\bonce\b)\s*(?:\w+\s+){0,2}$/i;

export interface Claim {
  verb: string;
  kind: ClaimKind;
  excerpt: string;
}
/** The completion claims in a reply that are about something OUTSIDE the chat (a file, an email, a post). Questions, plans and negations are skipped. */
export function findClaims(text: string): Claim[] {
  const out: Claim[] = [];
  const t = text.slice(0, 20_000);
  CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAIM.exec(t)) !== null) {
    const verb = (m[1] ?? m[2] ?? "").toLowerCase();
    const kind = VERB_KIND[verb];
    if (!kind) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    if (NEGATION.test(before)) continue;
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 90);
    // "sent" is always outside the chat; the rest need a thing that lives outside it ("saved the report", not "created a plan").
    if (kind !== "send" && !OBJECT.test(after) && !OBJECT.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    out.push({ verb, kind, excerpt: clip(t.slice(Math.max(0, m.index - 20), m.index + m[0].length + 60).replace(/\s+/g, " ").trim(), 140) });
    if (out.length >= 8) break;
  }
  return out;
}

const CREATED = /^Created (.+?) \(([\d,]+) bytes\)/;

export function verifyTask(task: TaskFact, actions: ActionFact[], probe: FileProbe): Verification {
  const checks: Check[] = [];
  if (task.status !== "completed") {
    return { status: "not_applicable", summary: task.status === "failed" ? "The task failed, so there is no result to verify." : task.status === "cancelled" ? "The task was cancelled." : "The task has not finished.", checks, evidence: 0 };
  }
  const full = (task.result ?? "").trim();
  // The platform appends its own record to a result. Only the agent's OWN words are scanned for claims.
  const result = full.split("--- What the platform recorded")[0]!.trim();
  if (full.length === 0) checks.push({ kind: "result_present", outcome: "fail", detail: "The task is marked completed but has no result text." });

  let evidence = 0;
  for (const a of actions) {
    const label = `${a.connector}.${a.action}`;
    if (a.status === "executed") {
      evidence++;
      checks.push({ kind: "action_executed", outcome: "pass", detail: `${label} was approved and ran: ${clip(a.summary, 100)}` });
      const created = CREATED.exec(a.result ?? "");
      if (created) {
        const path = created[1]!;
        const reported = Number(created[2]!.replace(/,/g, ""));
        const p = probe(path);
        if (p.state === "ok" && p.size === reported) {
          evidence++;
          checks.push({ kind: "file_exists", outcome: "pass", detail: `The file exists with the reported size (${reported.toLocaleString()} bytes): ${path}` });
        } else if (p.state === "ok") checks.push({ kind: "file_size_differs", outcome: "fail", detail: `The file exists but is ${p.size.toLocaleString()} bytes, not the ${reported.toLocaleString()} the action reported (it may have been changed since): ${path}` });
        else if (p.state === "missing") checks.push({ kind: "file_missing", outcome: "fail", detail: `The action reported creating a file, but it is not there (moved or deleted since?): ${path}` });
        else checks.push({ kind: "file_unchecked", outcome: "note", detail: `The file could not be checked (${p.reason}), so its existence is not confirmed.` });
      }
    } else if (a.status === "failed") checks.push({ kind: "action_failed", outcome: "fail", detail: `${label} failed: ${clip(a.error ?? "no reason recorded", 160)}` });
    else if (a.status === "pending" || a.status === "approved") checks.push({ kind: "action_waiting", outcome: "note", detail: `${label} is still waiting (${a.status}): ${clip(a.summary, 100)}` });
    else checks.push({ kind: "action_denied", outcome: "note", detail: `${label} was ${a.status}, so it did not happen.` });
  }

  // What the reply says happened, against what the record shows.
  const executed = actions.filter((a) => a.status === "executed");
  const waiting = actions.some((a) => a.status === "pending" || a.status === "approved");
  for (const c of findClaims(result)) {
    const backed = executed.some((a) => BACKING[c.kind].includes(a.connector));
    if (backed) checks.push({ kind: "claim_supported", outcome: "pass", detail: `Claim "${c.excerpt}" is backed by an executed action.` });
    else checks.push({ kind: "claim_unsupported", outcome: "fail", detail: `The reply says "${c.excerpt}" but no ${c.kind === "send" ? "send" : c.kind === "save" ? "save or create" : c.kind === "publish" ? "publish" : "delete or rename"} action ${waiting ? "has run yet (one is still waiting for your approval)" : "was recorded for this task"}.` });
  }

  const failed = checks.filter((c) => c.outcome === "fail");
  let status: VerificationStatus;
  let summary: string;
  if (failed.length > 0) {
    status = "contradicted";
    summary = `Do not rely on this result: ${failed.length} check(s) failed. ${failed[0]!.detail}`;
  } else if (waiting) {
    status = "waiting";
    summary = "An outside action is still waiting for your approval, so nothing is confirmed yet.";
  } else if (evidence > 0) {
    status = "verified";
    summary = `Checked against the platform's own record: ${evidence} piece(s) of evidence confirmed and nothing contradicts the result.`;
  } else {
    status = "unverified";
    summary = "Finished, but there is nothing the platform can check (it is a text answer). Treat it as the agent's own words.";
  }
  return { status, summary, checks, evidence };
}

/** A chain of tasks: the worst status wins, evidence adds up. */
export function combine(parts: Verification[]): Verification {
  const rel = parts.filter((p) => p.status !== "not_applicable");
  if (rel.length === 0) return { status: "not_applicable", summary: "No finished task to verify.", checks: [], evidence: 0 };
  const order: VerificationStatus[] = ["contradicted", "waiting", "unverified", "verified"];
  const status = order.find((s) => rel.some((p) => p.status === s))!;
  const evidence = rel.reduce((n, p) => n + p.evidence, 0);
  const checks = rel.flatMap((p) => p.checks);
  const verified = rel.filter((p) => p.status === "verified").length;
  const summary = status === "contradicted" ? rel.find((p) => p.status === "contradicted")!.summary : status === "waiting" ? "At least one outside action is still waiting for your approval." : status === "unverified" ? `${rel.length - verified} of ${rel.length} step(s) have nothing the platform can check; only ${verified} is confirmed.` : `All ${rel.length} step(s) are confirmed by the platform's own record.`;
  return { status, summary, checks, evidence };
}
