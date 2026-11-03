import { useState } from "react";
import { ApiError } from "../api/client";
import { useRestoreVersion, useVersions } from "../api/hooks";
import type { Bot, BotContent, BotVersion } from "../api/types";
import { ConfirmDialog } from "./ConfirmDialog";

const FIELDS: { key: keyof BotContent; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "personality", label: "Personality" },
  { key: "instructions", label: "Instructions" },
  { key: "responsibilities", label: "Responsibilities" },
  { key: "runtime", label: "Runtime" },
  { key: "model", label: "AI model" },
  { key: "temperature", label: "Temperature" },
  { key: "maxOutputTokens", label: "Max reply length" },
];

function show(value: BotContent[keyof BotContent]): string {
  if (Array.isArray(value)) return value.length ? value.map((v) => `• ${v}`).join("\n") : "(none)";
  if (value === null || value === "") return "(default)";
  return String(value);
}

function differs(a: BotContent, b: BotContent, key: keyof BotContent): boolean {
  return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
}

interface Props {
  bot: Bot;
  /** True when the Details tab has unsaved edits (restoring would discard them). */
  hasUnsavedEdits: boolean;
}

export function VersionsTab({ bot, hasUnsavedEdits }: Props) {
  const versions = useVersions(bot.id);
  const restore = useRestoreVersion(bot.id);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (versions.isPending) return <p role="status">Loading version history…</p>;
  if (versions.isError) return <p role="alert">Could not load version history.</p>;

  const list = versions.data;
  const chosen: BotVersion | undefined = list.find((v) => v.version === selected);
  const canRestore = chosen !== undefined && chosen.version !== bot.currentVersion && !bot.archived;
  const error = restore.error instanceof ApiError ? restore.error.friendly : restore.error ? "Could not restore." : null;

  return (
    <div role="tabpanel" aria-label="Versions" className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <ol className="space-y-2" aria-label="Version history">
        {list.map((v) => (
          <li key={v.version}>
            <button
              type="button"
              onClick={() => setSelected(v.version)}
              aria-pressed={selected === v.version}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selected === v.version
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">Version {v.version}</span>
                {v.version === bot.currentVersion && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Current
                  </span>
                )}
              </span>
              <span className="mt-1 block text-slate-600 dark:text-slate-400">
                {v.changeNote ?? "No note"}
                {v.restoredFrom !== null && ` (copy of version ${v.restoredFrom})`}
              </span>
              <span className="mt-1 block text-xs text-slate-500">{new Date(v.createdAt).toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="card space-y-4">
        {!chosen && <p className="text-sm text-slate-600 dark:text-slate-400">Select a version to compare it with the current one.</p>}

        {chosen && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Version {chosen.version}
                {chosen.version === bot.currentVersion ? " (current)" : ` compared with current (version ${bot.currentVersion})`}
              </h2>
              <button type="button" className="btn-primary" disabled={!canRestore || restore.isPending} onClick={() => setConfirming(true)}>
                Restore this version
              </button>
            </div>

            {chosen.version === bot.currentVersion ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">This is the current version.</p>
            ) : (
              (() => {
                const changed = FIELDS.filter((f) => differs(chosen, bot, f.key));
                if (changed.length === 0) {
                  return <p className="text-sm text-slate-600 dark:text-slate-400">Identical to the current version.</p>;
                }
                return (
                  <div className="space-y-4">
                    {changed.map((f) => (
                      <div key={f.key}>
                        <h3 className="mb-1 text-sm font-medium">{f.label}</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-800">
                            <p className="mb-1 text-xs font-semibold text-slate-500">Version {chosen.version}</p>
                            <pre className="whitespace-pre-wrap break-words font-sans">{show(chosen[f.key])}</pre>
                          </div>
                          <div className="rounded-md bg-slate-100 p-2 text-sm dark:bg-slate-800">
                            <p className="mb-1 text-xs font-semibold text-slate-500">Current (version {bot.currentVersion})</p>
                            <pre className="whitespace-pre-wrap break-words font-sans">{show(bot[f.key])}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
      </div>

      {confirming && chosen && (
        <ConfirmDialog
          title={`Restore version ${chosen.version}?`}
          confirmLabel="Restore"
          busy={restore.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            restore.mutate(chosen.version, {
              onSuccess: () => {
                setConfirming(false);
                setSelected(null);
              },
              onError: () => setConfirming(false),
            })
          }
        >
          <p>
            This creates a <strong>new version</strong> with the content of version {chosen.version}. Nothing is deleted from
            the history.
          </p>
          <p>Permissions and status are not changed.</p>
          {hasUnsavedEdits && (
            <p className="font-medium text-amber-700 dark:text-amber-400">
              You have unsaved edits on the Details tab. They will be discarded.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
