import { Link, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { Access } from "./pages/Access";
import { Approvals } from "./pages/Approvals";
import { Automation } from "./pages/Automation";
import { BotEditor } from "./pages/BotEditor";
import { BotList } from "./pages/BotList";
import { BotStudio } from "./pages/BotStudio";
import { Business } from "./pages/Business";
import { Creative } from "./pages/Creative";
import { Dashboard } from "./pages/Dashboard";
import { Decisions } from "./pages/Decisions";
import { Groups } from "./pages/Groups";
import { Workforce } from "./pages/Workforce";
import { Inbox } from "./pages/Inbox";
import { Integrations } from "./pages/Integrations";
import { Projects } from "./pages/Projects";
import { IntegrationTutorial } from "./pages/IntegrationTutorial";
import { ProviderWizard } from "./pages/ProviderWizard";
import { ServiceWizard } from "./pages/ServiceWizard";
import { AiSetupAssistant } from "./pages/AiSetupAssistant";
import { Knowledge } from "./pages/Knowledge";
import { Models } from "./pages/Models";
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
      { path: "/studio", element: <BotStudio /> },
      { path: "/knowledge", element: <Knowledge /> },
      { path: "/creative", element: <Creative /> },
      { path: "/models", element: <Models /> },
      { path: "/workflows", element: <Workflows /> },
      { path: "/business", element: <Business /> },
      { path: "/integrations", element: <Integrations /> },
      { path: "/integrations/connect/:provider", element: <ProviderWizard /> },
      { path: "/integrations/guide/:id", element: <IntegrationTutorial /> },
      { path: "/integrations/setup/:id", element: <ServiceWizard /> },
      { path: "/integrations/ai-setup", element: <AiSetupAssistant /> },
      { path: "/inbox", element: <Inbox /> },
      { path: "/decisions", element: <Decisions /> },
      { path: "/groups", element: <Groups /> },
      { path: "/workforce", element: <Workforce /> },
      { path: "/projects", element: <Projects /> },
      { path: "/automation", element: <Automation /> },
      { path: "/approvals", element: <Approvals /> },
      { path: "/pc", element: <PcCenter /> },
      { path: "/access", element: <Access /> },
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
