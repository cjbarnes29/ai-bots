import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useModels, usePatchModel, usePatchProvider, useProviders, useRefreshModels, useSetSecret, useTestProvider } from "../api/hooks";
import type { ProviderView } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

type StepState = "done" | "todo" | "blocked";
const MARK: Record<StepState, string> = { done: "Done", todo: "To do", blocked: "Waiting for the step before" };

function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children: React.ReactNode }) {
  return (
    <li className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {n}. {title}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${state === "done" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
        >
          {MARK[state]}
        </span>
      </div>
      {children}
    </li>
  );
}

/**
 * One guided path for connecting an AI provider: key, free-plan confirmation, test, models. It only drives the existing endpoints, so every
 * safety rule (free-only, no billing confirmation, daily caps) is the same as in the provider cards below. "Connected" is shown only after
 * a real test call succeeded.
 */
export function ProviderSetupGuide() {
  const providers = useProviders();
  const models = useModels();
  const setSecret = useSetSecret();
  const patch = usePatchProvider();
  const test = useTestProvider();
  const refresh = useRefreshModels();
  const patchModel = usePatchModel();
  const [chosen, setChosen] = useState("");
  const [key, setKey] = useState("");

  const list = (providers.data ?? []).filter((p) => p.connectable);
  const firstToConnect = (list.find((x) => x.status !== "connected") ?? list[0])?.id ?? "";
  // Pick the first provider that still needs connecting, once, and then stay on it: it must not jump away the moment it connects.
  useEffect(() => {
    if (!chosen && firstToConnect) setChosen(firstToConnect);
  }, [chosen, firstToConnect]);
  const p: ProviderView | undefined = list.find((x) => x.id === chosen) ?? list.find((x) => x.id === firstToConnect);
  if (!p) return null;

  const mine = (models.data ?? []).filter((m) => m.providerId === p.id);
  const usable = mine.filter((m) => m.freeStatus !== "blocked");
  const cloud = p.kind === "cloud";
  const keyOk = !cloud || p.keyConfigured;
  const freeOk = !p.requiresFreeConfirmation || p.freeConfirmed;
  const connected = p.status === "connected";
  const busy = setSecret.isPending || patch.isPending || test.isPending || refresh.isPending;
  const err = errorText(setSecret.error ?? patch.error ?? test.error ?? refresh.error ?? patchModel.error);
  const capLeft = p.dailyRequestCap === null ? null : Math.max(0, p.dailyRequestCap - p.requestsToday);

  return (
    <section aria-labelledby="guide-heading" className="card space-y-4">
      <div>
        <h2 id="guide-heading" className="text-lg font-semibold">
          Connect an AI provider
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Pick a provider and follow the steps. Only free use is possible; nothing here can enable a paid model.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium" htmlFor="guide-provider">
          Provider
        </label>
        <select id="guide-provider" className="w-auto min-w-48" value={p.id} onChange={(e) => setChosen(e.target.value)}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.displayName}
              {x.status === "connected" ? " (connected)" : ""}
            </option>
          ))}
        </select>
        <span className="text-sm" role="status">
          {connected ? (
            <strong className="text-emerald-700 dark:text-emerald-400">Connected{p.lastCheckedAt ? `: last successful test ${new Date(p.lastCheckedAt).toLocaleString()}` : ""}</strong>
          ) : (
            <span>Not connected yet. It counts as connected only after a test succeeds.</span>
          )}
        </span>
      </div>
      <p className="hint">{p.freePolicyLabel}</p>

      <ol className="space-y-3">
        <Step n={1} title={cloud ? "Save the key" : "Check the local address"} state={keyOk ? "done" : "todo"}>
          {cloud ? (
            p.keyConfigured ? (
              <p className="text-sm">A key is saved ({p.keyEnv}). It is never shown again.</p>
            ) : (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (p.keyEnv && key.trim()) setSecret.mutate({ name: p.keyEnv, value: key.trim() }, { onSuccess: () => setKey("") });
                }}
              >
                <label className="min-w-48 flex-1">
                  <span className="label">Paste your {p.displayName} key</span>
                  <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${p.displayName} key`} />
                </label>
                <button className="btn-primary min-h-11" disabled={!key.trim() || busy}>
                  Save key
                </button>
              </form>
            )
          ) : (
            <p className="text-sm">No key is needed. This provider runs on this PC at {p.baseUrl}.</p>
          )}
        </Step>

        <Step n={2} title={p.requiresFreeConfirmation ? "Confirm the free plan and switch it on" : "Switch it on"} state={keyOk && freeOk && p.enabled ? "done" : keyOk ? "todo" : "blocked"}>
          {p.requiresFreeConfirmation && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={p.freeConfirmed} disabled={!keyOk || busy} onChange={(e) => patch.mutate({ id: p.id, patch: { freeConfirmed: e.target.checked } })} />
              <span>
                I confirm my {p.displayName} account has <strong>no billing</strong> (no payment method or billing account is attached).
              </span>
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={p.enabled} disabled={!keyOk || !freeOk || busy} onChange={(e) => patch.mutate({ id: p.id, patch: { enabled: e.target.checked } })} />
            Use {p.displayName}
          </label>
        </Step>

        <Step n={3} title="Test the connection" state={connected ? "done" : keyOk && freeOk && p.enabled ? "todo" : "blocked"}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary min-h-11" disabled={!(keyOk && freeOk && p.enabled) || busy} onClick={() => test.mutate(p.id)}>
              {test.isPending ? "Testing…" : "Test connection"}
            </button>
            {p.statusMessage && <span className="text-sm">{p.statusMessage}</span>}
          </div>
        </Step>

        <Step n={4} title="Fetch the models" state={connected && p.modelCount > 0 ? "done" : connected ? "todo" : "blocked"}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary min-h-11" disabled={!connected || busy} onClick={() => refresh.mutate(p.id)}>
              {refresh.isPending ? "Fetching…" : "Fetch models"}
            </button>
            <span className="text-sm">{p.modelCount} models found</span>
          </div>
        </Step>

        <Step n={5} title="Switch on the models agents may use" state={p.enabledModelCount > 0 ? "done" : p.modelCount > 0 ? "todo" : "blocked"}>
          {usable.length === 0 ? (
            <p className="text-sm">No usable models yet.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {usable.slice(0, 12).map((m) => (
                <li key={m.id}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={m.enabled} disabled={patchModel.isPending} onChange={() => patchModel.mutate({ id: m.id, enabled: !m.enabled })} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">Use {m.displayName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            There is no single global default: an agent set to Automatic uses the best free model that is switched on; you can also choose one model per agent on its Details tab.
            {usable.length > 12 ? " The full list is under Models below." : ""}
          </p>
        </Step>
      </ol>

      <p className="text-sm text-slate-600 dark:text-slate-400" aria-label="Free capacity today">
        Requests today: {p.requestsToday}
        {p.dailyRequestCap !== null ? ` of the app's safety cap of ${p.dailyRequestCap} (${capLeft} left)` : " (no cap set)"}. The cap is this app&apos;s own limit, not the provider&apos;s quota: check
        the provider&apos;s real free limits before changing it.
      </p>
      {err && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {err}
        </p>
      )}
    </section>
  );
}
