import { Link } from "react-router-dom";
import { IntegrationCatalog } from "../components/IntegrationCatalog";
import { SecretsSection } from "../components/SecretsSection";
import { AiProviderCards, OtherGuides } from "../components/setup/AiProviderCards";

/**
 * Integration Setup Center (2026-11-04 redesign): categorized cards, one service at a time. Each card opens a step-by-step wizard
 * (/integrations/connect/:provider for AI providers, /integrations/setup/:id for services). The old flat list of every key, token and
 * address is kept, folded away under Advanced, for experienced users; nothing it could do was removed.
 */
export function Integrations() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Integrations Center</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pick one service, press <strong>Connect</strong>, and follow the steps. You never need to set up a service you do not use. Connecting a service never gives every agent access:
          switch it on per agent on the agent&apos;s Permissions tab, and anything that sends or changes something still waits on the{" "}
          <Link to="/approvals" className="underline">
            Approvals
          </Link>{" "}
          page.
        </p>
      </div>
      <AiProviderCards />
      <IntegrationCatalog />
      <OtherGuides />
      <details className="card">
        <summary className="cursor-pointer font-semibold">Advanced: every saved key, token and address in one list (for experienced users)</summary>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          The same vault the wizards use. Values are never shown; you can only replace or remove them. Most people never need this list.
        </p>
        <div className="mt-3">
          <SecretsSection />
        </div>
      </details>
    </div>
  );
}
