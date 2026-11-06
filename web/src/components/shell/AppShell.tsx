import { Fragment, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useMatches } from "react-router-dom";
import { useExternalStatus } from "../../api/hooks";
import { GuardianBanner } from "../GuardianBanner";
import { Icon } from "../Icon";
import { OwnerProofDialog } from "../OwnerProofDialog";
import { Breadcrumbs } from "./Breadcrumbs";
import { SectionTabs } from "../SectionTabs";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { SearchDialog } from "./SearchDialog";
import { NAV, headingLabel, isActive, sectionFor, type NavEntry } from "./nav";
import { GuidanceNote, HiddenScreenNotice, LevelBar, useChooseLevel } from "./LevelBar";
import { shownAt } from "../../lib/interfaceLevel";

const SAFETY_KEY = "awp-safety-note-dismissed";

/**
 * One navigation, three shapes (all CSS, one set of links):
 * - phones (< 768 px): a bar along the bottom with the four main places and a "More" button that opens a sheet;
 * - tablets (768-1023 px): a slim icon rail on the left;
 * - desktop (>= 1024 px): a full sidebar with names.
 * A waiting-approvals badge sits on Approvals in every shape.
 */
export function AppShell() {
  const { pathname } = useLocation();
  // The page-change animation restarts when the route changes, not when only an id in the address changes (bot A to bot B keeps its state).
  const matches = useMatches();
  const routeKey = matches[matches.length - 1]?.id ?? pathname;
  const external = useExternalStatus();
  const waiting = external.data?.pendingCount ?? 0;
  const [moreOpen, setMoreOpen] = useState(false);
  const [level] = useChooseLevel();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Wide screens can fold the sidebar down to icons. Remembered in this browser only.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <div className={`awp-layout min-h-screen md:pl-16 ${collapsed ? "lg:pl-16" : "lg:pl-60"}`}>
      <a href="#main" className="sr-only z-50 rounded-md bg-indigo-700 px-4 py-3 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to the page content
      </a>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="text-lg font-bold">
            AI Workforce Studio
          </Link>
          <button type="button" className="btn-secondary min-h-11 min-w-11" aria-label="Search" aria-haspopup="dialog" onClick={() => setSearchOpen(true)}>
            <Icon name="search" />
          </button>
        </div>
      </header>

      <nav
        aria-label="Main"
        className={`awp-layout fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:inset-y-0 md:right-auto md:w-16 md:flex-col md:gap-1 md:overflow-y-auto md:border-r md:border-t-0 md:px-2 md:py-3 ${
          collapsed ? "lg:w-16" : "lg:w-60 lg:px-3"
        }`}
      >
        <Link to="/" className="mb-2 hidden items-center gap-2 px-2 py-2 text-lg font-bold md:flex" aria-label="AI Workforce Studio home">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600 text-sm text-white" aria-hidden="true">
            AI
          </span>
          <span className={collapsed ? "hidden" : "hidden lg:inline"}>Workforce Studio</span>
        </Link>
        <button
          type="button"
          className={`${itemBase} max-md:hidden ${collapsed ? "lg:justify-center lg:px-0" : ""} ${idleStyle}`}
          aria-haspopup="dialog"
          aria-label="Search"
          title="Search (Ctrl+K)"
          onClick={() => setSearchOpen(true)}
        >
          <Icon name="search" />
          <span className={collapsed ? "md:sr-only" : "md:sr-only lg:not-sr-only"}>Search</span>
        </button>
        {NAV.filter((e) => shownAt(e.level, level) || isActive(e, pathname)).map((entry, i, shown) => (
          <Fragment key={entry.to}>
            {(i === 0 || shown[i - 1]!.heading !== entry.heading) && (
              <p className={`px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${collapsed ? "hidden" : "hidden lg:block"}`} data-heading={entry.heading}>
                {headingLabel(entry.heading)}
              </p>
            )}
            <NavItem entry={entry} collapsed={collapsed} active={isActive(entry, pathname)} waiting={entry.to === "/approvals" ? waiting : 0} />
          </Fragment>
        ))}
        <button
          type="button"
          className={`${itemBase} mt-auto max-lg:hidden ${collapsed ? "lg:justify-center lg:px-0" : ""} ${idleStyle}`}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          onClick={toggleSidebar}
        >
          <Icon name="sidebar" />
          <span className={collapsed ? "sr-only" : ""}>Collapse</span>
        </button>
        <button
          type="button"
          className={`${itemBase} md:hidden ${NAV.some((e) => !e.primary && isActive(e, pathname)) ? activeStyle : idleStyle}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {moreOpen && <MoreSheet pathname={pathname} waiting={waiting} level={level} onClose={() => setMoreOpen(false)} />}

      <GuardianBanner />
      <OwnerProofDialog />
      <SafetyNote />
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 pb-28 outline-none md:pb-8">
        <div className="mb-4">
          <LevelBar />
        </div>
        <WorkspaceTabs />
        <Breadcrumbs />
        <div className="mb-5 empty:mb-0">
          <SectionTabs />
        </div>
        <HiddenScreenNotice />
        <GuidanceNote />
        <div key={routeKey} className="awp-workspace-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const SIDEBAR_KEY = "awp-sidebar-collapsed";
const itemBase =
  "awp-hover relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium " +
  "md:min-h-11 md:flex-none md:flex-row md:justify-center md:gap-3 md:rounded-lg md:px-0 md:text-sm lg:justify-start lg:px-3";
const activeStyle = "text-indigo-700 dark:text-indigo-300 md:bg-indigo-100 md:dark:bg-indigo-950";
const idleStyle = "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white md:hover:bg-slate-100 md:dark:hover:bg-slate-800";

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute right-1/4 top-1.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white md:right-1 md:top-0.5 lg:static lg:ml-auto"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavItem({ entry, active, waiting, collapsed }: { entry: NavEntry; active: boolean; waiting: number; collapsed: boolean }) {
  return (
    <Link
      to={entry.to}
      title={entry.label}
      aria-current={active ? "page" : undefined}
      className={`${itemBase} ${entry.primary ? "" : "hidden md:flex"} ${collapsed ? "lg:justify-center lg:px-0" : ""} ${active ? activeStyle : idleStyle}`}
    >
      <Icon name={entry.icon} />
      <span className={collapsed ? "md:sr-only" : "md:sr-only lg:not-sr-only"}>{entry.label}</span>
      {waiting > 0 && <span className="sr-only">, {waiting} waiting</span>}
      <Badge count={waiting} />
    </Link>
  );
}

/** The phone's "More": every place that does not fit in the bottom bar. Focus stays inside it, and returns to the button that opened it. */
function MoreSheet({ pathname, waiting, level, onClose }: { pathname: string; waiting: number; level: import("../../lib/interfaceLevel").Level; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // The parent re-renders whenever data refreshes; the effect below must run once per opening, not once per render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(box.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closeRef.current();
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = box.current?.contains(document.activeElement) ?? false;
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
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

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" tabIndex={-1} aria-label="Close menu" className="awp-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="awp-sheet-up absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-slate-900"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">More</h2>
          <button type="button" className="btn-secondary min-h-11 min-w-11" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {NAV.filter((e) => !e.primary && (shownAt(e.level, level) || isActive(e, pathname))).map((e, i, shown) => (
            <Fragment key={e.to}>
              {(i === 0 || shown[i - 1]!.heading !== e.heading) && (
                <li role="presentation" className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {headingLabel(e.heading)}
                </li>
              )}
            <li>
              <Link to={e.to} aria-current={isActive(e, pathname) ? "page" : undefined} className="flex min-h-12 items-center gap-3 px-1 text-base">
                <Icon name={e.icon} />
                <span className="flex-1">{e.label}</span>
                {e.to === "/approvals" && waiting > 0 ? <span className="text-sm font-semibold">{waiting}</span> : null}
                <Icon name="next" className="h-4 w-4 text-slate-400" />
              </Link>
            </li>
            </Fragment>
          ))}
        </ul>
        {NAV.some((e) => !e.primary && !shownAt(e.level, level)) && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <p className="hint text-sm">Some screens are hidden at this interface level. Search and the AI Assistant can still open them.</p>
            <LevelBar compact />
          </div>
        )}
      </div>
    </div>
  );
}

/** The standing safety reminder, now small and dismissible (the choice is kept in this browser only). */
function SafetyNote() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SAFETY_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2">
        <p className="flex-1 text-sm text-amber-900 dark:text-amber-200">
          Bots can only ask to use outside services (Gmail, Telegram, browser): anything that sends or changes something waits for your approval. Only
          free models can be used.
        </p>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-md px-2 py-1 text-sm font-medium text-amber-900 underline dark:text-amber-200"
          onClick={() => {
            try {
              localStorage.setItem(SAFETY_KEY, "1");
            } catch {
              /* ignore */
            }
            setHidden(true);
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
