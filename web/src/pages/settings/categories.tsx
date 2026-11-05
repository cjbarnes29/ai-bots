import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertsSection } from "../../components/AlertsSection";
import { ManagerSettings } from "../../components/ManagerSettings";
import { RecommendedSettings } from "../../components/RecommendedSettings";
import { ModelRegistry } from "../../components/ModelRegistry";
import { RoutingSection } from "../../components/RoutingSection";
import { SkillsSection } from "../../components/SkillsSection";
import { ToolsSection } from "../../components/ToolsSection";
import { DelegationLimitsSection, LimitsSection, ModelsSection, ProvidersSection, SafetySection } from "../Settings";
import { Usage } from "../Usage";
import { ProviderSetupGuide } from "../../components/ProviderSetupGuide";
import { ThemeSection } from "./ThemeSection";

export interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  content: () => ReactNode;
}

function LinkCard({ title, text, to, action }: { title: string; text: string; to: string; action: string }) {
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{text}</p>
      </div>
      <Link to={to} className="btn-secondary min-h-11">
        {action}
      </Link>
    </section>
  );
}

/** The nine settings categories. Most hold the existing panels unchanged; a few simply point to the page where that work is done. */
export const CATEGORIES: SettingsCategory[] = [
  {
    id: "general",
    label: "General",
    description: "How the app looks.",
    content: () => <ThemeSection />,
  },
  {
    id: "recommended",
    label: "Recommended Settings",
    description: "Suggestions based on this PC and what really works right now. Nothing changes until you press Apply.",
    content: () => <RecommendedSettings />,
  },
  {
    id: "ai-models",
    label: "AI Models",
    description: "Which AI providers and models are connected, the automatic model choice, and what has been used.",
    content: () => (
      <>
        <SafetySection />
        <p className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
          Easiest way to connect a provider: press Connect on its card in the{" "}
          <Link to="/integrations" className="underline">
            Integrations Center
          </Link>{" "}
          and follow the steps. Then use the{" "}
          <Link to="/integrations/ai-setup" className="underline">
            AI setup assistant
          </Link>
          . A provider only shows as Connected after a test call really succeeds.
        </p>
        <ProviderSetupGuide />
        <ProvidersSection />
        <ModelsSection />
        <ModelRegistry />
        <RoutingSection />
        <Usage />
      </>
    ),
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Outside services such as Gmail and Google Workspace.",
    content: () => (
      <LinkCard
        title="Integrations Center"
        text="Connect, check and disconnect outside services, and save their keys and tokens. It is the one place for all of that."
        to="/integrations"
        action="Open the Integrations Center"
      />
    ),
  },
  {
    id: "agents",
    label: "Agents & Permissions",
    description: "The Manager, and the skills and tools agents can be given. What each agent may use is set on that agent's Permissions tab.",
    content: () => (
      <>
        <LinkCard
          title="Per-agent permissions"
          text="Reading Gmail, memory, PC folders and tools is switched on one agent at a time, never for everyone at once."
          to="/agents"
          action="Open Agents & Teams"
        />
        <ManagerSettings />
        <SkillsSection />
        <ToolsSection />
      </>
    ),
  },
  {
    id: "workflows",
    label: "Workflow Settings",
    description: "Limits that keep teamwork and automatic runs small and safe.",
    content: () => (
      <>
        <DelegationLimitsSection />
        <LinkCard
          title="Schedules and triggers"
          text="Automatic run limits, the automation pause switch and failure rules are on the Schedules page."
          to="/automation"
          action="Open Schedules"
        />
      </>
    ),
  },
  {
    id: "pc",
    label: "PC & Remote Access",
    description: "What agents may do on this computer, and which phones may reach it.",
    content: () => (
      <LinkCard
        title="PC Control Center"
        text="Folders agents may use, command rules, the emergency stop, and the phones that are paired."
        to="/pc"
        action="Open the PC Control Center"
      />
    ),
  },
  {
    id: "security",
    label: "Security",
    description: "How credentials and permissions are protected.",
    content: () => (
      <>
        <section className="card space-y-2">
          <h2 className="text-lg font-semibold">How your accounts are protected</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Keys and tokens are stored encrypted on this PC and are never shown again after you save them.</li>
            <li>Anything that sends or changes something outside waits for your approval, once.</li>
            <li>Agents can only read an outside service if you switched that on for that agent.</li>
            <li>Changing permissions, signing in to Google and pairing a phone can only be done from this PC.</li>
          </ul>
        </section>
        <LinkCard title="Keys and tokens" text="Save, replace or remove keys, and read the security log." to="/integrations" action="Open the Integrations Center" />
        <LinkCard title="Approvals" text="Every outside action waiting for your decision." to="/approvals" action="Open Approvals" />
        <LinkCard title="Paired phones" text="See, sign out or revoke the phones that can reach this PC." to="/pc" action="Open the PC Control Center" />
      </>
    ),
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Alerts on your phone, for example when something needs your approval.",
    content: () => <AlertsSection />,
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Technical limits for experienced users. The defaults are safe and you can leave these alone.",
    content: () => <LimitsSection />,
  },
];

