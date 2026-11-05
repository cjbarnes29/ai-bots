import { Link } from "react-router-dom";
import { useExternalStatus, useMonitor, useProviders, useWorkflows } from "../api/hooks";
import type { ActivityLevel } from "../api/types";
import { AiOverview } from "../components/AiOverview";
import { DemoCard } from "../components/DemoCard";
import { Panel, StackedBar, StatCard, StatusDot, type Tone } from "../components/ui/Stats";

const RUN_WORD: Record<string, string> = { queued: "waiting its turn", running: "running", waiting: "waiting for you", completed: "finished", failed: "failed", cancelled: "cancelled", interrupted: "interrupted by a restart" };

const LEVEL_STYLE: Record<ActivityLevel, string> = {
  info: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const LEVEL_WORD: Record<ActivityLevel, string> = { info: "Info", warn: "Look", error: "Problem" };
const DAY_MS = 24 * 3_600_000;

/** A coloured dot AND a word, so the state never depends on colour alone. */
function HealthRow({ label, state, tone, to }: { label: string; state: string; tone: Tone; to: string }) {
  return (
    <li>
      <Link to={to} className="awp-hover flex min-h-11 items-center gap-3 rounded-md px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
        <StatusDot tone={tone} />
        <span className="flex-1 text-sm">{label}</span>
        <span className="text-sm font-medium">{state}</span>
      </Link>
    </li>
  );
}

const dash = "–";

export function Dashboard() {
  const monitor = useMonitor();
  const providers = useProviders();
  const external = useExternalStatus();
  const workflows = useWorkflows();
  const m = monitor.data;
  const ext = external.data;

  // The built-in simulated provider is never counted as a connected AI.
  const connectable = (providers.data ?? []).filter((p) => p.connectable && !p.simulated);
  const connected = connectable.filter((p) => p.status === "connected");
  const lastTest = connected.map((p) => p.lastCheckedAt).filter((v): v is string => Boolean(v)).sort().at(-1);

  const connectors = ext?.connectors ?? [];
  const setUp = connectors.filter((c) => !c.notReady).length;

  const now = Date.now();
  const runs = workflows.data?.runs ?? [];
  const wfRunning = runs.filter((r) => ["queued", "running", "waiting"].includes(r.status)).length;
  const recent = runs.filter((r) => now - new Date(r.createdAt).getTime() < DAY_MS);
  const wfDone = recent.filter((r) => r.status === "completed").length;
  const wfFailed = recent.filter((r) => r.status === "failed").length;
  const wfWaiting = workflows.data?.waiting.length ?? 0;

  const failed24 = m ? m.tasks.failed24h + m.approvals.failed24h + wfFailed : null;
  const pending = ext?.pendingCount ?? m?.approvals.pending ?? null;
  const gettingStarted = m !== undefined && providers.data !== undefined && (connected.length === 0 || m.bots.total === 0);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">What your AI workforce is doing right now.</p>
      </div>

      {monitor.isError && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          Could not load the overview. The cards below fill in when the server answers.
        </p>
      )}

      {gettingStarted && (
        <section aria-labelledby="start-heading" className="card space-y-3">
          <h2 id="start-heading" className="text-lg font-semibold">
            Get started
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              {connected.length > 0 ? "Done: " : ""}
              <Link to="/settings/ai-models" className="underline">
                Connect an AI model
              </Link>{" "}
              (a free provider key, then Test connection).
              <span className="hint block">No key yet? Use the "Try it without an AI account" card below: a simulated AI lets you explore everything.</span>
            </li>
            <li>
              {m && m.bots.total > 0 ? "Done: " : ""}
              <Link to="/agents" className="underline">
                Create your first agent
              </Link>
              .
            </li>
            <li>
              <Link to="/tasks" className="underline">
                Give it a task
              </Link>{" "}
              and watch it work.
            </li>
          </ol>
        </section>
      )}

      <section aria-labelledby="attention-heading" className="space-y-2">
        <h2 id="attention-heading" className="text-lg font-semibold">
          Needs your attention
        </h2>
        {!m ? (
          <p role="status" className="hint">
            Loading…
          </p>
        ) : m.attention.length === 0 ? (
          <p className="rounded-md bg-green-100 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">Everything looks fine. Nothing needs you right now.</p>
        ) : (
          <ul className="space-y-2">
            {m.attention.map((a) => (
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
          At a glance
        </h2>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Agents" to="/agents" value={m ? m.bots.active : dash} hint={m ? `${m.bots.total} in total, ${m.bots.archived} archived` : undefined} />
          <StatCard title="Tasks in progress" to="/tasks" value={m ? m.tasks.running : dash} hint={m ? `${m.tasks.completed24h} finished, ${m.tasks.failed24h} failed (24 h)` : undefined} />
          <StatCard
            title="Workflows"
            to="/workflows"
            value={workflows.data ? `${wfRunning} running` : dash}
            tone={wfWaiting > 0 ? "warn" : "idle"}
            hint={workflows.data ? `${wfDone} finished, ${wfFailed} failed (24 h)${wfWaiting > 0 ? ` · ${wfWaiting} waiting for you` : ""}` : undefined}
          />
          <StatCard
            title="Waiting for approval"
            to="/approvals"
            value={pending ?? dash}
            tone={pending ? "warn" : "idle"}
            hint={m ? `${m.approvals.executed24h} done, ${m.approvals.denied24h} denied (24 h)` : undefined}
          />
          <StatCard title="Failures (24 h)" to="/monitor" value={failed24 ?? dash} tone={failed24 ? "bad" : "idle"} hint="Tasks, outside actions and workflows" />
          <StatCard
            title="AI providers"
            to="/settings/ai-models"
            value={providers.data ? `${connected.length} of ${connectable.length} connected` : dash}
            tone={providers.data && connected.length === 0 ? "warn" : "idle"}
            hint={
              providers.data
                ? connected.length > 0 && lastTest
                  ? `Last successful test ${new Date(lastTest).toLocaleString()}`
                  : "Connected only after a test call succeeds"
                : undefined
            }
          />
          <StatCard
            title="Integrations"
            to="/integrations"
            value={ext ? `${setUp} of ${connectors.length} set up` : dash}
            hint="Set up means the sign-in or key is saved"
          />
          <StatCard
            title="AI calls today"
            to="/settings/ai-models"
            value={m ? m.ai.callsToday : dash}
            tone={m && m.ai.errorsToday > 0 ? "warn" : "idle"}
            hint={m ? `${m.ai.tokensToday.toLocaleString()} tokens · ${m.ai.errorsToday} failed` : undefined}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          id="exec-heading"
          title="Task execution (24 h)"
          action={
            <Link to="/tasks" className="text-sm underline">
              All tasks
            </Link>
          }
        >
          <div className="card space-y-2">
            {m ? (
              <StackedBar
                label="Tasks in the last 24 hours"
                empty="No task has run in the last 24 hours."
                parts={[
                  { label: "finished", value: m.tasks.completed24h, tone: "ok" },
                  { label: "failed", value: m.tasks.failed24h, tone: "bad" },
                  { label: "running now", value: m.tasks.running, tone: "idle" },
                ]}
              />
            ) : (
              <p className="hint">Loading…</p>
            )}
            {m && m.tasks.running > 0 && (
              <p className="flex items-center gap-2 text-sm">
                <StatusDot tone="ok" live />
                {m.tasks.running} task{m.tasks.running === 1 ? " is" : "s are"} working right now.
              </p>
            )}
          </div>
        </Panel>

        <Panel
          id="apps-heading"
          title="Application connections"
          action={
            <Link to="/integrations" className="text-sm underline">
              Integrations Center
            </Link>
          }
        >
          {!ext ? (
            <p className="hint">Loading…</p>
          ) : connectors.length === 0 ? (
            <p className="hint">No outside service is available.</p>
          ) : (
            <ul className="card grid gap-x-6 py-2 sm:grid-cols-2">
              {connectors.slice(0, 8).map((c) => (
                <li key={c.id} className="flex min-h-9 items-center gap-2 text-sm">
                  <StatusDot tone={c.notReady ? "idle" : "ok"} />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-slate-600 dark:text-slate-400">{c.notReady ? "Not set up" : "Set up"}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <AiOverview />
      <DemoCard compact />

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="quick-heading" className="space-y-2">
          <h2 id="quick-heading" className="text-lg font-semibold">
            Quick actions
          </h2>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <Link to="/agents" className="btn-secondary min-h-11">
              New agent
            </Link>
            <Link to="/tasks" className="btn-secondary min-h-11">
              Give a task
            </Link>
            <Link to="/workflows" className="btn-secondary min-h-11">
              New workflow
            </Link>
            <Link to="/integrations" className="btn-secondary min-h-11">
              Connect a service
            </Link>
          </div>
        </section>

        <section aria-labelledby="health-heading" className="space-y-2">
          <h2 id="health-heading" className="text-lg font-semibold">
            System health
          </h2>
          <ul className="card divide-y divide-slate-200 py-2 dark:divide-slate-800">
            <HealthRow label="AI calls" to="/settings/ai-models" state={!m ? dash : m.ai.paused ? "Paused" : "Running"} tone={!m ? "idle" : m.ai.paused ? "bad" : "ok"} />
            <HealthRow label="Outside actions (Gmail, browser…)" to="/approvals" state={!ext ? dash : ext.paused ? "Paused" : "Need approval"} tone={!ext ? "idle" : ext.paused ? "bad" : "ok"} />
            <HealthRow label="Schedules and triggers" to="/automation" state={!m ? dash : m.automation.paused ? "Paused" : `${m.automation.schedulesOn} on`} tone={!m ? "idle" : m.automation.paused ? "bad" : "ok"} />
            <HealthRow label="Free-only mode" to="/settings/ai-models" state="On (locked)" tone="ok" />
            <HealthRow
              label="Phone access"
              to="/pc"
              state={!m ? dash : m.devices.remoteEnabled ? `On, ${m.devices.paired} paired` : "Off"}
              tone="idle"
            />
          </ul>
        </section>
      </div>

      <section aria-labelledby="runs-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="runs-heading" className="text-lg font-semibold">
            Recent workflow runs
          </h2>
          <Link to="/workflows" className="text-sm underline">
            All workflows
          </Link>
        </div>
        {workflows.data && runs.length === 0 && <p className="hint">No workflow has run yet.</p>}
        <ul className="space-y-1">
          {runs.slice(0, 5).map((run) => {
            const failedBox = run.steps.find((x) => x.status === "failed");
            return (
              <li key={run.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link to="/workflows" className="underline">
                  {run.workflowName}
                </Link>
                <span className={run.status === "failed" ? "font-semibold text-red-700 dark:text-red-300" : "font-medium"}>{RUN_WORD[run.status] ?? run.status}</span>
                {failedBox && <span className="hint">at "{failedBox.label || failedBox.nodeId}"</span>}
                {run.steps.some((x) => x.output?.startsWith("[SIMULATED RESPONSE")) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Simulated AI</span>}
                <span className="hint">{new Date(run.createdAt).toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="activity-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="activity-heading" className="text-lg font-semibold">
            Recent activity
          </h2>
          <Link to="/monitor" className="text-sm underline">
            See all activity
          </Link>
        </div>
        {m && m.activity.length === 0 && <p className="hint">Nothing has happened yet.</p>}
        <ul className="space-y-1">
          {(m?.activity ?? []).slice(0, 8).map((a, i) => (
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
