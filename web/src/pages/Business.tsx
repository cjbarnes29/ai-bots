import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBusinessLeads, useBusinessStatus, useBusinessTeam, useInstallBusinessTeam, useSetBusinessExternal, useStagedBatch, useStagedBatches } from "../api/hooks";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LeadCard, websiteChip } from "../components/business/LeadCard";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {error}
    </p>
  ) : null;
}

/** The one lock in front of every request to the outside. OFF unless the owner switches it on. */
function OutsideRequests() {
  const status = useBusinessStatus();
  const set = useSetBusinessExternal();
  const [asking, setAsking] = useState(false);
  const s = status.data;
  if (!s) return <p role="status">Loading…</p>;
  return (
    <section aria-labelledby="lock-heading" className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="lock-heading" className="text-lg font-semibold">
            Outside requests
          </h2>
          <p className="text-sm">
            Status: <strong className={s.externalEnabled ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>{s.externalEnabled ? "ON" : "OFF"}</strong>
          </p>
        </div>
        {s.externalEnabled ? (
          <button type="button" className="btn-secondary min-h-11" disabled={set.isPending} onClick={() => set.mutate(false)}>
            Switch off
          </button>
        ) : (
          <button type="button" className="btn-secondary min-h-11" disabled={set.isPending} onClick={() => setAsking(true)}>
            Switch on…
          </button>
        )}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {s.externalEnabled
          ? "Agents may look up businesses in public map data and read the home page of a business's website (read-only). Nothing is sent, published or bought."
          : "While this is OFF, no map search is made and no website is contacted. Agents asking for it are refused."}
      </p>
      <p className="hint">
        Today: {s.usage.mapSearchesToday} of {s.usage.mapSearchesPerDay} map searches · {s.usage.siteRequestsToday} of {s.usage.siteRequestsPerDay} website requests
      </p>
      <Alert error={errorText(set.error)} />
      {asking && (
        <ConfirmDialog
          title="Switch on outside requests?"
          confirmLabel="Yes, switch on"
          busy={set.isPending}
          onCancel={() => setAsking(false)}
          onConfirm={() => set.mutate(true, { onSettled: () => setAsking(false) })}
        >
          <p className="mb-2">While this is ON, agents with the web-reading switch can:</p>
          <ul className="mb-2 list-disc pl-5">
            <li>
              ask the public map service (overpass-api.de) for businesses: up to {s.usage.mapSearchesPerDay} searches a day;
            </li>
            <li>read the home page of the websites of businesses you asked them to check, once each: up to {s.usage.siteRequestsPerDay} requests a day.</li>
          </ul>
          <p className="hint">It is read-only: nothing is sent to anyone. Only switch it on for a test you have approved. You can switch it off at any time.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function Team() {
  const team = useBusinessTeam();
  const install = useInstallBusinessTeam();
  const [asking, setAsking] = useState(false);
  const t = team.data;
  if (!t) return <p role="status">Loading…</p>;
  const missing = t.agents.some((a) => !a.exists) || !t.workflow.exists || t.skills.some((s) => !s.exists);
  return (
    <section aria-labelledby="team-heading" className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="team-heading" className="text-lg font-semibold">
            Business team
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">Four agents, three skills and one workflow. New agents start switched off.</p>
        </div>
        {missing && (
          <button type="button" className="btn-primary min-h-11" disabled={install.isPending} onClick={() => setAsking(true)}>
            Create the Business team
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {t.agents.map((a) => (
          <li key={a.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {a.exists && a.id ? (
                    <Link to={`/bots/${a.id}`} className="underline">
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                </p>
                <p className="hint">{a.role}</p>
              </div>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium dark:bg-slate-800">{a.exists ? `Created (${a.status ?? "off"})` : "Not created yet"}</span>
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer underline">What {a.name} is told</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800">{a.instructions}</pre>
              <p className="hint">
                {a.webRead ? "Web reading is switched on for it when it is created (public pages only; sending is never possible)." : "It gets no web reading."} Skills: {a.skills.join(", ")}.
              </p>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Workflow &ldquo;{t.workflow.name}&rdquo;: {t.workflow.exists ? "created (off)" : "not created yet"}. Manager may use all four: {t.managerAllowsAll ? "yes" : "not yet"}.
      </p>
      {install.data && (
        <div role="status" className="rounded-md bg-emerald-100 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <p>
            Done: {install.data.agents.filter((a) => a.created).length} agent(s) created, {install.data.skills.filter((s) => s.created).length} skill(s), workflow {install.data.workflow.created ? "created" : "already there"}.
          </p>
          <ul className="list-disc pl-5">
            {install.data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <Alert error={errorText(install.error)} />
      {asking && (
        <ConfirmDialog
          title="Create the Business team?"
          confirmLabel="Create the team"
          busy={install.isPending}
          onCancel={() => setAsking(false)}
          onConfirm={() => install.mutate(undefined, { onSettled: () => setAsking(false) })}
        >
          <ul className="list-disc space-y-1 pl-5">
            <li>Creates the agents above, all switched OFF. Anything that already exists is left exactly as it is.</li>
            <li>Switches web reading on only for the new Researcher, Lead Scout and Site Auditor.</li>
            <li>Adds the agents to the Manager&apos;s specialists (nobody is removed), and creates three skills and one workflow (off).</li>
            <li>Runs nothing, contacts nothing and sends nothing.</li>
          </ul>
        </ConfirmDialog>
      )}
    </section>
  );
}

function Batches() {
  const batches = useStagedBatches();
  const [open, setOpen] = useState<string | null>(null);
  const preview = useStagedBatch(open);
  const list = batches.data ?? [];
  return (
    <section aria-labelledby="batches-heading" className="card space-y-3">
      <div>
        <h2 id="batches-heading" className="text-lg font-semibold">
          Found, not saved yet
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          What agents found is held in memory only. Saving needs your approval on the{" "}
          <Link to="/approvals" className="underline">
            Approvals
          </Link>{" "}
          page, and the approval covers exactly these rows: if they change afterwards, nothing is saved.
        </p>
      </div>
      {list.length === 0 && <p className="hint">Nothing is waiting.</p>}
      <ul className="space-y-2">
        {list.map((b) => (
          <li key={b.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">
                  {b.label} <span className="hint">({b.id})</span>
                </p>
                <p className="hint">
                  {b.count} businesses · {Object.entries(b.states).map(([k, n]) => `${k.replace(/_/g, " ")}: ${n}`).join(", ")}
                </p>
                <p className="hint font-mono [overflow-wrap:anywhere]">rows fingerprint {b.rowsHash.slice(0, 16)}…</p>
              </div>
              <button type="button" className="btn-secondary min-h-11" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                {open === b.id ? "Hide" : "Preview"}
              </button>
            </div>
            {open === b.id && (
              <ul className="mt-2 space-y-1 text-sm">
                {(preview.data?.leads ?? []).map((l) => (
                  <li key={l.lead_id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium [overflow-wrap:anywhere]">{l.business_name}</span>
                    <span className="hint">
                      {l.priority || "-"} {l.lead_score ?? "–"}
                    </span>
                    <span className="hint">{websiteChip(l).text}</span>
                  </li>
                ))}
                {preview.isPending && <li role="status">Loading…</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Leads() {
  const status = useBusinessStatus();
  const [priority, setPriority] = useState("");
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const leads = useBusinessLeads({ priority, status: state, q });
  const statuses = status.data?.statuses ?? [];
  return (
    <section aria-labelledby="leads-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="leads-heading" className="text-lg font-semibold">
          Saved leads
        </h2>
        <a className="btn-secondary min-h-11" href="/api/business/leads.xlsx" download="leads.xlsx">
          Download as Excel
        </a>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input type="search" aria-label="Search leads" placeholder="Search by name, city or phone" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11" />
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="min-h-11">
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select aria-label="Status" value={state} onChange={(e) => setState(e.target.value)} className="min-h-11">
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      {leads.isPending && <p role="status">Loading…</p>}
      {leads.isError && <Alert error="Could not load the leads." />}
      {leads.data && leads.data.total === 0 && (
        <p className="card text-sm text-slate-600 dark:text-slate-400">
          {priority || state || q ? "No lead matches these filters." : "No leads saved yet. When an agent finds businesses and you approve saving them, they appear here."}
        </p>
      )}
      <ul className="space-y-3">
        {(leads.data?.leads ?? []).map((l) => (
          <LeadCard key={l.lead_id} lead={l} statuses={statuses} />
        ))}
      </ul>
      {leads.data && leads.data.total > leads.data.leads.length && <p className="hint">Showing {leads.data.leads.length} of {leads.data.total}. Narrow the filters to see others.</p>}
    </section>
  );
}

function Rubric() {
  const status = useBusinessStatus();
  const s = status.data;
  if (!s) return null;
  return (
    <details className="card text-sm">
      <summary className="cursor-pointer font-semibold">How scores work</summary>
      <div className="mt-3 space-y-3">
        <p>The lead score (0 to 100) is calculated by the app from this table. No AI model decides it, and every lead shows its own points.</p>
        <ul className="space-y-2">
          {s.rubric.rows.map((r) => (
            <li key={r.id}>
              <span className="font-medium">
                {r.label} (up to {r.max})
              </span>
              <span className="hint block">{r.rule}</span>
            </li>
          ))}
        </ul>
        <p>{s.rubric.priorityRule}</p>
        <p>
          Three situations are never mixed: <strong>no website listed</strong> (unverified: a person must check), <strong>check failed</strong> (says nothing about quality: check by hand), and <strong>checked</strong> (a quality score).
        </p>
        <p className="hint">{s.markets[0]?.note}</p>
      </div>
    </details>
  );
}

export function Business() {
  const status = useBusinessStatus();
  const s = status.data;
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Business Workforce</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Find small businesses in {s?.markets[0]?.name ?? "the UAE"}, check their websites, score them openly, and prepare English proposals for your approval. Leads are kept in{" "}
          <span className="font-mono">{s?.storage.dir ?? "workspace/business-workforce/leads"}/{s?.storage.file ?? "leads.csv"}</span>. Nothing is ever sent, published or bought without you.
        </p>
      </div>
      <OutsideRequests />
      <Team />
      <Batches />
      <Leads />
      <Rubric />
    </div>
  );
}
