import { assess, type Assessment } from "./feasibility.js";
import { summarize, type Capability } from "./registry.js";

/**
 * Plain-language answers for the AI Assistant, built from the live capability list passed in (never from a hand-kept list, never from memory).
 * Pure functions: the caller fetches the current registry for every question.
 */
export interface CapabilityAnswer {
  message: string;
  /** Seen working. */
  can: string[];
  /** Works with a limit, or set up but never seen working. */
  partly: string[];
  /** Not built, not installed, or waiting for the owner to set up. */
  cannot: string[];
  needsYou: string[];
  link: { label: string; to: string };
}

/** "What can you do?", "what can't you do?", "list your capabilities". Whole short questions only, so ordinary chat is never hijacked. */
const OVERVIEW_Q = /^(?:please\s+)?(?:so\s+)?(?:(?:tell|show|list)(?:\s+me)?\s+)?(?:what\s+(?:can|could|are)\s+(?:you|u)\s+(?:actually\s+)?(?:do|able\s+to\s+do|capable\s+of)(?:\s+(?:right\s+)?now)?|what\s+(?:can(?:'t|not)|cannot)\s+you\s+do|what\s+(?:you\s+can|are\s+you\s+able)\s+(?:do|to\s+do)|(?:what\s+(?:are\s+)?)?(?:your\s+|my\s+)?(?:capabilities|abilities)|what\s+(?:is|are)\s+(?:supported|available|working)|what\s+(?:works|doesn'?t\s+work)(?:\s+(?:right\s+)?now)?|what\s+can\s+(?:the\s+|this\s+)?(?:workforce|assistant|system|platform|ai)\s+do)(?:\s+(?:right\s+)?now)?\s*[?.!]*$/i;
/** "Can you send an email?" / "are you able to make a logo?" */
const CAN_YOU = /^(?:please\s+)?(?:can|could|are\s+you\s+able\s+to|do\s+you\s+(?:know\s+how\s+to|support))\s+(?:you\s+)?(?:actually\s+)?(.{3,300}?)\s*\?*$/i;

export function isOverviewQuestion(text: string): boolean {
  return text.trim().length <= 120 && OVERVIEW_Q.test(text.trim());
}
export function canYouGoal(text: string): string | null {
  const m = CAN_YOU.exec(text.trim());
  return m && text.trim().endsWith("?") ? m[1]! : null;
}

const SHOWN = ["tool", "integration", "environment", "permission", "authentication"] as const;
const cut = (list: string[], n = 30) => (list.length > n ? [...list.slice(0, n), `…and ${list.length - n} more (see the Capabilities page)`] : list);

export function overviewAnswer(caps: Capability[]): CapabilityAnswer {
  const s = summarize(caps);
  const shown = caps.filter((c) => (SHOWN as readonly string[]).includes(c.group) || c.id === "ai-models" || c.id.startsWith("model-provider:") || c.id.startsWith("model-"));
  const can = shown.filter((c) => c.state === "available").map((c) => `${c.name}${c.reached === "verified" ? " (verified)" : ""}`);
  const partly = shown.filter((c) => c.state === "partial" || c.state === "unverified").map((c) => `${c.name}: ${c.state === "unverified" ? "set up, but never seen working. " : ""}${c.stateReason}`);
  const cannot = shown.filter((c) => c.state === "unavailable" || c.state === "needs_setup").map((c) => `${c.name}: ${c.stateReason}`);
  const agents = caps.filter((c) => c.group === "agent");
  const workflows = caps.filter((c) => c.group === "workflow");
  const ready = agents.filter((c) => c.state === "available" || c.state === "unverified").length;
  const extra = [
    ...(agents.length > 0 ? [`${agents.length} agent(s): ${ready} ready to run, ${agents.length - ready} not ready (not active, no model, or its model is unusable).`] : ["No agents exist yet."]),
    ...(workflows.length > 0 ? [`${workflows.length} workflow(s): ${workflows.filter((c) => c.state === "available" || c.state === "unverified").length} ready.`] : []),
  ];
  const needsYou = [...new Set(shown.filter((c) => c.state !== "available").flatMap((c) => c.needsOwner))];
  return {
    message: `Here is what I can do right now, read from the live capability list. ${s.headline} "Working" means it has been seen working; "set up but unproven" means nobody has seen it work yet, so I will not promise it. Everything runs under your supervision, and anything that sends or saves outside waits for your approval.`,
    can: cut([...can, ...extra]),
    partly: cut(partly),
    cannot: cut(cannot),
    needsYou: cut(needsYou, 8),
    link: { label: "Open the Capabilities page", to: "/capabilities" },
  };
}

/** For "can you …?": returns null when the wording names no ability this app knows (so the question goes on as ordinary chat). */
export function canYouAnswer(goal: string, caps: Capability[]): (CapabilityAnswer & { assessment: Assessment }) | null {
  const a = assess(goal, caps);
  if (a.requirements.length <= 1) return null; // only the model requirement: this is plain text work, so the assistant just does it as chat
  const head = a.classification === "fully" ? "Yes, with what is working right now." : a.classification === "partial" ? "Partly." : "No, not as asked.";
  return {
    assessment: a,
    message: `${head} ${a.summary} ${a.supervisionNote}`,
    can: cut(a.canDo),
    partly: [],
    cannot: cut(a.cannotDo),
    needsYou: cut(a.needsYou, 8),
    link: { label: "Open the Capabilities page", to: "/capabilities" },
  };
}
