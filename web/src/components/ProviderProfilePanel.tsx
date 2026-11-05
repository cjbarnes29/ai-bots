import { usePatchProvider } from "../api/hooks";
import type { ProviderView } from "../api/types";

const COST: Record<string, string> = {
  permanently_free: "Permanently free",
  free_with_limits: "Free with usage limits",
  trial_credits: "Temporary trial or credits",
  paid: "Paid",
  local_free: "Local, no API usage cost",
  unverified: "Unknown or unverified",
};
const FIT: Record<string, string> = { yes: "Likely", partly: "Partly", no: "Not suited", untested: "Untested" };
const TASKS: [keyof NonNullable<ProviderView["profile"]>["suitability"], string][] = [
  ["planning", "Manager planning"],
  ["workerSteps", "Worker steps"],
  ["screenshots", "Reading screenshots"],
  ["visualNavigation", "Visual navigation"],
  ["toolCalls", "Tool / function calls"],
  ["errorRecovery", "Error recovery"],
  ["multiStep", "Multi-step workflows"],
];
const STALE_DAYS = 90;

/**
 * Settings > Providers: what the provider costs, what it can do, what it does with data, how much of today's allowance is used, and whether it may be
 * used for operating desktop applications. Part of the existing provider card (not a second settings system). The facts come from the provider's own
 * pages on the date shown; see docs/SETTINGS-AUDIT.md.
 */
export function ProviderProfilePanel({ provider: p }: { provider: ProviderView }) {
  const patch = usePatchProvider();
  const prof = p.profile;
  if (!prof) return null;
  const ageDays = Math.floor((Date.now() - Date.parse(prof.verifiedOn)) / 86_400_000);
  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium dark:bg-slate-700">{COST[prof.costClass]}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          Checked {prof.verifiedOn}
          {ageDays > STALE_DAYS ? " (out of date: re-check before relying on it)" : ""}
        </span>
      </div>

      {p.quota.dailyCap !== null && (
        <p role={p.quota.exhausted ? "alert" : undefined} className={p.quota.exhausted ? "font-medium text-red-700 dark:text-red-300" : ""}>
          {p.quota.exhausted
            ? `Today's allowance is used up (${p.quota.requestsToday} of ${p.quota.dailyCap} requests). Nothing more is sent to ${p.displayName} until tomorrow, and nothing switches to a paid model.`
            : `Today: ${p.quota.requestsToday} of ${p.quota.dailyCap} requests (this app's own cap, not the provider's real quota).`}
        </p>
      )}

      <details>
        <summary className="cursor-pointer font-medium">Cost, privacy and what it can do</summary>
        <div className="mt-2 space-y-2">
          <p>{prof.freeSummary}</p>
          <p>
            <strong>Payment card:</strong> {prof.cardRequired === null ? "not stated on the pages checked" : prof.cardRequired ? "required" : "not required"}.
          </p>
          <p>
            <strong>Limits:</strong> {prof.limits}
          </p>
          <p>
            <strong>Privacy:</strong> {prof.privacy}
          </p>
          <p>
            <strong>Commercial use:</strong> {prof.commercialUse}
          </p>
          <p>
            <strong>Images and tools:</strong> the provider {prof.provider.vision === "yes" ? "offers image-capable models" : "has not been confirmed to offer image input"}; but{" "}
            <strong>this app cannot send images or tool calls yet</strong>, so screenshots are not possible with any provider today.
          </p>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">How well {p.displayName} could do each part of operating applications</caption>
            <tbody>
              {TASKS.map(([k, label]) => (
                <tr key={k}>
                  <th scope="row" className="py-0.5 pr-3 font-normal">
                    {label}
                  </th>
                  <td>{FIT[prof.suitability[k]]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Our view:</strong> {prof.recommendation}
          </p>
          {prof.sources.length > 0 && (
            <p className="break-all text-xs text-slate-500">
              Sources: {prof.sources.join(" · ")}
            </p>
          )}
        </div>
      </details>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={p.appAutomation}
          disabled={patch.isPending || (!p.enabled && !p.appAutomation)}
          onChange={(e) => patch.mutate({ id: p.id, patch: { appAutomation: e.target.checked } })}
        />
        <span>
          Allow {p.displayName} to be used for operating desktop applications.{" "}
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Off by default. Only records your choice: no application engine exists yet, and approving a provider never approves a program or a folder. Switching the
            provider off turns this off.
          </span>
        </span>
      </label>
    </div>
  );
}
