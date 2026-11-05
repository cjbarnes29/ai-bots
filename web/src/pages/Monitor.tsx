import { useState } from "react";
import { Link } from "react-router-dom";
import { useMonitor } from "../api/hooks";
import type { ActivityLevel, MonitorOverview } from "../api/types";
import { ActivityLog, Resources, RunningWork } from "../components/MonitorViews";
import { TabPanel, Tabs } from "../components/ui/Tabs";

const LEVEL_STYLE: Record<ActivityLevel, string> = {
  info: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const LEVEL_WORD: Record<ActivityLevel, string> = { info: "Info", warn: "Look", error: "Problem" };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card space-y-1">
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

type TabId = "overview" | "log" | "running" | "resources";
const PANEL_LABEL: Record<TabId, string> = { overview: "Overview", log: "Activity log", running: "Running work", resources: "Resources" };

export function Monitor() {
  const monitor = useMonitor();
  const o = monitor.data;
  const [tab, setTab] = useState<TabId>("overview");
  if (monitor.isError) return <p role="alert">Could not load the overview.</p>;
  if (!o) return <p role="status">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity &amp; Logs</h1>
      <Tabs
        label="Activity views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "log", label: "Activity log", badge: o.activity.length || undefined },
          { id: "running", label: "Running work", badge: o.tasks.running || undefined },
          { id: "resources", label: "Resources" },
        ]}
      />
      <TabPanel label={PANEL_LABEL[tab]}>
        {tab === "overview" && <Overview o={o} />}
        {tab === "log" && <ActivityLog o={o} />}
        {tab === "running" && <RunningWork />}
        {tab === "resources" && <Resources o={o} />}
      </TabPanel>
    </div>
  );
}

function Overview({ o }: { o: MonitorOverview }) {
  return (
    <div className="space-y-8">

      <section aria-labelledby="attention-heading" className="space-y-2">
        <h2 id="attention-heading" className="text-lg font-semibold">
          Needs your attention
        </h2>
        {o.attention.length === 0 ? (
          <p className="rounded-md bg-green-100 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">Everything looks fine. Nothing needs you right now.</p>
        ) : (
          <ul className="space-y-2">
            {o.attention.map((a) => (
              <li key={a.text} className={`rounded-md p-3 text-sm font-medium ${LEVEL_STYLE[a.level]}`}>
                {a.link ? (
                  <Link to={a.link} className="underline">
                    {a.text}
                  </Link>
                ) : (
                  a.text
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="numbers-heading" className="space-y-2">
        <h2 id="numbers-heading" className="text-lg font-semibold">
          Right now
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Bots" value={o.bots.total} hint={`${o.bots.archived} archived`} />
          <Stat label="Tasks running" value={o.tasks.running} hint={`${o.tasks.completed24h} done, ${o.tasks.failed24h} failed (24 h)`} />
          <Stat label="Waiting for approval" value={o.approvals.pending} hint={`${o.approvals.executed24h} done, ${o.approvals.denied24h} denied (24 h)`} />
          <Stat label="AI calls today" value={o.ai.callsToday} hint={`${o.ai.tokensToday.toLocaleString()} tokens · ${o.ai.errorsToday} failed${o.ai.paused ? " · PAUSED" : ""}`} />
          <Stat label="Schedules on" value={o.automation.schedulesOn} hint={`${o.automation.runsToday} automatic runs today${o.automation.paused ? " · PAUSED" : ""}`} />
          <Stat label="Triggers on" value={o.automation.triggersOn} />
          <Stat label="Phones paired" value={o.devices.paired} hint={o.devices.remoteEnabled ? "Phone access is on" : "Phone access is off"} />
          <Stat label="Refused AI calls today" value={o.ai.blockedToday} hint="Stopped by limits or safety rules" />
        </div>
      </section>

      <section aria-labelledby="activity-heading" className="space-y-2">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Recent activity
        </h2>
        {o.activity.length === 0 && <p className="hint">Nothing has happened yet.</p>}
        <ul className="space-y-1">
          {o.activity.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex flex-wrap items-start gap-2 text-sm">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[a.level]}`}>{LEVEL_WORD[a.level]}</span>
              <span className="hint shrink-0">{new Date(a.at).toLocaleString()}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {a.link ? (
                  <Link to={a.link} className="underline">
                    {a.summary}
                  </Link>
                ) : (
                  a.summary
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
