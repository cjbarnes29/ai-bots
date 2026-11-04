import { ApiError } from "../api/client";
import { useAssignRouting, useRefreshAllProviders, useRouting, useUpdateRouting } from "../api/hooks";
import type { RoutingConfig } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function Toggle({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${checked ? "left-5" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** Settings > AI Models > Model routing. One configuration for every bot set to "Automatic". Free models only; nothing here can allow a paid model. */
export function RoutingSection() {
  const routing = useRouting();
  const update = useUpdateRouting();
  const refreshAll = useRefreshAllProviders();
  const assign = useAssignRouting();
  const r = routing.data;
  if (routing.isError) return <p role="alert">Could not load model routing.</p>;
  if (!r) return <section aria-label="Model routing" className="card"><p role="status">Loading model routing…</p></section>;

  const set = (patch: Partial<RoutingConfig>) => update.mutate(patch);
  const cloud = r.providers.filter((p) => p.kind === "cloud");
  const allowed = new Set(r.config.allowedProviders);

  return (
    <section aria-label="Model routing" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Model routing (automatic models)</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A bot set to <strong>Automatic</strong> does not have one fixed model. For each task the platform picks the best <strong>free</strong> model for that kind of work, and moves to the next one if a provider is
          down, rate-limited or out of quota. It never uses a paid model, never goes around a limit, and never switches accounts. A bot with a specific model always keeps it.
        </p>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        <Toggle label="Automatic routing is on" checked={r.config.enabled} onChange={(v) => set({ enabled: v })} disabled={update.isPending} />
        <Toggle label="New bots without a model use automatic routing" checked={r.config.autoAssignNewBots} onChange={(v) => set({ autoAssignNewBots: v })} disabled={update.isPending} />
        <Toggle label="Switch on newly discovered free models by themselves" checked={r.config.autoEnableEligible} onChange={(v) => set({ autoEnableEligible: v })} disabled={update.isPending} />
        <Toggle label="Prefer local Ollama models (otherwise they are only a backup)" checked={r.config.preferLocal} onChange={(v) => set({ preferLocal: v })} disabled={update.isPending} />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="label">Models to try per task</span>
          <select aria-label="Models to try per task" value={r.config.maxAttempts} onChange={(e) => set({ maxAttempts: Number(e.target.value) })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Look for new models</span>
          <select aria-label="Look for new models" value={r.config.autoRefreshHours} onChange={(e) => set({ autoRefreshHours: Number(e.target.value) })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            <option value={0}>Only when I press the button</option>
            <option value={6}>Every 6 hours</option>
            <option value={24}>Every day</option>
            <option value={168}>Every week</option>
          </select>
        </label>
      </div>

      <fieldset className="space-y-1">
        <legend className="label">Providers routing may use (none ticked = all that are switched on)</legend>
        <div className="flex flex-wrap gap-4">
          {cloud.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowed.has(p.id)}
                onChange={(e) => set({ allowedProviders: e.target.checked ? [...allowed, p.id] : [...allowed].filter((x) => x !== p.id) })}
              />
              {p.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={refreshAll.isPending} onClick={() => refreshAll.mutate()}>
          {refreshAll.isPending ? "Looking for models…" : "Look for new models now"}
        </button>
        <button className="btn-secondary" disabled={assign.isPending} onClick={() => assign.mutate()}>
          Use automatic routing for bots that have no model
        </button>
      </div>
      {assign.data && <p role="status" className="text-sm">{assign.data.changed === 0 ? "No bot needed changing." : `${assign.data.changed} bot${assign.data.changed === 1 ? "" : "s"} now use automatic routing.`}</p>}
      {refreshAll.data && (
        <ul className="text-sm">
          {refreshAll.data.results.map((x) => (
            <li key={x.id}>
              <strong>{x.id}:</strong> {x.ok ? `${x.models} models` : `failed (${x.message})`}
            </li>
          ))}
          {refreshAll.data.results.length === 0 && <li>No provider is switched on with a key yet.</li>}
        </ul>
      )}
      {errorText(update.error ?? refreshAll.error ?? assign.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(update.error ?? refreshAll.error ?? assign.error)}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold">Provider health</h3>
        <ul className="grid gap-2 md:grid-cols-2">
          {r.providers.map((p) => (
            <li key={p.id} aria-label={`Health of ${p.displayName}`} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-800">
              <p className="font-medium">
                {p.displayName} · {!p.enabled ? "switched off" : p.pausedForSeconds > 0 ? `cooling down (${p.pausedForSeconds}s)` : p.kind === "cloud" && !p.keyConfigured ? "no key" : "ready"}
              </p>
              <p className="hint">
                {p.usableModels} usable model{p.usableModels === 1 ? "" : "s"} of {p.modelCount} · {p.requestsToday}
                {p.dailyRequestCap !== null ? ` of ${p.dailyRequestCap}` : ""} requests today
                {p.status ? ` · last check: ${p.status}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">What would be chosen right now</h3>
        <ul className="space-y-1 text-sm">
          {r.classes.map((c) => (
            <li key={c.id}>
              <strong>{c.label}:</strong>{" "}
              {r.preview[c.id].length === 0 ? <span className="hint">no eligible free model yet</span> : r.preview[c.id].slice(0, 3).map((m) => m.ref).join(" → ")}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
