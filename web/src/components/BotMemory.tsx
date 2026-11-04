import { useBotMemory, useSetBotMemory } from "../api/hooks";
import type { Bot } from "../api/types";

/** On a bot's Permissions tab: may it use its own notes, and may it see the shared knowledge (off by default)? */
export function BotMemory({ bot }: { bot: Bot }) {
  const q = useBotMemory(bot.id);
  const set = useSetBotMemory(bot.id);
  if (!q.data) return null;
  return (
    <section aria-label="Memory" className="space-y-2">
      <h3 className="font-semibold">Memory</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Notes live on the Knowledge page. Pinned notes are added to this bot's instructions. The bot can also search them. Nothing here is ever sent to an outside service.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={bot.archived || set.isPending} checked={q.data.usePrivate} onChange={(e) => set.mutate({ usePrivate: e.target.checked })} />
          Use this bot's own notes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={bot.archived || set.isPending} checked={q.data.useShared} onChange={(e) => set.mutate({ useShared: e.target.checked })} />
          Use the shared knowledge
        </label>
      </div>
    </section>
  );
}
