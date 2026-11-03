import type { DatabaseSync } from "node:sqlite";
import type { Availability, FreeStatus, ModelInfo } from "./types.js";

type Row = Record<string, unknown>;

export interface ProviderRow {
  id: string;
  enabled: boolean;
  freeConfirmed: boolean;
  dailyRequestCap: number | null;
  baseUrl: string | null;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  lastMessage: string | null;
}

export interface ModelRow {
  id: number;
  providerId: string;
  modelId: string;
  displayName: string;
  freeStatus: FreeStatus;
  freeSource: string;
  freeCheckedAt: string;
  contextWindow: number | null;
  enabled: boolean;
  availability: Availability;
  isLlama: boolean;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toProvider(r: Row): ProviderRow {
  return {
    id: String(r["id"]),
    enabled: Number(r["enabled"]) === 1,
    freeConfirmed: Number(r["free_confirmed"]) === 1,
    dailyRequestCap: r["daily_request_cap"] === null ? null : Number(r["daily_request_cap"]),
    baseUrl: str(r["base_url"]),
    lastStatus: str(r["last_status"]),
    lastCheckedAt: str(r["last_checked_at"]),
    lastMessage: str(r["last_message"]),
  };
}

function toModel(r: Row): ModelRow {
  return {
    id: Number(r["id"]),
    providerId: String(r["provider_id"]),
    modelId: String(r["model_id"]),
    displayName: String(r["display_name"]),
    freeStatus: String(r["free_status"]) as FreeStatus,
    freeSource: String(r["free_source"]),
    freeCheckedAt: String(r["free_checked_at"]),
    contextWindow: r["context_window"] === null ? null : Number(r["context_window"]),
    enabled: Number(r["enabled"]) === 1,
    availability: String(r["availability"]) as Availability,
    isLlama: Number(r["is_llama"]) === 1,
  };
}

export interface ProviderPatch {
  enabled?: boolean;
  freeConfirmed?: boolean;
  dailyRequestCap?: number | null;
  baseUrl?: string | null;
}

/** SQL for providers, models and settings. No business rules here. */
export class LlmRepository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- providers ----
  ensureProvider(id: string, dailyRequestCap: number | null, now: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO llm_providers (id, enabled, free_confirmed, daily_request_cap, created_at, updated_at)
         VALUES (?, 0, 0, ?, ?, ?)`,
      )
      .run(id, dailyRequestCap, now, now);
  }

  listProviders(): ProviderRow[] {
    return this.db.prepare("SELECT * FROM llm_providers ORDER BY created_at, id").all().map(toProvider);
  }

  getProvider(id: string): ProviderRow | undefined {
    const row = this.db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(id);
    return row ? toProvider(row) : undefined;
  }

  updateProvider(id: string, patch: ProviderPatch, now: string): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }
    if (patch.freeConfirmed !== undefined) {
      sets.push("free_confirmed = ?");
      params.push(patch.freeConfirmed ? 1 : 0);
    }
    if (patch.dailyRequestCap !== undefined) {
      sets.push("daily_request_cap = ?");
      params.push(patch.dailyRequestCap);
    }
    if (patch.baseUrl !== undefined) {
      sets.push("base_url = ?");
      params.push(patch.baseUrl);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(now, id);
    this.db.prepare(`UPDATE llm_providers SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  setStatus(id: string, status: string, message: string, now: string): void {
    this.db
      .prepare("UPDATE llm_providers SET last_status = ?, last_message = ?, last_checked_at = ?, updated_at = ? WHERE id = ?")
      .run(status, message, now, now, id);
  }

  // ---- models ----
  listModels(providerId?: string): ModelRow[] {
    const rows =
      providerId === undefined
        ? this.db.prepare("SELECT * FROM llm_models ORDER BY provider_id, display_name").all()
        : this.db.prepare("SELECT * FROM llm_models WHERE provider_id = ? ORDER BY display_name").all(providerId);
    return rows.map(toModel);
  }

  getModel(id: number): ModelRow | undefined {
    const row = this.db.prepare("SELECT * FROM llm_models WHERE id = ?").get(id);
    return row ? toModel(row) : undefined;
  }

  getModelByRef(providerId: string, modelId: string): ModelRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM llm_models WHERE provider_id = ? AND model_id = ?")
      .get(providerId, modelId);
    return row ? toModel(row) : undefined;
  }

  /** Adds or refreshes a model. A model that is (or becomes) blocked is always switched off. */
  upsertModel(
    providerId: string,
    info: ModelInfo,
    freeStatus: FreeStatus,
    freeSource: string,
    availability: Availability,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO llm_models
           (provider_id, model_id, display_name, free_status, free_source, free_checked_at,
            context_window, enabled, availability, is_llama, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT (provider_id, model_id) DO UPDATE SET
           display_name = excluded.display_name,
           free_status = excluded.free_status,
           free_source = excluded.free_source,
           free_checked_at = excluded.free_checked_at,
           context_window = excluded.context_window,
           availability = excluded.availability,
           is_llama = excluded.is_llama,
           enabled = CASE WHEN excluded.free_status = 'blocked' THEN 0 ELSE llm_models.enabled END,
           updated_at = excluded.updated_at`,
      )
      .run(
        providerId,
        info.id,
        info.displayName,
        freeStatus,
        freeSource,
        now,
        info.contextWindow,
        availability,
        /llama/i.test(info.id) ? 1 : 0,
        now,
      );
  }

  /** Marks every model of a provider that is NOT in `presentIds` with the given availability. */
  markMissing(providerId: string, presentIds: string[], availability: Availability, now: string): void {
    const present = new Set(presentIds);
    const update = this.db.prepare("UPDATE llm_models SET availability = ?, updated_at = ? WHERE id = ?");
    for (const model of this.listModels(providerId)) {
      if (!present.has(model.modelId) && model.availability !== availability) {
        update.run(availability, now, model.id);
      }
    }
  }

  setModelEnabled(id: number, enabled: boolean, now: string): void {
    this.db.prepare("UPDATE llm_models SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, now, id);
  }

  blockModel(id: number, source: string, now: string): void {
    this.db
      .prepare(
        "UPDATE llm_models SET free_status = 'blocked', free_source = ?, free_checked_at = ?, enabled = 0, updated_at = ? WHERE id = ?",
      )
      .run(source, now, now, id);
  }

  // ---- settings ----
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM llm_settings WHERE key = ?").get(key);
    return row ? String(row["value"]) : null;
  }

  setSetting(key: string, value: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO llm_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM llm_settings WHERE key = ?").run(key);
  }
}
