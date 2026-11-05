import { ApiError } from "../../api/client";
import { useModels, usePatchModel } from "../../api/hooks";
import type { ModelView } from "../../api/types";
import { CopyValue } from "./SetupBits";

const CAP_LABEL: Record<string, string> = {
  coding: "coding",
  long_context: "long documents",
  vision: "pictures",
  tool_calling: "tools",
  structured_output: "structured output",
};

function context(m: ModelView): string | null {
  if (!m.contextWindow) return null;
  return m.contextWindow >= 1000 ? `reads about ${Math.round(m.contextWindow / 1000)}k tokens at once` : `reads ${m.contextWindow} tokens at once`;
}

function availability(m: ModelView): { text: string; ok: boolean } {
  if (m.freeStatus === "blocked") return { text: /cloud|billed/i.test(m.freeSource) ? "Runs on Ollama's servers and is billed: never used" : "Paid or not confirmed free: never used", ok: false };
  if (m.availability === "not_installed") return { text: "Not downloaded yet", ok: false };
  if (m.availability === "removed") return { text: "No longer offered by the provider", ok: false };
  if (!m.callable) return { text: m.blockedReason ?? "Not ready", ok: false };
  return { text: "Ready", ok: true };
}

/**
 * Pick the models bots may use: plain switches, no model identifiers to type. Shows the provider, whether it runs on this PC or over the
 * internet, what it is known to be good at (only confirmed "yes" facts), its context size and whether it is ready. Blocked (paid) models
 * are listed so nothing is hidden, but can never be switched on.
 */
export function ModelPicker({ providerId, local, max = 40 }: { providerId?: string; local?: boolean; max?: number }) {
  const models = useModels();
  const patch = usePatchModel();
  const list = (models.data ?? []).filter((m) => !providerId || m.providerId === providerId);
  const err = patch.error instanceof ApiError ? patch.error.friendly : patch.error ? "That did not work." : null;
  if (models.isPending) return <p role="status">Loading models…</p>;
  if (list.length === 0) return <p className="text-sm">No models found yet.</p>;
  const sorted = [...list].sort((a, b) => Number(availability(b).ok) - Number(availability(a).ok) || a.displayName.localeCompare(b.displayName));

  return (
    <div className="space-y-2">
      <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1" aria-label="Models">
        {sorted.slice(0, max).map((m) => {
          const a = availability(m);
          const caps = Object.entries(m.capabilities)
            .filter(([k, v]) => v === "yes" && CAP_LABEL[k])
            .map(([k]) => CAP_LABEL[k]);
          const canToggle = m.freeStatus !== "blocked";
          return (
            <li key={m.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={m.enabled && canToggle}
                  disabled={!canToggle || patch.isPending}
                  onChange={() => patch.mutate({ id: m.id, enabled: !m.enabled })}
                  aria-label={`Use ${m.displayName}`}
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block font-medium [overflow-wrap:anywhere]">{m.displayName}</span>
                  <span className="flex flex-wrap gap-1 text-xs">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{m.providerName}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{(local ?? m.providerId === "ollama") ? "On this PC" : "Over the internet"}</span>
                    <span className={`rounded px-1.5 py-0.5 ${a.ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>{a.text}</span>
                    {caps.map((c) => (
                      <span key={c} className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                        good at {c}
                      </span>
                    ))}
                  </span>
                  {context(m) && <span className="hint block">{context(m)}</span>}
                </span>
              </label>
              {m.availability === "not_installed" && m.providerId === "ollama" && <CopyValue label="Download it with" value={`ollama pull ${m.modelId}`} />}
            </li>
          );
        })}
      </ul>
      {list.length > max && <p className="hint">Showing {max} of {list.length}. The full list is in Settings → AI Models.</p>}
      {err && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {err}
        </p>
      )}
    </div>
  );
}
