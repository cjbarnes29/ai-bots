import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import type { TaskEngine } from "../delegation/engine.js";
import type { TaskRecord } from "../delegation/repository.js";
import { AppError } from "../errors.js";
import { LlmError } from "../llm/errors.js";
import { localDay } from "../llm/limits.js";
import type { CompleteInput, CompleteOutput } from "../llm/service.js";

/**
 * The Manager AI (Stage 2). One request in, one checked result out.
 *
 * It works the cheapest way that is still correct:
 *  1. ONE planning call decides: answer directly (done in a single call), or break the request into a few steps.
 *  2. Each step is done by the Manager itself or, only when a specialist bot clearly fits and you allowed it, by that bot (as a normal task, so every
 *     rule that applies to that bot, including the approval gate for outside actions, still applies).
 *  3. ONE review call checks the results against the request and combines them. If something is wrong it may redo the flagged steps once.
 * It has no tools and cannot create bots, change settings or reach outside. Every model call is a normal, limited, free-only call. Each run has a hard
 * budget (model calls, tokens, steps); when it runs out the Manager stops and reports what it has. Nothing here can raise a limit.
 */
export const MANAGER_CEILINGS = { maxModelCalls: 40, maxTokens: 200_000, maxSteps: 10, maxRunsPerDay: 100 };
const STEP_TIMEOUT_MS = 10 * 60_000;
const CONTEXT_PER_DEP = 1200;
const CONTEXT_TOTAL = 3000;
const MAX_RESULT_CHARS = 20_000;

export const managerSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Specialist bots the Manager may hand steps to. Empty = it works alone. */
  allowedBots: z.array(z.string().uuid()).max(20),
  /** "auto/general" or a specific "provider/model". */
  model: z.string().regex(/^[a-z0-9_-]{2,32}\/\S+$/).max(200),
  /** Tried once if a reply could not be understood. */
  escalationModel: z.string().regex(/^[a-z0-9_-]{2,32}\/\S+$/).max(200),
  maxRunsPerDay: z.number().int().min(1).max(MANAGER_CEILINGS.maxRunsPerDay),
  defaultBudget: z.strictObject({
    maxModelCalls: z.number().int().min(1).max(MANAGER_CEILINGS.maxModelCalls),
    maxTokens: z.number().int().min(1000).max(MANAGER_CEILINGS.maxTokens),
    maxSteps: z.number().int().min(1).max(MANAGER_CEILINGS.maxSteps),
  }),
});
export type ManagerSettings = z.infer<typeof managerSettingsSchema>;
export const DEFAULT_MANAGER: ManagerSettings = {
  enabled: true,
  allowedBots: [],
  model: "auto/general",
  escalationModel: "auto/research",
  maxRunsPerDay: 20,
  defaultBudget: { maxModelCalls: 12, maxTokens: 40_000, maxSteps: 6 },
};
export const managerSettingsPatch = managerSettingsSchema.partial();

const stepShape = z.strictObject({
  id: z.string().regex(/^s\d{1,2}$/),
  title: z.string().min(1).max(100),
  specialist: z.string().max(60).nullable(),
  instruction: z.string().min(1).max(2000),
  dependsOn: z.array(z.string().regex(/^s\d{1,2}$/)).max(9),
});
const planSchema = z.union([
  z.object({ mode: z.literal("direct"), answer: z.string().min(1).max(MAX_RESULT_CHARS) }),
  z.object({ mode: z.literal("plan"), steps: z.array(stepShape).min(1).max(MANAGER_CEILINGS.maxSteps) }),
]);
const reviewSchema = z.object({
  verdict: z.enum(["pass", "fix"]),
  issues: z.string().max(1500).optional().default(""),
  fixSteps: z.array(z.string().regex(/^s\d{1,2}$/)).max(10).optional().default([]),
  final: z.string().min(1).max(MAX_RESULT_CHARS),
});

