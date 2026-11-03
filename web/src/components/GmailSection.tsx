import { ApiError } from "../api/client";
import { useGmailStatus, useStartGmailSignIn } from "../api/hooks";

/**
 * Connect Gmail. Nothing is sent from here: it only opens Google's own sign-in page. The sign-in comes back to this computer,
 * and only an encrypted token is kept. Bots still need read permission per bot, and every email they send needs approval.
 */
export function GmailSection() {
  const status = useGmailStatus();
  const start = useStartGmailSignIn();
  const s = status.data;
  const error = start.error instanceof ApiError ? start.error.friendly : start.error ? "That did not work." : null;

  return (
    <section className="card space-y-3" aria-labelledby="gmail-heading">
      <h2 id="gmail-heading" className="text-lg font-semibold">
        Gmail
      </h2>
      <p className="text-sm">
        Status: <strong>{!s ? "Checking…" : s.connected ? "Connected" : s.hasClient ? "Ready to sign in" : "Not set up"}</strong>
      </p>
      {s?.connected ? (
        <p className="text-sm">
          Bots can search and read mail only if you switch on Gmail reading for that bot (Permissions tab). Every email a bot wants to send waits on
          the Approvals page for your click. To disconnect, remove <code>GMAIL_REFRESH_TOKEN</code> above, and also remove this app at{" "}
          <span className="font-mono">myaccount.google.com/permissions</span>.
        </p>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>In your own Google Cloud project (free), create an OAuth client of type <strong>Desktop app</strong> and turn on the Gmail API.</li>
          <li>
            If Google asks for a redirect address, use <span className="font-mono [overflow-wrap:anywhere]">{s?.redirectUri ?? "http://127.0.0.1:3000/api/gmail/oauth/callback"}</span>.
          </li>
          <li>Paste the client ID and client secret into the vault above (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).</li>
          <li>Press the button below, sign in on Google's page and accept both permissions (read mail, send mail).</li>
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={!s?.hasClient || start.isPending}
          onClick={() => start.mutate(undefined, { onSuccess: (url) => window.open(url, "_blank", "noopener") })}
        >
          {s?.connected ? "Sign in again" : "Connect Gmail"}
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
