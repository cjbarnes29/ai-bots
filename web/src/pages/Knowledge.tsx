import { useState, type ChangeEvent } from "react";
import { AgentsTabs } from "../components/SectionTabs";
import { ApiError } from "../api/client";
import { useBots, useCreateNote, useMemoryNotes, useNoteAction, useUpdateNote } from "../api/hooks";
import type { MemoryNote } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const MAX_FILE_CHARS = 4000;

/** Notes and knowledge. Shared notes are project knowledge; private notes belong to one bot. Secrets are refused by the backend. */
export function Knowledge() {
  const bots = useBots(false);
  const [scope, setScope] = useState<"shared" | "bot">("shared");
  const [botId, setBotId] = useState("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const notes = useMemoryNotes(scope, botId, archived, q);
  const create = useCreateNote();
  const update = useUpdateNote();
  const action = useNoteAction();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "" });
  const error = errorText(create.error ?? update.error ?? action.error);
  const canAdd = title.trim() && content.trim() && (scope === "shared" || botId);

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 100));
    setContent(text.slice(0, MAX_FILE_CHARS));
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <AgentsTabs />
      <h1 className="text-2xl font-bold">Knowledge</h1>
      <p className="hint">
        Notes your bots can use. Shared notes are for every bot you allow; private notes belong to one bot. Passwords, keys and tokens are never stored. Turn memory on or off per bot on its Permissions tab.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="label">Show</span>
          <select aria-label="Which notes" value={scope} onChange={(e) => setScope(e.target.value as "shared" | "bot")}>
            <option value="shared">Shared knowledge</option>
            <option value="bot">One bot's private notes</option>
          </select>
        </label>
        {scope === "bot" && (
          <label className="text-sm">
            <span className="label">Bot</span>
            <select aria-label="Bot" value={botId} onChange={(e) => setBotId(e.target.value)}>
              <option value="">Choose a bot…</option>
              {(bots.data ?? [])
                .filter((b) => !b.archived)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="min-w-48 flex-1 text-sm">
          <span className="label">Search</span>
          <input aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} className="w-full" />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section aria-label="Add a note" className="card space-y-2">
        <h2 className="font-semibold">Add a note {scope === "shared" ? "to the shared knowledge" : "for this bot"}</h2>
        <input aria-label="Note title" placeholder="Title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
        <textarea aria-label="Note text" placeholder="Text" rows={4} maxLength={MAX_FILE_CHARS} value={content} onChange={(e) => setContent(e.target.value)} className="w-full" />
        <input aria-label="Tags" placeholder="Tags, separated by commas (optional)" value={tags} onChange={(e) => setTags(e.target.value)} className="w-full" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin (add to the bot's instructions)
          </label>
          <label className="text-sm">
            <span className="label">Or load a text file</span>
            <input aria-label="Load a text file" type="file" accept=".txt,.md,.csv,text/*" onChange={readFile} />
          </label>
          <button
            className="btn-primary"
            disabled={!canAdd || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  scope,
                  ...(scope === "bot" ? { botId } : {}),
                  title: title.trim(),
                  content: content.trim(),
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  pinned,
                },
                {
                  onSuccess: () => {
                    setTitle("");
                    setContent("");
                    setTags("");
                    setPinned(false);
                  },
                },
              )
            }
          >
            Save note
          </button>
        </div>
      </section>

      {notes.data?.length === 0 && <p className="hint">No notes here.</p>}
      <ul className="space-y-2">
        {notes.data?.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            editing={editing === n.id}
            draft={draft}
            setDraft={setDraft}
            onEdit={() => {
              setEditing(n.id);
              setDraft({ title: n.title, content: n.content });
            }}
            onSave={() => update.mutate({ id: n.id, patch: draft }, { onSuccess: () => setEditing(null) })}
            onCancel={() => setEditing(null)}
            onPin={() => update.mutate({ id: n.id, patch: { pinned: !n.pinned } })}
            onAction={(a) => action.mutate({ id: n.id, action: a })}
          />
        ))}
      </ul>
    </div>
  );
}

interface RowProps {
  note: MemoryNote;
  editing: boolean;
  draft: { title: string; content: string };
  setDraft: (d: { title: string; content: string }) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onPin: () => void;
  onAction: (a: "archive" | "unarchive" | "share") => void;
}

function NoteRow(p: RowProps) {
  const n = p.note;
  return (
    <li className="card space-y-1" aria-label={`Note ${n.title}`}>
      {p.editing ? (
        <>
          <input aria-label="Edit title" value={p.draft.title} onChange={(e) => p.setDraft({ ...p.draft, title: e.target.value })} className="w-full" />
          <textarea aria-label="Edit text" rows={4} value={p.draft.content} onChange={(e) => p.setDraft({ ...p.draft, content: e.target.value })} className="w-full" />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={p.onSave}>
              Save changes
            </button>
            <button className="btn-secondary" onClick={p.onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{n.title}</strong>
            {n.pinned && <span className="hint">pinned</span>}
            <span className="hint">{n.source === "bot" ? "saved by the bot (approved)" : n.source === "import" ? "imported" : "written by you"}</span>
            {n.tags.map((t) => (
              <span key={t} className="hint">
                #{t}
              </span>
            ))}
          </div>
          <p className="whitespace-pre-wrap text-sm">{n.content}</p>
          <div className="flex flex-wrap gap-2">
            {!n.archived && (
              <>
                <button className="btn-secondary" aria-label={`Edit ${n.title}`} onClick={p.onEdit}>
                  Edit
                </button>
                <button className="btn-secondary" aria-label={`${n.pinned ? "Unpin" : "Pin"} ${n.title}`} onClick={p.onPin}>
                  {n.pinned ? "Unpin" : "Pin"}
                </button>
                {n.scope === "bot" && (
                  <button className="btn-secondary" aria-label={`Share ${n.title}`} onClick={() => p.onAction("share")}>
                    Copy to shared knowledge
                  </button>
                )}
              </>
            )}
            <button className="btn-secondary" aria-label={`${n.archived ? "Restore" : "Archive"} ${n.title}`} onClick={() => p.onAction(n.archived ? "unarchive" : "archive")}>
              {n.archived ? "Restore" : "Archive"}
            </button>
          </div>
        </>
      )}
    </li>
  );
}
