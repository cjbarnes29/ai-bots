export const CONNECTORS = ["gmail", "telegram", "browser"] as const;
export type Connector = (typeof CONNECTORS)[number];

export const RUNTIMES = ["builtin", "openclaw"] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const STATUSES = ["disabled", "paused", "active"] as const;
export type BotStatus = (typeof STATUSES)[number];

/** The parts of a bot that are saved in version history. */
export interface BotContent {
  name: string;
  role: string;
  personality: string;
  instructions: string;
  responsibilities: string[];
  runtime: Runtime;
  /** "providerId/modelId", e.g. "groq/llama-3.1-8b-instant". Null = no model chosen yet. */
  model: string | null;
  /** 0.0 to 2.0. Null = use the platform default (0.7). */
  temperature: number | null;
  /** 1 to 4096. Null = use the platform default (1,024). */
  maxOutputTokens: number | null;
}

export interface BotRecord extends BotContent {
  id: string;
  status: BotStatus;
  currentVersion: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotVersionRecord extends BotContent {
  version: number;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

export interface PermissionRecord {
  connector: Connector;
  readEnabled: boolean;
  /** Always "approval_required". It cannot be changed. */
  writePolicy: "approval_required";
  updatedAt: string;
}

export interface PermissionAuditRecord {
  id: number;
  connector: Connector;
  field: string;
  oldValue: boolean;
  newValue: boolean;
  actor: string;
  createdAt: string;
}

// AppError now lives in a shared file so other modules can use it. Re-exported for compatibility.
export { AppError } from "../errors.js";
