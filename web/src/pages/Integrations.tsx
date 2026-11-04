import { Link } from "react-router-dom";
import { GmailSection } from "../components/GmailSection";
import { GoogleWorkspaceSection } from "../components/GoogleWorkspaceSection";
import { SecretsSection } from "../components/SecretsSection";

/**
 * Integrations Center: the one place for connecting outside services. For now it gathers the existing connection panels
 * (keys and tokens, Gmail, Google Workspace) in one page; a catalog with status and a test button per service comes later.
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
      <SecretsSection />
      <GmailSection />
      <GoogleWorkspaceSection />
    </div>
  );
}
