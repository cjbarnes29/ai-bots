import { useState } from "react";
import { ApiError } from "../../api/client";
import { useSecrets, useSetSecret } from "../../api/hooks";
import type { CredentialField } from "../../lib/serviceGuides";
import { ErrorNote, SuccessNote } from "./SetupBits";

const friendly = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work. Try again.");

/**
 * The credential boxes of ONE integration. Values live only in this component's memory until "Save" sends them to the existing encrypted
 * vault (PUT /api/vault/:name); then the boxes are emptied. A saved value is never shown again: only "Saved" and a Replace option.
 * Nothing is written to browser storage.
 */
export function CredentialFields({ fields, onSaved }: { fields: CredentialField[]; onSaved?: () => void }) {
  const secrets = useSecrets();
  const set = useSetSecret();
  const [values, setValues] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [savedNow, setSavedNow] = useState(false);
  const status = (name: string) => secrets.data?.find((s) => s.name === name);
  const isSaved = (name: string) => Boolean(status(name)?.inVault || status(name)?.inEnv);

  const open = fields.filter((f) => !isSaved(f.secret) || replacing[f.secret]);
  const checks = Object.fromEntries(open.map((f) => [f.secret, f.check ? f.check(values[f.secret] ?? "") : { error: null, warning: null }]));
  const filled = open.filter((f) => (values[f.secret] ?? "").trim() !== "");
  // a required credential must be either saved already or typed now; every typed value must pass its check
  const missingRequired = fields.some((f) => f.required && !isSaved(f.secret) && !(values[f.secret] ?? "").trim());
  const blocking = filled.some((f) => checks[f.secret]?.error) || missingRequired;
  const canSave = filled.length > 0 && !blocking && !set.isPending;

  const save = async () => {
    for (const f of filled) await set.mutateAsync({ name: f.secret, value: (values[f.secret] ?? "").trim() });
    setValues({});
    setReplacing({});
    setShow({});
    setSavedNow(true);
    onSaved?.();
  };

  if (secrets.isPending) return <p role="status">Checking what is saved…</p>;
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const saved = isSaved(f.secret);
        const editing = !saved || replacing[f.secret];
        const v = values[f.secret] ?? "";
        const c = checks[f.secret];
        const id = `cred-${f.secret}`;
        return (
          <div key={f.secret} className="space-y-1 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={id} className="font-medium">
                {f.label} <span className="text-xs font-normal text-slate-500">{f.required ? "(required)" : "(optional)"}</span>
              </label>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${saved ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                {saved ? (status(f.secret)?.inVault ? "Saved (encrypted)" : "Set in the .env file") : "Not saved"}
              </span>
            </div>
            <p className="hint">{f.help}</p>
            {editing ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={id}
                    type={f.kind === "secret" && !show[f.secret] ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={f.placeholder}
                    value={v}
                    aria-invalid={Boolean(v && c?.error)}
                    onChange={(e) => {
                      setSavedNow(false);
                      setValues((x) => ({ ...x, [f.secret]: e.target.value }));
                    }}
                    className="min-w-0 flex-1 font-mono"
                  />
                  {f.kind === "secret" && (
                    <button type="button" className="btn-secondary min-h-11" aria-pressed={Boolean(show[f.secret])} aria-label={`${show[f.secret] ? "Hide" : "Show"} ${f.label}`} onClick={() => setShow((x) => ({ ...x, [f.secret]: !x[f.secret] }))}>
                      {show[f.secret] ? "Hide" : "Show"}
                    </button>
                  )}
                  {saved && (
                    <button type="button" className="btn-secondary min-h-11" onClick={() => setReplacing((x) => ({ ...x, [f.secret]: false }))}>
                      Keep the saved one
                    </button>
                  )}
                </div>
                {v && c?.error && <ErrorNote text={c.error} />}
                {v && !c?.error && c?.warning && (
                  <p role="status" className="rounded-md bg-amber-100 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {c.warning}
                  </p>
                )}
              </>
            ) : (
              <button type="button" className="btn-secondary min-h-11" onClick={() => setReplacing((x) => ({ ...x, [f.secret]: true }))} aria-label={`Replace ${f.label}`}>
                Replace
              </button>
            )}
          </div>
        );
      })}
      {open.length > 0 && (
        <div className="space-y-1">
          <button type="button" className="btn-primary min-h-11" disabled={!canSave} onClick={() => void save().catch(() => undefined)}>
            {set.isPending ? "Saving…" : "Save securely"}
          </button>
          <p className="hint">Saved encrypted on this PC. Never shown again, never sent to a bot, never written to the logs.</p>
        </div>
      )}
      {savedNow && <SuccessNote>Saved securely.</SuccessNote>}
      <ErrorNote text={friendly(set.error)} />
    </div>
  );
}
