import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useBots } from "../api/hooks";
import { useGroup, useGroupAct, useGroupActivity, useGroupMessages, useGroups, useGroupStatus, type GroupInfo } from "../api/collabHooks";
import type { DecisionDraft } from "../api/workHooks";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const MODE_TEXT: Record<string, string> = {
  mention_only: "Only bots I mention answer",
  relevant_bot: "The bot whose role fits answers",
  group_discussion: "Up to three fitting bots answer",
  manager_coordinates: "The coordinator answers or hands parts on",
  all_invited: "Every member answers (up to 5)",
};

function Err({ e }: { e: unknown }) {
  const t = errorText(e);
  return t ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t}</p> : null;
}

function Detail({ id }: { id: string }) {
  const g = useGroup(id);
  const msgs = useGroupMessages(id);
  const activity = useGroupActivity(id);
  const bots = useBots(false);
  const act = useGroupAct();
  const [text, setText] = useState("");
  const [direct, setDirect] = useState("");
  const [addBot, setAddBot] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [handText, setHandText] = useState("");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [duty, setDuty] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const grp: GroupInfo | undefined = g.data;
  if (g.isLoading) return <p className="hint">Loading…</p>;
  if (!grp) return <p role="alert" className="text-red-700 dark:text-red-300">{errorText(g.error) ?? "Group not found."}</p>;
  const memberIds = new Set(grp.members.map((m) => m.botId));
  const candidates = (bots.data ?? []).filter((b) => !b.archived && !memberIds.has(b.id));
  return (
    <section className="card space-y-4" aria-label={`Group ${grp.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{grp.avatar} {grp.name}{grp.paused ? " (paused)" : ""}</h2>
        <span className="hint">{grp.kind === "division" ? "Division group" : grp.kind === "project" ? "Project group" : "Group"}</span>
      </div>
      {grp.description && <p className="text-sm">{grp.description}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Who answers when I write
          <select className="input w-full" aria-label="Participation mode" value={grp.participationMode} onChange={(e) => act.mutate({ op: "update", id, patch: { participationMode: e.target.value } })}>
            {Object.entries(MODE_TEXT).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Coordinator
          <select className="input w-full" aria-label="Coordinator" value={grp.coordinatorBotId ?? ""} onChange={(e) => act.mutate({ op: "update", id, patch: { coordinatorBotId: e.target.value || null } })}>
            <option value="">None (I decide)</option>
            {grp.members.filter((m) => m.role !== "observer").map((m) => (
              <option key={m.botId} value={m.botId}>{m.botName}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">At most {grp.maxRounds} bot turns follow one of my messages. A bot's reply never starts another bot by itself.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => act.mutate({ op: "update", id, patch: { paused: !grp.paused } })}>{grp.paused ? "Resume group" : "Pause group"}</button>
        <button className="btn-secondary" onClick={() => act.mutate({ op: "archive", id, on: !grp.archived })}>{grp.archived ? "Unarchive" : "Archive"}</button>
      </div>

      <h3 className="font-semibold">Members and responsibilities</h3>
      <ul className="space-y-2">
        {grp.members.map((m) => (
          <li key={m.botId} className="rounded-md border border-slate-300 p-2 text-sm dark:border-slate-700" aria-label={`Member ${m.botName}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{m.botName} <span className="hint font-normal">({m.role})</span></span>
              <button className="btn-secondary" aria-label={`Remove ${m.botName}`} onClick={() => act.mutate({ op: "removeMember", id, botId: m.botId })}>Remove</button>
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <input className="input flex-1" aria-label={`Responsibility of ${m.botName}`} placeholder={m.responsibility ?? "What is this bot responsible for here?"} value={duty[m.botId] ?? ""} onChange={(e) => setDuty({ ...duty, [m.botId]: e.target.value })} />
              <button className="btn-secondary" disabled={!(duty[m.botId] ?? "").trim()} aria-label={`Save responsibility of ${m.botName}`} onClick={() => act.mutate({ op: "duty", id, botId: m.botId, duty: duty[m.botId]! }, { onSuccess: () => setDuty({ ...duty, [m.botId]: "" }) })}>Save</button>
            </div>
            {m.responsibility && <p className="hint">Responsible for: {m.responsibility}</p>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select className="input" aria-label="Bot to add" value={addBot} onChange={(e) => setAddBot(e.target.value)}>
          <option value="">Add a bot…</option>
          {candidates.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button className="btn-secondary" disabled={!addBot} onClick={() => act.mutate({ op: "addMember", id, botId: addBot }, { onSuccess: () => setAddBot("") })}>Add to group</button>
      </div>
      <p className="hint">Joining a group gives a bot no permission, folder, program or secret, and no right to delegate.</p>

      <h3 className="font-semibold">Conversation</h3>
      <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Group messages">
        {(msgs.data ?? []).length === 0 && <li className="hint">No messages yet.</li>}
        {(msgs.data ?? []).map((m) => (
          <li key={m.id} className={`rounded-md p-2 text-sm ${m.senderKind === "user" ? "bg-sky-50 dark:bg-sky-950" : m.senderKind === "system" ? "bg-amber-50 dark:bg-amber-950" : "bg-slate-100 dark:bg-slate-800"}`}>
            <p className="hint">{m.senderName}{m.visibility === "direct" ? " (direct)" : ""}{m.kind !== "message" ? ` · ${m.kind.replace(/_/g, " ")}` : ""} · {new Date(m.createdAt).toLocaleTimeString()}</p>
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
            {m.taskId && <Link to={`/tasks/${m.taskId}`} className="hint underline">open the task</Link>}
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ op: "post", id, content: text, directToBotId: direct || null }, { onSuccess: () => setText("") });
        }}
      >
        <label className="block text-sm">
          Write to the group (use @Name to ask one bot)
          <textarea className="input w-full" aria-label="Group message" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <select className="input" aria-label="Send privately to" value={direct} onChange={(e) => setDirect(e.target.value)}>
            <option value="">Everyone in the group</option>
            {grp.members.filter((m) => m.role !== "observer").map((m) => (
              <option key={m.botId} value={m.botId}>Only {m.botName}</option>
            ))}
          </select>
          <button className="btn-primary" type="submit" disabled={!text.trim() || act.isPending}>Send</button>
        </div>
      </form>

      <h3 className="font-semibold">Hand work from one bot to another</h3>
      <div className="flex flex-wrap gap-2">
        <select className="input" aria-label="Handoff from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">From…</option>
          {grp.members.map((m) => <option key={m.botId} value={m.botId}>{m.botName}</option>)}
        </select>
        <select className="input" aria-label="Handoff to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">To…</option>
          {grp.members.map((m) => <option key={m.botId} value={m.botId}>{m.botName}</option>)}
        </select>
        <input className="input flex-1" aria-label="Handoff instruction" placeholder="What should they do?" value={handText} onChange={(e) => setHandText(e.target.value)} />
        <button className="btn-secondary" disabled={!from || !to || !handText.trim()} onClick={() => act.mutate({ op: "handoff", id, fromBotId: from, toBotId: to, instruction: handText }, { onSuccess: () => setHandText("") })}>Hand over</button>
      </div>
      <p className="hint">A handoff only works if the first bot is allowed to delegate to the second (Agents &gt; Team). Membership alone is not enough.</p>

      <h3 className="font-semibold">Disagree? Ask for recommendations</h3>
      <div className="flex flex-wrap gap-2">
        <input className="input flex-1" aria-label="Question for recommendations" placeholder="What should the group decide?" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button className="btn-secondary" disabled={question.trim().length < 8 || act.isPending} onClick={() => act.mutate({ op: "recommend", id, question }, { onSuccess: (r) => setDraft((r as { draft: DecisionDraft }).draft) })}>Ask members (one call each)</button>
      </div>
      {draft && (
        <div className="rounded-md border border-slate-300 p-2 text-sm dark:border-slate-700" aria-label="Recommendations">
          {draft.bots.map((b) => (
            <p key={b.botId}><strong>{b.botName}:</strong> {b.problem ?? b.options.map((o) => o.title).join(" · ")}</p>
          ))}
          <button className="btn-primary mt-2" onClick={() => act.mutate({ op: "escalate", id, draftId: draft.draftId, title: question.slice(0, 100) }, { onSuccess: () => { setDraft(null); setDone("Sent to Decisions. Open Decisions to compare, discuss and decide."); } })}>Send to Decisions</button>
        </div>
      )}
      {done && <p className="text-sm" role="status">{done} <Link to="/decisions" className="underline">Open Decisions</Link></p>}

      <h3 className="font-semibold">Activity</h3>
      <ul className="space-y-1 text-sm" aria-label="Group activity">
        {(activity.data?.events ?? []).slice(0, 12).map((e) => (
          <li key={e.id} className="hint">{new Date(e.at).toLocaleString()} · {e.kind.replace(/_/g, " ")}{e.from ? ` · ${e.from}` : ""}{e.to ? ` → ${e.to}` : ""}</li>
        ))}
        {(activity.data?.tasks ?? []).slice(0, 6).map((t) => (
          <li key={t.id}><Link to={`/tasks/${t.id}`} className="underline">{t.botName}: {t.instruction}</Link> <span className="hint">({t.status})</span></li>
        ))}
      </ul>
      <Err e={act.error} />
    </section>
  );
}

export function Groups() {
  const status = useGroupStatus();
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("general");
  const [division, setDivision] = useState("personal_office");
  const act = useGroupAct();
  const on = status.data?.enabled === true;
  const list = useGroups(archived, on);
  if (status.isLoading) return <p className="hint">Loading…</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Groups</h1>
        <p className="hint">Teams of bots that work through the Manager: normal tasks, the delegation allow-list, and your approval for anything outside.</p>
      </div>
      {!on ? (
        <section className="card space-y-2" aria-label="Groups are off">
          <p className="font-semibold">Groups are switched off.</p>
          <p className="text-sm">When they are on, you can write to a group and its bots answer through normal tasks, limited to a few turns per message. Nothing starts without you, the Guardian's pause still stops everything, and group membership never gives a bot a permission.</p>
          <button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate({ op: "enable", on: true })}>Switch groups on</button>
          <Err e={act.error} />
        </section>
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate({ op: "create", body: { name, kind, ...(kind === "division" ? { division } : {}) } }, { onSuccess: () => setName("") });
            }}
          >
            <label className="text-sm">
              New group name
              <input className="input ml-2" aria-label="New group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </label>
            <select className="input" aria-label="Group kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="general">Ordinary group</option>
              <option value="division">Division group</option>
            </select>
            {kind === "division" && (
              <select className="input" aria-label="Division" value={division} onChange={(e) => setDivision(e.target.value)}>
                {(status.data?.divisions ?? []).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
              </select>
            )}
            <button className="btn-primary" type="submit" disabled={!name.trim() || act.isPending}>Create group</button>
          </form>
          <Err e={act.error} />
          <label className="text-sm"><input type="checkbox" aria-label="Show archived groups" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="min-w-0 space-y-2">
              {list.data?.length === 0 && <li className="hint">No groups here.</li>}
              {list.data?.map((g) => (
                <li key={g.id} className={`card ${selected === g.id ? "ring-2 ring-sky-500" : ""}`}>
                  <button className="w-full text-left" aria-label={`Open group ${g.name}`} onClick={() => setSelected(g.id)}>
                    <span className="font-semibold">{g.avatar} {g.name}</span>
                    <span className="hint block">{g.members.length} members · {MODE_TEXT[g.participationMode]}{g.paused ? " · paused" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">{selected ? <Detail id={selected} /> : <p className="hint">Choose a group.</p>}</div>
          </div>
          <button className="btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ op: "enable", on: false })}>Switch groups off</button>
        </>
      )}
    </div>
  );
}
