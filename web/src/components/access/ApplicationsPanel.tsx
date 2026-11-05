import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { useAccessApps, useRevokeApp, useRevokeAllApps, useScanApps, useSessionApproveApp, useSetApp } from "../../api/hooks";
import type { AccessApp, AppLevel } from "../../api/types";
import { ConfirmDialog } from "../ConfirmDialog";

const errorText = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work.");

const LEVEL: Record<AppLevel, { label: string; hint: string; cls: string }> = {
  unknown: { label: "Not approved", hint: "Every program starts here. The AI cannot use it until you allow it.", cls: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100" },
  approved: { label: "Approved", hint: "You chose exactly what the AI may do with it.", cls: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100" },
  trusted: { label: "Trusted", hint: "Permanently allowed for what you chose, until its review date.", cls: "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100" },
  protected: { label: "Protected", hint: "Cannot be approved. It needs its own separate security policy, which does not exist yet.", cls: "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100" },
};

const chip = "rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800";

type Mode = { kind: "session" | "approve" | "trust" | "revoke"; app: AccessApp } | { kind: "revokeAll" };

/** Access > Applications. Read-only discovery, plus the four permission levels. Approving a program never approves files or accounts. */
export function ApplicationsPanel() {
  const apps = useAccessApps();
  const scan = useScanApps();
  const session = useSessionApproveApp();
  const setApp = useSetApp();
  const revoke = useRevokeApp();
  const revokeAll = useRevokeAllApps();
  const [q, setQ] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [caps, setCaps] = useState<string[]>(["open", "view"]);
  const [days, setDays] = useState("");
  const d = apps.data;
  const list = useMemo(
    () => (d?.apps ?? []).filter((a) => (showSystem || !a.system) && (!onlyRunning || a.running.count > 0) && (q.trim() === "" || `${a.name} ${a.publisher ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))),
    [d, q, showSystem, onlyRunning],
  );
  const err = errorText(scan.error ?? session.error ?? setApp.error ?? revoke.error ?? revokeAll.error);

  const close = () => {
    setMode(null);
    setCaps(["open", "view"]);
    setDays("");
  };
  const toggle = (c: string) => setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const submit = () => {
    if (!mode || mode.kind === "revoke" || mode.kind === "revokeAll") return;
    const id = mode.app.id;
    const done = { onSuccess: close };
    if (mode.kind === "session") session.mutate({ id, capabilities: caps }, done);
    else if (mode.kind === "approve") setApp.mutate({ id, level: "approved", capabilities: caps, expiresInDays: days ? Number(days) : null }, done);
    else setApp.mutate({ id, level: "trusted", capabilities: caps, reviewInDays: Number(days) }, done);
  };

  return (
    <section aria-label="Applications" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Applications on this PC</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A read-only look at what is installed and running. Scanning never starts, changes or removes anything.{" "}
          <strong>
            Seeing a program here does not approve it, and approving a program never gives it access to your files, accounts, passwords or personal data.
          </strong>{" "}
          Those are approved separately, under Folders.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={scan.isPending} onClick={() => scan.mutate()}>
          {scan.isPending ? "Scanning..." : d?.scannedAt ? "Scan again (read-only)" : "Scan applications (read-only)"}
        </button>
        {d?.scannedAt && <span className="hint">Last scan: {new Date(d.scannedAt).toLocaleString()}</span>}
        <button className="btn-secondary" onClick={() => setMode({ kind: "revokeAll" })}>
          Take back every application approval
        </button>
      </div>
      {d?.tampered && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm dark:bg-red-950">
          {d.tampered}
        </p>
      )}
      {(err || d?.scanError) && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {err ?? d?.scanError}
        </p>
      )}
      {d?.scannedAt && (
        <>
          <ul className="hint list-disc pl-5">
            {d.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <input aria-label="Search applications" placeholder="Search by name or publisher" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-56" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Only running
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> Show Windows&apos; own programs
            </label>
            <span className="hint">{list.length} shown</span>
          </div>
          <ul className="space-y-2">
            {list.map((a) => (
              <li key={a.id} aria-label={a.name} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {a.name} {a.version && <span className="hint font-normal">{a.version}</span>}
                    </p>
                    <p className="hint [overflow-wrap:anywhere]">
                      {a.publisher ?? a.signer ?? "Publisher unknown"} {a.exePath ? `· ${a.exePath}` : ""}
                    </p>
                  </div>
                  <span title={LEVEL[a.level].hint} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL[a.level].cls}`}>
                    {LEVEL[a.level].label}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap gap-2 text-xs">
                  {a.running.count > 0 && <span className={chip}>Running ({a.running.count})</span>}
                  {a.services.length > 0 && <span className={chip}>Background service</span>}
                  {a.startup.length > 0 && <span className={chip}>Starts with Windows</span>}
                  {a.tasks.length > 0 && <span className={chip}>Scheduled task</span>}
                  {a.integrations.map((i) => (
                    <span key={i} className={chip}>
                      Used by the AI Workforce: {i}
                    </span>
                  ))}
                  <span className={chip}>{a.signed ? "Names a publisher in the file" : "No publisher in the file"}</span>
                </p>
                {a.protectedBy && (
                  <p className="mt-1 text-sm text-red-800 dark:text-red-300">
                    Protected ({a.protectedBy.category}): {a.protectedBy.why}. It cannot be approved here.
                  </p>
                )}
                {a.riskNotes.map((n) => (
                  <p key={n} className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                    {n}
                  </p>
                ))}
                {a.session && (
                  <p className="mt-1 text-sm">
                    Allowed for this session until {new Date(a.session.until).toLocaleTimeString()}: {a.session.capabilities.join(", ")}.
                  </p>
                )}
                {a.approval && a.level !== "unknown" && (
                  <p className="mt-1 text-sm">
                    You allowed: {a.approval.capabilities.join(", ")}. {a.approval.reviewBy ? `Review by ${new Date(a.approval.reviewBy).toLocaleDateString()}. ` : ""}
                    {a.approval.expiresAt ? `Expires ${new Date(a.approval.expiresAt).toLocaleDateString()}.` : ""}
                  </p>
                )}
                {a.level !== "protected" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.level === "unknown" && (
                      <button className="btn-secondary" onClick={() => setMode({ kind: "session", app: a })}>
                        Allow for this session only...
                      </button>
                    )}
                    <button className="btn-secondary" onClick={() => setMode({ kind: "approve", app: a })}>
                      Approve...
                    </button>
                    {a.signed && (
                      <button className="btn-secondary" onClick={() => setMode({ kind: "trust", app: a })}>
                        Trust...
                      </button>
                    )}
                    {(a.level !== "unknown" || a.session) && (
                      <button className="btn-danger" onClick={() => setMode({ kind: "revoke", app: a })}>
                        Take back
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {list.length === 0 && <li className="hint">Nothing matches.</li>}
          </ul>
        </>
      )}

      {mode && (mode.kind === "session" || mode.kind === "approve" || mode.kind === "trust") && (
        <ConfirmDialog
          title={mode.kind === "session" ? `Allow ${mode.app.name} for this session` : mode.kind === "approve" ? `Approve ${mode.app.name}` : `Trust ${mode.app.name}`}
          confirmLabel={mode.kind === "session" ? "Allow for this session" : mode.kind === "approve" ? "Approve" : "Trust"}
          busy={session.isPending || setApp.isPending}
          onConfirm={() => caps.length > 0 && (mode.kind !== "trust" || Number(days) > 0) && submit()}
          onCancel={close}
        >
          <div className="space-y-3 text-sm">
            <p>The AI may do only what you tick:</p>
            {(d?.capabilities ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={caps.includes(c.id)} onChange={() => toggle(c.id)} /> {c.label}
              </label>
            ))}
            {mode.kind === "approve" && (
              <label className="block">
                <span className="label">Stop after this many days (empty = until you take it back)</span>
                <input aria-label="Days until it stops" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className="w-32" />
              </label>
            )}
            {mode.kind === "trust" && (
              <label className="block">
                <span className="label">Look at this decision again after how many days? (1 to 365, required)</span>
                <input aria-label="Days until review" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className="w-32" />
              </label>
            )}
            {mode.kind === "session" && <p className="hint">This lasts until the app restarts (12 hours at most).</p>}
            <p className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
              <strong>This does NOT give the program or the AI access to any files, accounts, passwords or personal data.</strong> Folders are approved separately.
            </p>
            {mode.app.riskNotes.map((n) => (
              <p key={n} className="text-amber-800 dark:text-amber-300">
                {n}
              </p>
            ))}
          </div>
        </ConfirmDialog>
      )}
      {mode?.kind === "revoke" && (
        <ConfirmDialog title={`Take back access for ${mode.app.name}`} confirmLabel="Take back" danger onConfirm={() => revoke.mutate(mode.app.id, { onSuccess: close })} onCancel={close}>
          <p className="text-sm">It goes back to &quot;Not approved&quot; immediately, including any session approval.</p>
        </ConfirmDialog>
      )}
      {mode?.kind === "revokeAll" && (
        <ConfirmDialog title="Take back every application approval" confirmLabel="Take back all" danger onConfirm={() => revokeAll.mutate(undefined, { onSuccess: close })} onCancel={close}>
          <p className="text-sm">Every program goes back to &quot;Not approved&quot;. Folder approvals are not affected.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
