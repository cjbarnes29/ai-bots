import { useState } from "react";
import { Link } from "react-router-dom";
import { useTasks, useWorkflows } from "../api/hooks";
import { FINAL_TASK_STATUSES, type ActivityLevel, type MonitorOverview } from "../api/types";
import { AiOverview } from "./AiOverview";
import { StackedBar, StatusDot } from "./ui/Stats";

const LEVEL_STYLE: Record<ActivityLevel, string> = {
  info: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const LEVEL_WORD: Record<ActivityLevel, string> = { info: "Info", warn: "Look", error: "Problem" };

const KINDS = [
  { id: "all", label: "Everything" },
  { id: "task", label: "Tasks" },
  { id: "approval", label: "Approvals" },
  { id: "automation", label: "Automation" },
  { id: "security", label: "Security" },
] as const;

/** Everything the server has noted, filtered by kind and by whether it was a problem. */
export function ActivityLog({ o }: { o: MonitorOverview }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
  const [problems, setProblems] = useState(false);
  const rows = o.activity.filter((a) => (kind === "all" || a.kind === kind) && (!problems || a.level !== "info"));
  return (
    <section aria-labelledby="log-heading" className="space-y-3">
      <h2 id="log-heading" className="text-lg font-semibold">
        Activity log
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => setKind(k.id)}
            className={`awp-hover min-h-11 rounded-full border px-4 text-sm font-medium ${
              kind === k.id ? "border-indigo-600 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {k.label}
          </button>
        ))}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} />
          Problems and warnings only
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="hint">{o.activity.length === 0 ? "Nothing has happened yet." : "Nothing matches these filters."}</p>
      ) : (
        <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
          {rows.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[a.level]}`}>{LEVEL_WORD[a.level]}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs capitalize dark:bg-slate-800">{a.kind}</span>
              <span className="hint shrink-0">{new Date(a.at).toLocaleString()}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {a.link ? (
                  <Link to={a.link} className="underline">
                    {a.summary}
                  </Link>
                ) : (
                  a.summary
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const RUN_WORD: Record<string, string> = { queued: "waiting its turn", running: "running", waiting: "waiting for you" };

/** What is being worked on right now: tasks and workflow runs that have not finished. The lists refresh by themselves while something runs. */
export function RunningWork() {
  const tasks = useTasks();
  const workflows = useWorkflows();
  const active = (tasks.data ?? []).filter((t) => !FINAL_TASK_STATUSES.includes(t.status));
  const runs = (workflows.data?.runs ?? []).filter((r) => ["queued", "running", "waiting"].includes(r.status));
  return (
    <div className="space-y-6">
      <section aria-labelledby="run-tasks-heading" className="space-y-2">
        <h2 id="run-tasks-heading" className="text-lg font-semibold">
          Tasks in progress
        </h2>
        {!tasks.data ? (
          <p className="hint">Loading…</p>
        ) : active.length === 0 ? (
          <p className="hint">No task is running.</p>
        ) : (
          <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
            {active.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <StatusDot tone="ok" live />
                <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate underline">
                  {t.assigneeName}: {t.instruction}
                </Link>
                <span className="font-medium">{t.status}</span>
                <span className="hint">{t.chainLlmCalls} AI calls</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="run-wf-heading" className="space-y-2">
        <h2 id="run-wf-heading" className="text-lg font-semibold">
          Workflow runs in progress
        </h2>
        {!workflows.data ? (
          <p className="hint">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="hint">No workflow is running.</p>
        ) : (
          <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
            {runs.map((r) => {
              const done = r.steps.filter((x) => x.status === "completed").length;
              return (
                <li key={r.id} className="space-y-1 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3">
                    <StatusDot tone={r.status === "waiting" ? "warn" : "ok"} live={r.status === "running"} />
                    <Link to="/workflows" className="min-w-0 flex-1 truncate underline">
                      {r.workflowName}
                    </Link>
                    <span className="font-medium">{RUN_WORD[r.status] ?? r.status}</span>
                  </div>
                  <StackedBar
                    label={`${r.workflowName} steps`}
                    parts={[
                      { label: "steps done", value: done, tone: "ok" },
                      { label: "steps left", value: Math.max(0, r.steps.length - done), tone: "idle" },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Usage that exists today: AI calls, tokens, refusals, automation and phone access, then the providers. No CPU or memory meter exists. */
export function Resources({ o }: { o: MonitorOverview }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="res-heading" className="space-y-2">
        <h2 id="res-heading" className="text-lg font-semibold">
          Usage today
        </h2>
        <div className="card space-y-3">
          <StackedBar
            label="AI calls today"
            empty="No AI call has been made today."
            parts={[
              { label: "worked", value: Math.max(0, o.ai.callsToday - o.ai.errorsToday), tone: "ok" },
              { label: "failed", value: o.ai.errorsToday, tone: "bad" },
              { label: "refused by limits or safety rules", value: o.ai.blockedToday, tone: "warn" },
            ]}
          />
          <p className="text-sm">
            {o.ai.tokensToday.toLocaleString()} tokens today · {o.automation.runsToday} automatic runs · {o.automation.schedulesOn} schedules and {o.automation.triggersOn} triggers on
            {o.ai.paused ? " · AI calls are PAUSED" : ""}
          </p>
        </div>
        <p className="hint">Computer load (CPU, memory) is not measured by this app yet, so no meter is shown for it.</p>
      </section>
      <AiOverview />
    </div>
  );
}
