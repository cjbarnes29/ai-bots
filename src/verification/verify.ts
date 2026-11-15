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
import type { ResultObject, ResultOperation, ResultSupport } from "../connectors/types.js";
import { copyResultSupport } from "./action-support.js";
import { resultHash, type AuthorshipAssessment } from "../delegation/result-provenance.js";
import { observeActions } from "./action-observations.js";

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
  resultSupport?: ResultSupport | undefined;
  /**
   * Set only for an approved request with no recorded outcome long after approval (D-125): it may or may not have happened and was NOT resent. `reported` is the
   * owner's own statement, if any. It never counts as evidence.
   */
  outcomeUnknown?: { reported: "did_happen" | "did_not_happen" | "cannot_tell" | null } | undefined;
}
export type FileProbe = (absPath: string) => { state: "ok"; size: number } | { state: "missing" } | { state: "unreadable"; reason: string };

export interface Check {
  kind: "result_present" | "provenance_unchecked" | "action_executed" | "action_failed" | "action_waiting" | "action_outcome_unknown" | "action_denied" | "action_effect_unknown" | "file_exists" | "file_missing" | "file_size_differs" | "file_unchecked" | "claim_supported" | "claim_unsupported" | "claim_unchecked";
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
const VERB_KIND: Record<string, ClaimKind> = { sent: "send", emailed: "send", messaged: "send", saved: "save", created: "save", wrote: "save", added: "save", appended: "save", published: "publish", posted: "publish", uploaded: "publish", submitted: "publish", deleted: "remove", renamed: "remove", scheduled: "save", booked: "save" };
const OPERATION: Record<string, ResultOperation | undefined> = { sent: "send", emailed: "send", messaged: "send", saved: "save", created: "create", wrote: "write", added: "append", appended: "append", posted: "post_comment", deleted: "remove_to_trash", scheduled: "schedule" };
const OBJECT_TYPES: Record<string, ResultObject | undefined> = {
  email: "email", emails: "email", "e-mail": "email", "e-mails": "email", invite: "email", invitation: "email", invitations: "email", message: "message", messages: "message",
  file: "file", files: "file", folder: "folder", folders: "folder", document: "document", documents: "document", word: "document", pdf: "document",
  spreadsheet: "spreadsheet", spreadsheets: "spreadsheet", excel: "spreadsheet", csv: "spreadsheet", workbook: "spreadsheet", workbooks: "spreadsheet", sheet: "spreadsheet", sheets: "spreadsheet",
  presentation: "presentation", presentations: "presentation", slides: "presentation", chart: "chart", charts: "chart", diagram: "diagram", diagrams: "diagram",
  draft: "draft", drafts: "draft", event: "event", events: "event", task: "task", tasks: "task", issue: "issue", issues: "issue", comment: "comment", comments: "comment", page: "page", pages: "page", note: "note", notes: "note", lead: "lead_rows", leads: "lead_rows",
};
const OBJECT_WORD = /\b(e-?mails?|invitations?|invite|messages?|files?|folders?|documents?|word|pdf|spreadsheets?|excel|csv|workbooks?|sheets?|presentations?|slides|charts?|diagrams?|drafts?|events?|tasks?|issues?|comments?|pages?|notes?|leads?)\b/gi;
function claimObject(verb: string, after: string, before: string): ResultObject | undefined {
  if (verb === "emailed") return "email";
  if (verb === "messaged") return "message";
  // Use only the bounded current clause, never a later sentence's object.
  const clause = after.split(/[.!?;\n]/, 1)[0]!;
  const following = [...clause.matchAll(OBJECT_WORD)];
  const preceding = [...before.split(/[.!?;\n]/).at(-1)!.matchAll(OBJECT_WORD)];
  if (/\be-?mail\s+draft\b/i.test(clause)) return "draft";
  const word = following[0]?.[0] ?? preceding.at(-1)?.[0];
  return word ? OBJECT_TYPES[word.toLowerCase()] : undefined;
}
// "I have sent", "I've saved", "we created", "has been sent", "was published". Plain alternations only (linear time on any input).
const CLAIM = /\b(?:(?:i|we)(?:'ve|\s+have)?\s+(?:just\s+|already\s+|successfully\s+|permanently\s+)?(sent|emailed|messaged|saved|created|wrote|added|appended|published|posted|uploaded|deleted|renamed|scheduled|submitted|booked)|(?:has|have|was|were|is|are)\s+(?:now\s+|been\s+|successfully\s+|permanently\s+)*(sent|emailed|saved|created|added|appended|published|posted|uploaded|deleted|submitted))\b/gi;
const OBJECT = /\b(files?|documents?|spreadsheet|excel|word|pdf|csv|report|e-?mails?|messages?|post|presentation|slides|draft|folders?|page|issue|events?|invite|invitation|note|workbook|sheet|charts?|diagrams?|tasks?|comments?|leads?)\b/i;
const NEGATION = /(?:\bnot\b|n't\b|\bnever\b|\bunable\b|\bcannot\b|\bno\b|\bnothing\b|\bwill\b|\bwould\b|\bcould\b|\bshould\b|\bcan\b|\bto\b|\bif\b|\bonce\b)\s*(?:\w+\s+){0,2}$/i;
// Describing an item as sent for review/approval reports a handoff to the owner, not an external send.
const REVIEW_HANDOFF = /^\s+for\s+(?:(?:the\s+)?owner['’]s\s+)?(?:approval|review)\b/i;

export interface Claim {
  verb: string;
  kind: ClaimKind;
  excerpt: string;
  operation: ResultOperation | undefined;
  object: ResultObject | undefined;
}
/** The completion claims in a reply that are about something OUTSIDE the chat (a file, an email, a post). Questions, plans and negations are skipped. */
function scanClaims(text: string, maxChars = 20_000, maxClaims = 8): { claims: Claim[]; complete: boolean } {
  const out: Claim[] = [];
  const t = text.slice(0, maxChars);
  let complete = text.length <= maxChars;
  if (maxClaims === 0) return { claims: [], complete: text.trim().length === 0 };
  CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAIM.exec(t)) !== null) {
    const verb = (m[1] ?? m[2] ?? "").toLowerCase();
    const kind = VERB_KIND[verb];
    if (!kind) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    if (NEGATION.test(before)) continue;
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 90);
    if (kind === "send" && REVIEW_HANDOFF.test(after)) continue;
    // "sent" is always outside the chat; the rest need a thing that lives outside it ("saved the report", not "created a plan").
    if (kind !== "send" && !OBJECT.test(after) && !OBJECT.test(t.slice(Math.max(0, m.index - 40), m.index))) continue;
    const contextBefore = t.slice(Math.max(0, m.index - 80), m.index);
    const operation = verb === "deleted" && /\bpermanent(?:ly)?\b/i.test(contextBefore + m[0] + after) ? undefined : OPERATION[verb];
    out.push({ verb, kind, operation, object: claimObject(verb, after, contextBefore), excerpt: clip(t.slice(Math.max(0, m.index - 20), m.index + m[0].length + 60).replace(/\s+/g, " ").trim(), 140) });
    if (out.length >= maxClaims) { if (t.slice(CLAIM.lastIndex).trim()) complete = false; break; }
  }
  return { claims: out, complete };
}

export function findClaims(text: string): Claim[] { return scanClaims(text).claims; }

export function verifyTask(task: TaskFact, actions: ActionFact[], probe: FileProbe, authorship: AuthorshipAssessment = { state: "unknown", reason: "No saved result-origin record." }): Verification {
  // Never borrow another task's (or a workflow's unbound) receipt.
  actions = actions.filter(a => a.taskId === task.id);
  const checks: Check[] = [];
  if (task.status !== "completed") {
    return { status: "not_applicable", summary: task.status === "failed" ? "The task failed, so there is no result to verify." : task.status === "cancelled" ? "The task was cancelled." : "The task has not finished.", checks, evidence: 0 };
  }
  const full = task.result ?? "";
  if (full.trim().length === 0) checks.push({ kind: "result_present", outcome: "fail", detail: "The task is marked completed but has no result text." });
  const bound = authorship.state === "known" && authorship.taskId === task.id && authorship.resultSha256 === resultHash(full);
  const agentParts = bound ? authorship.ranges.filter(r => r.origin === "agent").map(r => full.slice(r.start, r.end)) : [];
  let originUnknown = !bound || !authorship.agentTextComplete || authorship.hasUntrusted || !agentParts.some(s => s.trim());
  const claims: Claim[] = [];
  let charsLeft = 20_000, claimsLeft = 8;
  for (const part of agentParts) {
    const scanned = scanClaims(part, charsLeft, claimsLeft);
    claims.push(...scanned.claims);
    charsLeft = Math.max(0, charsLeft - part.length);
    claimsLeft -= scanned.claims.length;
    if (!scanned.complete) originUnknown = true;
  }
  if (originUnknown) checks.push({ kind: "provenance_unchecked", outcome: "note", detail: authorship.state === "unknown" ? authorship.reason : "The AI-written result is missing, incomplete, mixed with untrusted raw material, or exceeds the bounded claim scan." });

  const observed = observeActions(actions, probe);
  checks.push(...observed.checks);
  const evidence = observed.evidence;
  let unknown = originUnknown || observed.unknown;
  const support = new Map(actions.map(a => [a.id, copyResultSupport(a.resultSupport)]));

  // What the reply says happened, against what the record shows.
  const executed = actions.filter((a) => a.status === "executed");
  const waiting = actions.some((a) => a.status === "pending" || (a.status === "approved" && !a.outcomeUnknown));
  const outcomeUnknown = actions.some((a) => a.outcomeUnknown);
  for (const c of claims) {
    const backed = executed.find(a => c.operation && c.object && support.get(a.id)?.some(r => r.operation === c.operation && r.objects.includes(c.object!)));
    if (backed) checks.push({ kind: "claim_supported", outcome: "pass", detail: `Claim "${c.excerpt}" has action-type support from ${backed.connector}.${backed.action} (${backed.id}); target, content and delivery were not checked.` });
    else if (actions.some(a => a.outcomeUnknown && c.operation && c.object && support.get(a.id)?.some(r => r.operation === c.operation && r.objects.includes(c.object!)))) {
      const maybe = actions.find(a => a.outcomeUnknown && c.operation && c.object && support.get(a.id)?.some(r => r.operation === c.operation && r.objects.includes(c.object!)))!;
      unknown = true;
      checks.push({ kind: "claim_unchecked", outcome: "note", detail: `Claim "${c.excerpt}" matches ${maybe.connector}.${maybe.action}, which was approved but has no recorded outcome, so it is neither confirmed nor contradicted.` });
    } else if (executed.length > 0 && (!c.object || executed.some(a => !support.get(a.id)))) {
      unknown = true;
      checks.push({ kind: "claim_unchecked", outcome: "note", detail: `Claim "${c.excerpt}" could not be matched to a known exact action/object type. Treat it as unverified.` });
    } else checks.push({ kind: "claim_unsupported", outcome: "fail", detail: `The reply says "${c.excerpt}" but no ${c.kind === "send" ? "send" : c.kind === "save" ? "save or create" : c.kind === "publish" ? "publish" : "delete or rename"} action ${waiting ? "has run yet (one is still waiting for your approval)" : "was recorded for this task"} with matching action/object semantics.` });
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
  } else if (unknown) {
    status = "unverified";
    summary = outcomeUnknown ? "An approved action has no recorded outcome. It may or may not have happened and was not sent again, so nothing is confirmed for it." : originUnknown ? "The AI-written result is not fully checkable against saved text origins. Recorded actions are separate evidence; treat the answer as unverified." : "An action was recorded, but its effect or the reply's action/object claim could not be confirmed. Target, content and delivery are not checked.";
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
