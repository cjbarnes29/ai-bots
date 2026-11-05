import { useState } from "react";
import { Link } from "react-router-dom";
import { AiOverview } from "../components/AiOverview";
import { ModelRegistry } from "../components/ModelRegistry";
import { ProviderSetupGuide } from "../components/ProviderSetupGuide";
import { RoutingSection } from "../components/RoutingSection";
import { TabPanel, Tabs } from "../components/ui/Tabs";
import { LimitsSection, ModelsSection, ProvidersSection, SafetySection } from "./Settings";
import { Usage } from "./Usage";

type TabId = "providers" | "models" | "routing" | "usage" | "safety";
const LABEL: Record<TabId, string> = {
  providers: "Providers",
  models: "Models & testing",
  routing: "Routing & fallback",
  usage: "Usage",
  safety: "Limits & safety",
};

/**
 * The AI Models workspace (redesign phase 3, D-075). It is the same set of sections that used to be one long stack under Settings > AI Models,
 * split into tabs: no logic was copied, every section is the original component. Settings > AI Models still shows them all in one list.
 */
export function Models() {
  const [tab, setTab] = useState<TabId>("providers");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">AI Models</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Which AI providers and models are connected, how the automatic choice and fallback work, and what has been used. Easiest way to connect a provider: press Connect on its card in the{" "}
          <Link to="/integrations" className="underline">
            Integrations Center
          </Link>
          . A provider only shows as Connected after a test call really succeeds.
        </p>
      </div>
      <AiOverview />
      <Tabs label="AI model areas" value={tab} onChange={setTab} tabs={(Object.keys(LABEL) as TabId[]).map((id) => ({ id, label: LABEL[id] }))} />
      <TabPanel label={LABEL[tab]}>
        {tab === "providers" && (
          <>
            <ProviderSetupGuide />
            <ProvidersSection />
          </>
        )}
        {tab === "models" && (
          <>
            <ModelsSection />
            <ModelRegistry />
          </>
        )}
        {tab === "routing" && <RoutingSection />}
        {tab === "usage" && <Usage />}
        {tab === "safety" && (
          <>
            <SafetySection />
            <LimitsSection />
          </>
        )}
      </TabPanel>
    </div>
  );
}
