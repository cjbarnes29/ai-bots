import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useDeleteSecret, useIntegrations, useVerifyIntegration } from "../api/hooks";
import type { IntegrationEntry, IntegrationStatus } from "../api/types";
import { CATEGORY_ORDER, serviceGuide, type ServiceGuide } from "../lib/serviceGuides";
import { GOALS, SCOPE_CHIP, nextStep, scopeOf } from "../lib/integrationNeeds";
import { DisconnectDialog } from "./setup/DisconnectDialog";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The Integrations Center catalog: every outside service in one list, with an honest status and a Test connection button.
 * "Verified" appears only after a real check succeeded. Saved credentials alone read "Ready, not tested yet".
 */
const STATUS: Record<IntegrationStatus, { label: string; tone: string }> = {
  verified: { label: "Verified", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed: { label: "Check failed", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  ready: { label: "Ready, not tested yet", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  not_set_up: { label: "Not set up", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

function Monogram({ label }: { label: string }) {
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-100 text-base font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Card({ e, paused, guide }: { e: IntegrationEntry; paused: boolean; guide?: ServiceGuide | undefined }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const verify = useVerifyIntegration();
  const del = useDeleteSecret();
  const chip = STATUS[e.status];
  const result = verify.data;
  const failure = verify.error instanceof ApiError ? verify.error.friendly : verify.error ? "That did not work." : null;
  const reads = e.actions.filter((a) => a.kind === "read");
  const writes = e.actions.filter((a) => a.kind === "write");
  const detailsId = `integration-${e.id}-details`;
  // Disconnect removes only this integration's OWN saved values (Gmail keeps the Google client it shares with Workspace).
  const ownSaved = guide ? guide.disconnect.secrets.filter((n) => e.secrets.some((s) => s.name === n && s.saved)) : [];

  return (
    <li className="card space-y-3">
      <div className="flex items-start gap-3">
        <Monogram label={e.label} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{e.label}</h3>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${chip.tone}`}>{chip.label}</span>
          <span className={`ml-1 mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_CHIP[scopeOf(e)].tone}`}>{SCOPE_CHIP[scopeOf(e)].label}</span>
        </div>
      </div>

      {guide && (
        <>
          <p className="text-sm">{guide.description}</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-medium">For example:</span> {guide.allows.slice(0, 2).join("; ")}.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-slate-500">Setup</dt>
              <dd className="font-medium">{guide.difficulty}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Sign-in</dt>
              <dd className="font-medium">{guide.auth}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {guide.configure ? (
              <Link to={guide.configure.to} className="btn-primary min-h-11" aria-label={`Configure ${e.label}`}>
                Configure
              </Link>
            ) : (
              <Link to={`/integrations/setup/${guide.id}`} className="btn-primary min-h-11" aria-label={`${e.status === "not_set_up" ? "Connect" : "Configure"} ${e.label}`}>
                {e.status === "not_set_up" ? "Connect" : "Configure"}
              </Link>
            )}
            <Link to={`/integrations/guide/${guide.id}`} className="btn-secondary min-h-11" aria-label={`Setup tutorial for ${e.label}`}>
              Setup tutorial
            </Link>
            {ownSaved.length > 0 && (
              <button type="button" className="btn-secondary min-h-11" onClick={() => setDisconnecting(true)} aria-label={`Disconnect ${e.label}`}>
                Disconnect
              </button>
            )}
          </div>
        </>
      )}
      {disconnecting && guide && <DisconnectDialog guide={guide} names={ownSaved} onClose={() => setDisconnecting(false)} />}

      <p className="text-sm text-slate-600 dark:text-slate-400">
        {e.status === "not_set_up" && e.notReady ? `Not set up: ${e.notReady}` : null}
        {e.status === "verified" && e.lastCheckText ? `${e.lastCheckText} (checked ${when(e.lastCheckAt)})` : null}
        {e.status === "failed" && e.lastCheckText ? `${e.lastCheckText} (${when(e.lastCheckAt)})` : null}
        {e.status === "ready"
          ? e.secrets.length === 0
            ? e.testable
              ? "Nothing to sign in to. Press Test connection to check it."
              : "Nothing to sign in to. It is only tested when an agent uses it."
            : e.testable
              ? "Credentials are saved. Press Test connection to check them."
              : "Credentials are saved. This service cannot be tested safely, so it stays at ready."
          : null}
      </p>

      <p className="text-sm">
        <span className="font-medium">Next step:</span> {nextStep(e)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={guide ? "btn-secondary min-h-11" : "btn-primary min-h-11"}
          disabled={verify.isPending || (paused && e.group !== "On this PC and the web" && e.group !== "Business Workforce")}
          onClick={() => verify.mutate(e.id)}
          aria-label={`Test connection for ${e.label}`}
        >
          {verify.isPending ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className="btn-secondary min-h-11" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>

      {result && (
        <p
          role="status"
          className={`rounded-md p-2 text-sm ${result.result === "verified" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : result.result === "failed" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"}`}
        >
          {result.result === "verified" ? `Verified: ${result.summary ?? "the service answered."}` : result.result === "failed" ? `Check failed: ${result.message ?? "no reason given."}` : (result.message ?? "Not testable.")}
        </p>
      )}
      {failure && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {failure}
        </p>
      )}

      {open && (
        <div id={detailsId} className="space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
          <section aria-label={`What ${e.label} can do`}>
            <h4 className="font-medium">What agents can do with it</h4>
            <ul className="mt-1 space-y-1">
              {reads.map((a) => (
                <li key={a.name}>
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium dark:bg-slate-800">Automatic (read)</span>
                  {a.description}
                </li>
              ))}
              {writes.map((a) => (
                <li key={a.name}>
                  <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Ask first (write)</span>
                  {a.description}
                </li>
              ))}
            </ul>
            <p className="hint">Reads work only for agents you switched on. Anything that sends or changes something waits on the Approvals page.</p>
          </section>

          <section aria-label={`Agents allowed to use ${e.label}`}>
            <h4 className="font-medium">Agents allowed to read through it</h4>
            {e.agents === null ? (
              <p>Set per agent on the agent&apos;s Permissions tab (or the PC Control Center).</p>
            ) : e.agents.length === 0 ? (
              <p>No agent yet. Switch it on for an agent on that agent&apos;s Permissions tab.</p>
            ) : (
              <ul className="list-disc pl-5">
                {e.agents.map((a) => (
                  <li key={a.id}>
                    <Link to={`/bots/${a.id}`} className="underline">
                      {a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p>Last used by an agent: {when(e.lastUsedAt) ?? "never"}.</p>

          {e.secrets.length > 0 && (
            <section aria-label={`Saved credentials for ${e.label}`}>
              <h4 className="font-medium">Credentials</h4>
              <ul className="space-y-1">
                {e.secrets.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {s.description} <span className="hint font-mono">({s.name})</span>: <strong>{s.saved ? "saved" : "not saved"}</strong>
                    </span>
                    {s.saved && (
                      <button type="button" className="btn-secondary min-h-11" onClick={() => setRemoving(s.name)}>
                        {s.name.includes("REFRESH_TOKEN") ? "Disconnect" : "Remove"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="hint">{guide && !guide.configure ? "Save or replace them with Configure." : "Save or replace them under Advanced at the bottom of this page."}</p>
            </section>
          )}

          {e.help.length > 0 && (
            <section aria-label={`Troubleshooting for ${e.label}`}>
              <h4 className="font-medium">If something goes wrong</h4>
              <ul className="list-disc pl-5">
                {e.help.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={removing.includes("REFRESH_TOKEN") ? `Disconnect ${e.label}?` : `Remove the saved credential?`}
          confirmLabel={removing.includes("REFRESH_TOKEN") ? "Disconnect" : "Remove"}
          danger
          busy={del.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => del.mutate(removing, { onSuccess: () => setRemoving(null) })}
        >
          <p>
            {removing.includes("REFRESH_TOKEN")
              ? `Agents lose access to ${e.label} straight away. To remove this app from your Google account as well, use myaccount.google.com/permissions.`
              : `${e.label} stops working until you save it again.`}
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}

/**
 * The services, one card each, in the Integration Setup Center's categories. Categories come from the setup guides (serviceGuides.ts);
 * a connector without a guide still appears, under "Other", with its existing test and details.
 */
function WhatDoINeed({ entries }: { entries: IntegrationEntry[] }) {
  const [goalId, setGoalId] = useState("");
  const goal = GOALS.find((g) => g.id === goalId);
  return (
    <section aria-label="Which services do I need?" className="card space-y-2">
      <h2 className="text-lg font-semibold">Which services do I need?</h2>
      <label className="block text-sm">
        <span className="label">I want to…</span>
        <select aria-label="What do you want to do?" value={goalId} onChange={(e) => setGoalId(e.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
          <option value="">Choose a goal</option>
          {GOALS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </label>
      {goal && (
        <div className="space-y-1 text-sm" role="status">
          {goal.needs.length === 0 ? <p>No service is needed.</p> : (
            <ul className="list-disc pl-5">
              {goal.needs.map((id) => {
                const e = entries.find((x) => x.id === id);
                const ok = e && (e.status === "verified" || e.status === "ready");
                return (
                  <li key={id}>
                    <strong>{e?.label ?? id}</strong>: {e ? (ok ? (e.status === "verified" ? "set up and checked" : "set up, not tested yet") : "not set up yet") : "not available"}
                  </li>
                );
              })}
            </ul>
          )}
          <p>{goal.needsRealAi ? "Also needs a real AI provider for the thinking part (the simulated Demo AI cannot do it)." : "Does not need a real AI provider."}</p>
          <p className="hint">{goal.note}</p>
        </div>
      )}
    </section>
  );
}

export function IntegrationCatalog() {
  const q = useIntegrations();
  if (q.isPending) return <p role="status">Loading services…</p>;
  if (q.isError || !q.data) return <p role="alert">Could not load the list of services.</p>;
  const categoryOf = (id: string) => serviceGuide(id)?.category ?? "Other";
  const present = [...CATEGORY_ORDER, "Other" as const].filter((c) => q.data.integrations.some((i) => categoryOf(i.id) === c));
  return (
    <section aria-labelledby="catalog-heading" className="space-y-6">
      <div>
        <h2 id="catalog-heading" className="sr-only">
          Services
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Connect one service at a time: press Connect and follow the steps. A service shows <strong>Verified</strong> only after a real check succeeded. Saved credentials alone read &ldquo;Ready, not tested yet&rdquo;.
          {q.data.paused ? " Outside actions are paused, so connection tests that reach the internet are switched off." : ""}
        </p>
      </div>
      <WhatDoINeed entries={q.data.integrations} />
      {present.map((c) => (
        <section key={c} aria-label={c} className="space-y-2">
          <h2 className="text-lg font-semibold">{c}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data.integrations
              .filter((i) => categoryOf(i.id) === c)
              .map((i) => (
                <Card key={i.id} e={i} paused={q.data.paused} guide={serviceGuide(i.id)} />
              ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
