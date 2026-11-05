import { useGuardianStatus } from "../api/hooks";

/** A one-line status of the Guardian, in the shell on every page. Never hides a problem: an unconfigured or stopped Guardian is shown in plain words. */
export function GuardianBanner() {
  const { data } = useGuardianStatus();
  if (!data) return null;

  if (!data.configured) {
    return (
      <div role="note" aria-label="Guardian status" className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100">
        <strong>Guardian not set up.</strong> Owner actions on this PC are not protected against scripts, and nothing pauses when you step away. See docs/GUARDIAN.md.
      </div>
    );
  }

  if (!data.reachable || data.state !== "RUN") {
    const why = !data.reachable ? "The Guardian is not responding, so nothing new will start." : (data.held ?? `The AI Workforce is ${data.state}.`);
    return (
      <div role="alert" aria-label="Guardian status" className="flex flex-wrap items-center gap-3 border-b border-red-300 bg-red-100 px-4 py-2 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100">
        <span className="flex-1">
          <strong>{data.reachable ? `Paused: ${data.state}.` : "Guardian not responding."}</strong> {why}
        </span>
        {data.url && (
          <a className="rounded-md px-2 py-1 font-medium underline" href={data.url} target="_blank" rel="noreferrer">
            Open the Guardian page to resume
          </a>
        )}
      </div>
    );
  }

  const p = data.presence;
  return (
    <div role="note" aria-label="Guardian status" className="border-b border-emerald-300 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
      Guardian running (Tier {data.tier ?? "?"}: development and supervised testing only).{" "}
      {p?.monitoring ? `Presence: ${p.locked ? "locked" : "here"}, idle ${p.idleMinutes ?? "?"} of ${p.idleLimitMinutes} min.` : "Presence monitoring is OFF."}
    </div>
  );
}
