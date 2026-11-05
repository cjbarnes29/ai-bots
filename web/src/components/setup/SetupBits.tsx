import { useState } from "react";
import type { GuideLink } from "../../lib/integrationGuides";

/** An official provider page, opened in a new tab. Shows where it goes, so nothing is hidden behind a button. */
export function OfficialLink({ link, primary = false }: { link: GuideLink; primary?: boolean }) {
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={`${primary ? "btn-primary" : "btn-secondary"} min-h-11`}>
      {link.label}
      <span className="sr-only"> (opens {link.href} in a new tab)</span>
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

/** A value with a Copy button (addresses, commands). Falls back to selecting the text when the clipboard is not available. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <div className="space-y-1">
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all rounded-md bg-slate-100 px-3 py-2 font-mono text-sm [overflow-wrap:anywhere] dark:bg-slate-800">{value}</code>
        <button type="button" className="btn-secondary min-h-11" onClick={copy} aria-label={`Copy ${label}`}>
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {state === "failed" && <p className="hint">Could not copy automatically. Select the text and press Ctrl+C.</p>}
    </div>
  );
}

/** The provider badge. Official logos are not bundled, so a coloured monogram stands in. */
export function ProviderMark({ mark, tone, name }: { mark: string; tone: string; name: string }) {
  return (
    <span role="img" aria-label={`${name} badge`} className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-base font-bold ${tone}`}>
      {mark}
    </span>
  );
}

/** "Step 3 of 8" with a bar, and clickable dots for steps already reached. */
export function StepHeader({ titles, current, reached, onGo }: { titles: string[]; current: number; reached: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="Setup steps" className="space-y-2">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
        Step {current + 1} of {titles.length}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${((current + 1) / titles.length) * 100}%` }} />
      </div>
      <ol className="flex flex-wrap gap-1">
        {titles.map((t, i) => (
          <li key={t}>
            <button
              type="button"
              disabled={i > reached}
              aria-current={i === current ? "step" : undefined}
              onClick={() => onGo(i)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                i === current ? "bg-indigo-600 text-white" : i < reached || i === reached ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {i + 1}. {t}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {text}
    </p>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-md bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
      {children}
    </p>
  );
}
