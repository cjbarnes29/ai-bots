import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useActionDecision, useAssistantActions, whereCandidate, type ActionView, type Candidate, type Interpretation, type Suggestion } from "../../api/assistantHooks";

/** One thing the assistant answered locally (a lookup, an edit, a refusal), kept in the page so it can be reread. */
export interface Result {
  id: string;
  asked: string;
  reply: Exclude<Interpretation, { kind: "none" }>;
}

const LEVEL: Record<string, { label: string; tone: string }> = {
  safe: { label: "Safe: done at once", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  review: { label: "Needs your review", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  restricted: { label: "Restricted: only you can do this", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};
const STATUS_WORD: Record<string, string> = { proposed: "waiting for you", applied: "done", rejected: "rejected", undone: "undone", failed: "failed", refused: "refused" };
const text = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function Diff({ a }: { a: ActionView }) {
  const keys = Object.keys(a.after);
  return (
    <div className="space-y-1 text-xs">
      {keys.map((k) => (
        <div key={k} className="grid gap-1 sm:grid-cols-2">
          <div className="rounded bg-red-50 p-2 dark:bg-red-950/30">
            <p className="font-semibold">Before ({k})</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{clip(text(a.before[k]) || "(empty)", 700)}</p>
          </div>
          <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/30">
            <p className="font-semibold">After ({k})</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{clip(text(a.after[k]) || "(empty)", 700)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** An action card always shows the CURRENT state from the server, so a button never offers something that is no longer possible. */
function ActionCard({ id, fallback }: { id: string; fallback: ActionView }) {
  const all = useAssistantActions();
  const decide = useActionDecision();
  const a = all.data?.find((x) => x.id === id) ?? fallback;
  const err = errorText(decide.error);
  return (
    <div className="space-y-2" aria-label={`Change: ${a.summary}`}>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${LEVEL[a.level]!.tone}`}>{LEVEL[a.level]!.label}</span>
        <span>Status: {STATUS_WORD[a.status] ?? a.status}</span>
      </p>
      {(a.level === "review" || a.status === "applied") && <Diff a={a} />}
      {a.error && <p className="text-xs text-red-700 dark:text-red-300">{a.error}</p>}
      <div className="flex flex-wrap gap-2">
        {a.status === "proposed" && (
          <>
            <button type="button" className="btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id, op: "confirm" })}>
              Apply this change
            </button>
            <button type="button" className="btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id, op: "reject" })}>
              Reject
            </button>
          </>
        )}
        {a.undoable && (
          <button type="button" className="btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id, op: "undo" })}>
            Undo
          </button>
        )}
      </div>
      {err && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {err}
        </p>
      )}
    </div>
  );
}

function Candidates({ items }: { items: Candidate[] }) {
  return (
    <ul className="space-y-1" aria-label="Matches">
      {items.map((c) => (
        <li key={`${c.kind}:${c.id}`}>
          <Link className="flex min-h-11 flex-col justify-center rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" to={whereCandidate(c)}>
            <span className="text-sm font-medium [overflow-wrap:anywhere]">Open {c.title}</span>
            <span className="hint text-xs">{c.kind === "page" ? c.subtitle : `${c.kind} · ${c.subtitle}`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ResultsPanel({ results, onClear }: { results: Result[]; onClear: () => void }) {
  if (results.length === 0) return null;
  return (
    <section aria-label="Assistant results" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">What I found or did</h2>
        <button type="button" className="min-h-11 px-2 text-sm underline" onClick={onClear}>
          Clear
        </button>
      </div>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.id} className="card space-y-2" aria-label={`Result for: ${r.asked}`}>
            <p className="hint text-xs">You asked: “{clip(r.asked, 120)}”</p>
            <p className="text-sm [overflow-wrap:anywhere]" role="status">
              {r.reply.message}
            </p>
            {r.reply.kind === "locate" && r.reply.understood && <p className="hint text-xs">I understood: {r.reply.understood}. To send this to the model instead, start the message with “ask:”.</p>}
            {r.reply.kind === "locate" && r.reply.candidates.length > 0 && <Candidates items={r.reply.candidates} />}
            {r.reply.kind === "action" && r.reply.action && <ActionCard id={r.reply.action.id} fallback={r.reply.action} />}
            {r.reply.kind === "action" && r.reply.choices && (
              <ul className="list-disc pl-5 text-sm">
                {r.reply.choices.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {"link" in r.reply && r.reply.link && (
              <Link className="inline-flex min-h-11 items-center text-sm text-indigo-700 underline dark:text-indigo-300" to={r.reply.link.to}>
                {r.reply.link.label}
              </Link>
            )}
            {r.reply.kind === "capabilities" && <CapabilityLists reply={r.reply} />}
            {r.reply.kind === "overview" && (
              <p className="flex flex-wrap gap-3">
                {r.reply.links.map((l) => (
                  <Link key={l.to} className="inline-flex min-h-11 items-center text-sm text-indigo-700 underline dark:text-indigo-300" to={l.to}>
                    {l.label}
                  </Link>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CapabilityLists({ reply }: { reply: Extract<Interpretation, { kind: "capabilities" }> }) {
  const parts: [string, string[]][] = [
    ["Working now", reply.can],
    ["Partly, or set up but not proven", reply.partly],
    ["Cannot do (and what is missing)", reply.cannot],
    ["Needs you", reply.needsYou],
  ];
  return (
    <div className="space-y-2">
      {parts.filter(([, items]) => items.length > 0).map(([title, items]) => (
        <details key={title} open={title !== "Cannot do (and what is missing)" && title !== "Needs you"}>
          <summary className="min-h-11 cursor-pointer text-sm font-medium">
            {title} ({items.length})
          </summary>
          <ul className="list-disc pl-5 text-sm [overflow-wrap:anywhere]">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      ))}
      <p className="hint text-xs">Read from the live capability list at {new Date(reply.checkedAt).toLocaleTimeString()}.</p>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { attention: "Needs you", problem: "Problem", improvement: "Improvement", automation: "Automation idea" };

export function SuggestionsPanel({ items, onAsk }: { items: Suggestion[]; onAsk: (text: string) => void }) {
  return (
    <section aria-label="Suggestions" className="card space-y-2">
      <h2 className="text-lg font-semibold">Suggestions</h2>
      <p className="hint text-xs">Worked out from your real projects, tasks, approvals and documents. Nothing here changes anything until you act.</p>
      {items.length === 0 && <p className="text-sm">Nothing needs attention right now.</p>}
      <ul className="space-y-2">
        {items.slice(0, 8).map((s) => (
          <li key={s.id} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
            <p>
              <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${s.severity === "high" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>{KIND_LABEL[s.kind]}</span>
              {s.text}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {s.to && (
                <Link className="inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300" to={s.to}>
                  Look at it
                </Link>
              )}
              {s.ask && (
                <button type="button" className="min-h-11 text-indigo-700 underline dark:text-indigo-300" onClick={() => onAsk(s.ask!)}>
                  Do it with the assistant
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChangesPanel() {
  const all = useAssistantActions();
  const decide = useActionDecision();
  const items = (all.data ?? []).filter((a) => a.level !== "restricted").slice(0, 8);
  const refused = (all.data ?? []).filter((a) => a.status === "refused").length;
  return (
    <section aria-label="Assistant changes" className="card space-y-2">
      <h2 className="text-lg font-semibold">Recent changes</h2>
      <p className="hint text-xs">Everything the assistant changed or proposed, with what it was before. {refused > 0 ? `${refused} request${refused === 1 ? " was" : "s were"} refused because only you may do them.` : ""}</p>
      {items.length === 0 && <p className="text-sm">No changes yet.</p>}
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {a.summary} <span className="hint">({STATUS_WORD[a.status] ?? a.status})</span>
            </span>
            {a.undoable && (
              <button type="button" className="btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, op: "undo" })} aria-label={`Undo: ${a.summary}`}>
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
