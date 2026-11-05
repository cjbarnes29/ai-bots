import { Link } from "react-router-dom";
import { useTasks } from "../api/hooks";
import { FINAL_TASK_STATUSES, type Bot } from "../api/types";
import { StackedBar, StatusDot } from "./ui/Stats";

const WORD: Record<string, string> = {
  queued: "waiting its turn",
  running: "running",
  waiting: "waiting",
  completed: "finished",
  failed: "failed",
  cancelled: "cancelled",
  interrupted: "interrupted",
};

/** What this agent has been asked to do, from the same task list as the Tasks page (tasks given to it directly, newest first). */
export function BotHistory({ bot }: { bot: Bot }) {
  const tasks = useTasks();
  const mine = (tasks.data ?? []).filter((t) => t.assigneeBotId === bot.id);
  const count = (s: string) => mine.filter((t) => t.status === s).length;
  const working = mine.filter((t) => !FINAL_TASK_STATUSES.includes(t.status)).length;
  return (
    <section aria-label="Execution history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Execution history</h2>
        <Link to="/tasks" className="btn-secondary min-h-11">
          Give a task
        </Link>
      </div>
      {!tasks.data ? (
        <p className="hint" role="status">
          Loading…
        </p>
      ) : mine.length === 0 ? (
        <p className="hint">{bot.name} has not been given a task yet.</p>
      ) : (
        <>
          <div className="card">
            <StackedBar
              label={`${bot.name}'s tasks`}
              parts={[
                { label: "finished", value: count("completed"), tone: "ok" },
                { label: "failed", value: count("failed"), tone: "bad" },
                { label: "working or waiting", value: working, tone: "idle" },
              ]}
            />
          </div>
          <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
            {mine.slice(0, 20).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <StatusDot tone={t.status === "completed" ? "ok" : t.status === "failed" ? "bad" : FINAL_TASK_STATUSES.includes(t.status) ? "idle" : "warn"} live={t.status === "running"} />
                <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate underline">
                  {t.instruction}
                </Link>
                <span className="font-medium">{WORD[t.status] ?? t.status}</span>
                <span className="hint">{new Date(t.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
