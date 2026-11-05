import type { ModelView, ProviderView } from "../llm/catalog.js";
import type { LimitsConfig, LimitsUpdate } from "../llm/limits.js";
import type { RoutingConfig } from "../routing/config.js";
import type { Evaluation, RecDef, RecommendationEngine } from "./engine.js";

/** Everything the core recommendations may look at or change. Supplied by app.ts; tests supply fakes. */
export interface CoreEnv {
  routing: { get(): RoutingConfig; set(patch: Partial<RoutingConfig>): void };
  limits: { get(): LimitsConfig; set(update: LimitsUpdate): void };
  providers(): ProviderView[];
  models(): ModelView[];
  hardware(): { ramGb: number; cores: number };
  desktopCloudText: { get(): boolean; set(on: boolean): void };
  guardianConfigured(): boolean;
  /** Outside services that need the owner's own account or token. */
  integrations(): { id: string; label: string; notReady: string | null }[];
}

const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const listText = (v: string[]) => (v.length === 0 ? "every real provider that is switched on" : v.join(", "));
const seconds = (ms: number) => `${Math.round(ms / 1000)} seconds`;

/** What really can answer right now: real (not simulated) models that already pass every free-only check. Nothing else is ever recommended as active. */
function realUsable(env: CoreEnv) {
  const simulated = new Set(env.providers().filter((p) => p.simulated).map((p) => p.id));
  const kind = new Map(env.providers().map((p) => [p.id, p.kind]));
  const models = env.models().filter((m) => m.callable && !simulated.has(m.providerId));
  const providerIds = [...new Set(models.map((m) => m.providerId))];
  return { models, providerIds, localOnly: providerIds.length > 0 && providerIds.every((id) => kind.get(id) === "local"), simulated };
}

const NO_REAL_AI = "No real AI model can answer yet. Connect a provider (the Integrations Center), test it and switch a free model on first; until then nothing can be recommended here.";

