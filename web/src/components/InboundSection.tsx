import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useCreateInbound, useDeleteInbound, useInbound, useUpdateInbound } from "../api/hooks";
import type { Bot } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const LABEL = { telegram: "Telegram", gmail: "Gmail" } as const;

/**
 * Inbound messages: new Telegram / Gmail messages become text events that your triggers can react to.
 * Off by default; the chosen bot must be allowed to read that connector; checks are slow and limited.
 */
export function InboundSection({ bots }: { bots: Bot[] }) {
  const inbound = useInbound();
  const create = useCreateInbound();
  const update = useUpdateInbound();
  const remove = useDeleteInbound();
  const [connector, setConnector] = useState<"telegram" | "gmail">("telegram");
  const [botId, setBotId] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const sources = inbound.data?.sources ?? [];
  const min = inbound.data?.limits.minIntervalMinutes ?? 30;
  const target = sources.find((s) => s.id === removing);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!botId) return;
    create.mutate({ connector, botId }, { onSuccess: () => setBotId("") });
  };

  return (
    <section aria-label="Inbound messages" className="card space-y-3">
      <h2 className="text-lg font-semibold">Inbound messages</h2>
      <p className="text-sm">
        Let new Telegram or Gmail messages start your triggers. Each message becomes a text event (for example <code>telegram_message</code>) and a trigger decides what happens.
        Nothing is checked until you switch a source on. The bot you pick must be allowed to <strong>read</strong> that connector (its Permissions tab), every check counts toward that
        bot's daily outside-read limit, the first check only notes what is already there, and at most 3 new messages per check are used. Checks are never more often than every {min} minutes.
      </p>

      {sources.length === 0 && <p className="hint">No message sources yet.</p>}
      <ul className="space-y-2">
        {sources.map((s) => (
          <li key={s.id} aria-label={`${LABEL[s.connector]} messages for ${s.botName}`} className="space-y-1 border-t border-slate-200 pt-2 first:border-0 first:pt-0 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {LABEL[s.connector]} → event <span className="font-mono">{s.eventName}</span> · bot {s.botName}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-sm">
                  Every{" "}
                  <select
                    aria-label={`Check interval for ${LABEL[s.connector]} messages for ${s.botName}`}
                    className="rounded-md border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                    value={s.intervalMinutes}
                    onChange={(e) => update.mutate({ id: s.id, patch: { intervalMinutes: Number(e.target.value) } })}
                  >
                    {[30, 60, 120, 360, 720, 1440].map((m) => (
                      <option key={m} value={m}>
                        {m >= 60 ? `${m / 60} h` : `${m} min`}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label={`Check ${LABEL[s.connector]} messages for ${s.botName}`}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: s.id, patch: { enabled: !s.enabled } })}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${s.enabled ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${s.enabled ? "left-5" : "left-0.5"}`} />
                </button>
                <button type="button" className="btn-secondary" onClick={() => setRemoving(s.id)}>
                  Remove
                </button>
              </div>
            </div>
            <p className="hint">
              {s.lastPollAt ? `Last checked ${new Date(s.lastPollAt).toLocaleString()} · ${s.lastNewCount} new message${s.lastNewCount === 1 ? "" : "s"} used` : "Not checked yet"}
              {s.consecutiveFailures > 0 ? ` · ${s.consecutiveFailures} failed in a row` : ""}
            </p>
            {s.disabledReason && (
              <p role="status" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Switched off: {s.disabledReason}
              </p>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Watch</span>
          <select aria-label="Connector to watch" value={connector} onChange={(e) => setConnector(e.target.value as "telegram" | "gmail")} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            <option value="telegram">Telegram</option>
            <option value="gmail">Gmail (unread, last day)</option>
          </select>
        </label>
        <label>
          <span className="label">Using bot</span>
          <select aria-label="Bot that reads" value={botId} onChange={(e) => setBotId(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
            <option value="">Choose a bot…</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-primary" disabled={!botId || create.isPending}>
          Add source (starts off)
        </button>
      </form>
      {errorText(create.error ?? update.error ?? remove.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(create.error ?? update.error ?? remove.error)}
        </p>
      )}
      {target && (
        <ConfirmDialog
          title="Remove this message source?"
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(target.id, { onSettled: () => setRemoving(null) })}
        >
          <p>It stops checking and forgets which messages it has seen. Your triggers are not affected.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
