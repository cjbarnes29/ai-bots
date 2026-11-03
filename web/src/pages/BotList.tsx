import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBots, useCreateBot } from "../api/hooks";
import { CONNECTOR_LABELS, type Bot } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";

function accessSummary(bot: Bot): string {
  const on = bot.permissions.filter((p) => p.readEnabled).map((p) => CONNECTOR_LABELS[p.connector]);
  return on.length === 0 ? "No external access" : `Can read: ${on.join(", ")}`;
}

function NewBotForm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateBot();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}) },
      { onSuccess: (bot) => navigate(`/bots/${bot.id}`) },
    );
  };
  const error = create.error instanceof ApiError ? create.error.friendly : create.error ? "Could not create the bot." : null;

  return (
    <form onSubmit={submit} className="card space-y-4" aria-label="New bot">
      <h2 className="text-lg font-semibold">New bot</h2>
      <div>
        <label htmlFor="new-name" className="label">
          Name
        </label>
        <input id="new-name" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="new-role" className="label">
          Role (optional)
        </label>
        <input id="new-role" value={role} maxLength={200} placeholder="e.g. Email triage assistant" onChange={(e) => setRole(e.target.value)} />
      </div>
      <p className="hint">New bots start Disabled with all external access off. You can fill in the rest on the next screen.</p>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Creating…" : "Create bot"}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BotList() {
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const bots = useBots(showArchived);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Bots</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {!creating && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              New bot
            </button>
          )}
        </div>
      </div>

      {creating && <NewBotForm onClose={() => setCreating(false)} />}

      {bots.isPending && <p role="status">Loading bots…</p>}

      {bots.isError && (
        <div role="alert" className="card space-y-3">
          <p>{bots.error instanceof ApiError ? bots.error.friendly : "Could not load bots."}</p>
          <button type="button" className="btn-secondary" onClick={() => bots.refetch()}>
            Try again
          </button>
        </div>
      )}

      {bots.data && bots.data.length === 0 && !creating && (
        <div className="card space-y-3 text-center">
          <h2 className="text-lg font-semibold">Create your first bot</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Bots are your AI workers. Give each one a name, a role and instructions.
          </p>
          <div>
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              New bot
            </button>
          </div>
        </div>
      )}

      {bots.data && bots.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.data.map((bot) => (
            <li key={bot.id}>
              <Link to={`/bots/${bot.id}`} className="card block h-full transition-colors hover:border-indigo-400">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{bot.name}</h2>
                  <StatusBadge status={bot.status} archived={bot.archived} />
                </div>
                <p className="mt-1 min-h-5 text-sm text-slate-600 dark:text-slate-400">{bot.role || "No role yet"}</p>
                <p className="mt-3 text-xs text-slate-500">
                  {accessSummary(bot)} · Version {bot.currentVersion}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
