import { useMemo, useState } from "react";
import { useNarrow } from "../lib/useNarrow";
import { LEVEL_ORDER, useCapabilities, useCapabilityChanges, useRescanCapabilities, useVmReadiness, type CapState, type Capability, type LevelState } from "../api/capabilityHooks";

/**
 * Capabilities: the live answer to "what can the workforce do right now?". Nothing on this page is a hand-kept list: it is drawn from the registry,
 * which reads the services that own each tool, connection, AI model, agent and workflow. Registered does NOT mean working: each item shows six
 * separate levels, and a level only says "yes" when there is evidence for it.
 */
const STATE_LABEL: Record<CapState, string> = { available: "Working", unverified: "Set up, not proven", partial: "Partly working", needs_setup: "Needs setting up", unavailable: "Not available" };
const STATE_STYLE: Record<CapState, string> = {
  available: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  unverified: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  needs_setup: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  unavailable: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
};
const GROUP_LABEL: Record<Capability["group"], string> = { tool: "Tools and programs", integration: "Connected services", model: "AI models", agent: "Agents", workflow: "Workflows", permission: "Permissions and safety", authentication: "Sign-in", environment: "This PC and environment" };
const LEVEL_MARK: Record<LevelState, string> = { yes: "yes", no: "no", unknown: "not known", "n/a": "not needed" };
const LEVEL_STYLE: Record<LevelState, string> = {
  yes: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  no: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  unknown: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  "n/a": "bg-transparent text-slate-500 ring-1 ring-slate-300 dark:text-slate-400 dark:ring-slate-600",
};
const COST_LABEL: Record<string, string> = { free: "Free", free_with_limits: "Free, with limits", local: "On this PC", paid: "Paid (blocked)", simulated: "Simulated", unknown: "Cost unknown", not_applicable: "No cost" };

/**
 * One capability. Closed, it is a single 44 px row: the name and what state it is in. Open, it shows why, the six evidence levels, and what is missing or needs you.
 * On phones the entries start closed so the page is short; on wider screens they start open. "Expand all" and "Collapse all" override that.
 */