export interface Specialist {
  id: string;
  name: string;
  role: string;
  responsibilities: string[];
}

export interface RunView {
  id: string;
  goal: string;
  status: string;
  mode: string | null;
  result: string | null;
  error: string | null;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  budget: { maxModelCalls: number; maxTokens: number; maxSteps: number };
  revisions: number;
  createdAt: string;
  finishedAt: string | null;
  steps: StepView[];
}
export interface StepView {
  id: string;
  title: string;
  specialistId: string | null;
  specialistName: string | null;
  dependsOn: string[];
  status: string;
  taskId: string | null;
  output: string | null;
  error: string | null;
  attempts: number;
}

export interface ManagerDeps {
  db: DatabaseSync;
  now: () => number;
  engine: Pick<TaskEngine, "submit" | "cancel">;
  getTask: (id: string) => TaskRecord | undefined;
  complete: (input: CompleteInput) => Promise<CompleteOutput>;
  listBots: () => { id: string; name: string; role: string; responsibilities: string[]; archived: boolean; model: string | null; runtime: string }[];
  audit: AuditLog;
  validateModel: (ref: string) => void;
  /** How long to wait between looks at a specialist's task. */
  pollMs?: number;
}

class Cancelled extends Error {}
class BudgetExhausted extends Error {}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** The first JSON object in a reply (models often wrap it in words or a code fence), checked against a schema. */
export function parseJsonReply<T>(text: string, schema: z.ZodType<T>): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class ManagerService {
  private readonly cancelled = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly d: ManagerDeps) {}

  private iso(): string {
    return new Date(this.d.now()).toISOString();
  }

  // ---------------- settings ----------------
  settings(): ManagerSettings {
    const row = this.d.db.prepare("SELECT value FROM manager_settings WHERE key = 'settings'").get();
    if (!row) return { ...DEFAULT_MANAGER, defaultBudget: { ...DEFAULT_MANAGER.defaultBudget } };
    try {
      const stored = managerSettingsPatch.parse(JSON.parse(String(row["value"])));
      return { ...DEFAULT_MANAGER, ...stored, defaultBudget: { ...DEFAULT_MANAGER.defaultBudget, ...(stored.defaultBudget ?? {}) } };
    } catch {
      return { ...DEFAULT_MANAGER };
    }
  }

  updateSettings(patch: Partial<ManagerSettings>): ManagerSettings {
    const parsed = managerSettingsPatch.parse(patch);
    if (parsed.model) this.d.validateModel(parsed.model);
    if (parsed.escalationModel) this.d.validateModel(parsed.escalationModel);
    if (parsed.allowedBots) {
      const known = new Set(this.d.listBots().filter((b) => !b.archived).map((b) => b.id));
      const unknown = parsed.allowedBots.filter((id) => !known.has(id));
      if (unknown.length > 0) throw new AppError(400, "unknown_bot", "One of the chosen specialist bots does not exist or is archived.");
    }
    const next = { ...this.settings(), ...parsed, defaultBudget: { ...this.settings().defaultBudget, ...(parsed.defaultBudget ?? {}) } };
    this.d.db
      .prepare("INSERT INTO manager_settings (key, value, updated_at) VALUES ('settings', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(JSON.stringify(next), this.iso());
    this.d.audit.record("manager.settings_changed", { fields: Object.keys(parsed) }, { actor: "owner" });
    return next;
  }

  /** Bots the Manager may use right now: allowed by you, not archived, built-in engine, and with a model. */
  specialists(): Specialist[] {
    const allowed = new Set(this.settings().allowedBots);
    return this.d
      .listBots()
      .filter((b) => allowed.has(b.id) && !b.archived && b.runtime === "builtin" && b.model !== null)
      .map((b) => ({ id: b.id, name: b.name, role: b.role, responsibilities: b.responsibilities }));
  }

  // ---------------- runs ----------------
  list(limit = 20): RunView[] {
    return this.d.db
      .prepare("SELECT id FROM manager_runs ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit)
      .map((r) => this.view(String(r["id"])));
  }

  view(id: string): RunView {
    const r = this.d.db.prepare("SELECT * FROM manager_runs WHERE id = ?").get(id);
    if (!r) throw new AppError(404, "run_not_found", "That Manager run does not exist.");
    const names = new Map(this.d.listBots().map((b) => [b.id, b.name]));
    const steps = this.d.db
      .prepare("SELECT * FROM manager_steps WHERE run_id = ? ORDER BY rowid")
      .all(id)
      .map(
        (s): StepView => ({
          id: String(s["step_id"]),
          title: String(s["title"]),
          specialistId: s["specialist_bot_id"] === null ? null : String(s["specialist_bot_id"]),
          specialistName: s["specialist_bot_id"] === null ? null : (names.get(String(s["specialist_bot_id"])) ?? "(unknown)"),
          dependsOn: JSON.parse(String(s["depends_on"])) as string[],
          status: String(s["status"]),
          taskId: s["task_id"] === null ? null : String(s["task_id"]),
          output: s["output"] === null ? null : String(s["output"]),
          error: s["error"] === null ? null : String(s["error"]),
          attempts: Number(s["attempts"]),
        }),
      );
    return {
      id,
      goal: String(r["goal"]),
      status: String(r["status"]),
      mode: r["mode"] === null ? null : String(r["mode"]),
      result: r["result"] === null ? null : String(r["result"]),
      error: r["error"] === null ? null : String(r["error"]),
      modelCalls: Number(r["model_calls"]),
      inputTokens: Number(r["input_tokens"]),
      outputTokens: Number(r["output_tokens"]),
      budget: { maxModelCalls: Number(r["budget_calls"]), maxTokens: Number(r["budget_tokens"]), maxSteps: Number(r["budget_steps"]) },
      revisions: Number(r["revisions"]),
      createdAt: String(r["created_at"]),
      finishedAt: r["finished_at"] === null ? null : String(r["finished_at"]),
      steps,
    };
  }

  /** Marks runs that were cut off by a restart. (Stage 6 adds real resuming.) */
  recoverInterrupted(): void {
    this.d.db.prepare("UPDATE manager_steps SET status = 'failed', error = 'The app restarted.' WHERE status = 'running'").run();
    this.d.db
      .prepare("UPDATE manager_runs SET status = 'interrupted', error = 'The app was restarted while this was running.', finished_at = ? WHERE status IN ('planning','running')")
      .run(this.iso());
  }

  start(goal: string, budget: Partial<ManagerSettings["defaultBudget"]> = {}, requestedBy = "owner"): RunView {
    const s = this.settings();
    if (!s.enabled) throw new AppError(409, "manager_off", "The Manager is switched off in Settings.");
    const text = goal.trim();
    if (!text) throw new AppError(400, "empty_goal", "Describe what you want done first.");
    if (text.length > 4000) throw new AppError(413, "goal_too_long", "That request is too long (4,000 characters at most).");
    const today = localDay(this.d.now());
    const startOfDay = new Date(this.d.now());
    startOfDay.setHours(0, 0, 0, 0);
    const used = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM manager_runs WHERE created_at >= ?").get(startOfDay.toISOString()) as { n: number }).n);
    if (used >= s.maxRunsPerDay) throw new AppError(429, "manager_daily_limit", `The Manager has reached today's limit of ${s.maxRunsPerDay} runs (${today}).`);
    if ([...this.running.keys()].length >= 2) throw new AppError(429, "manager_busy", "The Manager is already working on two requests. Wait for one to finish.");
    const merged = {
      maxModelCalls: Math.min(budget.maxModelCalls ?? s.defaultBudget.maxModelCalls, MANAGER_CEILINGS.maxModelCalls),
      maxTokens: Math.min(budget.maxTokens ?? s.defaultBudget.maxTokens, MANAGER_CEILINGS.maxTokens),
      maxSteps: Math.min(budget.maxSteps ?? s.defaultBudget.maxSteps, MANAGER_CEILINGS.maxSteps),
    };
    const id = randomUUID();
    this.d.db
      .prepare("INSERT INTO manager_runs (id, goal, status, budget_calls, budget_tokens, budget_steps, requested_by, created_at) VALUES (?, ?, 'planning', ?, ?, ?, ?, ?)")
      .run(id, text, merged.maxModelCalls, merged.maxTokens, merged.maxSteps, requestedBy, this.iso());
    this.d.audit.record("manager.run_started", { id, budget: merged }, { actor: requestedBy });
    const p = this.execute(id).finally(() => this.running.delete(id));
    this.running.set(id, p);
    return this.view(id);
  }

  cancel(id: string): RunView {
    const run = this.view(id);
    if (["planning", "running"].includes(run.status)) {
      this.cancelled.add(id);
      this.d.audit.record("manager.run_cancelled", { id }, { actor: "owner" });
    }
    return this.view(id);
  }

  /** Resolves when every run has finished (tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.running.values()]);
  }

  // ---------------- the work ----------------
  private setRun(id: string, fields: Record<string, string | number | null>): void {
    const keys = Object.keys(fields);
    this.d.db.prepare(`UPDATE manager_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
  }

  private setStep(runId: string, stepId: string, fields: Record<string, string | number | null>): void {
    const keys = Object.keys(fields);
    this.d.db.prepare(`UPDATE manager_steps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE run_id = ? AND step_id = ?`).run(...keys.map((k) => fields[k] ?? null), runId, stepId);
  }

  private checkLive(id: string): void {
    if (this.cancelled.has(id)) throw new Cancelled();
  }

  private spent(id: string): { calls: number; tokens: number; callsMax: number; tokensMax: number } {
    const r = this.d.db.prepare("SELECT model_calls, input_tokens, output_tokens, budget_calls, budget_tokens FROM manager_runs WHERE id = ?").get(id)!;
    return { calls: Number(r["model_calls"]), tokens: Number(r["input_tokens"]) + Number(r["output_tokens"]), callsMax: Number(r["budget_calls"]), tokensMax: Number(r["budget_tokens"]) };
  }

  private assertBudget(id: string): void {
    const s = this.spent(id);
    if (s.calls >= s.callsMax || s.tokens >= s.tokensMax) throw new BudgetExhausted();
  }

  private addUsage(id: string, calls: number, input: number, output: number): void {
    this.d.db.prepare("UPDATE manager_runs SET model_calls = model_calls + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?").run(calls, input, output, id);
  }

  /** One of the Manager's own model calls. Budget and cancel are checked first; the call itself is a normal limited free-only call. */
  private async ask(id: string, system: string, user: string, modelRef: string, maxOut = 1500): Promise<string> {
    this.checkLive(id);
    this.assertBudget(id);
    const out = await this.d.complete({
      botId: null,
      conversationId: null,
      modelRef,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      maxOutputTokens: maxOut,
    });
    this.addUsage(id, 1, out.inputTokens, out.outputTokens);
    this.checkLive(id);
    return out.text;
  }

  /** Asks for a JSON answer. If it cannot be understood, asks once more with the stronger model. Never loops further. */
  private async askJson<T>(id: string, system: string, user: string, schema: z.ZodType<T>, s: ManagerSettings): Promise<T> {
    const first = parseJsonReply(await this.ask(id, system, user, s.model), schema);
    if (first) return first;
    const second = parseJsonReply(await this.ask(id, system, `${user}\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object.`, s.escalationModel), schema);
    if (second) return second;
    throw new AppError(502, "manager_unreadable", "The model's answer could not be understood, even after a second try.");
  }

  private async execute(id: string): Promise<void> {
    const settings = this.settings();
    try {
      const run = this.view(id);
      const specialists = this.specialists();
      const plan = await this.askJson(id, planPrompt(run.budget.maxSteps, specialists), `Request:\n${run.goal}`, planSchema, settings);

      if (plan.mode === "direct") {
        this.setRun(id, { mode: "direct", status: "completed", result: clip(plan.answer, MAX_RESULT_CHARS), finished_at: this.iso() });
        this.d.audit.record("manager.run_finished", { id, status: "completed", mode: "direct" });
        return;
      }

      // Check the plan: steps within budget, dependencies only on EARLIER steps, specialists only from the allowed list.
      const known = new Set<string>();
      const allowed = new Map(specialists.map((sp) => [sp.id, sp]));
      const steps = plan.steps.slice(0, run.budget.maxSteps).map((st) => {
        const deps = st.dependsOn.filter((d) => known.has(d));
        known.add(st.id);
        const specialist = st.specialist && allowed.has(st.specialist) ? st.specialist : null;
        return { ...st, dependsOn: deps, specialist };
      });
      if (new Set(steps.map((x) => x.id)).size !== steps.length) throw new AppError(502, "manager_bad_plan", "The plan used the same step name twice.");
      for (const st of steps) {
        this.d.db
          .prepare("INSERT INTO manager_steps (run_id, step_id, title, specialist_bot_id, instruction, depends_on, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
          .run(id, st.id, st.title, st.specialist, st.instruction, JSON.stringify(st.dependsOn));
      }
      this.setRun(id, { mode: "plan", status: "running" });

      await this.runSteps(id, run.goal, settings);
      // Nothing worked: say so without spending a review call.
      if (!this.view(id).steps.some((x) => x.status === "completed")) throw new AppError(502, "manager_all_failed", "Every step failed, so there is nothing to report.");
      let revisions = 0;
      let review = await this.review(id, run.goal, settings);
      if (review.verdict === "fix" && review.fixSteps.length > 0) {
        const redo = review.fixSteps.filter((sid) => this.canRedo(id, sid));
        if (redo.length > 0) {
          revisions = 1;
          this.setRun(id, { revisions });
          for (const sid of redo) this.d.db.prepare("UPDATE manager_steps SET status = 'pending', error = NULL, instruction = instruction || ? WHERE run_id = ? AND step_id = ?").run(`\n\nA reviewer found this problem with your last attempt, fix it: ${clip(review.issues, 600)}`, id, sid);
          await this.runSteps(id, run.goal, settings);
          review = await this.review(id, run.goal, settings, true);
        }
      }
      const anyDone = this.view(id).steps.some((x) => x.status === "completed");
      if (!anyDone) throw new AppError(502, "manager_all_failed", "Every step failed, so there is nothing to report.");
      this.setRun(id, { status: "completed", result: clip(review.final, MAX_RESULT_CHARS), finished_at: this.iso() });
      this.d.audit.record("manager.run_finished", { id, status: "completed", mode: "plan", revisions });
    } catch (err) {
      this.finishWithError(id, err);
    } finally {
      this.cancelled.delete(id);
    }
  }

  private finishWithError(id: string, err: unknown): void {
    const now = this.iso();
    const partial = this.partialResult(id);
    if (err instanceof Cancelled) {
      this.d.db.prepare("UPDATE manager_steps SET status = 'skipped' WHERE run_id = ? AND status IN ('pending','running')").run(id);
      this.setRun(id, { status: "cancelled", result: partial, finished_at: now });
    } else if (err instanceof BudgetExhausted) {
      this.d.db.prepare("UPDATE manager_steps SET status = 'skipped', error = 'The run budget was used up.' WHERE run_id = ? AND status IN ('pending','running')").run(id);
      this.setRun(id, { status: "budget_exhausted", error: "The budget for this request (model calls or tokens) was used up, so the Manager stopped. Results so far are shown.", result: partial, finished_at: now });
    } else {
      const message = err instanceof AppError || err instanceof LlmError ? err.message : "The Manager hit an unexpected problem.";
      this.setRun(id, { status: "failed", error: clip(message, 500), result: partial, finished_at: now });
    }
    this.d.audit.record("manager.run_finished", { id, status: this.view(id).status });
  }

  /** What was completed so far, put together without any model call. */
  private partialResult(id: string): string | null {
    const done = this.view(id).steps.filter((s) => s.status === "completed" && s.output);
    return done.length === 0 ? null : clip(done.map((s) => `## ${s.title}\n${s.output}`).join("\n\n"), MAX_RESULT_CHARS);
  }

  private canRedo(id: string, stepId: string): boolean {
    const row = this.d.db.prepare("SELECT task_id, attempts FROM manager_steps WHERE run_id = ? AND step_id = ?").get(id, stepId);
    if (!row || Number(row["attempts"]) >= 2) return false;
    if (row["task_id"] !== null) {
      // A specialist that already asked for an outside action is NOT run again: that could ask for the same thing twice.
      const asked = this.d.db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE task_id = ?").get(String(row["task_id"])) as { n: number };
      if (Number(asked.n) > 0) return false;
    }
    return true;
  }

  private async runSteps(id: string, goal: string, settings: ManagerSettings): Promise<void> {
    for (;;) {
      this.checkLive(id);
      const steps = this.view(id).steps;
      const byId = new Map(steps.map((s) => [s.id, s]));
      const pending = steps.filter((s) => s.status === "pending");
      if (pending.length === 0) return;
      const ready: StepView[] = [];
      for (const s of pending) {
        const deps = s.dependsOn.map((d) => byId.get(d)!);
        if (deps.some((x) => x.status === "failed" || x.status === "skipped")) {
          this.setStep(id, s.id, { status: "skipped", error: "An earlier step it depends on did not finish." });
        } else if (deps.every((x) => x.status === "completed")) ready.push(s);
      }
      if (ready.length === 0) {
        if (this.view(id).steps.some((s) => s.status === "pending")) continue; // some were just skipped; look again
        return;
      }
      // Steps that do not depend on each other are started together.
      await Promise.all(ready.map((s) => this.runStep(id, goal, s, byId, settings)));
    }
  }

  private context(deps: StepView[]): string {
    let total = 0;
    const parts: string[] = [];
    for (const d of deps) {
      if (!d.output) continue;
      const piece = `[${d.title}]\n${clip(d.output, CONTEXT_PER_DEP)}`;
      if (total + piece.length > CONTEXT_TOTAL) break;
      total += piece.length;
      parts.push(piece);
    }
    return parts.length === 0 ? "" : `\n\nResults of earlier steps:\n${parts.join("\n\n")}`;
  }

  private async runStep(id: string, goal: string, step: StepView, byId: Map<string, StepView>, settings: ManagerSettings): Promise<void> {
    const row = this.d.db.prepare("SELECT instruction, attempts FROM manager_steps WHERE run_id = ? AND step_id = ?").get(id, step.id)!;
    const instruction = String(row["instruction"]);
    const ctx = this.context(step.dependsOn.map((d) => byId.get(d)!));
    this.setStep(id, step.id, { status: "running", started_at: this.iso(), attempts: Number(row["attempts"]) + 1 });
    try {
      let output: string;
      if (step.specialistId) {
        this.checkLive(id);
        this.assertBudget(id);
        const task = this.d.engine.submit(step.specialistId, `${instruction}${ctx}`, { type: "user", id, label: `Manager: ${clip(goal, 60)}` });
        this.setStep(id, step.id, { task_id: task.id });
        output = await this.awaitTask(id, task.id);
      } else {
        output = await this.ask(id, `You are a careful assistant completing ONE step of a larger job. Output only the result of the step.`, `Overall request: ${clip(goal, 600)}\n\nYour step: ${instruction}${ctx}`, settings.model, 1500);
      }
      this.setStep(id, step.id, { status: "completed", output: clip(output, MAX_RESULT_CHARS), finished_at: this.iso() });
    } catch (err) {
      if (err instanceof Cancelled || err instanceof BudgetExhausted) throw err;
      const message = err instanceof AppError || err instanceof LlmError ? err.message : "The step failed.";
      this.setStep(id, step.id, { status: "failed", error: clip(message, 400), finished_at: this.iso() });
    }
  }

  private async awaitTask(runId: string, taskId: string): Promise<string> {
    const started = this.d.now();
    const poll = this.d.pollMs ?? 250;
    for (;;) {
      const t = this.d.getTask(taskId);
      if (!t) throw new AppError(500, "task_missing", "The specialist's task disappeared.");
      if (this.cancelled.has(runId)) {
        try {
          this.d.engine.cancel(t.rootId);
        } catch {
          /* already finished */
        }
        throw new Cancelled();
      }
      if (t.status === "completed") {
        this.addUsage(runId, t.llmCalls, t.inputTokens, t.outputTokens);
        return t.result ?? "";
      }
      if (t.status === "failed" || t.status === "cancelled") {
        this.addUsage(runId, t.llmCalls, t.inputTokens, t.outputTokens);
        throw new AppError(502, "specialist_failed", t.errorMessage ?? `${t.assigneeName} could not finish the step.`);
      }
      if (this.d.now() - started > STEP_TIMEOUT_MS) {
        try {
          this.d.engine.cancel(t.rootId);
        } catch {
          /* ignore */
        }
        throw new AppError(504, "specialist_timeout", "The specialist took too long.");
      }
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  private async review(id: string, goal: string, settings: ManagerSettings, last = false) {
    const steps = this.view(id).steps;
    const summary = steps
      .map((s) => `[${s.id}] ${s.title} (${s.specialistName ?? "Manager"}): ${s.status}\n${s.output ? clip(s.output, 1500) : (s.error ?? "")}`)
      .join("\n\n");
    return this.askJson(id, reviewPrompt(last), `Original request:\n${clip(goal, 1500)}\n\nResults:\n${summary}`, reviewSchema, settings);
  }
}

function planPrompt(maxSteps: number, specialists: Specialist[]): string {
  const list =
    specialists.length === 0
      ? "(no specialist bots are available: do everything yourself, with specialist null)"
      : specialists.map((s) => `- ${s.id} | ${s.name} | ${clip(s.role, 60)} | ${clip(s.responsibilities.join("; "), 120)}`).join("\n");
  return [
    "You are the Manager of a small AI workforce. Complete the owner's request with the LEAST work that is still correct.",
    'Reply with ONLY one JSON object. If you can fully answer now, reply {"mode":"direct","answer":"<the complete answer>"}.',
    `Otherwise reply {"mode":"plan","steps":[{"id":"s1","title":"short","specialist":null,"instruction":"what to do","dependsOn":[]}]} with at most ${maxSteps} steps.`,
    "Use a specialist (its id) only if its role clearly fits the step; otherwise null and you do it yourself. Never invent ids. Steps that do not need each other have empty dependsOn; dependsOn may only name EARLIER steps.",
    "Do not add steps for planning, checking or summarising: that is done afterwards.",
    `Available specialists:\n${list}`,
  ].join("\n");
}

function reviewPrompt(last: boolean): string {
  return [
    "You are the Manager checking finished work against the owner's original request.",
    'Reply with ONLY one JSON object: {"verdict":"pass"|"fix","issues":"what is wrong, if anything","fixSteps":["s1"],"final":"the complete final deliverable for the owner"}.',
    "The final text must combine the useful results into one clear answer. Do not claim anything was done that the results do not show. If a step failed or is missing, say so plainly in the final text.",
    last ? 'This is the last check: use verdict "pass" and just write the best final text.' : 'Use verdict "fix" only for steps whose result is wrong or incomplete, and list them in fixSteps.',
  ].join("\n");
}
