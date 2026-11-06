import { useCallback, useSyncExternalStore } from "react";

/**
 * Interface levels (owner decision D-079): Simple, Intermediate and Advanced change which screens are SHOWN in the menu and whether plain-language guides
 * appear. They never change what the app can do, never remove a screen (every address still works, and search and the AI Assistant still find everything),
 * never hide a safety control (approvals, the owner checks, the "not verified" labels), and never change a saved setting. The choice is kept in this browser
 * only (no database). The default is Advanced, so the app looks exactly as it did before until the owner picks another level.
 */
export type Level = "simple" | "intermediate" | "advanced";
export const LEVELS: { id: Level; label: string; text: string }[] = [
  { id: "simple", label: "Simple", text: "Just the essentials: tell the AI Assistant what you want, keep track of your projects, and approve what needs you." },
  { id: "intermediate", label: "Intermediate", text: "Adds workflows, agents, your knowledge and the history of tasks, so you can review what the assistant proposes." },
  { id: "advanced", label: "Advanced", text: "Everything, including AI models, integrations, creative tools and the technical settings." },
];
const RANK: Record<Level, number> = { simple: 0, intermediate: 1, advanced: 2 };
export const KEY = "awp-interface-level";
const EVENT = "awp-interface-level-changed";

export const isLevel = (v: unknown): v is Level => v === "simple" || v === "intermediate" || v === "advanced";
/** Is something that belongs from `min` upwards shown at `current`? */
export const shownAt = (min: Level, current: Level): boolean => RANK[current] >= RANK[min];
export const levelLabel = (l: Level): string => LEVELS.find((x) => x.id === l)!.label;

function read(): Level {
  try {
    const v = localStorage.getItem(KEY);
    return isLevel(v) ? v : "advanced";
  } catch {
    return "advanced";
  }
}
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // another tab of this browser changed it
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The current level and a setter. Every component using it updates at once; no page reload, so nothing typed is lost. */
export function useInterfaceLevel(): [Level, (l: Level) => void] {
  const level = useSyncExternalStore(subscribe, read, () => "advanced" as Level);
  const set = useCallback((l: Level) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage may be unavailable (private mode): the level then lasts only until the page is reloaded */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [level, set];
}
