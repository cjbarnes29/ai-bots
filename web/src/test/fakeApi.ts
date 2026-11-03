import {
  CONNECTORS,
  type Bot,
  type BotContent,
  type BotVersion,
  type ChatMessageRecord,
  type AutomationRun,
  type Conversation,
  type EventOutcome,
  type RunOutcome,
  type Schedule,
  type Trigger,
  type DelegationAuditEntry,
  type TaskNode,
  type TaskTree,
  type TeamMember,
  type LlmStatus,
  type ModelView,
  type PermissionAuditEntry,
  type ProviderView,
  type UsageSummary,
  type Approval,
  type AuditEvent,
  type SecretStatus,
} from "../api/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export function makeBot(overrides: Partial<Bot> = {}): Bot {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: "Helper",
    role: "",
    personality: "",
    instructions: "",
    responsibilities: [],
    runtime: "builtin",
    model: null,
    temperature: null,
    maxOutputTokens: null,
    status: "disabled",
    currentVersion: 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
    permissions: CONNECTORS.map((connector) => ({
      connector,
      readEnabled: false,
      writePolicy: "approval_required" as const,
      updatedAt: now,
    })),
    ...overrides,
  };
}

export function makeProvider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: "gemini",
    displayName: "Google Gemini",
    kind: "cloud",
    connectable: true,
    enabled: false,
    freeConfirmed: false,
    requiresFreeConfirmation: true,
    freePolicyLabel: "Free tier: free only while your Google project has no billing account",
    keyEnv: "GEMINI_API_KEY",
    keyConfigured: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    baseUrlEditable: false,
    dailyRequestCap: 50,
    status: null,
    statusMessage: null,
    lastCheckedAt: null,
    modelCount: 0,
    enabledModelCount: 0,
    requestsToday: 0,
    ...overrides,
  };
}

let modelCounter = 0;
export function makeModel(overrides: Partial<ModelView> = {}): ModelView {
  const providerId = overrides.providerId ?? "gemini";
  const modelId = overrides.modelId ?? `model-${++modelCounter}`;
  return {
    id: overrides.id ?? ++modelCounter + 1000,
    providerId,
    providerName: providerId === "groq" ? "Groq" : providerId === "ollama" ? "Ollama (local)" : providerId === "openrouter" ? "OpenRouter" : "Google Gemini",
    modelId,
    ref: `${providerId}/${modelId}`,
    displayName: modelId,
    freeStatus: "free_tier",
    freeSource: "Free tier, you confirm the account has no billing",
    freeCheckedAt: new Date().toISOString(),
    contextWindow: null,
    enabled: true,
    availability: "available",
    isLlama: false,
    callable: true,
    blockedReason: null,
    ...overrides,
  };
}

export function defaultProviders(): ProviderView[] {
  return [
    makeProvider(),
    makeProvider({ id: "groq", displayName: "Groq", keyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", freePolicyLabel: "Free plan: free only while your Groq account has no payment method" }),
    makeProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      requiresFreeConfirmation: false,
      keyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      dailyRequestCap: 40,
      freePolicyLabel: "Only models ending in :free with a live price of exactly 0 (never buy credits)",
    }),
    makeProvider({
      id: "ollama",
      displayName: "Ollama (local)",
      kind: "local",
      requiresFreeConfirmation: false,
      keyEnv: null,
      keyConfigured: true,
      baseUrl: "http://127.0.0.1:11434/v1",
      baseUrlEditable: true,
      dailyRequestCap: null,
      freePolicyLabel: "Runs on this PC: no cost, no data leaves your computer",
    }),
  ];
}

export const DEFAULT_LIMITS: Record<string, number> = {
  globalDailyRequests: 100,
  globalMonthlyRequests: 2000,
  globalDailyTokens: 200000,
  globalMonthlyTokens: 2000000,
  botDailyRequests: 30,
  botMonthlyRequests: 600,
  botDailyTokens: 50000,
  botMonthlyTokens: 500000,
  botRequestsPerMinute: 6,
  providerRequestsPerMinute: 10,
  maxOutputTokensDefault: 1024,
  maxPromptTokens: 12000,
  maxMessageChars: 8000,
  historyMessages: 20,
  maxConcurrentCloud: 2,
  maxConcurrentLocal: 1,
  timeoutMs: 60000,
  retries: 1,
  retryDelayMs: 2000,
  retryDelayMaxMs: 30000,
  breakerFailures: 3,
  breakerOpenMs: 60000,
};

