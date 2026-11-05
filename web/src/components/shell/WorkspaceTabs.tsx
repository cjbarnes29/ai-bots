import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../Icon";
import { sectionFor, tabFor } from "./nav";

const KEY = "awp-open-workspaces";
const MAX = 6;

interface Open {
  path: string;
  label: string;
}

/** A readable name for a page: its tab, else its section, with a note for pages that are one item inside a section. */
export function workspaceLabel(pathname: string): string {
  const section = sectionFor(pathname);
  if (!section) return "Page";
  const tab = tabFor(section, pathname);
  const base = tab?.label ?? section.label;
  const inner = tab && pathname !== tab.to && !pathname.startsWith("/settings") ? ` (${pathname.split("/")[2] ? "item" : "page"})` : "";
  return `${base}${inner}`;
}

function load(): Open[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((o): o is Open => !!o && typeof (o as Open).path === "string" && typeof (o as Open).label === "string" && (o as Open).path.startsWith("/")).slice(0, MAX);
  } catch {
    return [];
  }
}

/**
 * The workspaces you have open, as tabs along the top of the page (wide screens only). It remembers addresses and names for this browser
 * tab only (session storage): no database, nothing survives closing the tab, and it never stores page content (owner decision D-075).
 * Opening a page adds it; the x closes it; the oldest drops off after six.
 */
export function WorkspaceTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open[]>(load);

  useEffect(() => {
    if (!sectionFor(pathname)) return;
    setOpen((cur) => {
      const label = workspaceLabel(pathname);
      const next = cur.some((o) => o.path === pathname) ? cur.map((o) => (o.path === pathname ? { path: o.path, label } : o)) : [...cur, { path: pathname, label }].slice(-MAX);
      sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, [pathname]);

  if (open.length < 2) return null;

  const close = (path: string) => {
    const next = open.filter((o) => o.path !== path);
    setOpen(next);
    sessionStorage.setItem(KEY, JSON.stringify(next));
    if (path === pathname) navigate(next[next.length - 1]?.path ?? "/");
  };

  return (
    <nav aria-label="Open workspaces" className="mb-3 hidden gap-1 overflow-x-auto md:flex">
      {open.map((o) => {
        const on = o.path === pathname;
        return (
          <span
            key={o.path}
            className={`awp-hover awp-tab-in flex shrink-0 items-center rounded-md border text-sm ${
              on ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950" : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
          >
            <Link to={o.path} aria-current={on ? "page" : undefined} className="max-w-48 truncate py-1.5 pl-3 pr-1">
              {o.label}
            </Link>
            <button type="button" aria-label={`Close ${o.label}`} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white" onClick={() => close(o.path)}>
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
