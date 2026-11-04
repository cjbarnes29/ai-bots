import { ApiError } from "../api/client";
import { useExternalStatus, useGworkspaceStatus, useStartGworkspaceSignIn } from "../api/hooks";

/** Connect Google Workspace (Drive, Docs/Sheets/Slides as text, Calendar, Tasks). Uses the same Google client as Gmail. Shown only if the connector is installed. */
export function GoogleWorkspaceSection() {
  const ext = useExternalStatus();
  if (!ext.data?.connectors.some((c) => c.id === "gworkspace")) return null;
  return <Panel />;
}

function Panel() {
  const status = useGworkspaceStatus();
  const start = useStartGworkspaceSignIn();
  const s = status.data;
  const error = start.error instanceof ApiError ? start.error.friendly : start.error ? "That did not work." : null;
  return (
    <section className="card space-y-3" aria-labelledby="gws-heading">
      <h2 id="gws-heading" className="text-lg font-semibold">
        Google Workspace
      </h2>
      <p className="text-sm">
        Status: <strong>{!s ? "Checking…" : s.connected ? "Connected" : s.hasClient ? "Ready to sign in" : "Not set up"}</strong>
      </p>
      <p className="text-sm">
        Lets bots read your Drive files, Docs, Sheets and Slides (as text), calendar and tasks, and create new docs, calendar events (no guests) and tasks. Nothing can be deleted or shared. Bots need the switch on their Permissions tab, and every
        creation waits on the Approvals page. Google Forms is not supported.
      </p>
      {!s?.connected && (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>In the same Google Cloud project you use for Gmail, turn on the Drive, Calendar and Tasks APIs.</li>
          <li>
            Add this redirect address to the OAuth client if Google asks: <span className="font-mono [overflow-wrap:anywhere]">{s?.redirectUri ?? "http://127.0.0.1:3000/api/gworkspace/oauth/callback"}</span>
          </li>
          <li>Save the client ID and secret in the vault (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET), then press the button and accept the permissions.</li>
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!s?.hasClient || start.isPending} onClick={() => start.mutate(undefined, { onSuccess: (url) => window.open(url, "_blank", "noopener") })}>
          {s?.connected ? "Sign in again" : "Connect Google Workspace"}
        </button>
        {!s?.hasClient && <span className="hint">Save the client ID and secret first.</span>}
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
