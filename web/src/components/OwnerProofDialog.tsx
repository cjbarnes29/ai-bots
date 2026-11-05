import { useEffect, useId, useRef, useState } from "react";
import { useGuardianStatus } from "../api/hooks";
import { askForProof, rememberProof, setProofAsker } from "../lib/ownerProof";

/**
 * Asks for the owner passphrase when the server says an owner act needs proof. The passphrase is sent straight to the Guardian (a separate
 * program on this PC), not to this app's server, and is never stored. The Guardian answers with a token that is valid for 10 minutes.
 * Mounted once in the application shell.
 */
export function OwnerProofDialog() {
  const status = useGuardianStatus();
  const url = status.data?.url ?? null;
  const urlRef = useRef(url);
  urlRef.current = url;
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setProofAsker(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setOpen(true);
        }),
    );
    return () => {
      setProofAsker(null);
      resolver.current?.(false); // if the dialog disappears while open, the waiting request is answered "no"
      resolver.current = null;
    };
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  return open ? <ProofForm guardianUrl={urlRef.current} onDone={finish} /> : null;
}

function ProofForm({ guardianUrl, onDone }: { guardianUrl: string | null; onDone: (ok: boolean) => void }) {
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const submit = async () => {
    if (!guardianUrl) return setError("The Guardian is not set up, so no proof can be given. See docs/GUARDIAN.md.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${guardianUrl}/v1/command`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-awp-guardian": "1" },
        body: JSON.stringify({ cmd: "proof", passphrase: pass }),
      });
      const body = (await res.json()) as { ok: boolean; token?: string; expiresAt?: string; message?: string };
      if (res.ok && body.ok && body.token && body.expiresAt) {
        rememberProof(body.token, body.expiresAt);
        setPass("");
        return onDone(true);
      }
      setError(body.message ?? "The Guardian did not accept that.");
    } catch {
      setError("Cannot reach the Guardian. Is it running (npm run guardian)?");
    } finally {
      setBusy(false);
      setPass("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-md space-y-3 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Owner passphrase needed
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This is a change only you should make. Enter your owner passphrase. It is checked by the Guardian, not by the app, and it covers about 10 minutes of changes.
        </p>
        <label className="block text-sm font-medium">
          Owner passphrase
          <input ref={input} type="password" autoComplete="off" className="input mt-1 w-full" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={() => onDone(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || pass.length === 0}>
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}

export { askForProof };
