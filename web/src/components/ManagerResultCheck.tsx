import { useState } from "react";
import { Link } from "react-router-dom";
import { useManagerVerification, type VerificationStatus } from "../api/verificationHooks";

const LABEL: Record<VerificationStatus, string> = {
  verified: "Confirmed by the platform", unverified: "Not fully verified", waiting: "Waiting for your approval",
  contradicted: "Contradicted: do not rely on it", not_applicable: "Nothing to check",
};

export function ManagerResultCheck({ runId, runStatus }: { runId: string; runStatus: string }) {
  const [open, setOpen] = useState(false);
  const q = useManagerVerification(runId, runStatus, open);
  const v = q.data;
  return (
    <details className="rounded-md border border-slate-300 p-2 dark:border-slate-700" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold underline">Manager result check</summary>
      {open && <section aria-label="Manager result check" className="space-y-2 text-sm [overflow-wrap:anywhere]">
        {q.isError ? <p role="status">Check unavailable. Previous evidence is not shown as current. Try again.</p>
          : q.isFetching || !v ? <p role="status">{v ? "Refreshing check; previous evidence may be out of date…" : "Checking saved helper evidence…"}</p>
          : <>
            <h3 className="font-semibold">Final summary: Not independently verified</h3>
            <p>{v.finalSummary.summary}</p>
            <p className="font-semibold">Helper evidence: {LABEL[v.supporting.status]}</p>
            <p role="status">{v.supporting.summary}</p>
            <p>{v.completion.completed} of {v.completion.total} steps completed. Run state: {v.runStatus}.</p>
            {!v.coverageComplete && <p>Coverage is incomplete; some records could not be checked.</p>}
            <p className="hint">Checked at {new Date(v.checkedAt).toLocaleString()}. File observations apply to that check time.</p>
            <ul className="space-y-2">
              {v.steps.map(step => <li key={step.id}>
                <span className="font-medium">Step {step.id}</span> · {step.status}. {step.reason}
                {step.taskId && <Link className="inline-flex min-h-11 items-center px-2 underline" to={`/tasks/${step.taskId}`}>View helper task</Link>}
              </li>)}
            </ul>
            {v.supporting.checks.length > 0 && <details>
              <summary className="flex min-h-11 cursor-pointer items-center underline">Helper evidence details ({v.supporting.checks.length})</summary>
              <ul className="list-disc space-y-1 pl-5">{v.supporting.checks.map((c, i) => <li key={i}>{c.detail}</li>)}</ul>
            </details>}
          </>}
        <button className="btn-secondary min-h-11" disabled={q.isFetching} onClick={() => void q.refetch()}>Refresh check</button>
      </section>}
    </details>
  );
}
