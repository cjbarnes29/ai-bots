import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkflowVerification, type VerificationStatus } from "../api/verificationHooks";

const LABEL: Record<VerificationStatus, string> = {
  verified: "Confirmed within the recorded scope", unverified: "Not fully verified", waiting: "Waiting for a decision or action",
  contradicted: "Contradicted: do not rely on it", not_applicable: "No outside-effect evidence",
};

export function WorkflowResultCheck({ runId, runStatus }: { runId: string; runStatus: string }) {
  const [open, setOpen] = useState(false);
  const q = useWorkflowVerification(runId, runStatus, open), v = q.data;
  return <details className="mt-3 rounded-md border border-slate-300 p-2 dark:border-slate-700" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline">Workflow result check</summary>
    {open && <section aria-label="Workflow result check" className="space-y-2 [overflow-wrap:anywhere]">
      {q.isError ? <p role="status">Check unavailable. Previous evidence is not shown as current. Try again.</p>
        : q.isFetching || !v ? <p role="status">{v ? "Refreshing check; previous evidence may be out of date…" : "Checking saved workflow evidence…"}</p>
          : <>
            <h4 className="font-semibold">Workflow output: Not independently verified</h4>
            <p>{v.outputAssessment.summary}</p>
            <p className="font-semibold">Recorded step evidence: {LABEL[v.supporting.status]}</p>
            <p role="status">{v.supporting.summary}</p>
            <p>{v.completion.completed} of {v.completion.total} steps completed; {v.completion.skipped} skipped, {v.completion.failed} failed, {v.completion.waiting} waiting.</p>
            <p>Saved version {v.workflowVersion} · Run state: {v.runStatus}.</p>
            {!v.coverageComplete && <p>Coverage is incomplete; some records or links could not be checked.</p>}
            <p className="hint">Checked at {new Date(v.checkedAt).toLocaleString()}. File observations apply to that time.</p>
            {v.unlinkedAttempts.total > 0 && <p>{v.unlinkedAttempts.total} earlier or unlinked task attempt(s) were found. They do not supply confirmed evidence.{v.unlinkedAttempts.truncated ? " Only a limited list was inspected." : ""}</p>}
            <ul className="space-y-2">{v.steps.map(s => <li key={s.nodeId}>
              <span className="font-medium">{s.label || s.nodeId}</span> · {s.status}. {s.reason}
              {s.binding === "valid" && s.sourceKind === "task" && s.sourceId && <Link className="inline-flex min-h-11 items-center px-2 underline" to={`/tasks/${s.sourceId}`}>View task evidence</Link>}
              {s.binding === "valid" && s.sourceKind === "approval" && s.sourceId && <Link className="inline-flex min-h-11 items-center px-2 underline" to={`/approvals?focus=${s.sourceId}`}>View approval record</Link>}
              {s.sourceKind === "manager" && s.sourceId && <p className="hint">Referenced Manager run: {s.sourceId}. Its evidence is not inherited.</p>}
            </li>)}</ul>
            {v.sources.length > 0 && <details>
              <summary className="flex min-h-11 cursor-pointer items-center underline">Recorded evidence details ({v.sources.length})</summary>
              <ul className="space-y-2">{v.sources.map(source => <li key={`${source.kind}:${source.id}`}>
                <p className="font-medium">{source.kind === "task" ? "Task" : "Approval"} {source.id}: {LABEL[source.verification.status]}</p>
                <p>{source.verification.summary}</p>
                <ul className="list-disc pl-5">{source.verification.checks.map((c, i) => <li key={i}>{c.detail}</li>)}</ul>
              </li>)}</ul>
            </details>}
          </>}
      <button className="btn-secondary min-h-11" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh check</button>
    </section>}
  </details>;
}
