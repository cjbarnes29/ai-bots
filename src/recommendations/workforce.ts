import type { DelegationLimits, DelegationLimitsUpdate } from "../delegation/limits.js";
import type { RecommendationEngine } from "./engine.js";

/**
 * Recommendations for the workforce itself: bot presets, memory, workflows, permissions, schedules, notifications.
 *
 * Only what can be READ accurately from an existing service is included. Exactly one is a setting that can be applied (the teamwork
 * limits: any value above the approved default comes down to it; a value already stricter is kept, so applying can never loosen a limit).
 * Everything else is ADVICE: it reports the real state and points to the page where the owner decides. In particular nothing here
 * can change a permission, switch a schedule on, or give a bot a model: those are permission-boundary decisions that stay with the owner.
 * VMware is not assessed here (nothing to read; it is assessed separately).
 */
export interface WorkforceEnv {
  bots(): { id: string; name: string; status: string; model: string | null; readConnectorsOn: number }[];
  delegation: { get(): DelegationLimits; defaults(): DelegationLimits; set(update: DelegationLimitsUpdate): void };
  schedules(): { name: string; enabled: boolean; consecutiveFailures: number; disabledReason: string | null }[];
  automationPaused(): boolean;
  /** Phones that receive a content-free wake-up when an approval waits. */
  phoneAlerts(): { subscriptions: number };
  memory(): { botsUsingPrivate: number; botsUsingShared: number; totalBots: number };
}

const none = { why: "", benefits: [] as string[], tradeoffs: [] as string[], compatibility: [] as string[] };
const names = (xs: string[]) => (xs.length <= 4 ? xs.join(", ") : `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more`);

