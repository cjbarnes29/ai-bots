import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useArchiveBot, useBot, useDuplicateBot, useUnarchiveBot, useUpdateBot } from "../api/hooks";
import type { BotStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DetailsTab } from "../components/DetailsTab";
import { PermissionsTab } from "../components/PermissionsTab";
import { StatusBadge } from "../components/StatusBadge";
import { VersionsTab } from "../components/VersionsTab";

type Tab = "details" | "versions" | "permissions";
const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "versions", label: "Versions" },
  { id: "permissions", label: "Permissions" },
];

export function BotEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const bot = useBot(id);
  const update = useUpdateBot(id);
  const archive = useArchiveBot();
  const unarchive = useUnarchiveBot();
  const duplicate = useDuplicateBot();

  const [tab, setTab] = useState<Tab>("details");
  const [dirty, setDirty] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const handleDirty = useCallback((d: boolean) => setDirty(d), []);

  if (bot.isPending) return <p role="status">Loading bot…</p>;

  if (bot.isError) {
    const notFound = bot.error instanceof ApiError && bot.error.status === 404;
    return (
      <div role="alert" className="card space-y-3">
        <p>{notFound ? "This bot does not exist." : bot.error instanceof ApiError ? bot.error.friendly : "Could not load this bot."}</p>
        <Link to="/" className="btn-secondary">
          Back to all bots
        </Link>
      </div>
    );
  }

  const b = bot.data;
  const actionError = [update, archive, unarchive, duplicate]
    .map((m) => m.error)
    .find((e) => e !== null && e !== undefined);
  const actionMessage = actionError instanceof ApiError ? actionError.friendly : actionError ? "That did not work." : null;

  return (
    <div className="space-y-5">
      <Link to="/" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
        ← All bots
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{b.name}</h1>
            <StatusBadge status={b.status} archived={b.archived} />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {b.role || "No role yet"} · Version {b.currentVersion}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="bot-status" className="label">
              Status
            </label>
            <select
              id="bot-status"
              value={b.status}
              disabled={b.archived || update.isPending}
              onChange={(e) => update.mutate({ status: e.target.value as BotStatus })}
            >
              <option value="disabled">Disabled</option>
              <option value="paused">Paused</option>
              <option value="active" disabled>
                Active (available in Phase 2)
              </option>
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate(b.id, { onSuccess: (copy) => navigate(`/bots/${copy.id}`) })}
          >
            Duplicate
          </button>
          {b.archived ? (
            <button type="button" className="btn-secondary" disabled={unarchive.isPending} onClick={() => unarchive.mutate(b.id)}>
              Unarchive
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setConfirmArchive(true)}>
              Archive
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {actionMessage}
        </p>
      )}

      <div role="tablist" aria-label="Bot sections" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700 dark:text-indigo-400"
                : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {t.label}
            {t.id === "details" && dirty ? " •" : ""}
          </button>
        ))}
      </div>

      {/* Details stays mounted (just hidden) so unsaved edits survive switching tabs. */}
      <DetailsTab bot={b} hidden={tab !== "details"} onDirtyChange={handleDirty} />
      {tab === "versions" && <VersionsTab bot={b} hasUnsavedEdits={dirty} />}
      {tab === "permissions" && <PermissionsTab bot={b} />}

      {confirmArchive && (
        <ConfirmDialog
          title={`Archive "${b.name}"?`}
          confirmLabel="Archive"
          danger
          busy={archive.isPending}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() =>
            archive.mutate(b.id, {
              onSettled: () => setConfirmArchive(false),
            })
          }
        >
          <p>The bot is hidden from the main list and set to Disabled. Nothing is deleted, and you can unarchive it later.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
