import { useState } from "react";
import { ApiError } from "../api/client";
import { useDevices, useRevokeDevice, useSession, useSignOutDevice, useStartPairing } from "../api/hooks";
import type { PairingCode } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");
const when = (iso: string) => new Date(iso).toLocaleString();

/** Settings > Devices. On the PC: pair and revoke phones. On a phone: say which device this is, and sign out. */
export function DevicesSection() {
  const session = useSession();
  const s = session.data;
  const isPc = s?.mode === "local";
  const devices = useDevices(isPc);
  const start = useStartPairing();
  const revoke = useRevokeDevice();
  const signOut = useSignOutDevice();
  const [code, setCode] = useState<PairingCode | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  if (!s) return null;

  if (!isPc) {
    return (
      <section className="card space-y-3" aria-labelledby="devices-heading">
        <h2 id="devices-heading" className="text-lg font-semibold">
          This device
        </h2>
        <p className="text-sm">
          Paired as <strong>{s.device?.name}</strong>. You can chat, give tasks, and approve or deny actions here. Secrets, providers, limits and safety permissions can only be changed on the PC,
          and a phone can pause things but only the PC can switch them back on.
        </p>
        <button className="btn-danger" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          Sign out of this device
        </button>
        {errorText(signOut.error) && (
          <p role="alert" className="text-sm text-red-700">
            {errorText(signOut.error)}
          </p>
        )}
      </section>
    );
  }

  const active = (devices.data ?? []).filter((d) => !d.revokedAt);
  const past = (devices.data ?? []).filter((d) => d.revokedAt);
  const target = (devices.data ?? []).find((d) => d.id === revoking);

  return (
    <section className="card space-y-3" aria-labelledby="devices-heading">
      <h2 id="devices-heading" className="text-lg font-semibold">
        Devices (Android phone)
      </h2>
      {!s.remoteEnabled ? (
        <p className="text-sm">
          Phone access is <strong>off</strong>. To switch it on, install Tailscale on the PC and the phone, run <code>tailscale serve --bg 3000</code> on the PC, add the PC's{" "}
          <code>*.ts.net</code> name to <code>REMOTE_HOSTS=</code> in your <code>.env</code> file, and restart the app. Step by step: docs/PHONE-AND-REMOTE.md.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Phone access is on for <span className="font-mono [overflow-wrap:anywhere]">{s.remoteHosts.join(", ")}</span>. A phone must be paired with a one-time code, and you can revoke it here at any time.
          </p>
          <button className="btn-primary" disabled={start.isPending} onClick={() => start.mutate(undefined, { onSuccess: setCode })}>
            Pair a phone
          </button>
          {code && (
            <div className="space-y-1 rounded-md bg-slate-100 p-3 dark:bg-slate-800" role="status">
              <p className="text-sm">On the phone, open this address and press Pair (or type the code):</p>
              <p className="font-mono text-sm [overflow-wrap:anywhere]">{code.link}</p>
              <p className="font-mono text-2xl tracking-widest">{code.code}</p>
              <p className="hint">Works once. Expires at {new Date(code.expiresAt).toLocaleTimeString()}.</p>
            </div>
          )}
          {errorText(start.error) && (
            <p role="alert" className="text-sm text-red-700">
              {errorText(start.error)}
            </p>
          )}
        </>
      )}
      {devices.isError && <p role="alert">Could not load the device list.</p>}
      {active.length > 0 && (
        <ul className="space-y-2">
          {active.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800" aria-label={`Device ${d.name}`}>
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="hint">
                  Paired {when(d.createdAt)} · last used {when(d.lastSeenAt)}
                </p>
              </div>
              <button className="btn-danger" onClick={() => setRevoking(d.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && <p className="hint">Revoked: {past.map((d) => d.name).join(", ")}</p>}
      {errorText(revoke.error) && (
        <p role="alert" className="text-sm text-red-700">
          {errorText(revoke.error)}
        </p>
      )}
      {target && (
        <ConfirmDialog
          title={`Revoke ${target.name}?`}
          confirmLabel="Revoke"
          danger
          busy={revoke.isPending}
          onCancel={() => setRevoking(null)}
          onConfirm={() => revoke.mutate(target.id, { onSettled: () => setRevoking(null) })}
        >
          <p>This device is signed out immediately and can only come back with a new pairing code.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
