import type { Lead, Priority } from "./leads.js";

/**
 * The lead score: how good a prospect this business is for an offer to improve its web presence. 0 to 100.
 *
 * It is a plain table of points (see RUBRIC), computed by code from the lead's own fields. Nothing is guessed and no model is involved;
 * every point is listed with the reason. A model may later WRITE about the result, but it never decides it.
 *
 * Three situations are kept apart on purpose:
 *   - no website listed        -> worth points, marked UNVERIFIED (a person must confirm before contacting);
 *   - website audited and poor -> worth points in proportion to how poor it is;
 *   - audit could not be done  -> worth NO website points, and is never called poor: it is marked "check by hand".
 */
export interface RubricRow {
  id: string;
  label: string;
  max: number;
  rule: string;
}

export const RUBRIC: RubricRow[] = [
  {
    id: "website",
    label: "Website situation",
    max: 70,
    rule: "Owner confirmed no website: 70. Placeholder or parked page: 65. No website listed (unverified): 50. Audited website: 70 x (100 - quality score) / 100, and at most 35 when the check was low-confidence. Audit could not be completed, or not checked yet: 0.",
  },
  { id: "phone", label: "A public phone number is listed", max: 20, rule: "Phone listed: 20. This makes it possible to reach the business by hand." },
  { id: "address", label: "An address is listed", max: 10, rule: "Address listed: 10." },
];

export const PRIORITY_RULE = "High: 60 or more. Medium: 35 to 59. Low: under 35.";
export const MAX_SCORE = RUBRIC.reduce((n, r) => n + r.max, 0);

export type ScoreConfidence = "normal" | "unverified" | "low" | "needs_check";

export interface Criterion {
  id: string;
  label: string;
  points: number;
  max: number;
  evidence: string;
}

export interface Scoring {
  score: number;
  priority: Priority;
  confidence: ScoreConfidence;
  criteria: Criterion[];
  /** One readable sentence. Built from fixed templates only. */
  reasons: string;
  /** Compact "id=points" list, stored in the file. */
  breakdown: string;
}

const priorityFor = (score: number): Priority => (score >= 60 ? "high" : score >= 35 ? "medium" : "low");

const FAILURE_WORDS: Record<string, string> = {
  dns_failed: "the website name was not found",
  timed_out: "the website took too long to answer",
  connection_failed: "the website could not be reached",
  tls_certificate_invalid: "the security certificate is not valid",
  http_error: "the website answered with an error",
  not_a_web_page: "the address is not a web page",
  too_large: "the page was too large to check",
  blocked_address: "the address is not a public website",
  bad_address: "the address is not valid",
  redirect_loop: "the website redirected too many times",
  limit_reached: "the daily check limit was reached",
};

export function scoreLead(l: Lead): Scoring {
  const criteria: Criterion[] = [];
  let confidence: ScoreConfidence = "normal";
  const web = RUBRIC[0]!;

  switch (l.website_state) {
    case "confirmed_none":
      criteria.push({ id: "website", label: web.label, points: 70, max: web.max, evidence: "The owner confirmed there is no website." });
      break;
    case "none_listed":
      confidence = "unverified";
      criteria.push({ id: "website", label: web.label, points: 50, max: web.max, evidence: "No website is listed in the source. Unverified: confirm there really is none before contacting." });
      break;
    case "audited": {
      const quality = l.audit_score ?? 100;
      const placeholder = /^Placeholder or parked page/.test(l.audit_summary);
      if (placeholder) criteria.push({ id: "website", label: web.label, points: 65, max: web.max, evidence: "The address leads to a placeholder or parked page, not a real website." });
      else {
        let pts = Math.round((70 * (100 - quality)) / 100);
        if (l.audit_confidence === "low") {
          pts = Math.min(pts, 35);
          confidence = "low";
        }
        criteria.push({ id: "website", label: web.label, points: pts, max: web.max, evidence: `The website scored ${quality} out of 100 in the audit${l.audit_confidence === "low" ? " (low confidence: part of the page could not be judged, so the points are capped)" : ""}.` });
      }
      break;
    }
    case "audit_failed":
      confidence = "needs_check";
      criteria.push({ id: "website", label: web.label, points: 0, max: web.max, evidence: `The website could not be checked (${FAILURE_WORDS[l.audit_failure] ?? "the check failed"}). This says nothing about its quality: check it by hand.` });
      break;
    default:
      confidence = "needs_check";
      criteria.push({ id: "website", label: web.label, points: 0, max: web.max, evidence: "The website has not been checked yet." });
  }

  const phone = l.phone.trim() !== "";
  criteria.push({ id: "phone", label: RUBRIC[1]!.label, points: phone ? 20 : 0, max: 20, evidence: phone ? "A phone number is listed." : "No phone number is listed." });
  const address = l.address.trim() !== "";
  criteria.push({ id: "address", label: RUBRIC[2]!.label, points: address ? 10 : 0, max: 10, evidence: address ? "An address is listed." : "No address is listed." });

  const score = Math.min(MAX_SCORE, criteria.reduce((n, c) => n + c.points, 0));
  const awarded = criteria.filter((c) => c.points > 0).map((c) => `${c.evidence.replace(/\.$/, "")} (+${c.points})`);
  const note = confidence === "needs_check" ? " Needs a manual check of the website." : "";
  return {
    score,
    priority: priorityFor(score),
    confidence,
    criteria,
    reasons: `${awarded.length ? awarded.join("; ") + "." : "No points awarded."}${note}`,
    breakdown: criteria.map((c) => `${c.id}=${c.points}`).join(";"),
  };
}

/** The lead with its score fields filled in. */
export function applyScore(l: Lead): Lead {
  const s = scoreLead(l);
  return { ...l, lead_score: s.score, priority: s.priority, score_breakdown: s.breakdown, score_reasons: s.reasons };
}
