import { useState } from "react";
import { ApiError } from "../api/client";
import { useConsensus, useDecisionEdit, useExecution, useOptionVersions } from "../api/collabHooks";
import type { DecisionDetail, DecisionOption } from "../api/workHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const Err = ({ e }: { e: unknown }) => (errorText(e) ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errorText(e)}</p> : null);

/** Edit the wording of an option, see every earlier version and exactly what changed. Editing is only possible until the decision is approved. */
export function OptionEditor({ decision, option }: { decision: DecisionDetail; option: DecisionOption }) {
  const edit = useDecisionEdit();
  const [open, setOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [f, setF] = useState({ title: option.title, details: option.details, pros: option.pros, cons: option.cons });
  const versions = useOptionVersions(decision.id, option.id, showVersions || decision.status !== "open");
  const editable = decision.status === "open" || decision.status === "chosen";
  const approved = versions.data?.approved?.optionId === option.id ? versions.data.approved : null;
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        {editable && <button className="btn-secondary" aria-label={`Edit wording of ${option.title}`} onClick={() => setOpen(!open)}>{open ? "Cancel editing" : "Edit wording"}</button>}
        <button className="btn-secondary" aria-label={`Versions of ${option.title}`} onClick={() => setShowVersions(!showVersions)}>{showVersions ? "Hide versions" : "Versions"}</button>
        {editable && decision.options.length > 2 && option.id !== decision.chosenOptionId && (
          <button className="btn-secondary" aria-label={`Remove option ${option.title}`} onClick={() => edit.mutate({ op: "removeOption", id: decision.id, optionId: option.id })}>Remove</button>
        )}
      </div>
      {approved && <p className="font-semibold text-green-800 dark:text-green-300">Approved: version {approved.version} (fingerprint {approved.hash.slice(0, 10)}).</p>}
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate({ op: "editOption", id: decision.id, optionId: option.id, patch: f }, { onSuccess: () => setOpen(false) });
          }}
        >
          {(["title", "details", "pros", "cons"] as const).map((k) => (
            <label key={k} className="block">
              {k === "details" ? "Instructions (what the bot will be told)" : k[0]!.toUpperCase() + k.slice(1)}
              {k === "title" ? (
                <input className="input w-full" aria-label={`Option ${k}`} value={f[k]} maxLength={120} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              ) : (
                <textarea className="input w-full" aria-label={`Option ${k}`} rows={k === "details" ? 4 : 2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              )}
            </label>
          ))}
          <p className="hint">Saving keeps the earlier wording as an earlier version. Only what you save here is ever passed to the bot; comments never change instructions.</p>
          <button className="btn-primary" type="submit" disabled={edit.isPending}>Save as a new version</button>
        </form>
      )}
      {(showVersions || approved) && versions.data && (
        <ol className="space-y-2" aria-label={`Versions of ${option.title}`}>
          {versions.data.versions.map((v) => (
            <li key={v.version} className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
              <p className="font-semibold">Version {v.version}{v.version === versions.data!.approved?.version && approved ? " (approved)" : ""} <span className="hint font-normal">{v.by === "bot" ? `by ${v.botName}` : "edited by you"} · {new Date(v.at).toLocaleString()}</span></p>
              {v.changes.length === 0 ? (
                <p className="whitespace-pre-wrap">{v.text.details || v.text.title}</p>
              ) : (
                v.changes.map((c) => (
                  <p key={c.field} className="whitespace-pre-wrap"><span className="font-semibold">{c.field}:</span> <del className="text-red-700 dark:text-red-300">{c.before || "(empty)"}</del> → <ins className="text-green-800 no-underline dark:text-green-300">{c.after || "(empty)"}</ins></p>
                ))
              )}
            </li>
          ))}
        </ol>
      )}
      <Err e={edit.error} />
    </div>
  );
}

export function AddOptionForm({ decision }: { decision: DecisionDetail }) {
  const edit = useDecisionEdit();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  if (decision.status !== "open" && decision.status !== "chosen") return null;
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>Add my own option</button>;
  return (
    <form
      className="space-y-2 rounded-md border border-slate-300 p-2 dark:border-slate-700"
      onSubmit={(e) => {
        e.preventDefault();
        edit.mutate({ op: "addOption", id: decision.id, option: { title, details } }, { onSuccess: () => { setOpen(false); setTitle(""); setDetails(""); } });
      }}
    >
      <label className="block text-sm">New option title<input className="input w-full" aria-label="New option title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block text-sm">Instructions<textarea className="input w-full" aria-label="New option instructions" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      <button className="btn-primary" type="submit" disabled={!title.trim() || edit.isPending}>Add option</button>
      <Err e={edit.error} />
    </form>
  );
}

