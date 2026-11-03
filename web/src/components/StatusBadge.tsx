import type { BotStatus } from "../api/types";

const STYLES: Record<BotStatus, string> = {
  disabled: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const LABELS: Record<BotStatus, string> = { disabled: "Disabled", paused: "Paused", active: "Active" };

export function StatusBadge({ status, archived }: { status: BotStatus; archived?: boolean }) {
  if (archived) {
    return (
      <span className="rounded-full bg-slate-300 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-200">
        Archived
      </span>
    );
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
