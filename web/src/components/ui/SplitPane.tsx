import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const MIN = 25;
const MAX = 75;
const STEP = 5;

/**
 * Two panels side by side on wide screens (from 1024 px) with a divider you drag or move with the arrow keys; stacked, one above the other,
 * on smaller screens where the divider is not shown. The size is kept while the page is open and is not stored anywhere. The divider is a
 * real separator for screen readers (value = the share of the first panel, 25-75 %).
 */
export function SplitPane({ label, first, second, initial = 62 }: { label: string; first: ReactNode; second: ReactNode; initial?: number }) {
  const [pct, setPct] = useState(Math.min(MAX, Math.max(MIN, initial)));
  const box = useRef<HTMLDivElement>(null);
  const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const move = (ev: globalThis.PointerEvent) => setPct(clamp(((ev.clientX - rect.left) / rect.width) * 100));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setPct((p) => clamp(p - STEP));
    else if (e.key === "ArrowRight") setPct((p) => clamp(p + STEP));
    else if (e.key === "Home") setPct(MIN);
    else if (e.key === "End") setPct(MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={box} role="group" aria-label={label} className="awp-split gap-3 lg:grid" style={{ "--split": `${pct}%` } as CSSProperties}>
      <div className="min-w-0 space-y-3">{first}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={pct}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKey}
        className="awp-hover hidden w-2 cursor-col-resize touch-none self-stretch rounded bg-slate-200 hover:bg-indigo-300 focus-visible:bg-indigo-400 dark:bg-slate-700 dark:hover:bg-indigo-700 lg:block"
      />
      <div className="mt-3 min-w-0 space-y-3 lg:mt-0">{second}</div>
    </div>
  );
}
