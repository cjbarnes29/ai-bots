import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useInterpret, useSuggestions, whereCandidate } from "../api/assistantHooks";
import { ChangesPanel, ResultsPanel, SuggestionsPanel, type Result } from "../components/assistant/AssistantPanels";
import { ApiError } from "../api/client";
import { useBots, useWorkflows } from "../api/hooks";
import { useDraftWorkflow, where, type WorkflowDraftResult } from "../api/hubHooks";
import { useProjects } from "../api/workHooks";
import { ChatTab } from "../components/ChatTab";
import { summarizeChange } from "../lib/draftDiff";

const BOT_KEY = "awp-assistant-bot";
const CONV_KEY = "awp-assistant-conv";
const DRAFT_KEY = "awp-assistant-draft";
const RESULTS_KEY = "awp-assistant-results";
const read = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

/** Draft a workflow from a description, then open it in the Workflows workspace. The draft is never saved by this page or by the server. */
function WorkflowPanel({ prefill }: { prefill: string }) {
  const navigate = useNavigate();
  const draft = useDraftWorkflow();
  const list = useWorkflows(false);
  const [text, setText] = useState(prefill ? `Do this every time it is needed: ${prefill}` : "");
  const [change, setChange] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const result: WorkflowDraftResult | undefined = draft.data;
  const error = draft.error instanceof ApiError ? draft.error.friendly : draft.error ? "The draft could not be made." : null;
  const steps = result?.draft.graph.nodes.filter((n) => n["type"] === "bot_task" || n["type"] === "checkpoint") ?? [];
  return (
    <section aria-label="Workflows from the assistant" className="card space-y-3">
      <h2 className="text-lg font-semibold">Workflows</h2>
      <p className="hint">Describe a process in plain words. The assistant drafts it as a workflow; you open it in Workflows, read it and save it. Nothing is saved or run for you.</p>
      <label className="block text-sm font-medium">
        What should the workflow do?
        <textarea className="mt-1 w-full" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Example: research a topic, then ask me before the summary is written." />
      </label>
      <button type="button" className="btn-primary" disabled={text.trim().length < 10 || draft.isPending} onClick={() => draft.mutate(text, { onSuccess: () => setNote(null) })}>
        {draft.isPending ? "Drafting…" : "Draft a workflow"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2 rounded-md border border-slate-300 p-3 dark:border-slate-700" aria-label="Workflow draft">
          <p className="font-semibold">{result.draft.name}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {steps.map((n) => (
              <li key={String(n["id"])}>{n["type"] === "checkpoint" ? `Ask you: ${String(n["message"])}` : `${String(n["label"])}: ${String(n["instruction"]).slice(0, 120)}`}</li>
            ))}
          </ol>
          {note && (
            <p role="status" aria-label="What changed" className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {note}
            </p>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="hint text-xs">
              {w}
            </p>
          ))}
          <label className="block text-sm">
            Change this draft
            <input className="mt-1 block w-full" aria-label="Change this draft" value={change} maxLength={300} onChange={(e) => setChange(e.target.value)} placeholder="Example: add a question before the last step" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={change.trim().length < 5 || draft.isPending} onClick={() => draft.mutate({ description: change, revise: result.draft }, { onSuccess: (res) => (setChange(""), setNote(summarizeChange(result.draft as never, res.draft as never))) })}>
              Revise the draft
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate("/workflows", { state: { draft: result.draft } })}>
              Open in Workflows
            </button>
          </div>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Your workflows</h3>
        {(list.data?.workflows.length ?? 0) === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {list.data?.workflows.map((w) => (
              <li key={w.id}>
                <Link className="inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300" to={where.workflow(w.id)}>
                  Open {w.name} in Workflows
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The AI Assistant: the permanent main chat, its own workspace in the sidebar (not a panel inside another section). It is the same chat component an
 * agent's Chat tab uses (a test chat: no tools, nothing is executed). New conversations can be filed under a project. The choice of agent, the open
 * conversation and an unsent draft are kept while the owner visits other pages.
 */
export function Assistant() {
  const bots = useBots(false);
  const projects = useProjects(false, "");
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const interpret = useInterpret();
  const suggestions = useSuggestions();
  const [results, setResults] = useState<Result[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(RESULTS_KEY) ?? "[]") as Result[];
    } catch {
      return [];
    }
  });
  const keep = (next: Result[]) => {
    setResults(next);
    write(RESULTS_KEY, next.length ? JSON.stringify(next.slice(0, 6)) : null);
  };
  /** Runs before a message goes to the model: lookups, edits and refusals are answered here from real data. "ask:" skips this and sends the text to the model. */
  const beforeSend = async (message: string): Promise<boolean | string> => {
    const asked = /^ask\s*:\s*/i.exec(message);
    if (asked) return message.slice(asked[0].length);
    let reply;
    try {
      reply = await interpret.mutateAsync(message);
    } catch (e) {
      // An edit that the owner checks refused (a phone, or the passphrase was not given) is SHOWN, never quietly turned into ordinary chat.
      if (e instanceof ApiError && e.status === 403) {
        keep([{ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, asked: message, reply: { kind: "action" as const, handled: true as const, message: `Nothing was changed. ${e.friendly}` } }, ...results].slice(0, 6));
        return true;
      }
      throw e;
    }
    if (reply.kind === "none") return false;
    keep([{ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, asked: message, reply }, ...results].slice(0, 6));
    void qc.invalidateQueries({ queryKey: ["assistant"] });
    if (reply.kind === "locate" && reply.resolution === "single" && reply.openNow && reply.candidates[0]) navigate(whereCandidate(reply.candidates[0]));
    return true;
  };
  const askNow = (text: string) => void beforeSend(text);
  const [lookup, setLookup] = useState("");
  const usable = (bots.data ?? []).filter((b) => b.status === "active" && b.model !== null && b.runtime !== "openclaw");
  const [wanted, setWanted] = useState<string | null>(() => read(BOT_KEY));
  const bot = usable.find((b) => b.id === wanted) ?? usable[0];
  const savedConv = read(CONV_KEY);
  const initialConv = savedConv && bot && savedConv.startsWith(`${bot.id}:`) ? savedConv.slice(bot.id.length + 1) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">AI Assistant</h1>
        <p className="hint">Your main place to talk to the AI Workforce. Ask in plain words; open projects, agents and workflows from here.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Assistant chat" className="min-w-0 space-y-3">
          {bots.isLoading && <p role="status">Loading…</p>}
          {!bots.isLoading && usable.length === 0 && (
            <div className="card space-y-2">
              <p>No agent is ready to chat yet. An agent needs a model and must be switched to Active. You can still ask me to find and open things, or show a summary:</p>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = lookup.trim();
                  if (v) void beforeSend(v).then(() => setLookup(""));
                }}
              >
                <label className="min-w-0 flex-1 text-sm">
                  Find or open something
                  <input className="mt-1 block w-full" aria-label="Find or open something" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Example: open my latest project" />
                </label>
                <button className="btn-primary" type="submit" disabled={!lookup.trim() || interpret.isPending}>
                  Go
                </button>
              </form>
              <ResultsPanel results={results} onClear={() => keep([])} />
              <Link className="btn-secondary" to="/agents">
                Open AI Agents
              </Link>
            </div>
          )}
          {bot && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm font-medium">
                  Talk to
                  <select
                    className="mt-1 block"
                    value={bot.id}
                    onChange={(e) => {
                      setWanted(e.target.value);
                      write(BOT_KEY, e.target.value);
                    }}
                  >
                    {usable.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  File new conversations under
                  <select
                    className="mt-1 block"
                    value={projectId ?? ""}
                    onChange={(e) => setParams(e.target.value ? { project: e.target.value } : {}, { replace: true })}
                  >
                    <option value="">No project</option>
                    {(projects.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ResultsPanel results={results} onClear={() => keep([])} />
              <ChatTab
                key={bot.id}
                beforeSend={beforeSend}
                bot={bot}
                hasUnsavedEdits={false}
                compact
                large
                projectId={projectId}
                draftKey={DRAFT_KEY}
                initialConversationId={initialConv}
                onConversation={(id) => write(CONV_KEY, id ? `${bot.id}:${id}` : null)}
              />
            </>
          )}
        </section>
        <div className="min-w-0 space-y-4">
          <SuggestionsPanel items={suggestions.data ?? []} onAsk={askNow} />
          <WorkflowPanel prefill={params.get("workflow") ?? ""} />
          <ChangesPanel />
        </div>
      </div>
    </div>
  );
}
