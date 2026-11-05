import { createHash } from "node:crypto";

/**
 * Where the application and folder permissions are kept: the existing key-value table (no migration, D-032), as one JSON document plus a
 * checksum. The checksum catches a clumsy edit or a damaged record; it does NOT stop a program running as the same Windows user, which can
 * recompute it (limit L-A1, see docs/ACCESS-CONTROL.md). When the checksum does not match, every decision is DENY until the owner resets.
 */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const OPS = ["read", "create", "edit", "rename", "delete"] as const;
export type FolderOp = (typeof OPS)[number];

export const CAPABILITIES = ["open", "view", "control", "close"] as const;
export type AppCapability = (typeof CAPABILITIES)[number];

export type AppLevel = "unknown" | "approved" | "trusted" | "protected";

export interface FolderGrant {
  id: string;
  /** Who may use it: "workforce" (the built-in agents and the PC agent) or "app:<application id>". */
  subject: string;
  path: string;
  key: string;
  ops: FolderOp[];
  /** false = this folder and its direct entries only; true = everything below it too. Never implied. */
  inherit: boolean;
  /** Set only for a grant on a secret/personal place, and then it names exactly which kind. */
  sensitive: string | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Written once, the first time the app notices the grant ran out. */
  expiryRecorded: boolean;
  note: string;
}

export interface AppRecord {
  id: string;
  name: string;
  exePath: string | null;
  publisher: string | null;
  /** SHA-256 of the program file when it was approved. If the file changes, the approval stops working. */
  sha256: string | null;
  level: AppLevel;
  capabilities: AppCapability[];
  /** Trusted: the date the owner must look at it again. Past it, the approval stops working until re-approved. */
  reviewBy: string | null;
  expiresAt: string | null;
  updatedAt: string;
  updatedBy: string;
  note: string;
}

export interface AccessState {
  v: 1;
  /** Goes up on every revoke, narrowing and reset, so a long-running job can notice that what it was allowed has changed. */
  generation: number;
  folders: FolderGrant[];
  apps: Record<string, AppRecord>;
}

export const EMPTY_STATE = (): AccessState => ({ v: 1, generation: 0, folders: [], apps: {} });

const KEY = "access.state";
const SUM_KEY = "access.state.sum";
const sum = (json: string) => createHash("sha256").update("awp-access-v1\n").update(json).digest("hex");

export class AccessStore {
  private cache: AccessState | null = null;
  private broken: string | null = null;

  constructor(private readonly kv: KeyValue) {}

  /** null = fine. Otherwise the plain-language reason every decision is being denied. */
  tampered(): string | null {
    this.load();
    return this.broken;
  }

  load(): AccessState {
    const raw = this.kv.get(KEY);
    const stored = this.kv.get(SUM_KEY);
    if (raw === null && stored === null) {
      this.broken = null;
      this.cache = EMPTY_STATE();
      return this.cache;
    }
    if (raw === null || stored === null || sum(raw) !== stored) {
      this.broken = "The saved permissions do not match their checksum, so they may have been edited or damaged. Everything is denied until the owner resets them.";
      this.cache = EMPTY_STATE();
      return this.cache;
    }
    try {
      const parsed = JSON.parse(raw) as AccessState;
      if (parsed.v !== 1 || !Array.isArray(parsed.folders) || typeof parsed.apps !== "object") throw new Error("shape");
      this.broken = null;
      this.cache = parsed;
      return parsed;
    } catch {
      this.broken = "The saved permissions could not be read. Everything is denied until the owner resets them.";
      this.cache = EMPTY_STATE();
      return this.cache;
    }
  }

  /** Reads fresh every time: a decision must never use a stale copy after a revoke. */
  state(): AccessState {
    return structuredClone(this.load());
  }

  save(state: AccessState): void {
    if (this.broken !== null) throw new Error("The saved permissions are damaged; reset them first.");
    const json = JSON.stringify(state);
    this.kv.set(KEY, json);
    this.kv.set(SUM_KEY, sum(json));
    this.cache = state;
  }

  /** Owner reset after tampering or damage: forgets every grant and approval (they must be made again). */
  reset(generation: number): void {
    const fresh = { ...EMPTY_STATE(), generation };
    const json = JSON.stringify(fresh);
    this.kv.set(KEY, json);
    this.kv.set(SUM_KEY, sum(json));
    this.broken = null;
    this.cache = fresh;
  }
}
