import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useInbox, useInboxAction, useInboxPrefs, useInboxThread, useSetInboxPrefs, type InboxAction, type InboxItem, type InboxView } from "../api/workHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const when = (iso: string) => new Date(iso).toLocaleString();
const VIEWS: { id: InboxView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "pinned", label: "Pinned" },
  { id: "archived", label: "Archived" },
];
const KIND_TEXT: Record<string, string> = {
  task_result: "Task result",
  task_failed: "Task failed",
  approval_needed: "Needs your approval",
  automation_failed: "Schedule or workflow failed",
  clarification: "Question for you",
  report: "Report",
  note: "Note",
};

function Thread({ id }: { id: string }) {
  const thread = useInboxThread(id);
  const act = useInboxAction();
  if (thread.isLoading) return <p className="hint">Loading…</p>;
  if (thread.error || !thread.data) return <p role="alert" className="text-red-700 dark:text-red-300">{errorText(thread.error) ?? "Could not load this conversation."}</p>;
  return (
    <section className="card space-y-3" aria-label={`Conversation ${thread.data.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{thread.data.title}</h2>
        <Link to={`/bots/${thread.data.botId}`} className="btn-secondary">
          Open the agent
        </Link>
      </div>
      <p className="hint">Messages from agents are written by the platform from real events. Nothing here can send anything outside.</p>
      <ul className="space-y-2">
        {thread.data.messages.map((m) => (
          <li key={m.id} className={`rounded-md p-3 text-sm ${m.sender === "owner" ? "bg-sky-50 dark:bg-sky-950" : "bg-slate-100 dark:bg-slate-800"}`}>
            <p className="hint">
              {m.sender === "owner" ? "You" : "Agent"}
              {m.kind ? ` · ${KIND_TEXT[m.kind] ?? m.kind}` : ""}
              {m.importance === "important" ? " · important" : ""} · {when(m.createdAt)}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
            {m.source && (
              <p className="hint">
                From {m.source.kind}
                {m.source.kind === "task" && (
                  <>
                    {" · "}
                    <Link to={`/tasks/${m.source.id}`} className="underline">
                      open the task
                    </Link>
                  </>
                )}
                {m.source.kind === "approval" && (
                  <>
                    {" · "}
                    <Link to="/approvals" className="underline">
                      open Approvals
                    </Link>
                  </>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ id, action: "read" })}>
        Mark as read
      </button>
    </section>
  );
}

function Row({ item, selected, onSelect }: { item: InboxItem; selected: boolean; onSelect: () => void }) {
  const act = useInboxAction();
  const run = (action: InboxAction, on?: boolean) => act.mutate({ id: item.conversationId, action, ...(on !== undefined ? { on } : {}) });
  return (
    <li className={`card space-y-2 ${selected ? "ring-2 ring-sky-500" : ""}`} aria-label={`Conversation ${item.title}`}>
      <button className="w-full text-left" onClick={onSelect} aria-label={`Open ${item.title}`}>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            {item.pinned ? "📌 " : ""}
            {item.title}
            {item.muted ? " (muted)" : ""}
          </span>
          {item.unread > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{item.unread} unread</span>}
        </span>
        <span className="hint block">
          {item.botName} · {when(item.lastActivityAt)}
        </span>
        {item.lastMessage && <span className="block truncate text-sm">{item.lastMessage.preview}</span>}
      </button>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`} onClick={() => run("pin", !item.pinned)}>
          {item.pinned ? "Unpin" : "Pin"}
        </button>
        <button className="btn-secondary" aria-label={`${item.muted ? "Unmute" : "Mute"} ${item.title}`} onClick={() => run("mute", !item.muted)}>
          {item.muted ? "Unmute" : "Mute"}
        </button>
        <button className="btn-secondary" aria-label={`${item.archived ? "Unarchive" : "Archive"} ${item.title}`} onClick={() => run("archive", !item.archived)}>
          {item.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
    </li>
  );
}

function Preferences() {
  const prefs = useInboxPrefs();
  const set = useSetInboxPrefs();
  if (!prefs.data) return null;
  return (
    <section className="card space-y-2" aria-label="Notification settings">
      <h2 className="font-semibold">When should an agent's message notify you?</h2>
      <label className="block text-sm">
        Notify me about
        <select className="input ml-2" aria-label="Notify me about" value={prefs.data.notify} onChange={(e) => set.mutate({ notify: e.target.value as "all" | "important" | "none" })}>
          <option value="all">every message</option>
          <option value="important">only important messages</option>
          <option value="none">nothing (messages still arrive here)</option>
        </select>
      </label>
      <p className="hint">At most {prefs.data.maxPerHour} messages per agent per hour are delivered; extra ones are held back and counted, never lost silently.</p>
      {set.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(set.error)}</p>}
    </section>
  );
}

export function Inbox() {
  const [view, setView] = useState<InboxView>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useInbox(view, q);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="hint">Messages your agents sent you because something really happened (a result, a failure, a request waiting for approval).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Inbox views">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "btn-primary" : "btn-secondary"} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
            {v.id === "unread" && list.data && list.data.unreadTotal > 0 ? ` (${list.data.unreadTotal})` : ""}
          </button>
        ))}
        <input className="input" aria-label="Search the inbox" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.data && list.data.heldBack > 0 && <p className="hint">{list.data.heldBack} message(s) were held back by the rate limit and not delivered.</p>}
      {list.error && <p role="alert" className="text-red-700 dark:text-red-300">{errorText(list.error)}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <ul className="min-w-0 space-y-2">
          {list.isLoading && <li className="hint">Loading…</li>}
          {list.data?.items.length === 0 && <li className="hint">Nothing here.</li>}
          {list.data?.items.map((i) => (
            <Row key={i.conversationId} item={i} selected={selected === i.conversationId} onSelect={() => setSelected(i.conversationId)} />
          ))}
        </ul>
        <div className="min-w-0">{selected ? <Thread id={selected} /> : <p className="hint">Choose a conversation to read it.</p>}</div>
      </div>
      <Preferences />
    </div>
  );
}
