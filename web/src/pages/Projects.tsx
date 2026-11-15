import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useMemoryNotes, useSchedules, useTasks, useWorkflows } from "../api/hooks";
import { useInbox, useProject, useProjectAction, useProjects } from "../api/workHooks";
import { isHubTab, ProjectHub } from "../components/hub/ProjectHub";
import { QueryStatus } from "../components/ui/QueryStatus";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const KINDS = ["conversation", "workflow", "schedule", "task", "note"];
const KIND_NOUN: Record<string, string> = { conversation: "conversation", workflow: "workflow", schedule: "schedule", task: "task", note: "shared note" };
type Choice = { id: string; label: string };
type Source = { choices: Choice[]; query: { data: unknown; isPending: boolean; isError: boolean; isFetching: boolean; dataUpdatedAt: number; refetch: () => unknown } };
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** Each source reads only when its kind is chosen. A failed read says so; it is never shown as "nothing to link". */
function ConversationChoices({ children }: { children: (s: Source) => React.ReactNode }) {
  const q = useInbox("all", "");
  return <>{children({ query: q, choices: (q.data?.items ?? []).map((i) => ({ id: i.conversationId, label: `${i.title} (${i.botName})` })) })}</>;
}
function WorkflowChoices({ children }: { children: (s: Source) => React.ReactNode }) {
  const q = useWorkflows(false);
  return <>{children({ query: q, choices: (q.data?.workflows ?? []).map((w) => ({ id: w.id, label: w.name })) })}</>;
}
function ScheduleChoices({ children }: { children: (s: Source) => React.ReactNode }) {
  const q = useSchedules();
  return <>{children({ query: q, choices: (q.data ?? []).map((x) => ({ id: x.id, label: `${x.name} (${x.botName})` })) })}</>;
}
function TaskChoices({ children }: { children: (s: Source) => React.ReactNode }) {
  const q = useTasks();
  const newest = [...(q.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  return <>{children({ query: q, choices: newest.map((t) => ({ id: t.id, label: `${clip(t.instruction, 60)} (${t.assigneeName}, ${t.status})` })) })}</>;
}
function NoteChoices({ children }: { children: (s: Source) => React.ReactNode }) {
  const q = useMemoryNotes("shared", "", false, "");
  return <>{children({ query: q, choices: (q.data ?? []).map((n) => ({ id: n.id, label: n.title })) })}</>;
}
const SOURCES: Record<string, (p: { children: (s: Source) => React.ReactNode }) => React.JSX.Element> = { conversation: ConversationChoices, workflow: WorkflowChoices, schedule: ScheduleChoices, task: TaskChoices, note: NoteChoices };

/** Pick what to link from a list of real items (already-linked ones are left out). The raw id box below stays for anything not listed. */
function ItemPicker({ kind, linked, value, onChange }: { kind: string; linked: Set<string>; value: string; onChange: (id: string) => void }) {
  const Source = SOURCES[kind]!;
  const noun = KIND_NOUN[kind] ?? kind;
  return (
    <Source>
      {({ choices, query }) => {
        const open = choices.filter((c) => !linked.has(c.id));
        return (
          <div className="space-y-1">
            <QueryStatus query={query} label={`${noun} list`} />
            {query.isError && <button type="button" className="btn-secondary min-h-11" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry {noun} list</button>}
            {!query.isError && !query.isPending && open.length === 0 && <p className="hint text-sm">{choices.length === 0 ? `No ${noun} exists yet.` : `Every ${noun} is already linked to this project.`}</p>}
            {open.length > 0 && (
              <label className="text-sm">
                {`Choose a ${noun}`}
                <select className="input ml-1 max-w-full" aria-label={`Choose a ${noun}`} value={open.some((c) => c.id === value) ? value : ""} onChange={(e) => onChange(e.target.value)}>
                  <option value="">Choose…</option>
                  {open.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      }}
    </Source>
  );
}

function Detail({ id, onGone }: { id: string; onGone: () => void }) {
  const one = useProject(id);
  const act = useProjectAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState("conversation");
  const [itemId, setItemId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const p = one.data?.project;
  useEffect(() => {
    if (p) {
      setName(p.name);
      setDescription(p.description);
      setInstructions(p.instructions);
    }
  }, [p?.id, p?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (one.isPending) return <QueryStatus query={one} label="project settings" />;
  if (!p || !one.data) return <div className="space-y-2"><QueryStatus query={one} label="project settings" /><p role="alert">{errorText(one.error) ?? "Project not found."}</p><button className="btn-secondary" disabled={one.isFetching} onClick={() => void one.refetch()}>Retry project settings</button></div>;
  return (
    <section className="card space-y-3" aria-label={`Project ${p.name}`}>
      <h2 className="text-lg font-semibold">{p.name}</h2>
      <QueryStatus query={one} label="project settings" freshness />
      {one.isError && <button className="btn-secondary" disabled={one.isFetching} onClick={() => void one.refetch()}>Retry project settings</button>}
      {one.isFetching && !one.isPending && <p role="status" className="hint">Refreshing project settings…</p>}
      <label className="block text-sm">
        Name
        <input className="input w-full" aria-label="Project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">
        Description
        <textarea className="input w-full" aria-label="Project description" rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="block text-sm">
        Instructions for agents working on this project
        <textarea className="input w-full" aria-label="Project instructions" rows={4} value={instructions} maxLength={8000} onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <p className="hint">Instructions are text only. A project never gives an agent a permission, a folder, an application or a secret.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate({ op: "update", id, name, description, instructions })}>
          Save project
        </button>
        <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "archive", id, on: !p.archived }, { onSuccess: onGone })}>
          {p.archived ? "Unarchive" : "Archive"}
        </button>
      </div>

      <h3 className="font-semibold">Linked items</h3>
      <ul className="space-y-1">
        {one.data.items.length === 0 && <li className="hint">Nothing linked yet.</li>}
        {one.data.items.map((it) => (
          <li key={`${it.kind}:${it.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={`Item ${it.title ?? it.id}`}>
            <span>
              {it.pinned ? "📌 " : ""}
              {it.kind}: {it.title ?? <em>(no longer exists)</em>}
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary" aria-label={`${it.pinned ? "Unpin" : "Pin"} ${it.title ?? it.id}`} onClick={() => act.mutate({ op: "pin", id, kind: it.kind, itemId: it.id, on: !it.pinned })}>
                {it.pinned ? "Unpin" : "Pin"}
              </button>
              <button className="btn-secondary" aria-label={`Unlink ${it.title ?? it.id}`} onClick={() => act.mutate({ op: "unlink", id, kind: it.kind, itemId: it.id })}>
                Unlink
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Kind
          <select className="input ml-1" aria-label="Item kind" value={kind} onChange={(e) => { setKind(e.target.value); setItemId(""); }}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <ItemPicker kind={kind} linked={new Set(one.data.items.filter((it) => it.kind === kind).map((it) => it.id))} value={itemId} onChange={setItemId} />
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer">Enter an id instead</summary>
          <label className="text-sm">
            Item id
            <input className="input ml-1" aria-label="Item id" value={itemId} onChange={(e) => setItemId(e.target.value)} />
          </label>
        </details>
        <button className="btn-secondary" disabled={!itemId.trim() || act.isPending} onClick={() => act.mutate({ op: "link", id, kind, itemId: itemId.trim() }, { onSuccess: () => setItemId("") })}>
          Link item
        </button>
      </div>

      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-semibold">Delete this project</summary>
        <p className="hint">Deleting removes the project and its links only. Linked conversations, tasks and workflows are not deleted. Type the project name to confirm.</p>
        <input className="input" aria-label="Type the project name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        <button className="btn-secondary" disabled={confirmName !== p.name || act.isPending} onClick={() => act.mutate({ op: "delete", id, confirmName }, { onSuccess: onGone })}>
          Delete project
        </button>
      </details>
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
    </section>
  );
}

export function Projects() {
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const selected = routeId ?? null;
  const setSelected = (id: string | null) => navigate(id ? `/projects/${id}` : "/projects");
  const tabParam = search.get("tab");
  const tab = isHubTab(tabParam) ? tabParam : "overview";
  const [newName, setNewName] = useState("");
  const list = useProjects(archived, q);
  const act = useProjectAction();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="hint">Keep conversations, tasks, files and decisions together. Open a project to see what needs you and continue with the AI Assistant.</p>
      </div>
      {selected && (
        <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
          ← All projects
        </button>
      )}
      {!selected && (
      <form
        className="card flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ op: "create", name: newName }, { onSuccess: () => setNewName("") });
        }}
      >
        <label className="text-sm">
          New project name
          <input className="input ml-2" aria-label="New project name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button className="btn-primary" type="submit" disabled={!newName.trim() || act.isPending}>
          Create project
        </button>
      </form>
      )}
      {act.error && !selected && <p role="alert" className="text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
      {!selected && (
      <div className="flex flex-wrap items-center gap-3">
        <input className="input" aria-label="Search projects" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-sm">
          <input type="checkbox" aria-label="Show archived projects" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      )}
      {!selected && <div className="space-y-2" aria-label="Project list status">
        <QueryStatus query={list} label="projects" freshness />
        {list.isFetching && !list.isPending && <p role="status" className="hint">Refreshing projects; the last available list is shown until the check finishes.</p>}
        {list.isError && <button className="btn-secondary min-h-11" disabled={list.isFetching} onClick={() => void list.refetch()}>Retry projects</button>}
      </div>}
      <div>
        {!selected && (
        <ul className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Projects list">
          {!list.isError && !list.isFetching && list.data?.length === 0 && <li className="card md:col-span-2 xl:col-span-3"><p className="font-medium">{q.trim() ? "No projects match this search." : "No projects here yet."}</p><p className="hint">{q.trim() ? "Try another name or change the archived filter." : "Create a project above to keep related work together."}</p></li>}
          {list.data?.map((p) => (
            <li key={p.id} className={`card ${selected === p.id ? "ring-2 ring-sky-500" : ""}`} aria-label={`Project row ${p.name}`}>
              <button className="min-h-11 w-full space-y-1 text-left [overflow-wrap:anywhere]" aria-label={`Open ${p.name}`} onClick={() => setSelected(p.id)}>
                <span className="block font-semibold">{p.name}</span>
                <span className="hint block">Linked items: {Object.entries(p.counts).map(([k, n]) => `${n} ${k}`).join(" · ") || "none yet"}</span>
                {p.description && <span className="block text-sm">{p.description}</span>}
              </button>
            </li>
          ))}
        </ul>
        )}
        <div className="min-w-0">{selected ? (
            <ProjectHub projectId={selected} tab={tab} onTab={(next) => setSearch({ tab: next }, { replace: true })} settings={<Detail id={selected} onGone={() => setSelected(null)} />} />
          ) : null}</div>
      </div>
    </div>
  );
}
