import { useState } from "react";
import { ApiError } from "../api/client";
import { useApplyRecommendations, useRecommendations, useRestoreRecommendation, useSetRecMode } from "../api/hooks";
import type { RecApplyResult, RecItem, RecMode } from "../api/types";
import { RecommendationCard } from "./RecommendationCard";

const MODES: { id: RecMode; label: string; text: string }[] = [
  { id: "beginner", label: "Beginner", text: "Plain explanations and only the choices that matter most." },
  { id: "intermediate", label: "Intermediate", text: "Adds benefits, trade-offs and more control." },
  { id: "advanced", label: "Advanced", text: "Everything, including what was checked and technical settings." },
];

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

/** Beginner / Intermediate / Advanced. Choosing one changes only what is shown. It never changes a saved setting. */
export function ModeSwitcher() {
  const rec = useRecommendations();
  const setMode = useSetRecMode();
  const mode = rec.data?.mode ?? "intermediate";
  return (
    <fieldset className="space-y-1" disabled={setMode.isPending}>
      <legend className="label">How much do you want to see?</legend>
      <div className="grid gap-2 md:grid-cols-3">
        {MODES.map((m) => (
          <label key={m.id} className={`cursor-pointer rounded-md border p-2 text-sm ${mode === m.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-slate-200 dark:border-slate-800"}`}>
            <input type="radio" name="rec-mode" className="mr-2" checked={mode === m.id} onChange={() => setMode.mutate(m.id)} aria-label={m.label} />
            <span className="font-medium">{m.label}</span>
            <span className="hint block">{m.text}</span>
          </label>
        ))}
      </div>
      <p className="hint">Switching never changes or loses any setting you have saved.</p>
    </fieldset>
  );
}

/** The recommended-settings assistant: looks at this PC and what is connected, explains, compares, and applies only what you choose. */
export function RecommendedSettings() {
  const rec = useRecommendations();
  const apply = useApplyRecommendations();
  const restore = useRestoreRecommendation();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<RecApplyResult[] | null>(null);
  const view = rec.data;
  if (rec.isError) return <p role="alert">Could not load the recommendations.</p>;
  if (!view) return <p role="status">Checking your settings…</p>;

  const applicable = view.items.filter((i) => i.canApply);
  const groups = [...new Set(view.items.map((i) => i.area))];
  const count = (s: RecItem["status"]) => view.items.filter((i) => i.status === s).length;
  const busy = apply.isPending || restore.isPending;
  const run = (ids: string[]) =>
    apply.mutate(ids, {
      onSuccess: (v) => {
        setReport(v.results ?? []);
        setPicked(new Set());
      },
    });
  const env = view.environment;
  const err = errorText(apply.error ?? restore.error);

  return (
    <section aria-label="Recommended settings" className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recommended settings</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This looks at this PC, the AI providers and models that really work right now, and your saved settings, and suggests what to change. <strong>Nothing changes until you press Apply.</strong> It only suggests free options and never buys or switches on anything that costs money.
          </p>
        </div>
        <ModeSwitcher />
        <p className="hint" aria-label="What was checked">
          Checked: this PC has {String(env["ramGb"] ?? "?")} GB memory and {String(env["cores"] ?? "?")} cores · {String(env["realProvidersConnected"] ?? 0)} real AI provider(s) tested and connected · Guardian {env["guardian"] ? "set up" : "not set up"}.
          {view.hidden > 0 ? ` ${view.hidden} more recommendation${view.hidden === 1 ? " is" : "s are"} shown in a higher mode.` : ""}
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-3 text-sm" aria-label="Summary">
        <span>
          <strong>{applicable.length}</strong> can be applied
        </span>
        <span>
          <strong>{count("requires_attention")}</strong> need attention
        </span>
        <span>
          <strong>{count("requires_connection")}</strong> need a connection first
        </span>
        <span className="flex-1" />
        <button type="button" className="btn-secondary" disabled={busy || applicable.length === 0} onClick={() => setPicked(new Set(applicable.map((i) => i.id)))}>
          Select all that can be applied
        </button>
        <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={() => run([...picked])}>
          Apply selected ({picked.size})
        </button>
      </div>

      {err && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {err}
        </p>
      )}

      {report && (
        <div role="status" aria-label="What was changed" className="card space-y-1 text-sm">
          <h3 className="font-semibold">What was changed</h3>
          <ul className="list-disc pl-5">
            {report.map((r) => (
              <li key={r.id}>
                <strong>{r.title}:</strong>{" "}
                {r.result === "applied" ? `changed from ${r.before} to ${r.after}` : r.result === "unchanged" ? "already as recommended, not changed" : `not changed (${r.reason})`}
              </li>
            ))}
          </ul>
          <p className="hint">Every change can be undone with Restore previous. Nothing else was touched.</p>
        </div>
      )}

      {groups.map((area) => (
        <section key={area} aria-label={area} className="space-y-2">
          <h3 className="font-semibold">{area}</h3>
          <ul className="space-y-2">
            {view.items
              .filter((i) => i.area === area)
              .map((item) => (
                <RecommendationCard
                  key={item.id}
                  item={item}
                  mode={view.mode}
                  busy={busy}
                  selected={picked.has(item.id)}
                  onSelect={(on) => setPicked((p) => new Set(on ? [...p, item.id] : [...p].filter((x) => x !== item.id)))}
                  onApply={() => run([item.id])}
                  onRestore={(id) => restore.mutate(id, { onSuccess: (v) => setReport(v.results ?? []) })}
                />
              ))}
          </ul>
        </section>
      ))}

      <section aria-label="Changes made by recommendations" className="card space-y-2">
        <h3 className="font-semibold">Changes made by recommendations</h3>
        {view.history.length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {view.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <span className="hint">{new Date(h.at).toLocaleString()}</span>
                <span className="flex-1">
                  <strong>{h.title}</strong>: {h.beforeText} → {h.afterText}
                  {h.restoredAt ? " (restored)" : ""}
                </span>
                {!h.restoredAt && (
                  <button type="button" className="btn-secondary" disabled={busy} aria-label={`Restore ${h.title} to ${h.beforeText}`} onClick={() => restore.mutate(h.id, { onSuccess: (v) => setReport(v.results ?? []) })}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">A change is only restored if the setting still has the value the recommendation gave it. If you changed it again yourself, it is left alone.</p>
      </section>
    </section>
  );
}

/** A few recommendations for one settings section, using the same cards (so nothing is duplicated). Hidden in Beginner mode's detail but never empty-handed. */
export function RecommendationsFor({ area }: { area: string }) {
  const rec = useRecommendations();
  const apply = useApplyRecommendations();
  const restore = useRestoreRecommendation();
  const view = rec.data;
  if (!view) return null;
  const items = view.items.filter((i) => i.area === area);
  if (items.length === 0) return null;
  const busy = apply.isPending || restore.isPending;
  return (
    <div className="space-y-2" aria-label={`Recommended for ${area}`}>
      <h3 className="font-semibold">Recommended for this section</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <RecommendationCard key={item.id} item={item} mode={view.mode} busy={busy} onApply={() => apply.mutate([item.id])} onRestore={(id) => restore.mutate(id)} />
        ))}
      </ul>
      {errorText(apply.error ?? restore.error) && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {errorText(apply.error ?? restore.error)}
        </p>
      )}
    </div>
  );
}
