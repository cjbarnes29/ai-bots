import { useState } from "react";
import { ApiError } from "../../api/client";
import { useAccessFolders, useAccessLog, useCheckFolder, useGrantFolder, usePreviewGrant, useRevokeAllFolders, useRevokeFolder } from "../../api/hooks";
import type { FolderOp, GrantPreviewInfo, GrantRequest } from "../../api/types";
import { ConfirmDialog } from "../ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

const OPS: { id: FolderOp; label: string; hint: string }[] = [
  { id: "read", label: "Read", hint: "look at files and list what is in the folder" },
  { id: "create", label: "Create", hint: "make new files and folders" },
  { id: "edit", label: "Edit", hint: "change files that already exist" },
  { id: "rename", label: "Rename", hint: "rename files and folders" },
  { id: "delete", label: "Delete", hint: "delete files and folders" },
];
const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "8 hours", minutes: 480 },
  { label: "24 hours", minutes: 1440 },
  { label: "7 days", minutes: 10_080 },
  { label: "Until I take it back", minutes: null },
];

/** Access > Folders. Nothing is allowed until you approve a folder here, and you choose exactly what may be done in it. */
export function FoldersPanel() {
  const folders = useAccessFolders();
  const preview = usePreviewGrant();
  const grant = useGrantFolder();
  const revoke = useRevokeFolder();
  const revokeAll = useRevokeAllFolders();
  const check = useCheckFolder();
  const log = useAccessLog();
  const [path, setPath] = useState("");
  const [ops, setOps] = useState<FolderOp[]>(["read"]);
  const [inherit, setInherit] = useState(false);
  const [duration, setDuration] = useState<number | null>(60);
  const [confirmKind, setConfirmKind] = useState(false);
  const [shown, setShown] = useState<GrantPreviewInfo | null>(null);
  const [askAll, setAskAll] = useState(false);
  const [testPath, setTestPath] = useState("");
  const [testOp, setTestOp] = useState<FolderOp>("read");
  const [showLog, setShowLog] = useState(false);
  const d = folders.data;
  const err = errorText(preview.error ?? grant.error ?? revoke.error ?? revokeAll.error);

  const request = (): GrantRequest => ({
    subject: "workforce",
    path: path.trim(),
    ops,
    inherit,
    expiresInMinutes: shown?.sensitive && duration === null ? 1440 : duration,
    ...(shown?.sensitive && confirmKind ? { acknowledgeSensitive: shown.sensitive.category } : {}),
  });
  const toggleOp = (o: FolderOp) => {
    setShown(null);
    setOps((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));
  };
  const reset = () => {
    setPath("");
    setOps(["read"]);
    setInherit(false);
    setDuration(60);
    setConfirmKind(false);
    setShown(null);
  };
  const sensitiveNeedsConfirm = !!shown?.sensitive && !confirmKind;

  return (
    <section aria-label="Folders" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Folder access</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          <strong>The AI Workforce can touch no folder until you approve it here.</strong> You approve one folder at a time and choose exactly what may be done in it.
          Approving a folder does not approve its parent, its neighbours or other drives. Secrets (passwords, keys, .env files, browser profiles, mail, chat) are never
          included; they need their own short-lived approval.
        </p>
      </div>
      {d?.tampered && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm dark:bg-red-950">
          {d.tampered}
        </p>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold">Approved folders</h3>
        {(d?.grants ?? []).length === 0 && <p className="hint">None. So the AI Workforce cannot read, create, change or delete anything on this PC.</p>}
        <ul className="space-y-2">
          {(d?.grants ?? []).map((g) => (
            <li key={g.id} aria-label={`Folder ${g.path}`} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-mono [overflow-wrap:anywhere]">{g.path}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.status === "active" ? "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100" : "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100"}`}>
                  {g.status === "active" ? "Active" : g.status === "expired" ? "Expired" : "Taken back"}
                </span>
              </div>
              <p>
                Allowed: <strong>{g.ops.join(", ")}</strong> · {g.inherit ? "includes all sub-folders" : "this folder only (not sub-folders)"} ·{" "}
                {g.expiresAt ? `${g.status === "active" ? "ends" : "ended"} ${new Date(g.expiresAt).toLocaleString()}` : "until you take it back"}
              </p>
              {g.sensitive && <p className="text-amber-800 dark:text-amber-300">Secret or personal place ({g.sensitive}). Short-lived on purpose.</p>}
              {g.status === "active" && (
                <button className="btn-danger mt-2" disabled={revoke.isPending} onClick={() => revoke.mutate(g.id)} aria-label={`Take back ${g.path}`}>
                  Take back
                </button>
              )}
            </li>
          ))}
        </ul>
        {(d?.grants ?? []).some((g) => g.status === "active") && (
          <button className="btn-secondary" onClick={() => setAskAll(true)}>
            Take back all folder access
          </button>
        )}
      </div>

      <form
        className="space-y-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800/50"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim() && ops.length > 0) preview.mutate(request(), { onSuccess: setShown });
        }}
      >
        <h3 className="font-semibold">Approve a folder</h3>
        <label className="block text-sm">
          <span className="label">Full path of the folder</span>
          <input aria-label="Folder path" value={path} onChange={(e) => { setPath(e.target.value); setShown(null); }} placeholder="D:\Projects\my-app" className="w-full font-mono" />
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="label">What may be done in it</legend>
          {OPS.map((o) => (
            <label key={o.id} className="flex items-center gap-2">
              <input type="checkbox" checked={ops.includes(o.id)} onChange={() => toggleOp(o.id)} aria-label={o.label} /> <strong>{o.label}</strong> <span className="hint">{o.hint}</span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inherit} onChange={(e) => { setInherit(e.target.checked); setShown(null); }} /> Include all sub-folders inside it
        </label>
        <label className="block text-sm">
          <span className="label">For how long</span>
          <select aria-label="For how long" value={duration === null ? "forever" : String(duration)} onChange={(e) => { setDuration(e.target.value === "forever" ? null : Number(e.target.value)); setShown(null); }}>
            {DURATIONS.map((x) => (
              <option key={x.label} value={x.minutes === null ? "forever" : String(x.minutes)}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-secondary" disabled={!path.trim() || ops.length === 0 || preview.isPending}>
          {preview.isPending ? "Checking..." : "Show me exactly what this allows"}
        </button>
        {err && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {err}
          </p>
        )}
        {shown && !shown.ok && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {shown.problem}
          </p>
        )}
        {shown?.ok && (
          <div aria-label="What this allows" className="space-y-2 rounded-md border border-slate-300 p-3 text-sm dark:border-slate-600">
            <p className="font-semibold">This will allow:</p>
            <ul className="list-disc pl-5">
              {shown.allows.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="font-semibold">This will NOT allow:</p>
            <ul className="list-disc pl-5">
              {shown.doesNotAllow.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {shown.warnings.map((w) => (
              <p key={w} className="text-amber-800 dark:text-amber-300">
                {w}
              </p>
            ))}
            {shown.sensitive && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={confirmKind} onChange={(e) => setConfirmKind(e.target.checked)} />
                <span>
                  I understand this folder is <strong>{shown.sensitive.label}</strong> and I want to approve it on purpose, for at most 24 hours.
                </span>
              </label>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={grant.isPending || sensitiveNeedsConfirm}
              onClick={() => grant.mutate(request(), { onSuccess: reset })}
            >
              Approve this folder
            </button>
          </div>
        )}
      </form>

      <form
        className="space-y-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (testPath.trim()) check.mutate({ path: testPath.trim(), op: testOp });
        }}
      >
        <h3 className="font-semibold">Try it: would this be allowed?</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Path to test" value={testPath} onChange={(e) => setTestPath(e.target.value)} placeholder="D:\Projects\my-app\notes.txt" className="min-w-64 flex-1 font-mono" />
          <select aria-label="Operation to test" value={testOp} onChange={(e) => setTestOp(e.target.value as FolderOp)}>
            {OPS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="btn-secondary" disabled={!testPath.trim() || check.isPending}>
            Check
          </button>
        </div>
        {check.data && (
          <p role="status" className={check.data.allowed ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}>
            {check.data.allowed ? "Allowed." : `Not allowed. ${check.data.reason ?? ""}`}
          </p>
        )}
      </form>

      <div className="space-y-2">
        <button className="underline text-sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? "Hide" : "Show"} the record of approvals, denials and changes
        </button>
        {showLog && (
          <ul aria-label="Access record" className="max-h-72 space-y-1 overflow-auto text-xs">
            {(log.data ?? []).map((e) => (
              <li key={e.id} className="font-mono [overflow-wrap:anywhere]">
                {new Date(e.createdAt).toLocaleString()} · {e.kind.replace("access.", "")} · {e.actor} · {String(e.detail["path"] ?? e.detail["name"] ?? e.detail["reason"] ?? "")}
              </li>
            ))}
            {(log.data ?? []).length === 0 && <li className="hint">Nothing recorded yet.</li>}
          </ul>
        )}
      </div>

      {askAll && (
        <ConfirmDialog title="Take back all folder access" confirmLabel="Take back all" danger onConfirm={() => revokeAll.mutate(undefined, { onSuccess: () => setAskAll(false) })} onCancel={() => setAskAll(false)}>
          <p className="text-sm">Every approved folder stops working immediately, including for anything already running.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
