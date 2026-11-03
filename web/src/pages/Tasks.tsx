import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBots, useCancelTask, useSubmitTask, useTaskTree, useTasks } from "../api/hooks";
import { FINAL_TASK_STATUSES, type TaskNode, type TaskStatus } from "../api/types";

const STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  running: { label: "Working", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  completed: { label: "Done", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  cancelled: { label: "Cancelled", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
};

function StatusChip({ status }: { status: TaskStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
}

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function NewTaskForm() {
  const bots = useBots(false);
  const submit = useSubmitTask();
  const navigate = useNavigate();
  const [botId, setBotId] = useState("");
  const [text, setText] = useState("");
  const usable = (bots.data ?? []).filter((b) => b.model !== null && b.runtime === "builtin");
  const chosen = botId || usable[0]?.id || "";
  const error = errorText(submit.error);

  return (
    <form
      aria-label="New task"
      className="card space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen || !text.trim()) return;
        submit.mutate({ botId: chosen, instruction: text.trim() }, { onSuccess: (task) => navigate(`/tasks/${task.id}`) });
      }}
    >
      <h2 className="text-lg font-semibold">Give a bot a task</h2>
      {bots.data && usable.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No bot can take a task yet. A bot needs a model: choose one on its Details tab (and connect a provider in Settings first).
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="task-bot" className="label">
              Which bot
            </label>
            <select id="task-bot" value={chosen} onChange={(e) => setBotId(e.target.value)}>
              {usable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.role ? `: ${b.role}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="task-text" className="label">
              What should it do?
            </label>
            <textarea id="task-text" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="hint">{text.length.toLocaleString()} / 4,000 characters. The bot may ask teammates you have allowed for help.</p>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={!chosen || !text.trim() || submit.isPending}>
        {submit.isPending ? "Starting…" : "Start task"}
      </button>
    </form>
  );
}

export function TaskList() {
  const tasks = useTasks();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tasks</h1>
      <NewTaskForm />
      <section aria-label="Recent tasks" className="space-y-3">
        <h2 className="text-lg font-semibold">Recent tasks</h2>
        {tasks.isPending && <p role="status">Loading tasks…</p>}
        {tasks.isError && <p role="alert">{errorText(tasks.error)}</p>}
        {tasks.data && tasks.data.length === 0 && <p className="card text-sm text-slate-600 dark:text-slate-400">No tasks yet.</p>}
        <ul className="space-y-3">
          {(tasks.data ?? []).map((t) => (
            <li key={t.id}>
              <Link to={`/tasks/${t.id}`} className="card block hover:border-indigo-400">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t.assigneeName}</span>
                  <StatusChip status={t.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{t.instruction}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {t.chainTasks} {t.chainTasks === 1 ? "task" : "tasks"} · {t.chainLlmCalls} model calls · {new Date(t.createdAt).toLocaleString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TaskNodeView({ node }: { node: TaskNode }) {
  return (
    <li className="space-y-2">
      <div className="card space-y-2" aria-label={`Task for ${node.assigneeName}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            {node.assigneeName}
            <span className="text-sm font-normal text-slate-500"> · asked by {node.requestedByName}</span>
          </p>
          <StatusChip status={node.status} />
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-400">{node.instruction}</p>
        {node.result && (
          <div className="rounded-md bg-slate-100 p-3 dark:bg-slate-800">
            <p className="mb-1 text-xs font-semibold text-slate-500">Answer</p>
            <p className="whitespace-pre-wrap break-words text-sm">{node.result}</p>
          </div>
        )}
        {node.errorMessage && (
          <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {node.errorMessage}
          </p>
        )}
        <p className="text-xs text-slate-500">
          {node.llmCalls} model calls · {node.inputTokens + node.outputTokens} tokens
        </p>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 space-y-2 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
          {node.children.map((c) => (
            <TaskNodeView key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

const EVENT_LABELS: Record<string, string> = {
  created: "Task created",
  started: "Started",
  delegated: "Handed to a teammate",
  delegation_rejected: "A hand-over was refused",
  completed: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
  limit: "A limit was reached",
};

function describeEvent(kind: string, detailJson: string): string {
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(detailJson) as Record<string, unknown>;
  } catch {
    /* show the label alone */
  }
  const parts: string[] = [];
  if (kind === "delegated") parts.push(`${d["from"]} → ${d["to"]}`);
  else if (kind === "started") parts.push(String(d["assignee"] ?? ""));
  else if (kind === "delegation_rejected") parts.push([d["to"], d["reason"]].filter(Boolean).join(": "));
  else if (kind === "failed") parts.push(String(d["message"] ?? d["code"] ?? ""));
  else if (kind === "limit") parts.push(String(d["reason"] ?? ""));
  return parts.filter(Boolean).join(" ");
}

export function TaskDetail() {
  const { id = "" } = useParams();
  const tree = useTaskTree(id);
  const cancel = useCancelTask();

  if (tree.isPending) return <p role="status">Loading task…</p>;
  if (tree.isError) {
    return (
      <div role="alert" className="card space-y-3">
        <p>{tree.error instanceof ApiError && tree.error.status === 404 ? "This task does not exist." : (errorText(tree.error) ?? "Could not load this task.")}</p>
        <Link to="/tasks" className="btn-secondary">
          Back to tasks
        </Link>
      </div>
    );
  }
  const { task, events, totals } = tree.data;
  const working = !FINAL_TASK_STATUSES.includes(task.status);

  return (
    <div className="space-y-5">
      <Link to="/tasks" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
        ← All tasks
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
          Task for {task.assigneeName} <StatusChip status={task.status} />
        </h1>
        {working && (
          <button type="button" className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate(task.id)}>
            Cancel this task
          </button>
        )}
      </div>
      {working && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Working… this page updates by itself.</p>}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {totals.tasks} {totals.tasks === 1 ? "task" : "tasks"} · {totals.llmCalls} model calls · {totals.inputTokens + totals.outputTokens} tokens
      </p>
      {errorText(cancel.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(cancel.error)}
        </p>
      )}

      <ul aria-label="Task tree">
        <TaskNodeView node={task} />
      </ul>

      <section aria-label="Task log" className="card">
        <h2 className="mb-2 font-semibold">Log</h2>
        <ol className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span> {describeEvent(e.kind, e.detail)}
              <span className="text-slate-500"> · {new Date(e.createdAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
