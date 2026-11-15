import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApprovals, useApprovalById, useApprove, useSecurityLog, useDeny, useExternalStatus, useSetExternalPaused } from "../api/hooks";
import type { Approval, ApprovalStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ContextLinks } from "../components/hub/ContextLinks";
import { QueryStatus } from "../components/ui/QueryStatus";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: "Waiting for you",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired (never ran)",
  executed: "Executed",
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
    <dl tabIndex={0} aria-label="Exact action fields" className="min-w-0 max-h-80 overflow-auto space-y-2 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-500">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="font-semibold [overflow-wrap:anywhere]">{k}</dt>
          <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PendingCard({ a, focused = false }: { a: Approval; focused?: boolean }) {
  const approve = useApprove();
  const deny = useDeny();
  const [confirming, setConfirming] = useState(false);
  const busy = approve.isPending || deny.isPending;
  return (
    <li id={`approval-${a.id}`} className={`card min-w-0 space-y-3 border-l-4 border-l-amber-400 [overflow-wrap:anywhere] ${focused ? "ring-2 ring-indigo-500" : ""}`} aria-label={`Approval request: ${a.summary}`}>
      <ContextLinks kind="approval" id={a.id} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
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
        <button className="btn-primary min-h-11" disabled={busy} onClick={() => setConfirming(true)}>
          Approve…
        </button>
        <button className="btn-secondary min-h-11" disabled={busy} onClick={() => deny.mutate({ id: a.id })}>
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

function HistoryRow({ a, focused = false }: { a: Approval; focused?: boolean }) {
  return (
    <li id={`approval-${a.id}`} className={`card min-w-0 space-y-2 [overflow-wrap:anywhere] ${focused ? "ring-2 ring-indigo-500" : ""}`} aria-label={`Past request: ${a.summary}`}>
      <ContextLinks kind="approval" id={a.id} />
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
  const paused = status.data?.paused;
  const [params] = useSearchParams();
  const focusId = params.get("focus");
  const validFocus = !!focusId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(focusId);
  const loadedFocus = [...(pending.data ?? []), ...(all.data ?? [])].some(a => a.id === focusId);
  const focusedRequest = useApprovalById(validFocus && !loadedFocus && !pending.isPending && !all.isPending ? focusId : null);
  useEffect(() => {
    if (focusId) document.getElementById(`approval-${focusId}`)?.scrollIntoView?.({ block: "center" });
  }, [focusId, pending.data, all.data, focusedRequest.data]);
  const extra = focusedRequest.data && !loadedFocus ? focusedRequest.data : undefined;
  const waiting = [...(pending.data ?? []), ...(extra?.status === "pending" ? [extra] : [])];
  const history = [...(all.data ?? []).filter(a => a.status !== "pending"), ...(extra && extra.status !== "pending" ? [extra] : [])];
  const total = status.data?.pendingCount;

  return (
    <div className="min-w-0 space-y-8">
      <header className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 space-y-2 dark:border-indigo-900 dark:bg-indigo-950/40 sm:p-6">
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm">Review the exact request, then choose what may happen.</p>
        <p className="font-semibold">{total === undefined ? "Waiting total unavailable" : `${total} waiting in total`}</p>
        <QueryStatus query={status} label="outside-action status" freshness />
      </header>

      <section className="card space-y-3" aria-labelledby="ext-heading">
        <h2 id="ext-heading" className="text-lg font-semibold">
          Outside actions
        </h2>
        <p className="text-sm">
          A bot can only <strong>ask</strong>. Anything that sends or changes something outside this computer waits here until you approve it, and it
          runs once with exactly the content shown. Reading from outside is off for every bot until you switch it on in that bot's Permissions tab.
        </p>
        <p className={`rounded-md p-2 text-sm font-medium ${paused ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-slate-100 dark:bg-slate-800"}`}>
          {paused === undefined || status.isError ? "Status unavailable: outside-action permission has not been confirmed." : paused ? "PAUSED: no outside action can be requested or approved." : "Outside actions are allowed (each write still needs your approval)."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className={`${paused ? "btn-primary" : "btn-danger"} min-h-11`} disabled={setPaused.isPending || !status.data || status.isError} onClick={() => setPaused.mutate(!paused)}>
            {paused ? "Allow outside actions again" : "Pause all outside actions"}
          </button>
          {errorText(setPaused.error) && <span role="alert" className="text-sm text-red-700">{errorText(setPaused.error)}</span>}
        </div>
      </section>

      {focusId && !validFocus && <p role="alert">The focused request ID is invalid. Other requests are still available below.</p>}
      {validFocus && !loadedFocus && !pending.isPending && !all.isPending && <QueryStatus query={focusedRequest} label="the focused request" />}
      {extra && <p className="hint">The focused request is shown in addition to the latest loaded requests.</p>}

      <section className="space-y-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Waiting for you {total !== undefined ? `(${total})` : ""}
        </h2>
        <QueryStatus query={pending} label="requests" />
        {pending.data && total !== undefined && total > pending.data.length && <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">Showing {pending.data.length} latest requests; {total} waiting in total. Older requests are outside this loaded list.</p>}
        {pending.data && !pending.isError && waiting.length === 0 && <p className="hint">{total === 0 && !status.isError ? "Nothing is waiting for approval." : "No requests in this loaded batch; the total may differ or be unavailable."}</p>}
        <ul className="space-y-4">{waiting.map(a => <PendingCard key={a.id} a={a} focused={a.id === focusId} />)}</ul>
      </section>

      <details className="card min-w-0 space-y-3 [overflow-wrap:anywhere]">
        <summary className="min-h-11 cursor-pointer font-semibold">Service details</summary>
        {status.data && status.data.connectors.length === 0 && (
          <p className="hint">No connections (Gmail, Telegram, browser) are installed yet, so no bot can reach anything outside.</p>
        )}
        {status.data && status.data.connectors.length > 0 && (
          <ul className="text-sm">
            {status.data.connectors.map((c) => (
              <li key={c.id}>
                <strong>{c.label}:</strong>{" "}
                {c.notReady ? <span>not set up yet: {c.notReady}</span> : null}
                {!c.notReady && c.actions.map((x) => `${x.name} (${x.kind === "write" ? "needs approval" : "read"})`).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </details>

      <div className="grid min-w-0 gap-8 xl:grid-cols-2">
      <section className="min-w-0 space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <p className="hint">History within the latest 100 requests. Executed means the recorded action ran; delivery and result accuracy are separate checks.</p>
        <QueryStatus query={all} label="request history" />
        {all.data && !all.isError && history.length === 0 && <p className="hint">Nothing decided in the loaded history.</p>}
        <ul className="space-y-3">{history.map(a => <HistoryRow key={a.id} a={a} focused={a.id === focusId} />)}</ul>
      </section>

      <section className="min-w-0 space-y-3" aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="text-lg font-semibold">
          Security log
        </h2>
        <p className="hint">Latest 30 entries from the permanent record. Entries cannot be edited or removed, and never contain passwords or keys.</p>
        <QueryStatus query={audit} label="the security log" />
        {audit.data && !audit.isError && audit.data.length === 0 && <p className="hint">Nothing recorded yet.</p>}
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
    </div>
  );
}