/** What the bots agree and disagree on, computed only from the views they really gave; the Manager's loop; never a decision. */
export function ConsensusPanel({ decision }: { decision: DecisionDetail }) {
  const c = useConsensus(decision.id);
  const edit = useDecisionEdit();
  const open = decision.status === "open" || decision.status === "chosen";
  if (!c.data?.consensus) return null;
  const { consensus, outcome } = c.data;
  return (
    <section className="space-y-2 rounded-md border border-slate-300 p-3 text-sm dark:border-slate-700" aria-label="Agreement between the bots">
      <p className="font-semibold">
        {consensus.state === "consensus" ? "The bots agree" : consensus.state === "insufficient" ? "Not enough bots to agree" : "The bots have not reached agreement"}
        {outcome ? <span className="hint font-normal"> · recorded: {outcome.kind === "consensus" ? "agreement" : "sent to you to decide"}</span> : null}
      </p>
      <p>{consensus.note}</p>
      {consensus.objectors.length > 0 && (
        <ul className="list-disc pl-5">
          {consensus.objectors.map((o, i) => <li key={i}><strong>{o.bot}</strong> ({o.stance}): {o.reasoning}</li>)}
        </ul>
      )}
      {consensus.missing.length > 0 && <p className="hint">No view from: {consensus.missing.join(", ")}. Silence is not counted as agreement.</p>}
      {consensus.recommendation && (
        <p className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
          <span className="font-semibold">Manager's summary (not a bot's view, not a decision):</span> "{consensus.recommendation.title}". {consensus.recommendation.reason}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={edit.isPending || consensus.roundsDone >= 2} onClick={() => edit.mutate({ op: "collaborate", id: decision.id })}>
            {consensus.roundsDone >= 2 ? "Both review rounds are done" : "Let the Manager run the discussion"}
          </button>
        </div>
      )}
      <p className="hint">The Manager asks each bot to explain its view and reconsider (at most two rounds, one model call per bot and round), stops when they agree, and otherwise leaves the choice to you.</p>
      <Err e={edit.error} />
    </section>
  );
}

/** What each bot was actually told, whether that is the approved wording, and what came back. */
export function ExecutionPanel({ decision }: { decision: DecisionDetail }) {
  const approvedOrLater = ["approved", "in_progress", "done"].includes(decision.status);
  const ex = useExecution(decision.id, approvedOrLater);
  if (!approvedOrLater || !ex.data?.execution) return null;
  return (
    <section className="space-y-2" aria-label="Execution record">
      <h3 className="font-semibold">What was executed{ex.data.approved ? ` (approved version ${ex.data.approved.version})` : ""}</h3>
      {ex.data.execution.map((e) => (
        <div key={e.botId} className="rounded-md border border-slate-300 p-2 text-sm dark:border-slate-700" aria-label={`Execution ${e.botName}`}>
          <p className="font-semibold">{e.botName} <span className="hint font-normal">· {e.status ?? e.startState}</span></p>
          {e.instructionSent ? (
            <>
              <p className={e.matchesApprovedVersion ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}>{e.matchesApprovedVersion ? "The bot received the approved wording." : "The bot's instruction does not match the approved wording."}</p>
              <details><summary className="cursor-pointer">The exact instruction the bot received</summary><pre className="whitespace-pre-wrap break-words">{e.instructionSent}</pre></details>
            </>
          ) : <p className="hint">Not started yet.</p>}
          {e.result && <details open><summary className="cursor-pointer">Result</summary><p className="whitespace-pre-wrap break-words">{e.result}</p></details>}
          {e.error && <p className="text-red-700 dark:text-red-300">{e.error}</p>}
        </div>
      ))}
    </section>
  );
}

/** Choose who does the work and what each one is told to do, before approving. Defaults to the bot that proposed the option. */
export function ApprovalPlanner({ decision, onApproved }: { decision: DecisionDetail; onApproved: () => void }) {
  const edit = useDecisionEdit();
  const chosen = decision.options.find((o) => o.id === decision.chosenOptionId);
  const [duties, setDuties] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[] | null>(null);
  if (decision.status !== "chosen" || !chosen) return null;
  const candidates = decision.participants;
  const ids = picked ?? (chosen.proposedBy ? [chosen.proposedBy.botId] : []);
  const toggle = (id: string) => setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 5));
  return (
    <section className="space-y-2 rounded-md border border-sky-500 p-3 text-sm" aria-label="Approve and assign">
      <p className="font-semibold">Approve "{chosen.title}" and say who does it</p>
      {candidates.map((p) => (
        <div key={p.botId} className="space-y-1">
          <label><input type="checkbox" aria-label={`Assign ${p.botName}`} checked={ids.includes(p.botId)} onChange={() => toggle(p.botId)} /> {p.botName}</label>
          {ids.includes(p.botId) && <input className="input w-full" aria-label={`Duty of ${p.botName}`} placeholder={`Carry out the chosen option: ${chosen.title}.`} value={duties[p.botId] ?? ""} onChange={(e) => setDuties({ ...duties, [p.botId]: e.target.value })} />}
        </div>
      ))}
      <p className="hint">What you approve is the option's wording as shown above (its latest version). The bots receive exactly that wording plus the duty you write here. Your private note is never passed on.</p>
      <button
        className="btn-primary"
        disabled={ids.length === 0 || edit.isPending}
        onClick={() => edit.mutate({ op: "approveWith", id: decision.id, assignments: ids.map((botId) => ({ botId, duty: (duties[botId] ?? "").trim() || `Carry out the chosen option: ${chosen.title}.` })) }, { onSuccess: onApproved })}
      >
        Approve with these assignments
      </button>
      <Err e={edit.error} />
    </section>
  );
}
