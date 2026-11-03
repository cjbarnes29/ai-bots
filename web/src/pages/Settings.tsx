import { useEffect, useState } from "react";
import { DevicesSection } from "../components/DevicesSection";
import { GmailSection } from "../components/GmailSection";
import { SecretsSection } from "../components/SecretsSection";
import { ApiError } from "../api/client";
import {
  useDelegationLimits,
  useResetDelegationLimits,
  useUpdateDelegationLimits,
  useLlmStatus,
  useModels,
  usePatchModel,
  usePatchProvider,
  useProviders,
  useRefreshModels,
  useResetLimits,
  useSetPaused,
  useTestProvider,
  useUpdateLimits,
} from "../api/hooks";
import type { ModelView, ProviderView } from "../api/types";
import { FreeBadge } from "../components/FreeBadge";

const errorText = (e: unknown): string | null =>
  e === null || e === undefined ? null : e instanceof ApiError ? e.friendly : "That did not work.";

function ErrorLine({ error }: { error: unknown }) {
  const text = errorText(error);
  if (!text) return null;
  return (
    <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {text}
    </p>
  );
}

function Switch({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"
      }`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}

// ---------------- safety ----------------

function SafetySection() {
  const status = useLlmStatus();
  const setPaused = useSetPaused();
  return (
    <section aria-label="Safety" className="card space-y-4">
      <h2 className="text-lg font-semibold">Safety</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            <span aria-hidden="true">🔒 </span>Free-only mode: <span className="text-emerald-700 dark:text-emerald-400">ON (locked)</span>
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Only free models can be used. No paid models, no paid fallbacks, no automatic billing. This cannot be turned off.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div>
          <p className="font-medium">Pause all AI calls</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {status.data?.paused ? "Paused: no bot can reach any model." : "Off. Turn this on to stop every model call instantly."}
          </p>
        </div>
        <Switch
          checked={status.data?.paused ?? false}
          label="Pause all AI calls"
          disabled={!status.data || setPaused.isPending}
          onClick={() => setPaused.mutate(!(status.data?.paused ?? false))}
        />
      </div>
      <ErrorLine error={setPaused.error} />
    </section>
  );
}

// ---------------- providers ----------------

const STATUS_CHIPS: Record<string, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  auth_failed: { label: "Key rejected", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  unreachable: { label: "Unreachable", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  rate_limited: { label: "Rate limited", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  key_missing: { label: "Key missing", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  error: { label: "Error", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};
const NEUTRAL_TONE = "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

function chipFor(p: ProviderView): { label: string; tone: string } {
  if (!p.connectable) return { label: "Not connected", tone: NEUTRAL_TONE };
  if (p.kind === "cloud" && !p.keyConfigured) return STATUS_CHIPS["key_missing"]!;
  if (p.status && STATUS_CHIPS[p.status]) return STATUS_CHIPS[p.status]!;
  return { label: "Not tested yet", tone: NEUTRAL_TONE };
}

function ProviderCard({ provider: p }: { provider: ProviderView }) {
  const patch = usePatchProvider();
  const test = useTestProvider();
  const refresh = useRefreshModels();
  const [cap, setCap] = useState(p.dailyRequestCap === null ? "" : String(p.dailyRequestCap));
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  useEffect(() => setCap(p.dailyRequestCap === null ? "" : String(p.dailyRequestCap)), [p.dailyRequestCap]);
  useEffect(() => setBaseUrl(p.baseUrl), [p.baseUrl]);

  const chip = chipFor(p);
  const capChanged = cap !== (p.dailyRequestCap === null ? "" : String(p.dailyRequestCap));
  const canEnable = !p.requiresFreeConfirmation || p.freeConfirmed;
  const busy = patch.isPending || test.isPending || refresh.isPending;
  const error = patch.error ?? test.error ?? refresh.error;

  return (
    <li className="card space-y-4" aria-label={p.displayName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{p.displayName}</h3>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-800">{p.kind === "cloud" ? "Cloud" : "Local"}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.tone}`}>{chip.label}</span>
        </div>
        <Switch
          checked={p.enabled}
          label={`Enable ${p.displayName}`}
          disabled={busy || (!p.enabled && !canEnable)}
          onClick={() => patch.mutate({ id: p.id, patch: { enabled: !p.enabled } })}
        />
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400">{p.freePolicyLabel}</p>

      {p.kind === "cloud" ? (
        <p className="text-sm">
          API key:{" "}
          {p.keyConfigured ? (
            <span className="text-emerald-700 dark:text-emerald-400">found in the vault or your .env file ({p.keyEnv})</span>
          ) : (
            <span>
              not found. Paste it in the vault above ({p.keyEnv}), or add a line <code>{p.keyEnv}=your-key</code> to your <code>.env</code> file and restart the app.
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm">No key needed. Models run on this PC.</p>
      )}

      {p.requiresFreeConfirmation && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.freeConfirmed}
            disabled={busy}
            onChange={(e) => patch.mutate({ id: p.id, patch: { freeConfirmed: e.target.checked } })}
          />
          <span>
            I confirm my {p.displayName} account has <strong>no billing</strong> (no payment method or billing account is attached).
            Required before this provider can be switched on.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`cap-${p.id}`} className="label">
            Daily request cap
          </label>
          <div className="flex gap-2">
            <input
              id={`cap-${p.id}`}
              className="w-28"
              type="number"
              min={1}
              value={cap}
              placeholder={p.kind === "local" ? "none" : ""}
              onChange={(e) => setCap(e.target.value)}
            />
            {capChanged && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => patch.mutate({ id: p.id, patch: { dailyRequestCap: cap.trim() === "" ? null : Number(cap) } })}
              >
                Save cap
              </button>
            )}
          </div>
        </div>
        {p.baseUrlEditable && (
          <div className="min-w-64 flex-1">
            <label htmlFor={`url-${p.id}`} className="label">
              Address (must be on this PC)
            </label>
            <div className="flex gap-2">
              <input id={`url-${p.id}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              {baseUrl !== p.baseUrl && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => patch.mutate({ id: p.id, patch: { baseUrl } })}>
                  Save address
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => test.mutate(p.id)}>
          {test.isPending ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => refresh.mutate(p.id)}>
          {refresh.isPending ? "Refreshing…" : "Refresh models"}
        </button>
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {p.modelCount} models · {p.enabledModelCount} switched on · {p.requestsToday} requests today
        </span>
      </div>

      {p.statusMessage && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {p.statusMessage}
          {p.lastCheckedAt && <span className="text-xs"> (checked {new Date(p.lastCheckedAt).toLocaleString()})</span>}
        </p>
      )}
      <ErrorLine error={error} />
    </li>
  );
}

function ProvidersSection() {
  const providers = useProviders();
  return (
    <section aria-label="Providers" className="space-y-3">
      <h2 className="text-lg font-semibold">Providers</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Testing a connection and refreshing models use no tokens. Keys are read from your <code>.env</code> file and are never shown here.
      </p>
      {providers.isPending && <p role="status">Loading providers…</p>}
      {providers.isError && <ErrorLine error={providers.error} />}
      <ul className="space-y-4">
        {(providers.data ?? []).map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </ul>
    </section>
  );
}

// ---------------- models ----------------

const AVAILABILITY: Record<ModelView["availability"], string> = {
  available: "Available",
  not_installed: "Not installed",
  removed: "No longer listed",
  unknown: "Not checked",
};

function ModelRow({ model: m }: { model: ModelView }) {
  const patch = usePatchModel();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{m.displayName}</span>
          <FreeBadge status={m.freeStatus} />
          {m.isLlama && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">Llama</span>}
          <span className="text-xs text-slate-500">{AVAILABILITY[m.availability]}</span>
        </div>
        <p className="break-all text-xs text-slate-500">
          {m.ref}
          {m.contextWindow ? ` · ${m.contextWindow.toLocaleString()} token context` : ""}
        </p>
        <p className="text-xs text-slate-500">{m.freeSource}</p>
        {!m.callable && m.blockedReason && <p className="text-xs text-amber-700 dark:text-amber-400">Can't be used yet: {m.blockedReason}</p>}
        <ErrorLine error={patch.error} />
      </div>
      <Switch
        checked={m.enabled}
        label={`Enable model ${m.displayName}`}
        disabled={patch.isPending || m.freeStatus === "blocked"}
        onClick={() => patch.mutate({ id: m.id, enabled: !m.enabled })}
      />
    </li>
  );
}

function ModelsSection() {
  const models = useModels();
  const groups = [...new Map((models.data ?? []).map((m) => [m.providerId, m.providerName])).entries()];
  return (
    <section aria-label="Models" className="space-y-3">
      <h2 className="text-lg font-semibold">Models</h2>
      {models.isPending && <p role="status">Loading models…</p>}
      {models.data && models.data.length === 0 && (
        <p className="card text-sm text-slate-600 dark:text-slate-400">
          No models yet. Click <strong>Refresh models</strong> on a provider above. A provider must be reachable first.
        </p>
      )}
      {groups.map(([providerId, providerName]) => (
        <div key={providerId} className="card">
          <h3 className="font-semibold">{providerName}</h3>
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {(models.data ?? [])
              .filter((m) => m.providerId === providerId)
              .map((m) => (
                <ModelRow key={m.id} model={m} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---------------- limits ----------------

const LIMIT_GROUPS: { title: string; note?: string; fields: { key: string; label: string }[] }[] = [
  {
    title: "All bots together (cloud providers only)",
    note: "Local models don't use up these limits.",
    fields: [
      { key: "globalDailyRequests", label: "Requests per day" },
      { key: "globalMonthlyRequests", label: "Requests per month" },
      { key: "globalDailyTokens", label: "Tokens per day" },
      { key: "globalMonthlyTokens", label: "Tokens per month" },
    ],
  },
  {
    title: "Each bot (every provider, including local)",
    fields: [
      { key: "botDailyRequests", label: "Requests per day" },
      { key: "botMonthlyRequests", label: "Requests per month" },
      { key: "botDailyTokens", label: "Tokens per day" },
      { key: "botMonthlyTokens", label: "Tokens per month" },
      { key: "botRequestsPerMinute", label: "Requests per minute" },
    ],
  },
  {
    title: "Each request",
    note: "No reply can ever be longer than 4,096 tokens.",
    fields: [
      { key: "maxOutputTokensDefault", label: "Default max reply length (tokens)" },
      { key: "maxPromptTokens", label: "Max prompt size (estimated tokens)" },
      { key: "maxMessageChars", label: "Max message size (characters)" },
      { key: "historyMessages", label: "Past messages sent with each call" },
    ],
  },
  {
    title: "Speed and safety",
    fields: [
      { key: "providerRequestsPerMinute", label: "Requests per minute, each cloud provider" },
      { key: "maxConcurrentCloud", label: "Simultaneous cloud requests" },
      { key: "maxConcurrentLocal", label: "Simultaneous local requests" },
      { key: "timeoutMs", label: "Timeout (milliseconds)" },
      { key: "retries", label: "Retries after a temporary failure" },
      { key: "retryDelayMs", label: "Wait before a retry (milliseconds)" },
      { key: "retryDelayMaxMs", label: "Longest wait before a retry (milliseconds)" },
      { key: "breakerFailures", label: "Failures in a row before pausing a provider" },
      { key: "breakerOpenMs", label: "How long a failing provider stays paused (milliseconds)" },
    ],
  },
];

function LimitsSection() {
  const status = useLlmStatus();
  const update = useUpdateLimits();
  const reset = useResetLimits();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const limits = status.data?.limits;

  useEffect(() => {
    if (limits) setDraft(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, String(v)])));
  }, [limits]);

  if (!limits) return <section aria-label="Limits"><h2 className="text-lg font-semibold">Limits</h2><p role="status">Loading limits…</p></section>;

  const changed = Object.entries(draft).filter(([k, v]) => v !== String(limits[k]));
  const save = () => update.mutate(Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])));

  return (
    <section aria-label="Limits" className="space-y-3">
      <h2 className="text-lg font-semibold">Limits</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Checked before every call. The most pessimistic case is counted: your message plus the longest allowed reply. Days reset at
        midnight, months on the 1st.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {LIMIT_GROUPS.map((group) => (
          <div key={group.title} className="card space-y-3">
            <h3 className="font-semibold">{group.title}</h3>
            {group.note && <p className="hint">{group.note}</p>}
            {group.fields.map((f) => (
              <div key={f.key}>
                <label htmlFor={`limit-${f.key}`} className="label">
                  {f.label}
                </label>
                <input
                  id={`limit-${f.key}`}
                  type="number"
                  min={0}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={changed.length === 0 || update.isPending} onClick={save}>
          {update.isPending ? "Saving…" : "Save limits"}
        </button>
        <button type="button" className="btn-secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
          Reset to the approved defaults
        </button>
        {changed.length > 0 && <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>}
      </div>
      <ErrorLine error={update.error ?? reset.error} />
    </section>
  );
}

// ---------------- delegation limits ----------------

const DELEGATION_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "maxDepth", label: "How many levels deep a chain may go", hint: "0 turns delegation off. The most allowed is 4." },
  { key: "maxSubtasksPerTask", label: "Teammates one task may use", hint: "The most allowed is 6." },
  { key: "maxTasksPerChain", label: "Tasks in one chain", hint: "The most allowed is 15." },
  { key: "maxLlmCallsPerChain", label: "Model calls in one chain", hint: "Counts against your free-tier limits. The most allowed is 30." },
  { key: "maxInstructionChars", label: "Longest instruction (characters)", hint: "The most allowed is 20,000." },
];

function DelegationLimitsSection() {
  const data = useDelegationLimits();
  const update = useUpdateDelegationLimits();
  const reset = useResetDelegationLimits();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const limits = data.data?.limits;

  useEffect(() => {
    if (limits) setDraft(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, String(v)])));
  }, [limits]);

  if (!limits) {
    return (
      <section aria-label="Delegation limits">
        <h2 className="text-lg font-semibold">Teamwork limits</h2>
        <p role="status">Loading…</p>
      </section>
    );
  }
  const changed = Object.entries(draft).filter(([k, v]) => v !== String(limits[k]));

  return (
    <section aria-label="Delegation limits" className="space-y-3">
      <h2 className="text-lg font-semibold">Teamwork limits</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        When one bot hands work to another, these keep the chain small. Every model call in a chain also counts against the limits above.
      </p>
      <div className="card grid gap-4 sm:grid-cols-2">
        {DELEGATION_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`delegation-${f.key}`} className="label">
              {f.label}
            </label>
            <input
              id={`delegation-${f.key}`}
              type="number"
              min={0}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
            <p className="hint">{f.hint}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={changed.length === 0 || update.isPending}
          onClick={() => update.mutate(Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])))}
        >
          {update.isPending ? "Saving…" : "Save teamwork limits"}
        </button>
        <button type="button" className="btn-secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
          Reset teamwork limits
        </button>
        {changed.length > 0 && <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>}
      </div>
      <ErrorLine error={update.error ?? reset.error} />
    </section>
  );
}

export function Settings() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SafetySection />
      <SecretsSection />
      <GmailSection />
      <DevicesSection />
      <ProvidersSection />
      <ModelsSection />
      <LimitsSection />
      <DelegationLimitsSection />
    </div>
  );
}
