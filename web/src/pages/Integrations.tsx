import { Link } from "react-router-dom";
import { GmailSection } from "../components/GmailSection";
import { GoogleWorkspaceSection } from "../components/GoogleWorkspaceSection";
import { IntegrationCatalog } from "../components/IntegrationCatalog";
import { SecretsSection } from "../components/SecretsSection";

/**
 * Integrations Center: the one place for connecting outside services. The catalog shows every service with an honest status and a
 * Test connection button; the panels below it are where credentials are saved and where Google sign-in is started.
 */
export function Integrations() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Integrations Center</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Connect the outside services your agents can use. Connecting a service never gives every agent access: switch it on per agent on the agent&apos;s
          Permissions tab, and anything that sends or changes something still waits on the{" "}
          <Link to="/approvals" className="underline">
            Approvals
          </Link>{" "}
          page.
        </p>
      </div>
      <IntegrationCatalog />
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Connection settings</h2>
        <SecretsSection />
        <GmailSection />
        <GoogleWorkspaceSection />
      </div>
    </div>
  );
}