export const EMPTY_USAGE: UsageSummary = {
  today: { requests: 0, tokens: 0 },
  month: { requests: 0, tokens: 0 },
  todayCloud: { requests: 0, tokens: 0 },
  monthCloud: { requests: 0, tokens: 0 },
  reportedCostMicroThisMonth: 0,
  byDay: [],
  byBot: [],
  byModel: [],
  recentProblems: [],
};

function contentOf(b: BotContent): BotContent {
  return {
    name: b.name,
    role: b.role,
    personality: b.personality,
    instructions: b.instructions,
    responsibilities: b.responsibilities,
    runtime: b.runtime,
    model: b.model,
    temperature: b.temperature,
    maxOutputTokens: b.maxOutputTokens,
  };
}

export interface FakeApiOptions {
  providers?: ProviderView[];
  models?: ModelView[];
  usage?: UsageSummary;
}

/**
 * A tiny in-memory imitation of the real backend, used only by tests.
 * It follows the same rules (versions, restore, archive, permissions, no activation,
 * free-only, locked addresses...).
 */
export function createFakeApi(initial: Bot[] = [], options: FakeApiOptions = {}) {
  const bots = new Map<string, Bot>();
  const versions = new Map<string, BotVersion[]>();
  const audit = new Map<string, PermissionAuditEntry[]>();
  const requests: RecordedRequest[] = [];
  let auditId = 1;

  // ---- AI models state (tests can read and change it) ----
  const llm = {
    providers: new Map<string, ProviderView>((options.providers ?? defaultProviders()).map((p) => [p.id, p])),
    models: [...(options.models ?? [])],
    status: { paused: false, freeOnly: true, limits: { ...DEFAULT_LIMITS }, defaults: { ...DEFAULT_LIMITS }, maxOutputTokensCeiling: 4096 } as LlmStatus,
    usage: options.usage ?? EMPTY_USAGE,
    /** What "Refresh models" adds, per provider id. */
    refreshable: {} as Record<string, ModelView[]>,
    /** What "Test connection" reports, per provider id. */
    testResult: {} as Record<string, { status: string; message: string }>,
    conversations: new Map<string, Conversation[]>(),
    messages: new Map<string, ChatMessageRecord[]>(),
    /** Queue of replies for the chat endpoint. Each is a function returning a response. When empty: an echo. */
    chatQueue: [] as ((botId: string, body: any) => Response)[],
  };

  // ---- collaboration state (tests can read and change it) ----
  const collab = {
    teams: new Map<string, TeamMember[]>(),
    audit: new Map<string, DelegationAuditEntry[]>(),
    /** Task chains by root id, oldest first. Tests can edit a chain to simulate progress. */
    trees: new Map<string, TaskTree>(),
    limits: { maxDepth: 2, maxSubtasksPerTask: 3, maxTasksPerChain: 5, maxLlmCallsPerChain: 8, maxInstructionChars: 4000 } as Record<string, number>,
  };
  const DEFAULT_COLLAB_LIMITS = { ...collab.limits };

  const addVersion = (b: Bot, note: string | null, restoredFrom: number | null = null) => {
    const list = versions.get(b.id) ?? [];
    list.unshift({ ...contentOf(b), version: b.currentVersion, changeNote: note, restoredFrom, createdAt: new Date().toISOString() });
    versions.set(b.id, list);
  };

  const seed = (b: Bot, note = "Created") => {
    bots.set(b.id, b);
    addVersion(b, note);
  };
  initial.forEach((b) => seed(b));

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, error: string, message: string) => json({ error, message }, status);
  const validation = (path: string, message: string) =>
    json({ error: "validation_error", message: "Invalid input", issues: [{ path, message }] }, 400);

  const providerView = (p: ProviderView): ProviderView => {
    const mine = llm.models.filter((m) => m.providerId === p.id);
    return { ...p, modelCount: mine.length, enabledModelCount: mine.filter((m) => m.enabled).length };
  };

  const handleLlm = (method: string, parts: string[], url: URL, body: any): Response => {
    const [, , area, id, action] = parts; // ["api","llm", area, id, action]
    if (area === "status" && method === "GET") return json(llm.status);
    if (area === "pause" && method === "PUT") {
      if (typeof body?.paused !== "boolean") return validation("paused", "Expected boolean");
      llm.status = { ...llm.status, paused: body.paused };
      return json(llm.status);
    }
    if (area === "limits") {
      if (id === "reset" && method === "POST") {
        llm.status = { ...llm.status, limits: { ...DEFAULT_LIMITS } };
        return json(llm.status);
      }
      if (method === "PUT") {
        for (const [k, v] of Object.entries(body ?? {})) {
          if (!(k in DEFAULT_LIMITS)) return validation(k, "Unrecognized key");
          if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return validation(k, "Must be a positive whole number");
          if (k === "maxOutputTokensDefault" && v > 4096) return validation(k, "Too big: at most 4096");
        }
        llm.status = { ...llm.status, limits: { ...llm.status.limits, ...body } };
        return json(llm.status);
      }
    }
    if (area === "providers") {
      if (!id && method === "GET") return json({ providers: [...llm.providers.values()].map(providerView) });
      const p = id ? llm.providers.get(id) : undefined;
      if (!p) return err(404, "provider_not_found", "Provider not found");
      if (!action && method === "PATCH") {
        const next = { ...p };
        if (body.baseUrl !== undefined) {
          if (!p.baseUrlEditable) return err(400, "base_url_locked", "The address is fixed and cannot be changed.");
          if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(body.baseUrl)) {
            return err(400, "invalid_base_url", "The local provider's address must be on this PC (127.0.0.1 or localhost).");
          }
          next.baseUrl = body.baseUrl.replace(/\/+$/, "");
        }
        if (body.dailyRequestCap !== undefined) next.dailyRequestCap = body.dailyRequestCap;
        if (body.freeConfirmed !== undefined) {
          next.freeConfirmed = body.freeConfirmed;
          if (!body.freeConfirmed) next.enabled = false;
        }
        if (body.enabled === true) {
          if (p.requiresFreeConfirmation && !next.freeConfirmed) {
            return err(409, "free_not_confirmed", `First confirm that your ${p.displayName} account has no billing.`);
          }
          next.enabled = true;
        } else if (body.enabled === false) next.enabled = false;
        llm.providers.set(p.id, next);
        return json({ provider: providerView(next) });
      }
      if (action === "test" && method === "POST") {
        const result = llm.testResult[p.id] ?? { status: "connected", message: "Connected. The provider lists 3 models." };
        const next = { ...p, status: result.status, statusMessage: result.message, lastCheckedAt: new Date().toISOString() };
        llm.providers.set(p.id, next);
        return json({ provider: providerView(next) });
      }
      if (action === "refresh-models" && method === "POST") {
        if (p.kind === "cloud" && !p.keyConfigured) return err(409, "llm_key_missing", `No API key found for ${p.displayName}.`);
        for (const m of llm.refreshable[p.id] ?? []) {
          if (!llm.models.some((x) => x.ref === m.ref)) llm.models.push({ ...m, enabled: false, callable: false, blockedReason: "This model is switched off. Enable it in Settings." });
        }
        const next = { ...p, status: "connected", statusMessage: "Connected.", lastCheckedAt: new Date().toISOString() };
        llm.providers.set(p.id, next);
        return json({ provider: providerView(next), models: llm.models.filter((m) => m.providerId === p.id) });
      }
    }
    if (area === "models") {
      if (!id && method === "GET") return json({ models: llm.models });
      const m = llm.models.find((x) => String(x.id) === id);
      if (!m) return err(404, "model_not_found", "Model not found");
      if (method === "PATCH") {
        if (body.enabled && m.freeStatus === "blocked") return err(409, "model_blocked", "This model is blocked (paid or unverified).");
        m.enabled = body.enabled;
        const provider = llm.providers.get(m.providerId);
        m.callable = m.enabled && !!provider?.enabled && (!provider.requiresFreeConfirmation || provider.freeConfirmed) && m.freeStatus !== "blocked" && m.availability === "available";
        m.blockedReason = m.callable ? null : "This model is switched off or its provider is not ready.";
        return json({ model: m });
      }
    }
    if (area === "usage" && method === "GET") return json({ usage: llm.usage });
    return err(404, "not_found", "Not found");
  };

  const handleChat = (method: string, bot: Bot, parts: string[], body: any): Response | null => {
    const sub = parts[3];
    if (sub === "conversations" && method === "GET") {
      if (!parts[4]) return json({ conversations: llm.conversations.get(bot.id) ?? [] });
      if (parts[5] === "messages") return json({ messages: llm.messages.get(parts[4]!) ?? [] });
    }
    if (sub === "chat" && method === "POST") {
      if (bot.archived) return err(409, "bot_archived", "This bot is archived. Unarchive it to chat.");
      if (!bot.model) return err(409, "llm_no_model_selected", "Choose a model for this bot on the Details tab first.");
      const queued = llm.chatQueue.shift();
      if (queued) return queued(bot.id, body);

      const now = new Date().toISOString();
      let convId: string = body.conversationId;
      const list = llm.conversations.get(bot.id) ?? [];
      if (!convId) {
        convId = crypto.randomUUID();
        list.unshift({ id: convId, botId: bot.id, title: String(body.message).slice(0, 60), createdAt: now, messageCount: 0 });
        llm.conversations.set(bot.id, list);
      }
      const msgs = llm.messages.get(convId) ?? [];
      const mk = (role: "user" | "assistant", content: string): ChatMessageRecord => ({
        id: msgs.length + 1 + Math.floor(Math.random() * 1e6),
        role,
        content,
        botVersion: bot.currentVersion,
        providerId: role === "assistant" ? bot.model!.split("/")[0]! : null,
        modelId: role === "assistant" ? bot.model!.split("/").slice(1).join("/") : null,
        inputTokens: role === "assistant" ? 21 : null,
        outputTokens: role === "assistant" ? 9 : null,
        tokensEstimated: role === "assistant" ? false : null,
        createdAt: now,
      });
      const userMessage = mk("user", String(body.message));
      const assistantMessage = mk("assistant", `Echo: ${body.message}`);
      msgs.push(userMessage, assistantMessage);
      llm.messages.set(convId, msgs);
      const conv = list.find((c) => c.id === convId);
      if (conv) conv.messageCount = msgs.length;
      return json({ conversationId: convId, userMessage, assistantMessage, warning: null });
    }
    return null;
  };

  const handleCollab = (method: string, parts: string[], body: any, bot?: Bot): Response | null => {
    // bots/:id/delegation and bots/:id/tasks
    if (bot && parts[3] === "delegation") {
      if (method === "GET") return json({ targets: collab.teams.get(bot.id) ?? [], audit: collab.audit.get(bot.id) ?? [] });
      if (method === "PUT") {
        const ids: string[] = body?.targetBotIds ?? [];
        if (ids.includes(bot.id)) return err(400, "invalid_teammate", "A bot cannot delegate to itself.");
        const members: TeamMember[] = [];
        for (const id of ids) {
          const b = bots.get(id);
          if (!b) return err(400, "invalid_teammate", "One of the chosen teammates does not exist.");
          members.push({ id: b.id, name: b.name, role: b.role, responsibilities: b.responsibilities, archived: b.archived, model: b.model, runtime: b.runtime });
        }
        const before = new Set((collab.teams.get(bot.id) ?? []).map((m) => m.id));
        const log = collab.audit.get(bot.id) ?? [];
        for (const m of members) if (!before.has(m.id)) log.unshift({ id: log.length + 1, targetBotId: m.id, targetName: m.name, action: "allowed", actor: "local-user", createdAt: new Date().toISOString() });
        for (const id of before) if (!ids.includes(id)) log.unshift({ id: log.length + 1, targetBotId: id, targetName: bots.get(id)?.name ?? "?", action: "removed", actor: "local-user", createdAt: new Date().toISOString() });
        collab.teams.set(bot.id, members);
        collab.audit.set(bot.id, log);
        return json({ targets: members, audit: log });
      }
    }
    if (bot && parts[3] === "tasks" && method === "POST") {
      if (!String(body?.instruction ?? "").trim()) return err(400, "empty_instruction", "Describe the task first.");
      if (bot.archived) return err(409, "bot_archived", `${bot.name} is archived. Unarchive it first.`);
      if (!bot.model) return err(409, "llm_no_model_selected", `${bot.name} has no model. Choose one on its Details tab first.`);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const task: TaskNode = {
        id, rootId: id, parentId: null, assigneeBotId: bot.id, assigneeName: bot.name, requestedBy: "user", requestedByName: "You", origin: "user", originId: null, originLabel: null, originDepth: 0,
        instruction: String(body.instruction).trim(), depth: 0, status: "pending", result: null, errorCode: null, errorMessage: null,
        llmCalls: 0, inputTokens: 0, outputTokens: 0, createdAt: now, startedAt: null, finishedAt: null, children: [],
      };
      collab.trees.set(id, { task, events: [{ id: 1, taskId: id, kind: "created", detail: JSON.stringify({ assignee: bot.name }), createdAt: now }], totals: { tasks: 1, llmCalls: 0, inputTokens: 0, outputTokens: 0 } });
      return json({ task }, 202);
    }
    if (parts[1] === "tasks") {
      if (!parts[2] && method === "GET") {
        const roots = [...collab.trees.values()].reverse().map((t) => ({ ...t.task, children: undefined, chainTasks: t.totals.tasks, chainLlmCalls: t.totals.llmCalls }));
        return json({ tasks: roots });
      }
      const tree = parts[2] ? collab.trees.get(parts[2]) : undefined;
      if (!tree) return err(404, "task_not_found", "Task not found");
      if (!parts[3] && method === "GET") return json(tree);
      if (parts[3] === "cancel" && method === "POST") {
        const stop = (n: TaskNode) => {
          if (n.status === "pending" || n.status === "running") n.status = "cancelled";
          n.children.forEach(stop);
        };
        stop(tree.task);
        return json({ task: tree.task });
      }
    }
    if (parts[1] === "delegation" && parts[2] === "limits") {
      if (method === "GET") return json({ limits: collab.limits, defaults: DEFAULT_COLLAB_LIMITS });
      if (method === "POST" && parts[3] === "reset") {
        collab.limits = { ...DEFAULT_COLLAB_LIMITS };
        return json({ limits: collab.limits, defaults: DEFAULT_COLLAB_LIMITS });
      }
      if (method === "PUT") {
        const ceilings: Record<string, number> = { maxDepth: 4, maxSubtasksPerTask: 6, maxTasksPerChain: 15, maxLlmCallsPerChain: 30, maxInstructionChars: 20000 };
        for (const [k, v] of Object.entries(body ?? {})) {
          if (!(k in ceilings)) return validation(k, "Unrecognized key");
          if (typeof v !== "number" || v > ceilings[k]!) return validation(k, `Too big: at most ${ceilings[k]}`);
        }
        collab.limits = { ...collab.limits, ...body };
        return json({ limits: collab.limits, defaults: DEFAULT_COLLAB_LIMITS });
      }
    }
    return null;
  };

  // ---- automation state (tests can read and change it) ----
  const auto = {
    schedules: [] as Schedule[],
    triggers: [] as Trigger[],
    runs: [] as AutomationRun[],
    paused: false,
    runsToday: 0,
    limits: { minIntervalMinutes: 15, maxRunsPerDay: 20, maxRunsPerSourcePerDay: 10, maxConsecutiveFailures: 3, maxHops: 2, minCooldownSeconds: 30 } as Record<string, number>,
    /** What "Send event" and "Run now" answer. Tests can replace these. */
    runNowOutcome: { status: "started", taskId: "11111111-1111-4111-8111-111111111111" } as RunOutcome,
    eventOutcomes: [{ status: "skipped", reason: "No enabled trigger matched this event.", triggerId: null, triggerName: "(none)" }] as EventOutcome[],
  };
  const DEFAULT_AUTO_LIMITS = { ...auto.limits };
  const autoStatus = () => ({
    paused: auto.paused,
    limits: auto.limits,
    defaults: DEFAULT_AUTO_LIMITS,
    counts: {
      schedules: auto.schedules.length,
      enabledSchedules: auto.schedules.filter((s) => s.enabled).length,
      triggers: auto.triggers.length,
      enabledTriggers: auto.triggers.filter((t) => t.enabled).length,
    },
    runsToday: auto.runsToday,
  });

  const handleAuto = (method: string, parts: string[], body: any): Response | null => {
    const area = parts[1];
    if (area === "automation") {
      if (parts[2] === "status" && method === "GET") return json(autoStatus());
      if (parts[2] === "runs" && method === "GET") return json({ runs: auto.runs });
      if (parts[2] === "pause" && method === "PUT") {
        auto.paused = !!body.paused;
        return json(autoStatus());
      }
      if (parts[2] === "limits" && parts[3] === "reset" && method === "POST") {
        auto.limits = { ...DEFAULT_AUTO_LIMITS };
        return json(autoStatus());
      }
      if (parts[2] === "limits" && method === "PUT") {
        const ceilings: Record<string, number> = { minIntervalMinutes: 1440, maxRunsPerDay: 200, maxRunsPerSourcePerDay: 100, maxConsecutiveFailures: 10, maxHops: 4, minCooldownSeconds: 3600 };
        for (const [k, v] of Object.entries(body ?? {})) {
          if (!(k in ceilings)) return validation(k, "Unrecognized key");
          if (typeof v !== "number" || v > ceilings[k]!) return validation(k, `Too big: at most ${ceilings[k]}`);
        }
        auto.limits = { ...auto.limits, ...body };
        return json(autoStatus());
      }
    }
    if (area === "schedules") {
      const id = parts[2];
      const s = id ? auto.schedules.find((x) => x.id === id) : undefined;
      if (!id && method === "GET") return json({ schedules: auto.schedules });
      if (!id && method === "POST") {
        if (body.kind === "interval" && body.intervalMinutes < auto.limits["minIntervalMinutes"]!) {
          return err(400, "interval_too_short", `Runs must be at least ${auto.limits["minIntervalMinutes"]} minutes apart (this protects your free-tier limits).`);
        }
        const bot = bots.get(body.botId);
        if (!bot) return err(400, "invalid_bot", "The chosen bot does not exist.");
        const now = new Date().toISOString();
        const created: Schedule = {
          id: crypto.randomUUID(), name: body.name, botId: body.botId, botName: bot.name, instruction: body.instruction, kind: body.kind,
          intervalMinutes: body.kind === "interval" ? body.intervalMinutes : null, timeOfDay: body.kind === "daily" ? body.timeOfDay : null,
          days: body.kind === "daily" ? (body.days ?? [0, 1, 2, 3, 4, 5, 6]) : [0, 1, 2, 3, 4, 5, 6], runAt: body.kind === "once" ? body.runAt : null,
          enabled: false, nextRunAt: null, lastRunAt: null, consecutiveFailures: 0, disabledReason: null, createdAt: now, updatedAt: now,
        };
        auto.schedules.push(created);
        return json({ schedule: created }, 201);
      }
      if (!s) return err(404, "schedule_not_found", "Schedule not found");
      if (!parts[3] && method === "GET") return json({ schedule: s });
      if (!parts[3] && method === "DELETE") {
        auto.schedules = auto.schedules.filter((x) => x.id !== id);
        return new Response(null, { status: 204 });
      }
      if (!parts[3] && method === "PATCH") {
        if (body.enabled === true) {
          const bot = bots.get(body.botId ?? s.botId);
          if (!bot?.model) return err(409, "bot_not_ready", `${bot?.name ?? "That bot"} has no model yet. Choose one on its Details tab.`);
          s.nextRunAt = new Date(Date.now() + (s.intervalMinutes ?? 60) * 60_000).toISOString();
          s.consecutiveFailures = 0;
          s.disabledReason = null;
        }
        if (body.enabled === false) s.nextRunAt = null;
        if (body.kind === "interval" && body.intervalMinutes < auto.limits["minIntervalMinutes"]!) {
          return err(400, "interval_too_short", `Runs must be at least ${auto.limits["minIntervalMinutes"]} minutes apart (this protects your free-tier limits).`);
        }
        Object.assign(s, body);
        if (body.botId) s.botName = bots.get(body.botId)?.name ?? s.botName;
        return json({ schedule: s });
      }
      if (parts[3] === "run-now" && method === "POST") return json({ outcome: auto.runNowOutcome });
    }
    if (area === "triggers") {
      const id = parts[2];
      const t = id ? auto.triggers.find((x) => x.id === id) : undefined;
      if (!id && method === "GET") return json({ triggers: auto.triggers });
      if (!id && method === "POST") {
        const bot = bots.get(body.botId);
        if (!bot) return err(400, "invalid_bot", "The chosen bot does not exist.");
        if (body.cooldownSeconds < auto.limits["minCooldownSeconds"]!) return err(400, "cooldown_too_short", `The cooldown must be at least ${auto.limits["minCooldownSeconds"]} seconds.`);
        const now = new Date().toISOString();
        const created: Trigger = {
          id: crypto.randomUUID(), name: body.name, source: body.source, eventName: body.source === "event" ? String(body.eventName).toLowerCase() : null,
          watchBotId: body.source === "task_result" ? body.watchBotId : null, watchBotName: body.source === "task_result" ? (bots.get(body.watchBotId)?.name ?? null) : null,
          contains: body.contains ?? "", botId: body.botId, botName: bot.name, instructionTemplate: body.instructionTemplate || "A message arrived:\n\n{{text}}\n\nRespond helpfully.",
          cooldownSeconds: body.cooldownSeconds ?? 300, enabled: false, lastFiredAt: null, consecutiveFailures: 0, disabledReason: null, createdAt: now, updatedAt: now,
        };
        auto.triggers.push(created);
        return json({ trigger: created }, 201);
      }
      if (!t) return err(404, "trigger_not_found", "Trigger not found");
      if (method === "GET") return json({ trigger: t });
      if (method === "DELETE") {
        auto.triggers = auto.triggers.filter((x) => x.id !== id);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        if (body.enabled === true) {
          const bot = bots.get(body.botId ?? t.botId);
          if (!bot?.model) return err(409, "bot_not_ready", `${bot?.name ?? "That bot"} has no model yet. Choose one on its Details tab.`);
        }
        Object.assign(t, body);
        return json({ trigger: t });
      }
    }
    if (area === "events" && method === "POST") {
      if (String(body.text).length > 2000) return err(413, "event_too_long", "That text is too long.");
      return json({ outcomes: auto.eventOutcomes });
    }
    return null;
  };


  // ---- approvals, outside actions, secrets vault (tests can read and change it) ----
  const ext = {
    paused: false,
    approvals: [] as Approval[],
    audit: [] as AuditEvent[],
    secrets: [
      { name: 'GEMINI_API_KEY', description: 'Google Gemini API key', inVault: false, inEnv: false, updatedAt: null },
      { name: 'TELEGRAM_BOT_TOKEN', description: 'Telegram bot token', inVault: false, inEnv: false, updatedAt: null },
    ] as SecretStatus[],
    /** What the secret values were set to (so tests can prove they are never shown). */
    stored: new Map<string, string>(),
    /** When set, approving fails with this message. */
    executeError: null as string | null,
    connectors: [{ id: 'telegram', label: 'Telegram', actions: [{ name: 'send_message', kind: 'write' as const, description: 'Send a message' }] }],
  };
  const extLog = (kind: string, actor: string, detail: Record<string, unknown> = {}) =>
    ext.audit.unshift({ id: ext.audit.length + 1, createdAt: new Date().toISOString(), kind, actor, botId: null, detail });
  const handleExternal = (method: string, parts: string[], url: URL, body: any): Response | null => {
    if (parts[1] === 'external') {
      if (parts[2] === 'status' && method === 'GET')
        return json({ paused: ext.paused, pendingCount: ext.approvals.filter((a) => a.status === 'pending').length, connectors: ext.connectors, limits: {} });
      if (parts[2] === 'pause' && method === 'PUT') {
        ext.paused = !!body.paused;
        extLog(ext.paused ? 'external.paused' : 'external.resumed', 'owner');
        return json({ paused: ext.paused });
      }
    }
    if (parts[1] === 'audit' && method === 'GET') return json({ events: ext.audit });
    if (parts[1] === 'vault') {
      const name = parts[2];
      if (!name && method === 'GET') return json({ secrets: ext.secrets });
      const s = ext.secrets.find((x) => x.name === name);
      if (!s) return err(400, 'unknown_secret', 'That is not a key this app uses.');
      if (method === 'PUT') {
        if (!String(body.value ?? '').trim()) return err(400, 'empty_secret', 'Paste the key first.');
        ext.stored.set(s.name, body.value);
        s.inVault = true;
        s.updatedAt = new Date().toISOString();
        extLog('vault.set', 'owner', { name: s.name });
        return json({ secrets: ext.secrets });
      }
      if (method === 'DELETE') {
        ext.stored.delete(s.name);
        s.inVault = false;
        s.updatedAt = null;
        extLog('vault.delete', 'owner', { name: s.name });
        return json({ secrets: ext.secrets });
      }
    }
    if (parts[1] === 'approvals') {
      const a = parts[2] ? ext.approvals.find((x) => x.id === parts[2]) : undefined;
      if (!parts[2] && method === 'GET') {
        const only = url.searchParams.get('status');
        return json({ approvals: ext.approvals.filter((x) => !only || x.status === only) });
      }
      if (!a) return err(404, 'approval_not_found', 'That request does not exist.');
      if (method === 'GET' && !parts[3]) return json({ approval: a });
      if (method === 'POST' && (parts[3] === 'approve' || parts[3] === 'deny')) {
        if (a.status !== 'pending') return err(409, 'approval_not_pending', 'This request was already decided.');
        if (parts[3] === 'approve' && ext.paused) return err(409, 'external_paused', 'All outside actions are paused. Switch them back on before approving.');
        a.decidedAt = new Date().toISOString();
        a.decidedBy = 'owner';
        if (parts[3] === 'deny') {
          a.status = 'denied';
          a.error = body?.reason ?? null;
          extLog('approval.denied', 'owner');
        } else if (ext.executeError) {
          a.status = 'failed';
          a.error = ext.executeError;
          extLog('approval.failed', 'owner');
        } else {
          a.status = 'executed';
          a.result = 'sent #1';
          a.executedAt = a.decidedAt;
          extLog('approval.executed', 'owner');
        }
        return json({ approval: a });
      }
    }
    return null;
  };

  const handle = (method: string, path: string, body: any): Response => {
    const url = new URL(path, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["api","bots",id,...]
    const id = parts[2];
    const bot = id ? bots.get(id) : undefined;

    if (parts[0] === "api" && ["external", "approvals", "audit", "vault"].includes(parts[1] ?? "")) {
      return handleExternal(method, parts, url, body) ?? err(404, "not_found", "Not found");
    }
    if (parts[0] === "api" && parts[1] === "llm") return handleLlm(method, parts, url, body);
    if (parts[0] === "api" && (parts[1] === "tasks" || parts[1] === "delegation")) {
      return handleCollab(method, parts, body) ?? err(404, "not_found", "Not found");
    }
    if (parts[0] === "api" && ["schedules", "triggers", "events", "automation"].includes(parts[1] ?? "")) {
      return handleAuto(method, parts, body) ?? err(404, "not_found", "Not found");
    }
    if (parts[0] !== "api" || parts[1] !== "bots") return err(404, "not_found", "Not found");

    if (!id) {
      if (method === "GET") {
        const all = url.searchParams.get("includeArchived") === "true";
        return json({ bots: [...bots.values()].filter((b) => all || !b.archived) });
      }
      if (method === "POST") {
        if (!body?.name?.trim()) return json({ error: "validation_error", message: "Invalid input", issues: [{ path: "name", message: "required" }] }, 400);
        const b = makeBot({ ...body, name: body.name.trim() });
        seed(b, body.changeNote ?? "Created");
        return json({ bot: b }, 201);
      }
    }
    if (!bot) return err(404, "bot_not_found", "Bot not found");
    const sub = parts[3];

    const chat = handleChat(method, bot, parts, body);
    if (chat) return chat;
    const team = handleCollab(method, parts, body, bot);
    if (team) return team;

    if (!sub) {
      if (method === "GET") return json({ bot });
      if (method === "DELETE") {
        bot.archived = true;
        bot.status = "disabled";
        return json({ bot });
      }
      if (method === "PATCH") {
        if (bot.archived) return err(409, "bot_archived", "This bot is archived. Unarchive it first.");
        if (body.status === "active") return err(409, "activation_not_available", "Bots cannot be activated yet.");
        const { status, changeNote, ...content } = body;
        const before = JSON.stringify(contentOf(bot));
        Object.assign(bot, content);
        if (JSON.stringify(contentOf(bot)) !== before) {
          bot.currentVersion += 1;
          addVersion(bot, changeNote ?? null);
        }
        if (status) bot.status = status;
        return json({ bot });
      }
    }
    if (sub === "unarchive" && method === "POST") {
      bot.archived = false;
      return json({ bot });
    }
    if (sub === "duplicate" && method === "POST") {
      const copy = makeBot({ ...contentOf(bot), name: `${bot.name} (copy)` });
      seed(copy, `Duplicated from "${bot.name}"`);
      return json({ bot: copy }, 201);
    }
    if (sub === "versions") {
      const list = versions.get(bot.id) ?? [];
      if (!parts[4] && method === "GET") return json({ versions: list });
      const n = Number(parts[4]);
      if (parts[5] === "restore" && method === "POST") {
        const old = list.find((v) => v.version === n);
        if (!old) return err(404, "version_not_found", "Version not found");
        Object.assign(bot, contentOf(old));
        bot.currentVersion += 1;
        addVersion(bot, `Restored from version ${n}`, n);
        return json({ bot });
      }
    }
    if (sub === "permissions") {
      if (parts[4] === "audit" && method === "GET") return json({ audit: audit.get(bot.id) ?? [] });
      if (!parts[4] && method === "GET") return json({ permissions: bot.permissions });
      if (parts[4] && method === "PUT") {
        const p = bot.permissions.find((x) => x.connector === parts[4]);
        if (!p) return err(404, "connector_not_found", "Unknown connector");
        if (body.readEnabled !== p.readEnabled) {
          const list = audit.get(bot.id) ?? [];
          list.unshift({
            id: auditId++,
            connector: p.connector,
            field: "read_enabled",
            oldValue: p.readEnabled,
            newValue: body.readEnabled,
            actor: "local-user",
            createdAt: new Date().toISOString(),
          });
          audit.set(bot.id, list);
          p.readEnabled = body.readEnabled;
        }
        return json({ permissions: bot.permissions });
      }
    }
    return err(404, "not_found", "Not found");
  };

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path, headers, body });
    return handle(method, path, body);
  };

  return {
    fetch: fetchImpl,
    requests,
    bots,
    llm,
    collab,
    auto,
    ext,
    /** Requests that are not plain reads. */
    writes: () => requests.filter((r) => r.method !== "GET"),
  };
}
