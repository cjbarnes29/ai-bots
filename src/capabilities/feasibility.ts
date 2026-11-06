/**
 * The feasibility checker (M2). Before a task is accepted it answers, from the capability registry (M1) and not from hope:
 * can this be done fully, only partly, or not at all, what is missing, and what needs the owner.
 *
 * Deliberately rule-based: no model call (so it costs nothing, works offline, and the goal text, which is untrusted, cannot talk it into anything).
 * The goal is only ever matched against fixed word patterns; it is never executed, interpolated into a command or used as an instruction.
 * It only reads. It cannot approve, enable, install, connect or change anything.
 *
 * Unknown wording is NOT assumed possible: when no ability is recognised the task is treated as plain text work and the answer says so,
 * and the checker says it matched by keywords and can miss things.
 */
import type { Capability, CapState } from "./registry.js";

export type Classification = "fully" | "partial" | "unsupported";
export type ReqStatus = "met" | "unproven" | "restricted" | "needs_owner" | "missing" | "blocked_by_policy";

export interface Requirement {
  /** Capability id, or a policy:* id for things the rules forbid. */
  id: string;
  label: string;
  /** The words in the goal that triggered it. */
  because: string;
  status: ReqStatus;
  detail: string;
  /** What is missing for this requirement, in plain words. */
  missing: string[];
  needsOwner: string[];
}

export interface Assessment {
  classification: Classification;
  /** One plain sentence. */
  summary: string;
  requirements: Requirement[];
  /** Things that can run now (with the owner's approvals where a write is involved). */
  canDo: string[];
  /** Things that cannot be done at all with this build, and why. */
  cannotDo: string[];
  /** Things that need the owner's involvement. */
  needsYou: string[];
  /** Practical alternatives. */
  alternatives: string[];
  /** Requirements that make the task impossible as asked (not built, not installed, or forbidden). Empty unless something is hard-blocked. */
  blockers: string[];
  /** True when nothing may run unattended: all autonomy is supervised until Guardian Tier B is verified (D-035). */
  supervisedOnly: true;
  supervisionNote: string;
  /** Honest limit of this check. */
  caveat: string;
}

interface Rule {
  key: string;
  label: string;
  pattern: RegExp;
  /** Capabilities that must all be usable. */
  needs: string[];
  alternative?: string;
  /** A synthetic requirement the rules forbid, with no capability behind it. */
  policy?: { reason: string };
}

