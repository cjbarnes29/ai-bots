import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBoard, useLayouts, useNodeActivity, useOrganization, useWorkforceAct, type BoardData, type BoardEdge, type BoardNode } from "../api/collabHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const KIND_TEXT: Record<string, string> = { manager: "Manager", division: "Division", group: "Group", bot: "Bot", project: "Project", decision: "Decision", task: "Task", approval: "Approval", deliverable: "Deliverable" };
const STATUS_TEXT: Record<string, string> = { active: "Active", completed: "Completed", blocked: "Blocked", failed: "Failed", idle: "Idle", cancelled: "Cancelled" };
const STATUS_FILL: Record<string, string> = { active: "#0ea5e9", completed: "#16a34a", blocked: "#d97706", failed: "#dc2626", idle: "#64748b", cancelled: "#94a3b8" };
const EDGE_COLOR: Record<string, string> = { coordinates: "#7c3aed", member: "#64748b", dedicated: "#0891b2", shared: "#0d9488", delegation: "#2563eb", assigned: "#94a3b8", subtask: "#f59e0b", origin: "#a3a3a3", project: "#16a34a", decision: "#db2777", approval: "#d97706" };
const NODE_W = 132;
const NODE_H = 44;
const GAP_X = 150;
const GAP_Y = 120;
type Pos = Record<string, { x: number; y: number }>;

function defaultPositions(nodes: BoardNode[]): Pos {
  const perLane = new Map<number, number>();
  const out: Pos = {};
  for (const n of nodes) {
    const i = perLane.get(n.lane) ?? 0;
    perLane.set(n.lane, i + 1);
    out[n.id] = { x: 20 + i * GAP_X, y: 20 + n.lane * GAP_Y };
  }
  return out;
}