export const categoryById = (id: string | undefined) => CATEGORIES.find((c) => c.id === id);

/** What the search box looks through. `to` is where the setting really lives. */
export interface SettingEntry {
  label: string;
  to: string;
  where: string;
  words: string;
}
export const SETTING_INDEX: SettingEntry[] = [
  { label: "Recommended settings (suggestions, apply, restore, history)", to: "/settings/recommended", where: "Recommended Settings", words: "recommend suggest best beginner intermediate advanced mode apply restore undo history assistant" },
  { label: "Light or dark theme", to: "/settings/general", where: "General", words: "appearance dark mode light theme colour" },
  { label: "Pause all AI calls", to: "/settings/ai-models", where: "AI Models", words: "stop emergency kill switch free only" },
  { label: "Connect an AI provider (step-by-step wizard)", to: "/integrations", where: "Integrations Center", words: "gemini groq openrouter ollama connect wizard api key setup tutorial install" },
  { label: "Set up automatic AI (default model, per task, fallback)", to: "/integrations/ai-setup", where: "Integrations Center", words: "default model routing fallback recommended assign bots" },
  { label: "AI providers and models", to: "/settings/ai-models", where: "AI Models", words: "gemini groq openrouter ollama test connection models default" },
  { label: "Turn models on or off", to: "/settings/ai-models", where: "AI Models", words: "enable disable refresh models" },
  { label: "Automatic model choice (routing)", to: "/settings/ai-models", where: "AI Models", words: "routing fallback auto assign" },
  { label: "Usage and free limits used", to: "/settings/ai-models", where: "AI Models", words: "tokens calls cost meter" },
  { label: "Connect a service step by step (Telegram, Gmail, GitHub, Notion, n8n, MCP)", to: "/integrations", where: "Integrations Center", words: "connect wizard setup telegram gmail google github notion n8n webhook mcp oauth token" },
  { label: "Keys and tokens (full list, under Advanced)", to: "/integrations", where: "Integrations Center", words: "api key secret vault password token" },
  { label: "Gmail", to: "/integrations", where: "Integrations Center", words: "email mail google sign in send test" },
  { label: "Google Workspace (Drive, Calendar, Tasks)", to: "/integrations", where: "Integrations Center", words: "drive docs sheets calendar tasks google" },
  { label: "Manager AI", to: "/settings/agents", where: "Agents & Permissions", words: "coordinator delegate plan" },
  { label: "Skills", to: "/settings/agents", where: "Agents & Permissions", words: "skill library import export" },
  { label: "Tools available to agents", to: "/settings/agents", where: "Agents & Permissions", words: "tools registry capabilities" },
  { label: "Teamwork limits", to: "/settings/workflows", where: "Workflow Settings", words: "delegation depth teammates chain retries" },
  { label: "Schedules and automatic run limits", to: "/automation", where: "Schedules", words: "cron timer recurring triggers pause automation" },
  { label: "Folders agents may use", to: "/pc", where: "PC Control Center", words: "workspace pc folder files commands emergency stop" },
  { label: "Pair a phone", to: "/pc", where: "PC Control Center", words: "phone remote tailscale device code access" },
  { label: "Phone alerts", to: "/settings/notifications", where: "Notifications", words: "push notification approval alert" },
  { label: "Usage limits per day and month", to: "/settings/advanced", where: "Advanced", words: "limits caps requests tokens reset defaults" },
  { label: "Security log", to: "/integrations", where: "Integrations Center", words: "audit log history" },
];
