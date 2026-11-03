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
