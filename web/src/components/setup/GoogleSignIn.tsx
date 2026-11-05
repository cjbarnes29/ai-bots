import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import type { GmailStatus } from "../../api/types";
import { useBots, useExternalStatus, useGmailStatus, useGworkspaceStatus, useSendGmailTest, useStartGmailSignIn, useStartGworkspaceSignIn } from "../../api/hooks";
import { CopyValue, ErrorNote } from "./SetupBits";

/** Whether Gmail / Google Workspace is signed in, from the same status endpoints (and cache) the sign-in box uses. No request when kind is undefined. */
export function useGoogleConnected(kind: "gmail" | "gworkspace" | undefined): boolean {
  const q = useQuery({
    queryKey: [kind ?? "none", "status"],
    queryFn: () => api<GmailStatus>("GET", `/api/${kind}/status`),
    enabled: kind !== undefined,
    refetchInterval: 4000,
  });
  return kind === undefined ? true : Boolean(q.data?.connected);
}

const friendly = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work. Try again.");

/** What each Google permission lets this app do, in plain words (shown before the person signs in). */
export const SCOPE_WORDS: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.readonly": "Read your email (only for bots you allow, on their Permissions tab)",
  "https://www.googleapis.com/auth/gmail.send": "Send email as you (every email waits for your approval first)",
  "https://www.googleapis.com/auth/drive.readonly": "See and read your Drive files",
  "https://www.googleapis.com/auth/drive.file": "Create new files (only files this app makes; it cannot delete or share)",
  "https://www.googleapis.com/auth/calendar.events": "Add events to your calendar (after your approval, never with guests)",
  "https://www.googleapis.com/auth/tasks": "See and add tasks",
};

/**
 * Google sign-in (OAuth) for Gmail or Google Workspace, through the EXISTING routes (/api/{gmail|gworkspace}/status and /oauth/start). Google's
 * own page opens in a new tab; the password is typed there, never here. Only an encrypted sign-in token is kept, by the backend.
 * (Replaces the separate Gmail and Google Workspace panels that sat at the bottom of the old Integrations page.)
 */
export function GoogleSignIn({ kind }: { kind: "gmail" | "gworkspace" }) {
  const ext = useExternalStatus();
  const gmail = useGmailStatus();
  const gws = useGworkspaceStatus();
  const startGmail = useStartGmailSignIn();
  const startGws = useStartGworkspaceSignIn();
  const status = kind === "gmail" ? gmail : gws;
  const start = kind === "gmail" ? startGmail : startGws;
  const s = status.data;
  const name = kind === "gmail" ? "Gmail" : "Google Workspace";
  if (ext.data && !ext.data.connectors.some((c) => c.id === kind)) return <p role="status">{name} is not available in this version of the app.</p>;

  return (
    <section aria-label={`${name} sign-in`} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <h3 className="font-semibold">Sign in with Google</h3>
      <p className="text-sm">
        Status: <strong>{!s ? "Checking…" : s.connected ? "Connected" : s.hasClient ? "Ready to sign in" : "Not set up"}</strong>
      </p>
      {s && s.scopes.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Google will ask you to allow AI Workforce to:</p>
          <ul className="list-disc pl-5">
            {s.scopes.map((sc) => (
              <li key={sc}>{SCOPE_WORDS[sc] ?? sc}</li>
            ))}
          </ul>
          <p className="hint">Nothing else. You type your password on Google&apos;s page, never in this app.</p>
        </div>
      )}
      {s?.redirectUri && !s.connected && <CopyValue label="Redirect address (only if Google asks for one)" value={s.redirectUri} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary min-h-11"
          disabled={!s?.hasClient || start.isPending}
          onClick={() => start.mutate(undefined, { onSuccess: (url) => window.open(url, "_blank", "noopener") })}
        >
          {s?.connected ? "Sign in again" : kind === "gmail" ? "Connect Gmail" : "Connect Google Workspace"}
        </button>
        {!s?.hasClient && <span className="hint">Save the Google client ID and secret above first.</span>}
      </div>
      {!s?.connected && s?.hasClient && <p className="hint">After you accept on Google&apos;s page, this page notices by itself within a few seconds.</p>}
      <ErrorNote text={friendly(start.error)} />
    </section>
  );
}

/** Queues one test email to the signed-in Gmail address. It still waits on the Approvals page for the owner's click. */
export function TestEmail() {
  const bots = useBots(false);
  const send = useSendGmailTest();
  const [chosen, setChosen] = useState("");
  const list = bots.data ?? [];
  const botId = chosen || list[0]?.id || "";
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-medium">Test sending</h3>
      <p className="text-sm">Queues one email to the Gmail address you signed in with. Nothing is sent until you approve it on the Approvals page.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Send as bot{" "}
          <select className="input" value={botId} onChange={(e) => setChosen(e.target.value)} aria-label="Bot to send as">
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-primary" disabled={!botId || send.isPending} onClick={() => send.mutate(botId)}>
          Send test email to myself
        </button>
      </div>
      {list.length === 0 && <p className="hint">Create a bot first.</p>}
      {send.data && (
        <p role="status" className="text-sm">
          Queued a test email to <strong>{send.data.to}</strong>. Open{" "}
          <Link className="underline" to="/approvals">
            Approvals
          </Link>{" "}
          and approve it.
        </p>
      )}
      <ErrorNote text={friendly(send.error)} />
    </div>
  );
}
