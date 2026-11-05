import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useProjectWorkspace, useWorkspaceEntryAction, type ProjectWorkspace as Workspace, type WorkspaceEntry, type WorkspaceEntryKind } from "../api/workHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

/** How each kind is labelled. Facts, assumptions and recommendations look different on purpose (requirement: keep them apart). */
const KIND: Record<WorkspaceEntryKind, { label: string; tone: string }> = {
  fact: { label: "Fact (agent cites a source)", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  assumption: { label: "Assumption (not verified)", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  recommendation: { label: "Recommendation", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  finding: { label: "Finding", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  progress: { label: "Progress", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  handover: { label: "Handover", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  note: { label: "Note", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};
const RESEARCH: WorkspaceEntryKind[] = ["finding", "fact", "assumption", "recommendation"];
const NOTES: WorkspaceEntryKind[] = ["progress", "handover", "note"];
const TABS = ["Research and findings", "Task notes", "Shared files", "Agent contributions", "Recent updates"] as const;
type Tab = (typeof TABS)[number];

function Entry({ e, ws, projectId }: { e: WorkspaceEntry; ws: Workspace; projectId: string }) {
  const act = useWorkspaceEntryAction();
  const root = ws.tasks.find((t) => t.id === e.taskId)?.rootId ?? e.taskId;
  const replacement = e.replacedBy ? ws.entries.find((x) => x.id === e.replacedBy) : null;
  const replaced = e.replaces ? ws.entries.find((x) => x.id === e.replaces) : null;
  return (
    <li className={`card space-y-1 ${e.withdrawn || e.replacedBy ? "opacity-60" : ""}`} aria-label={`Entry ${e.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND[e.kind].tone}`}>{KIND[e.kind].label}</span>
        {e.checkedByOwner && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">Checked by you</span>}
        {e.withdrawn && <span className="rounded-full bg-slate-500 px-2 py-0.5 text-xs font-medium text-white">Withdrawn</span>}
        {replacement && <span className="text-xs">Replaced by {replacement.ref}</span>}
        <span className="hint text-xs">{e.ref}</span>
      </div>
      <p className="font-semibold">{e.title}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{e.text}</p>
      {e.source && <p className="text-xs">Source given by the agent: {e.source}</p>}
      {e.platformNote && <p className="text-xs text-amber-800 dark:text-amber-300">Platform: {e.platformNote}</p>}
      {(e.warnings ?? []).length > 0 && (
        <ul className="space-y-0.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" aria-label={`Number warnings for ${e.title}`}>
          {e.warnings.map((w) => (
            <li key={w}>! {w}</li>
          ))}
        </ul>
      )}
      {e.forName && <p className="text-xs">For: {e.forName}</p>}
      {replaced && <p className="text-xs">Corrects {replaced.ref} ({replaced.title})</p>}
      <p className="hint text-xs">
        By {e.authorName} · {when(e.createdAt)}
        {root && (
          <>
            {" "}· <Link className="underline" to={`/tasks/${root}`}>task</Link>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {!e.checkedByOwner && (
          <button className="btn-secondary" aria-label={`Mark ${e.title} as checked`} disabled={act.isPending} onClick={() => act.mutate({ op: "check", projectId, entryId: e.id })}>
            Mark as checked
          </button>
        )}
        <button className="btn-secondary" aria-label={`${e.withdrawn ? "Restore" : "Withdraw"} ${e.title}`} disabled={act.isPending} onClick={() => act.mutate({ op: "withdraw", projectId, entryId: e.id, on: !e.withdrawn })}>
          {e.withdrawn ? "Restore" : "Withdraw"}
        </button>
      </div>
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
    </li>
  );
}

/** A project's shared workspace: what its agents found, the files they produced, who contributed what, and recent updates. Read and review only. */
export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const q = useProjectWorkspace(projectId);
  const [tab, setTab] = useState<Tab>("Research and findings");
  const [showOld, setShowOld] = useState(false);
  if (q.isLoading) return <p className="hint">Loading the workspace…</p>;
  if (!q.data) return <p role="alert" className="text-red-700 dark:text-red-300">{errorText(q.error) ?? "The workspace could not be loaded."}</p>;
  const ws = q.data;
  const visible = (kinds: WorkspaceEntryKind[]) => ws.entries.filter((e) => kinds.includes(e.kind) && (showOld || (!e.withdrawn && !e.replacedBy)));
  const count: Record<Tab, number> = {
    "Research and findings": visible(RESEARCH).length,
    "Task notes": visible(NOTES).length,
    "Shared files": ws.files.length,
    "Agent contributions": ws.contributions.length,
    "Recent updates": ws.activity.length,
  };
  const list = (kinds: WorkspaceEntryKind[], empty: string) => {
    const items = visible(kinds);
    return items.length === 0 ? <p className="hint">{empty}</p> : <ul className="space-y-2">{items.map((e) => <Entry key={e.id} e={e} ws={ws} projectId={projectId} />)}</ul>;
  };
  return (
    <section className="space-y-3" aria-label="Shared workspace">
      <h3 className="font-semibold">Shared workspace</h3>
      <p className="hint">
        Agents working on a task in this project see what the others found, the files they produced and earlier finished work before they start, and publish their own results here. Labels are the agents' own; "Checked by you" is yours. Number warnings (marked !) are the platform's checks: they never change a value, and checking an entry clears its "unsupported" warning. The workspace gives no agent a permission, folder or approval. Start work in this project from{" "}
        <Link className="underline" to="/tasks">Tasks</Link> (choose the project).
      </p>
      <div role="tablist" aria-label="Workspace sections" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t)}>
            {t} ({count[t]})
          </button>
        ))}
      </div>
      {(tab === "Research and findings" || tab === "Task notes") && (
        <label className="text-sm">
          <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show withdrawn and replaced entries
        </label>
      )}
      <div role="tabpanel" aria-label={tab}>
        {tab === "Research and findings" && list(RESEARCH, "No research yet. Agents publish findings here when they finish a task in this project.")}
        {tab === "Task notes" && list(NOTES, "No progress notes or handovers yet.")}
        {tab === "Shared files" &&
          (ws.files.length === 0 ? (
            <p className="hint">No files yet. Files appear when an agent in this project asks to create one; they exist only after you approve them.</p>
          ) : (
            <ul className="space-y-1">
              {ws.files.map((f) => (
                <li key={f.approvalId} className="card text-sm" aria-label={`File ${f.path}`}>
                  <span className="break-all font-mono">{f.path}</span>
                  <span className="hint block">
                    {f.status === "created" ? "Created" : "Waiting for your approval (does not exist yet)"} · owner: {f.ownerName} · {f.action} · {when(f.at)}
                    {f.status === "waiting_for_approval" && (
                      <>
                        {" "}· <Link className="underline" to="/approvals">Approvals</Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        {tab === "Agent contributions" &&
          (ws.contributions.length === 0 ? (
            <p className="hint">No agent has worked on this project yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Entries</th>
                  <th>Files</th>
                  <th>Tasks done</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {ws.contributions.map((c) => (
                  <tr key={c.botId} aria-label={`Contribution ${c.name}`}>
                    <td>{c.name}</td>
                    <td title={Object.entries(c.byKind).map(([k, n]) => `${n} ${k}`).join(", ")}>{c.entries}</td>
                    <td>{c.files}</td>
                    <td>{c.tasksCompleted}</td>
                    <td>{when(c.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === "Recent updates" &&
          (ws.activity.length === 0 ? (
            <p className="hint">Nothing has happened in this workspace yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {ws.activity.map((a, i) => (
                <li key={`${a.at}:${i}`}>
                  <span className="hint">{when(a.at)}</span> {a.botName ?? "You"}: {a.kind.replace(".", " ")} {a.ref ? `${a.ref} ` : ""}- <span className="break-words">{a.text}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
