import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCancelWorkflowRun, useRunWorkflow, useWorkflowAction, useWorkflowStep, useWorkflows } from "../api/hooks";
import type { Bot, WfGraph, WfInfo, WfRun } from "../api/types";
import { DemoCard } from "./DemoCard";
import { STARTER, WorkflowEditor } from "./WorkflowEditor";
import { WorkflowRunMap } from "./WorkflowRunMap";
import { WorkflowResultCheck } from "./WorkflowResultCheck";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
export const SIMULATED_MARK = "[SIMULATED RESPONSE";
const isSimulatedText = (t: string | null) => t !== null && t.startsWith(SIMULATED_MARK);
const ALIVE = new Set(["queued", "running", "waiting"]);
const STATUS_WORDS: Record<string, string> = { queued: "waiting its turn", running: "running", waiting: "waiting for you", completed: "finished", skipped: "skipped (not on the chosen path)", pending: "not reached", done: "finished", failed: "failed", cancelled: "cancelled", interrupted: "interrupted by a restart" };

/** Workflows: boxes and arrows that run in order, survive restarts, and stop at checkpoints for your decision. */
export function WorkflowsSection({ bots }: { bots: Bot[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const data = useWorkflows(showArchived);
  const action = useWorkflowAction();
  const run = useRunWorkflow();
  const cancel = useCancelWorkflowRun();
  const step = useWorkflowStep();
  // A draft from the AI Assistant arrives in the navigation state: it opens in the editor UNSAVED, for the owner to read and save.
  const location = useLocation();
  const [search] = useSearchParams();
  const handed = (location.state as { draft?: { name: string; graph: WfInfo["graph"] } } | null)?.draft;
  const [editing, setEditing] = useState<{ id?: string; name: string; graph: WfInfo["graph"] } | null>(handed ? { name: handed.name, graph: handed.graph } : null);
  const openWanted = search.get("open");
  const workflowList = data.data?.workflows;
  useEffect(() => {
    // ?open=ID opens that saved workflow in the editor (once the list has loaded).
    const w = openWanted ? workflowList?.find((x) => x.id === openWanted) : undefined;
    if (w) setEditing((cur) => (cur?.id === w.id ? cur : { id: w.id, name: w.name, graph: w.graph }));
  }, [openWanted, workflowList]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(search.get("run"));
  const err = errorText(action.error ?? run.error ?? cancel.error ?? step.error);

  return (
    <section aria-label="Workflows" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Workflows</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button className="btn-primary" onClick={() => setEditing({ name: "New workflow", graph: STARTER })}>
            New workflow
          </button>
        </div>
      </div>
      <p className="hint">A workflow is a drawing of boxes and arrows. New ones start switched off and only run when you press Run. Anything that touches the outside world still asks for your approval.</p>
      {err && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {err}
        </p>
      )}

      {editing && <WorkflowEditor key={editing.id ?? "new"} workflowId={editing.id} initialName={editing.name} initial={editing.graph} bots={bots} onClose={() => setEditing(null)} />}

      {(data.data?.waiting.length ?? 0) > 0 && (
        <div aria-label="Waiting for you" className="space-y-2 rounded-md border border-rose-400 p-3">
          <h3 className="font-semibold">Waiting for your decision</h3>
          {data.data!.waiting.map((w) => (
            <div key={`${w.runId}-${w.nodeId}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">
                <strong>{w.workflowName}</strong>: {w.message}
              </span>
              <button className="btn-primary" aria-label={`Approve ${w.workflowName}`} onClick={() => step.mutate({ runId: w.runId, nodeId: w.nodeId, action: "approve" })}>
                Approve
              </button>
              <button className="btn-secondary" aria-label={`Reject ${w.workflowName}`} onClick={() => step.mutate({ runId: w.runId, nodeId: w.nodeId, action: "reject" })}>
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {data.data?.workflows.length === 0 && (
        <div className="space-y-2">
          <p className="hint">No workflows yet. Press New workflow to draw one, or try the ready-made demonstration below (it uses a simulated AI, so no account is needed).</p>
          <DemoCard compact />
        </div>
      )}
      <ul className="space-y-2">
        {data.data?.workflows.map((w) => (
          <li key={w.id} className="space-y-2 rounded-md border border-slate-300 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{w.name}</strong>
              {w.graph.nodes.some((n) => n.type === "bot_task" && bots.find((b) => b.id === n.botId)?.model?.startsWith("demo/")) && <SimulatedBadge />}
              <span className="hint">
                version {w.version} · {w.enabled ? "switched on" : "switched off"}
                {w.lastRun ? ` · last run ${STATUS_WORDS[w.lastRun.status] ?? w.lastRun.status}` : ""}
              </span>
              {w.problems.length > 0 && <span className="text-sm text-red-700 dark:text-red-300">Has problems: {w.problems[0]!.message}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label={`Input for ${w.name}`} placeholder="Optional text to start with" value={inputs[w.id] ?? ""} onChange={(e) => setInputs({ ...inputs, [w.id]: e.target.value })} className="min-w-48 flex-1" />
              <button className="btn-primary" disabled={w.archived || w.problems.length > 0} onClick={() => run.mutate({ id: w.id, input: inputs[w.id] ?? "" })} aria-label={`Run ${w.name}`}>
                Run
              </button>
              <button className="btn-secondary" aria-label={`Edit ${w.name}`} onClick={() => setEditing({ id: w.id, name: w.name, graph: w.graph })}>
                Edit
              </button>
              <button className="btn-secondary" aria-label={`${w.enabled ? "Switch off" : "Switch on"} ${w.name}`} disabled={w.archived || (!w.enabled && w.problems.length > 0)} onClick={() => action.mutate({ id: w.id, action: w.enabled ? "disable" : "enable" })}>
                {w.enabled ? "Switch off" : "Switch on"}
              </button>
              <button className="btn-secondary" aria-label={`Duplicate ${w.name}`} onClick={() => action.mutate({ id: w.id, action: "duplicate" })}>
                Duplicate
              </button>
              <button className="btn-secondary" aria-label={`${w.archived ? "Restore" : "Archive"} ${w.name}`} onClick={() => action.mutate({ id: w.id, action: w.archived ? "unarchive" : "archive" })}>
                {w.archived ? "Restore" : "Archive"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="font-semibold">Recent runs</h3>
      {data.data?.runs.length === 0 && <p className="hint">Nothing has run yet.</p>}
      <ul className="space-y-2">
        {data.data?.runs.map((r) => (
          <RunRow key={r.id} run={r} graph={data.data?.workflows.find((w) => w.id === r.workflowId)?.graph} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onCancel={() => cancel.mutate(r.id)} onRetry={(nodeId) => step.mutate({ runId: r.id, nodeId, action: "retry" })} />
        ))}
      </ul>
    </section>
  );
}

function SimulatedBadge() {
  return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Simulated AI</span>;
}

function RunRow({ run, graph, open, onToggle, onCancel, onRetry }: { run: WfRun; graph?: WfGraph; open: boolean; onToggle: () => void; onCancel: () => void; onRetry: (nodeId: string) => void }) {
  return (
    <li className="rounded-md border border-slate-300 p-2 text-sm dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <button className="underline" aria-expanded={open} onClick={onToggle}>
          {run.workflowName} (v{run.workflowVersion})
        </button>
        <span>{STATUS_WORDS[run.status] ?? run.status}</span>
        {run.steps.some((x) => isSimulatedText(x.output)) && <SimulatedBadge />}
        <span className="hint">{new Date(run.createdAt).toLocaleString()}</span>
        {ALIVE.has(run.status) && (
          <button className="btn-secondary" aria-label={`Cancel the run of ${run.workflowName}`} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {run.error && <p className="text-red-700 dark:text-red-300">{run.error}</p>}
      {run.steps.find((x) => x.status === "failed") && (
        <p role="status" className="text-red-700 dark:text-red-300">
          Stopped at the box "{run.steps.find((x) => x.status === "failed")!.label || run.steps.find((x) => x.status === "failed")!.nodeId}". Open this run to see the error; boxes before it finished normally.
        </p>
      )}
      {open && graph && (
        <div className="mt-2">
          <WorkflowRunMap graph={graph} run={run} />
        </div>
      )}
      {open && <WorkflowResultCheck runId={run.id} runStatus={run.status} />}
      {open && (
        <ol className="mt-2 space-y-1">
          {run.input && <li className="hint">Started with: {run.input}</li>}
          {run.steps.map((s) => (
            <li key={s.nodeId}>
              <strong>{s.label || s.nodeId}</strong> — {STATUS_WORDS[s.status] ?? s.status}
              {s.error && <span className="text-red-700 dark:text-red-300"> ({s.error})</span>}
              {s.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-1 text-xs dark:bg-slate-800">{s.output}</pre>}
              {s.status === "failed" && (
                <button className="ml-2 underline" aria-label={`Retry ${s.label || s.nodeId}`} onClick={() => onRetry(s.nodeId)}>
                  Retry this box
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
