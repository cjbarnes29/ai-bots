import { useState } from "react";
import { ApiError } from "../api/client";
import { useEvaluateModel, useRegistry } from "../api/hooks";
import type { EvaluationResult, RegistryModel } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const STATUS: Record<RegistryModel["status"], { label: string; tone: string; text: string }> = {
  verified: { label: "Verified", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200", text: "Bots and automatic routing may use it." },
  unverified: { label: "Unverified", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", text: "Found, but not (fully) tested. Not used automatically and cannot be given to a bot." },
  unavailable: { label: "Unavailable", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200", text: "Retired, not listed, not a chat model or switched off." },
};
const FILTERS = ["all", "verified", "unverified", "unavailable", "non-chat"] as const;
type Filter = (typeof FILTERS)[number];
const mark = (r: string) => (r === "pass" ? "✓" : r === "fail" ? "✗" : "–");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

function ModelCard({ m, onTest }: { m: RegistryModel; onTest: (m: RegistryModel) => void }) {
  const s = STATUS[m.status];
  return (
    <li aria-label={m.ref} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">{m.displayName}</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`} title={s.text}>
          {s.label}
        </span>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-800">{m.kindLabel}</span>
        <span className="hint">{m.providerName}</span>
        <span className="flex-1" />
        {m.chatCapable && m.inCatalog && (
          <button type="button" className="btn-secondary" aria-label={`Run tests on ${m.ref}`} onClick={() => onTest(m)}>
            Run tests…
          </button>
        )}
      </div>
      <p className="hint break-all font-mono">{m.ref}</p>
      {m.reasons.length > 0 && (
        <p className={m.status === "unavailable" ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"} aria-label={`Why ${m.ref} is ${s.label.toLowerCase()}`}>
          {m.reasons.join(" ")}
        </p>
      )}
      {m.suggestedReplacement && <p>Suggested replacement: <strong>{m.suggestedReplacement}</strong> (named by the provider; it still has to be verified).</p>}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
        <div>
          <dt className="hint">Context window</dt>
          <dd>{m.contextWindow ? `${m.contextWindow.toLocaleString()} tokens` : "not listed"}</dd>
        </div>
        <div>
          <dt className="hint">Answers so far</dt>
          <dd>
            {m.usage.requests === 0 ? "none yet" : `${m.usage.ok} ok, ${m.usage.errors} failed${m.usage.avgLatencyMs !== null ? ` · about ${(m.usage.avgLatencyMs / 1000).toFixed(1)} s` : ""}`}
          </dd>
        </div>
        <div>
          <dt className="hint">Last verified</dt>
          <dd>{when(m.lastVerifiedAt)}</dd>
        </div>
      </dl>
      {m.cooldownSeconds > 0 && <p className="text-amber-800 dark:text-amber-300">Resting after a rate limit, back in about {m.cooldownSeconds} seconds.</p>}
      {m.chatCapable && (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Tests, suitability and limits</summary>
          <div className="mt-2 space-y-2">
            <ul aria-label={`Tests for ${m.ref}`} className="grid gap-1 sm:grid-cols-2">
              {m.tests.map((t) => (
                <li key={t.test} title={t.detail}>
                  <span aria-hidden="true">{mark(t.result)} </span>
                  {t.label}
                  {t.core ? " (required)" : ""}
                  <span className="hint">
                    {" "}
                    {t.result === "untested" ? "not tested" : `${t.result === "pass" ? "passed" : "FAILED"} · ${t.source} · ${when(t.at)}${t.latencyMs ? ` · ${(t.latencyMs / 1000).toFixed(1)} s` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
            <ul aria-label={`Suitable for ${m.ref}`} className="grid gap-1 sm:grid-cols-2">
              {m.suitability.map((x) => (
                <li key={x.task}>
                  <span aria-hidden="true">{x.ok ? "✓ " : "– "}</span>
                  {x.task} <span className="hint">({x.basis})</span>
                </li>
              ))}
            </ul>
            {m.limitations.length > 0 && (
              <ul className="list-disc pl-5">
                {m.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {Object.keys(m.failures).length > 0 && <p className="hint">Failures seen: {Object.entries(m.failures).map(([k, v]) => `${k.replace("_", " ")} ×${v}`).join(", ")}. Only a confirmed retirement ever excludes a model; the rest are counted.</p>}
          </div>
        </details>
      )}
    </li>
  );
}

function ResultBox({ r }: { r: EvaluationResult }) {
  return (
    <div role="status" aria-label="Test results" className="card space-y-1 text-sm">
      <h4 className="font-semibold">Results for {r.ref}</h4>
      <p>
        {r.requestsUsed} of {r.budget} approved requests used. Now: <strong>{r.status}</strong>.{r.stoppedBecause ? ` ${r.stoppedBecause}` : ""}
      </p>
      <ul className="list-disc pl-5">
        {r.results.map((x, i) => (
          <li key={`${x.test}-${i}`}>
            {x.label}: <strong>{x.result === "not_run" ? "not run" : x.result === "pass" ? "passed" : "FAILED"}</strong> — {x.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which models bots can use and why others cannot; the only place real model tests are started (with a request count the owner confirms). */
export function ModelRegistry() {
  const reg = useRegistry();
  const evaluate = useEvaluateModel();
  const [filter, setFilter] = useState<Filter>("all");
  const [provider, setProvider] = useState("all");
  const [testing, setTesting] = useState<RegistryModel | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const view = reg.data;
  if (reg.isError) return <p role="alert">Could not load the model registry.</p>;
  if (!view) return <p role="status">Loading the model registry…</p>;

  const providers = [...new Set(view.models.map((m) => m.providerId))];
  const shown = view.models.filter((m) => {
    if (provider !== "all" && m.providerId !== provider) return false;
    if (filter === "non-chat") return !m.chatCapable;
    if (filter === "all") return true;
    return m.chatCapable && m.status === filter;
  });
  const count = (f: Filter) => (f === "all" ? view.models.length : f === "non-chat" ? view.summary.notChat : view.summary[f]);
  const requests = view.battery.requestsPerFullRun;

  return (
    <section aria-label="Model registry" className="space-y-3">
      <h2 className="text-lg font-semibold">Model registry</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Every model the connected providers list, what kind it is, and whether bots may use it. A model is <strong>verified</strong> only after it passes real tests (a simple instruction, JSON output
        {view.battery.core.length > 0 ? "" : ""}); until then automatic routing skips it and it cannot be given to a bot. Only a provider-confirmed retirement ever removes a model; rate limits and outages never do.
        {!view.enforced && " (Verification is switched off in this test instance.)"}
      </p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter models">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={filter === f ? "btn-primary" : "btn-secondary"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "non-chat" ? "Not chat models" : f[0]!.toUpperCase() + f.slice(1)} ({count(f)})
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          Provider
          <select aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="all">All</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {view.models.find((m) => m.providerId === p)?.providerName ?? p}
              </option>
            ))}
          </select>
        </label>
      </div>
      {errorText(evaluate.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(evaluate.error)}
        </p>
      )}
      {result && <ResultBox r={result} />}
      {shown.length === 0 ? <p className="hint">No models in this view.</p> : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <ModelCard key={m.ref} m={m} onTest={setTesting} />
          ))}
        </ul>
      )}
      {testing && (
        <ConfirmDialog
          title={`Run the tests on ${testing.displayName}?`}
          confirmLabel={`Send up to ${requests} real requests`}
          busy={evaluate.isPending}
          onCancel={() => setTesting(null)}
          onConfirm={() =>
            evaluate.mutate(
              { ref: testing.ref, tests: view.battery.order, approvedRequests: requests },
              { onSuccess: (r) => setResult(r.result), onSettled: () => setTesting(null) },
            )
          }
        >
          <p className="mb-2">
            This sends <strong>{requests} short requests</strong> to {testing.providerName} ({testing.modelId}) using your connected free account. They use a little of the free allowance and no money. The tests are
            one at a time and stop at the first provider problem.
          </p>
          <ul className="list-disc pl-5">
            {view.battery.order.map((t) => (
              <li key={t}>{view.battery.labels[t] ?? t}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </section>
  );
}
