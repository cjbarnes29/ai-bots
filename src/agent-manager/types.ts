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
  model: string | null;
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

/** Errors we raise on purpose, with an HTTP status the API can return. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
