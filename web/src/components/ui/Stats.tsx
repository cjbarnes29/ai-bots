import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type Tone = "ok" | "warn" | "bad" | "idle";

const RING: Record<Tone, string> = {
  ok: "",
  idle: "",
  warn: "border-amber-400 dark:border-amber-600",
  bad: "border-red-400 dark:border-red-600",
};
const DOT: Record<Tone, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", idle: "bg-slate-400" };

/** A coloured dot. Always put the state in words next to it: colour alone never carries the meaning. */
export function StatusDot({ tone, live = false }: { tone: Tone; live?: boolean }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]} ${live ? "awp-live" : ""}`} />;
}

/**
 * A number card that links to where the detail lives. The value is always plain text (so it can be read and tested); when it changes
 * it plays a short pop (keyed on the value; the first draw plays it once too).
 */
export function StatCard({ title, value, hint, to, tone = "idle" }: { title: string; value: ReactNode; hint?: ReactNode; to: string; tone?: Tone }) {
  return (
    <Link to={to} className={`card awp-lift block space-y-1 hover:border-indigo-400 ${RING[tone]}`}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{title}</p>
      <p key={typeof value === "string" || typeof value === "number" ? String(value) : undefined} className="awp-value text-2xl font-bold">
        {value}
      </p>
      {hint && <p className="hint">{hint}</p>}
    </Link>
  );
}

export interface BarPart {
  label: string;
  value: number;
  tone: Tone;
}

const FILL: Record<Tone, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", idle: "bg-indigo-500" };

/**
 * One bar split into parts (for example finished / failed / running). The parts and their numbers are also written out underneath,
 * so the bar is a picture of the words, not the only source. Widths ease to their new size over the panel duration.
 */
export function StackedBar({ label, parts, empty = "Nothing yet." }: { label: string; parts: BarPart[]; empty?: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="space-y-2">
      {total === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label}`).join(", ")}`} className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span key={p.label} className={`awp-bar ${FILL[p.tone]}`} style={{ width: `${(p.value / total) * 100}%` }} />
            ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <StatusDot tone={p.tone} />
            <span className="font-medium">{p.value}</span>
            <span className="text-slate-600 dark:text-slate-400">{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A grey placeholder shape while data loads (keeps the page from jumping). Decorative. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span aria-hidden="true" className={`awp-skeleton block rounded bg-slate-200 dark:bg-slate-800 ${className}`} />;
}

/** A titled box for a group of related content. Level 2 heading; pass `action` for a link or button on the right. */
export function Panel({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
