import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HIT_LABEL, useSearch, whereHit } from "../../api/hubHooks";
import { Icon } from "../Icon";

/**
 * Global search (Ctrl+K, or the Search button). One box over names and titles of projects, agents, conversations, tasks, workflows, decisions,
 * approvals, notes and schedules. It only navigates: it never runs or changes anything. Arrow keys choose, Enter opens, Escape closes,
 * focus stays inside and returns to the button that opened it.
 */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const q = useSearch(debounced);
  const hits = debounced.trim().length >= 2 ? (q.data?.hits ?? []) : [];

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setActive(0), [debounced]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab") return;
      const items = Array.from(box.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  const open = (i: number) => {
    const h = hits[i];
    if (!h) return;
    onClose();
    navigate(whereHit(h));
  };
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(active);
    }
  };
  const short = text.trim().length < 2;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[10vh]">
      <button type="button" tabIndex={-1} aria-label="Close search" className="awp-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-label="Search" className="awp-sheet-up relative w-full max-w-xl rounded-xl bg-white p-3 shadow-xl dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Icon name="search" className="h-5 w-5 shrink-0 text-slate-500" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
            aria-label="Search everything"
            placeholder="Search projects, agents, tasks, workflows…"
            className="input min-h-11 w-full"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKey}
          />
          <button type="button" className="btn-secondary min-h-11 min-w-11" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Search results" className="mt-2 max-h-[60vh] space-y-1 overflow-y-auto">
          {hits.map((h, i) => (
            <li
              key={`${h.kind}:${h.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-1 ${i === active ? "bg-indigo-100 dark:bg-indigo-950" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(i)}
            >
              <span className="text-sm font-medium [overflow-wrap:anywhere]">{h.title}</span>
              <span className="hint text-xs">
                {HIT_LABEL[h.kind]} · {h.subtitle}
              </span>
            </li>
          ))}
        </ul>
        <p role="status" className="hint mt-2 px-1 text-xs">
          {short ? "Type at least two letters. Search looks at names and titles, not message text." : q.isFetching && hits.length === 0 ? "Searching…" : hits.length === 0 ? `Nothing found for "${text.trim()}".` : `${hits.length} found. Use the arrow keys and Enter.`}
        </p>
      </div>
    </div>
  );
}
