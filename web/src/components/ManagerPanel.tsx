import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCancelManagerRun, useManager, useStartManagerRun } from "../api/hooks";
import type { ManagerRun } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const STATUS: Record<string, string> = {
  planning: "Planning…",
  running: "Working…",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  budget_exhausted: "Stopped: budget used up",
  interrupted: "Interrupted by a restart",
};
const STEP_STATUS: Record<string, string> = { pending: "waiting", running: "working", completed: "done", failed: "failed", skipped: "skipped" };
const isLive = (s: string) => s === "planning" || s === "running";

function RunCard({ run }: { run: ManagerRun }) {
  const cancel = useCancelManagerRun();
  return (
    <li className="card space-y-2" aria-label={`Manager run: ${run.goal}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium [overflow-wrap:anywhere]">{run.goal}</p>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold dark:bg-slate-800">{STATUS[run.status] ?? run.status}</span>
      </div>
      <p className="hint">
        {run.modelCalls} of {run.budget.maxModelCalls} model calls · {(run.inputTokens + run.outputTokens).toLocaleString()} of {run.budget.maxTokens.toLocaleString()} tokens
        {run.mode === "direct" ? " · answered directly" : run.steps.length > 0 ? ` · ${run.steps.length} step${run.steps.length === 1 ? "" : "s"}` : ""}
        {run.revisions > 0 ? " · corrected once" : ""}
      </p>
      {run.steps.length > 0 && (
        <ol className="space-y-1 text-sm">
          {run.steps.map((s) => (
            <li key={s.id}>
              <strong>{s.title}</strong> · {s.specialistName ?? "Manager"} · {STEP_STATUS[s.status] ?? s.status}
              {s.taskId && (
                <>
                  {" · "}
                  <Link to={`/tasks/${s.taskId}`} className="underline">
                    task
                  </Link>
                </>
              )}
              {s.error && <span className="text-red-700 dark:text-red-300"> ({s.error})</span>}
            </li>
          ))}
        </ol>
      )}
      {run.error && <p className="text-sm text-amber-800 dark:text-amber-300">{run.error}</p>}
      {run.result && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">Result</p>
          <p className="whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-sm [overflow-wrap:anywhere] dark:bg-slate-800">{run.result}</p>
        </div>
      )}
      {isLive(run.status) && (
        <button className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)}>
          Cancel
        </button>
      )}
    </li>
  );
}

/** Tasks > Ask the Manager. One request in, one checked result out. Specialist bots are used only when you allowed them (Settings > Manager). */
export function ManagerPanel() {
  const manager = useManager();
  const start = useStartManagerRun();
  const [goal, setGoal] = useState("");
  const [showBudget, setShowBudget] = useState(false);
  const [calls, setCalls] = useState("");
  const m = manager.data;
  if (!m || !m.settings.enabled) {
    return m && !m.settings.enabled ? (
      <section aria-label="Manager" className="card">
        <h2 className="text-lg font-semibold">Ask the Manager</h2>
        <p className="hint">The Manager is switched off in Settings.</p>
      </section>
    ) : null;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    start.mutate({ goal: goal.trim(), ...(calls ? { budget: { maxModelCalls: Number(calls) } } : {}) }, { onSuccess: () => setGoal("") });
  };

  return (
    <section aria-label="Manager" className="space-y-3">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">Ask the Manager</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Describe what you want. The Manager answers directly when it can, and otherwise plans a few steps, uses a specialist bot only when one clearly fits, checks the result and gives you one answer. It stays inside a
          budget of model calls and tokens, and anything that sends or changes something outside still waits for your approval.
          {m.specialists.length === 0 ? " No specialist bots are allowed yet, so it works alone (you can allow some in Settings → Manager)." : ` Specialists it may use: ${m.specialists.map((s) => s.name).join(", ")}.`}
        </p>
        <form onSubmit={submit} className="space-y-2">
          <textarea
            aria-label="What should the Manager do?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            maxLength={4000}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={!goal.trim() || start.isPending}>
              Start
            </button>
            <button type="button" className="underline text-sm" onClick={() => setShowBudget((v) => !v)}>
              {showBudget ? "Hide budget" : "Change the budget for this request"}
            </button>
          </div>
          {showBudget && (
            <label className="block text-sm">
              <span className="label">Most model calls (default {m.settings.defaultBudget.maxModelCalls}, ceiling {m.ceilings.maxModelCalls})</span>
              <input aria-label="Most model calls" type="number" min={1} max={m.ceilings.maxModelCalls} value={calls} onChange={(e) => setCalls(e.target.value)} className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
            </label>
          )}
        </form>
        {errorText(start.error) && (
          <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {errorText(start.error)}
          </p>
        )}
      </div>
      {m.runs.length === 0 ? <p className="hint">No Manager requests yet.</p> : <ul className="space-y-3">{m.runs.map((r) => <RunCard key={r.id} run={r} />)}</ul>}
    </section>
  );
}
