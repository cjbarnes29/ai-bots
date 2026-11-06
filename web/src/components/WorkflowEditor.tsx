import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useCreateWorkflow, useIntegrations, useUpdateWorkflow, useValidateWorkflow } from "../api/hooks";
import type { Bot, WfEdge, WfGraph, WfNode } from "../api/types";
import { useNarrow } from "../lib/useNarrow";
import { SplitPane } from "./ui/SplitPane";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const NODE_W = 176;
const NODE_H = 78;
const CANVAS_W = 1100;
const CANVAS_H = 520;

const TYPE_LABEL: Record<string, string> = { trigger: "Start", bot_task: "Bot task", manager: "Manager", integration: "Outside action", condition: "If", checkpoint: "Checkpoint", set: "Set text", end: "End" };
const TYPE_STYLE: Record<string, string> = {
  trigger: "border-green-500 bg-green-50 dark:bg-green-950/40",
  bot_task: "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40",
  manager: "border-violet-500 bg-violet-50 dark:bg-violet-950/40",
  integration: "border-teal-500 bg-teal-50 dark:bg-teal-950/40",
  condition: "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
  checkpoint: "border-rose-500 bg-rose-50 dark:bg-rose-950/40",
  set: "border-sky-500 bg-sky-50 dark:bg-sky-950/40",
  end: "border-slate-500 bg-slate-100 dark:bg-slate-800",
};

export const STARTER: WfGraph = {
  nodes: [
    { id: "start", type: "trigger", label: "Start", x: 40, y: 200, kind: "manual" },
    { id: "end", type: "end", label: "End", x: 700, y: 200 },
  ],
  edges: [{ id: "start-end", from: "start", to: "end", when: "always" }],
};

function defaults(type: string, bots: Bot[]): Record<string, unknown> {
  switch (type) {
    case "bot_task":
      return { botId: bots[0]?.id ?? "", instruction: "Do this: {{input}}", retries: 0 };
    case "manager":
      return { goal: "Help with: {{input}}" };
    case "integration":
      return { botId: bots[0]?.id ?? "", connector: "", action: "", args: {} };
    case "condition":
      return { left: "{{input}}", op: "contains", value: "" };
    case "checkpoint":
      return { message: "Continue?" };
    case "set":
      return { value: "{{input}}" };
    default:
      return {};
  }
}

interface Props {
  workflowId?: string;
  initialName: string;
  initial: WfGraph;
  bots: Bot[];
  onClose: () => void;
}

/**
 * The visual editor: boxes you drag, arrows you draw, and a panel for the selected box. The same drawing is checked by the server
 * as you work (loops, missing Start, unconnected boxes...). Saving makes a new permanent version; a new workflow is always saved switched OFF.
 */
