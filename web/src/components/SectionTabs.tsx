import { Link, useLocation } from "react-router-dom";

interface Tab {
  to: string;
  label: string;
  match: string[];
}

function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px dark:border-slate-800">
      {tabs.map((t) => {
        const on = t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={on ? "page" : undefined}
            className={`whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm font-medium ${
              on ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-300" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Agents and the shared knowledge notes belong together. */
export const AgentsTabs = () => (
  <Tabs
    label="Agents sections"
    tabs={[
      { to: "/agents", label: "Agents", match: ["/agents", "/bots"] },
      { to: "/knowledge", label: "Knowledge", match: ["/knowledge"] },
    ]}
  />
);

/** The overview and the task lists are two views of what has happened. */
export const ActivityTabs = () => (
  <Tabs
    label="Activity sections"
    tabs={[
      { to: "/monitor", label: "Overview", match: ["/monitor"] },
      { to: "/tasks", label: "Tasks", match: ["/tasks"] },
    ]}
  />
);
