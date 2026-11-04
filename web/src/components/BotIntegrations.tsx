import { ApiError } from "../api/client";
import { useBotIntegrations, useSetBotIntegrations } from "../api/hooks";
import type { Bot } from "../api/types";

/** On a bot's Permissions tab: which integrations this bot may READ through. Writes are never covered by this: each one waits for your approval. */
export function BotIntegrations({ bot }: { bot: Bot }) {
  const data = useBotIntegrations(bot.id);
  const set = useSetBotIntegrations(bot.id);
  const on = new Set(data.data?.enabled ?? []);
  const error = set.error instanceof ApiError ? set.error.friendly : set.error ? "That did not work." : null;
  if (!data.data || data.data.available.length === 0) return null;
  return (
    <section aria-label="Integrations" className="space-y-2">
      <h3 className="font-semibold">Integrations (reading)</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">Off by default. Turning one on lets this bot read through it. Anything a bot wants to create or send still waits for your approval.</p>
      <div className="flex flex-wrap gap-4">
        {data.data.available.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={bot.archived || set.isPending} checked={on.has(c.id)} onChange={(e) => set.mutate(e.target.checked ? [...on, c.id] : [...on].filter((x) => x !== c.id))} />
            {c.label}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
