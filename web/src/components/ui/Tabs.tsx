import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A small count or note shown after the label. */
  badge?: ReactNode;
}

/**
 * Tabs inside one page (the page's own sub-areas). Arrow keys, Home and End move between tabs; the panel is labelled by its tab.
 * Pass the same `id` base to `TabPanel`. Touch targets are at least 44 px tall.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: TabItem<T>[]; value: T; onChange: (id: T) => void }) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = tabs[next]!;
    onChange(t.id);
    refs.current[t.id]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1 dark:border-slate-800">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`awp-hover -mb-px flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-medium ${
              on ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== null && (
              <span className="rounded-full bg-slate-200 px-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The panel that belongs to the active tab. `tabsId` is not needed: the panel is found by role and name. */
export function TabPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="tabpanel" aria-label={label} className="awp-fade-in space-y-6 pt-4">
      {children}
    </div>
  );
}
