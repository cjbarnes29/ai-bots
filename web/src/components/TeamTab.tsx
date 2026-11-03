import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useBots, useSetTeam, useTeam } from "../api/hooks";
import type { Bot } from "../api/types";

export function TeamTab({ bot }: { bot: Bot }) {
  const team = useTeam(bot.id);
  const bots = useBots(false);
  const save = useSetTeam(bot.id);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [savedNote, setSavedNote] = useState(false);

  const current = (team.data?.targets ?? []).map((t) => t.id);
  const currentKey = [...current].sort().join(",");
  useEffect(() => setChosen(new Set(current)), [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = (bots.data ?? []).filter((b) => b.id !== bot.id);
  const dirty = [...chosen].sort().join(",") !== currentKey;
  const names = candidates.map((c) => c.name.trim().toLowerCase());
  const error = save.error instanceof ApiError ? save.error.friendly : save.error ? "Could not save the team." : null;

  const toggle = (id: string) => {
    setSavedNote(false);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div role="tabpanel" aria-label="Team" className="space-y-5">
      <div className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
        <p>
          <strong>Nobody, by default.</strong> {bot.name} can only hand a task to a teammate you tick below. Handing over work is
          text only: the teammate answers with text, and nothing outside the platform is touched. Chains are limited in depth, size and
          model calls (see Settings), and every step is logged on the Tasks page.
        </p>
      </div>

      {bot.archived && <p className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">This bot is archived. Unarchive it to change its team.</p>}
      {(team.isPending || bots.isPending) && <p role="status">Loading…</p>}
      {candidates.length === 0 && bots.data && (
        <p className="card text-sm text-slate-600 dark:text-slate-400">There are no other bots yet. Create another bot to build a team.</p>
      )}

      <ul className="space-y-2">
        {candidates.map((c) => {
          const duplicate = names.filter((n) => n === c.name.trim().toLowerCase()).length > 1;
          return (
            <li key={c.id} className="card">
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={chosen.has(c.id)} disabled={bot.archived || save.isPending} onChange={() => toggle(c.id)} />
                <span className="space-y-1">
                  <span className="block font-medium">Allow {c.name}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-400">{c.role || "No role yet"}</span>
                  {!c.model && <span className="block text-xs text-amber-700 dark:text-amber-400">Has no model yet, so it cannot take tasks.</span>}
                  {c.runtime === "openclaw" && <span className="block text-xs text-amber-700 dark:text-amber-400">Uses OpenClaw, which is not installed.</span>}
                  {duplicate && <span className="block text-xs text-amber-700 dark:text-amber-400">Another bot has the same name. Rename one so requests are unambiguous.</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || save.isPending || bot.archived}
          onClick={() => save.mutate([...chosen], { onSuccess: () => setSavedNote(true) })}
        >
          {save.isPending ? "Saving…" : "Save team"}
        </button>
        {dirty && <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>}
        {!dirty && savedNote && (
          <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            Team saved.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <section aria-label="Team change log">
        <h3 className="mb-2 font-semibold">Change log</h3>
        {(team.data?.audit ?? []).length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No changes yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {team.data!.audit.map((a) => (
              <li key={a.id}>
                {a.targetName} {a.action === "allowed" ? "was allowed" : "was removed"}
                <span className="text-slate-500"> · {new Date(a.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
