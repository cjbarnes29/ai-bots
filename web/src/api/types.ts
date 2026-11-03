export const CONNECTORS = ["gmail", "telegram", "browser"] as const;
export type Connector = (typeof CONNECTORS)[number];

export const CONNECTOR_LABELS: Record<Connector, string> = {
  gmail: "Gmail",
  telegram: "Telegram",
  browser: "Browser",
};

export type Runtime = "builtin" | "openclaw";
export type BotStatus = "disabled" | "paused" | "active";

export interface Permission {
  connector: Connector;
  readEnabled: boolean;
  writePolicy: "approval_required";
  updatedAt: string;
}

/** The parts of a bot that are saved in version history. */
export interface BotContent {
  name: string;
  role: string;
  personality: string;
  instructions: string;
  responsibilities: string[];
  runtime: Runtime;
  /** "providerId/modelId", e.g. "groq/llama-3.1-8b-instant". */
  model: string | null;
  /** 0 to 2. Null = platform default (0.7). */
  temperature: number | null;
  /** 1 to 4,096. Null = platform default (1,024). */
  maxOutputTokens: number | null;
}

export interface Bot extends BotContent {
  id: string;
  status: BotStatus;
  currentVersion: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: Permission[];
}

export interface BotVersion extends BotContent {
  version: number;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

export interface PermissionAuditEntry {
  id: number;
  connector: Connector;
  field: string;
  oldValue: boolean;
  newValue: boolean;
  actor: string;
  createdAt: string;
}

export interface UpdateBotInput extends Partial<BotContent> {
  status?: BotStatus;
  changeNote?: string;
}

export interface CreateBotInput extends Partial<BotContent> {
  name: string;
  changeNote?: string;
}

// ---------------- AI models (Phase 2) ----------------

export type FreeStatus = "verified_free" | "free_tier" | "blocked";

export interface ProviderView {
  id: string;
  displayName: string;
  kind: "cloud" | "local";
  connectable: boolean;
  enabled: boolean;
  freeConfirmed: boolean;
  requiresFreeConfirmation: boolean;
  freePolicyLabel: string;
  /** The NAME of the environment variable that holds the key (never the key itself). */
  keyEnv: string | null;
  keyConfigured: boolean;
  baseUrl: string;
  baseUrlEditable: boolean;
  dailyRequestCap: number | null;
  status: string | null;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  modelCount: number;
  enabledModelCount: number;
  requestsToday: number;
}

export interface ModelView {
  id: number;
  providerId: string;
  providerName: string;
  modelId: string;
  /** "providerId/modelId": the value stored on a bot. */
  ref: string;
  displayName: string;
  freeStatus: FreeStatus;
  freeSource: string;
  freeCheckedAt: string;
  contextWindow: number | null;
  enabled: boolean;
  availability: "available" | "not_installed" | "removed" | "unknown";
  isLlama: boolean;
  callable: boolean;
  blockedReason: string | null;
}

export type LimitsMap = Record<string, number>;

export interface LlmStatus {
  paused: boolean;
  /** Always true. There is no way to turn it off. */
  freeOnly: boolean;
  limits: LimitsMap;
  defaults: LimitsMap;
  maxOutputTokensCeiling: number;
}

export interface UsageTotals {
  requests: number;
  tokens: number;
}

export interface UsageSummary {
  today: UsageTotals;
  month: UsageTotals;
  todayCloud: UsageTotals;
  monthCloud: UsageTotals;
  reportedCostMicroThisMonth: number;
  byDay: { day: string; ok: number; errors: number; blocked: number; tokens: number }[];
  byBot: { botId: string | null; botName: string; requests: number; tokens: number }[];
  byModel: { providerId: string; modelId: string; requests: number; tokens: number; errors: number }[];
  recentProblems: {
    createdAt: string;
    status: string;
    errorCode: string | null;
    providerId: string;
    modelId: string;
    botName: string;
    note: string | null;
  }[];
}

export interface Conversation {
  id: string;
  botId: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export interface ChatMessageRecord {
  id: number;
  role: "user" | "assistant";
  content: string;
  botVersion: number;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensEstimated: boolean | null;
  createdAt: string;
}

// ---------------- Collaboration (Phase 3) ----------------

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export const FINAL_TASK_STATUSES: TaskStatus[] = ["completed", "failed", "cancelled"];

export interface TaskRecord {
  id: string;
  rootId: string;
  parentId: string | null;
  assigneeBotId: string;
  assigneeName: string;
  requestedBy: string;
  requestedByName: string;
  /** Who started the chain: you, a schedule, or a trigger. */
  origin: "user" | "schedule" | "trigger";
  originId: string | null;
  originLabel: string | null;
  originDepth: number;
  instruction: string;
  depth: number;
  status: TaskStatus;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskNode extends TaskRecord {
  children: TaskNode[];
}

export interface TaskEvent {
  id: number;
  taskId: string;
  kind: string;
  detail: string;
  createdAt: string;
}

export interface TaskTree {
  task: TaskNode;
  events: TaskEvent[];
  totals: { tasks: number; llmCalls: number; inputTokens: number; outputTokens: number };
}

export interface RootSummary extends TaskRecord {
  chainTasks: number;
  chainLlmCalls: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  responsibilities: string[];
  archived: boolean;
  model: string | null;
  runtime: Runtime;
}

export interface DelegationAuditEntry {
  id: number;
  targetBotId: string;
  targetName: string;
  action: "allowed" | "removed";
  actor: string;
  createdAt: string;
}

export interface DelegationLimitsResponse {
  limits: Record<string, number>;
  defaults: Record<string, number>;
}

export interface ChatReply {
  conversationId: string;
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
  warning: string | null;
}

// ---------------- Automation (Phase 4) ----------------

export type ScheduleKind = "interval" | "daily" | "once";

export interface Schedule {
  id: string;
  name: string;
  botId: string;
  botName: string;
  instruction: string;
  kind: ScheduleKind;
  intervalMinutes: number | null;
  timeOfDay: string | null;
  /** 0 = Sunday ... 6 = Saturday */
  days: number[];
  runAt: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TriggerSource = "event" | "task_result";

export interface Trigger {
  id: string;
  name: string;
  source: TriggerSource;
  eventName: string | null;
  watchBotId: string | null;
  watchBotName: string | null;
  contains: string;
  botId: string;
  botName: string;
  instructionTemplate: string;
  cooldownSeconds: number;
  enabled: boolean;
  lastFiredAt: string | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: number;
  createdAt: string;
  source: "schedule" | "trigger" | "event";
  sourceId: string | null;
  sourceName: string;
  status: "started" | "skipped" | "failed";
  reason: string | null;
  taskId: string | null;
}

export interface AutomationStatus {
  paused: boolean;
  limits: Record<string, number>;
  defaults: Record<string, number>;
  counts: { schedules: number; enabledSchedules: number; triggers: number; enabledTriggers: number };
  runsToday: number;
}

export interface RunOutcome {
  status: "started" | "skipped" | "failed";
  reason?: string;
  taskId?: string;
}

export interface EventOutcome extends RunOutcome {
  triggerId: string | null;
  triggerName: string;
}

/** What the create and edit forms send. Only the fields for the chosen kind are included. */
export type ScheduleInput = {
  name?: string;
  botId?: string;
  instruction?: string;
  kind?: ScheduleKind;
  intervalMinutes?: number;
  timeOfDay?: string;
  days?: number[];
  runAt?: string;
  enabled?: boolean;
};

export type TriggerInput = {
  name?: string;
  source?: TriggerSource;
  eventName?: string;
  watchBotId?: string;
  contains?: string;
  botId?: string;
  instructionTemplate?: string;
  cooldownSeconds?: number;
  enabled?: boolean;
};

// ---- Approvals, outside actions, secrets vault ----
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "executed" | "failed";

export interface Approval {
  id: string;
  botId: string;
  botName: string;
  taskId: string | null;
  connector: string;
  connectorLabel: string;
  action: string;
  summary: string;
  /** The exact content that will be used if you approve. */
  args: unknown;
  status: ApprovalStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  executedAt: string | null;
}

export interface ExternalStatus {
  paused: boolean;
  pendingCount: number;
  connectors: { id: string; label: string; actions: { name: string; kind: "read" | "write"; description: string }[] }[];
  limits: Record<string, number>;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  kind: string;
  actor: string;
  botId: string | null;
  detail: Record<string, unknown>;
}

export interface SecretStatus {
  name: string;
  description: string;
  inVault: boolean;
  inEnv: boolean;
  updatedAt: string | null;
}
