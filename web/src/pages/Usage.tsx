import { useState } from "react";
import { ApiError } from "../api/client";
import { useLlmStatus, useUsage } from "../api/hooks";
import type { UsageTotals } from "../api/types";

function Meter({ label, used, limit }: { label: string; used: number; limit: number | undefined }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <li className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit?.toLocaleString() ?? "?"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? 0}
        className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div className={`h-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function Totals({ title, totals }: { title: string; totals: UsageTotals }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-600 dark:text-slate-400">{title}</p>
      <p className="mt-1 text-2xl font-bold">{totals.requests.toLocaleString()}</p>
      <p className="text-xs text-slate-500">requests · {totals.tokens.toLocaleString()} tokens</p>
    </div>
  );
}

export function Usage() {
  const [days, setDays] = useState(14);
  const usage = useUsage(days);
  const status = useLlmStatus();
  const limits = status.data?.limits;

  if (usage.isPending) return <p role="status">Loading usage…</p>;
  if (usage.isError) {
    return (
      <p role="alert" className="card">
        {usage.error instanceof ApiError ? usage.error.friendly : "Could not load usage."}
      </p>
    );
  }
  const u = usage.data;
  const cost = u.reportedCostMicroThisMonth / 1_000_000;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Usage</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="usage-days" className="text-sm">
            Show the last
          </label>
          <select id="usage-days" className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Totals title="Today, all providers" totals={u.today} />
        <Totals title="Today, cloud only" totals={u.todayCloud} />
        <Totals title="This month, all providers" totals={u.month} />
        <Totals title="This month, cloud only" totals={u.monthCloud} />
      </div>

      <section aria-label="Cost" className="card">
        <p className="font-medium">Cost reported by providers this month: ${cost.toFixed(4)}</p>
        {cost > 0 ? (
          <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">
            A provider reported a charge. The affected model was blocked automatically. Check that provider's account.
          </p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">Free-only mode is on, so this should always stay at $0.</p>
        )}
      </section>

      <section aria-label="Limits used" className="card space-y-3">
        <h2 className="font-semibold">Cloud limits used</h2>
        <ul className="space-y-3">
          <Meter label="Requests today (all bots)" used={u.todayCloud.requests} limit={limits?.["globalDailyRequests"]} />
          <Meter label="Tokens today (all bots)" used={u.todayCloud.tokens} limit={limits?.["globalDailyTokens"]} />
          <Meter label="Requests this month (all bots)" used={u.monthCloud.requests} limit={limits?.["globalMonthlyRequests"]} />
          <Meter label="Tokens this month (all bots)" used={u.monthCloud.tokens} limit={limits?.["globalMonthlyTokens"]} />
        </ul>
      </section>

      <section aria-label="By day" className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">By day</h2>
        {u.byDay.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No calls yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-4">Day</th>
                <th className="pr-4">Succeeded</th>
                <th className="pr-4">Failed</th>
                <th className="pr-4">Blocked</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {u.byDay.map((d) => (
                <tr key={d.day} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="py-1 pr-4">{d.day}</td>
                  <td className="pr-4">{d.ok}</td>
                  <td className="pr-4">{d.errors}</td>
                  <td className="pr-4">{d.blocked}</td>
                  <td>{d.tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="By bot" className="card">
          <h2 className="mb-2 font-semibold">By bot, this month</h2>
          {u.byBot.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No calls yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {u.byBot.map((b) => (
                <li key={b.botId ?? "none"} className="flex justify-between">
                  <span>{b.botName}</span>
                  <span>
                    {b.requests} requests · {b.tokens.toLocaleString()} tokens
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="By model" className="card">
          <h2 className="mb-2 font-semibold">By model, this month</h2>
          {u.byModel.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No calls yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {u.byModel.map((m) => (
                <li key={`${m.providerId}/${m.modelId}`} className="flex justify-between gap-3">
                  <span className="break-all">
                    {m.providerId}/{m.modelId}
                  </span>
                  <span className="shrink-0">
                    {m.requests} requests · {m.tokens.toLocaleString()} tokens{m.errors ? ` · ${m.errors} failed` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Recent problems" className="card">
        <h2 className="mb-2 font-semibold">Recent problems</h2>
        {u.recentProblems.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No failed or blocked calls.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {u.recentProblems.map((p, i) => (
              <li key={i}>
                <span className={p.status === "error" ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-amber-700 dark:text-amber-300"}>
                  {p.status === "error" ? "Failed" : "Blocked"}
                </span>{" "}
                {p.errorCode ?? "unknown"} · {p.providerId}/{p.modelId}
                {p.botName ? ` · ${p.botName}` : ""}
                <span className="text-slate-500"> · {new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
