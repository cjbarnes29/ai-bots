import { ApiError } from "../api/client";
import { useBots, useManager, useUpdateManagerSettings } from "../api/hooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

/** Settings > Agents & Permissions > Manager: which specialist bots it may use, its budget, and its model. Owner-only on the PC. */
export function ManagerSettings() {
  const manager = useManager();
  const bots = useBots(false);
  const update = useUpdateManagerSettings();
  const s = manager.data?.settings;
  if (!s || !manager.data) return null;
  const ceilings = manager.data.ceilings;
  const allowed = new Set(s.allowedBots);
  const usable = (bots.data ?? []).filter((b) => b.runtime === "builtin" && b.model !== null);

  return (
    <section aria-label="Manager settings" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Manager</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The Manager plans a request, does simple work itself, hands a step to a specialist bot only when one clearly fits, and checks the result. Specialists are never used unless you tick them here.
        </p>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">The Manager is on</span>
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label="The Manager is on"
          disabled={update.isPending}
          onClick={() => update.mutate({ enabled: !s.enabled })}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${s.enabled ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${s.enabled ? "left-5" : "left-0.5"}`} />
        </button>
      </label>
      <fieldset className="space-y-1">
        <legend className="label">Specialist bots the Manager may use</legend>
        {usable.length === 0 && <p className="hint">No bot with a model yet.</p>}
        <div className="flex flex-wrap gap-4">
          {usable.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowed.has(b.id)} onChange={(e) => update.mutate({ allowedBots: e.target.checked ? [...allowed, b.id] : [...allowed].filter((x) => x !== b.id) })} />
              {b.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="label">Model calls per request (up to {ceilings.maxModelCalls})</span>
          <input
            aria-label="Model calls per request"
            type="number"
            min={1}
            max={ceilings.maxModelCalls}
            defaultValue={s.defaultBudget.maxModelCalls}
            onBlur={(e) => Number(e.target.value) !== s.defaultBudget.maxModelCalls && update.mutate({ defaultBudget: { ...s.defaultBudget, maxModelCalls: Number(e.target.value) } })}
            className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="text-sm">
          <span className="label">Requests per day (up to {ceilings.maxRunsPerDay})</span>
          <input
            aria-label="Requests per day"
            type="number"
            min={1}
            max={ceilings.maxRunsPerDay}
            defaultValue={s.maxRunsPerDay}
            onBlur={(e) => Number(e.target.value) !== s.maxRunsPerDay && update.mutate({ maxRunsPerDay: Number(e.target.value) })}
            className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
      </div>
      {errorText(update.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(update.error)}
        </p>
      )}
    </section>
  );
}
