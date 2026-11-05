import { useDesktopLog, useDesktopStatus, useSetDesktopCloudText } from "../../api/hooks";

/** Access > Desktop control. What the engine can do on this PC, the rules it follows, and the record of what it did. */
export function DesktopPanel() {
  const status = useDesktopStatus();
  const log = useDesktopLog();
  const setCloud = useSetDesktopCloudText();
  const d = status.data;
  return (
    <section aria-label="Desktop control" className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Desktop control</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Lets approved workers operate programs you approved under Applications, using Windows&apos; own accessibility (UI Automation) and local text reading (OCR). Nothing is
          sent anywhere and nothing is installed. Every plan waits for your approval on the Approvals page.
        </p>
      </div>
      {d?.problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {d.problem}
        </p>
      )}
      {d?.engine && (
        <p role="status" className="text-sm">
          UI Automation: <strong>{d.engine.uia ? "available" : "not available"}</strong> · Local OCR: <strong>{d.engine.ocr ? `available (${d.engine.ocrLanguage ?? "?"})` : "not available"}</strong>
        </p>
      )}
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>It controls <strong>only programs it starts itself</strong>. It never attaches to a window you already have open, and never touches your other windows.</li>
        <li>It never reads or types into password fields, never replaces text that is already there, and never closes a window holding unsaved work, unless a plan says so explicitly and you approve it.</li>
        <li>Pictures of a window exist only for a moment, on this PC, and are deleted at once. They are never sent to an AI provider.</li>
        <li>It stops at once when the Guardian pauses or you take an approval back. Files are saved only in folders you approved.</li>
        <li>Windows Home gives no isolation in this setup (Tier A): a program it starts runs as you. Use it only while you are present.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={d?.cloudScreenText ?? false} disabled={setCloud.isPending} onChange={(e) => setCloud.mutate(e.target.checked)} />
        <span>
          Allow text read from the screen to be given to workers that use <strong>cloud</strong> models. <span className="hint">Off by default. Free cloud tiers may keep or learn from what they receive; leave this off unless the screens are harmless.</span>
        </span>
      </label>
      <div>
        <h3 className="font-semibold">Recent desktop actions</h3>
        <ul aria-label="Desktop record" className="max-h-64 space-y-1 overflow-auto text-xs">
          {(log.data ?? []).map((e) => (
            <li key={e.id} className="font-mono [overflow-wrap:anywhere]">
              {new Date(e.createdAt).toLocaleString()} · {e.kind.replace("desktop.", "")} · {String(e.detail["name"] ?? e.detail["do"] ?? e.detail["reason"] ?? "")}
            </li>
          ))}
          {(log.data ?? []).length === 0 && <li className="hint">Nothing yet. The record never contains typed text or screen text.</li>}
        </ul>
      </div>
    </section>
  );
}
