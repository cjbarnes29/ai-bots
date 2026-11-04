import { Link, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { Approvals } from "./pages/Approvals";
import { Automation } from "./pages/Automation";
import { BotEditor } from "./pages/BotEditor";
import { BotList } from "./pages/BotList";
import { Business } from "./pages/Business";
import { Dashboard } from "./pages/Dashboard";
import { Integrations } from "./pages/Integrations";
import { Knowledge } from "./pages/Knowledge";
import { Monitor } from "./pages/Monitor";
import { PcCenter } from "./pages/PcCenter";
import { SettingsCategoryPage, SettingsHome, SettingsLayout } from "./pages/settings/SettingsLayout";
import { TaskDetail, TaskList } from "./pages/Tasks";
import { Workflows } from "./pages/Workflows";

function NotFound() {
  return (
    <div className="card space-y-3">
      <p>That page does not exist.</p>
      <Link to="/" className="btn-secondary">
        Back to the dashboard
      </Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/agents", element: <BotList /> },
      { path: "/bots/:id", element: <BotEditor /> },
      { path: "/knowledge", element: <Knowledge /> },
      { path: "/workflows", element: <Workflows /> },
      { path: "/business", element: <Business /> },
      { path: "/integrations", element: <Integrations /> },
      { path: "/automation", element: <Automation /> },
      { path: "/approvals", element: <Approvals /> },
      { path: "/pc", element: <PcCenter /> },
      { path: "/monitor", element: <Monitor /> },
      { path: "/tasks", element: <TaskList /> },
      { path: "/tasks/:id", element: <TaskDetail /> },
      { path: "/usage", element: <Navigate to="/settings/ai-models" replace /> },
      {
        path: "/settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <SettingsHome /> },
          { path: ":category", element: <SettingsCategoryPage /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
