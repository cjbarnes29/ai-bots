import { Link } from "react-router-dom";
import { useBotProjects, useRelated, where, type RelatedKind } from "../../api/hubHooks";

/**
 * "Where does this belong?" for one thing: its project, agent and task, as links. Reads /api/related; shows nothing while loading or if the
 * server does not know the item (no guessing). Links only navigate; they grant nothing.
 */
export function ContextLinks({ kind, id }: { kind: RelatedKind; id: string | null | undefined }) {
  const rel = useRelated(kind, id);
  const r = rel.data;
  if (!r) return null;
  const links: { to: string; label: string }[] = [];
  if (r.project) links.push({ to: where.project(r.project.id), label: `Project: ${r.project.name}` });
  if (r.bot && kind !== "bot") links.push({ to: where.agent(r.bot.id), label: `Agent: ${r.bot.name}` });
  if (r.task && kind !== "task") links.push({ to: where.task(r.task.id), label: r.task.status === "failed" ? "Task (failed): see the error" : "Task" });
  if (r.approval && kind !== "approval") links.push({ to: where.approval(r.approval.id), label: "Approval" });
  if (links.length === 0) return null;
  return (
    <nav aria-label="Related" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="hint">Related:</span>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-3 text-indigo-700 hover:bg-slate-100 dark:border-slate-700 dark:text-indigo-300 dark:hover:bg-slate-800">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** The projects an agent takes part in (derived from its conversations and tasks). */
export function AgentProjects({ botId }: { botId: string }) {
  const q = useBotProjects(botId);
  const list = q.data?.projects ?? [];
  return (
    <nav aria-label="Projects of this agent" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="hint">Projects:</span>
      {list.length === 0 && <span className="hint">none yet</span>}
      {list.map((p) => (
        <Link key={p.id} to={where.project(p.id)} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-3 text-indigo-700 hover:bg-slate-100 dark:border-slate-700 dark:text-indigo-300 dark:hover:bg-slate-800">
          {p.name}
        </Link>
      ))}
    </nav>
  );
}
