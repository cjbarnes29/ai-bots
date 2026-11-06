import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useProjectHub, where, type Hub } from "../../api/hubHooks";
import { useInterfaceLevel } from "../../lib/interfaceLevel";
import { ProjectWorkspace } from "../ProjectWorkspace";
import { Tabs } from "../ui/Tabs";

export const HUB_TABS = ["overview", "conversations", "tasks", "agents", "files", "workflows", "decisions", "settings"] as const;
export type HubTab = (typeof HUB_TABS)[number];
const LABEL: Record<HubTab, string> = {
  overview: "Overview",
  conversations: "Conversations",
  tasks: "Tasks & history",
  agents: "Agents",
  files: "Files & knowledge",
  workflows: "Workflows",
  decisions: "Decisions & approvals",
  settings: "Settings",
};
/** At the Simple level a project page lists five tabs; Agents, Workflows and Settings are listed from Intermediate (a tab you opened by its address stays listed). Nothing is removed. */
const SIMPLE_TABS: HubTab[] = ["overview", "conversations", "tasks", "files", "decisions"];
export const isHubTab = (v: string | null): v is HubTab => !!v && (HUB_TABS as readonly string[]).includes(v);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
const LINK = "text-indigo-700 hover:underline dark:text-indigo-300";

function Empty({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}

function Overview({ hub }: { hub: Hub }) {
  const p = hub.progress;
  return (
    <div className="space-y-4">
      {hub.project.description && <p>{hub.project.description}</p>}
      <section aria-label="Progress" className="card space-y-1">
        <h3 className="font-semibold">Progress</h3>
        {p.total === 0 ? <Empty>No tasks in this project yet.</Empty> : <p>{p.completed} of {p.total} tasks finished · {p.running} running · {p.pending} waiting · {p.failed} failed</p>}
      </section>
      <section aria-label="Needs your attention" className="card space-y-2">
        <h3 className="font-semibold">Needs your attention</h3>
        {hub.attention.length === 0 && <Empty>Nothing is waiting for you.</Empty>}
        <ul className="space-y-1">
          {hub.attention.map((a) => (
            <li key={`${a.kind}:${a.id}`}>
              <Link className={LINK} to={a.kind === "approval" ? where.approval(a.id) : a.kind === "failed_task" ? where.task(a.id) : a.kind === "decision" ? where.decision(a.id) : where.workflowRun(a.id)}>
                {a.text}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <Link className={`${LINK} inline-flex min-h-11 items-center`} to={where.assistant(hub.project.id)}>
        Talk to the AI Assistant about this project
      </Link>
      <p className="hint">
        {hub.conversations.length} conversations · {hub.agents.length} agents · {hub.workflows.length} workflows · {hub.outputs.length} files made · {hub.decisions.length} decisions
      </p>
    </div>
  );
}

function Panel({ hub, tab }: { hub: Hub; tab: HubTab }) {
  switch (tab) {
    case "conversations":
      return hub.conversations.length === 0 ? (
        <Empty>No conversations are linked yet. Start one from an agent's Chat tab inside this project, or link one under Settings.</Empty>
      ) : (
        <ul className="space-y-2">
          {hub.conversations.map((c) => (
            <li key={c.id} className="card">
              <Link className={`${LINK} font-semibold`} to={where.conversation(c.botId, c.id)}>
                {c.title}
              </Link>
              <p className="hint">with {c.botName} · last message {when(c.lastAt)}</p>
            </li>
          ))}
        </ul>
      );
    case "tasks":
      return hub.tasks.length === 0 ? (
        <Empty>No tasks yet. Give an agent a task and choose this project.</Empty>
      ) : (
        <ul className="space-y-2">
          {hub.tasks.map((t) => (
            <li key={t.id} className="card">
              <Link className={`${LINK} font-semibold`} to={where.task(t.id)}>
                {t.instruction}
              </Link>
              <p className="hint">
                {t.botName} · {t.status} · started {when(t.createdAt)}
              </p>
              {t.errorMessage && <p className="text-sm text-red-700 dark:text-red-300">Why it failed: {t.errorMessage}</p>}
            </li>
          ))}
        </ul>
      );
    case "agents":
      return hub.agents.length === 0 ? (
        <Empty>No agents take part yet. An agent appears here when it chats in, or works a task of, this project. Being listed gives it no extra access.</Empty>
      ) : (
        <ul className="space-y-2">
          {hub.agents.map((a) => (
            <li key={a.botId} className="card">
              <Link className={`${LINK} font-semibold`} to={where.agent(a.botId)}>
                {a.name}
              </Link>
              {a.archived && <span className="hint"> (archived)</span>}
              <p className="hint">
                {a.roles.join(", ")} · {a.tasks} tasks · {a.conversations} chats{a.lastAt ? ` · last active ${when(a.lastAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      );
    case "files":
      return (
        <div className="space-y-4">
          <section aria-label="Generated files" className="space-y-2">
            <h3 className="font-semibold">Files made by this project's tasks</h3>
            {hub.outputs.length === 0 && <Empty>No files yet. Files are only made after you approve them.</Empty>}
            <ul className="space-y-2">
              {hub.outputs.map((o) => (
                <li key={o.approvalId} className="card">
                  <Link className={LINK} to={where.approval(o.approvalId)}>
                    {o.path ?? `${o.connector}: ${o.action}`}
                  </Link>
                  <p className="hint">
                    {o.botName} · {o.status} · {when(o.at)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {hub.notes.length > 0 && (
            <section aria-label="Linked notes" className="space-y-1">
              <h3 className="font-semibold">Linked notes</h3>
              <ul className="list-disc pl-5">
                {hub.notes.map((n) => (
                  <li key={n.id}>
                    <Link className={LINK} to="/knowledge">
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ProjectWorkspace projectId={hub.project.id} />
        </div>
      );
    case "workflows":
      return hub.workflows.length === 0 ? (
        <Empty>No workflows are linked. Link one under Settings.</Empty>
      ) : (
        <ul className="space-y-2">
          {hub.workflows.map((w) => (
            <li key={w.id} className="card">
              <Link className={`${LINK} font-semibold`} to={w.lastRun ? where.workflowRun(w.lastRun.id) : "/workflows"}>
                {w.name}
              </Link>
              <p className="hint">{w.lastRun ? `Last run ${w.lastRun.status} · ${when(w.lastRun.at)}` : "Never run"}</p>
              {w.lastRun?.error && <p className="text-sm text-red-700 dark:text-red-300">Why it failed: {w.lastRun.error}</p>}
            </li>
          ))}
        </ul>
      );
    case "decisions":
      return (
        <div className="space-y-4">
          <section aria-label="Decisions" className="space-y-2">
            <h3 className="font-semibold">Decisions</h3>
            {hub.decisions.length === 0 && <Empty>No decisions filed under this project.</Empty>}
            <ul className="space-y-2">
              {hub.decisions.map((d) => (
                <li key={d.id} className="card">
                  <Link className={LINK} to={where.decision(d.id)}>
                    {d.title}
                  </Link>
                  <p className="hint">{d.status}</p>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Approvals" className="space-y-2">
            <h3 className="font-semibold">Approvals</h3>
            {hub.approvals.length === 0 && <Empty>No approval requests from this project's tasks.</Empty>}
            <ul className="space-y-2">
              {hub.approvals.map((a) => (
                <li key={a.id} className="card">
                  <Link className={LINK} to={where.approval(a.id)}>
                    {a.summary}
                  </Link>
                  <p className="hint">
                    {a.botName} · {a.status} · {when(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      );
    default:
      return null;
  }
}

/** A project as one workspace. `settings` is supplied by the caller (the existing editor), so there is only one settings screen. */
export function ProjectHub({ projectId, tab, onTab, settings }: { projectId: string; tab: HubTab; onTab: (t: HubTab) => void; settings: ReactNode }) {
  const q = useProjectHub(projectId);
  const [level] = useInterfaceLevel();
  const hub = q.data && Array.isArray(q.data.conversations) ? q.data : undefined; // a malformed answer is treated as not loaded
  const badge = (n: number) => (n > 0 ? n : undefined);
  return (
    <section aria-label="Project hub" className="space-y-4">
      <Tabs
        label="Project sections"
        value={tab}
        onChange={onTab}
        tabs={HUB_TABS.filter((id) => level !== "simple" || SIMPLE_TABS.includes(id) || id === tab).map((id) => ({
          id,
          label: LABEL[id],
          badge: !hub
            ? undefined
            : id === "conversations"
              ? badge(hub.conversations.length)
              : id === "tasks"
                ? badge(hub.tasks.length)
                : id === "agents"
                  ? badge(hub.agents.length)
                  : id === "decisions"
                    ? badge(hub.attention.filter((a) => a.kind === "approval" || a.kind === "decision").length)
                    : undefined,
        }))}
      />
      <div role="tabpanel" aria-label={LABEL[tab]} className="space-y-3">
        {tab === "settings" ? settings : q.isLoading ? <p className="hint">Loading…</p> : !hub ? <p role="alert">This project could not be loaded.</p> : tab === "overview" ? <Overview hub={hub} /> : <Panel hub={hub} tab={tab} />}
      </div>
    </section>
  );
}