/** The recommendations for what the application has today. Registered once at start-up; other features register theirs the same way. */
export function registerCoreRecommendations(engine: RecommendationEngine, env: CoreEnv): void {
  const routingFlag = <K extends "enabled" | "autoEnableEligible" | "autoAssignNewBots" | "spreadLoad">(key: K, def: Omit<RecDef<boolean>, "read" | "write" | "kind" | "cost" | "defaultValue" | "customizeAt" | "evaluate">, value: boolean, defaultValue: boolean, text: Pick<Evaluation<boolean>, "why" | "benefits" | "tradeoffs">) =>
    engine.register<boolean>({
      ...def,
      kind: "setting",
      cost: "free",
      defaultValue,
      customizeAt: "/settings/ai-models",
      read: () => env.routing.get()[key],
      write: (v) => env.routing.set({ [key]: v } as Partial<RoutingConfig>),
      format: (v) => (v ? "On" : "Off"),
      evaluate: () => ({ recommended: value, ...text, compatibility: [] }),
    });

  // ------------------------------------------------------------ Model routing
  routingFlag("enabled", { id: "routing.enabled", area: "Model routing", title: "Automatic model routing", level: "beginner" }, true, true, {
    why: "Agents set to Automatic need routing to pick a model. With it off they cannot run.",
    benefits: ["Agents keep working when one provider has a problem", "No need to choose a model for every agent"],
    tradeoffs: ["Agents with a specific model are never affected, so there is no downside for them"],
  });
  routingFlag("autoAssignNewBots", { id: "routing.auto-assign", area: "Model routing", title: "New agents use automatic routing", level: "beginner" }, true, true, {
    why: "A new agent with no model can do nothing. Automatic gives it a working choice from the start.",
    benefits: ["New agents work straight away once a provider is connected"],
    tradeoffs: ["You can still give any agent a specific model on its Details tab"],
  });
  routingFlag("spreadLoad", { id: "routing.spread-load", area: "Model routing", title: "Share work between providers", level: "intermediate" }, true, false, {
    why: "When two verified models are equally good for a task, taking turns uses the free allowance of BOTH providers instead of always starting with the first one.",
    benefits: ["More of the combined free capacity gets used", "One provider's daily limit is reached later"],
    tradeoffs: ["Answers for the same kind of task can come from different models, so wording varies"],
  });
  routingFlag("autoEnableEligible", { id: "routing.auto-enable", area: "Model routing", title: "Switch on newly found free models by themselves", level: "intermediate" }, true, true, {
    why: "Only models that already passed the free-only check are switched on, so new free models become usable without a visit to Settings.",
    benefits: ["New free models are picked up automatically"],
    tradeoffs: ["A model you switched off yourself is never switched back on"],
  });

  engine.register<number>({
    id: "routing.max-attempts",
    area: "Model routing",
    title: "Models to try per task",
    level: "beginner",
    kind: "setting",
    cost: "free",
    defaultValue: 3,
    customizeAt: "/settings/ai-models",
    read: () => env.routing.get().maxAttempts,
    write: (v) => env.routing.set({ maxAttempts: v }),
    format: (v) => `${v} attempt${v === 1 ? "" : "s"}`,
    evaluate: () => {
      const u = realUsable(env);
      if (u.models.length === 0) return { unavailable: { state: "requires_connection", note: NO_REAL_AI }, why: "", benefits: [], tradeoffs: [], compatibility: [] };
      // More attempts than there are different usable models can never help.
      const rec = Math.max(1, Math.min(3, u.models.length));
      return {
        recommended: rec,
        why: `You have ${u.models.length} usable model${u.models.length === 1 ? "" : "s"} across ${u.providerIds.length} provider${u.providerIds.length === 1 ? "" : "s"}. Trying more than that cannot help, and trying more than 3 only spends free daily quota.`,
        benefits: ["Keeps going when one model or provider fails"],
        tradeoffs: ["Each extra attempt uses one request from a free daily allowance"],
        compatibility: [`Usable now: ${u.models.map((m) => m.ref).slice(0, 6).join(", ")}${u.models.length > 6 ? ", ..." : ""}`],
      };
    },
  });

  engine.register<string[]>({
    id: "routing.allowed-providers",
    area: "Model routing",
    title: "Providers automatic routing may use",
    level: "intermediate",
    kind: "setting",
    cost: "free",
    defaultValue: [],
    customizeAt: "/settings/ai-models",
    read: () => env.routing.get().allowedProviders,
    write: (v) => env.routing.set({ allowedProviders: v }),
    format: listText,
    equals: sameSet,
    evaluate: () => {
      const u = realUsable(env);
      const allowed = env.routing.get().allowedProviders;
      if (u.providerIds.length === 0) return { unavailable: { state: "requires_connection", note: NO_REAL_AI }, why: "", benefits: [], tradeoffs: [], compatibility: [] };
      let rec = allowed.filter((id) => !(u.simulated.has(id) && u.providerIds.length > 0));
      let attention: string | undefined;
      if (allowed.length > 0) {
        const missing = u.providerIds.filter((id) => !allowed.includes(id));
        if (missing.length > 0) {
          rec = [...rec, ...missing];
          attention = `${missing.join(", ")} can answer but is not in your list, so automatic routing never uses it.`;
        }
        if (allowed.some((id) => u.simulated.has(id))) attention = `${attention ? `${attention} ` : ""}The simulated Demo AI is ticked although a real AI is available, so some answers could be made up.`;
      }
      return {
        recommended: rec,
        ...(attention ? { attention } : {}),
        why: "An empty list means every real provider that is switched on, so a provider you connect later is used automatically. A list is only needed to exclude one on purpose.",
        benefits: ["No usable provider is left out by mistake", "The simulated Demo AI never stands in for a real one"],
        tradeoffs: ["Adding a provider to the list lets routing send tasks to it"],
        compatibility: [`Providers with a usable model now: ${u.providerIds.join(", ")}`],
      };
    },
  });

  engine.register<string | null>({
    id: "routing.default-model",
    area: "Model routing",
    title: "Model for new agents",
    level: "beginner",
    kind: "setting",
    cost: "free",
    defaultValue: null,
    customizeAt: "/settings/ai-models",
    read: () => env.routing.get().defaultModel,
    write: (v) => env.routing.set({ defaultModel: v }),
    format: (v) => (v === null ? "Automatic (general tasks)" : v),
    evaluate: () => {
      const u = realUsable(env);
      if (u.models.length === 0) return { unavailable: { state: "requires_connection", note: NO_REAL_AI }, why: "", benefits: [], tradeoffs: [], compatibility: [] };
      const cur = env.routing.get().defaultModel;
      const stale = cur !== null && !cur.startsWith("auto/") && !u.models.some((m) => m.ref === cur);
      return {
        recommended: null as string | null,
        ...(stale ? { attention: `${cur} is not usable right now, so new agents would start with a model that cannot answer.` } : {}),
        why: "Automatic follows your routing rules and falls back when a model fails. A fixed model has no fallback.",
        benefits: ["Fallback when a provider is down"],
        tradeoffs: ["You cannot predict which model answers; set a fixed model on an agent that needs one"],
        compatibility: [`${u.models.length} usable model${u.models.length === 1 ? "" : "s"}`],
      };
    },
  });

  engine.register<number>({
    id: "routing.auto-refresh",
    area: "Model routing",
    title: "Look for new models",
    level: "intermediate",
    kind: "setting",
    cost: "free",
    defaultValue: 24,
    customizeAt: "/settings/ai-models",
    read: () => env.routing.get().autoRefreshHours,
    write: (v) => env.routing.set({ autoRefreshHours: v }),
    format: (v) => (v === 0 ? "Only when I press the button" : `Every ${v} hours`),
    evaluate: () => ({
      recommended: 24,
      why: "Reading a model list uses no tokens. Once a day keeps the list current without constant requests.",
      benefits: ["New and removed models are noticed"],
      tradeoffs: ["A model that disappears mid-day is only noticed when a call to it fails (routing then moves on)"],
      compatibility: [],
    }),
  });

  // ------------------------------------------------------------ Usage limits and performance
  engine.register<number>({
    id: "limits.timeout",
    area: "Usage limits",
    title: "How long to wait for an AI answer",
    level: "intermediate",
    kind: "setting",
    cost: "free",
    defaultValue: 60_000,
    customizeAt: "/settings/ai-models",
    read: () => env.limits.get().timeoutMs,
    write: (v) => env.limits.set({ timeoutMs: v }),
    format: seconds,
    evaluate: () => {
      const u = realUsable(env);
      const hw = env.hardware();
      const slow = u.localOnly && hw.cores < 16; // a model on this PC's processor can take minutes for a long answer
      return {
        recommended: slow ? 180_000 : 60_000,
        why: slow ? `Only a model on this PC is available, and it runs on the processor (${hw.cores} cores), so a long answer can take minutes. 60 seconds would cut it off.` : "Cloud providers normally answer within seconds; 60 seconds is generous and stops a stuck call from blocking an agent.",
        benefits: [slow ? "Slow local answers are not cut off" : "A stuck call is given up on quickly"],
        tradeoffs: [slow ? "A genuinely stuck call takes 3 minutes to give up" : "A very slow model could be cut off"],
        compatibility: [u.providerIds.length === 0 ? "No real provider connected yet: the standard value is recommended" : `Real providers in use: ${u.providerIds.join(", ")}${u.localOnly ? " (all on this PC)" : ""}`],
      };
    },
  });

  engine.register<number>({
    id: "limits.local-concurrency",
    area: "Performance",
    title: "Local models running at once",
    level: "advanced",
    kind: "setting",
    cost: "free",
    defaultValue: 1,
    customizeAt: "/settings/ai-models",
    read: () => env.limits.get().maxConcurrentLocal,
    write: (v) => env.limits.set({ maxConcurrentLocal: v }),
    format: (v) => `${v} at a time`,
    evaluate: () => {
      const hw = env.hardware();
      const two = hw.ramGb >= 32 && hw.cores >= 8;
      return {
        recommended: two ? 2 : 1,
        why: two ? `This PC has ${hw.ramGb} GB of memory and ${hw.cores} cores, enough to run two local answers together.` : `This PC has ${hw.ramGb} GB of memory and ${hw.cores} cores. Two local models at once would compete for memory and make both slow.`,
        benefits: [two ? "Two tasks can use a local model together" : "Each local answer gets the whole processor and enough memory"],
        tradeoffs: [two ? "Each answer is a little slower" : "Local tasks wait their turn"],
        compatibility: [`Measured on this PC: ${hw.ramGb} GB memory, ${hw.cores} cores`],
      };
    },
  });

  // ------------------------------------------------------------ Desktop and security
  engine.register<boolean>({
    id: "desktop.cloud-text",
    area: "Desktop",
    title: "Send screen text from desktop programs to cloud AI",
    level: "beginner",
    kind: "setting",
    cost: "free",
    defaultValue: false,
    customizeAt: "/access",
    read: () => env.desktopCloudText.get(),
    write: (v) => env.desktopCloudText.set(v),
    format: (v) => (v ? "Allowed" : "Not allowed"),
    evaluate: () => ({
      recommended: false,
      why: "Text on your screen can include private things. Free cloud tiers may use what you send to improve their products, so screen text stays on this PC unless you decide otherwise.",
      benefits: ["Private screen content never leaves this PC"],
      tradeoffs: ["Desktop tasks can only use a model that runs on this PC"],
      compatibility: ["Applies to the Desktop engine only"],
    }),
  });

  engine.register<string>({
    id: "desktop.runtime",
    area: "Desktop",
    title: "Where desktop automation should run",
    level: "intermediate",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/access",
    read: () => "Local Windows, disposable test windows only",
    evaluate: () => {
      const hw = env.hardware();
      const left = Math.max(0, Math.round((hw.ramGb - 4) * 10) / 10);
      return {
        recommended: "Local Windows, disposable test windows only",
        attention: "Isolation in a VMware virtual machine is not built or verified yet, so desktop automation is for supervised testing on this PC only.",
        why: "The Local Windows engine exists and is tested on disposable windows. The VMware option does not exist yet (the firewall audit and the dedicated account are not done).",
        benefits: ["Works today, with your approval for every plan"],
        tradeoffs: ["Not isolated from your own session: never point it at a window you have open"],
        compatibility: [`This PC: ${hw.ramGb} GB memory and ${hw.cores} cores. A future guest would need about 4 GB, leaving about ${left} GB (an estimate, nothing was measured)`, "VMware: not built (board NV-10)"],
      };
    },
  });

  engine.register<string>({
    id: "security.guardian",
    area: "Security",
    title: "Guardian (the emergency stop)",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/settings/security",
    read: () => (env.guardianConfigured() ? "Connected" : "Not set up"),
    evaluate: () => ({
      recommended: "Connected",
      ...(env.guardianConfigured() ? {} : { attention: "The Guardian is not set up. That is acceptable while you are present, but nothing pauses when you step away and owner actions are not protected against scripts on this PC." }),
      why: "The Guardian is a separate program that can pause everything. It is required before anything runs unattended.",
      benefits: ["Pauses all agents when the session locks or you are idle"],
      tradeoffs: ["Needs a passphrase and a separate program running"],
      compatibility: ["Steps: docs/GUARDIAN.md section 8"],
    }),
  });

  // ------------------------------------------------------------ AI providers and integrations (advice)
  engine.register<string>({
    id: "providers.connect",
    area: "AI models",
    title: "Connect a real AI provider",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/integrations",
    read: () => {
      const u = realUsable(env);
      return u.providerIds.length === 0 ? "None connected" : u.providerIds.join(", ");
    },
    evaluate: () => {
      const u = realUsable(env);
      if (u.providerIds.length > 0) {
        return { recommended: u.providerIds.join(", "), why: "At least one real provider can answer. A second one gives routing something to fall back to.", benefits: ["Fallback needs two providers"], tradeoffs: ["Each provider needs its own free account"], compatibility: [`Usable models: ${u.models.length}`] };
      }
      return {
        unavailable: { state: "requires_connection" as const, note: "No real AI is connected, so agents can only give simulated answers. Ollama (on this PC) or a free Gemini or Groq key would fix that." },
        why: "Ollama runs on this PC with no account (it must be installed first, which needs your approval). Gemini and Groq have free tiers that need your own key and your confirmation that no billing is attached.",
        benefits: ["Real answers", "All three can be used without paying"],
        tradeoffs: ["Free tiers have daily limits and some use your content to improve their products", "Ollama is slower on a PC without a graphics card"],
        compatibility: ["Nothing is installed or paid for by this app"],
      };
    },
  });

  engine.register<string>({
    id: "hardware.local-models",
    area: "Performance",
    title: "Size of local models this PC can run",
    level: "intermediate",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/integrations",
    read: () => `${env.hardware().ramGb} GB memory, ${env.hardware().cores} cores`,
    evaluate: () => {
      const hw = env.hardware();
      const tier = hw.ramGb >= 32 ? "up to about 14 billion parameters" : hw.ramGb >= 16 ? "up to about 8 billion parameters" : hw.ramGb >= 8 ? "up to about 3 billion parameters" : "none comfortably";
      return {
        recommended: `Models ${tier}`,
        ...(hw.ramGb < 8 ? { attention: "Less than 8 GB of memory: local models are likely to be too slow or fail to load." } : {}),
        why: "A rule of thumb: a model should use no more than about half of the memory so the rest of Windows keeps working.",
        benefits: ["Avoids a PC that freezes while a model loads"],
        tradeoffs: ["Smaller models give weaker answers"],
        compatibility: [`Measured memory: ${hw.ramGb} GB. The size guidance is a rule of thumb and has not been tested on this PC (board NV-13)`],
      };
    },
  });

  engine.register<string>({
    id: "integrations.next",
    area: "Integrations",
    title: "Outside services to connect",
    level: "beginner",
    kind: "advice",
    cost: "free",
    defaultValue: "",
    customizeAt: "/integrations",
    read: () => {
      const all = env.integrations();
      return `${all.filter((i) => !i.notReady).length} of ${all.length} set up`;
    },
    evaluate: () => {
      const todo = env.integrations().filter((i) => i.notReady);
      return {
        ...(todo.length === 0 ? { recommended: "Everything you can connect is set up" } : { unavailable: { state: "requires_connection" as const, note: `Not set up: ${todo.map((i) => i.label).join(", ")}. Connect only the ones you will use.` } }),
        why: "Each service is optional. Connect one at a time, and only the ones your workflows need. The Integrations Center has a helper that maps a goal to the services it needs.",
        benefits: ["Fewer saved credentials means less to protect"],
        tradeoffs: ["Anything not connected cannot be used by agents"],
        compatibility: todo.length === 0 ? [] : [`Not set up: ${todo.map((i) => i.label).join(", ")}. All need your own account or token; nothing here is bought for you`],
      };
    },
  });
}