export function WorkflowEditor({ workflowId, initialName, initial, bots, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [nodes, setNodes] = useState<WfNode[]>(initial.nodes);
  const [edges, setEdges] = useState<WfEdge[]>(initial.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const narrow = useNarrow();
  const [view, setView] = useState<"canvas" | "list" | null>(null);
  const mode = view ?? (narrow ? "list" : "canvas");
  const [problems, setProblems] = useState<{ node?: string; message: string }[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const validate = useValidateWorkflow();
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();
  const graph: WfGraph = { nodes, edges };
  const sel = nodes.find((n) => n.id === selected) ?? null;

  // Ask the server what is wrong with the drawing, a moment after you stop changing it.
  useEffect(() => {
    const t = setTimeout(() => validate.mutate(graph, { onSuccess: setProblems }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const patchNode = (id: string, patch: Record<string, unknown>) => setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, ...patch } as WfNode) : n)));

  const addNode = (type: string) => {
    let i = nodes.length;
    let id = `n${i}`;
    while (nodes.some((n) => n.id === id)) id = `n${++i}`;
    setNodes((ns) => [...ns, { id, type, label: `${TYPE_LABEL[type]} ${id}`, x: 60 + ((i * 60) % 700), y: 40 + ((i * 70) % 380), ...defaults(type, bots) } as WfNode]);
    setSelected(id);
  };

  const removeNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSelected(null);
    setConnectFrom(null);
  };

  const connectTo = (to: string) => {
    if (!connectFrom || connectFrom === to) return setConnectFrom(null);
    const from = nodes.find((n) => n.id === connectFrom);
    const taken = new Set(edges.filter((e) => e.from === connectFrom).map((e) => e.when));
    const when = from?.type === "condition" ? (!taken.has("true") ? "true" : "false") : "always";
    if (!edges.some((e) => e.from === connectFrom && e.to === to)) setEdges((es) => [...es, { id: `${connectFrom}-${to}`, from: connectFrom, to, when }]);
    setConnectFrom(null);
  };

  // ---- dragging a box ----
  const startDrag = (e: React.PointerEvent, n: WfNode) => {
    drag.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    setSelected(n.id);
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      patchNode(d.id, { x: Math.round(Math.max(0, Math.min(CANVAS_W - NODE_W, ev.clientX - d.dx))), y: Math.round(Math.max(0, Math.min(CANVAS_H - NODE_H, ev.clientY - d.dy))) });
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const save = () => {
    const done = () => onClose();
    if (workflowId) update.mutate({ id: workflowId, patch: { name, graph } }, { onSuccess: done });
    else create.mutate({ name, graph }, { onSuccess: done });
  };
  const saving = create.isPending || update.isPending;
  const saveError = errorText(create.error ?? update.error);
  const badNodes = new Set(problems.map((p) => p.node).filter(Boolean));
  const center = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-300 p-3 dark:border-slate-700" aria-label="Workflow editor" role="group">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-sm">
          <span className="label">Workflow name</span>
          <input aria-label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full" />
        </label>
        <button className="btn-primary" disabled={saving || !name.trim()} onClick={save}>
          {workflowId ? "Save as a new version" : "Save (starts switched off)"}
        </button>
        <button className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Add a box">
        {(["bot_task", "manager", "integration", "condition", "checkpoint", "set", "end"] as const).map((t) => (
          <button key={t} className="btn-secondary" onClick={() => addNode(t)}>
            Add {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {connectFrom && (
        <p role="status" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Drawing an arrow from <strong>{connectFrom}</strong>: press "Arrow to here" on the box it should lead to, or{" "}
          <button className="underline" onClick={() => setConnectFrom(null)}>
            cancel
          </button>
          .
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="hint !mt-0">
          {mode === "list" ? "List view: the boxes in the order they run, one after another. Good for phones." : "Drawing view: drag boxes, draw arrows."}
        </p>
        <button type="button" className="btn-secondary min-h-11" onClick={() => setView(mode === "list" ? "canvas" : "list")}>
          {mode === "list" ? "Show as a drawing" : "Show as a list"}
        </button>
      </div>

      <SplitPane
        label="Workflow editor panels"
        first={
          mode === "list" ? (
            <StepList nodes={nodes} edges={edges} selected={selected} connectFrom={connectFrom} badNodes={badNodes} onSelect={setSelected} onArrowFrom={setConnectFrom} onArrowTo={connectTo} />
          ) : (
          <div ref={canvas} className="relative overflow-auto rounded-md border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900" style={{ height: 360 }}>
            <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }} aria-label="Canvas">
              <svg width={CANVAS_W} height={CANVAS_H} className="pointer-events-none absolute inset-0" aria-hidden="true">
                <defs>
                  <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = center(e.from);
                  const b = center(e.to);
                  const x1 = a.x + NODE_W;
                  const y1 = a.y + NODE_H / 2;
                  const x2 = b.x;
                  const y2 = b.y + NODE_H / 2;
                  return (
                    <g key={e.id}>
                      <path d={`M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`} fill="none" stroke={e.when === "true" ? "#16a34a" : e.when === "false" ? "#dc2626" : "#64748b"} strokeWidth="2" markerEnd="url(#wf-arrow)" />
                      {e.when !== "always" && (
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="12" fill="#334155">
                          {e.when}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {nodes.map((n) => (
                <div
                  key={n.id}
                  role="group"
                  aria-label={`Box ${n.id}`}
                  className={`absolute rounded-md border-2 p-1 text-xs shadow-sm ${TYPE_STYLE[n.type]} ${selected === n.id ? "ring-2 ring-indigo-400" : ""} ${badNodes.has(n.id) ? "outline outline-2 outline-red-500" : ""}`}
                  style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Move box ${n.id}`}
                    onPointerDown={(e) => startDrag(e, n)}
                    onClick={() => setSelected(n.id)}
                    className="cursor-grab touch-none select-none font-semibold"
                  >
                    {TYPE_LABEL[n.type]}: {n.label || n.id}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {n.type !== "end" && (
                      <button className="rounded bg-white/70 px-1.5 py-0.5 underline dark:bg-black/30" aria-label={`Draw an arrow from ${n.id}`} onClick={() => setConnectFrom(n.id)}>
                        Arrow from here
                      </button>
                    )}
                    {connectFrom && connectFrom !== n.id && n.type !== "trigger" && (
                      <button className="rounded bg-indigo-600 px-1.5 py-0.5 text-white" aria-label={`Draw the arrow to ${n.id}`} onClick={() => connectTo(n.id)}>
                        Arrow to here
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )
        }
        second={
          <>
            <section aria-label="Selected box" className="space-y-2">
              <h4 className="font-semibold">{sel ? `${TYPE_LABEL[sel.type]} box "${sel.id}"` : "Click a box to change it"}</h4>
              {sel && <NodeForm node={sel} bots={bots} onPatch={(p) => patchNode(sel.id, p)} />}
              {sel && sel.type !== "trigger" && (
                <button className="btn-danger" onClick={() => removeNode(sel.id)}>
                  Remove this box
                </button>
              )}
            </section>
            <section aria-label="Arrows" className="space-y-1">
              <h4 className="font-semibold">Arrows</h4>
              {edges.length === 0 && <p className="hint">No arrows yet.</p>}
              <ul className="space-y-1 text-sm">
                {edges.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {e.from} → {e.to}
                    </span>
                    {nodes.find((n) => n.id === e.from)?.type === "condition" && (
                      <select aria-label={`When for the arrow ${e.from} to ${e.to}`} value={e.when} onChange={(ev) => setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, when: ev.target.value as WfEdge["when"] } : x)))}>
                        <option value="true">when true</option>
                        <option value="false">when false</option>
                      </select>
                    )}
                    <button className="underline" aria-label={`Remove the arrow ${e.from} to ${e.to}`} onClick={() => setEdges((es) => es.filter((x) => x.id !== e.id))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        }
      />

      <section aria-label="Problems" className="space-y-1">
        {problems.length === 0 ? (
          <p className="text-sm text-green-800 dark:text-green-300">No problems found. It can be switched on after you save it.</p>
        ) : (
          <ul className="space-y-1 text-sm text-red-800 dark:text-red-300">
            {problems.map((p, i) => (
              <li key={i}>
                {p.node ? `Box ${p.node}: ` : ""}
                {p.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      {saveError && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {saveError}
        </p>
      )}
    </div>
  );
}

function NodeForm({ node, bots, onPatch }: { node: WfNode; bots: Bot[]; onPatch: (p: Record<string, unknown>) => void }) {
  const f = (k: string) => String((node as Record<string, unknown>)[k] ?? "");
  const input = (k: string, label: string, extra: { area?: boolean; max?: number } = {}) => (
    <label className="block text-sm">
      <span className="label">{label}</span>
      {extra.area ? <textarea aria-label={label} rows={3} maxLength={extra.max ?? 4000} value={f(k)} onChange={(e) => onPatch({ [k]: e.target.value })} className="w-full" /> : <input aria-label={label} maxLength={extra.max ?? 200} value={f(k)} onChange={(e) => onPatch({ [k]: e.target.value })} className="w-full" />}
    </label>
  );
  return (
    <div className="space-y-2">
      {input("label", "Box title", { max: 60 })}
      {node.type === "trigger" && (
        <>
          <label className="block text-sm">
            <span className="label">Starts</span>
            <select aria-label="Start kind" value={f("kind")} onChange={(e) => onPatch({ kind: e.target.value })}>
              <option value="manual">only when I press Run</option>
              <option value="event">when a text event arrives</option>
              <option value="interval">every so many minutes</option>
            </select>
          </label>
          {f("kind") === "event" && input("eventName", "Event name (for example inbox)", { max: 40 })}
          {f("kind") === "interval" && (
            <label className="block text-sm">
              <span className="label">Every how many minutes (15 or more)</span>
              <input aria-label="Minutes" type="number" min={15} max={10080} value={f("everyMinutes")} onChange={(e) => onPatch({ everyMinutes: Number(e.target.value) })} className="w-28" />
            </label>
          )}
          <p className="hint">Switching a workflow on is a separate step. Until then it only runs when you press Run.</p>
        </>
      )}
      {node.type === "bot_task" && (
        <>
          <label className="block text-sm">
            <span className="label">Which bot</span>
            <select aria-label="Bot" value={f("botId")} onChange={(e) => onPatch({ botId: e.target.value })}>
              <option value="">Choose a bot…</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {input("instruction", "What the bot should do ({{input}} and {{boxname}} fill in earlier results)", { area: true })}
          <label className="block text-sm">
            <span className="label">If it fails, try again up to</span>
            <select aria-label="Retries" value={f("retries")} onChange={(e) => onPatch({ retries: Number(e.target.value) })}>
              <option value="0">0 more times</option>
              <option value="1">1 more time</option>
              <option value="2">2 more times</option>
            </select>
          </label>
          <p className="hint">A box that already asked for an outside action is never repeated automatically.</p>
        </>
      )}
      {node.type === "manager" && input("goal", "What to ask the Manager", { area: true })}
      {node.type === "integration" && <IntegrationFields node={node} bots={bots} onPatch={onPatch} />}
      {node.type === "condition" && (
        <>
          {input("left", "Look at this text (for example {{boxname}})")}
          <label className="block text-sm">
            <span className="label">Check</span>
            <select aria-label="Check" value={f("op")} onChange={(e) => onPatch({ op: e.target.value })}>
              <option value="contains">contains</option>
              <option value="not_contains">does not contain</option>
              <option value="equals">is exactly</option>
              <option value="not_equals">is not</option>
              <option value="not_empty">is not empty</option>
              <option value="longer_than">is longer than (letters)</option>
            </select>
          </label>
          {input("value", "Compare with")}
        </>
      )}
      {node.type === "checkpoint" && input("message", "What to show you before it continues", { area: true, max: 500 })}
      {node.type === "set" && input("value", "Text to produce", { area: true })}
    </div>
  );
}

/**
 * An outside action box. It goes through the same approval gate as an agent: a read runs at once only if the chosen agent is allowed to read that service;
 * a write always waits for your approval on the Approvals page, and the workflow continues only after you approve. It grants nothing.
 */
function IntegrationFields({ node, bots, onPatch }: { node: WfNode; bots: Bot[]; onPatch: (p: Record<string, unknown>) => void }) {
  const integrations = useIntegrations();
  const list = integrations.data?.integrations ?? [];
  const connector = String(node["connector"] ?? "");
  const action = String(node["action"] ?? "");
  const svc = list.find((i) => i.id === connector);
  const act = svc?.actions.find((a) => a.name === action);
  const args = (node["args"] as Record<string, string | number | boolean> | undefined) ?? {};
  const [text, setText] = useState(() => Object.entries(args).map(([k, v]) => `${k} = ${String(v)}`).join("\n"));
  const parse = (value: string) => {
    const out: Record<string, string | number | boolean> = {};
    for (const line of value.split("\n")) {
      const i = line.indexOf("=");
      if (i < 1) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      out[k] = v === "true" ? true : v === "false" ? false : v !== "" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
    return out;
  };
  return (
    <>
      <label className="block text-sm">
        <span className="label">Which agent acts</span>
        <select aria-label="Acting agent" value={String(node["botId"] ?? "")} onChange={(e) => onPatch({ botId: e.target.value })}>
          <option value="">Choose an agent…</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="label">Service</span>
        <select aria-label="Service" value={connector} onChange={(e) => onPatch({ connector: e.target.value, action: "" })}>
          <option value="">Choose a service…</option>
          {list.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}{i.notReady ? " (not set up)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="label">Action</span>
        <select aria-label="Action" value={action} disabled={!svc} onChange={(e) => onPatch({ action: e.target.value })}>
          <option value="">Choose an action…</option>
          {(svc?.actions ?? []).map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} ({a.kind === "write" ? "needs your approval" : "read"})
            </option>
          ))}
        </select>
      </label>
      {act && <p className="hint" role="note">{act.description}. {act.kind === "write" ? "The workflow stops here until you approve this on the Approvals page. Nothing is sent or saved before that." : "A read runs straight away, but only if this agent is allowed to read this service (its Permissions tab)."}</p>}
      <label className="block text-sm">
        <span className="label">Fields, one per line as name = value ({"{{input}}"} and {"{{boxname}}"} fill in earlier results)</span>
        <textarea aria-label="Action fields" rows={4} value={text} onChange={(e) => { setText(e.target.value); onPatch({ args: parse(e.target.value) }); }} className="w-full" />
      </label>
    </>
  );
}

/** The boxes in the order they run (from Start along the arrows; any box not reachable comes last). */
export function runOrder(nodes: WfNode[], edges: WfEdge[]): WfNode[] {
  const seen = new Set<string>();
  const out: WfNode[] = [];
  const queue = nodes.filter((n) => n.type === "trigger").map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes.find((x) => x.id === id);
    if (n) out.push(n);
    for (const e of edges) if (e.from === id) queue.push(e.to);
  }
  return [...out, ...nodes.filter((n) => !seen.has(n.id))];
}

/**
 * The phone-friendly editor: the same boxes and arrows as a vertical list. You pick a box to edit it, press "Arrow from here" and then
 * "Arrow to here" on another box, and remove arrows in the Arrows list; the drawing and this list edit the very same data.
 */
function StepList({
  nodes,
  edges,
  selected,
  connectFrom,
  badNodes,
  onSelect,
  onArrowFrom,
  onArrowTo,
}: {
  nodes: WfNode[];
  edges: WfEdge[];
  selected: string | null;
  connectFrom: string | null;
  badNodes: Set<string | undefined>;
  onSelect: (id: string) => void;
  onArrowFrom: (id: string) => void;
  onArrowTo: (id: string) => void;
}) {
  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? n.label || n.id : id;
  };
  return (
    <ol aria-label="Boxes in running order" className="space-y-2">
      {runOrder(nodes, edges).map((n, i) => (
        <li
          key={n.id}
          role="group"
          aria-label={`Box ${n.id}`}
          className={`awp-node rounded-md border-2 p-2 text-sm ${TYPE_STYLE[n.type]} ${selected === n.id ? "ring-2 ring-indigo-400" : ""} ${badNodes.has(n.id) ? "outline outline-2 outline-red-500" : ""}`}
        >
          <button type="button" aria-label={`Edit box ${n.id}`} aria-pressed={selected === n.id} onClick={() => onSelect(n.id)} className="flex min-h-11 w-full items-center gap-2 text-left font-semibold">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/70 text-xs dark:bg-black/30">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              {TYPE_LABEL[n.type]}: {n.label || n.id}
            </span>
          </button>
          {edges.filter((e) => e.from === n.id).map((e) => (
            <p key={e.id} className="ml-8 text-xs text-slate-700 dark:text-slate-300">
              then {e.when !== "always" ? `(${e.when}) ` : ""}→ {label(e.to)}
            </p>
          ))}
          <div className="ml-8 mt-1 flex flex-wrap gap-2">
            {n.type !== "end" && (
              <button type="button" className="min-h-11 rounded bg-white/70 px-3 underline dark:bg-black/30" aria-label={`Draw an arrow from ${n.id}`} onClick={() => onArrowFrom(n.id)}>
                Arrow from here
              </button>
            )}
            {connectFrom && connectFrom !== n.id && n.type !== "trigger" && (
              <button type="button" className="min-h-11 rounded bg-indigo-600 px-3 text-white" aria-label={`Draw the arrow to ${n.id}`} onClick={() => onArrowTo(n.id)}>
                Arrow to here
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
