import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useDeleteSecret, useSecrets, useSetSecret } from "../api/hooks";
import type { SecretStatus } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

function SecretRow({ s }: { s: SecretStatus }) {
  const set = useSetSecret();
  const del = useDeleteSecret();
  const [value, setValue] = useState("");
  const [removing, setRemoving] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    set.mutate({ name: s.name, value }, { onSuccess: () => setValue("") }); // the box is emptied: the key is never shown again
  };

  return (
    <li className="space-y-2 border-t border-slate-200 pt-3 first:border-0 first:pt-0 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{s.description}</p>
          <p className="hint font-mono">{s.name}</p>
        </div>
        <span className="text-sm">
          {s.inVault ? "Saved in the vault" : s.inEnv ? "Set in the .env file" : "Not set"}
          {s.inVault && s.inEnv ? " (the vault is used)" : ""}
        </span>
      </div>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-48">
          <span className="label">{s.inVault ? "Replace the saved key" : "Paste the key"}</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`New value for ${s.name}`}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <button className="btn-primary" disabled={!value.trim() || set.isPending}>
          Save
        </button>
        {s.inVault && (
          <button type="button" className="btn-danger" onClick={() => setRemoving(true)}>
            Remove
          </button>
        )}
      </form>
      {errorText(set.error ?? del.error) && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {errorText(set.error ?? del.error)}
        </p>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${s.name}?`}
          confirmLabel="Remove"
          danger
          busy={del.isPending}
          onCancel={() => setRemoving(false)}
          onConfirm={() => del.mutate(s.name, { onSettled: () => setRemoving(false) })}
        >
          <p>The saved key is deleted from the vault. Anything that needs it stops working until you paste a key again.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

export function SecretsSection() {
  const secrets = useSecrets();
  return (
    <section className="card space-y-3" aria-labelledby="vault-heading">
      <h2 id="vault-heading" className="text-lg font-semibold">
        Keys and passwords (vault)
      </h2>
      <p className="text-sm">
        Paste a key here and it is stored encrypted on this computer. It is never shown again, never sent to a bot, and never written to the logs. You can
        also keep keys in the <code>.env</code> file instead; the vault is used first.
      </p>
      {secrets.isError && <p role="alert">Could not load the vault.</p>}
      <ul className="space-y-3">{secrets.data?.map((s) => <SecretRow key={s.name} s={s} />)}</ul>
    </section>
  );
}
