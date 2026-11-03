import { Link, Outlet, type RouteObject } from "react-router-dom";
import { BotEditor } from "./pages/BotEditor";
import { BotList } from "./pages/BotList";

function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold">
            AI Workforce Platform
          </Link>
          <span className="text-sm text-slate-500">Agent Manager</span>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
        <p className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          Bots can't run yet. Execution arrives in Phase 2, and connectors arrive after the approval system is built and tested.
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
      { path: "*", element: <NotFound /> },
    ],
  },
];
