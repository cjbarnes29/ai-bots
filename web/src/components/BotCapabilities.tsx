import { ApiError } from "../api/client";
import { useBotCapabilities, useSetBotSkills, useSetBotTools, useSkills, useTools } from "../api/hooks";
import type { Bot } from "../api/types";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

/** On a bot's Permissions tab: which skills it has, and which tools (that need explicit access) it may use. */
export function BotCapabilities({ bot }: { bot: Bot }) {
  const caps = useBotCapabilities(bot.id);
  const skills = useSkills(false);
  const tools = useTools();
  const setSkills = useSetBotSkills(bot.id);
  const setTools = useSetBotTools(bot.id);
  const mySkills = new Set(caps.data?.skills ?? []);
  const myTools = new Set(caps.data?.tools ?? []);
  const assignable = (tools.data ?? []).filter((t) => t.requiresAssignment);
  const error = errorText(setSkills.error ?? setTools.error);

  return (
    <section aria-label="Skills and tools" className="space-y-4">
      <div>
        <h3 className="font-semibold">Skills</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">Reusable instructions added to this bot's prompt. Manage the library in Settings.</p>
        {(skills.data ?? []).length === 0 && <p className="hint">No skills yet.</p>}
        <div className="mt-1 flex flex-wrap gap-4">
          {(skills.data ?? []).map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={bot.archived || setSkills.isPending}
                checked={mySkills.has(s.id)}
                onChange={(e) => setSkills.mutate(e.target.checked ? [...mySkills, s.id] : [...mySkills].filter((x) => x !== s.id))}
              />
              {s.name}
              {!s.enabled && <span className="hint"> (off)</span>}
            </label>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold">Tool access</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Tools that need your explicit permission. A tool that is not available cannot be given. Gmail, Telegram and the browser are switched on above.
        </p>
        <div className="mt-1 flex flex-wrap gap-4">
          {assignable.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={bot.archived || setTools.isPending || (t.status === "unavailable" && !myTools.has(t.id))}
                checked={myTools.has(t.id)}
                onChange={(e) => setTools.mutate(e.target.checked ? [...myTools, t.id] : [...myTools].filter((x) => x !== t.id))}
              />
              {t.name}
              {t.status === "unavailable" && <span className="hint"> (not available)</span>}
            </label>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
