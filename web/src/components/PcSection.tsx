import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAddWorkspace, usePc, usePcResume, usePcStop, useRemoveWorkspace, useStopServer } from "../api/hooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const STATUS: Record<string, string> = { ok: "worked", failed: "failed", timeout: "timed out", stopped: "stopped", refused: "refused" };

/** PC Control Center > PC agent. Where bots may work on this computer, the emergency stop, what is running, and a log of everything that ran. */
export function PcSection() {
  const pc = usePc();
  const add = useAddWorkspace();
  const remove = useRemoveWorkspace();
  const stop = usePcStop();
  const resume = usePcResume();
  const stopServer = useStopServer();
  const [path, setPath] = useState("");
  const d = pc.data;
  if (!d) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim()) add.mutate(path.trim(), { onSuccess: () => setPath("") });
  };

  return (
    <section aria-label="PC agent" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">PC agent (PowerShell tools)</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Lets chosen bots work on this computer: look at files, write code, run approved developer commands (node, npm, git, python) and install packages. Bots can only work inside the <strong>workspace folders</strong> you
          list below. Each bot needs its own permissions (READ, EXECUTE, MODIFY, INSTALL on its Permissions tab), and everything that changes something waits for your approval and shows the exact command.
          Administrator access does not exist.
        </p>
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md p-3 ${d.stopped ? "bg-red-100 dark:bg-red-950" : "bg-slate-100 dark:bg-slate-800"}`}>
        <p className="text-sm font-medium">{d.stopped ? "STOPPED: nothing can run on this PC until you resume." : "Running normally."}</p>
        <div className="flex gap-2">
          <button className="btn-danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Emergency stop
          </button>
          {d.stopped && (
            <button className="btn-primary" disabled={resume.isPending} onClick={() => resume.mutate()}>
              Resume
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Workspace folders</h3>
        {d.roots.length === 0 && <p className="hint">None yet, so bots cannot touch this PC at all.</p>}
        <ul className="space-y-1">
          {d.roots.map((r) => (
            <li key={r} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-mono [overflow-wrap:anywhere]">{r}</span>
              <button className="underline" onClick={() => remove.mutate(r)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-sm">
            <span className="label">Add a folder (full path)</span>
            <input aria-label="Workspace folder path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\you\Projects\my-app" className="w-full font-mono" />
          </label>
          <button className="btn-primary" disabled={!path.trim() || add.isPending}>
            Add folder
          </button>
        </form>
        <p className="hint">Not allowed: a whole drive, your whole user folder, Windows or Program Files, and this app's own folders. Files that hold secrets (.env, keys, databases) are always off limits.</p>
      </div>

      {d.servers.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Programs kept running</h3>
          <ul className="space-y-1 text-sm">
            {d.servers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {s.command} · <span className="font-mono [overflow-wrap:anywhere]">{s.cwd}</span> · stops by itself at {new Date(s.expiresAt).toLocaleTimeString()}
                </span>
                <button className="btn-secondary" onClick={() => stopServer.mutate(s.id)}>
                  Stop
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="font-semibold">This PC right now</h3>
        <p className="text-sm">
          CPU {d.resources.cpuPercent}% busy · memory {d.resources.memoryUsedPercent}% of {d.resources.memoryGb} GB · {d.resources.cpuThreads} threads
          {d.resources.localAi ? ` · local AI: ${d.resources.localAi.enabled ? `${d.resources.localAi.usableModels} model(s) ready` : "off"}` : ""}
        </p>
        {d.resources.disk.map((x) => (
          <p key={x.path} className="hint">
            Disk of {x.path}: {x.freeGb} GB free of {x.totalGb} GB
          </p>
        ))}
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold">What has run (permanent log)</h3>
        {d.executions.length === 0 && <p className="hint">Nothing yet.</p>}
        <ul className="space-y-1 text-sm">
          {d.executions.slice(0, 15).map((x) => (
            <li key={x.id} className="rounded-md bg-slate-100 px-2 py-1 [overflow-wrap:anywhere] dark:bg-slate-800">
              <span className="font-mono">{x.command}</span> · {x.botName ?? "system"} · <strong>{STATUS[x.status] ?? x.status}</strong>
              {x.exitCode !== null ? ` (exit ${x.exitCode})` : ""} · {new Date(x.startedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </div>

      {errorText(add.error ?? remove.error ?? stop.error ?? resume.error ?? stopServer.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(add.error ?? remove.error ?? stop.error ?? resume.error ?? stopServer.error)}
        </p>
      )}
    </section>
  );
}
