import { useEffect, useState } from "react";
import { api } from "../api/client";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

const toBytes = (b64url: string): Uint8Array => {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Settings > Alerts on this device. Needs the installed app over HTTPS (the phone) and the browser's permission. */
export function AlertsSection() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !window.isSecureContext) return live && setState("unsupported");
      if (Notification.permission === "denied") return live && setState("blocked");
      try {
        const sub = await currentSubscription();
        if (live) setState(sub ? "on" : "off");
      } catch {
        if (live) setState("unsupported");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const turnOn = async () => {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>("GET", "/api/push/key");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) as BufferSource });
      await api("POST", "/api/push/subscribe", { endpoint: sub.endpoint });
      setState("on");
    } catch {
      setError("Could not switch alerts on. Check that this is the installed app and that the PC is reachable.");
    }
  };

  const turnOff = async () => {
    setError(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Could not switch alerts off.");
    }
  };

  return (
    <section className="card space-y-3" aria-labelledby="alerts-heading">
      <h2 id="alerts-heading" className="text-lg font-semibold">
        Alerts on this device
      </h2>
      <p className="text-sm">
        Get a notification when a bot is waiting for your approval. The alert says only how many actions are waiting, never what they are; open the app to read and decide.
      </p>
      {state === "checking" && <p role="status" className="hint">Checking…</p>}
      {state === "unsupported" && <p className="hint">Alerts need the installed app opened over HTTPS (on the phone, through Tailscale). They are not available here.</p>}
      {state === "blocked" && <p className="hint">Notifications are blocked for this site. Allow them in the browser's site settings, then come back.</p>}
      {state === "off" && (
        <button className="btn-primary" onClick={turnOn}>
          Turn on alerts
        </button>
      )}
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Alerts are on for this device.</span>
          <button className="btn-secondary" onClick={turnOff}>
            Turn off
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
