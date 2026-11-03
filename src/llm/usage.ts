import type { DatabaseSync } from "node:sqlite";
import { localDay, localMonth } from "./limits.js";

export interface UsageInsert {
  nowMs: number;
  botId: string | null;
  conversationId: string | null;
  providerId: string;
  modelId: string;
  cloud: boolean;
  status: "ok" | "error" | "blocked";
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  tokensEstimated: boolean;
  latencyMs: number | null;
  costReportedMicro: number;
  note: string | null;
}

export interface UsageFilter {
  cloud?: boolean;
  botId?: string;
  providerId?: string;
  day?: string;
  month?: string;
  sinceMs?: number;
}

export interface UsageTotals {
  requests: number;
  tokens: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

/** Reads and writes the append-only usage log. */
export class UsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  insert(u: UsageInsert): void {
    this.db
      .prepare(
        `INSERT INTO llm_usage
           (created_at, created_ms, day, month, bot_id, conversation_id, provider_id, model_id, cloud,
            status, error_code, input_tokens, output_tokens, tokens_estimated, latency_ms,
            cost_reported_micro, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date(u.nowMs).toISOString(),
        u.nowMs,
        localDay(u.nowMs),
        localMonth(u.nowMs),
        u.botId,
        u.conversationId,
        u.providerId,
        u.modelId,
        u.cloud ? 1 : 0,
        u.status,
        u.errorCode,
        u.inputTokens,
        u.outputTokens,
        u.tokensEstimated ? 1 : 0,
        u.latencyMs,
        u.costReportedMicro,
        u.note,
      );
  }

  /**
   * Requests and tokens that count against limits. Blocked attempts never reached a provider,
   * so they do not count. Failed attempts DO count (the provider may still have counted them).
   */
  totals(filter: UsageFilter): UsageTotals {
    const where: string[] = ["status IN ('ok', 'error')"];
    const params: (string | number)[] = [];
    if (filter.cloud !== undefined) {
      where.push("cloud = ?");
      params.push(filter.cloud ? 1 : 0);
    }
    if (filter.botId !== undefined) {
      where.push("bot_id = ?");
      params.push(filter.botId);
    }
    if (filter.providerId !== undefined) {
      where.push("provider_id = ?");
      params.push(filter.providerId);
    }
    if (filter.day !== undefined) {
      where.push("day = ?");
      params.push(filter.day);
    }
    if (filter.month !== undefined) {
      where.push("month = ?");
      params.push(filter.month);
    }
    if (filter.sinceMs !== undefined) {
      where.push("created_ms >= ?");
      params.push(filter.sinceMs);
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
         FROM llm_usage WHERE ${where.join(" AND ")}`,
      )
      .get(...params);
    return { requests: num(row?.["requests"]), tokens: num(row?.["tokens"]) };
  }

  /** Everything the Usage page shows. */
  summary(nowMs: number, days: number) {
    const today = localDay(nowMs);
    const month = localMonth(nowMs);
    const firstDay = localDay(nowMs - (days - 1) * 86_400_000);

    const rows = (sql: string, ...params: (string | number)[]): Row[] => this.db.prepare(sql).all(...params);

    const byDay = rows(
      `SELECT day,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
              COALESCE(SUM(CASE WHEN status IN ('ok','error') THEN input_tokens + output_tokens END), 0) AS tokens
       FROM llm_usage WHERE day >= ? GROUP BY day ORDER BY day DESC`,
      firstDay,
    ).map((r) => ({
      day: String(r["day"]),
      ok: num(r["ok"]),
      errors: num(r["errors"]),
      blocked: num(r["blocked"]),
      tokens: num(r["tokens"]),
    }));

    const byBot = rows(
      `SELECT u.bot_id AS botId, COALESCE(b.name, '(deleted)') AS botName,
              COUNT(*) AS requests, COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS tokens
       FROM llm_usage u LEFT JOIN bots b ON b.id = u.bot_id
       WHERE u.month = ? AND u.status IN ('ok','error')
       GROUP BY u.bot_id ORDER BY tokens DESC`,
      month,
    ).map((r) => ({
      botId: r["botId"] === null ? null : String(r["botId"]),
      botName: String(r["botName"]),
      requests: num(r["requests"]),
      tokens: num(r["tokens"]),
    }));

    const byModel = rows(
      `SELECT provider_id AS providerId, model_id AS modelId, COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM llm_usage WHERE month = ? AND status IN ('ok','error')
       GROUP BY provider_id, model_id ORDER BY tokens DESC`,
      month,
    ).map((r) => ({
      providerId: String(r["providerId"]),
      modelId: String(r["modelId"]),
      requests: num(r["requests"]),
      tokens: num(r["tokens"]),
      errors: num(r["errors"]),
    }));

    const recentProblems = rows(
      `SELECT u.created_at AS createdAt, u.status, u.error_code AS errorCode, u.provider_id AS providerId,
              u.model_id AS modelId, COALESCE(b.name, '') AS botName, u.note
       FROM llm_usage u LEFT JOIN bots b ON b.id = u.bot_id
       WHERE u.status IN ('error','blocked') ORDER BY u.id DESC LIMIT 25`,
    ).map((r) => ({
      createdAt: String(r["createdAt"]),
      status: String(r["status"]),
      errorCode: r["errorCode"] === null ? null : String(r["errorCode"]),
      providerId: String(r["providerId"]),
      modelId: String(r["modelId"]),
      botName: String(r["botName"]),
      note: r["note"] === null ? null : String(r["note"]),
    }));

    const costRow = this.db
      .prepare("SELECT COALESCE(SUM(cost_reported_micro), 0) AS micro FROM llm_usage WHERE month = ?")
      .get(month);

    return {
      today: this.totals({ day: today }),
      month: this.totals({ month }),
      todayCloud: this.totals({ day: today, cloud: true }),
      monthCloud: this.totals({ month, cloud: true }),
      reportedCostMicroThisMonth: num(costRow?.["micro"]),
      byDay,
      byBot,
      byModel,
      recentProblems,
    };
  }
}
