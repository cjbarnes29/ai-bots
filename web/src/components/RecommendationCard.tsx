import { Link } from "react-router-dom";
import type { RecItem, RecMode, RecStatus } from "../api/types";

const CHIP: Record<RecStatus, string> = {
  recommended: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  current: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  custom: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  not_configured: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  requires_connection: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  requires_attention: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * One recommendation, the same everywhere (the assistant and the settings sections use this one component).
 * Beginner sees the plain reason; Intermediate adds benefits and trade-offs; Advanced adds what was checked. Nothing here changes a setting by itself:
 * the buttons call back to the page, which asks the server to apply exactly this one.
 */
export function RecommendationCard({
  item,
  mode,
  busy,
  selected,
  onSelect,
  onApply,
  onRestore,
}: {
  item: RecItem;
  mode: RecMode;
  busy?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  onApply?: () => void;
  onRestore?: (historyId: string) => void;
}) {
  const advice = item.kind === "advice";
  return (
    <li aria-label={item.title} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        {item.canApply && onSelect && (
          <input type="checkbox" aria-label={`Select ${item.title}`} checked={selected ?? false} onChange={(e) => onSelect(e.target.checked)} />
        )}
        <h4 className="font-semibold">{item.title}</h4>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[item.status]}`}>{item.label}</span>
        {advice && <span className="hint">advice</span>}
      </div>

      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="hint">Current</dt>
          <dd className="[overflow-wrap:anywhere]">{item.current}</dd>
        </div>
        {item.recommended !== null && (
          <div>
            <dt className="hint">Recommended</dt>
            <dd className="font-medium [overflow-wrap:anywhere]">{item.recommended}</dd>
          </div>
        )}
      </dl>

      {item.note && <p className={item.status === "requires_attention" ? "text-amber-800 dark:text-amber-300" : "text-slate-700 dark:text-slate-300"}>{item.note}</p>}
      {item.status === "custom" && item.canApply && <p className="hint">You set this yourself. Applying the recommendation replaces your value; you can restore it afterwards.</p>}
      {item.cost === "paid" && <p className="text-red-700 dark:text-red-300">This could cost money, so it is never applied from here.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {item.canApply && onApply && (
          <button type="button" className="btn-primary" disabled={busy} onClick={onApply} aria-label={`Apply the recommendation for ${item.title}`}>
            Apply recommended
          </button>
        )}
        <Link to={item.customizeAt} className="btn-secondary" aria-label={`Customize ${item.title}`}>
          Customize
        </Link>
        {item.lastChange && onRestore && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onRestore(item.lastChange!.historyId)} aria-label={`Restore the previous value of ${item.title}`}>
            Restore previous
          </button>
        )}
      </div>

      {(item.why || item.benefits.length > 0 || item.tradeoffs.length > 0 || item.compatibility.length > 0) && (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Why is this recommended?</summary>
          <div className="mt-1 space-y-1">
            {item.why && <p>{item.why}</p>}
            {mode !== "beginner" && item.benefits.length > 0 && (
              <p>
                <strong>Benefits:</strong> {item.benefits.join("; ")}.
              </p>
            )}
            {mode !== "beginner" && item.tradeoffs.length > 0 && (
              <p>
                <strong>Trade-offs:</strong> {item.tradeoffs.join("; ")}.
              </p>
            )}
            {mode === "advanced" && item.compatibility.length > 0 && (
              <p>
                <strong>What was checked:</strong> {item.compatibility.join("; ")}.
              </p>
            )}
            {mode === "advanced" && <p className="hint font-mono">{item.id}</p>}
          </div>
        </details>
      )}
    </li>
  );
}
