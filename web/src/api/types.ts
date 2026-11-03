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
  model: string | null;
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
