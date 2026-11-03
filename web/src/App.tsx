import { Link, NavLink, Outlet, type RouteObject } from "react-router-dom";
import { Automation } from "./pages/Automation";
import { BotEditor } from "./pages/BotEditor";
import { BotList } from "./pages/BotList";
import { Settings } from "./pages/Settings";
import { TaskDetail, TaskList } from "./pages/Tasks";
import { Usage } from "./pages/Usage";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive
      ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
  }`;

function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-lg font-bold">
            AI Workforce Platform
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>
              Bots
            </NavLink>
            <NavLink to="/tasks" className={navClass}>
              Tasks
            </NavLink>
            <NavLink to="/automation" className={navClass}>
              Automation
            </NavLink>
            <NavLink to="/usage" className={navClass}>
              Usage
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
        <p className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          Bots reply only when you message them. Tools and outside access (Gmail, Telegram, browser) stay disabled until the
          approval system is built and tested. Only free models can be used.
        </p>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card space-y-3">
      <p>That page does not exist.</p>
      <Link to="/" className="btn-secondary">
        Back to all bots
      </Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: "/", element: <BotList /> },
      { path: "/bots/:id", element: <BotEditor /> },
      { path: "/automation", element: <Automation /> },
      { path: "/tasks", element: <TaskList /> },
      { path: "/tasks/:id", element: <TaskDetail /> },
      { path: "/usage", element: <Usage /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
