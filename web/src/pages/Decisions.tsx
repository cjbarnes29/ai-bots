import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useDecision, useDecisionAct, useDecisions, useInquire, type DecisionDetail, type DecisionDraft, type DecisionStatus } from "../api/workHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const STATUS_TEXT: Record<DecisionStatus, string> = {
  open: "Open: choose an option",
  chosen: "Chosen: waiting for your approval",
  approved: "Approved",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
  archived: "Archived",
};
const FILTERS: (DecisionStatus | "")[] = ["", "open", "chosen", "approved", "in_progress", "done", "rejected", "archived"];

function DraftView({ draft, onSaved }: { draft: DecisionDraft; onSaved: (id: string) => void }) {
  const act = useDecisionAct();
  const usable = draft.bots.some((b) => b.options.length > 0);
  return (
    <section className="card space-y-3" aria-label="Options offered by your agents">
      <h2 className="font-semibold">Options offered (not saved yet)</h2>
      {draft.notice && <p className="hint">{draft.notice}</p>}
      {draft.bots.map((b) => (
        <div key={b.botId} className="space-y-1">
          <p className="text-sm font-semibold">
            {b.botName} <span className="hint font-normal">({b.reason})</span>
          </p>
          {b.problem && <p className="hint">{b.problem}</p>}
          <ul className="list-disc pl-5 text-sm">
            {b.options.map((o) => (
              <li key={o.title}>
                <strong>{o.title}</strong>
                {o.details ? `: ${o.details}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="hint">Saving puts these on the board. Nothing happens until you choose and approve.</p>
      <button
        className="btn-primary"
        disabled={!usable || act.isPending}
        onClick={() => act.mutate({ op: "fromDraft", draftId: draft.draftId }, { onSuccess: (r) => onSaved((r as { decision: DecisionDetail }).decision.id) })}
      >
        Put these on the board
      </button>
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
    </section>
  );
}

function Detail({ id }: { id: string }) {
  const q = useDecision(id);
  const act = useDecisionAct();
  const [note, setNote] = useState("");
  const d = q.data;
  if (q.isLoading) return <p className="hint">Loading…</p>;
  if (!d) return <p role="alert" className="text-red-700 dark:text-red-300">{errorText(q.error) ?? "Decision not found."}</p>;
  const chosen = d.options.find((o) => o.id === d.chosenOptionId);
  const canChoose = d.status === "open" || d.status === "chosen";
  return (
    <section className="card space-y-3" aria-label={`Decision ${d.title}`}>
      <h2 className="text-lg font-semibold">{d.title}</h2>
      <p className="hint">{STATUS_TEXT[d.status]}</p>
      <p className="whitespace-pre-wrap text-sm">{d.question}</p>
      {d.project && (
        <p className="hint">
          Project: <Link to="/projects" className="underline">{d.project.name}</Link>
        </p>
      )}

      <ul className="space-y-2">
        {d.options.map((o) => (
          <li key={o.id} className={`rounded-md border p-3 text-sm ${o.id === d.chosenOptionId ? "border-sky-500" : "border-slate-300 dark:border-slate-700"}`} aria-label={`Option ${o.title}`}>
            <p className="font-semibold">
              {o.title}
              {o.id === d.chosenOptionId ? " (your choice)" : ""}
            </p>
            {o.proposedBy && <p className="hint">Proposed by {o.proposedBy.botName}</p>}
            {o.details && <p className="whitespace-pre-wrap">{o.details}</p>}
            {o.pros && <p>Pros: {o.pros}</p>}
            {o.cons && <p>Cons: {o.cons}</p>}
            {o.disagreement && <p className="font-semibold text-amber-800 dark:text-amber-300">Your agents disagree about this one. Read both sides.</p>}
            {o.views.map((v) => (
              <p key={v.id} className="hint">
                {v.botName} ({v.stance}, round {v.round}): {v.reasoning}
              </p>
            ))}
            {canChoose && o.id !== d.chosenOptionId && (
              <button className="btn-secondary mt-2" aria-label={`Choose ${o.title}`} disabled={act.isPending} onClick={() => act.mutate({ op: "choose", id, optionId: o.id, ...(note ? { note } : {}) })}>
                Choose this
              </button>
            )}
          </li>
        ))}
      </ul>

      {canChoose && (
        <div className="space-y-2">
          <label className="block text-sm">
            Your note (optional)
            <textarea className="input w-full" aria-label="Your note" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "review", id })}>
              Ask the agents to review each other (one round)
            </button>
            {d.status === "chosen" && (
              <button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate({ op: "approve", id })}>
                Approve "{chosen?.title}"
              </button>
            )}
            <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "reject", id, ...(note ? { note } : {}) })}>
              Reject
            </button>
          </div>
          {d.status === "chosen" && <p className="hint">Approving creates a project and starts one normal task for each assigned agent (by default, whoever proposed this option). It grants no permission, folder, program or secret; every outside action still waits in Approvals.</p>}
        </div>
      )}
      {d.status === "rejected" && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "reopen", id })}>
          Reopen
        </button>
      )}
      {d.status !== "archived" && d.status !== "open" && d.status !== "chosen" && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "archive", id })}>
          Archive
        </button>
      )}

      {d.assignments.length > 0 && (
        <div>
          <h3 className="font-semibold">Who is doing what</h3>
          <ul className="space-y-1 text-sm">
            {d.assignments.map((a) => (
              <li key={a.botId} aria-label={`Assignment ${a.botName}`}>
                {a.botName}: {a.duty} <span className="hint">({a.startState}{a.taskId ? "" : ""})</span>{" "}
                {a.taskId && (
                  <Link to={`/tasks/${a.taskId}`} className="underline">
                    task
                  </Link>
                )}
                {a.startState === "not_started" && (
                  <button className="btn-secondary ml-2" aria-label={`Start ${a.botName}`} onClick={() => act.mutate({ op: "startAssignment", id, botId: a.botId })}>
                    Start
                  </button>
                )}
                {a.stuck && (
                  <button className="btn-secondary ml-2" aria-label={`Repair ${a.botName}`} onClick={() => act.mutate({ op: "repairAssignment", id, botId: a.botId })}>
                    Repair
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.reports.length > 0 && (
        <div>
          <h3 className="font-semibold">Reports</h3>
          <ul className="space-y-1 text-sm">
            {d.reports.map((r) => (
              <li key={r.id}>
                <span className="hint">{r.botName} · {r.kind}: </span>
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {act.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(act.error)}</p>}
    </section>
  );
}

export function Decisions() {
  const [filter, setFilter] = useState<DecisionStatus | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const list = useDecisions(filter);
  const inquire = useInquire();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Decisions</h1>
        <p className="hint">Ask a question, let the right agents offer options, then you choose and approve. Only you can choose, approve or reject.</p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          inquire.mutate(question, { onSuccess: (dr) => setDraft(dr) });
        }}
      >
        <label className="block text-sm">
          What do you need to decide?
          <textarea className="input w-full" aria-label="Your question" rows={3} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <p className="hint">This asks up to three agents, one model call each, using your free-only limits. Do not paste keys or passwords.</p>
        <button className="btn-primary" type="submit" disabled={question.trim().length < 8 || inquire.isPending}>
          {inquire.isPending ? "Asking…" : "Ask the agents for options"}
        </button>
        {inquire.error && <p role="alert" className="text-red-700 dark:text-red-300">{errorText(inquire.error)}</p>}
      </form>
      {draft && (
        <DraftView
          draft={draft}
          onSaved={(id) => {
            setDraft(null);
            setQuestion("");
            setSelected(id);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision filters">
        {FILTERS.map((f) => (
          <button key={f || "all"} className={filter === f ? "btn-primary" : "btn-secondary"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f ? STATUS_TEXT[f].split(":")[0] : "All active"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ul className="min-w-0 space-y-2">
          {list.isLoading && <li className="hint">Loading…</li>}
          {list.error && <li role="alert" className="text-red-700 dark:text-red-300">{errorText(list.error)}</li>}
          {list.data?.length === 0 && <li className="hint">No decisions here.</li>}
          {list.data?.map((d) => (
            <li key={d.id} className={`card ${selected === d.id ? "ring-2 ring-sky-500" : ""}`}>
              <button className="w-full text-left" aria-label={`Open ${d.title}`} onClick={() => setSelected(d.id)}>
                <span className="font-semibold">{d.title}</span>
                <span className="hint block">{STATUS_TEXT[d.status]} · {d.options} options{d.assignments ? ` · ${d.done}/${d.assignments} reported done` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0">{selected ? <Detail id={selected} /> : <p className="hint">Choose a decision to read it.</p>}</div>
      </div>
    </div>
  );
}
