import { useRefreshTools, useTools } from "../api/hooks";
import type { ToolInfo } from "../api/types";

const CHIP: Record<ToolInfo["status"], { text: string; style: string }> = {
  available: { text: "Available", style: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  needs_setup: { text: "Needs setup", style: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  unavailable: { text: "Not available", style: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
};

/** Settings > Tools. An honest list of what this platform can really do right now, and why anything is missing. */
export function ToolsSection() {
  const tools = useTools();
  const refresh = useRefreshTools();
  const list = tools.data ?? [];
  const groups = [...new Set(list.map((t) => t.category))];

  return (
    <section aria-label="Tools" className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Tools</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            What the platform can really do right now. Bots and the Manager are told what is missing, so nothing is ever pretended. Connections such as Gmail are switched on per bot on its Permissions tab.
          </p>
        </div>
        <button className="btn-secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Checking…" : "Check again"}
        </button>
      </div>
      {tools.isError && <p role="alert">Could not load the tool list.</p>}
      {groups.map((g) => (
        <div key={g} className="space-y-1">
          <h3 className="text-sm font-semibold capitalize">{g}</h3>
          <ul className="space-y-1">
            {list
              .filter((t) => t.category === g)
              .map((t) => (
                <li key={t.id} aria-label={`Tool ${t.name}`} className="flex flex-wrap items-start justify-between gap-2 border-t border-slate-200 pt-1 first:border-0 dark:border-slate-800">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    <p className="hint [overflow-wrap:anywhere]">{t.detail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[t.status].style}`}>{CHIP[t.status].text}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