function Inspector({ node, board, onClose }: { node: BoardNode; board: BoardData; onClose: () => void }) {
  const activity = useNodeActivity(node.kind, node.refId);
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const links = board.edges.filter((e) => e.from === node.id || e.to === node.id);
  return (
    <aside className="card space-y-2" aria-label={`Inspector ${node.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{node.label}</p>
          <p className="hint">{KIND_TEXT[node.kind]} · {STATUS_TEXT[node.status]}{node.sub ? ` · ${node.sub}` : ""}</p>
        </div>
        <button className="btn-secondary" onClick={onClose} aria-label="Close inspector">Close</button>
      </div>
      {node.link && <Link to={node.link} className="underline text-sm">Open the full record</Link>}
      <dl className="space-y-1 text-sm">
        {Object.entries(node.detail).filter(([, v]) => v !== null && v !== "" && typeof v !== "object").map(([k, v]) => (
          <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline break-words">{String(v)}</dd></div>
        ))}
      </dl>
      <h3 className="text-sm font-semibold">Connections</h3>
      <ul className="space-y-1 text-sm">
        {links.length === 0 && <li className="hint">None.</li>}
        {links.slice(0, 20).map((e) => {
          const other = byId.get(e.from === node.id ? e.to : e.from);
          return <li key={e.id} className="hint">{e.from === node.id ? "→" : "←"} {e.kind} {other ? `${KIND_TEXT[other.kind]}: ${other.label}` : ""}</li>;
        })}
      </ul>
      <h3 className="text-sm font-semibold">History</h3>
      <ul className="space-y-1 text-sm" aria-label="Node history">
        {activity.isLoading && <li className="hint">Loading…</li>}
        {activity.data?.history.length === 0 && <li className="hint">No recorded history.</li>}
        {activity.data?.history.slice(0, 12).map((h, i) => <li key={i} className="hint">{new Date(h.at).toLocaleString()} · {h.text}</li>)}
      </ul>
    </aside>
  );
}

function Board({ board }: { board: BoardData }) {
  const layouts = useLayouts();
  const act = useWorkforceAct();
  const [hidden, setHidden] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [division, setDivision] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [moved, setMoved] = useState<Pos>({});
  const [layoutName, setLayoutName] = useState("");
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const base = useMemo(() => defaultPositions(board.nodes), [board.nodes]);
  const pos = (id: string) => moved[id] ?? base[id] ?? { x: 0, y: 0 };
  const visible = board.nodes.filter((n) => !hidden.includes(n.kind) && (!status || n.status === status) && (!division || n.divisions.includes(division) || n.id === `division:${division}` || n.kind === "manager"));
  const visibleIds = new Set(visible.map((n) => n.id));
  const edges: BoardEdge[] = board.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  const width = Math.max(900, ...visible.map((n) => pos(n.id).x + NODE_W + 40));
  const height = Math.max(400, ...visible.map((n) => pos(n.id).y + NODE_H + 40));
  const sel = board.nodes.find((n) => n.id === selected) ?? null;
  const present = [...new Set(board.nodes.map((n) => n.kind))];
  const toggleKind = (k: string) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]);

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    const p = pos(id);
    drag.current = { id, dx: e.clientX - p.x, dy: e.clientY - p.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setMoved((m) => ({ ...m, [d.id]: { x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) } }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Board filters">
        {present.map((k) => (
          <label key={k} className="text-sm"><input type="checkbox" aria-label={`Show ${KIND_TEXT[k]}`} checked={!hidden.includes(k)} onChange={() => toggleKind(k)} /> {KIND_TEXT[k]}</label>
        ))}
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Filter by division" value={division} onChange={(e) => setDivision(e.target.value)}>
          <option value="">All divisions</option>
          <option value="personal_office">Personal Office</option>
          <option value="business_operations">Business Operations</option>
          <option value="ai_digital_agency">AI Digital Agency</option>
          <option value="research_innovation">Research &amp; Innovation</option>
        </select>
        {(hidden.length > 0 || status || division) && <button className="btn-secondary" onClick={() => { setHidden([]); setStatus(""); setDivision(""); }}>Clear filters</button>}
      </div>
      <p className="hint" role="status">
        Work: {board.counts.active ?? 0} active · {board.counts.completed ?? 0} completed · {board.counts.blocked ?? 0} blocked · {board.counts.failed ?? 0} failed.
        {board.truncated.length ? ` Showing the newest only for: ${board.truncated.join(", ")}.` : ""} {board.note}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input className="input" aria-label="Layout name" placeholder="Layout name" value={layoutName} maxLength={40} onChange={(e) => setLayoutName(e.target.value)} />
        <button className="btn-secondary" disabled={!layoutName.trim() || act.isPending} onClick={() => act.mutate({ op: "saveLayout", name: layoutName, positions: Object.fromEntries(board.nodes.map((n) => [n.id, pos(n.id)])), filters: { status, division, hidden: hidden.join(",") } })}>Save layout</button>
        <select className="input" aria-label="Saved layouts" value="" onChange={(e) => { const l = layouts.data?.[e.target.value]; if (l) { setMoved(l.positions); setStatus(l.filters["status"] ?? ""); setDivision(l.filters["division"] ?? ""); setHidden(l.filters["hidden"] ? String(l.filters["hidden"]).split(",").filter(Boolean) : []); } }}>
          <option value="">Load a saved layout…</option>
          {Object.keys(layouts.data ?? {}).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="btn-secondary" onClick={() => setMoved({})}>Reset positions</button>
      </div>
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Large screens: the interactive board. Drag a node to move it; click it to inspect it. */}
        <div className="hidden min-w-0 overflow-auto rounded-md border border-slate-300 md:block dark:border-slate-700" aria-label="Workforce board">
          <svg width={width} height={height} role="img" aria-label="Workforce board graph" onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)}>
            {edges.map((e) => {
              const a = pos(e.from);
              const b = pos(e.to);
              const hot = selected === e.from || selected === e.to;
              return <line key={e.id} x1={a.x + NODE_W / 2} y1={a.y + NODE_H / 2} x2={b.x + NODE_W / 2} y2={b.y + NODE_H / 2} stroke={EDGE_COLOR[e.kind] ?? "#999"} strokeWidth={hot ? 3 : 1.2} strokeOpacity={selected && !hot ? 0.2 : 0.8} strokeDasharray={e.kind === "delegation" ? "5 3" : undefined} data-edge={e.kind} />;
            })}
            {visible.map((n) => {
              const p = pos(n.id);
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} onPointerDown={(e) => onPointerDown(e, n.id)} onClick={() => setSelected(n.id)} style={{ cursor: "grab" }} tabIndex={0} role="button" aria-label={`${KIND_TEXT[n.kind]} ${n.label} ${STATUS_TEXT[n.status]}`} onKeyDown={(e) => e.key === "Enter" && setSelected(n.id)}>
                  <rect width={NODE_W} height={NODE_H} rx={8} fill="white" stroke={STATUS_FILL[n.status]} strokeWidth={selected === n.id ? 4 : 2} />
                  <text x={8} y={18} fontSize={12} fontWeight={600} fill="#0f172a">{n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}</text>
                  <text x={8} y={34} fontSize={10} fill="#475569">{KIND_TEXT[n.kind]} · {STATUS_TEXT[n.status]}</text>
                </g>
              );
            })}
          </svg>
        </div>
        {/* Phones and narrow windows: the same nodes as a list, grouped by kind. */}
        <div className="min-w-0 space-y-2 md:hidden" aria-label="Workforce list">
          {Object.entries(KIND_TEXT).map(([k, label]) => {
            const items = visible.filter((n) => n.kind === k);
            if (items.length === 0) return null;
            return (
              <section key={k}>
                <h3 className="text-sm font-semibold">{label}s</h3>
                <ul className="space-y-1">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button className="card w-full text-left" aria-label={`List ${KIND_TEXT[n.kind]} ${n.label}`} onClick={() => setSelected(n.id)}>
                        <span className="font-semibold">{n.label}</span> <span className="hint">{STATUS_TEXT[n.status]}{n.sub ? ` · ${n.sub}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <div className="min-w-0">{sel ? <Inspector node={sel} board={board} onClose={() => setSelected(null)} /> : <p className="hint">Select a node to see its details, connections and history.</p>}</div>
      </div>
      <p className="hint">Lines: <span style={{ color: EDGE_COLOR["coordinates"] }}>coordinates</span> · <span style={{ color: EDGE_COLOR["delegation"] }}>delegation allowed</span> · <span style={{ color: EDGE_COLOR["subtask"] }}>sub-task</span> · member · assigned · project · decision · approval.</p>
    </div>
  );
}

function Organization() {
  const org = useOrganization();
  const act = useWorkforceAct();
  const [botId, setBotId] = useState("");
  const [kind, setKind] = useState("dedicated");
  const [divs, setDivs] = useState<string[]>(["personal_office"]);
  const [hours, setHours] = useState("4");
  const [purpose, setPurpose] = useState("");
  if (!org.data) return <p className="hint">Loading…</p>;
  const o = org.data;
  const toggle = (k: string) => setDivs(kind === "shared" ? (divs.includes(k) ? divs.filter((x) => x !== k) : [...divs, k]) : [k]);
  return (
    <section className="space-y-3" aria-label="Organisation">
      <div className="card">
        <p className="font-semibold">{o.manager.name}</p>
        <p className="hint">{o.manager.note}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {o.divisions.map((d) => (
          <div key={d.key} className="card text-sm" aria-label={`Division ${d.name}`}>
            <p className="font-semibold">{d.name}</p>
            <p>Dedicated: {d.dedicated.map((b) => b.name).join(", ") || "none"}</p>
            <p>Shared specialists: {d.shared.map((b) => b.name).join(", ") || "none"}</p>
            <p>Temporary agents: {d.temporary.map((b) => `${b.name} (until ${b.expiresAt ? new Date(b.expiresAt).toLocaleString() : "?"}: ${b.purpose})`).join("; ") || "none"}</p>
          </div>
        ))}
      </div>
      <form
        className="card space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ op: "place", botId, kind, divisions: divs, ...(kind === "temporary" ? { expiresInHours: Number(hours), purpose } : {}) });
        }}
      >
        <p className="font-semibold">Place a bot</p>
        <div className="flex flex-wrap gap-2">
          <select className="input" aria-label="Bot to place" value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">Choose a bot…</option>
            {o.unplaced.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="input" aria-label="Kind of bot" value={kind} onChange={(e) => { setKind(e.target.value); setDivs(divs.slice(0, 1)); }}>
            <option value="dedicated">Dedicated (one division)</option>
            <option value="shared">Shared specialist (several divisions)</option>
            <option value="temporary">Temporary task agent</option>
          </select>
          {kind === "temporary" && (
            <>
              <input className="input w-20" aria-label="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
              <input className="input flex-1" aria-label="Purpose" placeholder="What is it for?" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {o.divisions.map((d) => (
            <label key={d.key} className="text-sm"><input type={kind === "shared" ? "checkbox" : "radio"} name="division" aria-label={`In ${d.name}`} checked={divs.includes(d.key)} onChange={() => toggle(d.key)} /> {d.name}</label>
          ))}
        </div>
        <button className="btn-primary" type="submit" disabled={!botId || act.isPending}>Place bot</button>
        <p className="hint">Placing a bot grants it no permission. {o.groupsEnabled ? "It joins the division group." : "Groups are off, so only the placement is recorded."} A temporary agent is archived when its time is up (you can unarchive it).</p>
        {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
      </form>
    </section>
  );
}

export function Workforce() {
  const board = useBoard();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Workforce</h1>
        <p className="hint">One Central Manager, four divisions, and everything they are doing, read from the real records.</p>
      </div>
      <Organization />
      <h2 className="text-lg font-semibold">Workforce board</h2>
      {board.isLoading && <p className="hint">Loading…</p>}
      {board.error && <p role="alert" className="text-red-700 dark:text-red-300">{errorText(board.error)}</p>}
      {board.data && <Board board={board.data} />}
    </div>
  );
}
