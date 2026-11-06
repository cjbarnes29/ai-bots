import { useChainVerification, type VerificationStatus } from "../api/verificationHooks";

const LABEL: Record<VerificationStatus, string> = { verified: "Confirmed by the platform", unverified: "Not checked: the agent's own words", waiting: "Waiting for your approval", contradicted: "Contradicted: do not rely on it", not_applicable: "Nothing to check" };
const STYLE: Record<VerificationStatus, string> = {
  verified: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200",
  unverified: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  waiting: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  contradicted: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  not_applicable: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
};
const MARK = { pass: "Confirmed", fail: "Failed", note: "Note" } as const;

/**
 * Result check: compares what the agent SAYS happened with what the platform itself recorded (approved actions that ran, files that really exist).
 * "Completed" only means the agent stopped; this says whether anything is confirmed. Read-only; it never runs or approves anything.
 */
export function ResultCheck({ taskId, finished }: { taskId: string; finished: boolean }) {
  const q = useChainVerification(taskId, finished);
  if (!finished || !q.data || q.data.status === "not_applicable") return null;
  const v = q.data;
  return (
    <section aria-label="Result check" className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Result check</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[v.status]}`}>{LABEL[v.status]}</span>
      </div>
      <p className="text-sm [overflow-wrap:anywhere]" role="status">
        {v.summary}
      </p>
      {v.checks.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm underline">What was checked ({v.checks.length})</summary>
          <ul className="list-disc space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
            {v.checks.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{MARK[c.outcome]}:</span> {c.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
