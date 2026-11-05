import type { WfGraph, WfRun } from "../api/types";

const NODE_W = 150;
const NODE_H = 52;
const PAD = 16;

type NodeState = "waiting" | "running" | "done" | "failed" | "skipped" | "idle";

const STATE_WORD: Record<NodeState, string> = {
  idle: "not reached",
  waiting: "waiting for you",
  running: "running",
  done: "finished",
  failed: "failed",
  skipped: "skipped",
};
const STATE_STYLE: Record<NodeState, string> = {
  idle: "border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900",
  waiting: "border-rose-500 bg-rose-50 dark:bg-rose-950/40",
  running: "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 awp-live",
  done: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
  failed: "border-red-600 bg-red-50 dark:bg-red-950/40",
  skipped: "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800",
};

/** Map a step status from the server to the few states the picture shows. Unknown words fall back to "idle" (never to "done"). */
export function stateOfStep(status: string | undefined): NodeState {
  switch (status) {
    case "completed":
      return "done";
    case "running":
    case "queued":
      return "running";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "idle";
  }
}

/**
 * A read-only picture of a workflow for one run: each box coloured by what happened to it, and the arrows that were followed animated while
 * the run is still alive. The drawing is the workflow's CURRENT version; if it was edited after the run, boxes are matched by their id and
 * any box that has no step is shown as "not reached". Every state is also written in words, so colour is never the only signal.
 */
export function WorkflowRunMap({ graph, run }: { graph: WfGraph; run: WfRun }) {
  const stepOf = new Map(run.steps.map((s) => [s.nodeId, s]));
  const live = ["queued", "running", "waiting"].includes(run.status);
  const width = Math.max(...graph.nodes.map((n) => n.x + NODE_W), 300) + PAD;
  const height = Math.max(...graph.nodes.map((n) => n.y + NODE_H), 120) + PAD;
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));
  const stateOf = (id: string): NodeState => stateOfStep(stepOf.get(id)?.status);

  return (
    <div className="overflow-auto rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" role="group" aria-label={`Map of the run of ${run.workflowName}`}>
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {graph.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            // an arrow was followed when its start finished and its end was reached
            const followed = stateOf(e.from) === "done" && stateOf(e.to) !== "idle" && stateOf(e.to) !== "skipped";
            return (
              <path
                key={e.id}
                d={`M${x1},${y1} C${x1 + 50},${y1} ${x2 - 50},${y2} ${x2},${y2}`}
                fill="none"
                stroke={followed ? "#10b981" : "#94a3b8"}
                strokeWidth={followed ? 2.5 : 1.5}
                className={followed && live ? "awp-flow" : ""}
              />
            );
          })}
        </svg>
        {graph.nodes.map((n) => {
          const st = stateOf(n.id);
          return (
            <div
              key={n.id}
              role="group"
              aria-label={`${n.label || n.id}: ${STATE_WORD[st]}`}
              className={`awp-node absolute flex flex-col justify-center rounded-md border-2 px-2 text-xs ${STATE_STYLE[st]}`}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            >
              <span className="truncate font-semibold">{n.label || n.id}</span>
              <span>{STATE_WORD[st]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
