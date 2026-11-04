import { ApiError } from "../api/client";
import { BotCapabilities } from "./BotCapabilities";
import { BotIntegrations } from "./BotIntegrations";
import { BotMemory } from "./BotMemory";
import { useAudit, useSetReadPermission } from "../api/hooks";
import { CONNECTORS, CONNECTOR_LABELS, type Bot } from "../api/types";

export function PermissionsTab({ bot }: { bot: Bot }) {
  const audit = useAudit(bot.id);
  const setRead = useSetReadPermission(bot.id);
  const error = setRead.error instanceof ApiError ? setRead.error.friendly : setRead.error ? "Could not change permission." : null;

  return (
    <div role="tabpanel" aria-label="Permissions" className="space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Everything starts <strong>off</strong>. Reading from Gmail, Telegram or the browser works for this bot only if you switch it on here, and
        the connection must also be set up in Settings. Anything a bot sends or submits always waits for your approval.
      </p>

      {bot.archived && (
        <p className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
          This bot is archived. Unarchive it to change permissions.
        </p>
      )}

      <ul className="space-y-3">
        {CONNECTORS.map((connector) => {
          const permission = bot.permissions.find((p) => p.connector === connector);
          const enabled = permission?.readEnabled ?? false;
          const label = CONNECTOR_LABELS[connector];
          return (
            <li key={connector} className="card flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">{label}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Read access: <strong>{enabled ? "On" : "Off"}</strong>
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  <span aria-hidden="true">🔒 </span>
                  Writing: always requires your approval (cannot be changed)
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`Allow ${label} read access`}
                disabled={bot.archived || setRead.isPending}
                onClick={() => setRead.mutate({ connector, readEnabled: !enabled })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? "bg-indigo-600" : "bg-slate-400 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${enabled ? "left-5" : "left-0.5"}`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <BotCapabilities bot={bot} />
      <BotIntegrations bot={bot} />
      <BotMemory bot={bot} />

      <section aria-label="Permission change log">
        <h3 className="mb-2 font-semibold">Change log</h3>
        {audit.isPending && <p role="status">Loading…</p>}
        {audit.isError && <p role="alert">Could not load the change log.</p>}
        {audit.data && audit.data.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">No permission changes yet.</p>
        )}
        {audit.data && audit.data.length > 0 && (
          <ul className="space-y-1 text-sm">
            {audit.data.map((entry) => (
              <li key={entry.id}>
                {CONNECTOR_LABELS[entry.connector]} read access turned <strong>{entry.newValue ? "on" : "off"}</strong>
                <span className="text-slate-500"> · {new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
