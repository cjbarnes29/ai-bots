import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useArchiveBot, useBot, useDuplicateBot, useUnarchiveBot, useUpdateBot } from "../api/hooks";
import type { BotStatus } from "../api/types";
import { BotHistory } from "../components/BotHistory";
import { ChatTab } from "../components/ChatTab";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DetailsTab } from "../components/DetailsTab";
import { PermissionsTab } from "../components/PermissionsTab";
import { StatusBadge } from "../components/StatusBadge";
import { TeamTab } from "../components/TeamTab";
import { Tabs } from "../components/ui/Tabs";
import { VersionsTab } from "../components/VersionsTab";

type Tab = "details" | "chat" | "team" | "history" | "versions" | "permissions";
const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "chat", label: "Chat" },
  { id: "team", label: "Team" },
  { id: "history", label: "History" },
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
        <Link to="/agents" className="btn-secondary">
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
      <Link to="/agents" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
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
              aria-describedby="bot-status-help"
              value={b.status}
              disabled={b.archived || update.isPending}
              onChange={(e) => update.mutate({ status: e.target.value as BotStatus })}
            >
              <option value="disabled">Disabled</option>
              <option value="paused">Paused</option>
              <option value="active" disabled={!b.model}>
                Active{b.model ? "" : " (choose a model first)"}
              </option>
            </select>
            <p id="bot-status-help" className="hint max-w-64">
              {b.status === "active"
                ? "Active: it answers chats and runs tasks. Its permissions are unchanged."
                : b.model
                  ? "It does not run (no chat, tasks, schedules or teamwork) until you set it to Active."
                  : "Choose an AI model on the Details tab, then set it to Active."}
            </p>
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

      <Tabs label="Bot sections" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.id === "details" && dirty ? `${t.label} •` : t.label }))} />

      {/* Details stays mounted (just hidden) so unsaved edits survive switching tabs. */}
      <DetailsTab bot={b} hidden={tab !== "details"} onDirtyChange={handleDirty} />
      {tab === "chat" && <ChatTab bot={b} hasUnsavedEdits={dirty} />}
      {tab === "team" && <TeamTab bot={b} />}
      {tab === "history" && <BotHistory bot={b} />}
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
