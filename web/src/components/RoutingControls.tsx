import { useModels, useUpdateRouting } from "../api/hooks";
import type { ModelView, RoutingView } from "../api/types";

const KINDS: { id: "general" | "coding" | "research" | "light"; label: string }[] = [
  { id: "general", label: "General tasks" },
  { id: "coding", label: "Coding" },
  { id: "research", label: "Research and reasoning" },
  { id: "light", label: "Quick, lightweight tasks" },
];

function stateOf(m: ModelView, restingSeconds = 0): string {
  if (m.callable && restingSeconds > 0) return `Resting after a rate limit, back in about ${restingSeconds < 90 ? `${restingSeconds} seconds` : `${Math.ceil(restingSeconds / 60)} minutes`}`;
  if (m.callable) return "Ready";
  if (m.blockedReason) return `Not usable: ${m.blockedReason}`;
  if (!m.enabled) return "Switched off";
  return "Not usable";
}

/** The practical routing controls: backup order, a first choice per kind of task, the default for new agents, and which models are actually usable. */
export function RoutingControls({ r }: { r: RoutingView }) {
  const models = useModels();
  const update = useUpdateRouting();
  const all = models.data ?? [];
  const usable = all.filter((m) => m.callable);
  const simulatedProviders = new Set(r.providers.filter((p) => p.simulated).map((p) => p.id));
  const label = (m: ModelView) => `${m.ref}${simulatedProviders.has(m.providerId) ? " (simulated)" : ""}`;

  const nameOf = (id: string) => r.providers.find((p) => p.id === id)?.displayName ?? id;
  // The saved order may not mention a provider added later; show everything, saved order first.
  const order = [...r.config.providerOrder.filter((id) => r.providers.some((p) => p.id === id)), ...r.providers.map((p) => p.id).filter((id) => !r.config.providerOrder.includes(id))];
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    update.mutate({ providerOrder: next });
  };
  const setFirst = (kind: (typeof KINDS)[number]["id"], ref: string) => {
    const preferred = { ...r.config.preferred };
    if (ref) preferred[kind] = ref;
    else delete preferred[kind];
    update.mutate({ preferred });
  };
  const excluded = new Set(r.config.excludedModels);
  const resting = new Map((r.cooldowns ?? []).map((c) => [c.ref, c.secondsLeft]));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="font-semibold">Which provider comes first (and the backups)</h3>
        <p className="hint">
          The first provider is your preferred one and the rest are backups, in order. This order decides between models that suit a task equally well. To force one particular model for a kind of task, set a first choice below.
        </p>
        <ol className="space-y-1" aria-label="Provider order">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 font-medium">{i === 0 ? "Preferred" : `Backup ${i}`}</span>
              <span className="flex-1">
                {nameOf(id)}
                {simulatedProviders.has(id) ? " (simulated: used only if ticked above)" : ""}
              </span>
              <button className="btn-secondary" aria-label={`Move ${nameOf(id)} up`} disabled={i === 0 || update.isPending} onClick={() => move(i, -1)}>
                Up
              </button>
              <button className="btn-secondary" aria-label={`Move ${nameOf(id)} down`} disabled={i === order.length - 1 || update.isPending} onClick={() => move(i, 1)}>
                Down
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Your first choice for each kind of task</h3>
        <p className="hint">Tried first while it is usable. If it fails or is switched off, routing falls back to the best other free model, up to the number of attempts above. Leave on "Automatic" to let the platform pick.</p>
        <div className="grid gap-2 md:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.id} className="text-sm">
              <span className="label">{k.label}</span>
              <select aria-label={`First choice for ${k.label}`} value={r.config.preferred[k.id] ?? ""} onChange={(e) => setFirst(k.id, e.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
                <option value="">Automatic</option>
                {usable.map((m) => (
                  <option key={m.ref} value={m.ref}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {usable.length === 0 && <p className="hint">No model is usable yet, so there is nothing to choose. Connect a provider, or set up the demo.</p>}
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold">Model for new agents</h3>
        <label className="text-sm">
          <span className="sr-only">Model for new agents</span>
          <select aria-label="Model for new agents" value={r.config.defaultModel ?? ""} onChange={(e) => update.mutate({ defaultModel: e.target.value || null })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            <option value="">Automatic (general tasks)</option>
            {usable.map((m) => (
              <option key={m.ref} value={m.ref}>
                {label(m)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Automatic = the agent follows these routing rules. A specific model = it always uses that model, with no fallback. You can change this for any agent on its Details tab.</p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Model availability</h3>
        {all.length === 0 ? (
          <p className="hint">No models listed yet. Connect a provider and fetch its models.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800" aria-label="Model availability">
            {all.map((m) => (
              <li key={m.ref} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-48 flex-1 [overflow-wrap:anywhere]">
                  {label(m)}
                </span>
                <span className={m.callable && !resting.get(m.ref) ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-slate-600 dark:text-slate-400"}>{stateOf(m, resting.get(m.ref) ?? 0)}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" aria-label={`Never choose ${m.ref} automatically`} checked={excluded.has(m.ref)} onChange={(e) => update.mutate({ excludedModels: e.target.checked ? [...excluded, m.ref] : [...excluded].filter((x) => x !== m.ref) })} />
                  never automatically
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
        <h3 className="font-semibold">What happens when a model fails</h3>
        <ul className="list-disc pl-5">
          <li>Wrong key, rate limit, quota used up, timeout, network error or provider outage: that whole provider is skipped for this task and the next one is tried.</li>
          <li>Model not found or unavailable: only that model is skipped.</li>
          <li>Your own limits, the pause switch, a too-large request or a blocked request: routing stops. Another model would not change the answer, and limits are never bypassed.</li>
          <li>At most {r.config.maxAttempts} attempt{r.config.maxAttempts === 1 ? "" : "s"} per task, then a clear error that lists what was tried. A paid model is never an option.</li>
        </ul>
        <h3 className="pt-2 font-semibold">Simulated or real?</h3>
        <ul className="list-disc pl-5">
          <li>
            <strong>Works with the simulated Demo AI:</strong> every setting on this page (order, first choices, attempts, availability) and the fallback behaviour, for example the "always fails" demo model.
          </li>
          <li>
            <strong>Needs real API access:</strong> whether Gemini, Groq or OpenRouter actually answer, their real limits and quotas, and how good the automatic ranking is for real model names. None of that has been tested against a real provider yet.
          </li>
        </ul>
      </div>
    </div>
  );
}
