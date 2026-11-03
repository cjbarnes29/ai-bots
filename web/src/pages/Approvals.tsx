import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApprovals, useApprove, useSecurityLog, useDeny, useExternalStatus, useSetExternalPaused } from "../api/hooks";
import type { Approval, ApprovalStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: "Waiting for you",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired (never ran)",
  executed: "Done",
  failed: "Failed",
};

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  approved: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  denied: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  expired: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  executed: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

/** The exact content, one field per line, so nothing is hidden or summarised away. */
function ExactContent({ args }: { args: unknown }) {
  const entries = args && typeof args === "object" ? Object.entries(args as Record<string, unknown>) : [];
  if (entries.length === 0) return <p className="hint">No extra details.</p>;
  return (
    <dl className="space-y-1 rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-800">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="font-semibold">{k}</dt>
          <dd className="whitespace-pre-wrap break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PendingCard({ a }: { a: Approval }) {
  const approve = useApprove();
  const deny = useDeny();
  const [confirming, setConfirming] = useState(false);
  const busy = approve.isPending || deny.isPending;
  return (
    <li className="card space-y-3" aria-label={`Approval request: ${a.summary}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{a.summary}</p>
          <p className="hint">
            <Link to={`/bots/${a.botId}`} className="underline">
              {a.botName}
            </Link>{" "}
            wants to use {a.connectorLabel}: {a.action}
            {a.taskId && (
              <>
                {" · "}
                <Link to={`/tasks/${a.taskId}`} className="underline">
                  task
                </Link>
              </>
            )}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE.pending}`}>{STATUS_TEXT.pending}</span>
      </div>
      <p className="text-sm font-semibold">Exactly what will happen if you approve:</p>
      <ExactContent args={a.args} />
      <p className="hint">Asked {when(a.createdAt)}. It expires {when(a.expiresAt)} and then can never run.</p>
      {errorText(approve.error ?? deny.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(approve.error ?? deny.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => setConfirming(true)}>
          Approve…
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => deny.mutate({ id: a.id })}>
          Deny
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Approve this outside action?"
          confirmLabel="Yes, do it once"
          busy={approve.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => approve.mutate(a.id, { onSettled: () => setConfirming(false) })}
        >
          <p className="mb-2">{a.summary}</p>
          <ExactContent args={a.args} />
          <p className="hint mt-2">It runs one time, right now, with exactly this content.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

function HistoryRow({ a }: { a: Approval }) {
  return (
    <li className="card space-y-1" aria-label={`Past request: ${a.summary}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{a.summary}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>{STATUS_TEXT[a.status]}</span>
      </div>
      <p className="hint">
        {a.botName} · {a.connectorLabel}: {a.action} · asked {when(a.createdAt)}
        {a.decidedAt ? ` · decided ${when(a.decidedAt)}` : ""}
      </p>
      {a.result && <p className="text-sm">Result: {a.result}</p>}
      {a.error && <p className="text-sm text-red-700 dark:text-red-300">Reason: {a.error}</p>}
    </li>
  );
}

export function Approvals() {
  const status = useExternalStatus();
  const pending = useApprovals(true);
  const all = useApprovals(false);
  const audit = useSecurityLog(30);
  const setPaused = useSetExternalPaused();
  const paused = status.data?.paused ?? false;
  const history = (all.data ?? []).filter((a) => a.status !== "pending");

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Approvals</h1>

      <section className="card space-y-3" aria-labelledby="ext-heading">
        <h2 id="ext-heading" className="text-lg font-semibold">
          Outside actions
        </h2>
        <p className="text-sm">
          A bot can only <strong>ask</strong>. Anything that sends or changes something outside this computer waits here until you approve it, and it
          runs once with exactly the content shown. Reading from outside is off for every bot until you switch it on in that bot's Permissions tab.
        </p>
        <p className={`rounded-md p-2 text-sm font-medium ${paused ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-slate-100 dark:bg-slate-800"}`}>
          {paused ? "PAUSED: no outside action can be requested or approved." : "Outside actions are allowed (each write still needs your approval)."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className={paused ? "btn-primary" : "btn-danger"} disabled={setPaused.isPending || !status.data} onClick={() => setPaused.mutate(!paused)}>
            {paused ? "Allow outside actions again" : "Pause all outside actions"}
          </button>
          {errorText(setPaused.error) && <span role="alert" className="text-sm text-red-700">{errorText(setPaused.error)}</span>}
        </div>
        {status.data && status.data.connectors.length === 0 && (
          <p className="hint">No connections (Gmail, Telegram, browser) are installed yet, so no bot can reach anything outside.</p>
        )}
        {status.data && status.data.connectors.length > 0 && (
          <ul className="text-sm">
            {status.data.connectors.map((c) => (
              <li key={c.id}>
                <strong>{c.label}:</strong> {c.actions.map((x) => `${x.name} (${x.kind === "write" ? "needs approval" : "read"})`).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Waiting for you {pending.data && pending.data.length > 0 ? `(${pending.data.length})` : ""}
        </h2>
        {pending.isError && <p role="alert">Could not load requests.</p>}
        {pending.data && pending.data.length === 0 && <p className="hint">Nothing is waiting for approval.</p>}
        <ul className="space-y-3">{pending.data?.map((a) => <PendingCard key={a.id} a={a} />)}</ul>
      </section>

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        {history.length === 0 && <p className="hint">Nothing decided yet.</p>}
        <ul className="space-y-2">{history.map((a) => <HistoryRow key={a.id} a={a} />)}</ul>
      </section>

      <section className="space-y-3" aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="text-lg font-semibold">
          Security log
        </h2>
        <p className="hint">A permanent record. Entries cannot be edited or removed, and never contain passwords or keys.</p>
        {audit.data && audit.data.length === 0 && <p className="hint">Nothing recorded yet.</p>}
        <ul className="space-y-1 text-sm">
          {audit.data?.map((e) => (
            <li key={e.id} className="break-words rounded-md bg-slate-100 px-2 py-1 [overflow-wrap:anywhere] dark:bg-slate-800">
              <span className="font-mono">{e.kind}</span> · {e.actor} · {when(e.createdAt)}
              {Object.keys(e.detail).length > 0 && <span className="hint"> · {JSON.stringify(e.detail)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