// Patterns are plain alternations of words: no nested quantifiers, so matching is linear even on hostile text.
const RULES: Rule[] = [
  { key: "email", label: "Email (Gmail)", pattern: /\b(e-?mails?|gmail|inbox)\b/i, needs: ["gmail"] },
  { key: "telegram", label: "Telegram", pattern: /\btelegram\b/i, needs: ["telegram"] },
  { key: "github", label: "GitHub", pattern: /\b(github|pull requests?|issues? tracker)\b/i, needs: ["github"] },
  { key: "notion", label: "Notion", pattern: /\bnotion\b/i, needs: ["notion"] },
  { key: "google", label: "Google Drive, Docs, Sheets or Calendar", pattern: /\b(google (drive|docs?|sheets?|slides|calendar|tasks)|calendar|my drive)\b/i, needs: ["gworkspace"] },
  { key: "n8n", label: "n8n workflow", pattern: /\bn8n\b/i, needs: ["n8n"] },
  { key: "mcp", label: "MCP server", pattern: /\bmcp\b/i, needs: ["mcp"] },
  { key: "web", label: "Reading web pages", pattern: /\b(websites?|web ?pages?|browse|research|search the web|look up online|urls?|https?)\b/i, needs: ["browser"], alternative: "Paste the text of the pages into the chat or a Knowledge Center document and the agents can work from that." },
  { key: "documents", label: "Creating documents or spreadsheets", pattern: /\b(word doc\w*|docx|excel|xlsx|spreadsheets?|csv|powerpoint|pptx|pdf|slide deck)\b/i, needs: ["documents", "perm-folders"], alternative: "Agents can write the content as plain text in the chat for you to paste into your own program." },
  { key: "files", label: "Saving or changing files on this PC", pattern: /\b(save (it |this |them )?(to|in)|write (a |the )?files?|create (a |the )?files?|rename|on my (disk|computer|pc)|in (a |the |my )folder)\b/i, needs: ["pc-agent", "perm-folders"] },
  { key: "python", label: "Running Python", pattern: /\bpython\b/i, needs: ["python"] },
  { key: "git", label: "Using Git", pattern: /\bgit (commit|clone|status|push|pull|branch)\b/i, needs: ["git"] },
  { key: "node", label: "Running Node or npm", pattern: /\b(npm|node ?js|run (the )?tests?|build the app)\b/i, needs: ["node", "npm"] },
  { key: "image", label: "Creating images", pattern: /\b(logos?|posters?|thumbnails?|generate (an? )?(image|picture|photo)|illustrat\w+|draw (me )?an?)\b/i, needs: ["image-generation"], alternative: "Agents can write a design brief and an image prompt for a free image tool you run yourself." },
  { key: "video", label: "Creating or editing video", pattern: /\b(videos?|animations?|subtitles?|youtube|reels?)\b/i, needs: ["video-generation", "env-ffmpeg"], alternative: "Agents can write the script, shot list, title and description as text; you assemble the video yourself." },
  { key: "audio", label: "Voice, audio or music", pattern: /\b(voice ?overs?|narrat\w+|text to speech|music|podcasts?|audio)\b/i, needs: ["audio-generation"], alternative: "Agents can write the script; use a free text-to-speech tool of your own." },
  { key: "vision", label: "Looking at pictures or screenshots", pattern: /\b(screenshots?|photos?|read (the |this )?(picture|image)|ocr)\b/i, needs: ["model-vision"], alternative: "Describe the picture in words, or paste the text from it." },
  { key: "desktop", label: "Operating programs on the desktop", pattern: /\b(click (on|the)|desktop (app|automation|agent)|open (the |an? )?(app|program|application)|operate (the |a )?(app|program)|automate (the |an? )?(app|program))\b/i, needs: ["env-desktop-engine"] },
  { key: "vm", label: "Working inside a virtual machine", pattern: /\b(vmware|virtual machines?|\bvm\b)\b/i, needs: ["env-vm"], alternative: "Plans for the VM can be prepared for your review, but nothing can run in one yet." },
  { key: "business", label: "Business lead discovery", pattern: /\b(leads?|prospects?|businesses in|small businesses)\b/i, needs: ["business"] },
  { key: "groups", label: "Group chat between agents", pattern: /\bgroup chats?\b/i, needs: ["perm-groups"] },
  { key: "unattended", label: "Working while you are away", pattern: /\b(while i('| a)?m (away|asleep|out|gone)|unattended|overnight|24\/7|without me|when i'?m not (here|around))\b/i, needs: ["perm-autonomy"], alternative: "Run it while you are at the PC (supervised). Scheduled runs pause when the PC locks or after 15 idle minutes." },
  { key: "purchase", label: "Buying or paying for things", pattern: /\b(buy|purchase|pay for|subscribe to|order (a|the)|upgrade (my )?plan)\b/i, needs: [], policy: { reason: "Purchases and paid services are never done by the workforce without your own explicit approval, and there is no payment ability." }, alternative: "Agents can compare options and prepare a shortlist; you do the paying." },
  { key: "social", label: "Posting on social media", pattern: /\b(post (it |this )?(on|to)|tweet|instagram|tiktok|linkedin post|facebook post|publish (it |this )?(on|to))\b/i, needs: [], policy: { reason: "No social-media connector exists, and publishing always needs your approval." }, alternative: "Agents can draft the post text for you to publish yourself." },
  { key: "deploy", label: "Deploying or publishing software", pattern: /\b(deploy|go live|publish the (site|app)|release to production)\b/i, needs: [], policy: { reason: "Deployments and publishing need your separate explicit approval and are not done by the workforce." }, alternative: "Agents can prepare a deployment checklist." },
  { key: "admin", label: "Administrator or system-level changes", pattern: /\b(install (a |the )?(program|software|driver)|administrator|run as admin|change (the )?firewall|create (a )?(windows )?(user|account))\b/i, needs: [], policy: { reason: "Administrator operations, installs and account creation are restricted: they need your separate approval and are never done by an agent." }, alternative: "Agents can write step-by-step instructions for you to follow yourself." },
];

const WRITE_HINT = /\b(send|reply|post|publish|create|save|write|delete|rename|update|submit|upload|share|schedule|invite)\b/i;
const MAX_GOAL = 4000;

const reqStatus = (state: CapState): ReqStatus => (state === "available" ? "met" : state === "unverified" ? "unproven" : state === "partial" ? "restricted" : state === "needs_setup" ? "needs_owner" : "missing");

function requirementFor(rule: Rule, because: string, id: string, cap: Capability | undefined): Requirement {
  if (!cap) {
    return { id, label: rule.label, because, status: "missing", detail: "This ability is not part of this build.", missing: ["It is not built or not installed in this version."], needsOwner: [] };
  }
  return { id, label: cap.name, because, status: reqStatus(cap.state), detail: cap.stateReason, missing: cap.missing, needsOwner: cap.needsOwner };
}

export function assess(rawGoal: string, caps: Capability[]): Assessment {
  const goal = rawGoal.slice(0, MAX_GOAL);
  const byId = new Map(caps.map((c) => [c.id, c]));
  const reqs: Requirement[] = [];
  const alternatives: string[] = [];
  const seen = new Set<string>();
  let recognised = 0;

  for (const rule of RULES) {
    const m = rule.pattern.exec(goal);
    if (!m) continue;
    recognised++;
    if (rule.alternative) alternatives.push(rule.alternative);
    if (rule.policy) {
      reqs.push({ id: `policy:${rule.key}`, label: rule.label, because: m[0], status: "blocked_by_policy", detail: rule.policy.reason, missing: [rule.policy.reason], needsOwner: ["Do this yourself, or give a separate explicit approval where the rules allow one."] });
      continue;
    }
    for (const id of rule.needs) {
      if (seen.has(id)) continue;
      seen.add(id);
      reqs.push(requirementFor(rule, m[0], id, byId.get(id)));
    }
  }

  // Everything an agent does needs a real, verified model.
  const model = byId.get("ai-models");
  const modelReq: Requirement = model
    ? { id: "ai-models", label: "A verified AI model", because: "all agent work", status: reqStatus(model.state), detail: model.stateReason, missing: model.missing, needsOwner: model.needsOwner }
    : { id: "ai-models", label: "A verified AI model", because: "all agent work", status: "missing", detail: "No model information is available.", missing: ["No model information."], needsOwner: [] };
  reqs.unshift(modelReq);

  const others = reqs.filter((r) => r.id !== "ai-models");
  const modelOk = modelReq.status === "met";
  const usable = (r: Requirement) => r.status === "met" || r.status === "unproven" || r.status === "restricted";
  const hard = others.filter((r) => r.status === "missing" || r.status === "blocked_by_policy");
  const allMet = reqs.every((r) => r.status === "met");

  let classification: Classification;
  if (!modelOk) classification = "unsupported";
  else if (allMet) classification = "fully";
  else if (hard.length > 0 && !others.some(usable)) classification = "unsupported";
  else classification = "partial";

  const canDo: string[] = [];
  const cannotDo: string[] = [];
  const needsYou: string[] = [];
  if (modelOk) canDo.push("Write, plan, summarise and reason in text with a verified AI model.");
  else cannotDo.push("Nothing can run: no verified AI model is available. " + modelReq.missing.join(" "));
  for (const r of others) {
    if (r.status === "met") canDo.push(`${r.label}: working${r.detail ? ` (${r.detail})` : ""}`);
    else if (r.status === "unproven") canDo.push(`${r.label}: set up, but never seen working. It may fail, so it will be tried carefully and its result checked.`);
    else if (r.status === "restricted") canDo.push(`${r.label}: only with a restriction. ${r.detail}`);
    else if (r.status === "needs_owner") needsYou.push(`${r.label}: ${r.detail}`);
    else cannotDo.push(`${r.label}: ${r.detail}`);
    needsYou.push(...r.needsOwner.filter((n) => !needsYou.includes(n)));
  }
  needsYou.push(...modelReq.needsOwner.filter((n) => !needsYou.includes(n)));
  if (WRITE_HINT.test(goal) && others.some((r) => r.status === "met" || r.status === "unproven")) needsYou.push("Anything that sends, saves or changes something outside waits for your approval, one action at a time.");
  needsYou.push("Stay at the PC while it runs (supervised only).");

  const blockers = [...(modelOk ? [] : [modelReq.label]), ...hard.map((r) => r.label)];
  const unattended = others.some((r) => r.id === "perm-autonomy");
  const names = (list: Requirement[]) => list.map((r) => r.label).join(", ");
  let summary: string;
  if (classification === "fully") summary = recognised === 0 ? "This looks like plain text work. A verified AI model is available, so it can be done (no outside ability was recognised in the wording)." : "Everything this task appears to need is working right now.";
  else if (classification === "unsupported") summary = !modelOk ? "This cannot be started: there is no verified AI model to do the work." : `This cannot be done as asked: ${names(hard)} ${hard.length === 1 ? "is" : "are"} not available, and nothing else in the request can proceed on its own.`;
  else summary = `Part of this can be done. ${hard.length ? `Not possible: ${names(hard)}. ` : ""}${others.filter((r) => r.status === "needs_owner").length ? `Needs you first: ${names(others.filter((r) => r.status === "needs_owner"))}. ` : ""}${others.filter((r) => r.status === "unproven" || r.status === "restricted").length ? `Unproven or limited: ${names(others.filter((r) => r.status === "unproven" || r.status === "restricted"))}.` : ""}`.trim();

  return {
    classification,
    summary,
    requirements: reqs,
    canDo,
    cannotDo,
    needsYou,
    alternatives: [...new Set(alternatives)],
    blockers,
    supervisedOnly: true,
    supervisionNote: unattended
      ? "You asked for work while you are away. That is not allowed yet: everything is supervised until Guardian Tier B is built and verified."
      : "All work is supervised: you must be present. The Guardian pauses everything when the PC locks or after 15 idle minutes.",
    caveat: "This check reads your wording for known abilities. It can miss something or over-match, and it only says what is set up, not that a real outside service will answer. Results are verified separately.",
  };
}
