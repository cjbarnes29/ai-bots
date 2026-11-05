import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAssignRouting, useBots, useModels, useRouting, useUpdateBot, useUpdateRouting } from "../api/hooks";
import type { Bot, ModelView, RoutingConfig } from "../api/types";
import { ModelSelect } from "../components/ModelSelect";
import { ErrorNote, StepHeader, SuccessNote } from "../components/setup/SetupBits";
import { loadProgress, saveProgress } from "../lib/setupProgress";

const friendly = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work. Try again.");
const STEPS = ["Recommended setup", "Default model", "Models per task", "If a model fails", "Your bots", "Done"];
type Cls = "general" | "coding" | "research" | "light";

/** The recommended settings, in words and as values. Free models only: nothing here can select a paid model or service. */
export const RECOMMENDED: Partial<RoutingConfig> = { enabled: true, autoAssignNewBots: true, autoEnableEligible: true, maxAttempts: 3, preferLocal: false, defaultModel: null, preferred: {} };

const label = (m: ModelView) => `${m.displayName} (${m.providerName})`;

/**
 * The AI setup assistant (after the first provider is connected): recommended defaults in one click, then simple choices for a default
 * model, a first choice per kind of task, fallback and the models of existing bots. It only edits the existing routing settings and bots.
 */
export function AiSetupAssistant() {
  const routing = useRouting();
  const models = useModels();
  const update = useUpdateRouting();
  const assign = useAssignRouting();
  const [progress, setProgress] = useState(() => loadProgress("ai-setup"));
  useEffect(() => saveProgress("ai-setup", progress), [progress]);
  const last = STEPS.length - 1;
  const step = Math.min(progress.step, last);
  const go = (i: number) => setProgress((s) => ({ step: Math.max(0, Math.min(i, last)), done: i > s.step ? [...s.done, s.step] : s.done }));
  const r = routing.data;
  const usable = (models.data ?? []).filter((m) => m.callable);
  const err = friendly(update.error ?? assign.error);

  if (routing.isPending || models.isPending) return <p role="status">Loading…</p>;
  if (!r) return <p role="alert">Could not load the AI settings.</p>;

  const set = (patch: Partial<RoutingConfig>) => update.mutate(patch);
  const nav = (
    <div className="flex flex-wrap justify-between gap-2">
      <button type="button" className="btn-secondary min-h-11" disabled={step === 0} onClick={() => go(step - 1)}>
        ← Back
      </button>
      {step < last && (
        <button type="button" className="btn-primary min-h-11" onClick={() => go(step + 1)}>
          Next →
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/integrations" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
        ← Integrations Center
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Set up automatic AI</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">A few simple choices. You can accept the recommendations without knowing the details. Only free models are ever used.</p>
      </div>
      {usable.length === 0 && (
        <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          No usable model yet. <Link to="/integrations" className="underline">Connect a provider</Link> first; you can still look through these steps.
        </p>
      )}
      <StepHeader titles={STEPS} current={step} reached={last} onGo={go} />

      <section aria-labelledby="assistant-step" className="card space-y-4">
        <h2 id="assistant-step" className="text-xl font-semibold">
          {STEPS[step]}
        </h2>

        {step === 0 && (
          <>
            <p>The recommended setup lets the app pick the best free model for each task by itself, and try another one if a model fails.</p>
            <ul className="list-disc space-y-1 pl-6 text-sm">
              <li>Automatic model choice: on</li>
              <li>New bots use Automatic</li>
              <li>Newly found free models are switched on by themselves</li>
              <li>If a model fails, up to 3 models are tried</li>
              <li>Cloud models first, Ollama (on this PC) as a private backup</li>
              <li>Paid models: never (this cannot be changed)</li>
            </ul>
            <button type="button" className="btn-primary min-h-11" disabled={update.isPending} onClick={() => update.mutate(RECOMMENDED, { onSuccess: () => assign.mutate() })}>
              {update.isPending ? "Saving…" : "Use the recommended settings"}
            </button>
            {update.isSuccess && assign.isSuccess && (
              <SuccessNote>
                Recommended settings saved.{" "}
                {assign.data?.changed ? `${assign.data.changed} bot${assign.data.changed === 1 ? "" : "s"} without a model now use Automatic.` : "Every bot already had a model."} You can stop here, or press Next to adjust.
              </SuccessNote>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <p>The model a new bot starts with. Automatic is best for most people: it always uses a free model that is working.</p>
            <label className="block space-y-1">
              <span className="label">Default model for new bots</span>
              <select aria-label="Default model for new bots" value={r.config.defaultModel ?? ""} onChange={(e) => set({ defaultModel: e.target.value || null, autoAssignNewBots: true })}>
                <option value="">Automatic (recommended)</option>
                {usable.map((m) => (
                  <option key={m.ref} value={m.ref}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">New bots still start switched off with every permission off; you switch each one on yourself.</p>
          </>
        )}

        {step === 2 && (
          <>
            <p>For each kind of task, keep Automatic or choose a first choice. Your choice is tried first; the others stay behind it as backups.</p>
            {r.classes.map((c) => (
              <div key={c.id} className="space-y-1">
                <label className="block space-y-1">
                  <span className="label">{c.label}</span>
                  <select
                    aria-label={`First choice for ${c.label}`}
                    value={r.config.preferred?.[c.id as Cls] ?? ""}
                    onChange={(e) => {
                      const preferred = { ...(r.config.preferred ?? {}) };
                      if (e.target.value) preferred[c.id as Cls] = e.target.value;
                      else delete preferred[c.id as Cls];
                      set({ preferred });
                    }}
                  >
                    <option value="">Automatic: best free model</option>
                    {usable.map((m) => (
                      <option key={m.ref} value={m.ref}>
                        {label(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="hint">{r.preview[c.id].length === 0 ? "No eligible free model yet." : `Order right now: ${r.preview[c.id].slice(0, 3).map((m) => m.displayName).join(" → ")}`}</p>
              </div>
            ))}
          </>
        )}

        {step === 3 && (
          <>
            <p>When a model is down, busy or out of free requests, the app moves to the next one by itself.</p>
            <label className="block space-y-1">
              <span className="label">How many models to try for one task</span>
              <select aria-label="Models to try" value={r.config.maxAttempts} onChange={(e) => set({ maxAttempts: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1 (no fallback)" : `${n}${n === 3 ? " (recommended)" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            {r.providers.some((p) => p.id === "ollama" && p.enabled) && (
              <>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={r.config.allowedProviders.length === 0 || r.config.allowedProviders.includes("ollama")}
                    onChange={(e) => {
                      const all = r.config.allowedProviders;
                      if (e.target.checked) set({ allowedProviders: all.length === 0 ? [] : [...all, "ollama"] });
                      else set({ allowedProviders: (all.length === 0 ? r.providers.filter((p) => p.enabled).map((p) => p.id) : all).filter((x) => x !== "ollama") });
                    }}
                  />
                  <span>Use Ollama on this PC as a backup</span>
                </label>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={r.config.preferLocal} onChange={(e) => set({ preferLocal: e.target.checked })} />
                  <span>Prefer Ollama (private, but slower) over cloud models</span>
                </label>
              </>
            )}
            <p className="hint">The app never goes around a provider&apos;s limits, never switches accounts and never uses a paid model.</p>
          </>
        )}

        {step === 4 && <BotModels />}

        {step === 5 && (
          <>
            <SuccessNote>Your AI is set up. You can change any of this later in Settings → AI Models.</SuccessNote>
            <div className="flex flex-wrap gap-2">
              <Link to="/agents" className="btn-primary min-h-11">
                Go to your bots
              </Link>
              <Link to="/settings/ai-models" className="btn-secondary min-h-11">
                Open AI Models settings
              </Link>
            </div>
          </>
        )}
        <ErrorNote text={err} />
      </section>
      {nav}
    </div>
  );
}

function BotModels() {
  const bots = useBots(false);
  const models = useModels();
  const assign = useAssignRouting();
  if (bots.isPending) return <p role="status">Loading bots…</p>;
  const list = bots.data ?? [];
  return (
    <>
      <p>Choose a model for each bot. Automatic is fine for almost every bot. A bot runs only when it is switched on.</p>
      <button type="button" className="btn-secondary min-h-11" disabled={assign.isPending} onClick={() => assign.mutate()}>
        Give Automatic to every bot without a model
      </button>
      {assign.data && <SuccessNote>{assign.data.changed === 0 ? "Every bot already had a model." : `${assign.data.changed} bot${assign.data.changed === 1 ? "" : "s"} now use Automatic.`}</SuccessNote>}
      {list.length === 0 ? (
        <p className="text-sm">
          No bots yet. <Link to="/studio" className="underline">Create one in Bot Studio</Link>.
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((b) => (
            <BotRow key={b.id} bot={b} models={models.data ?? []} />
          ))}
        </ul>
      )}
    </>
  );
}

function BotRow({ bot, models }: { bot: Bot; models: ModelView[] }) {
  const update = useUpdateBot(bot.id);
  const on = bot.status === "active";
  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/bots/${bot.id}`} className="font-medium underline">
          {bot.name}
        </Link>
        <button
          type="button"
          className={on ? "btn-secondary min-h-11" : "btn-primary min-h-11"}
          disabled={update.isPending || (!on && !bot.model)}
          onClick={() => update.mutate({ status: on ? "disabled" : "active" })}
          aria-label={on ? `Switch ${bot.name} off` : `Switch ${bot.name} on`}
        >
          {on ? "Switch off" : "Switch on"}
        </button>
      </div>
      <ModelSelect id={`model-${bot.id}`} value={bot.model} models={models} disabled={update.isPending} onChange={(ref) => update.mutate({ model: ref })} />
      <p className="hint">{on ? "On: it answers and runs tasks. Its permissions are unchanged." : bot.model ? "Off: it does not run." : "Choose a model, then switch it on."}</p>
      {update.error ? <ErrorNote text={friendly(update.error)} /> : null}
    </li>
  );
}
