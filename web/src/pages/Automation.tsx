import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useAutomationRuns,
  useAutomationStatus,
  useBots,
  useCreateSchedule,
  useCreateTrigger,
  useDeleteSchedule,
  useDeleteTrigger,
  useResetAutomationLimits,
  useRunScheduleNow,
  useSchedules,
  useSendEvent,
  useSetAutomationPaused,
  useTriggers,
  useUpdateAutomationLimits,
  useUpdateSchedule,
  useUpdateTrigger,
} from "../api/hooks";
import type { Bot, Schedule, ScheduleInput, ScheduleKind, Trigger, TriggerInput, TriggerSource } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InboundSection } from "../components/InboundSection";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function ErrorLine({ error }: { error: unknown }) {
  const text = errorText(error);
  return text ? (
    <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {text}
    </p>
  ) : null;
}

function Switch({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "none planned");

export function describeTiming(s: Pick<Schedule, "kind" | "intervalMinutes" | "timeOfDay" | "days" | "runAt">): string {
  if (s.kind === "interval") {
    const m = s.intervalMinutes ?? 0;
    return m >= 60 && m % 60 === 0 ? `Every ${m / 60} ${m === 60 ? "hour" : "hours"}` : `Every ${m} minutes`;
  }
  if (s.kind === "once") return `Once on ${s.runAt ? new Date(s.runAt).toLocaleString() : "?"}`;
  const days = s.days.length === 7 ? "Every day" : s.days.map((d) => DAY_NAMES[d]).join(", ");
  return `${days} at ${s.timeOfDay}`;
}

/** "2026-06-15T09:30" (what a date box gives) from an ISO time, in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function BotSelect({ id, value, onChange, bots }: { id: string; value: string; onChange: (v: string) => void; bots: Bot[] }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a bot…</option>
      {bots.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
          {b.model ? "" : " (no model yet)"}
        </option>
      ))}
    </select>
  );
}

// ---------------- safety ----------------

function SafetySection() {
  const status = useAutomationStatus();
  const setPaused = useSetAutomationPaused();
  const s = status.data;
  return (
    <section aria-label="Automation safety" className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Pause all automation</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {s?.paused ? "Paused: no schedule or trigger will start anything." : "Off. Turn this on to stop every schedule and trigger instantly."}
          </p>
        </div>
        <Switch checked={s?.paused ?? false} label="Pause all automation" disabled={!s || setPaused.isPending} onClick={() => setPaused.mutate(!(s?.paused ?? false))} />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Schedules and triggers only run <strong>while this app is running</strong>. If it was off at the planned time, that run is skipped and never replayed.
        Everything is text only and obeys your AI limits, the AI pause switch and free-only mode.
        {s && ` Runs today: ${s.runsToday} of ${s.limits["maxRunsPerDay"]}.`}
      </p>
      <ErrorLine error={setPaused.error} />
    </section>
  );
}

// ---------------- schedules ----------------

function ScheduleForm({ schedule, bots, onDone }: { schedule: Schedule | null; bots: Bot[]; onDone: () => void }) {
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const [name, setName] = useState(schedule?.name ?? "");
  const [botId, setBotId] = useState(schedule?.botId ?? "");
  const [instruction, setInstruction] = useState(schedule?.instruction ?? "");
  const [kind, setKind] = useState<ScheduleKind>(schedule?.kind ?? "interval");
  const [minutes, setMinutes] = useState(String(schedule?.intervalMinutes ?? 60));
  const [time, setTime] = useState(schedule?.timeOfDay ?? "09:00");
  const [days, setDays] = useState<number[]>(schedule?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [runAt, setRunAt] = useState(toLocalInput(schedule?.runAt ?? null));
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const timing: ScheduleInput =
      kind === "interval"
        ? { intervalMinutes: Number(minutes) }
        : kind === "daily"
          ? { timeOfDay: time, days }
          : { runAt: runAt ? new Date(runAt).toISOString() : "" };
    const body: ScheduleInput = { name: name.trim(), botId, instruction: instruction.trim(), kind, ...timing };
    if (schedule) update.mutate({ id: schedule.id, patch: body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  };

  const ready = name.trim() && botId && instruction.trim() && (kind !== "once" || runAt) && (kind !== "daily" || days.length > 0);

  return (
    <form onSubmit={submit} aria-label={schedule ? "Edit schedule" : "New schedule"} className="card space-y-4">
      <h3 className="text-lg font-semibold">{schedule ? "Edit schedule" : "New schedule"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sch-name" className="label">Name</label>
          <input id="sch-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sch-bot" className="label">Which bot</label>
          <BotSelect id="sch-bot" value={botId} onChange={setBotId} bots={bots} />
        </div>
      </div>
      <div>
        <label htmlFor="sch-text" className="label">What should it do each time?</label>
        <textarea id="sch-text" rows={3} maxLength={4000} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <div>
        <label htmlFor="sch-kind" className="label">How often</label>
        <select id="sch-kind" value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
          <option value="interval">Every so many minutes</option>
          <option value="daily">At a time of day</option>
          <option value="once">Once</option>
        </select>
      </div>
      {kind === "interval" && (
        <div>
          <label htmlFor="sch-minutes" className="label">Minutes between runs</label>
          <input id="sch-minutes" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <p className="hint">At least 15 by default. This protects your free-tier limits.</p>
        </div>
      )}
      {kind === "daily" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="sch-time" className="label">Time of day</label>
            <input id="sch-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <fieldset>
            <legend className="label">Days</legend>
            <div className="flex flex-wrap gap-3">
              {DAY_NAMES.map((n, d) => (
                <label key={n} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
      {kind === "once" && (
        <div>
          <label htmlFor="sch-once" className="label">Date and time</label>
          <input id="sch-once" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
        </div>
      )}
      <ErrorLine error={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={!ready || pending}>
          {pending ? "Saving…" : schedule ? "Save changes" : "Create schedule"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {!schedule && <p className="hint">New schedules start switched off. Switch one on when you are ready.</p>}
    </form>
  );
}

function ScheduleCard({ schedule: s, bots, onEdit }: { schedule: Schedule; bots: Bot[]; onEdit: () => void }) {
  const update = useUpdateSchedule();
  const runNow = useRunScheduleNow();
  const remove = useDeleteSchedule();
  const [confirm, setConfirm] = useState(false);
  const bot = bots.find((b) => b.id === s.botId);
  const outcome = runNow.data;

  return (
    <li className="card space-y-3" aria-label={`Schedule ${s.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{s.name}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {s.botName} · {describeTiming(s)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
            {s.enabled ? "On" : "Off"}
          </span>
          <Switch checked={s.enabled} label={`Switch on schedule ${s.name}`} disabled={update.isPending} onClick={() => update.mutate({ id: s.id, patch: { enabled: !s.enabled } })} />
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{s.instruction}</p>
      <p className="text-xs text-slate-500">
        Next run: {s.enabled ? when(s.nextRunAt) : "off"} · Last run: {s.lastRunAt ? when(s.lastRunAt) : "never"}
        {s.consecutiveFailures > 0 && ` · ${s.consecutiveFailures} failed in a row`}
      </p>
      {bot && !bot.model && <p className="text-xs text-amber-700 dark:text-amber-400">{bot.name} has no model yet, so this schedule cannot be switched on.</p>}
      {s.disabledReason && (
        <p role="alert" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {s.disabledReason}
        </p>
      )}
      {outcome && (
        <p role="status" className="text-sm">
          Test run: <strong>{outcome.status}</strong>
          {outcome.reason ? ` (${outcome.reason})` : ""}
          {outcome.taskId && (
            <>
              {" "}
              <Link to={`/tasks/${outcome.taskId}`} className="text-indigo-700 underline dark:text-indigo-400">
                View the task
              </Link>
            </>
          )}
        </p>
      )}
      <ErrorLine error={update.error ?? runNow.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={runNow.isPending} onClick={() => runNow.mutate(s.id)}>
          {runNow.isPending ? "Starting…" : "Run now"}
        </button>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn-secondary" onClick={() => setConfirm(true)}>
          Delete
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={`Delete "${s.name}"?`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => remove.mutate(s.id, { onSettled: () => setConfirm(false) })}
        >
          <p>The schedule is removed. Its past runs stay in the log.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

function SchedulesSection({ bots }: { bots: Bot[] }) {
  const schedules = useSchedules();
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  return (
    <section aria-label="Schedules" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Schedules</h2>
        {editing === null && (
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            New schedule
          </button>
        )}
      </div>
      {editing !== null && <ScheduleForm key={editing === "new" ? "new" : editing.id} schedule={editing === "new" ? null : editing} bots={bots} onDone={() => setEditing(null)} />}
      {schedules.isPending && <p role="status">Loading schedules…</p>}
      {schedules.data && schedules.data.length === 0 && editing === null && (
        <p className="card text-sm text-slate-600 dark:text-slate-400">No schedules yet. A schedule gives a bot a task on a timetable.</p>
      )}
      <ul className="space-y-3">
        {(schedules.data ?? []).map((s) => (
          <ScheduleCard key={s.id} schedule={s} bots={bots} onEdit={() => setEditing(s)} />
        ))}
      </ul>
    </section>
  );
}

// ---------------- triggers ----------------

function TriggerForm({ trigger, bots, onDone }: { trigger: Trigger | null; bots: Bot[]; onDone: () => void }) {
  const create = useCreateTrigger();
  const update = useUpdateTrigger();
  const [name, setName] = useState(trigger?.name ?? "");
  const [source, setSource] = useState<TriggerSource>(trigger?.source ?? "event");
  const [eventName, setEventName] = useState(trigger?.eventName ?? "inbox");
  const [watchBotId, setWatchBotId] = useState(trigger?.watchBotId ?? "");
  const [contains, setContains] = useState(trigger?.contains ?? "");
  const [botId, setBotId] = useState(trigger?.botId ?? "");
  const [template, setTemplate] = useState(trigger?.instructionTemplate ?? "");
  const [cooldown, setCooldown] = useState(String(trigger?.cooldownSeconds ?? 300));
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: TriggerInput = {
      name: name.trim(),
      source,
      botId,
      contains: contains.trim(),
      instructionTemplate: template.trim(),
      cooldownSeconds: Number(cooldown),
      ...(source === "event" ? { eventName: eventName.trim() } : { watchBotId }),
    };
    if (trigger) update.mutate({ id: trigger.id, patch: body }, { onSuccess: onDone });
    else create.mutate(body, { onSuccess: onDone });
  };
  const ready = name.trim() && botId && (source === "event" ? eventName.trim() : watchBotId);

  return (
    <form onSubmit={submit} aria-label={trigger ? "Edit trigger" : "New trigger"} className="card space-y-4">
      <h3 className="text-lg font-semibold">{trigger ? "Edit trigger" : "New trigger"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="trg-name" className="label">Name</label>
          <input id="trg-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="trg-source" className="label">Starts when</label>
          <select id="trg-source" value={source} onChange={(e) => setSource(e.target.value as TriggerSource)}>
            <option value="event">A text event arrives</option>
            <option value="task_result">Another bot finishes a task</option>
          </select>
        </div>
      </div>
      {source === "event" ? (
        <div>
          <label htmlFor="trg-event" className="label">Event name</label>
          <input id="trg-event" value={eventName} maxLength={40} onChange={(e) => setEventName(e.target.value)} />
          <p className="hint">Letters, numbers, dots, dashes. For example "inbox". Telegram and Gmail will send events like this later.</p>
        </div>
      ) : (
        <div>
          <label htmlFor="trg-watch" className="label">Which bot's finished tasks</label>
          <BotSelect id="trg-watch" value={watchBotId} onChange={setWatchBotId} bots={bots} />
        </div>
      )}
      <div>
        <label htmlFor="trg-contains" className="label">Only if the text contains (optional)</label>
        <input id="trg-contains" value={contains} maxLength={200} onChange={(e) => setContains(e.target.value)} />
        <p className="hint">Capital letters don't matter. Leave empty to match everything.</p>
      </div>
      <div>
        <label htmlFor="trg-bot" className="label">Which bot gets the new task</label>
        <BotSelect id="trg-bot" value={botId} onChange={setBotId} bots={bots} />
      </div>
      <div>
        <label htmlFor="trg-template" className="label">Message for the bot (optional)</label>
        <textarea id="trg-template" rows={3} maxLength={1500} value={template} placeholder="A message arrived: {{text}}" onChange={(e) => setTemplate(e.target.value)} />
        <p className="hint">Write {"{{text}}"} where the incoming text should go. Leave empty for a friendly default.</p>
      </div>
      <div>
        <label htmlFor="trg-cooldown" className="label">Cooldown (seconds)</label>
        <input id="trg-cooldown" type="number" min={1} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
        <p className="hint">At least this long between runs. At least 30 by default.</p>
      </div>
      <ErrorLine error={create.error ?? update.error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={!ready || pending}>
          {pending ? "Saving…" : trigger ? "Save changes" : "Create trigger"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
      {!trigger && <p className="hint">New triggers start switched off. Switch one on when you are ready.</p>}
    </form>
  );
}

function TriggerCard({ trigger: t, onEdit }: { trigger: Trigger; onEdit: () => void }) {
  const update = useUpdateTrigger();
  const remove = useDeleteTrigger();
  const [confirm, setConfirm] = useState(false);
  const what = t.source === "event" ? `the event "${t.eventName}" arrives` : `${t.watchBotName} finishes a task`;
  return (
    <li className="card space-y-3" aria-label={`Trigger ${t.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t.name}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            When {what}
            {t.contains ? ` and the text contains "${t.contains}"` : ""}, {t.botName} gets a task.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
            {t.enabled ? "On" : "Off"}
          </span>
          <Switch checked={t.enabled} label={`Switch on trigger ${t.name}`} disabled={update.isPending} onClick={() => update.mutate({ id: t.id, patch: { enabled: !t.enabled } })} />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Cooldown {t.cooldownSeconds}s · Last fired: {t.lastFiredAt ? when(t.lastFiredAt) : "never"}
        {t.consecutiveFailures > 0 && ` · ${t.consecutiveFailures} failed in a row`}
      </p>
      {t.disabledReason && (
        <p role="alert" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t.disabledReason}
        </p>
      )}
      <ErrorLine error={update.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn-secondary" onClick={() => setConfirm(true)}>
          Delete
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={`Delete "${t.name}"?`}
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => remove.mutate(t.id, { onSettled: () => setConfirm(false) })}
        >
          <p>The trigger is removed. Its past runs stay in the log.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

function TriggersSection({ bots }: { bots: Bot[] }) {
  const triggers = useTriggers();
  const [editing, setEditing] = useState<Trigger | "new" | null>(null);
  return (
    <section aria-label="Triggers" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Triggers</h2>
        {editing === null && (
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            New trigger
          </button>
        )}
      </div>
      {editing !== null && <TriggerForm key={editing === "new" ? "new" : editing.id} trigger={editing === "new" ? null : editing} bots={bots} onDone={() => setEditing(null)} />}
      {triggers.isPending && <p role="status">Loading triggers…</p>}
      {triggers.data && triggers.data.length === 0 && editing === null && (
        <p className="card text-sm text-slate-600 dark:text-slate-400">No triggers yet. A trigger starts a task when matching text arrives.</p>
      )}
      <ul className="space-y-3">
        {(triggers.data ?? []).map((t) => (
          <TriggerCard key={t.id} trigger={t} onEdit={() => setEditing(t)} />
        ))}
      </ul>
    </section>
  );
}

// ---------------- test event ----------------

function TestEventSection() {
  const send = useSendEvent();
  const [name, setName] = useState("inbox");
  const [text, setText] = useState("");
  return (
    <section aria-label="Send a test event" className="card space-y-3">
      <h2 className="text-lg font-semibold">Send a test event</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">Pretend a message arrived, to see which triggers react. It only creates text tasks.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && text.trim()) send.mutate({ name: name.trim(), text });
        }}
      >
        <div>
          <label htmlFor="evt-name" className="label">Event name</label>
          <input id="evt-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="evt-text" className="label">Text</label>
          <textarea id="evt-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={!name.trim() || !text.trim() || send.isPending}>
          {send.isPending ? "Sending…" : "Send event"}
        </button>
      </form>
      <ErrorLine error={send.error} />
      {send.data && (
        <ul aria-label="Event results" className="space-y-1 text-sm">
          {send.data.map((o, i) => (
            <li key={i}>
              <strong>{o.triggerName}</strong>: {o.status}
              {o.reason ? ` (${o.reason})` : ""}
              {o.taskId && (
                <>
                  {" "}
                  <Link to={`/tasks/${o.taskId}`} className="text-indigo-700 underline dark:text-indigo-400">
                    View the task
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- the run log ----------------

function RunsSection() {
  const runs = useAutomationRuns(30);
  return (
    <section aria-label="Recent automatic runs" className="card space-y-2">
      <h2 className="text-lg font-semibold">Recent automatic runs</h2>
      {runs.data && runs.data.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">Nothing has run automatically yet.</p>}
      <ul className="space-y-1 text-sm">
        {(runs.data ?? []).map((r) => (
          <li key={r.id}>
            <span className={r.status === "started" ? "font-medium text-emerald-700 dark:text-emerald-400" : r.status === "failed" ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-amber-700 dark:text-amber-300"}>
              {r.status === "started" ? "Started" : r.status === "failed" ? "Failed" : "Skipped"}
            </span>{" "}
            {r.source} “{r.sourceName}”{r.reason ? `: ${r.reason}` : ""}
            {r.taskId && (
              <>
                {" "}
                <Link to={`/tasks/${r.taskId}`} className="text-indigo-700 underline dark:text-indigo-400">
                  task
                </Link>
              </>
            )}
            <span className="text-slate-500"> · {new Date(r.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- limits ----------------

const LIMIT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "minIntervalMinutes", label: "Shortest time between runs (minutes)", hint: "Never below 5." },
  { key: "maxRunsPerDay", label: "Automatic runs per day, everything together", hint: "The most allowed is 200." },
  { key: "maxRunsPerSourcePerDay", label: "Automatic runs per day, one schedule or trigger", hint: "The most allowed is 100." },
  { key: "maxConsecutiveFailures", label: "Failures in a row before switching itself off", hint: "Between 1 and 10." },
  { key: "maxHops", label: "How many times a trigger may start a task that starts another", hint: "Between 1 and 4. Stops endless chains." },
  { key: "minCooldownSeconds", label: "Shortest trigger cooldown (seconds)", hint: "Never below 10." },
];

function LimitsSection() {
  const status = useAutomationStatus();
  const update = useUpdateAutomationLimits();
  const reset = useResetAutomationLimits();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const limits = status.data?.limits;
  useEffect(() => {
    if (limits) setDraft(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, String(v)])));
  }, [limits]);
  if (!limits) return null;
  const changed = Object.entries(draft).filter(([k, v]) => v !== String(limits[k]));
  return (
    <section aria-label="Automation limits" className="space-y-3">
      <h2 className="text-lg font-semibold">Automation limits</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">Every automatic run also counts against your AI limits and teamwork limits (Settings → Advanced and Workflow Settings).</p>
      <div className="card grid gap-4 sm:grid-cols-2">
        {LIMIT_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`auto-${f.key}`} className="label">{f.label}</label>
            <input id={`auto-${f.key}`} type="number" min={0} value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            <p className="hint">{f.hint}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={changed.length === 0 || update.isPending} onClick={() => update.mutate(Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])))}>
          {update.isPending ? "Saving…" : "Save automation limits"}
        </button>
        <button type="button" className="btn-secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
          Reset automation limits
        </button>
        {changed.length > 0 && <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>}
      </div>
      <ErrorLine error={update.error ?? reset.error} />
    </section>
  );
}

export function Automation() {
  const bots = useBots(false);
  const usable = bots.data ?? [];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Schedules and triggers</h1>
      <SafetySection />
      <SchedulesSection bots={usable} />
      <TriggersSection bots={usable} />
      <InboundSection bots={usable} />
      <TestEventSection />
      <RunsSection />
      <LimitsSection />
    </div>
  );
}