function Card({ c, open }: { c: Capability; open: boolean }) {
  return (
    <li aria-label={c.name}>
      <details open={open} className="card group p-0">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
          <span aria-hidden="true" className="text-slate-500 transition-transform group-open:rotate-90">›</span>
          <h3 className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{c.name}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.state]}`}>{STATE_LABEL[c.state]}</span>
        </summary>
        <div className="space-y-2 border-t border-slate-200 px-3 pb-3 pt-2 dark:border-slate-700">
          <p className="hint text-xs">{COST_LABEL[c.cost] ?? c.cost}</p>
          <p className="text-sm [overflow-wrap:anywhere]">{c.stateReason}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Evidence levels for ${c.name}`}>
            {LEVEL_ORDER.map((l) => (
              <li key={l} title={c.levels[l].evidence} className={`rounded px-2 py-0.5 text-xs ${LEVEL_STYLE[c.levels[l].state]}`}>
                {l}: {LEVEL_MARK[c.levels[l].state]}
              </li>
            ))}
          </ul>
          {c.missing.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">What is missing</p>
              <ul className="list-disc pl-5">{c.missing.map((m) => <li key={m} className="[overflow-wrap:anywhere]">{m}</li>)}</ul>
            </div>
          )}
          {c.needsOwner.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">What needs you</p>
              <ul className="list-disc pl-5">{c.needsOwner.map((m) => <li key={m} className="[overflow-wrap:anywhere]">{m}</li>)}</ul>
            </div>
          )}
          {c.limits.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Limits</p>
              <ul className="list-disc pl-5">{c.limits.map((m) => <li key={m} className="[overflow-wrap:anywhere]">{m}</li>)}</ul>
            </div>
          )}
          <details>
            <summary className="min-h-11 cursor-pointer text-sm underline">The evidence behind each level</summary>
            <dl className="hint text-xs">
              {LEVEL_ORDER.map((l) => (
                <div key={l}>
                  <dt className="inline font-medium">{l}: </dt>
                  <dd className="inline [overflow-wrap:anywhere]">{c.levels[l].evidence}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </details>
    </li>
  );
}

/** Desktop agent and VM readiness: a read-only checklist. Nothing here creates, installs or changes anything; steps that would need your approval say so. */
function VmReadinessCard() {
  const q = useVmReadiness();
  if (!q.data) return null;
  const v = q.data;
  const MARK = { met: "Done", not_done: "Not done", unknown: "Not known" } as const;
  return (
    <section aria-label="Desktop and VM readiness" className="card space-y-2">
      <h2 className="text-lg font-semibold">Desktop and VM readiness</h2>
      <p role="status" className="text-sm">{v.summary}</p>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm underline">The {v.steps.length} steps and what each needs</summary>
        <ul className="space-y-2 pt-1 text-sm">
          {v.steps.map((s) => (
            <li key={s.id} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{MARK[s.state]}:</span> {s.title}
              {s.needsOwnerApproval && <span className="hint"> (needs your separate approval)</span>}
              <p className="hint text-xs">{s.evidence} Where: {s.where}</p>
            </li>
          ))}
        </ul>
        <p className="hint pt-2 text-xs">{v.sizing.note}</p>
        <p className="pt-2 text-sm font-medium">Order of approvals</p>
        <ol className="list-decimal pl-5 text-sm">{v.approvalOrder.map((a) => <li key={a}>{a.replace(/^\d+ /, "")}</li>)}</ol>
      </details>
    </section>
  );
}

export function Capabilities() {
  const q = useCapabilities();
  const changes = useCapabilityChanges();
  const rescan = useRescanCapabilities();
  const [state, setState] = useState<CapState | "all">("all");
  const [group, setGroup] = useState<Capability["group"] | "all">("all");
  const narrow = useNarrow();
  /** auto = phones start closed and wide screens open; the buttons override it until the next choice. */
  const [fold, setFold] = useState<"auto" | "open" | "closed">("auto");
  const cardsOpen = fold === "open" || (fold === "auto" && !narrow);
  const groupsOpen = fold === "open" || (fold === "auto" && !narrow);

  const shown = useMemo(() => (q.data?.capabilities ?? []).filter((c) => (state === "all" || c.state === state) && (group === "all" || c.group === group)), [q.data, state, group]);
  const groups = useMemo(() => {
    const m = new Map<Capability["group"], Capability[]>();
    for (const c of shown) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Capabilities</h1>
        <p className="hint">What the AI Workforce can really do right now. New tools, services, AI models, agents and workflows appear here by themselves. “Set up” is not “working”: each item shows six checks, and a check only says yes when there is evidence.</p>
      </div>

      {q.isLoading && <p role="status">Loading…</p>}
      {q.isError && <p role="alert" className="card">Could not load the capability list. Try again in a moment.</p>}

      {q.data && (
        <>
          <section aria-label="Summary" className="card space-y-2">
            <p role="status">{q.data.summary.headline}</p>
            <p className="hint text-xs">Checked {new Date(q.data.checkedAt).toLocaleTimeString()}. Everything runs under your supervision until the Guardian’s system-level part (Tier B) is built and verified; anything that sends or saves outside still waits for your approval.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm">
                Show{" "}
                <select className="min-h-11 rounded border px-2" value={state} onChange={(e) => setState(e.target.value as CapState | "all")}>
                  <option value="all">Everything</option>
                  {(Object.keys(STATE_LABEL) as CapState[]).map((s) => (
                    <option key={s} value={s}>
                      {STATE_LABEL[s]} ({q.data.summary.byState[s]})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Kind{" "}
                <select className="min-h-11 rounded border px-2" value={group} onChange={(e) => setGroup(e.target.value as Capability["group"] | "all")}>
                  <option value="all">All kinds</option>
                  {(Object.keys(GROUP_LABEL) as Capability["group"][]).map((g) => (
                    <option key={g} value={g}>
                      {GROUP_LABEL[g]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
                {rescan.isPending ? "Checking…" : "Check again now"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setFold("open")}>
                Expand all
              </button>
              <button type="button" className="btn-secondary" onClick={() => setFold("closed")}>
                Collapse all
              </button>
            </div>
          </section>

          {groups.length === 0 && <p className="hint">Nothing matches that filter.</p>}
          {groups.map(([g, items]) => {
            const working = items.filter((c) => c.state === "available").length;
            const attention = items.length - working;
            return (
              <section key={`${g}:${fold}`} aria-label={GROUP_LABEL[g]}>
                <details open={groupsOpen} className="space-y-2">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2">
                    <h2 className="text-lg font-semibold">{GROUP_LABEL[g]}</h2>
                    <span className="hint text-sm">
                      {items.length} · {working} working{attention > 0 ? ` · ${attention} not fully working` : ""}
                    </span>
                  </summary>
                  <ul className="grid gap-2 pt-2 lg:grid-cols-2">{items.map((c) => <Card key={`${c.id}:${fold}`} c={c} open={cardsOpen} />)}</ul>
                </details>
              </section>
            );
          })}

          <VmReadinessCard />

          <section aria-label="Recent changes" className="card space-y-2">
            <h2 className="text-lg font-semibold">Recent changes</h2>
            {(changes.data ?? []).filter((c) => c.kind === "capability.changed").length === 0 ? (
              <p className="hint text-sm">No change has been noticed yet. When something is added, removed, set up, signed in or starts failing, it is listed here.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(changes.data ?? [])
                  .filter((c) => c.kind === "capability.changed")
                  .map((row) => (
                    <li key={row.id}>
                      <p className="hint text-xs">{new Date(row.at).toLocaleString()}</p>
                      <ul className="list-disc pl-5">
                        {(row.detail.changes ?? []).map((c) => (
                          <li key={`${row.id}:${c.id}`} className="[overflow-wrap:anywhere]">
                            {c.kind === "added" && <>New: {c.name}</>}
                            {c.kind === "removed" && <>Gone: {c.name}</>}
                            {c.kind === "changed" && (
                              <>
                                {c.name}: {c.aspects.join(", ")} changed ({c.from ? STATE_LABEL[c.from as CapState] : "?"} → {c.to ? STATE_LABEL[c.to as CapState] : "?"})
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