export function registerWorkforceRecommendations(engine: RecommendationEngine, env: WorkforceEnv): void {
  // ------------------------------------------------------------ Workflows: the only applicable one
  const KEYS = ["maxDepth", "maxSubtasksPerTask", "maxTasksPerChain", "maxLlmCallsPerChain", "maxInstructionChars"] as const;
  engine.register<DelegationLimits>({
    id: "workflows.teamwork-limits",
    area: "Workflows",
    title: "Teamwork limits (how far one task may spread)",
    level: "intermediate",
    kind: "setting",
    cost: "free",
    defaultValue: env.delegation.defaults(),
    customizeAt: "/settings/workflows",
    read: () => env.delegation.get(),
    write: (v) => env.delegation.set(Object.fromEntries(KEYS.map((k) => [k, v[k]])) as DelegationLimitsUpdate),
    equals: (a, b) => KEYS.every((k) => a[k] === b[k]),
    format: (v) => `depth ${v.maxDepth}, ${v.maxSubtasksPerTask} teammates per task, ${v.maxTasksPerChain} tasks and ${v.maxLlmCallsPerChain} model calls per chain`,
    evaluate: () => {
      const d = env.delegation.defaults();
      const cur = env.delegation.get();
      const bigger = KEYS.filter((k) => cur[k] > d[k]);
      // Never looser than what the owner already has: a stricter value of theirs is kept, only values above the defaults come down.
      const safe = Object.fromEntries(KEYS.map((k) => [k, Math.min(cur[k], d[k])])) as DelegationLimits;
      return {
        recommended: safe,
        ...(bigger.length > 0 ? { attention: `Some limits are above the approved defaults (${bigger.join(", ")}). Each extra model call in a chain spends free-tier quota.` } : {}),
        why: "The defaults keep one request to about 8 model calls, so a chain of bots cannot use up a free daily allowance.",
        benefits: ["Predictable use of the free tier", "A runaway chain stops early"],
        tradeoffs: ["Large jobs are split into several requests"],
        compatibility: [`Approved defaults: ${KEYS.map((k) => `${k} ${d[k]}`).join(", ")}`],
      };
    },
  });

  // ------------------------------------------------------------ Bot presets (advice)
  engine.register<string>({
    id: "bots.ready",
    area: "Bot presets",
    title: "Agents that cannot run yet",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/agents",
    read: () => {
      const bots = env.bots();
      return bots.length === 0 ? "No agents yet" : `${bots.filter((b) => b.status === "active" && b.model).length} of ${bots.length} ready`;
    },
    evaluate: () => {
      const bots = env.bots();
      if (bots.length === 0) {
        return { unavailable: { state: "not_configured" as const, note: "There are no agents yet. Bot Studio has safe templates; a new agent always starts switched off with every permission off." }, ...none };
      }
      const off = bots.filter((b) => b.status !== "active");
      const noModel = bots.filter((b) => !b.model);
      const problems = [...(off.length ? [`switched off: ${names(off.map((b) => b.name))}`] : []), ...(noModel.length ? [`no model chosen: ${names(noModel.map((b) => b.name))}`] : [])];
      return {
        recommended: "Every agent you use is switched on and has a model",
        ...(problems.length ? { attention: `Not ready (${problems.join("; ")}). Switch on only the agents you will use; choose Automatic as the model if unsure.` } : {}),
        why: "An agent that is switched off or has no model does nothing. This only reports; it never switches an agent on for you.",
        benefits: ["No surprise when a chat or schedule uses an agent that cannot answer"],
        tradeoffs: ["A switched-on agent can be used by chat, tasks and schedules"],
        compatibility: [`${bots.length} agent${bots.length === 1 ? "" : "s"} checked`],
      };
    },
  });

  // ------------------------------------------------------------ Permissions (advice, never applied)
  engine.register<string>({
    id: "permissions.review",
    area: "Permissions",
    title: "Which agents may read outside services",
    level: "intermediate",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/agents",
    read: () => {
      const n = env.bots().filter((b) => b.readConnectorsOn > 0).length;
      return `${n} agent${n === 1 ? "" : "s"} can read outside services`;
    },
    evaluate: () => {
      const wide = env.bots().filter((b) => b.readConnectorsOn >= 3);
      return {
        recommended: "Only the agents that need a service can read it",
        ...(wide.length ? { attention: `${names(wide.map((b) => b.name))} can read three or more outside services. Check each is needed.` } : {}),
        why: "Reading is switched on per agent and per service. Writing always waits for your approval, whatever is set here. Permissions are never changed from this page.",
        benefits: ["Less data reachable if an agent is given a bad instruction"],
        tradeoffs: ["An agent without access cannot help with that service"],
        compatibility: ["Read from each agent's Permissions tab. Sending or changing anything still needs your approval"],
      };
    },
  });

  // ------------------------------------------------------------ Schedules (advice)
  engine.register<string>({
    id: "schedules.health",
    area: "Schedules",
    title: "Schedules that stopped by themselves",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/automation",
    read: () => {
      const s = env.schedules();
      return s.length === 0 ? "No schedules" : `${s.filter((x) => x.enabled).length} of ${s.length} running${env.automationPaused() ? " (automation paused)" : ""}`;
    },
    evaluate: () => {
      const s = env.schedules();
      if (s.length === 0) return { unavailable: { state: "not_configured" as const, note: "No schedules yet. Nothing runs by itself, which is the safe starting point." }, ...none };
      const broken = s.filter((x) => !x.enabled && x.disabledReason);
      return {
        recommended: "Every schedule you rely on is running",
        ...(broken.length ? { attention: `Switched off after repeated failures: ${names(broken.map((x) => x.name))}. Open Schedules to read the reason before switching one back on.` } : {}),
        ...(env.automationPaused() ? { attention: "Automation is paused, so no schedule will run until you resume it." } : {}),
        why: "A schedule that keeps failing switches itself off. This only reports it; it never switches one back on.",
        benefits: ["You notice a broken schedule instead of assuming it ran"],
        tradeoffs: ["Switching one back on without fixing the cause makes it fail again"],
        compatibility: [`${s.length} schedule${s.length === 1 ? "" : "s"} checked`],
      };
    },
  });

  // ------------------------------------------------------------ Notifications (advice)
  engine.register<string>({
    id: "notifications.phone",
    area: "Notifications",
    title: "Phone alerts for approvals",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/settings/notifications",
    read: () => {
      const n = env.phoneAlerts().subscriptions;
      return n === 0 ? "No phone receives alerts" : `${n} phone${n === 1 ? "" : "s"} receive alerts`;
    },
    evaluate: () => {
      const n = env.phoneAlerts().subscriptions;
      return {
        ...(n === 0
          ? { unavailable: { state: "not_configured" as const, note: "No phone is set up for alerts. Without one, an approval waits until you open the dashboard. Setting it up needs the phone itself (Settings > Notifications)." } }
          : { recommended: "Alerts are on" }),
        why: "Alerts carry no content: they only say that something needs your approval. Setting one up needs the phone, so it cannot be done from here.",
        benefits: ["An approval is not left waiting unnoticed"],
        tradeoffs: ["Needs the phone to be paired and reachable"],
        compatibility: ["Real delivery to a phone has not been verified (board NV-5)"],
      };
    },
  });

  // ------------------------------------------------------------ Memory (advice)
  engine.register<string>({
    id: "memory.usage",
    area: "Memory",
    title: "What agents remember",
    level: "intermediate",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/knowledge",
    read: () => {
      const m = env.memory();
      return m.totalBots === 0 ? "No agents" : `${m.botsUsingPrivate} of ${m.totalBots} use their own notes, ${m.botsUsingShared} use shared notes`;
    },
    evaluate: () => {
      const m = env.memory();
      if (m.totalBots === 0) return { unavailable: { state: "not_configured" as const, note: "No agents yet, so there is nothing to remember." }, ...none };
      return {
        recommended: "Shared notes on for the agents that work as a team; private notes where privacy matters",
        why: "Shared notes let teammates reuse facts you approved. Each agent still only sees what you switched on for it. This only reports.",
        benefits: ["Agents stop asking the same questions"],
        tradeoffs: ["Notes are added to the prompt, which uses a little of the free quota"],
        compatibility: [`${m.totalBots} agent${m.totalBots === 1 ? "" : "s"} checked. Memory is set per agent on its Memory tab`],
      };
    },
  });
}
