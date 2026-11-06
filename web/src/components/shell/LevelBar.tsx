import { useSetRecMode } from "../../api/hooks";
import { LEVELS, levelLabel, shownAt, useInterfaceLevel, type Level } from "../../lib/interfaceLevel";
import { guidanceFor } from "../../lib/guidance";
import { sectionFor } from "./nav";
import { useLocation } from "react-router-dom";

/** Choosing a level also sets the Recommended Settings detail level to the same word (best effort), so there is one idea of "how much do I want to see". */
export function useChooseLevel(): [Level, (l: Level) => void] {
  const [level, setLevel] = useInterfaceLevel();
  const rec = useSetRecMode();
  return [
    level,
    (l: Level) => {
      setLevel(l);
      rec.mutate(l === "simple" ? "beginner" : l, { onError: () => undefined });
    },
  ];
}

/** The three levels as one radio group. `compact` leaves out the explanation. */
export function LevelBar({ compact = false }: { compact?: boolean }) {
  const [level, choose] = useChooseLevel();
  const current = LEVELS.find((l) => l.id === level)!;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Interface level">
      <span id="level-label" className="text-xs font-semibold text-slate-600 dark:text-slate-400">
        Interface level
      </span>
      <div role="group" aria-labelledby="level-label" className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={level === l.id}
            aria-label={`${l.label} level`}
            className={`min-h-11 px-3 text-sm font-medium ${level === l.id ? "bg-indigo-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
            onClick={() => choose(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
      {!compact && (
        <p aria-live="polite" className="min-w-0 flex-1 basis-64 text-xs text-slate-600 dark:text-slate-400">
          {current.text} Nothing is removed: every screen is still reachable by search or by asking the assistant.
        </p>
      )}
    </div>
  );
}

/** At Simple and Intermediate: a plain-language guide for the current screen. Never shown at Advanced. */
export function GuidanceNote() {
  const [level] = useInterfaceLevel();
  const { pathname } = useLocation();
  const text = level === "advanced" ? null : guidanceFor(pathname);
  if (!text) return null;
  return (
    <p role="note" aria-label="Plain-language guide" className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
      <strong>What is this? </strong>
      {text}
    </p>
  );
}

/** A screen the current level does not list is still reachable (by address, search or the assistant). Say so, and offer to list it. */
export function HiddenScreenNotice() {
  const [level, choose] = useChooseLevel();
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  if (!section || shownAt(section.level, level)) return null;
  return (
    <div role="note" aria-label="Hidden screen" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="min-w-0 flex-1">
        “{section.label}” is part of the {levelLabel(section.level)} level, so it is not in the menu at {levelLabel(level)}. You are seeing it because you opened it directly.
      </span>
      <button type="button" className="btn-secondary" onClick={() => choose(section.level)}>
        Show it in the menu
      </button>
    </div>
  );
}
